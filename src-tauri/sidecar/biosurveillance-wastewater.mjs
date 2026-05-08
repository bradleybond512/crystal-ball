// src-tauri/sidecar/biosurveillance-wastewater.mjs
//
// Site-level + state-rollup aggregator for the /api/biosurveillance/wastewater
// route (PR new). Mirrors the pure TS logic in
// src/services/biosurveillance/wastewater-service.ts so both sides
// agree on shape and thresholds.

const TREND_PCT_THRESHOLD = 25;
const LEVEL_PERCENTILE = { high: 80, elevated: 60, moderate: 40 };

const STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
};

function toFinite(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toStr(x, fallback = '') {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return fallback;
}

function normalizeStateCode(jurisdiction) {
  const trimmed = String(jurisdiction ?? '').trim();
  if (trimmed.length === 2 && /^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return STATE_NAME_TO_CODE[trimmed.toLowerCase()] ?? trimmed;
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function classifyLevel(p) {
  if (p === null || !Number.isFinite(p)) return 'low';
  if (p >= LEVEL_PERCENTILE.high) return 'high';
  if (p >= LEVEL_PERCENTILE.elevated) return 'elevated';
  if (p >= LEVEL_PERCENTILE.moderate) return 'moderate';
  return 'low';
}

function classifyTrend(p) {
  if (p === null || !Number.isFinite(p)) return 'stable';
  if (p > TREND_PCT_THRESHOLD) return 'rising';
  if (p < -TREND_PCT_THRESHOLD) return 'falling';
  return 'stable';
}

function parseRow(r) {
  if (!r || typeof r !== 'object') return null;
  const dateEnd = toStr(r.date_end);
  if (!dateEnd) return null;
  const stateRaw = toStr(r.wwtp_jurisdiction);
  if (!stateRaw) return null;
  const siteId = toStr(r.key_plot_id) || `${stateRaw}-${toStr(r.county_names)}-${dateEnd}`;
  const percentile = toFinite(r.percentile);
  const ptc = toFinite(r.ptc_15d);
  if (percentile === null && ptc === null) return null;
  return {
    siteId,
    siteName: toStr(r.wwtp_name) || siteId,
    stateCode: normalizeStateCode(stateRaw),
    state: stateRaw,
    county: toStr(r.county_names) || undefined,
    populationServed: toFinite(r.population_served) ?? undefined,
    lastReport: dateEnd,
    percentile15d: percentile,
    ptc15d: ptc,
    trend: classifyTrend(ptc),
    level: classifyLevel(percentile),
  };
}

function bucketBoundaries(now, numBuckets, daysPerBucket) {
  const dayMs = 24 * 60 * 60 * 1000;
  const out = [];
  for (let i = numBuckets - 1; i >= 0; i -= 1) {
    const end = now - i * daysPerBucket * dayMs;
    const start = end - daysPerBucket * dayMs;
    out.push([start, end]);
  }
  return out;
}

function bucketIndex(ts, buckets) {
  for (const [i, [start, end]] of buckets.entries()) {
    if (ts >= start && ts < end) return i;
  }
  return -1;
}

function emptyResult(now) {
  return {
    national: { trend: 'stable', medianPercentile15d: null, activeStates: 0, risingStates: 0 },
    states: [],
    topSites: [],
    asOfDate: null,
    fetchedAt: new Date(now).toISOString(),
  };
}

function dedupeSitesByLatest(rows) {
  const bySite = new Map();
  for (const r of rows) {
    const snap = parseRow(r);
    if (!snap) continue;
    const existing = bySite.get(snap.siteId);
    if (!existing || snap.lastReport > existing.lastReport) bySite.set(snap.siteId, snap);
  }
  return [...bySite.values()];
}

function buildStateRollups(sites) {
  const byState = new Map();
  for (const s of sites) {
    const list = byState.get(s.stateCode) ?? [];
    list.push(s);
    byState.set(s.stateCode, list);
  }
  const rollups = [];
  for (const [stateCode, list] of byState) {
    const percentiles = list.map(s => s.percentile15d).filter(v => v !== null);
    const ptcs = list.map(s => s.ptc15d).filter(v => v !== null);
    const medianPercentile = median(percentiles);
    const medianPtc = median(ptcs);
    let populationCovered = 0;
    for (const s of list) populationCovered += s.populationServed ?? 0;
    rollups.push({
      state: list[0].state,
      stateCode,
      siteCount: list.length,
      medianPercentile15d: medianPercentile,
      medianPtc15d: medianPtc,
      trend: classifyTrend(medianPtc),
      level: classifyLevel(medianPercentile),
      sparkline4w: [],
      populationCovered,
    });
  }
  rollups.sort((a, b) => (b.medianPercentile15d ?? -1) - (a.medianPercentile15d ?? -1));
  return rollups;
}

function collectWeeklyBuckets(rows, now) {
  const buckets = bucketBoundaries(now, 4, 7);
  const collector = new Map();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const dateStr = toStr(r.date_end);
    if (!dateStr) continue;
    const ts = Date.parse(dateStr);
    if (!Number.isFinite(ts)) continue;
    const idx = bucketIndex(ts, buckets);
    if (idx < 0) continue;
    const code = normalizeStateCode(toStr(r.wwtp_jurisdiction));
    if (!code) continue;
    const p = toFinite(r.percentile);
    if (p === null) continue;
    const stateBuckets = collector.get(code) ?? Array.from({ length: 4 }, () => []);
    stateBuckets[idx].push(p);
    collector.set(code, stateBuckets);
  }
  return collector;
}

function attachSparklines(rollups, collector) {
  for (const r of rollups) {
    const stateBuckets = collector.get(r.stateCode);
    r.sparkline4w = stateBuckets
      ? stateBuckets.map(bucket => median(bucket) ?? 0)
      : [0, 0, 0, 0];
  }
}

function pickTopSites(sites) {
  return sites
    .filter(s => s.percentile15d !== null || s.ptc15d !== null)
    .sort((a, b) => {
      const ap = a.percentile15d ?? -Infinity;
      const bp = b.percentile15d ?? -Infinity;
      if (bp !== ap) return bp - ap;
      const at = a.ptc15d ?? -Infinity;
      const bt = b.ptc15d ?? -Infinity;
      return bt - at;
    })
    .slice(0, 10);
}

function buildNationalSummary(rollups) {
  const allPercentiles = rollups.map(r => r.medianPercentile15d).filter(v => v !== null);
  const nationalMedian = median(allPercentiles);
  let rising = 0;
  let falling = 0;
  for (const r of rollups) {
    if (r.trend === 'rising') rising += 1;
    if (r.trend === 'falling') falling += 1;
  }
  let trend = 'stable';
  if (rising >= rollups.length * 0.4 && rising > falling) trend = 'rising';
  else if (falling >= rollups.length * 0.4 && falling > rising) trend = 'falling';
  return { trend, medianPercentile15d: nationalMedian, activeStates: rollups.length, risingStates: rising };
}

function findAsOfDate(sites) {
  let asOf = null;
  for (const s of sites) if (asOf === null || s.lastReport > asOf) asOf = s.lastReport;
  return asOf;
}

export function buildBiosurveillanceWastewater(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return emptyResult(now);
  const sites = dedupeSitesByLatest(rows);
  const rollups = buildStateRollups(sites);
  attachSparklines(rollups, collectWeeklyBuckets(rows, now));
  return {
    national: buildNationalSummary(rollups),
    states: rollups,
    topSites: pickTopSites(sites),
    asOfDate: findAsOfDate(sites),
    fetchedAt: new Date(now).toISOString(),
  };
}
