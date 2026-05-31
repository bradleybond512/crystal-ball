/**
 * Near-Earth Object proxy. Combines two free, no-key JPL CNEOS feeds:
 *   - CAD    (close-approach data): upcoming flybys within 0.05 AU / 60 days
 *   - Sentry (impact-risk table):   objects with nonzero impact probability
 *
 * The normalizers mirror src/services/space/neo-normalize.ts (the TS
 * version is the unit-tested source of truth).
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000; // NEO data changes slowly
const AU_PER_LD = 0.002_569_6;
const ASSUMED_ALBEDO = 0.14;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const CAD_DATE_RE = /^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})$/;

export const cache = new Map();

const j = (payload, status, cors) =>
  Response.json(payload, { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });

function finite(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function estDiameterM(h) {
  if (h === null || !Number.isFinite(h)) return null;
  return Math.round((1329 / Math.sqrt(ASSUMED_ALBEDO)) * 10 ** (-0.2 * h) * 1000);
}

function parseCadDate(cd) {
  const m = String(cd).trim().match(CAD_DATE_RE);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(Number(m[1]), month, day, hour, minute, 0, 0);
}

function classifyApproach(ld, dM) {
  const big = (dM ?? 0) >= 140;
  if (ld <= 1) return 'very_close';
  if (ld <= 5) return big ? 'very_close' : 'close';
  if (ld <= 20) return big ? 'close' : 'notable';
  return big ? 'notable' : 'none';
}

function normalizeCloseApproaches(payload) {
  if (!payload || !Array.isArray(payload.fields) || !Array.isArray(payload.data)) return [];
  const f = payload.fields;
  const iDes = f.indexOf('des');
  const iCd = f.indexOf('cd');
  const iDist = f.indexOf('dist');
  const iVrel = f.indexOf('v_rel');
  const iH = f.indexOf('h');
  if (iDes === -1 || iCd === -1 || iDist === -1) return [];
  const out = [];
  for (const row of payload.data) {
    if (!Array.isArray(row)) continue;
    const designation = String(row[iDes] ?? '').trim();
    const approachAt = parseCadDate(row[iCd]);
    const distanceAu = Number(row[iDist]);
    if (!designation || approachAt === null || !Number.isFinite(distanceAu)) continue;
    const h = iH === -1 ? null : finite(row[iH]);
    const dM = estDiameterM(h);
    const ld = distanceAu / AU_PER_LD;
    out.push({
      designation,
      approachAt,
      distanceAu,
      distanceLd: ld,
      velocityKms: iVrel === -1 ? null : finite(row[iVrel]),
      absoluteMagnitude: h,
      estDiameterM: dM,
      hazard: classifyApproach(ld, dM),
    });
  }
  out.sort((a, b) => a.approachAt - b.approachAt);
  return out;
}

function normalizeImpactRisks(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  const out = [];
  for (const r of payload.data) {
    if (!r || typeof r !== 'object') continue;
    const designation = String(r.des ?? '').trim();
    const ip = finite(r.ip);
    if (!designation || ip === null) continue;
    const diameterKm = finite(r.diameter);
    const h = finite(r.h);
    out.push({
      designation,
      fullname: typeof r.fullname === 'string' ? r.fullname.trim() : null,
      impactProbability: ip,
      impactCount: Math.trunc(finite(r.n_imp) ?? 0),
      palermoScaleCum: finite(r.ps_cum),
      diameterM: diameterKm === null ? estDiameterM(h) : Math.round(diameterKm * 1000),
      yearRange: typeof r.range === 'string' ? r.range.trim() : null,
      absoluteMagnitude: h,
    });
  }
  out.sort((a, b) => (b.palermoScaleCum ?? -Infinity) - (a.palermoScaleCum ?? -Infinity));
  return out;
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'CrystalBall/2 (neo-tracker)', Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function buildPayload() {
  const cadUrl = 'https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&sort=date';
  const sentryUrl = 'https://ssd-api.jpl.nasa.gov/sentry.api';
  const [cadRes, sentryRes] = await Promise.allSettled([fetchJson(cadUrl), fetchJson(sentryUrl)]);

  const closeApproaches = cadRes.status === 'fulfilled' ? normalizeCloseApproaches(cadRes.value) : [];
  const impactRisks = sentryRes.status === 'fulfilled' ? normalizeImpactRisks(sentryRes.value).slice(0, 30) : [];
  const reasons = [];
  if (cadRes.status === 'rejected') reasons.push(`CAD: ${cadRes.reason?.message ?? cadRes.reason}`);
  if (sentryRes.status === 'rejected') reasons.push(`Sentry: ${sentryRes.reason?.message ?? sentryRes.reason}`);

  return {
    closeApproaches,
    impactRisks,
    closeApproachCount: closeApproaches.length,
    impactRiskCount: impactRisks.length,
    degraded: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
    source: 'NASA/JPL CNEOS',
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const cached = cache.get('neo');
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const payload = await buildPayload();
    cache.set('neo', { at: Date.now(), payload });
    return j(payload, 200, cors);
  } catch (error) {
    return j(
      { closeApproaches: [], impactRisks: [], degraded: true, reason: error?.message ?? String(error), source: 'NASA/JPL CNEOS', generatedAt: new Date().toISOString() },
      200,
      cors,
    );
  }
}
