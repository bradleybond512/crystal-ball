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
const { sidecarParseV1Sensors, createLocalApiServer } = await import('../local-api-server.mjs');

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

// ── Route, behavioral: paths that return before any upstream call ───────────
// (Forwarding + cache isolation stay source-scoped above: fetchWithTimeout
// goes through node:https directly, so there is no cheap upstream mock seam.)

async function withServer(fn) {
  const app = await createLocalApiServer({ port: 0, logger: { log() {}, warn() {}, error() {} } });
  const { port } = await app.start();
  try {
    await fn((path) => fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
    }));
  } finally {
    await app.close();
  }
}

test('purpleair route: missing key → 503 keyMissing before bbox handling', async () => {
  const saved = process.env.PURPLEAIR_API_KEY;
  delete process.env.PURPLEAIR_API_KEY;
  try {
    await withServer(async (get) => {
      const res = await get('/api/airquality/purpleair?nwlng=1');
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.keyMissing, true);
    });
  } finally {
    if (saved !== undefined) process.env.PURPLEAIR_API_KEY = saved;
  }
});

test('purpleair route: partial or malformed bbox → 400, all-four-or-none', async () => {
  const saved = process.env.PURPLEAIR_API_KEY;
  process.env.PURPLEAIR_API_KEY = 'test-key-never-sent-upstream';
  try {
    await withServer(async (get) => {
      for (const qs of [
        '?nwlng=-88.2',
        '?nwlng=-88.2&nwlat=42.4&selng=-85.8',
        '?nwlng=abc&nwlat=42.4&selng=-85.8&selat=40.7',
        '?nwlng=1junk&nwlat=42.4&selng=-85.8&selat=40.7', // parseFloat would truncate to 1 — must 400
        '?nwlng=&nwlat=42.4&selng=-85.8&selat=40.7', // empty param is not 0
      ]) {
        const res = await get(`/api/airquality/purpleair${qs}`);
        assert.equal(res.status, 400, `expected 400 for ${qs}`);
        const body = await res.json();
        assert.match(body.error, /bbox/);
      }
    });
  } finally {
    if (saved === undefined) delete process.env.PURPLEAIR_API_KEY;
    else process.env.PURPLEAIR_API_KEY = saved;
  }
});
