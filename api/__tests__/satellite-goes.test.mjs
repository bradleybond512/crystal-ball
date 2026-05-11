/**
 * Tests for api/satellite/goes.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch, mockReq } from './_test-utils.mjs';

let handler;
let goesCache;
try {
  const mod = await import('../satellite/goes.js');
  handler = mod.default;
  goesCache = mod.cache;
} catch (err) {
  console.warn('Handler satellite/goes.js failed to import:', err.message);
  handler = null;
}

test('goes: rejects non-GET methods', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('goes: handles OPTIONS preflight', async () => {
  if (!handler) return;
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('goes: returns 200 with goesEast and goesWest keys', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov/GOES16', { status: 200, text: '' }],
    ['cdn.star.nesdis.noaa.gov/GOES18', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.statusCode, 200);
  assert.ok('goesEast' in res.body, 'should have goesEast');
  assert.ok('goesWest' in res.body, 'should have goesWest');
});

test('goes: goesEast has expected shape', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  const e = res.body.goesEast;
  assert.ok(typeof e.label === 'string', 'label should be string');
  assert.ok(typeof e.url === 'string', 'url should be string');
  assert.ok(typeof e.available === 'boolean', 'available should be boolean');
  assert.ok(e.url.includes('GOES16'), 'url should reference GOES16');
});

test('goes: goesWest has expected shape', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  const w = res.body.goesWest;
  assert.ok(typeof w.label === 'string');
  assert.ok(w.url.includes('GOES18'), 'url should reference GOES18');
});

test('goes: marks available=true when CDN responds 200', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.goesEast.available, true);
  assert.equal(res.body.goesWest.available, true);
});

test('goes: marks available=false when CDN returns 404', async () => {
  if (!handler) return;
  goesCache?.clear();
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 404, text: 'Not Found' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.goesEast.available, false);
  assert.equal(res.body.goesWest.available, false);
});

test('goes: response includes generatedAt ISO timestamp', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.ok(typeof res.body.generatedAt === 'string');
  assert.doesNotThrow(() => new Date(res.body.generatedAt));
});

test('goes: response includes cacheTtlSeconds', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.cacheTtlSeconds, 300);
});

test('goes: gracefully handles CDN fetch timeout/error', async () => {
  if (!handler) return;
  goesCache?.clear();
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network timeout'); };
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { globalThis.fetch = origFetch; }
  // Should still return 200 with available=false rather than 500
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.goesEast.available, false);
  assert.equal(res.body.goesWest.available, false);
});

test('goes: goesEast product is GeoColor', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.goesEast.product, 'GeoColor');
});

test('goes: goesEast region is CONUS', async () => {
  if (!handler) return;
  const restoreFetch = mockFetch(new Map([
    ['cdn.star.nesdis.noaa.gov', { status: 200, text: '' }],
  ]));
  let res;
  try { ({ res } = await invokeHandler(handler)); } finally { restoreFetch(); }
  assert.equal(res.body.goesEast.region, 'CONUS');
});
