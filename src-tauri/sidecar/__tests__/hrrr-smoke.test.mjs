/**
 * Sidecar HRRR-Smoke decode tests (node --test). Covers the sidecar-only half
 * the browser can't do: wgrib2 resolution, the `-lon` inventory parse + µg/m³
 * scaling, the temp-file decode subprocess, and the fetch→range→decode
 * orchestrator. Every network / fs / subprocess dependency is injected, so
 * these run offline with no wgrib2 installed. The pure helpers shared with the
 * TS module are pinned separately by hrrr-smoke-parity.test.mts.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  cycleEpochMs,
  resolveWgrib2Path,
  _resetWgrib2Cache,
  parseWgrib2Vals,
  decodeMassdenAtPoints,
  fetchHrrrGrid,
  _resetGridCache,
  smokePm25ToUsAqi,
} from '../hrrr-smoke.mjs';

const HOUR_MS = 3_600_000;

/** existsSync stub that reports true only for the one path `p`. */
const seen = (p) => (path) => path === p;

// ── cycleEpochMs ────────────────────────────────────────────────────────────

test('cycleEpochMs rebuilds the UTC epoch of a cycle', () => {
  assert.equal(cycleEpochMs({ date: '20260722', hour: 12 }), Date.UTC(2026, 6, 22, 12));
  assert.equal(cycleEpochMs({ date: '20260101', hour: 0 }), Date.UTC(2026, 0, 1, 0));
});

// ── resolveWgrib2Path ───────────────────────────────────────────────────────

test('resolveWgrib2Path honors WGRIB2_PATH first, then bundled, then candidates', () => {
  assert.equal(
    resolveWgrib2Path({ env: { WGRIB2_PATH: '/x/wgrib2' }, existsSync: seen('/x/wgrib2'), noCache: true }),
    '/x/wgrib2',
  );
  assert.equal(
    resolveWgrib2Path({ env: { WGRIB2_BUNDLED_PATH: '/bundle/wgrib2' }, existsSync: seen('/bundle/wgrib2'), noCache: true }),
    '/bundle/wgrib2',
  );
  assert.equal(
    resolveWgrib2Path({ env: {}, existsSync: seen('/opt/homebrew/bin/wgrib2'), noCache: true }),
    '/opt/homebrew/bin/wgrib2',
  );
});

test('resolveWgrib2Path derives the vendored binary from LOCAL_API_RESOURCE_DIR', () => {
  const vendored = '/App/Resources/sidecar/wgrib2/wgrib2';
  // The shipped default: env var set, binary present under it.
  assert.equal(
    resolveWgrib2Path({ env: { LOCAL_API_RESOURCE_DIR: '/App/Resources' }, existsSync: seen(vendored), noCache: true }),
    vendored,
  );
  // Explicit overrides still win over the derived path.
  assert.equal(
    resolveWgrib2Path({
      env: { WGRIB2_PATH: '/x/wgrib2', LOCAL_API_RESOURCE_DIR: '/App/Resources' },
      existsSync: (p) => p === '/x/wgrib2' || p === vendored,
      noCache: true,
    }),
    '/x/wgrib2',
  );
  // The derived path outranks the Homebrew/system candidates.
  assert.equal(
    resolveWgrib2Path({
      env: { LOCAL_API_RESOURCE_DIR: '/App/Resources' },
      existsSync: (p) => p === vendored || p === '/opt/homebrew/bin/wgrib2',
      noCache: true,
    }),
    vendored,
  );
  // Unset env var is a no-op — fall through to the system candidates.
  assert.equal(
    resolveWgrib2Path({ env: {}, existsSync: seen('/opt/homebrew/bin/wgrib2'), noCache: true }),
    '/opt/homebrew/bin/wgrib2',
  );
});

test('resolveWgrib2Path falls back to a $PATH scan, else null', () => {
  assert.equal(
    resolveWgrib2Path({ env: { PATH: '/a:/b:/c' }, existsSync: (p) => p === '/b/wgrib2', noCache: true }),
    '/b/wgrib2',
  );
  assert.equal(resolveWgrib2Path({ env: { PATH: '/a:/b' }, existsSync: () => false, noCache: true }), null);
});

test('resolveWgrib2Path caches the resolved path (and reset clears it)', () => {
  _resetWgrib2Cache();
  let calls = 0;
  const existsSync = (p) => { calls++; return p === '/opt/homebrew/bin/wgrib2'; };
  const first = resolveWgrib2Path({ env: {}, existsSync });
  const callsAfterFirst = calls;
  const second = resolveWgrib2Path({ env: {}, existsSync });
  assert.equal(first, '/opt/homebrew/bin/wgrib2');
  assert.equal(second, '/opt/homebrew/bin/wgrib2');
  assert.equal(calls, callsAfterFirst, 'second call served from cache — no new existsSync probes');
  _resetWgrib2Cache();
});

// ── parseWgrib2Vals ─────────────────────────────────────────────────────────

test('parseWgrib2Vals scales SI kg/m³ → µg/m³ for each in-order val', () => {
  // 1e-8 kg/m³ → 10 µg/m³, 2e-8 → 20; 0 stays a valid 0 (not null).
  const line = ':lon=262.5,lat=41.5,val=1e-08:lon=241.9,lat=34.0,val=2e-08:lon=250,lat=30,val=0';
  assert.deepEqual(parseWgrib2Vals(line, 3), [10, 20, 0]);
});

test('parseWgrib2Vals fails closed to all-null on a value-count mismatch', () => {
  const line = 'val=1e-08 val=2e-08';
  assert.deepEqual(parseWgrib2Vals(line, 3), [null, null, null]);
  assert.deepEqual(parseWgrib2Vals('', 2), [null, null]);
  assert.deepEqual(parseWgrib2Vals(null, 1), [null]);
});

test('parseWgrib2Vals nulls the wgrib2 missing sentinel and out-of-range results', () => {
  // 9.999e20 sentinel → null; 1e-3 kg/m³ = 1e6 µg/m³ (>100000 cap) → null;
  // negative → null; a plausible value survives.
  const line = 'val=9.999e20 val=1e-03 val=-1e-08 val=5e-08';
  assert.deepEqual(parseWgrib2Vals(line, 4), [null, null, null, 50]);
});

// ── decodeMassdenAtPoints ───────────────────────────────────────────────────

function fakeFs() {
  const calls = { writes: [], removes: [] };
  return {
    calls,
    deps: {
      mkdtempSync: (prefix) => `${prefix}XXXX`,
      writeFileSync: (file, buf) => calls.writes.push({ file, len: buf.length }),
      rmSync: (dir, opts) => calls.removes.push({ dir, opts }),
      tmpdir: '/tmp',
    },
  };
}

test('decodeMassdenAtPoints writes bytes, shells wgrib2 with -lon args, cleans up', async () => {
  const fs = fakeFs();
  let capturedArgs = null;
  const deps = {
    ...fs.deps,
    execFileAsync: async (_bin, args) => { capturedArgs = args; return { stdout: 'val=1e-08 val=2e-08' }; },
  };
  const points = [{ lat: 41.5, lon: -97.5 }, { lat: 34, lon: -118 }];
  const out = await decodeMassdenAtPoints({ gribBytes: new Uint8Array([1, 2, 3]), points, wgrib2Path: '/w', deps });
  assert.deepEqual(out, [10, 20]);
  assert.equal(fs.calls.writes.length, 1);
  assert.equal(fs.calls.writes[0].len, 3);
  assert.equal(fs.calls.removes.length, 1, 'temp dir removed');
  // args: [file, '-lon', lon, lat, '-lon', lon, lat] — lon then lat, as strings.
  assert.deepEqual(capturedArgs.slice(1), ['-lon', '-97.5', '41.5', '-lon', '-118', '34']);
});

test('decodeMassdenAtPoints fails closed to all-null (no wgrib2, empty points, throw)', async () => {
  const fs = fakeFs();
  assert.deepEqual(
    await decodeMassdenAtPoints({ gribBytes: new Uint8Array([1]), points: [{ lat: 1, lon: 2 }], wgrib2Path: null, deps: fs.deps }),
    [null],
  );
  assert.deepEqual(await decodeMassdenAtPoints({ gribBytes: new Uint8Array([1]), points: [], wgrib2Path: '/w', deps: fs.deps }), []);

  const throwing = { ...fs.deps, execFileAsync: async () => { throw new Error('wgrib2 boom'); } };
  assert.deepEqual(
    await decodeMassdenAtPoints({ gribBytes: new Uint8Array([1]), points: [{ lat: 1, lon: 2 }], wgrib2Path: '/w', deps: throwing }),
    [null],
  );
  assert.equal(fs.calls.removes.length, 1, 'temp dir still cleaned up after a decode throw');
});

// ── fetchHrrrGrid (orchestrator) ────────────────────────────────────────────

const IDX = [
  '1:0:d=2026072212:REFC:entire atmosphere:6 hour fcst:',
  '2:1000:d=2026072212:MASSDEN:8 m above ground:6 hour fcst:',
  '3:2000:d=2026072212:TMP:surface:6 hour fcst:',
].join('\n');

function decodeDeps(stdout) {
  const fs = fakeFs();
  return { ...fs.deps, execFileAsync: async () => ({ stdout }) };
}

/** fetchImpl stub: the `.idx` GET 404s (index unavailable ⇒ skip the hour). */
const idxFail = async (url) => {
  if (url.endsWith('.idx')) return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 206, text: async () => '', arrayBuffer: async () => new Uint8Array([1]).buffer };
};

/** fetchImpl stub: server ignores Range and replies 200 (not 206) ⇒ skip the hour. */
const rangeIgnored = async (url) => {
  if (url.endsWith('.idx')) return { ok: true, status: 200, text: async () => IDX, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([1]).buffer }; // 200 not 206
};

test('fetchHrrrGrid fetches idx → range-GET (206) → decode into GridPointAq columns', async () => {
  const now = Date.UTC(2026, 6, 22, 14, 37); // cycle 20260722 12Z
  const cycleMs = Date.UTC(2026, 6, 22, 12);
  const ranges = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('.idx')) return { ok: true, status: 200, text: async () => IDX, arrayBuffer: async () => new ArrayBuffer(0) };
    if (init?.headers?.Range) ranges.push(init.headers.Range);
    return { ok: true, status: 206, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const points = [{ lat: 41.5, lon: -97.5 }, { lat: 34, lon: -118 }];
  const grid = await fetchHrrrGrid({
    points, now, horizonHours: 2,
    deps: { wgrib2Path: '/w', fetchImpl, noCache: true, ...decodeDeps('val=1e-08 val=2e-08') },
  });
  assert.equal(grid.length, 2);
  assert.deepEqual(grid[0].timesMs, [cycleMs + HOUR_MS, cycleMs + 2 * HOUR_MS]);
  assert.deepEqual(grid[0].usAqi, [smokePm25ToUsAqi(10), smokePm25ToUsAqi(10)]);
  assert.deepEqual(grid[1].usAqi, [smokePm25ToUsAqi(20), smokePm25ToUsAqi(20)]);
  assert.deepEqual(ranges, ['bytes=1000-1999', 'bytes=1000-1999'], 'only the MASSDEN message is range-GET per hour');
});

test('fetchHrrrGrid returns [] for no points, all-null when wgrib2 is unavailable', async () => {
  assert.deepEqual(await fetchHrrrGrid({ points: [], now: Date.now(), deps: { noCache: true } }), []);
  const grid = await fetchHrrrGrid({
    points: [{ lat: 1, lon: 2 }],
    now: Date.UTC(2026, 6, 22, 14, 37),
    deps: { env: {}, existsSync: () => false, noCache: true, fetchImpl: async () => { throw new Error('unused'); } },
  });
  assert.deepEqual(grid, [null], 'no wgrib2 ⇒ caller falls back to Open-Meteo');
});

test('fetchHrrrGrid skips hours on idx failure and on a non-206 (Range-ignored) body', async () => {
  const now = Date.UTC(2026, 6, 22, 14, 37);
  assert.deepEqual(
    await fetchHrrrGrid({ points: [{ lat: 41.5, lon: -97.5 }], now, horizonHours: 2, deps: { wgrib2Path: '/w', fetchImpl: idxFail, noCache: true, ...decodeDeps('val=1e-08') } }),
    [null],
  );

  assert.deepEqual(
    await fetchHrrrGrid({ points: [{ lat: 41.5, lon: -97.5 }], now, horizonHours: 2, deps: { wgrib2Path: '/w', fetchImpl: rangeIgnored, noCache: true, ...decodeDeps('val=1e-08') } }),
    [null],
  );
});

test('fetchHrrrGrid serves a repeat request for the same cycle+points from cache', async () => {
  _resetGridCache();
  const now = Date.UTC(2026, 6, 22, 14, 37);
  let idxFetches = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('.idx')) { idxFetches++; return { ok: true, status: 200, text: async () => IDX, arrayBuffer: async () => new ArrayBuffer(0) }; }
    return { ok: true, status: 206, text: async () => '', arrayBuffer: async () => new Uint8Array([1]).buffer };
  };
  const params = { points: [{ lat: 41.5, lon: -97.5 }], now, horizonHours: 1, deps: { wgrib2Path: '/w', fetchImpl, ...decodeDeps('val=1e-08') } };
  const a = await fetchHrrrGrid(params);
  const fetchesAfterFirst = idxFetches;
  const b = await fetchHrrrGrid(params);
  assert.deepEqual(a, b);
  assert.equal(idxFetches, fetchesAfterFirst, 'second identical call hit the cache — no re-fetch');
  _resetGridCache();
});

test('fetchHrrrGrid coalesces concurrent identical requests into one decode', async () => {
  _resetGridCache();
  const now = Date.UTC(2026, 6, 22, 14, 37);
  let idxFetches = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('.idx')) {
      idxFetches++;
      // Yield so both concurrent callers reach the in-flight check before this resolves.
      await Promise.resolve();
      return { ok: true, status: 200, text: async () => IDX, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 206, text: async () => '', arrayBuffer: async () => new Uint8Array([1]).buffer };
  };
  const params = { points: [{ lat: 41.5, lon: -97.5 }], now, horizonHours: 1, deps: { wgrib2Path: '/w', fetchImpl, ...decodeDeps('val=1e-08') } };
  const [a, b] = await Promise.all([fetchHrrrGrid(params), fetchHrrrGrid(params)]);
  assert.deepEqual(a, b);
  assert.equal(idxFetches, 1, 'concurrent identical calls shared one decode — a single idx fetch');
  _resetGridCache();
});
