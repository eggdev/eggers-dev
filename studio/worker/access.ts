// The studio's second lock: the Worker checks the Cloudflare Access sign-in itself, on every request. Access already
// stands in front of studio.eggers.dev; this check keeps the studio closed if that application is ever changed,
// removed or bypassed. It fails closed: a missing setting, an unreadable token or a failed key fetch is a refusal.
// This file has no Cloudflare imports, so `bun test` runs it with its own keys and a fake key endpoint.
//
// Access signs a JSON Web Token (RS256) for each signed-in request. The edge sends it in the
// Cf-Access-Jwt-Assertion header; the browser also holds it in the CF_Authorization cookie. The team's public keys
// are at https://<team domain>/cdn-cgi/access/certs.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export type AccessConfig = {
  /** The Access team's host name, such as <team>.cloudflareaccess.com. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  aud: string;
};

export type Verdict = { ok: true } | { ok: false; reason: string };

export type GateDeps = {
  /** Fetches the team's key set (a JSON Web Key Set); a fake in tests. */
  fetch: (url: string) => Promise<Response>;
  /** The time in milliseconds; a fixed clock in tests. */
  now?: () => number;
};

// Clock skew allowed on exp and nbf, in seconds.
const SKEW_S = 60;
// How long fetched keys are kept before they are fetched again.
const KEYS_TTL_MS = 10 * 60_000;
// An unknown key id fetches the keys again, but not more often than this.
const REFETCH_FLOOR_MS = 30_000;
// A token longer than this is not read. Access tokens are about 1 to 2 KB.
const MAX_TOKEN = 16 * 1024;

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** The two settings, or null when either is missing, empty or not in its form. Then nothing may be served. */
export function readConfig(env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): AccessConfig | null {
  const teamDomain = (env.ACCESS_TEAM_DOMAIN ?? '').trim();
  const aud = (env.ACCESS_AUD ?? '').trim();
  if (!teamDomain || !aud || !HOST.test(teamDomain)) return null;
  return { teamDomain: teamDomain.toLowerCase(), aud };
}

/** The Access token of a request: the Cf-Access-Jwt-Assertion header, else the CF_Authorization cookie. */
export function tokenOf(request: Request): string | null {
  const header = request.headers.get('cf-access-jwt-assertion')?.trim();
  if (header) return header;
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === 'CF_Authorization') {
      const value = part.slice(at + 1).trim();
      if (value) return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Decoding

const B64URL = /^[A-Za-z0-9_-]+$/;

function bytes(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function object(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes(part)));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Keys

type KeySet = { at: number; keys: Map<string, CryptoKey> };

const RS256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

async function importKeys(body: unknown): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  const list = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(list)) throw new Error('the key set has no keys');
  for (const jwk of list as Record<string, unknown>[]) {
    if (jwk?.kty !== 'RSA' || typeof jwk.kid !== 'string' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
    try {
      // Only the public parts go in, so a stray field cannot change how the key is used.
      const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, RS256, false, ['verify']);
      keys.set(jwk.kid, key);
    } catch {
      // A key that does not import is left out; a token signed with it is refused as an unknown key.
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------------------------
// The gate

export type Gate = {
  /** Whether the request carries a valid Access token for this application. Never throws. */
  check(request: Request, config: AccessConfig): Promise<Verdict>;
};

/** A gate with its own key cache. The Worker makes one per isolate, so the keys stay in module memory. */
export function createGate(deps: GateDeps): Gate {
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, KeySet>();
  const pending = new Map<string, Promise<KeySet>>();

  /** Fetches the team's keys. Requests that arrive while a fetch runs share it. */
  function fetchKeys(teamDomain: string): Promise<KeySet> {
    const running = pending.get(teamDomain);
    if (running) return running;
    const job = (async () => {
      const res = await deps.fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
      if (!res.ok) throw new Error(`the key endpoint answered ${res.status}`);
      const set = { at: now(), keys: await importKeys(await res.json()) };
      cache.set(teamDomain, set);
      return set;
    })();
    pending.set(teamDomain, job);
    return job.finally(() => pending.delete(teamDomain));
  }

  async function keyFor(teamDomain: string, kid: string): Promise<CryptoKey | null> {
    let set = cache.get(teamDomain);
    if (!set || now() - set.at > KEYS_TTL_MS) set = await fetchKeys(teamDomain);
    const key = set.keys.get(kid);
    if (key) return key;
    // A new key may have come into use since the last fetch: fetch once more, unless that was just now.
    if (now() - set.at < REFETCH_FLOOR_MS) return null;
    return (await fetchKeys(teamDomain)).keys.get(kid) ?? null;
  }

  async function verify(token: string, config: AccessConfig): Promise<Verdict> {
    const no = (reason: string): Verdict => ({ ok: false, reason });
    if (token.length > MAX_TOKEN) return no('the token is too long');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) return no('the token is not a signed JWT');
    const [head, body, signature] = parts as [string, string, string];

    const header = object(head);
    if (!header) return no('the token header is unreadable');
    // Exactly RS256: never "none", never an HMAC algorithm that would take the public key as a shared secret.
    if (header.alg !== 'RS256') return no('the token algorithm is not RS256');
    if (typeof header.kid !== 'string' || header.kid === '') return no('the token names no key');
    const claims = object(body);
    if (!claims) return no('the token payload is unreadable');

    let key: CryptoKey | null;
    try {
      key = await keyFor(config.teamDomain, header.kid);
    } catch (error) {
      return no(`the keys could not be fetched (${error instanceof Error ? error.message : 'unknown error'})`);
    }
    if (!key) return no('the token names an unknown key');
    const signed = new TextEncoder().encode(`${head}.${body}`);
    if (!(await crypto.subtle.verify(RS256, key, bytes(signature), signed))) return no('the signature does not verify');

    if (claims.iss !== `https://${config.teamDomain}`) return no('the issuer is not this team');
    const aud = claims.aud;
    const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
    if (!audiences.includes(config.aud)) return no('the audience is not this application');
    const t = now() / 1000;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return no('the token has no expiry');
    if (t >= claims.exp + SKEW_S) return no('the token has expired');
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > t + SKEW_S)) {
      return no('the token is not valid yet');
    }
    return { ok: true };
  }

  return {
    async check(request, config) {
      const token = tokenOf(request);
      if (!token) return { ok: false, reason: 'no token' };
      try {
        return await verify(token, config);
      } catch {
        // Any surprise (a malformed signature the runtime refuses, say) is a refusal, never a pass.
        return { ok: false, reason: 'the token could not be checked' };
      }
    },
  };
}
