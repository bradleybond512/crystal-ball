import { strict as assert } from 'node:assert';
import test from 'node:test';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

function makeRequest(origin) {
  const headers = new Headers();
  if (origin !== null) {
 headers.set('origin', origin);
  }
  return new Request('https://crystalball.app/api/test', { headers });
}

test('allows desktop Tauri origins', () => {
  const origins = [
 'https://tauri.localhost',
 'https://abc123.tauri.localhost',
 'tauri://localhost',
 'asset://localhost',
 'http://127.0.0.1:46123',
  ];

  for (const origin of origins) {
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), false, `origin should be allowed: ${origin}`);
 const cors = getCorsHeaders(req);
 assert.equal(cors['Access-Control-Allow-Origin'], origin);
  }
});

test('rejects unrelated external origins', () => {
  const req = makeRequest('https://evil.example.com');
  assert.equal(isDisallowedOrigin(req), true);
  const cors = getCorsHeaders(req);
  assert.equal(cors['Access-Control-Allow-Origin'], 'https://crystalball.app');
});

test('requests without origin remain allowed', () => {
  const req = makeRequest(null);
  assert.equal(isDisallowedOrigin(req), false);
});

test('allows enumerated crystalball.app subdomains', () => {
  const subdomains = ['tech', 'finance', 'happy', 'api'];
  for (const sub of subdomains) {
 const origin = `https://${sub}.crystalball.app`;
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), false, `subdomain should be allowed: ${sub}`);
 const cors = getCorsHeaders(req);
 assert.equal(cors['Access-Control-Allow-Origin'], origin);
  }
});

test('allows bare crystalball.app origin', () => {
  const origin = 'https://crystalball.app';
  const req = makeRequest(origin);
  assert.equal(isDisallowedOrigin(req), false);
  const cors = getCorsHeaders(req);
  assert.equal(cors['Access-Control-Allow-Origin'], origin);
});

test('rejects non-enumerated crystalball.app subdomains', () => {
  const bad = [
 'https://evil.crystalball.app',
 'https://admin.crystalball.app',
 'https://www.crystalball.app',
  ];
  for (const origin of bad) {
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), true, `subdomain should be rejected: ${origin}`);
  }
});

test('allows Vercel preview deploy origins', () => {
  const origins = [
 'https://crystalball-abc123-elie-xyz.vercel.app',
 'https://crystalball-main-bradleybond512.vercel.app',
 'https://crystal-ball-feature-abc-bradleybond512.vercel.app',
 'https://crystal-ball-preview-elie-xyz.vercel.app',
 'http://localhost:5173',
 'http://localhost',
 'https://localhost:3000',
  ];
  for (const origin of origins) {
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), false, `preview origin should be allowed: ${origin}`);
  }
});

test('rejects unrelated third-party Vercel projects that share the crystal-ball prefix', () => {
  // Historical bug: a pattern like /^https:\/\/crystal-ball[a-z0-9-]*\.vercel\.app$/
  // would let any Vercel project starting with "crystal-ball" bypass CORS.
  // Every trusted pattern must terminate on a known username segment.
  const bad = [
 'https://crystal-ball.vercel.app',
 'https://crystal-ball-attacker.vercel.app',
 'https://crystal-ball-foo-bar-baz.vercel.app',
 'https://crystalball-foo.vercel.app',
 'https://crystal-ball-main-otheruser.vercel.app',
  ];
  for (const origin of bad) {
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), true, `third-party Vercel origin should be rejected: ${origin}`);
  }
});

test('rejects origins with wrong protocol or port tricks', () => {
  const bad = [
 'http://crystalball.app', // wrong protocol for prod
 'ftp://crystalball.app',
 'https://crystalball.app.evil.com',
  ];
  for (const origin of bad) {
 const req = makeRequest(origin);
 assert.equal(isDisallowedOrigin(req), true, `should be rejected: ${origin}`);
  }
});

test('Vary header is always set to Origin', () => {
  const cors = getCorsHeaders(makeRequest('https://crystalball.app'));
  assert.equal(cors['Vary'], 'Origin');
});

test('getCorsHeaders returns correct default methods', () => {
  const cors = getCorsHeaders(makeRequest('https://crystalball.app'));
  assert.equal(cors['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('getCorsHeaders accepts custom methods parameter', () => {
  const cors = getCorsHeaders(makeRequest('https://crystalball.app'), 'GET, POST, OPTIONS');
  assert.equal(cors['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
});
