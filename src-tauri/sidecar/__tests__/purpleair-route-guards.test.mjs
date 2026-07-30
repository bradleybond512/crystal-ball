/**
 * Guards for the /api/airquality/purpleair route (Codex review P1-6 on
 * PR #1584):
 *
 *   1. sidecarParseV1Sensors must emit lastSeen in epoch MS. PurpleAir's v1
 *      last_seen is unix seconds; the public-JSON sibling already converted,
 *      the v1 path didn't — renderer consumers document PurpleAirSensor.
 *      lastSeen as epoch ms and used to carry a ×1000 compensation.
 *   2. The route must accept PurpleAir's own nwlng/nwlat/selng/selat bbox
 *      params, forward them upstream, and key its cache per-bbox so a global
 *      snapshot and a bounded one can't be served for each other. The
 *      unbounded form stays — the wildfire panel's global view needs it.
 *
 * Route assertions are source-scoped (same convention and rationale as
 * sidecar-ttl-cache-guards.test.mjs): exercising them behaviorally needs a
 * live server + mocked upstream.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.LOCAL_API_TOKEN ??= 'test-token-for-sidecar-tests';
const { sidecarParseV1Sensors } = await import('../local-api-server.mjs');

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.join(__dir, '..', 'local-api-server.mjs'), 'utf8');

function routeBody(pathname) {
  const start = serverSrc.indexOf(`requestUrl.pathname === '${pathname}'`);
  assert.notEqual(start, -1, `route ${pathname} must exist`);
  const next = serverSrc.indexOf('requestUrl.pathname ===', start + pathname.length);
  const end = next === -1 ? Math.min(serverSrc.length, start + 3000) : next;
  return serverSrc.slice(start, end);
}

// ── Parser: last_seen seconds → epoch ms ─────────────────────────────────────

test('sidecarParseV1Sensors converts v1 last_seen (unix seconds) to epoch ms', () => {
  const out = sidecarParseV1Sensors({
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude', 'location_type', 'confidence', 'name', 'last_seen'],
    data: [[101, 12.5, 34.05, -118.24, 0, 92, 'LA West', 1_700_000_000]],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].lastSeen, 1_700_000_000_000);
});

test('sidecarParseV1Sensors keeps lastSeen null when last_seen is absent', () => {
  const out = sidecarParseV1Sensors({
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude'],
    data: [[101, 12.5, 34.05, -118.24]],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].lastSeen, null);
});

// ── Route: optional bbox, forwarded upstream, bbox-scoped cache key ──────────

test('purpleair route reads the four PurpleAir bbox params', () => {
  const body = routeBody('/api/airquality/purpleair');
  assert.match(body, /searchParams\.get\(/, 'route must read query params');
  for (const p of ['nwlng', 'nwlat', 'selng', 'selat']) {
    assert.match(body, new RegExp(`'${p}'`), `route must reference ${p}`);
  }
});

test('purpleair route forwards the bbox to the upstream v1 URL', () => {
  const body = routeBody('/api/airquality/purpleair');
  assert.match(body, /nwlng=/, 'upstream URL must carry the bbox');
});

test('purpleair route cache key is bbox-scoped, and the unbounded form survives', () => {
  const body = routeBody('/api/airquality/purpleair');
  assert.match(body, /purpleair-sensors:/, 'bounded requests need their own cache key');
  assert.match(body, /'purpleair-sensors'/, 'global (unbounded) cache key must remain for the wildfire panel');
});
