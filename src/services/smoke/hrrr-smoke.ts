/**
 * NOAA HRRR-Smoke (MASSDEN) ingestion core — the gridded-model upgrade path
 * for the smoke forecast field. Open-Meteo/CAMS backs `forecast-field.ts`
 * today; HRRR-Smoke is a true CONUS smoke model at 3 km / hourly, so this
 * module lets the fetch layer swap the sampler behind `assembleForecastField`
 * without touching the map or the pure field math.
 *
 * Everything here is pure + injected: URL/idx/byte-range/AQI math is
 * deterministic, and the network `fetchImpl` and the GRIB2 `decoder` are
 * parameters so the whole pipeline is fixture-testable under tsx. The single
 * piece that CANNOT be verified from the build sandbox — the GRIB2 MASSDEN
 * binary decode (NOMADS returns 403 here) — is deliberately left as the
 * `GribSmokeDecoder` seam: with no decoder the path yields null and callers
 * stay on Open-Meteo, so it can never regress the working forecast field.
 * See docs/superpowers/plans/2026-07-22-hrrr-smoke-massden.md.
 *
 * The .idx trick is the whole point: HRRR wrfsfc files are ~130 MB, but the
 * matching `.idx` sidecar lists every record's start byte, so we Range-GET
 * only the MASSDEN message (a few MB) instead of the whole file.
 *
 * No @/ imports — pure, like the other smoke modules.
 */
import type { GridPointAq } from './forecast-field';

const HOUR_MS = 3_600_000;
const NOMADS_BASE = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod';
/** Near-surface smoke in HRRR wrfsfc: MASSDEN at "8 m above ground". */
const DEFAULT_FIELD = 'MASSDEN';
const DEFAULT_LEVEL = '8 m above ground';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A HRRR model cycle in UTC. `date` is YYYYMMDD, `hour` is 0–23. */
export interface HrrrCycle {
  date: string;
  hour: number;
}

/** A byte range within the GRIB2 file. `end` null ⇒ open-ended (last record). */
export interface ByteRange {
  start: number;
  end: number | null;
}

/**
 * One decoded forecast hour of the MASSDEN field. `sample(lat, lon)` returns
 * near-surface smoke PM2.5 in µg/m³, or null outside the CONUS domain / no
 * data. The concrete geometry lives inside the decoder; this module only ever
 * samples, so a fake grid drops straight into the tests.
 */
export interface HrrrSmokeGrid {
  /** Valid time of this forecast hour, epoch ms. */
  validMs: number;
  sample: (lat: number, lon: number) => number | null;
}

/**
 * The unverifiable seam. Decodes one Range-GET'd MASSDEN GRIB2 message into a
 * samplable grid. LEFT UNIMPLEMENTED on purpose — the GRIB2 binary decode
 * could not be verified against live NOMADS (403 from the build sandbox).
 * Recommended host: wgrib2 in the Tauri sidecar (see the plan doc). Until a
 * decoder is injected, `fetchHrrrSmokeGrids` returns null and every caller
 * keeps its existing Open-Meteo source — no regression path.
 */
export type GribSmokeDecoder = (bytes: Uint8Array, validMs: number) => HrrrSmokeGrid | null;

/** Minimal fetch shape — global `fetch` satisfies it; tests inject a fake. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/**
 * Latest available HRRR cycle for `nowMs`, backing off `latencyHours` for the
 * NOMADS publish lag and flooring to the top of the UTC hour.
 */
export function latestHrrrCycle(nowMs: number, latencyHours = 2): HrrrCycle {
  const d = new Date(nowMs - latencyHours * HOUR_MS);
  const date = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  return { date, hour: d.getUTCHours() };
}

/** HRRR runs 48 h forecasts on the 6-hourly cycles (00/06/12/18Z), else 18 h. */
export function maxForecastHour(cycle: HrrrCycle): number {
  return cycle.hour % 6 === 0 ? 48 : 18;
}

/** NOMADS GRIB2 + .idx URLs for a cycle + forecast hour. */
export function hrrrSmokeUrls(cycle: HrrrCycle, fh: number): { grib: string; idx: string } {
  const grib = `${NOMADS_BASE}/hrrr.${cycle.date}/conus/hrrr.t${pad2(cycle.hour)}z.wrfsfcf${pad2(fh)}.grib2`;
  return { grib, idx: `${grib}.idx` };
}

/**
 * Find the byte range of one GRIB2 record from the `.idx` sidecar. Lines are
 * `recnum:startbyte:reftime:VAR:LEVEL:fcst:` — a record ends one byte before
 * the next record's start; the final record is open-ended (end = null).
 * Returns null when the field/level pair isn't present.
 */
export function parseIdxByteRange(
  idxText: string,
  sel: { field: string; level: string },
): ByteRange | null {
  const records = idxText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(':');
      return { start: Number(parts[1]), field: parts[3] ?? '', level: parts[4] ?? '' };
    })
    .filter((r) => Number.isFinite(r.start));

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.field === sel.field && r.level === sel.level) {
      const next = records[i + 1];
      return { start: r.start, end: next ? next.start - 1 : null };
    }
  }
  return null;
}

/** HTTP Range header for a byte range (open-ended when end is null). */
export function rangeHeader(range: ByteRange): string {
  return range.end === null ? `bytes=${range.start}-` : `bytes=${range.start}-${range.end}`;
}

// EPA AQI PM2.5 breakpoints — 2024 revision (final rule eff. 2024-05-06).
const PM25_BREAKPOINTS: readonly { cLow: number; cHigh: number; aLow: number; aHigh: number }[] = [
  { cLow: 0, cHigh: 9, aLow: 0, aHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, aLow: 51, aHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, aLow: 101, aHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, aLow: 151, aHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, aLow: 201, aHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, aLow: 301, aHigh: 500 },
];

/**
 * Convert near-surface smoke PM2.5 (µg/m³) to US AQI with the EPA 2024
 * breakpoints. The concentration is truncated to 0.1 µg/m³ first (per EPA
 * method), the result is capped at 500, and null/NaN/negative yields null.
 */
export function smokePm25ToUsAqi(ugm3: number | null): number | null {
  if (ugm3 === null || !Number.isFinite(ugm3) || ugm3 < 0) return null;
  const c = Math.floor(ugm3 * 10) / 10; // truncate to 0.1 µg/m³
  if (c > 325.4) return 500;
  for (const bp of PM25_BREAKPOINTS) {
    if (c >= bp.cLow && c <= bp.cHigh) {
      return Math.round(((bp.aHigh - bp.aLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.aLow);
    }
  }
  return 500;
}

function cycleEpochMs(cycle: HrrrCycle): number {
  const y = Number(cycle.date.slice(0, 4));
  const mo = Number(cycle.date.slice(4, 6));
  const day = Number(cycle.date.slice(6, 8));
  return Date.UTC(y, mo - 1, day, cycle.hour, 0, 0, 0);
}

export interface FetchHrrrSmokeParams {
  cycle: HrrrCycle;
  forecastHours: number[];
  decoder: GribSmokeDecoder;
  fetchImpl: FetchLike;
  field?: string;
  level?: string;
}

/**
 * Fetch + decode the MASSDEN field for each forecast hour: GET the `.idx`,
 * parse the MASSDEN byte range, Range-GET just that record, hand the bytes to
 * the injected decoder. Any hour that fails (network, missing record, decoder
 * null) is skipped — a partial cycle is still a usable field. Returns null
 * only when nothing decoded, so the caller can fall back to Open-Meteo.
 */
export async function fetchHrrrSmokeGrids(params: FetchHrrrSmokeParams): Promise<HrrrSmokeGrid[] | null> {
  const { cycle, forecastHours, decoder, fetchImpl } = params;
  const field = params.field ?? DEFAULT_FIELD;
  const level = params.level ?? DEFAULT_LEVEL;
  const cycleMs = cycleEpochMs(cycle);

  const grids: HrrrSmokeGrid[] = [];
  for (const fh of forecastHours) {
    try {
      const { grib, idx } = hrrrSmokeUrls(cycle, fh);
      const idxRes = await fetchImpl(idx);
      if (!idxRes.ok) continue;
      const range = parseIdxByteRange(await idxRes.text(), { field, level });
      if (!range) continue;
      const msgRes = await fetchImpl(grib, { headers: { Range: rangeHeader(range) } });
      if (!msgRes.ok) continue;
      const grid = decoder(new Uint8Array(await msgRes.arrayBuffer()), cycleMs + fh * HOUR_MS);
      if (grid) grids.push(grid);
    } catch {
      // Skip this hour; a partial cycle still produces a usable field.
    }
  }
  return grids.length > 0 ? grids : null;
}

/**
 * Sample decoded grids at each grid point into the exact `GridPointAq` shape
 * `assembleForecastField` consumes — a drop-in for the Open-Meteo
 * `fetchAqGrid` sampler. Grids are ordered by valid time; each point's PM2.5
 * samples are converted to US AQI. A point with no data at any hour yields
 * null (fail-closed — an empty column must not render as uniformly "good").
 */
export function hrrrGridsToGridPoints(
  grids: readonly HrrrSmokeGrid[],
  points: readonly { lat: number; lon: number }[],
): (GridPointAq | null)[] {
  if (grids.length === 0) return points.map(() => null);
  const sorted = [...grids].sort((a, b) => a.validMs - b.validMs);
  const timesMs = sorted.map((g) => g.validMs);
  return points.map((pt) => {
    const usAqi = sorted.map((g) => smokePm25ToUsAqi(g.sample(pt.lat, pt.lon)));
    return usAqi.some((v) => v !== null) ? { timesMs, usAqi } : null;
  });
}
