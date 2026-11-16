// Test helpers: an Access stand-in with its own RSA keys, tokens signed with them, and a fake key endpoint.
// Nothing here calls Cloudflare. The team, audience and people are invented.

export const TEAM = 'example-team.cloudflareaccess.com';
export const AUD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
export const NOW = 1_800_000_000_000;

const encoder = new TextEncoder();

export function b64url(data: Uint8Array | string): string {
  const raw = typeof data === 'string' ? encoder.encode(data) : data;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type Signer = { kid: string; privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

export async function makeSigner(kid: string): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

/** The claims of a valid token at NOW; `over` changes or removes (undefined) any of them. */
export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Math.floor(NOW / 1000);
  const base: Record<string, unknown> = {
    aud: [AUD],
    email: 'ada@example.com',
    exp: t + 3600,
    iat: t - 10,
    nbf: t - 10,
    iss: `https://${TEAM}`,
    type: 'app',
    sub: '00000000-0000-0000-0000-000000000000',
  };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** A token signed with RS256 by the signer, with its kid unless the header says otherwise. */
export async function sign(signer: Signer, payload: Record<string, unknown> = claims(), header: Record<string, unknown> = {}): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: signer.kid, typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer.privateKey, encoder.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

/** A fake key endpoint that serves the given signers' public keys, and counts its calls. */
export function certsEndpoint(initial: Signer[]) {
  const state = {
    signers: initial,
    calls: [] as string[],
    fail: false,
    fetch: async (url: string): Promise<Response> => {
      state.calls.push(url);
      if (state.fail) return new Response('down', { status: 500 });
      if (url !== `https://${TEAM}/cdn-cgi/access/certs`) return new Response('not found', { status: 404 });
      return Response.json({ keys: state.signers.map((s) => s.jwk), public_cert: {}, public_certs: [] });
    },
  };
  return state;
}
