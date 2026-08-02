/**
 * Pure parsing half of the SWPC space-weather fetcher — zero imports beyond
 * types so fixture tests run under tsx without the Vite alias chain.
 *
 * Each parser takes the RAW upstream payload for one SWPC product and is
 * total: malformed input yields null/[] rather than throwing. The shapes differ
 * per product and are NOT interchangeable — that assumption is what silently
 * emptied this panel.
 */

export interface SpaceWeatherAlert {
  id: string;
  message: string;
  issuedAt: Date;
  severity: 'watch' | 'warning' | 'alert' | 'summary';
}

export interface SolarWindSample {
  speed: number | null; // km/s
  density: number | null; // protons/cm³
  bz: number | null; // nT
  observedAt: string | null;
}

// SWPC stamps naïve UTC ("2026-07-30T12:00:00", "2026-07-30 19:03:19.350"),
// which Date.parse reads as LOCAL time — so a UTC-5 host reads the newest bins
// as future-dated. Stamping the Z here, rather than at each call site, means
// every consumer inherits the fix. Mirrors toUtcIsoTag in the sidecar.
export function toUtcIsoTag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const tag = raw.trim().replace(' ', 'T');
  if (!tag) return '';
  // Only a date-TIME can take a Z; appending one to a bare date yields NaN.
  if (!/\d{2}:\d{2}/.test(tag)) return tag;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(tag)) return tag;
  return `${tag}Z`;
}

// Number() maps null, '', '   ', false and [] all to 0 — a plausible-looking
// "quiet" reading. Absent or wrong-typed values are therefore rejected on TYPE
// rather than coerced: only a number or a numeric string is a reading.
function finiteOrNull(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Physically impossible readings are corrupt data, not measurements. Rendering
// "Kp 999" or a negative particle density as fact is worse than rendering
// nothing, and a bogus extreme would trip the Kp≥5 storm alerting downstream.
function inRangeOrNull(raw: unknown, min: number, max: number): number | null {
  const n = finiteOrNull(raw);
  if (n === null || n < min || n > max) return null;
  return n;
}

/** Parseable instant for a naïve-or-zoned SWPC tag, or null. */
function instantOrNull(raw: unknown): number | null {
  const at = Date.parse(toUtcIsoTag(raw));
  return Number.isFinite(at) ? at : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * products/noaa-planetary-k-index.json — an array of OBJECTS carrying a
 * capital-K `Kp`, NOT the header-row + array-of-arrays shape the 1-minute
 * products use. Returns the newest usable bin's Kp.
 */
export function parseKpFeed(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  let latest: { at: number; kp: number } | null = null;
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const at = instantOrNull(row.time_tag);
    if (at === null) continue;
    const kp = inRangeOrNull(row.Kp, KP_MIN, KP_MAX);
    if (kp === null) continue;
    // Newest wins by timestamp rather than by position — array order is an
    // upstream detail we shouldn't depend on.
    if (!latest || at >= latest.at) latest = { at, kp };
  }
  return latest?.kp ?? null;
}

/**
 * products/geospace/propagated-solar-wind-1-hour.json — a header row followed
 * by data rows, carrying speed, density and bz together.
 *
 * Columns are resolved BY NAME, never by index: positional assumptions about
 * SWPC payloads are exactly what broke this file. Each field is taken from the
 * newest row that actually carries it, so a gap in the trailing row doesn't
 * null out the whole panel; staleness is bounded by construction because the
 * product only spans one hour.
 */
type WindColumn = 'speed' | 'density' | 'bz';
type WindColumnIndex = Record<WindColumn | 'time', number>;

// Bounds are generous envelopes around the physically observed range, not
// forecasting limits: fast solar wind tops out near 1000 km/s, the record ACE
// density spike was ~100 p/cm³, and |Bz| beyond 100 nT has never been measured
// at L1. Anything outside is a corrupt cell, not a reading.
const KP_MIN = 0;
const KP_MAX = 9;
const WIND_BOUNDS: Readonly<Record<WindColumn, readonly [number, number]>> = {
  speed: [0, 3000],
  density: [0, 500],
  bz: [-500, 500],
};

const WIND_COLUMNS: readonly WindColumn[] = ['speed', 'density', 'bz'];

/** Fills every field this row can supply that's still missing. True if it contributed. */
function fillWindFields(out: SolarWindSample, row: readonly unknown[], idx: WindColumnIndex): boolean {
  let used = false;
  for (const field of WIND_COLUMNS) {
    if (out[field] !== null || idx[field] < 0) continue;
    const [min, max] = WIND_BOUNDS[field];
    const value = inRangeOrNull(row[idx[field]], min, max);
    if (value === null) continue;
    out[field] = value;
    used = true;
  }
  return used;
}

/**
 * Data rows newest-first. Rows carrying a parseable `time_tag` are ordered by
 * that instant rather than by position — upstream ordering is a detail we
 * shouldn't depend on, and an unparseable tag can't be aged, so it must not be
 * allowed to become `observedAt`. Without a time column at all, reverse
 * positional order is the only signal available.
 */
function orderedWindRows(
  rows: readonly unknown[],
  timeIdx: number,
): { cells: readonly unknown[]; at: number | null }[] {
  const out: { cells: readonly unknown[]; at: number | null }[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const cells = row as readonly unknown[];
    out.push({ cells, at: timeIdx >= 0 ? instantOrNull(cells[timeIdx]) : null });
  }
  if (timeIdx < 0) return out.reverse();
  // Timestamped rows first, newest to oldest; undatable rows keep their
  // relative order at the back so their values are still available as a
  // last resort but can never supply observedAt.
  return out.sort((a, b) => {
    if (a.at === null) return b.at === null ? 0 : 1;
    if (b.at === null) return -1;
    return b.at - a.at;
  });
}

export function parseSolarWindFeed(raw: unknown): SolarWindSample {
  const out: SolarWindSample = { speed: null, density: null, bz: null, observedAt: null };
  if (!Array.isArray(raw) || raw.length < 2) return out;

  const rows = raw as readonly unknown[];
  const headerRow = rows[0];
  if (!Array.isArray(headerRow)) return out;
  const header = (headerRow as readonly unknown[])
    .map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : ''));

  const idx: WindColumnIndex = {
    speed: header.indexOf('speed'),
    density: header.indexOf('density'),
    bz: header.indexOf('bz'),
    time: header.indexOf('time_tag'),
  };

  for (const { cells, at } of orderedWindRows(rows, idx.time)) {
    if (fillWindFields(out, cells, idx) && out.observedAt === null && at !== null) {
      out.observedAt = new Date(at).toISOString();
    }
    if (out.speed !== null && out.density !== null && out.bz !== null) break;
  }
  return out;
}

/**
 * A GOES flare class is a letter A/B/C/M/X with an optional magnitude ("M2.4",
 * "X1", "C9.9") and nothing else.
 *
 * Without the grammar, any non-empty string passed through: a status or
 * maintenance placeholder like "unknown" would be displayed as the current
 * flare class AND counted as a successfully parsed field, which clears the
 * freshness error and caches the result. Rejecting on shape keeps a non-reading
 * from being mistaken for a reading. Mirrored by SWPC_XRAY_CLASS_RE in the
 * sidecar.
 */
const XRAY_CLASS_RE = /^[ABCMX]\d*(?:\.\d+)?$/i;

/**
 * json/goes/primary/xray-flares-latest.json — a single-element array describing
 * the latest flare. `max_class` is the peak, `current_class` the live reading.
 */
export function parseXrayClass(raw: unknown): string | null {
  const rows = Array.isArray(raw) ? raw : [raw];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const key of ['max_class', 'current_class', 'class']) {
      const value = row[key];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (XRAY_CLASS_RE.test(trimmed)) return trimmed.toUpperCase();
    }
  }
  return null;
}

// Every SWPC alert opens with "Space Weather Message Code: ...", so the
// severity keyword and the human-readable headline live on a LATER line.
//
// These eight are the complete set emitted across a live 30-day window of
// products/alerts.json — enumerated, not guessed. Longer phrases lead so the
// CANCEL/CONTINUED/EXTENDED qualifiers are matched before the bare keyword.
// The two CANCEL forms are all-clears and must never read as active.
const SEVERITY_PREFIXES: readonly [string, SpaceWeatherAlert['severity']][] = [
  ['CANCEL WARNING:', 'summary'],
  ['CANCEL ALERT:', 'summary'],
  ['CONTINUED ALERT:', 'alert'],
  ['EXTENDED WARNING:', 'warning'],
  ['WARNING:', 'warning'],
  ['ALERT:', 'alert'],
  ['WATCH:', 'watch'],
  ['SUMMARY:', 'summary'],
];

export function classifyAlert(message: string): { headline: string; severity: SpaceWeatherAlert['severity'] } {
  let firstLine = '';
  for (const rawLine of message.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (firstLine === '') firstLine = line;
    const upper = line.toUpperCase();
    for (const [prefix, severity] of SEVERITY_PREFIXES) {
      if (upper.startsWith(prefix)) return { headline: line, severity };
    }
  }
  // No keyword line at all — fall back to the opening line so the alert is
  // still shown rather than silently dropped.
  return { headline: firstLine, severity: 'summary' };
}

/**
 * products/alerts.json — newest-first array of { product_id, issue_datetime,
 * message }. Entries outside the window are dropped and the remainder is sorted
 * newest-first here rather than trusting upstream order.
 */
/**
 * Clock skew between this host and SWPC is normal and small; a genuinely
 * future-stamped alert is corrupt. Exported so swpc-monitor uses the same
 * number rather than its own — the two paths feeding the same panel must agree
 * on whether a given alert exists. The sidecar's JS twin repeats the value and
 * is held to it by __tests__/spaceweather-parity.test.mjs.
 */
export const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export function parseAlerts(
  raw: unknown,
  nowMs: number,
  windowMs = 24 * 60 * 60 * 1000,
  cap = 20,
): SpaceWeatherAlert[] {
  if (!Array.isArray(raw)) return [];
  const cutoff = nowMs - windowMs;
  // A future-stamped alert would sort to the top of the list and render "in 3
  // hours". Tolerating a few minutes keeps a slow local clock from dropping the
  // newest alerts — the exact silent-drop this parser exists to avoid — while
  // still rejecting nonsense.
  const horizon = nowMs + FUTURE_SKEW_TOLERANCE_MS;
  const dated: { at: number; alert: SpaceWeatherAlert }[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const message = typeof row.message === 'string' ? row.message : '';
    if (!message) continue;
    const tag = toUtcIsoTag(row.issue_datetime);
    const at = Date.parse(tag);
    // An unparseable timestamp can't be windowed, so it can't be shown as
    // recent — drop it rather than render an Invalid Date.
    if (!Number.isFinite(at) || at < cutoff || at > horizon) continue;
    const { headline, severity } = classifyAlert(message);
    // Keyed on product AND time, matching swpc-monitor and the sidecar. SWPC
    // routinely issues several products on the same second, so a time-only id
    // lets them overwrite each other in any consumer that dedupes by id.
    const productId = typeof row.product_id === 'string' && row.product_id ? row.product_id : 'swpc';
    dated.push({
      at,
      alert: { id: `${productId}-${String(row.issue_datetime)}`, message: headline, issuedAt: new Date(at), severity },
    });
  }
  dated.sort((a, b) => b.at - a.at);
  return dated.slice(0, cap).map((entry) => entry.alert);
}
