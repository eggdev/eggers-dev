// Tests for the studio's Access check with its own RSA keys and a fake key endpoint. Nothing here calls Cloudflare.
// Run from studio/: `bun run test`.
import { beforeAll, describe, expect, test } from 'bun:test';
import { createGate, readConfig, tokenOf, type AccessConfig } from './access.ts';
import { AUD, b64url, certsEndpoint, claims, makeSigner, NOW, sign, TEAM, type Signer } from './test-keys.ts';

const CONFIG: AccessConfig = { teamDomain: TEAM, aud: AUD };

let main: Signer;
let other: Signer;
beforeAll(async () => {
  main = await makeSigner('key-main');
  other = await makeSigner('key-other');
});

function setup(signers = [main]) {
  const certs = certsEndpoint(signers);
  const clock = { now: NOW };
  const gate = createGate({ fetch: certs.fetch, now: () => clock.now });
  return { certs, clock, gate };
}

const withHeader = (token: string) => new Request('https://studio.invalid/', { headers: { 'cf-access-jwt-assertion': token } });

describe('readConfig', () => {
  test('takes a host name and an audience tag', () => {
    expect(readConfig({ ACCESS_TEAM_DOMAIN: ` ${TEAM} `, ACCESS_AUD: AUD })).toEqual({ teamDomain: TEAM, aud: AUD });
  });
  test('is null when either is missing, empty or not a host name', () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(readConfig({ ACCESS_AUD: AUD })).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: AUD })).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '   ' })).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: `https://${TEAM}`, ACCESS_AUD: AUD })).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: `${TEAM}/path`, ACCESS_AUD: AUD })).toBeNull();
    expect(readConfig({ ACCESS_TEAM_DOMAIN: 'localhost', ACCESS_AUD: AUD })).toBeNull();
  });
});

describe('tokenOf', () => {
  test('reads the header first, then the CF_Authorization cookie', () => {
    expect(tokenOf(new Request('https://s.invalid/', { headers: { 'cf-access-jwt-assertion': 'h.h.h', cookie: 'CF_Authorization=c.c.c' } }))).toBe('h.h.h');
    expect(tokenOf(new Request('https://s.invalid/', { headers: { cookie: 'theme=dark; CF_Authorization=c.c.c; x=1' } }))).toBe('c.c.c');
    expect(tokenOf(new Request('https://s.invalid/', { headers: { cookie: 'NOT_CF_Authorization=c.c.c' } }))).toBeNull();
    expect(tokenOf(new Request('https://s.invalid/'))).toBeNull();
  });
});

describe('the gate', () => {
  test('a valid token passes, and the keys are fetched once for many requests', async () => {
    const { gate, certs } = setup();
    const token = await sign(main);
    expect(await gate.check(withHeader(token), CONFIG)).toEqual({ ok: true });
    expect(await gate.check(withHeader(token), CONFIG)).toEqual({ ok: true });
    expect(certs.calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  test('an audience given as a string passes too', async () => {
    const { gate } = setup();
    expect((await gate.check(withHeader(await sign(main, claims({ aud: AUD }))), CONFIG)).ok).toBe(true);
  });

  test('the cookie is read when the header is absent', async () => {
    const { gate } = setup();
    const token = await sign(main);
    const req = new Request('https://studio.invalid/', { headers: { cookie: `theme=dark; CF_Authorization=${token}` } });
    expect((await gate.check(req, CONFIG)).ok).toBe(true);
  });

  test('no token is refused, and no keys are fetched', async () => {
    const { gate, certs } = setup();
    expect((await gate.check(new Request('https://studio.invalid/'), CONFIG)).ok).toBe(false);
    expect(certs.calls).toEqual([]);
  });

  test('a wrong audience is refused', async () => {
    const { gate } = setup();
    expect((await gate.check(withHeader(await sign(main, claims({ aud: ['another-application'] }))), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims({ aud: 'another-application' }))), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims({ aud: undefined }))), CONFIG)).ok).toBe(false);
  });

  test('a wrong issuer is refused', async () => {
    const { gate } = setup();
    for (const iss of ['https://another-team.cloudflareaccess.com', TEAM, `https://${TEAM}/`, undefined]) {
      expect((await gate.check(withHeader(await sign(main, claims({ iss }))), CONFIG)).ok).toBe(false);
    }
  });

  test('an expired token is refused; one within the clock skew passes', async () => {
    const { gate } = setup();
    const t = Math.floor(NOW / 1000);
    expect((await gate.check(withHeader(await sign(main, claims({ exp: t - 61 }))), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims({ exp: t - 30 }))), CONFIG)).ok).toBe(true);
    expect((await gate.check(withHeader(await sign(main, claims({ exp: undefined }))), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims({ exp: String(t + 3600) }))), CONFIG)).ok).toBe(false);
  });

  test('a token not valid yet is refused; one within the clock skew passes', async () => {
    const { gate } = setup();
    const t = Math.floor(NOW / 1000);
    expect((await gate.check(withHeader(await sign(main, claims({ nbf: t + 120 }))), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims({ nbf: t + 30 }))), CONFIG)).ok).toBe(true);
    expect((await gate.check(withHeader(await sign(main, claims({ nbf: undefined }))), CONFIG)).ok).toBe(true);
  });

  test('alg "none" is refused, with or without a signature', async () => {
    const { gate } = setup();
    const head = b64url(JSON.stringify({ alg: 'none', kid: main.kid, typ: 'JWT' }));
    const body = b64url(JSON.stringify(claims()));
    expect((await gate.check(withHeader(`${head}.${body}.`), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(`${head}.${body}`), CONFIG)).ok).toBe(false);
    const real = (await sign(main)).split('.')[2];
    expect((await gate.check(withHeader(`${head}.${body}.${real}`), CONFIG)).ok).toBe(false);
  });

  test('alg "HS256" is refused, even keyed with the public key', async () => {
    const { gate } = setup();
    const head = b64url(JSON.stringify({ alg: 'HS256', kid: main.kid, typ: 'JWT' }));
    const body = b64url(JSON.stringify(claims()));
    const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(JSON.stringify(main.jwk)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`${head}.${body}`)));
    expect((await gate.check(withHeader(`${head}.${body}.${b64url(mac)}`), CONFIG)).ok).toBe(false);
  });

  test('other RSA algorithms and a missing kid are refused', async () => {
    const { gate } = setup();
    expect((await gate.check(withHeader(await sign(main, claims(), { alg: 'RS512' })), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims(), { alg: 'rs256' })), CONFIG)).ok).toBe(false);
    expect((await gate.check(withHeader(await sign(main, claims(), { kid: undefined })), CONFIG)).ok).toBe(false);
  });

  test('a tampered payload is refused', async () => {
    const { gate } = setup();
    const [head, , sig] = (await sign(main)).split('.');
    const forged = b64url(JSON.stringify(claims({ email: 'mallory@example.com' })));
    expect((await gate.check(withHeader(`${head}.${forged}.${sig}`), CONFIG)).ok).toBe(false);
  });

  test('a token signed by a key the team does not publish is refused', async () => {
    const { gate } = setup([main]);
    // Signed by another key, but naming the team's key id.
    expect((await gate.check(withHeader(await sign(other, claims(), { kid: main.kid })), CONFIG)).ok).toBe(false);
  });

  test('an unknown kid is refused; the keys are fetched once more, but not more often than every 30 s', async () => {
    const { gate, certs, clock } = setup([main]);
    expect((await gate.check(withHeader(await sign(main)), CONFIG)).ok).toBe(true);
    expect(certs.calls.length).toBe(1);
    // Just after a fetch: no second fetch.
    expect((await gate.check(withHeader(await sign(other)), CONFIG)).ok).toBe(false);
    expect(certs.calls.length).toBe(1);
    // Later: one more fetch, still no such key.
    clock.now += 31_000;
    expect((await gate.check(withHeader(await sign(other)), CONFIG)).ok).toBe(false);
    expect(certs.calls.length).toBe(2);
  });

  test('a key that came into use since the last fetch passes after one more fetch', async () => {
    const { gate, certs, clock } = setup([main]);
    expect((await gate.check(withHeader(await sign(main)), CONFIG)).ok).toBe(true);
    certs.signers = [main, other];
    clock.now += 31_000;
    expect((await gate.check(withHeader(await sign(other)), CONFIG)).ok).toBe(true);
    expect(certs.calls.length).toBe(2);
  });

  test('the keys are fetched again after 10 minutes', async () => {
    const { gate, certs, clock } = setup([main]);
    await gate.check(withHeader(await sign(main)), CONFIG);
    clock.now += 11 * 60_000;
    const token = await sign(main, claims({ exp: Math.floor(clock.now / 1000) + 3600 }));
    expect((await gate.check(withHeader(token), CONFIG)).ok).toBe(true);
    expect(certs.calls.length).toBe(2);
  });

  test('a failed key fetch is a refusal (fail closed)', async () => {
    const { gate, certs } = setup([main]);
    certs.fail = true;
    expect((await gate.check(withHeader(await sign(main)), CONFIG)).ok).toBe(false);
    const throwing = createGate({ fetch: async () => { throw new Error('offline'); }, now: () => NOW });
    expect((await throwing.check(withHeader(await sign(main)), CONFIG)).ok).toBe(false);
  });

  test('garbage is refused without a throw', async () => {
    const { gate } = setup();
    for (const token of ['x', 'a.b', 'a.b.c.d', '...', '%%%.%%%.%%%', 'eyJhbGciOiJSUzI1NiJ9.e30.a', 'A'.repeat(20_000)]) {
      expect((await gate.check(withHeader(token), CONFIG)).ok).toBe(false);
    }
  });

  test('a refusal reason never contains the token', async () => {
    const { gate } = setup();
    const token = await sign(main, claims({ aud: 'another-application' }));
    const verdict = await gate.check(withHeader(token), CONFIG);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).not.toContain(token.split('.')[1]!);
  });
});
