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
function toUtcIsoTag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const tag = raw.trim().replace(' ', 'T');
  if (!tag) return '';
  // Only a date-TIME can take a Z; appending one to a bare date yields NaN.
  if (!/\d{2}:\d{2}/.test(tag)) return tag;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(tag)) return tag;
  return `${tag}Z`;
}

// Number(null) is 0 — a plausible-looking "quiet" reading — so absent values
// must be rejected on identity before coercing.
function finiteOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
    const at = Date.parse(toUtcIsoTag(row.time_tag));
    if (!Number.isFinite(at)) continue;
    const kp = finiteOrNull(row.Kp);
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

const WIND_COLUMNS: readonly WindColumn[] = ['speed', 'density', 'bz'];

/** Fills every field this row can supply that's still missing. True if it contributed. */
function fillWindFields(out: SolarWindSample, row: readonly unknown[], idx: WindColumnIndex): boolean {
  let used = false;
  for (const field of WIND_COLUMNS) {
    if (out[field] !== null || idx[field] < 0) continue;
    const value = finiteOrNull(row[idx[field]]);
    if (value === null) continue;
    out[field] = value;
    used = true;
  }
  return used;
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

  for (let i = rows.length - 1; i > 0; i -= 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const cells = row as readonly unknown[];
    if (fillWindFields(out, cells, idx) && out.observedAt === null && idx.time >= 0) {
      out.observedAt = toUtcIsoTag(cells[idx.time]) || null;
    }
    if (out.speed !== null && out.density !== null && out.bz !== null) break;
  }
  return out;
}

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
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

// Every SWPC alert opens with "Space Weather Message Code: ...", so the
// severity keyword and the human-readable headline live on a LATER line.
// Longer keywords lead so CANCEL/EXTENDED win over bare WARNING — and
// CANCEL WARNING is an all-clear, which must never read as an active warning.
const SEVERITY_PREFIXES: readonly [string, SpaceWeatherAlert['severity']][] = [
  ['CANCEL WARNING:', 'summary'],
  ['EXTENDED WARNING:', 'warning'],
  ['WARNING:', 'warning'],
  ['ALERT:', 'alert'],
  ['WATCH:', 'watch'],
  ['SUMMARY:', 'summary'],
];

function classifyAlert(message: string): { headline: string; severity: SpaceWeatherAlert['severity'] } {
  for (const rawLine of message.split('\n')) {
    const line = rawLine.trim();
    const upper = line.toUpperCase();
    for (const [prefix, severity] of SEVERITY_PREFIXES) {
      if (upper.startsWith(prefix)) return { headline: line, severity };
    }
  }
  return { headline: message.split('\n')[0]?.trim() ?? '', severity: 'summary' };
}

/**
 * products/alerts.json — newest-first array of { product_id, issue_datetime,
 * message }. Entries outside the window are dropped and the remainder is sorted
 * newest-first here rather than trusting upstream order.
 */
export function parseAlerts(
  raw: unknown,
  nowMs: number,
  windowMs = 24 * 60 * 60 * 1000,
  cap = 20,
): SpaceWeatherAlert[] {
  if (!Array.isArray(raw)) return [];
  const cutoff = nowMs - windowMs;
  const dated: { at: number; alert: SpaceWeatherAlert }[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const message = typeof row.message === 'string' ? row.message : '';
    if (!message) continue;
    const tag = toUtcIsoTag(row.issue_datetime);
    const at = Date.parse(tag);
    // An unparseable timestamp can't be windowed, so it can't be shown as
    // recent — drop it rather than render an Invalid Date.
    if (!Number.isFinite(at) || at < cutoff) continue;
    const { headline, severity } = classifyAlert(message);
    dated.push({ at, alert: { id: tag, message: headline, issuedAt: new Date(at), severity } });
  }
  dated.sort((a, b) => b.at - a.at);
  return dated.slice(0, cap).map((entry) => entry.alert);
}
