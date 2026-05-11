/**
 * USGS Water Services stream gauge proxy.
 * Returns active gauges with stage readings (parameterCd=00065 = gauge height in feet).
 * Summarizes flood-stage counts; full gauge list is large (~13k sites).
 * No API key required — public USGS data.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
const USGS_URL =
  'https://waterservices.usgs.gov/nwis/iv/?format=json&parameterCd=00065&siteStatus=active&period=PT2H';

// USGS action/flood stage qualifiers in the value/qualifier array
const STAGE_KEYWORDS_RE = /flood|action|major|moderate|minor/i;

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });

function classifyStage(valueStr, qualifiers) {
  const val = Number.parseFloat(valueStr);
  if (Number.isNaN(val)) return 'unknown';
  // Qualifier-based stage classification when USGS provides it
  const qualText = (qualifiers ?? []).join(' ');
  if (STAGE_KEYWORDS_RE.test(qualText)) {
    if (/major/i.test(qualText)) return 'major';
    if (/moderate/i.test(qualText)) return 'moderate';
    if (/minor/i.test(qualText)) return 'minor';
    if (/action/i.test(qualText)) return 'action';
    return 'flood';
  }
  return 'normal';
}

function updateStateMap(stateMap, state, stage) {
  if (!stateMap.has(state)) stateMap.set(state, { state, count: 0, maxStage: 'normal' });
  const st = stateMap.get(state);
  st.count++;
  if (stage === 'major' || st.maxStage === 'normal') st.maxStage = stage;
}

function summarizeTimeSeries(timeSeries) {
  const gauges = [];
  let atFloodStage = 0;
  let atActionStage = 0;
  const stateMap = new Map();

  for (const ts of timeSeries) {
    const site = ts.sourceInfo;
    const values = ts.values?.[0]?.value ?? [];
    if (values.length === 0) continue;

    const latest = values[values.length - 1];
    const stageVal = Number.parseFloat(latest.value);
    if (Number.isNaN(stageVal) || latest.value === '-999999') continue;

    const qualifiers = latest.qualifiers ?? [];
    const stage = classifyStage(latest.value, qualifiers);
    const state = site?.siteProperty?.find(p => p.name === 'stateCd')?.value ?? 'XX';
    const siteName = site?.siteName ?? 'Unknown';
    const lat = site?.geoLocation?.geogLocation?.latitude ?? null;
    const lon = site?.geoLocation?.geogLocation?.longitude ?? null;

    if (stage !== 'normal' && stage !== 'unknown') {
      atFloodStage++;
      updateStateMap(stateMap, state, stage);
    }
    if (stage === 'action') atActionStage++;

    gauges.push({ siteNo: site?.siteCode?.[0]?.value, siteName, state, stageVal, stage, lat, lon });
  }

  // Top 10 by stage height
  const top10 = gauges
    .filter(g => g.stage !== 'normal' && g.stage !== 'unknown')
    .sort((a, b) => b.stageVal - a.stageVal)
    .slice(0, 10);

  return {
    totalGauges: timeSeries.length,
    atFloodStage,
    atActionStage,
    byState: [...stateMap.values()].sort((a, b) => b.count - a.count),
    top10,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const cached = cache.get('gauges');
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const r = await fetch(USGS_URL, {
      headers: { 'User-Agent': 'CrystalBall/2 (flood-gauges)', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const payload = { error: `USGS returned HTTP ${r.status}`, degraded: true, generatedAt: new Date().toISOString() };
      return j(payload, 200, cors);
    }
    const data = await r.json();
    const timeSeries = data?.value?.timeSeries ?? [];
    const summary = summarizeTimeSeries(timeSeries);
    const payload = { ...summary, source: 'waterservices.usgs.gov', generatedAt: new Date().toISOString() };
    cache.set('gauges', { at: Date.now(), payload });
    return j(payload, 200, cors);
  } catch (error) {
    return j({ error: `USGS fetch failed: ${error?.message ?? error}`, degraded: true, generatedAt: new Date().toISOString() }, 200, cors);
  }
}
