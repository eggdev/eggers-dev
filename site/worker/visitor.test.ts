// Tests for the visitor key (visitor.ts). The addresses are from the ranges set aside for documentation.
// Run from site/: `bun run test:worker`.
import { describe, expect, test } from 'bun:test';
import { UNKNOWN_VISITOR, visitorKey } from './visitor.ts';

describe('the visitor key', () => {
  test('an IPv4 address is the key as it is', () => {
    expect(visitorKey('203.0.113.7')).toBe('203.0.113.7');
    expect(visitorKey(' 198.51.100.200 ')).toBe('198.51.100.200');
  });

  test('a full IPv6 address becomes its /64', () => {
    expect(visitorKey('2001:0DB8:0001:0002:0003:0004:0005:0006')).toBe('2001:db8:1:2::/64');
    expect(visitorKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
  });

  test('a compressed IPv6 address is expanded first', () => {
    expect(visitorKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(visitorKey('2001:db8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(visitorKey('2001:db8:1::5:6')).toBe('2001:db8:1:0::/64');
    expect(visitorKey('::1')).toBe('0:0:0:0::/64');
    expect(visitorKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  test('every address in one /64 is one visitor; the next /64 is another', () => {
    const keys = ['2001:db8:5:6::1', '2001:db8:5:6:a:b:c:d', '2001:DB8:5:6:ffff::'].map(visitorKey);
    expect(new Set(keys)).toEqual(new Set(['2001:db8:5:6::/64']));
    expect(visitorKey('2001:db8:5:7::1')).not.toBe(keys[0]);
  });

  test('an IPv4-mapped IPv6 address is that IPv4 visitor', () => {
    expect(visitorKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(visitorKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(visitorKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  test('no address, or one that cannot be read, is "unknown"', () => {
    for (const bad of [null, '', '   ', 'nonsense', '256.1.1.1', '1.2.3', '1::2::3', '12345::', '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7', ':1:2:3:4:5:6:7', '::ffff:999.1.1.1', "x'); DROP TABLE questions; --"]) {
      expect(visitorKey(bad)).toBe(UNKNOWN_VISITOR);
    }
  });
});
