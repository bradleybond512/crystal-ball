/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/no-clear-text-protocols, no-restricted-syntax -- an SSRF host-classification test needs hardcoded IPs, http:// URLs, and localhost as fixtures */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isPrivateIP, isDangerousProbeHost } from '../local-api-server.mjs';

// SSRF guard: isPrivateIP must reject every private/reserved address, including
// the IPv6 transition/translation forms that wrap a private/metadata IPv4 — a
// hostile AAAA record resolving to one of these previously slipped past.

test('public addresses are allowed (not private)', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPrivateIP(ip), false, `${ip} should be public`);
  }
});

test('IPv4 private / reserved ranges are rejected', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateIP(ip), true, `${ip} should be private/reserved`);
  }
});

test('plain IPv6 loopback / ULA / link-local are rejected', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '[::1]', 'fe80::1%en0']) {
    assert.equal(isPrivateIP(ip), true, `${ip} should be private`);
  }
});

test('IPv6 transition forms wrapping a private/metadata IPv4 are rejected', () => {
  for (const ip of [
    '::ffff:127.0.0.1',        // IPv4-mapped, dotted
    '::ffff:169.254.169.254',  // IPv4-mapped, dotted (cloud metadata)
    '::ffff:7f00:0001',        // IPv4-mapped, hex (= 127.0.0.1)
    '::ffff:a9fe:a9fe',        // IPv4-mapped, hex (= 169.254.169.254)
    '::127.0.0.1',             // IPv4-compatible (deprecated)
    '64:ff9b::1',              // NAT64 prefix
    '64:ff9b::169.254.169.254',// NAT64 wrapping metadata
    '2002:7f00:0001::1',       // 6to4 wrapping 127.0.0.1
  ]) {
    assert.equal(isPrivateIP(ip), true, `${ip} should be rejected as private/reserved`);
  }
});

test('public IPv6 is still allowed', () => {
  assert.equal(isPrivateIP('2606:4700::1'), false);
  assert.equal(isPrivateIP('2a00:1450:4001:81b::200e'), false);
});

// isDangerousProbeHost: for user-run local-service probes (Ollama / relays),
// loopback + LAN are allowed but metadata / unspecified / multicast are refused.
test('isDangerousProbeHost ALLOWS legitimate local-service hosts', () => {
  for (const u of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://10.0.0.5:8080',
    'http://192.168.1.50:3000', 'https://relay.example.com', 'wss://opensky.example.org/ws']) {
    assert.equal(isDangerousProbeHost(u), false, `${u} should be allowed`);
  }
});

test('isDangerousProbeHost REJECTS metadata / unspecified / multicast', () => {
  for (const u of ['http://169.254.169.254/latest/meta-data', 'http://169.254.169.254',
    'http://0.0.0.0:80', 'http://[::]:80', 'http://224.0.0.1', 'http://239.255.255.250', 'not a url']) {
    assert.equal(isDangerousProbeHost(u), true, `${u} should be refused`);
  }
});
