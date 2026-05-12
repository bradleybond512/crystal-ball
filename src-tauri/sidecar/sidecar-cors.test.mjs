/* eslint-disable no-restricted-syntax, sonarjs/no-clear-text-protocols --
 * Test fixtures for the sidecar CORS allowlist. Both `localhost` and `http://`
 * forms appear here on purpose — the whole point is to assert the allowlist
 * handles each form correctly. The runtime code does not introduce these
 * strings into the network path; they are inputs to the validator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSidecarOriginAllowed } from './local-api-server.mjs';

// ── Allowed origins ─────────────────────────────────────────────────────────

test('CORS: tauri webview origins are allowed', () => {
  for (const origin of [
    'tauri://localhost',
    'asset://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'https://preview-xyz.tauri.localhost',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), true, origin);
  }
});

test('CORS: enumerated production hosts are allowed', () => {
  for (const origin of [
    'https://crystalball.app',
    'https://tech.crystalball.app',
    'https://finance.crystalball.app',
    'https://happy.crystalball.app',
    'https://api.crystalball.app',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), true, origin);
  }
});

test('CORS: known dev-server ports on localhost are allowed', () => {
  for (const origin of [
    'http://localhost',                // port 80 (bare)
    'http://localhost:3000',           // Vite full/tech/finance
    'http://localhost:1420',           // Tauri dev preview
    'http://localhost:5173',           // Vite alt default
    'http://localhost:46123',          // sidecar self-origin
    'http://127.0.0.1:3000',
    'https://127.0.0.1:46123',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), true, origin);
  }
});

// ── Denied origins ──────────────────────────────────────────────────────────

test('CORS: empty / missing origin is denied', () => {
  assert.equal(isSidecarOriginAllowed(''), false);
  assert.equal(isSidecarOriginAllowed(null), false);
  assert.equal(isSidecarOriginAllowed(undefined), false);
});

test('CORS: unrelated crystalball.app subdomains are denied (no glob match)', () => {
  // The previous regex accepted any single-level subdomain. Verify these
  // explicitly fail under the enumerated allowlist.
  for (const origin of [
    'https://attacker.crystalball.app',
    'https://preview-xyz.crystalball.app',
    'https://internal.crystalball.app',
    // Suffix-spoofing attempts that the regex would have caught anyway.
    'https://crystalballEVIL.app',
    'https://evil-crystalball.app',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), false, origin);
  }
});

test('CORS: unknown localhost ports are denied (port allowlist)', () => {
  for (const origin of [
    'http://localhost:8080',
    'http://localhost:9000',
    'http://localhost:2222',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:65535',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), false, origin);
  }
});

test('CORS: foreign LAN / public IPs are denied even when they look like localhost', () => {
  for (const origin of [
    'http://10.0.0.1',
    'http://10.0.0.1:3000',
    'http://192.168.1.5:3000',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), false, origin);
  }
});

test('CORS: non-https variants of prod hosts are denied', () => {
  for (const origin of [
    'http://crystalball.app',
    'http://tech.crystalball.app',
  ]) {
    assert.equal(isSidecarOriginAllowed(origin), false, origin);
  }
});

test('CORS: there is no CORS_ALLOW_ALL fallback', () => {
  // Setting any plausible wildcard env var must NOT relax the allowlist.
  const before = {
    CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL,
    ALLOW_ALL_ORIGINS: process.env.ALLOW_ALL_ORIGINS,
  };
  process.env.CORS_ALLOW_ALL = '1';
  process.env.ALLOW_ALL_ORIGINS = 'true';
  try {
    assert.equal(isSidecarOriginAllowed('https://attacker.example.com'), false);
    assert.equal(isSidecarOriginAllowed('http://localhost:8080'), false);
  } finally {
    if (before.CORS_ALLOW_ALL === undefined) delete process.env.CORS_ALLOW_ALL;
    else process.env.CORS_ALLOW_ALL = before.CORS_ALLOW_ALL;
    if (before.ALLOW_ALL_ORIGINS === undefined) delete process.env.ALLOW_ALL_ORIGINS;
    else process.env.ALLOW_ALL_ORIGINS = before.ALLOW_ALL_ORIGINS;
  }
});
