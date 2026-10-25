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

// Exercise the actual pure CORS declarations/function without starting the relay.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const source = readFileSync(path.join(__dirname, 'ais-relay.cjs'), 'utf8');
const declarations = [
  source.match(/const ALLOWED_ORIGINS = \[[\s\S]*?^\];/m)?.[0],
  source.match(/const ALLOWED_PREVIEW_PATTERNS = \[[\s\S]*?^\];/m)?.[0],
  source.match(/function getCorsOrigin\(req\) \{[\s\S]*?^\}/m)?.[0],
];
assert.ok(declarations.every(Boolean), 'relay CORS source declarations must be found');
function getCorsOrigin(origin, allowVercelPreview) {
  return runInNewContext(`${declarations.join('\n')}\ngetCorsOrigin(req)`, {
    ALLOW_VERCEL_PREVIEW_ORIGINS: allowVercelPreview,
    req: { headers: { origin } },
  });
}

test('relay CORS: rejects every retired public origin', () => {
  for (const origin of [
    'https://crystalball.app', 'https://tech.crystalball.app',
    'https://finance.crystalball.app', 'https://happy.crystalball.app',
    'https://api.crystalball.app', 'https://CRYSTALBALL.APP.',
  ]) {
    assert.equal(getCorsOrigin(origin, false), '', origin);
    assert.equal(getCorsOrigin(origin, true), '', origin);
  }
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
