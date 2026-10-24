import { strict as assert } from 'node:assert';
import test from 'node:test';
import handler from './embed.js';

function makeRequest(query = '') {
  return new Request(`http://localhost:5173/api/youtube/embed${query}`);
}

test('rejects missing or invalid video ids', async () => {
  const missing = await handler(makeRequest());
  assert.equal(missing.status, 400);

  const invalid = await handler(makeRequest('?videoId=bad'));
  assert.equal(invalid.status, 400);
});

test('returns embeddable html for valid video id', async () => {
  const response = await handler(makeRequest('?videoId=iEpJwprxDdk&autoplay=0&mute=1'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.includes('text/html'), true);

  const html = await response.text();
  assert.equal(html.includes("videoId:'iEpJwprxDdk'"), true);
  assert.equal(html.includes("host:'https://www.youtube.com'"), true);
  assert.equal(html.includes('autoplay:0'), true);
  assert.equal(html.includes('mute:1'), true);
  assert.equal(html.includes('origin:"http://localhost:5173"'), true);
  assert.equal(html.includes('postMessage'), true);
});

test('accepts custom origin parameter', async () => {
  const response = await handler(makeRequest('?videoId=iEpJwprxDdk&origin=http://127.0.0.1:46123'));
  const html = await response.text();
  assert.equal(html.includes('origin:"http://127.0.0.1:46123"'), true);
});

test('uses dedicated parentOrigin for iframe postMessage target', async () => {
  const response = await handler(makeRequest('?videoId=iEpJwprxDdk&origin=http://localhost:5173&parentOrigin=https://tauri.localhost'));
  const html = await response.text();
  assert.match(html, /playerVars:\{[^}]*origin:"http:\/\/localhost:5173"/);
  assert.match(html, /parentOrigin="https:\/\/tauri\.localhost"/);
  assert.match(html, /if\(allowedOrigin!==['"]\*['"]&&e\.origin!==allowedOrigin\)return/);
});

test('does not accept wildcard parentOrigin query parameter', async () => {
  const response = await handler(makeRequest('?videoId=iEpJwprxDdk&origin=http://localhost:5173&parentOrigin=*'));
  const html = await response.text();
  assert.equal(html.includes('parentOrigin="*"'), false);
  assert.match(html, /parentOrigin="http:\/\/localhost:5173"/);
});

test('relay CORS: accepts existing local and anchored preview origins', async () => {
  const ok = [
 'http://localhost:5173',
 'https://crystalball-my-branch-bradleybond512.vercel.app',
 'https://crystal-ball-fix-bradleybond512.vercel.app',
 'https://crystalball-pr-elie-abc123.vercel.app',
  ];
  for (const origin of ok) {
 const res = await handler(makeRequest(`?videoId=iEpJwprxDdk&origin=${encodeURIComponent(origin)}`));
 const html = await res.text();
 assert.ok(html.includes(`origin:"${origin}"`), `should accept ${origin}`);
  }
});

test('relay CORS: accepts localhost dev origins', async () => {
  const res = await handler(makeRequest('?videoId=iEpJwprxDdk&origin=http://localhost:5173'));
  const html = await res.text();
  assert.ok(html.includes('origin:"http://localhost:5173"'), 'should accept localhost dev');
});

test('relay CORS: rejects unknown origin when preview flag off', async () => {
  const res = await handler(makeRequest('?videoId=iEpJwprxDdk&origin=https://evil.vercel.app'));
  const html = await res.text();
  assert.ok(!html.includes('origin:"https://evil.vercel.app"'), 'should reject unknown vercel project');
});

test('relay CORS: accepts owner-anchored preview origin when flag enabled', async () => {
  const origin = 'https://crystalball-feature-bradleybond512.vercel.app';
  const res = await handler(makeRequest(`?videoId=iEpJwprxDdk&origin=${encodeURIComponent(origin)}`));
  const html = await res.text();
  assert.ok(html.includes(`origin:"${origin}"`), 'should accept owner-anchored preview');
});

test('relay CORS: rejects lookalike vercel origins even when flag enabled (R2-SEC-006)', async () => {
  const invalid = [
 'https://crystalball-evilorg.vercel.app',
 'https://crystalball-bradleybond512.evil.com',
  ];
  for (const origin of invalid) {
 const res = await handler(makeRequest(`?videoId=iEpJwprxDdk&origin=${encodeURIComponent(origin)}`));
 const html = await res.text();
 assert.ok(!html.includes(`origin:"${origin}"`), `should reject lookalike: ${origin}`);
  }
});

test('relay CORS: missing origin uses the actual allowed local request origin', async () => {
  const res = await handler(makeRequest('?videoId=iEpJwprxDdk&origin='));
  const html = await res.text();
  assert.ok(html.includes('origin:"http://localhost:5173"'), 'should fall back to default origin');
});


test('rejects retired origins instead of selecting a public fallback', async () => {
  for (const origin of ['https://crystalball.app', 'https://api.crystalball.app', 'https://CRYSTALBALL.APP.']) {
    const response = await handler(makeRequest(`?videoId=iEpJwprxDdk&origin=${encodeURIComponent(origin)}`));
    assert.equal(response.status, 400, origin);
    assert.doesNotMatch(await response.text(), /crystalball[.]app/i);
  }
});
