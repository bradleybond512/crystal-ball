// src-tauri/sidecar/wastewater-aggregate.mjs
//
// Aggregates CDC NWSS WWTP-level rows into state-level WastewaterSignal[].
//
// Today only the SARS-CoV-2 dataset (resource 2ew6-ywp6) is consumed, so every
// signal has pathogen='COVID-19'. The taxonomy is extensible — additional
// dataset feeds (flu, RSV, mpox, norovirus) tag rows with the matching
// pathogen value before passing them in.

const LEVEL_THRESHOLDS = { high: 80, elevated: 60, moderate: 40 };
const TREND_THRESHOLD_PCT = 25;
const SURGE_MIN_JURISDICTIONS = 3;

function toFinite(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function classifyLevel(percentile) {
  if (percentile == null || !Number.isFinite(percentile)) return 'low';
  if (percentile >= LEVEL_THRESHOLDS.high) return 'high';
  if (percentile >= LEVEL_THRESHOLDS.elevated) return 'elevated';
  if (percentile >= LEVEL_THRESHOLDS.moderate) return 'moderate';
  return 'low';
}

export function classifyTrend(ptc15d) {
  if (ptc15d == null || !Number.isFinite(ptc15d)) return 'stable';
  if (ptc15d > TREND_THRESHOLD_PCT) return 'increasing';
  if (ptc15d < -TREND_THRESHOLD_PCT) return 'decreasing';
  return 'stable';
}

export function aggregateWastewaterRows(rows, { pathogen = 'COVID-19' } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { signals: [], lastUpdated: null };
  }

  // Group rows by jurisdiction
  const byJurisdiction = new Map();
  for (const row of rows) {
    const jurisdiction = row?.wwtp_jurisdiction?.trim?.() || '';
    const dateEnd = row?.date_end?.trim?.() || '';
    if (!jurisdiction || !dateEnd) continue;
    const list = byJurisdiction.get(jurisdiction) ?? [];
    list.push({ ...row, _dateEnd: dateEnd });
    byJurisdiction.set(jurisdiction, list);
  }

  const signals = [];
  let latestUpdated = null;

  for (const [jurisdiction, jurisdictionRows] of byJurisdiction) {
    let maxDateEnd = '';
    for (const r of jurisdictionRows) {
      if (r._dateEnd > maxDateEnd) maxDateEnd = r._dateEnd;
    }
    const latestRows = jurisdictionRows.filter(r => r._dateEnd === maxDateEnd);

    const percentiles = latestRows.map(r => toFinite(r.percentile)).filter(v => v != null);
    const ptcs = latestRows.map(r => toFinite(r.ptc_15d)).filter(v => v != null);
    if (percentiles.length === 0 && ptcs.length === 0) continue;

    const medianPercentile = median(percentiles);
    const medianPtc = median(ptcs);

    signals.push({
      pathogen,
      jurisdiction,
      level: classifyLevel(medianPercentile),
      trend: classifyTrend(medianPtc),
      percentile15d: medianPercentile,
      ptc15d: medianPtc,
      lastUpdated: maxDateEnd,
    });

    if (latestUpdated == null || maxDateEnd > latestUpdated) {
      latestUpdated = maxDateEnd;
    }
  }

  signals.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));

  return { signals, lastUpdated: latestUpdated };
}

export function detectSurgeWatches(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  const counts = new Map();
  for (const signal of signals) {
    if (signal?.trend !== 'increasing') continue;
    const pathogen = signal.pathogen ?? 'unknown';
    counts.set(pathogen, (counts.get(pathogen) ?? 0) + 1);
  }
  const watches = [];
  for (const [pathogen, count] of counts) {
    if (count >= SURGE_MIN_JURISDICTIONS) {
      watches.push(`${pathogen} increasing in ${count} states`);
    }
  }
  return watches.sort();
}
