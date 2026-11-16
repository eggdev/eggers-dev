// The visitor key: one name for "the same visitor", used by the per-visitor limit (ASK_LIMIT) and by the visitor's
// daily share (budget.ts). It is made from the address Cloudflare reports (the cf-connecting-ip header):
//   - an IPv4 address: the address itself, such as 203.0.113.7;
//   - an IPv6 address: its /64 network, such as 2001:db8:1:2::/64. One home or server usually holds a whole /64,
//     so each of its addresses must not count as a new visitor;
//   - an IPv4 address written as IPv6 (::ffff:203.0.113.7): the IPv4 address;
//   - no address, or one that cannot be read: "unknown", which all such requests share.
// This file has no Cloudflare imports, so `bun test` can run it.

export const UNKNOWN_VISITOR = 'unknown';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const GROUP = /^[0-9a-f]{1,4}$/;

/** The IPv4 address in its usual form, or null when `text` is not one. */
function ipv4(text: string): string | null {
  const m = IPV4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n <= 255) ? parts.join('.') : null;
}

/** The eight 16-bit groups of an IPv6 address, or null when `text` is not one. */
function ipv6Groups(text: string): number[] | null {
  let rest = text.toLowerCase();
  // An embedded IPv4 address at the end (::ffff:1.2.3.4) is the last two groups.
  const tail: number[] = [];
  const lastColon = rest.lastIndexOf(':');
  if (lastColon !== -1 && rest.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4(rest.slice(lastColon + 1));
    if (v4 === null) return null;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    tail.push((a << 8) | b, (c << 8) | d);
    // "…:1.2.3.4" becomes "…", and "…::1.2.3.4" becomes "…::".
    rest = rest.slice(0, lastColon + 1);
    if (!rest.endsWith('::')) rest = rest.slice(0, -1);
  }
  const halves = rest.split('::');
  if (halves.length > 2) return null;
  const read = (part: string) => (part === '' ? [] : part.split(':'));
  const left = read(halves[0]!);
  const right = halves.length === 2 ? read(halves[1]!) : [];
  if (![...left, ...right].every(g => GROUP.test(g))) return null;
  const given = left.length + right.length + tail.length;
  if (halves.length === 1 ? given !== 8 : given > 7) return null;
  const zeros = Array<number>(8 - given).fill(0);
  return [...left.map(g => parseInt(g, 16)), ...zeros, ...right.map(g => parseInt(g, 16)), ...tail];
}

/** The visitor key for the address in the cf-connecting-ip header (null when the header is missing). */
export function visitorKey(address: string | null): string {
  const text = (address ?? '').trim();
  if (text === '') return UNKNOWN_VISITOR;
  const v4 = ipv4(text);
  if (v4 !== null) return v4;
  if (!text.includes(':')) return UNKNOWN_VISITOR;
  const groups = ipv6Groups(text.split('%')[0]!);
  if (groups === null) return UNKNOWN_VISITOR;
  // An IPv4-mapped address (::ffff:a.b.c.d) is that IPv4 visitor.
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map(g => g.toString(16)).join(':')}::/64`;
}
