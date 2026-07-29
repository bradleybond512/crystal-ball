/**
 * NOAA HRRR-Smoke (MASSDEN) decode — the sidecar half of the gridded-model
 * upgrade for the smoke forecast field. The renderer's TS module
 * (src/services/smoke/hrrr-smoke.ts) owns the pure math and the *contract*;
 * this file owns the two things the browser cannot do:
 *
 *   1. fetch NOMADS server-side (no CORS, and the app host isn't the 403'd
 *      build sandbox), and
 *   2. decode the GRIB2 MASSDEN message by shelling out to `wgrib2`.
 *
 * The pure helpers below (cycle math, URL/idx/byte-range, AQI) are a
 * hand-kept port of the TS module and are pinned to it by
 * __tests__/hrrr-smoke-parity.test.mts — change one, change both.
 *
 * FAIL-CLOSED EVERYWHERE. If `wgrib2` isn't installed, if NOMADS is down, if a
 * message won't decode, every path yields nulls and the caller (the
 * /api/smoke/hrrr-grid route) reports `available:false`, so the renderer stays
 * on its Open-Meteo field. This layer can only ever *upgrade* the field, never
 * regress it.
 *
 * TWO NUMBERS HERE ARE NOT VERIFIABLE FROM THE BUILD SANDBOX (no wgrib2, and
 * NOMADS returns 403) and MUST be validated against a real decode on a Mac
 * with `wgrib2` installed — see docs/superpowers/plans/2026-07-22-hrrr-smoke-massden.md:
 *   • WGRIB2_VAL_RE — the exact `-lon` inventory output shape (`...:val=<x>`).
 *   • MASSDEN_TO_UGM3 — HRRR stores MASSDEN in SI kg/m³; ×1e9 → µg/m³. If a
 *     known reading comes back all-zero or pegged at AQI 500, this is wrong.
 *
 * Subprocess use here is execFile-with-args (no shell); lon/lat are coerced to
 * finite in-range numbers by the route before they reach `wgrib2`.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

const HOUR_MS = 3_600_000;
const NOMADS_BASE = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod';
const DEFAULT_FIELD = 'MASSDEN';
const DEFAULT_LEVEL = '8 m above ground';

/** SI kg/m³ (how HRRR stores MASSDEN) → µg/m³. See file header — validate live. */
const MASSDEN_TO_UGM3 = 1e9;
/** wgrib2 prints its undefined/missing sentinel as ~9.999e20 — reject those. */
const WGRIB2_MISSING_ABS = 1e19;
/** Physically-impossible surface smoke ⇒ decode/scale is wrong ⇒ fail closed. */
const MAX_PLAUSIBLE_UGM3 = 100_000;
/** Pull every `val=<number>` out of a wgrib2 `-lon` inventory line, in order. */
const WGRIB2_VAL_RE = /val=([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;

const pad2 = (n) => String(n).padStart(2, '0');

// ── Pure helpers (kept in parity with hrrr-smoke.ts) ───────────────────────

export function latestHrrrCycle(nowMs, latencyHours = 2) {
  const d = new Date(nowMs - latencyHours * HOUR_MS);
  const date = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  return { date, hour: d.getUTCHours() };
}

export function maxForecastHour(cycle) {
  return cycle.hour % 6 === 0 ? 48 : 18;
}

export function hrrrSmokeUrls(cycle, fh) {
  const grib = `${NOMADS_BASE}/hrrr.${cycle.date}/conus/hrrr.t${pad2(cycle.hour)}z.wrfsfcf${pad2(fh)}.grib2`;
  return { grib, idx: `${grib}.idx` };
}

export function parseIdxByteRange(idxText, sel) {
  const records = idxText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(':');
      const startRaw = parts[1] ?? '';
      return { start: startRaw === '' ? Number.NaN : Number(startRaw), field: parts[3] ?? '', level: parts[4] ?? '' };
    })
    .filter((r) => Number.isFinite(r.start) && r.start >= 0);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.field === sel.field && r.level === sel.level) {
      const next = records[i + 1];
      return { start: r.start, end: next ? next.start - 1 : null };
    }
  }
  return null;
}

export function rangeHeader(range) {
  return range.end === null ? `bytes=${range.start}-` : `bytes=${range.start}-${range.end}`;
}

const PM25_BREAKPOINTS = [
  { cLow: 0, cHigh: 9, aLow: 0, aHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, aLow: 51, aHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aLow: 101, aHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, aLow: 151, aHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, aLow: 201, aHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, aLow: 301, aHigh: 500 },
];

export function smokePm25ToUsAqi(ugm3) {
  if (ugm3 === null || !Number.isFinite(ugm3) || ugm3 < 0) return null;
  const c = Math.floor(ugm3 * 10) / 10;
  if (c > 325.4) return 500;
  for (const bp of PM25_BREAKPOINTS) {
    if (c >= bp.cLow && c <= bp.cHigh) {
      return Math.round(((bp.aHigh - bp.aLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.aLow);
    }
  }
  return 500;
}

export function cycleEpochMs(cycle) {
  const y = Number(cycle.date.slice(0, 4));
  const mo = Number(cycle.date.slice(4, 6));
  const day = Number(cycle.date.slice(6, 8));
  return Date.UTC(y, mo - 1, day, cycle.hour, 0, 0, 0);
}

// ── wgrib2 resolution + decode ─────────────────────────────────────────────

const WGRIB2_CANDIDATES = ['/opt/homebrew/bin/wgrib2', '/usr/local/bin/wgrib2', '/usr/bin/wgrib2'];

let _wgrib2Cache;

/** Search $PATH for a `wgrib2` binary (pure fs — no subprocess). */
function scanPathForWgrib2(env, exists) {
  const raw = env.PATH || '';
  for (const dir of raw.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'wgrib2');
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The vendored binary's production location. The Tauri host launches this
 * sidecar with LOCAL_API_RESOURCE_DIR pointing at the app's Resources dir, and
 * scripts/vendor-wgrib2.sh drops a signed, self-contained wgrib2 at
 * `<resources>/sidecar/wgrib2/wgrib2` (tauri.conf.json bundles `sidecar/wgrib2`).
 * Returns null when the env var is unset (dev/web) so the caller keeps looking.
 */
function bundledWgrib2FromResourceDir(env) {
  const dir = env.LOCAL_API_RESOURCE_DIR;
  if (!dir) return null;
  return path.join(dir, 'sidecar', 'wgrib2', 'wgrib2');
}

/**
 * Locate a usable `wgrib2`, or null. Order: explicit WGRIB2_PATH → an explicit
 * bundled override (WGRIB2_BUNDLED_PATH) → the vendored binary derived from
 * LOCAL_API_RESOURCE_DIR (the shipped default) → common Homebrew/system
 * locations → $PATH scan. Cached; null means "HRRR stays inert, caller falls back."
 */
export function resolveWgrib2Path(deps = {}) {
  const env = deps.env ?? process.env;
  const exists = deps.existsSync ?? existsSync;
  if (_wgrib2Cache !== undefined && !deps.noCache) return _wgrib2Cache;

  const resolved = firstUsableWgrib2(env, exists);
  if (!deps.noCache) _wgrib2Cache = resolved;
  return resolved;
}

/** Ordered wgrib2 search: explicit → bundled override → vendored → known dirs → $PATH. */
function firstUsableWgrib2(env, exists) {
  const preferred = [env.WGRIB2_PATH, env.WGRIB2_BUNDLED_PATH, bundledWgrib2FromResourceDir(env)];
  for (const p of preferred) {
    if (p && exists(p)) return p;
  }
  for (const c of WGRIB2_CANDIDATES) {
    if (exists(c)) return c;
  }
  return scanPathForWgrib2(env, exists);
}

/** @internal test hook — drop the cached wgrib2 path. */
export function _resetWgrib2Cache() {
  _wgrib2Cache = undefined;
}

/**
 * Parse a wgrib2 `-lon` inventory into per-point µg/m³. wgrib2 appends one
 * `val=<x>` per `-lon <lon> <lat>` it was given, in argument order, so for one
 * MASSDEN message the single output line carries `expected` values. Anything
 * other than exactly `expected` values (format drift, partial output) fails
 * closed to all-null rather than mis-aligning points. Missing sentinels and
 * out-of-range results become null per point.
 */
export function parseWgrib2Vals(stdout, expected) {
  const vals = [];
  for (const m of String(stdout ?? '').matchAll(WGRIB2_VAL_RE)) {
    vals.push(Number(m[1]));
  }
  if (vals.length !== expected) return Array.from({ length: expected }, () => null);
  return vals.map((raw) => {
    if (!Number.isFinite(raw) || Math.abs(raw) >= WGRIB2_MISSING_ABS) return null;
    const ugm3 = raw * MASSDEN_TO_UGM3;
    if (ugm3 < 0 || ugm3 > MAX_PLAUSIBLE_UGM3) return null;
    return ugm3;
  });
}

async function runWgrib2(wgrib2Path, args, deps) {
  const run = deps.execFileAsync ?? execFileAsync;
  const { stdout } = await run(wgrib2Path, args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/**
 * Decode one MASSDEN GRIB2 message (raw bytes) into µg/m³ at each point.
 * Writes the bytes to a temp file (wgrib2 reads files) and runs
 * `wgrib2 <file> -lon <lon> <lat> ...`, which prints the nearest-grid value
 * per point. Fails closed to all-null on any error; always cleans up the temp
 * file.
 */
export async function decodeMassdenAtPoints({ gribBytes, points, wgrib2Path, deps = {} }) {
  if (!wgrib2Path || points.length === 0) return points.map(() => null);
  const mkdtemp = deps.mkdtempSync ?? mkdtempSync;
  const write = deps.writeFileSync ?? writeFileSync;
  const rm = deps.rmSync ?? rmSync;
  const tmpRoot = deps.tmpdir ?? os.tmpdir();

  let dir = null;
  try {
    dir = mkdtemp(path.join(tmpRoot, 'hrrr-smoke-'));
    const file = path.join(dir, `${randomBytes(6).toString('hex')}.grib2`);
    write(file, Buffer.from(gribBytes));
    const args = [file];
    for (const p of points) args.push('-lon', String(p.lon), String(p.lat));
    const stdout = await runWgrib2(wgrib2Path, args, deps);
    return parseWgrib2Vals(stdout, points.length);
  } catch {
    return points.map(() => null);
  } finally {
    if (dir) { try { rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────

function fhRange(maxFh) {
  const out = [];
  for (let fh = 1; fh <= maxFh; fh++) out.push(fh);
  return out;
}

/** Bounded-concurrency map — keep NOMADS/wgrib2 load sane (default 6 in-flight). */
async function mapWithConcurrency(items, limit, fn) {
  const out = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Single-entry decode cache: the map re-fetches the field on a 30-min cadence
// and on every place change, but the HRRR cycle only advances hourly, so
// re-decoding the same points against the same cycle is pure waste. Keyed by
// cycle + horizon + a rounded-point fingerprint; short TTL so a new cycle wins.
const CACHE_TTL_MS = 20 * 60 * 1000;
let _gridCache = null;

function pointsFingerprint(points) {
  return points.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('|');
}

/** @internal test hook — clear the decode cache. */
export function _resetGridCache() {
  _gridCache = null;
}

/**
 * Fetch + decode the MASSDEN field for the requested points and return the
 * exact renderer contract: one { timesMs, usAqi } column per point (or null).
 * A drop-in for the Open-Meteo `fetchAqGrid` sampler.
 *
 * Sequence per forecast hour: GET the `.idx`, find the MASSDEN byte range,
 * Range-GET only that message (must be 206 — a 200 means the server ignored
 * the range and sent the whole ~130 MB file), decode at every point. Any hour
 * that fails is skipped; a partial cycle is still a usable field. Returns
 * all-null when nothing decoded so the caller falls back to Open-Meteo.
 */
export async function fetchHrrrGrid(params) {
  const {
    points,
    now,
    latencyHours = 2,
    horizonHours = 24,
    field = DEFAULT_FIELD,
    level = DEFAULT_LEVEL,
    concurrency = 6,
    deps = {},
  } = params;
  const allNull = () => points.map(() => null);
  if (!Array.isArray(points) || points.length === 0) return [];

  const wgrib2Path = deps.wgrib2Path ?? resolveWgrib2Path(deps);
  if (!wgrib2Path) return allNull();

  const fetchImpl = deps.fetchImpl ?? fetch;
  const cycle = latestHrrrCycle(now, latencyHours);
  const maxFh = Math.min(horizonHours, maxForecastHour(cycle));
  const fingerprint = pointsFingerprint(points);
  const cacheKey = `${cycle.date}t${cycle.hour}|${maxFh}|${fingerprint}`;

  if (!deps.noCache && _gridCache && _gridCache.key === cacheKey && now - _gridCache.at < CACHE_TTL_MS) {
    return _gridCache.grid;
  }

  const cycleMs = cycleEpochMs(cycle);
  const decoded = await mapWithConcurrency(fhRange(maxFh), concurrency, async (fh) => {
    try {
      const { grib, idx } = hrrrSmokeUrls(cycle, fh);
      const idxRes = await fetchImpl(idx);
      if (!idxRes.ok) return null;
      const range = parseIdxByteRange(await idxRes.text(), { field, level });
      if (!range) return null;
      const msgRes = await fetchImpl(grib, { headers: { Range: rangeHeader(range) } });
      if (msgRes.status !== 206) return null;
      const bytes = new Uint8Array(await msgRes.arrayBuffer());
      const ugm3ByPoint = await decodeMassdenAtPoints({ gribBytes: bytes, points, wgrib2Path, deps });
      if (!ugm3ByPoint.some((v) => v !== null)) return null;
      return { validMs: cycleMs + fh * HOUR_MS, ugm3ByPoint };
    } catch {
      return null;
    }
  });

  const hours = decoded.filter(Boolean).sort((a, b) => a.validMs - b.validMs);
  if (hours.length === 0) return allNull();

  const timesMs = hours.map((h) => h.validMs);
  const grid = points.map((_, i) => {
    const usAqi = hours.map((h) => smokePm25ToUsAqi(h.ugm3ByPoint[i] ?? null));
    return usAqi.some((v) => v !== null) ? { timesMs, usAqi } : null;
  });

  if (!deps.noCache) _gridCache = { key: cacheKey, at: now, grid };
  return grid;
}
