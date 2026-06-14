/* eslint-disable sonarjs/no-hardcoded-ip -- test fixtures: example.com's public IPv4/IPv6 addresses, used to exercise IPv4-pin selection */
// Regression tests for the /api/faa-cam-analyze SSRF DNS-rebinding TOCTOU fix.
// isSafeUrl() resolves + validates the image URL's hostname, but the route then
// fetched the same hostname WITHOUT pinning the validated IP — so a hostile DNS
// could rebind the public-passing hostname to a private IP between the check and
// the fetch. fetchWithTimeout already supports pinning via options.resolvedAddress;
// pickPinnedIpv4() selects the validated IPv4 to feed it, closing the window.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { pickPinnedIpv4 } from '../local-api-server.mjs';

test('returns the single resolved IPv4 from a safe verdict', () => {
  assert.equal(pickPinnedIpv4({ safe: true, resolvedAddresses: ['93.184.216.34'] }), '93.184.216.34');
});

test('prefers IPv4 and skips IPv6 when both are present', () => {
  assert.equal(
    pickPinnedIpv4({ safe: true, resolvedAddresses: ['2606:2800:220:1:248:1893:25c8:1946', '93.184.216.34'] }),
    '93.184.216.34',
  );
});

test('returns null for an IPv6-only verdict (fetchWithTimeout is IPv4-forcing)', () => {
  assert.equal(pickPinnedIpv4({ safe: true, resolvedAddresses: ['2606:2800:220:1:248:1893:25c8:1946'] }), null);
});

test('returns null for an unsafe verdict so we never pin an unvalidated IP', () => {
  assert.equal(pickPinnedIpv4({ safe: false, reason: 'private IP' }), null);
});

test('returns null when resolvedAddresses is missing or empty', () => {
  assert.equal(pickPinnedIpv4({ safe: true }), null);
  assert.equal(pickPinnedIpv4({ safe: true, resolvedAddresses: [] }), null);
});

test('returns null for nullish / malformed input', () => {
  assert.equal(pickPinnedIpv4(null), null);
  assert.equal(pickPinnedIpv4(undefined), null);
  assert.equal(pickPinnedIpv4({}), null);
});
