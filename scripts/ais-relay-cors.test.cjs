/**
 * R2-SEC-006: Relay CORS origin allowlist regression tests.
 *
 * Tests that the owner-anchored Vercel preview pattern only accepts
 * bradleybond512 previews and rejects lookalike third-party projects.
 *
 * Run: node --test scripts/ais-relay-cors.test.cjs
 */
'use strict';

const { strict: assert } = require('node:assert');
const test = require('node:test');

// Replicate the getCorsOrigin logic from ais-relay.cjs so tests don't spin up
// the full server. Keep this in sync with the regex in scripts/ais-relay.cjs.
const ALLOWED_ORIGINS = [
  'https://crystalball.app',
  'https://tech.crystalball.app',
  'https://finance.crystalball.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://localhost',
  'tauri://localhost',
];

// Matches the pattern in ais-relay.cjs getCorsOrigin
const VERCEL_PREVIEW_RE = /^https:\/\/[a-z0-9-]+-bradleybond512\.vercel\.app$/;

function getCorsOrigin(origin, allowVercelPreview) {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (allowVercelPreview && VERCEL_PREVIEW_RE.test(origin)) return origin;
  return '';
}

test('relay CORS: accepts production origins', () => {
  assert.equal(getCorsOrigin('https://crystalball.app', false), 'https://crystalball.app');
  assert.equal(getCorsOrigin('https://tech.crystalball.app', false), 'https://tech.crystalball.app');
  assert.equal(getCorsOrigin('https://finance.crystalball.app', false), 'https://finance.crystalball.app');
});

test('relay CORS: accepts localhost dev origins', () => {
  assert.equal(getCorsOrigin('http://localhost:5173', false), 'http://localhost:5173');
  assert.equal(getCorsOrigin('tauri://localhost', false), 'tauri://localhost');
});

test('relay CORS: rejects unknown origin when preview flag off', () => {
  assert.equal(getCorsOrigin('https://abc123-bradleybond512.vercel.app', false), '');
  assert.equal(getCorsOrigin('https://evil.example.com', false), '');
});

test('relay CORS: accepts owner-anchored preview origin when flag enabled', () => {
  assert.equal(
    getCorsOrigin('https://abc123-bradleybond512.vercel.app', true),
    'https://abc123-bradleybond512.vercel.app',
  );
  assert.equal(
    getCorsOrigin('https://deploy-hash-abc123-bradleybond512.vercel.app', true),
    'https://deploy-hash-abc123-bradleybond512.vercel.app',
  );
});

test('relay CORS: rejects lookalike vercel origins even when flag enabled (R2-SEC-006)', () => {
  // Any .vercel.app that is NOT pinned to bradleybond512 must be rejected
  assert.equal(getCorsOrigin('https://crystalball-attacker.vercel.app', true), '');
  assert.equal(getCorsOrigin('https://abc123-otherperson.vercel.app', true), '');
  assert.equal(getCorsOrigin('https://evil.vercel.app', true), '');
  // Must not allow bradleybond512-suffix trickery from another account
  assert.equal(getCorsOrigin('https://attack-bradleybond512x.vercel.app', true), '');
  // Must require https:
  assert.equal(getCorsOrigin('http://abc-bradleybond512.vercel.app', true), '');
});

test('relay CORS: rejects empty or missing origin', () => {
  assert.equal(getCorsOrigin('', false), '');
  assert.equal(getCorsOrigin('', true), '');
});
