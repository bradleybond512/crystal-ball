import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidIp,
  parseIpInfoResponse,
  ipInfoCacheKey,
  crossReferenceThreats,
  recordHistory,
  KNOWN_BAD_ACTOR_ASNS,
  type IpInfo,
  type HistoryEntry,
} from '../ipinfo-service.ts';

// ── IP validation ────────────────────────────────────────────────────

test('isValidIp: accepts well-formed IPv4', () => {
  for (const ip of ['8.8.8.8', '127.0.0.1', '192.168.1.1', '255.255.255.255']) {
    assert.equal(isValidIp(ip), true, ip);
  }
});

test('isValidIp: rejects malformed IPv4', () => {
  for (const ip of ['8.8.8', '8.8.8.', '256.0.0.1', '1.2.3.4.5', 'foo']) {
    assert.equal(isValidIp(ip), false, ip);
  }
});

test('isValidIp: accepts IPv6 (compressed + full)', () => {
  for (const ip of ['::1', '2001:db8::1', 'fe80::1ff:fe23:4567:890a']) {
    assert.equal(isValidIp(ip), true, ip);
  }
});

test('isValidIp: rejects empty / whitespace', () => {
  assert.equal(isValidIp(''), false);
  assert.equal(isValidIp('   '), false);
});

// ── Response parsing ─────────────────────────────────────────────────

test('parseIpInfoResponse: typical ipinfo response → IpInfo with ASN split', () => {
  const out = parseIpInfoResponse({
    ip: '8.8.8.8',
    hostname: 'dns.google',
    city: 'Mountain View',
    region: 'California',
    country: 'US',
    loc: '37.4056,-122.0775',
    org: 'AS15169 Google LLC',
    postal: '94043',
    timezone: 'America/Los_Angeles',
    anycast: true,
  });
  assert.ok(out);
  assert.equal(out!.ip, '8.8.8.8');
  assert.equal(out!.countryCode, 'US');
  assert.equal(out!.asn, 'AS15169');
  assert.equal(out!.orgName, 'Google LLC');
  assert.equal(out!.lat, 37.4056);
  assert.equal(out!.lon, -122.0775);
  assert.equal(out!.anycast, true);
});

test('parseIpInfoResponse: missing ip → null', () => {
  assert.equal(parseIpInfoResponse({ city: 'Nowhere' }), null);
  assert.equal(parseIpInfoResponse(null), null);
  assert.equal(parseIpInfoResponse('not an object'), null);
});

test('parseIpInfoResponse: org without leading ASN preserved as orgName', () => {
  const out = parseIpInfoResponse({ ip: '1.2.3.4', org: 'ExampleNet' });
  assert.equal(out!.asn, undefined);
  assert.equal(out!.orgName, 'ExampleNet');
});

test('parseIpInfoResponse: malformed loc tolerated (lat/lon undefined)', () => {
  const out = parseIpInfoResponse({ ip: '1.2.3.4', loc: 'not-a-pair' });
  assert.equal(out!.lat, undefined);
  assert.equal(out!.lon, undefined);
});

test('parseIpInfoResponse: bogon flag carried through', () => {
  const out = parseIpInfoResponse({ ip: '10.0.0.1', bogon: true });
  assert.equal(out!.bogon, true);
});

// ── Cache key ────────────────────────────────────────────────────────

test('ipInfoCacheKey: case-insensitive + trimmed', () => {
  assert.equal(ipInfoCacheKey('  8.8.8.8  '), 'ipinfo:8.8.8.8');
  assert.equal(ipInfoCacheKey('2001:DB8::1'), 'ipinfo:2001:db8::1');
});

// ── Threat context ───────────────────────────────────────────────────

test('crossReferenceThreats: flags known bad-actor ASN', () => {
  const info: IpInfo = { ip: '1.2.3.4', asn: 'AS200651', orgName: 'Flokinet' };
  const ctx = crossReferenceThreats(info);
  assert.equal(ctx.knownBadActor, true);
  assert.match(ctx.notes[0]!, /AS200651/);
});

test('crossReferenceThreats: clean ASN passes', () => {
  const info: IpInfo = { ip: '1.2.3.4', asn: 'AS15169', orgName: 'Google LLC' };
  const ctx = crossReferenceThreats(info);
  assert.equal(ctx.knownBadActor, false);
  assert.equal(ctx.notes.length, 0);
});

test('crossReferenceThreats: bogon + anycast notes added', () => {
  const info: IpInfo = { ip: '10.0.0.1', bogon: true, anycast: true };
  const ctx = crossReferenceThreats(info);
  const joined = ctx.notes.join(' | ');
  assert.match(joined, /bogon/);
  assert.match(joined, /anycast/);
});

test('crossReferenceThreats: caller-provided list overrides default', () => {
  const info: IpInfo = { ip: '1.2.3.4', asn: 'AS15169', orgName: 'Google LLC' };
  const ctx = crossReferenceThreats(info, { knownBadAsns: new Set(['AS15169']) });
  assert.equal(ctx.knownBadActor, true);
});

test('KNOWN_BAD_ACTOR_ASNS: every entry matches AS<digits>', () => {
  for (const asn of KNOWN_BAD_ACTOR_ASNS) {
    assert.match(asn, /^AS\d+$/);
  }
});

// ── History store ────────────────────────────────────────────────────

test('recordHistory: dedupes by IP, prepends newest', () => {
  const list: HistoryEntry[] = [
    { ip: '1.1.1.1', at: 1 },
    { ip: '8.8.8.8', at: 2 },
  ];
  const next = recordHistory({ ip: '8.8.8.8', at: 3 }, list);
  assert.equal(next.length, 2);
  assert.equal(next[0]!.ip, '8.8.8.8');
  assert.equal(next[0]!.at, 3);
});

test('recordHistory: caps at 20 entries', () => {
  const big: HistoryEntry[] = Array.from({ length: 25 }, (_, i) => ({ ip: `10.0.0.${i}`, at: i }));
  const next = recordHistory({ ip: '8.8.8.8', at: 100 }, big);
  assert.equal(next.length, 20);
  assert.equal(next[0]!.ip, '8.8.8.8');
});
