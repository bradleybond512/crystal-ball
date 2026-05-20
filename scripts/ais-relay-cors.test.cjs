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

// Owner-anchored patterns — kept in sync with ais-relay.cjs ALLOWED_PREVIEW_PATTERNS.
// Requires crystalball-/crystal-ball- prefix AND a known owner slug.
const ALLOWED_PREVIEW_PATTERNS = [
  /^https:\/\/crystalball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  /^https:\/\/crystal-ball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  /^https:\/\/crystalball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
  /^https:\/\/crystal-ball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
];

function getCorsOrigin(origin, allowVercelPreview) {
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (allowVercelPreview && ALLOWED_PREVIEW_PATTERNS.some(p => p.test(origin))) return origin;
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

test('relay CORS: accepts owner-anchored preview origins when flag enabled', () => {
  const valid = [
    'https://crystalball-my-branch-bradleybond512.vercel.app',
    'https://crystal-ball-fix-123-bradleybond512.vercel.app',
    'https://crystalball-pr-42-elie-abc123.vercel.app',
    'https://crystal-ball-feature-elie-xyz.vercel.app',
  ];
  for (const origin of valid) {
    assert.equal(getCorsOrigin(origin, true), origin, `should accept ${origin}`);
  }
});

test('relay CORS: rejects lookalike vercel origins even when flag enabled (R2-SEC-006)', () => {
  const invalid = [
    // Missing crystalball-/crystal-ball- prefix
    'https://abc123-bradleybond512.vercel.app',
    'https://deploy-hash-bradleybond512.vercel.app',
    // Wrong owner slug
    'https://crystalball-my-branch-otherperson.vercel.app',
    'https://crystalball-evilorg.vercel.app',
    'https://evil.vercel.app',
    // Protocol tricks
    'http://crystalball-branch-bradleybond512.vercel.app',
    // Suffix forgery
    'https://crystalball-attack-bradleybond512x.vercel.app',
    // Lookalike domain
    'https://crystalball-bradleybond512.evil.com',
  ];
  for (const origin of invalid) {
    assert.equal(getCorsOrigin(origin, true), '', `should reject ${origin}`);
  }
});

test('relay CORS: rejects empty or missing origin', () => {
  assert.equal(getCorsOrigin('', false), '');
  assert.equal(getCorsOrigin('', true), '');
});
