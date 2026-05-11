import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSatoshisAsBtc,
  isPlausibleBtcAddress,
  normalizeCategory,
  parseScamAddressesResponse,
  parseScamDomainsResponse,
  truncateAddress,
} from '../bitcoin-abuse-service.ts';

// ── normalizeCategory ──────────────────────────────────────────────────

test('normalizeCategory: ransomware variants', () => {
  assert.equal(normalizeCategory('Ransomware'), 'ransomware');
  assert.equal(normalizeCategory('REvil ransomware payment'), 'ransomware');
});

test('normalizeCategory: scam / fraud / phishing / mixer / darknet / mining buckets', () => {
  assert.equal(normalizeCategory('Phishing site'), 'phishing');
  assert.equal(normalizeCategory('Bitcoin mixer'), 'mixer');
  assert.equal(normalizeCategory('Darknet market'), 'darknet');
  assert.equal(normalizeCategory('Bitcoin Mining Scam'), 'mining'); // 'mining' wins (most specific)
  assert.equal(normalizeCategory('Fake exchange fraud'), 'scam');
});

test('normalizeCategory: unknown / non-string falls back to "other"', () => {
  assert.equal(normalizeCategory('something weird'), 'other');
  assert.equal(normalizeCategory(undefined), 'other');
  assert.equal(normalizeCategory(42), 'other');
});

// ── parseScamAddressesResponse ─────────────────────────────────────────

test('parseScamAddressesResponse: array form parses all records', () => {
  const out = parseScamAddressesResponse({
    success: true,
    result: [
      { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', subcategory: 'Ransomware', reports: 12 },
      { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', subcategory: 'Phishing', reports: 3 },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0]!.address, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  assert.equal(out[0]!.category, 'ransomware');
  assert.equal(out[0]!.reportCount, 12);
});

test('parseScamAddressesResponse: object-keyed (legacy) form parses records', () => {
  const out = parseScamAddressesResponse({
    success: true,
    result: {
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': { subcategory: 'Scam', reports: 5 },
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.address, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
});

test('parseScamAddressesResponse: drops non-BTC coins', () => {
  const out = parseScamAddressesResponse({
    result: [
      { address: '0xabc', coin: 'ETH', subcategory: 'Scam' },
      { address: '1ABC', coin: 'BTC', subcategory: 'Scam' },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.address, '1ABC');
});

test('parseScamAddressesResponse: missing reports defaults to 1', () => {
  const out = parseScamAddressesResponse({
    result: [{ address: '1ABC', subcategory: 'Scam' }],
  });
  assert.equal(out[0]!.reportCount, 1);
});

test('parseScamAddressesResponse: malformed → empty array', () => {
  assert.deepEqual(parseScamAddressesResponse(null), []);
  assert.deepEqual(parseScamAddressesResponse('not json'), []);
  assert.deepEqual(parseScamAddressesResponse({}), []);
});

// ── parseScamDomainsResponse ───────────────────────────────────────────

test('parseScamDomainsResponse: strips protocol + trailing slash', () => {
  const out = parseScamDomainsResponse({
    result: [{ url: 'https://example-scam.com/', subcategory: 'Phishing', status: 'Active' }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.domain, 'example-scam.com');
  assert.equal(out[0]!.status, 'active');
  assert.equal(out[0]!.category, 'phishing');
});

test('parseScamDomainsResponse: status normalises offline / dead / unknown', () => {
  const out = parseScamDomainsResponse({
    result: [
      { url: 'a.com', status: 'Offline' },
      { url: 'b.com', status: 'dead' },
      { url: 'c.com', status: 'something weird' },
    ],
  });
  assert.equal(out[0]!.status, 'inactive');
  assert.equal(out[1]!.status, 'inactive');
  assert.equal(out[2]!.status, 'unknown');
});

// ── isPlausibleBtcAddress ──────────────────────────────────────────────

test('isPlausibleBtcAddress: accepts legacy + P2SH + bech32', () => {
  assert.ok(isPlausibleBtcAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'));
  assert.ok(isPlausibleBtcAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'));
  assert.ok(isPlausibleBtcAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'));
});

test('isPlausibleBtcAddress: rejects ETH addresses + obvious typos', () => {
  assert.equal(isPlausibleBtcAddress('0x742d35Cc6634C0532925a3b8D40Eaa4cb04D3F73'), false);
  assert.equal(isPlausibleBtcAddress('not-an-address'), false);
  assert.equal(isPlausibleBtcAddress(''), false);
  assert.equal(isPlausibleBtcAddress('1' + 'A'.repeat(120)), false);
});

// ── formatting helpers ─────────────────────────────────────────────────

test('truncateAddress: middle ellipsis with default 6+6', () => {
  assert.equal(
    truncateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'),
    '1A1zP1…DivfNa',
  );
});

test('truncateAddress: short addresses pass through', () => {
  assert.equal(truncateAddress('1ABC'), '1ABC');
});

test('formatSatoshisAsBtc: converts to 8-decimal BTC', () => {
  assert.equal(formatSatoshisAsBtc(123_456_789), '1.23456789 BTC');
  assert.equal(formatSatoshisAsBtc(0), '0.00000000 BTC');
  assert.equal(formatSatoshisAsBtc(null), '—');
});
