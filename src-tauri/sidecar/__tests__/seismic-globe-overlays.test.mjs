/**
 * Sidecar tests for the /api/seismic-globe-overlays route (Layer 5).
 *
 * Two layers of coverage:
 *   1. Pure unit test for `sanitizeSeismicGlobeOverlay` — bounds checks,
 *      type rejection, opacity clamp.
 *   2. Integration test that spins the sidecar on an ephemeral port and
 *      round-trips a POST/GET cycle.
 */
import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

process.env.LOCAL_API_TOKEN ??= 'test-token-globe-overlays';

import {
  createLocalApiServer,
  sanitizeSeismicGlobeOverlay,
} from '../local-api-server.mjs';

// ── Pure sanitizer tests ───────────────────────────────────────────────

function validOverlay(overrides = {}) {
  return {
    eventId: 'usgs:abc',
    lat: 0,
    lon: 0,
    magnitude: 5.5,
    pWaveRadiusKm: 60,
    sWaveRadiusKm: 35,
    pWaveOpacity: 0.99,
    sWaveOpacity: 0.99,
    ageSec: 10,
    expired: false,
    ...overrides,
  };
}

test('sanitizer accepts a valid overlay', () => {
  const out = sanitizeSeismicGlobeOverlay(validOverlay());
  assert.equal(out.eventId, 'usgs:abc');
  assert.equal(out.magnitude, 5.5);
});

test('sanitizer rejects null / non-object', () => {
  assert.equal(sanitizeSeismicGlobeOverlay(null), null);
  assert.equal(sanitizeSeismicGlobeOverlay(undefined), null);
  assert.equal(sanitizeSeismicGlobeOverlay('hi'), null);
  assert.equal(sanitizeSeismicGlobeOverlay(42), null);
});

test('sanitizer rejects missing eventId', () => {
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ eventId: '' })), null);
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ eventId: 123 })), null);
});

test('sanitizer rejects out-of-range lat/lon', () => {
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lat: 91 })), null);
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lat: -91 })), null);
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lon: 181 })), null);
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lon: -181 })), null);
});

test('sanitizer rejects NaN lat/lon', () => {
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lat: Number.NaN })), null);
  assert.equal(sanitizeSeismicGlobeOverlay(validOverlay({ lon: Infinity })), null);
});

test('sanitizer accepts null magnitude (matches GlobeSeismicOverlay type)', () => {
  const out = sanitizeSeismicGlobeOverlay(validOverlay({ magnitude: null }));
  assert.equal(out.magnitude, null);
});

test('sanitizer coerces invalid magnitude to null', () => {
  const out = sanitizeSeismicGlobeOverlay(validOverlay({ magnitude: 'M5' }));
  assert.equal(out.magnitude, null);
});

test('sanitizer clamps opacity to [0,1]', () => {
  const out = sanitizeSeismicGlobeOverlay(validOverlay({ pWaveOpacity: 1.5, sWaveOpacity: -0.2 }));
  assert.equal(out.pWaveOpacity, 1);
  assert.equal(out.sWaveOpacity, 0);
});

test('sanitizer clamps radius to [0, 20100]', () => {
  const out = sanitizeSeismicGlobeOverlay(validOverlay({ pWaveRadiusKm: 99_999, sWaveRadiusKm: -50 }));
  assert.equal(out.pWaveRadiusKm, 20_100);
  assert.equal(out.sWaveRadiusKm, 0);
});

test('sanitizer normalizes expired truthy/falsy to boolean', () => {
  const out1 = sanitizeSeismicGlobeOverlay(validOverlay({ expired: 1 }));
  const out2 = sanitizeSeismicGlobeOverlay(validOverlay({ expired: 'yes' }));
  const out3 = sanitizeSeismicGlobeOverlay(validOverlay({ expired: undefined }));
  assert.equal(out1.expired, false);
  assert.equal(out2.expired, false);
  assert.equal(out3.expired, false);
});

test('sanitizer sets ageSec to 0 when missing', () => {
  const v = validOverlay();
  delete v.ageSec;
  const out = sanitizeSeismicGlobeOverlay(v);
  assert.equal(out.ageSec, 0);
});

// ── Sidecar integration tests ──────────────────────────────────────────

async function startSidecar() {
  const app = await createLocalApiServer({
    port: 0,
    apiDir: undefined,
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() { await app.close(); },
  };
}

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const options = {
      hostname: u.hostname,
      port: u.port,
      method,
      path: u.pathname + u.search,
      headers,
    };
    const req = httpRequest(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('GET before any POST returns empty overlays + available:false', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('GET', `${sidecar.base}/api/seismic-globe-overlays`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.overlays, []);
    assert.equal(res.body.available, false);
  } finally {
    await sidecar.close();
  }
});

test('POST then GET round-trips an overlay payload', async () => {
  const sidecar = await startSidecar();
  try {
    const overlay = validOverlay({ eventId: 'usgs:roundtrip', magnitude: 6.2 });
    const post = await httpJson('POST', `${sidecar.base}/api/seismic-globe-overlays`, {
      overlays: [overlay],
      asOf: 1_745_000_000_000,
    });
    assert.equal(post.status, 200);
    assert.equal(post.body.ok, true);
    assert.equal(post.body.count, 1);

    const get = await httpJson('GET', `${sidecar.base}/api/seismic-globe-overlays`);
    assert.equal(get.status, 200);
    assert.equal(get.body.available, true);
    assert.equal(get.body.overlays.length, 1);
    assert.equal(get.body.overlays[0].eventId, 'usgs:roundtrip');
    assert.equal(get.body.overlays[0].magnitude, 6.2);
    assert.equal(get.body.asOf, 1_745_000_000_000);
  } finally {
    await sidecar.close();
  }
});

test('POST with non-array overlays returns 400', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/seismic-globe-overlays`, {
      overlays: 'oops',
    });
    assert.equal(res.status, 400);
  } finally {
    await sidecar.close();
  }
});

test('POST drops malformed entries but keeps valid ones', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('POST', `${sidecar.base}/api/seismic-globe-overlays`, {
      overlays: [
        validOverlay({ eventId: 'a' }),
        { eventId: '', lat: 0, lon: 0 }, // dropped
        null,                              // dropped
        validOverlay({ eventId: 'b' }),
      ],
      asOf: 1_745_000_000_000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 2);

    const get = await httpJson('GET', `${sidecar.base}/api/seismic-globe-overlays`);
    assert.equal(get.body.overlays.length, 2);
    assert.deepEqual(get.body.overlays.map((o) => o.eventId).sort(), ['a', 'b']);
  } finally {
    await sidecar.close();
  }
});

test('POST hard caps at 200 overlays even if more sent', async () => {
  const sidecar = await startSidecar();
  try {
    const overlays = Array.from({ length: 250 }, (_, i) =>
      validOverlay({ eventId: `e-${i}` }),
    );
    const res = await httpJson('POST', `${sidecar.base}/api/seismic-globe-overlays`, {
      overlays,
      asOf: 1_745_000_000_000,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 200);
  } finally {
    await sidecar.close();
  }
});

test('non-POST/GET methods return 405', async () => {
  const sidecar = await startSidecar();
  try {
    const res = await httpJson('DELETE', `${sidecar.base}/api/seismic-globe-overlays`);
    assert.equal(res.status, 405);
  } finally {
    await sidecar.close();
  }
});

test('POST with malformed JSON returns 400 and does not corrupt state', async () => {
  const sidecar = await startSidecar();
  try {
    // Seed a known-good state first.
    await httpJson('POST', `${sidecar.base}/api/seismic-globe-overlays`, {
      overlays: [validOverlay({ eventId: 'seed' })],
      asOf: 1_745_000_000_000,
    });

    // Send malformed body via raw HTTP (httpJson can't send invalid JSON).
    const res = await new Promise((resolve, reject) => {
      const u = new URL(`${sidecar.base}/api/seismic-globe-overlays`);
      const req = httpRequest({
        hostname: u.hostname,
        port: u.port,
        method: 'POST',
        path: u.pathname,
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
        },
      }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.write('{not valid json');
      req.end();
    });
    assert.equal(res.status, 400);

    // State should still hold the seed.
    const get = await httpJson('GET', `${sidecar.base}/api/seismic-globe-overlays`);
    assert.equal(get.body.overlays.length, 1);
    assert.equal(get.body.overlays[0].eventId, 'seed');
  } finally {
    await sidecar.close();
  }
});
