import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchPurpleairNearby } from '../purpleair-fusion-fetch.ts';

interface StubCall { url: string }

function stubFetch(t: { after: (fn: () => void) => void }, payload: unknown, status = 200): StubCall {
  const call: StubCall = { url: '' };
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    call.url = String(input);
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return call;
}

const FRESH_MS = 1_745_000_000_123;

function sensor(o: Record<string, unknown> = {}): Record<string, unknown> {
  return { lat: 41.6, lon: -87.06, pm25: 12, confidence: 95, lastSeen: FRESH_MS, ...o };
}

test('fetchPurpleairNearby requests a bounding box around the reference coordinate', async (t) => {
  const call = stubFetch(t, { sensors: [sensor()] });
  await fetchPurpleairNearby(41.6, -87.06);
  // getApiBaseUrl() is origin-relative in bare Node — resolve against a dummy base.
  const params = new URL(call.url, 'http://sidecar.test').searchParams;
  const nwLat = Number(params.get('nwlat'));
  const seLat = Number(params.get('selat'));
  const nwLng = Number(params.get('nwlng'));
  const seLng = Number(params.get('selng'));
  // Default 100km radius ≈ ±0.9° latitude around the center.
  assert.ok(Math.abs(nwLat - 42.499) < 0.01, `nwlat ${nwLat}`);
  assert.ok(Math.abs(seLat - 40.701) < 0.01, `selat ${seLat}`);
  assert.ok(nwLng < -87.06 && seLng > -87.06, `lng box [${nwLng}, ${seLng}] must bracket the center`);
});

test('fetchPurpleairNearby uses sidecar lastSeen (epoch ms) verbatim as observedAt — no ×1000', async (t) => {
  stubFetch(t, { sensors: [sensor()] });
  const result = await fetchPurpleairNearby(41.6, -87.06);
  assert.equal(result.ok, true);
  assert.equal(result.readings.length, 1);
  assert.equal(result.readings[0]!.observedAt, FRESH_MS);
});

test('fetchPurpleairNearby falls back to now for missing/non-positive lastSeen', async (t) => {
  stubFetch(t, { sensors: [sensor({ lastSeen: null }), sensor({ lastSeen: 0 })] });
  const before = Date.now();
  const result = await fetchPurpleairNearby(41.6, -87.06);
  const after = Date.now();
  assert.equal(result.readings.length, 2);
  for (const r of result.readings) {
    assert.ok(r.observedAt >= before && r.observedAt <= after, `observedAt ${r.observedAt} should be ~now`);
  }
});

test('fetchPurpleairNearby fails closed on keyMissing', async (t) => {
  const call = stubFetch(t, { sensors: [], keyMissing: true });
  assert.deepEqual(await fetchPurpleairNearby(41.6, -87.06), { ok: false, readings: [] });
  assert.ok(call.url.includes('/api/airquality/purpleair'));
});

test('fetchPurpleairNearby fails closed on a non-2xx response', async (t) => {
  stubFetch(t, { sensors: [sensor()] }, 502);
  assert.deepEqual(await fetchPurpleairNearby(41.6, -87.06), { ok: false, readings: [] });
});

test('fetchPurpleairNearby fails closed on an upstream error payload', async (t) => {
  stubFetch(t, { sensors: [], error: 'purpleair upstream 502' });
  assert.deepEqual(await fetchPurpleairNearby(41.6, -87.06), { ok: false, readings: [] });
});

test('fetchPurpleairNearby drops low-confidence sensors (A/B-channel disagreement)', async (t) => {
  stubFetch(t, { sensors: [sensor({ confidence: 30 }), sensor({ confidence: undefined })] });
  assert.deepEqual(await fetchPurpleairNearby(41.6, -87.06), { ok: false, readings: [] });
});

test('fetchPurpleairNearby still radius-filters sensors the bbox let through', async (t) => {
  // Box corners are ~√2 × radius from the center — inside the bbox, outside 100km.
  stubFetch(t, { sensors: [sensor({ lat: 42.49, lon: -88.25 })] });
  const result = await fetchPurpleairNearby(41.6, -87.06);
  assert.deepEqual(result, { ok: false, readings: [] });
});
