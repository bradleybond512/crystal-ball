/**
 * Pure-helper tests for the S2U TAK Marti client. The HTTPS request
 * function (takFetchJson) requires a live TLS server and is exercised
 * indirectly via the panel smoke tests; this file pins only the
 * deterministic helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  S2U_TAK_PINNED_FINGERPRINT_SHA256,
  buildBasicAuthHeader,
  buildMartiUrl,
  fingerprintsMatch,
  normalizeFingerprint,
  shapeClientEndpointsResponse,
  shapeFeedsResponse,
  shapePackageSearchResponse,
} from './s2u-tak-client.mjs';

// ── Fingerprint helpers ────────────────────────────────────────────────

test('S2U_TAK_PINNED_FINGERPRINT_SHA256 is 32 hex bytes', () => {
  const parts = S2U_TAK_PINNED_FINGERPRINT_SHA256.split(':');
  assert.equal(parts.length, 32, 'SHA-256 has 32 bytes');
  for (const part of parts) {
    assert.match(part, /^[0-9A-F]{2}$/, `byte ${part} must be 2 hex chars upper`);
  }
});

test('normalizeFingerprint: handles SHA256: prefix', () => {
  assert.equal(
    normalizeFingerprint('SHA256:8b:7d:d7'),
    '8B:7D:D7',
  );
});

test('normalizeFingerprint: tolerates no separators', () => {
  assert.equal(normalizeFingerprint('8b7dd7'), '8B:7D:D7');
});

test('normalizeFingerprint: bad input returns empty', () => {
  assert.equal(normalizeFingerprint(undefined), '');
  assert.equal(normalizeFingerprint(null), '');
  assert.equal(normalizeFingerprint(42), '');
});

test('fingerprintsMatch: identical byte sequences match', () => {
  assert.equal(fingerprintsMatch(S2U_TAK_PINNED_FINGERPRINT_SHA256, S2U_TAK_PINNED_FINGERPRINT_SHA256), true);
});

test('fingerprintsMatch: different format same bytes still match', () => {
  const lower = S2U_TAK_PINNED_FINGERPRINT_SHA256.toLowerCase();
  assert.equal(fingerprintsMatch(S2U_TAK_PINNED_FINGERPRINT_SHA256, lower), true);
});

test('fingerprintsMatch: one-byte difference rejected', () => {
  const tampered = S2U_TAK_PINNED_FINGERPRINT_SHA256.replace(/^8B/, '00');
  assert.equal(fingerprintsMatch(S2U_TAK_PINNED_FINGERPRINT_SHA256, tampered), false);
});

test('fingerprintsMatch: empty inputs rejected', () => {
  assert.equal(fingerprintsMatch('', S2U_TAK_PINNED_FINGERPRINT_SHA256), false);
  assert.equal(fingerprintsMatch(S2U_TAK_PINNED_FINGERPRINT_SHA256, ''), false);
});

// ── Basic auth ─────────────────────────────────────────────────────────

test('buildBasicAuthHeader: returns null when creds missing', () => {
  assert.equal(buildBasicAuthHeader('', 'pw'), null);
  assert.equal(buildBasicAuthHeader('user', ''), null);
  assert.equal(buildBasicAuthHeader(null, null), null);
});

test('buildBasicAuthHeader: encodes user:pass with Basic prefix', () => {
  const out = buildBasicAuthHeader('alice', 'secret');
  assert.equal(out, 'Basic ' + Buffer.from('alice:secret', 'utf8').toString('base64'));
});

// ── URL builder ────────────────────────────────────────────────────────

test('buildMartiUrl: trims trailing slash + ensures leading slash on path', () => {
  assert.equal(
    buildMartiUrl('https://ghostmaps.example:8443/', '/Marti/api/feeds'),
    'https://ghostmaps.example:8443/Marti/api/feeds',
  );
  assert.equal(
    buildMartiUrl('https://ghostmaps.example:8443', 'Marti/api/feeds'),
    'https://ghostmaps.example:8443/Marti/api/feeds',
  );
});

test('buildMartiUrl: returns null when base is missing', () => {
  assert.equal(buildMartiUrl('', '/Marti/api/feeds'), null);
});

// ── Response shaping ───────────────────────────────────────────────────

test('shapeFeedsResponse: handles direct array', () => {
  const out = shapeFeedsResponse([
    { uuid: 'a', name: 'Wire', type: 'kml', address: 'wire.kml', protocol: 'https', auth: 'basic' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].uuid, 'a');
});

test('shapeFeedsResponse: handles { data: [...] } envelope', () => {
  const out = shapeFeedsResponse({ data: [{ uuid: 'b', name: 'X' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].uuid, 'b');
});

test('shapeFeedsResponse: drops entries with no uuid AND no name', () => {
  const out = shapeFeedsResponse([{ junk: 1 }]);
  assert.equal(out.length, 0);
});

test('shapeFeedsResponse: empty / null input returns []', () => {
  assert.deepEqual(shapeFeedsResponse(null), []);
  assert.deepEqual(shapeFeedsResponse(undefined), []);
  assert.deepEqual(shapeFeedsResponse([]), []);
});

test('shapeFeedsResponse: tolerates UUID vs uuid casing', () => {
  const out = shapeFeedsResponse([{ UUID: 'upper', name: 'X' }]);
  assert.equal(out[0].uuid, 'upper');
});

test('shapeClientEndpointsResponse: shapes active users', () => {
  const out = shapeClientEndpointsResponse([
    { callsign: 'ALPHA-1', uid: 'uid-1', username: 'alice', lastEventTime: '2026-05-05T00:00:00Z' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].callsign, 'ALPHA-1');
});

test('shapePackageSearchResponse: prefers .results over .data', () => {
  const out = shapePackageSearchResponse({
    results: [{ Hash: 'h1', Name: 'package.zip', SubmissionUser: 'u', Keywords: ['public'], SubmissionDateTime: 't' }],
    data: [{ Hash: 'wrong', Name: 'wrong' }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].hash, 'h1');
});

test('shapePackageSearchResponse: tolerates lowercase fields', () => {
  const out = shapePackageSearchResponse([{ hash: 'h2', name: 'p2', keywords: ['a'] }]);
  assert.equal(out[0].hash, 'h2');
  assert.deepEqual(out[0].keywords, ['a']);
});

// ── JSON serializability ───────────────────────────────────────────────

test('shaped responses are JSON-serializable', () => {
  const feed = shapeFeedsResponse([{ uuid: 'a', name: 'n' }])[0];
  const round = structuredClone(feed);
  assert.equal(round.uuid, 'a');
});
