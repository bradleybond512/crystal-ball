/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-nested-conditional, sonarjs/no-nested-template-literals */
/**
 * Intel channels bridge — promotes weather/health/infra/space/maritime/
 * aviation/travel/radiation/air-quality signals into the unified alert store
 * so the correlation engine, triage bar, sidebar heat, and Just-In rail see
 * every intel channel, not just the four legacy ingestors.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSeverity } from './unified-alerts';
import { fetchSpaceWeather } from './space-weather';
import { fetchSpcSummary } from './spc-outlook';
import { fetchDiseaseOutbreaks } from './disease-outbreak';
import { fetchMaritimeWarnings } from './maritime-safety';
import { fetchGovWarningConvergence } from './travel-warnings';
import { fetchRadiationAlerts } from './radiation-monitoring';
import { fetchVolcanoAlerts } from './volcano-alerts';
import { fetchAirQualityAlerts } from './air-quality';
import { fetchAviationHazards } from './aviation-hazards';
import { recordFetch } from './source-health';

const POLL_SLOW_MS = 15 * 60_000;   // 15 min — most intel
const POLL_FAST_MS = 5 * 60_000;    // 5 min — space weather, aviation

// Rough country/region centroids for anchoring location-less alerts.
const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  US: { lat: 39, lon: -98 }, USA: { lat: 39, lon: -98 },
  UK: { lat: 54, lon: -2 }, GB: { lat: 54, lon: -2 },
  FR: { lat: 46, lon: 2 }, DE: { lat: 51, lon: 10 },
  CN: { lat: 35, lon: 105 }, IN: { lat: 21, lon: 78 },
  RU: { lat: 60, lon: 100 }, JP: { lat: 36, lon: 138 },
  BR: { lat: -10, lon: -55 }, AU: { lat: -25, lon: 133 },
  CA: { lat: 56, lon: -106 }, MX: { lat: 23, lon: -102 },
  IR: { lat: 32, lon: 53 }, IL: { lat: 31, lon: 35 },
  UA: { lat: 49, lon: 32 }, TR: { lat: 39, lon: 35 },
  EG: { lat: 27, lon: 30 }, ZA: { lat: -29, lon: 24 },
};
function centroidForCountry(code: string): { lat: number; lon: number } | undefined {
  return COUNTRY_CENTROIDS[code.toUpperCase()] ?? COUNTRY_CENTROIDS[code.slice(0, 2).toUpperCase()];
}

// ── Space weather (global, no location) ───────────────────────────────────
/**
 * No try/catch here on purpose: tracked() is the handler, and swallowing the
 * error locally meant it recorded ok:true on every tick no matter what SWPC
 * did. A throw is how this reaches the Source Health overlay as a failure.
 */
export async function pollSpaceWeather(): Promise<void> {
  const data = await fetchSpaceWeather();
  // fetchSpaceWeather resolves even when nothing parsed, so a returned object
  // is not evidence of a working feed. Every product this poller reads being
  // null is the reassuring reading — no storm, no alerts — produced by an
  // outage, so it must surface as a failure rather than a quiet sky.
  // Wind counts even though nothing below reads it: the sidecar route and
  // fetchSpaceWeather both treat a parsed wind series as a usable product, and a
  // health verdict that disagrees with them would report an outage on a feed
  // that answered.
  if (data.kpIndex === null && data.xrayClass === null && data.alertMessages.length === 0
    && data.solarWindSpeed === null && data.solarWindDensity === null && data.bz === null) {
    throw new Error('SWPC returned no usable space-weather data');
  }
  const out: UnifiedAlert[] = [];
  // Kp-based rolling alert
  if (data.kpIndex !== null && data.kpIndex >= 5) {
    const sev: AlertSeverity = data.kpIndex >= 7 ? 'critical' : (data.kpIndex >= 6 ? 'high' : 'medium');
    out.push({
      id: 'space-wx-kp-rolling',
      source: 'space-weather',
      severity: sev,
      title: `Geomagnetic storm — Kp ${data.kpIndex.toFixed(1)} (${data.kpClass.replace('_', ' ')})`,
      body: `Solar wind ${data.solarWindSpeed ?? '?'} km/s, Bz ${data.bz ?? '?'} nT, X-ray ${data.xrayClass ?? 'quiet'}.`,
      timestamp: Date.now(),
      relevanceScore: sev === 'critical' ? 90 : 70,
      acknowledged: false,
      pinned: false,
    });
  }
  // SWPC-issued bulletins (watches/warnings/alerts)
  for (const m of data.alertMessages.slice(0, 10)) {
    if (m.severity === 'summary') continue;
    const sev: AlertSeverity = m.severity === 'alert' ? 'high' : (m.severity === 'warning' ? 'medium' : 'low');
    out.push({
      id: `space-wx-${m.id}`,
      source: 'space-weather',
      severity: sev,
      title: `SWPC ${m.severity.toUpperCase()}`,
      body: m.message.slice(0, 400),
      timestamp: m.issuedAt.getTime(),
      relevanceScore: 50,
      acknowledged: false,
      pinned: false,
    });
  }
  if (out.length > 0) unifiedAlertStore.ingest(out);
}

// ── SPC convective outlooks + storm reports ───────────────────────────────
async function pollSpc(): Promise<void> {
  try {
    const sum = await fetchSpcSummary();
    const out: UnifiedAlert[] = [];
    for (const o of sum.outlooks) {
      if (o.risk === 'TSTM' || o.risk === 'MRGL') continue;
      const loc = o.centroid ? { lat: o.centroid[1], lon: o.centroid[0] } : undefined;
      out.push({
        id: `spc-${o.id}`,
        source: 'spc',
        severity: o.severity,
        title: `SPC Day ${o.day} ${o.label} risk`,
        body: `Convective outlook valid ${o.validTime}.`,
        timestamp: Date.now(),
        location: loc,
        relevanceScore: o.risk === 'HIGH' ? 95 : (o.risk === 'MDT' ? 80 : 60),
        acknowledged: false,
        pinned: false,
      });
    }
    for (const r of sum.reports.slice(0, 40)) {
      if (r.severity === 'low') continue;
      out.push({
        id: `lsr-${r.id}`,
        source: 'spc',
        severity: r.severity,
        title: `${r.type.toUpperCase()} ${r.magnitude} — ${r.county}, ${r.state}`,
        body: r.remarks.slice(0, 300) || r.location,
        timestamp: r.reportedAt.getTime(),
        location: { lat: r.lat, lon: r.lon },
        relevanceScore: r.severity === 'critical' ? 85 : 60,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Disease outbreaks ─────────────────────────────────────────────────────
async function pollDisease(): Promise<void> {
  try {
    const items = await fetchDiseaseOutbreaks();
    const out: UnifiedAlert[] = [];
    for (const d of items.slice(0, 30)) {
      if (d.severity === 'low') continue;
      const loc = centroidForCountry(d.country);
      out.push({
        id: `disease-${d.id}`,
        source: 'disease',
        severity: d.severity,
        title: `${d.disease} — ${d.country}`,
        body: `[${d.source}] ${d.title}`.slice(0, 400),
        timestamp: d.date.getTime(),
        location: loc,
        relevanceScore: d.severity === 'critical' ? 85 : 55,
        acknowledged: false,
        pinned: false,
        link: d.url,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Maritime safety (NGA broadcast warnings) ──────────────────────────────
const NAVAREA_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  I: { lat: 55, lon: 0 }, II: { lat: 30, lon: -20 }, III: { lat: 35, lon: 20 },
  IV: { lat: 30, lon: -60 }, V: { lat: -15, lon: -30 }, VI: { lat: -40, lon: -60 },
  VII: { lat: -20, lon: 10 }, VIII: { lat: 10, lon: 75 }, IX: { lat: 20, lon: 60 },
  X: { lat: -10, lon: 110 }, XI: { lat: 15, lon: 130 }, XII: { lat: 20, lon: -140 },
  XIII: { lat: 55, lon: 160 }, XIV: { lat: -25, lon: -150 }, XV: { lat: -30, lon: -90 },
  XVI: { lat: 0, lon: -100 },
};
async function pollMaritime(): Promise<void> {
  try {
    const items = await fetchMaritimeWarnings();
    const out: UnifiedAlert[] = [];
    for (const w of items.slice(0, 40)) {
      if (w.severity === 'low') continue;
      const loc = NAVAREA_CENTROIDS[w.navArea];
      out.push({
        id: `msi-${w.id}`,
        source: 'maritime',
        severity: w.severity,
        title: `NAVAREA ${w.navArea} ${w.category} warning #${w.msgNumber}/${w.msgYear}`,
        body: w.text.slice(0, 400),
        timestamp: w.issueTime.getTime(),
        location: loc,
        relevanceScore: w.severity === 'critical' ? 80 : 50,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Travel advisories (gov convergence = multi-source hits) ───────────────
async function pollTravel(): Promise<void> {
  try {
    const results = await fetchGovWarningConvergence();
    const out: UnifiedAlert[] = [];
    for (const r of results) {
      if (!r.isConvergenceAlert) continue;
      const loc = centroidForCountry(r.country);
      out.push({
        id: `travel-${r.country.toLowerCase().replace(/\s+/g, '-')}`,
        source: 'travel-advisory',
        severity: r.recentCount >= 3 ? 'high' : 'medium',
        title: `${r.country} — ${r.recentCount} govt travel warnings converged`,
        body: r.sources.join(', '),
        timestamp: r.latestUpdate ? new Date(r.latestUpdate).getTime() : Date.now(),
        location: loc,
        relevanceScore: 60,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Radiation alerts (elevated readings) ──────────────────────────────────
async function pollRadiation(): Promise<void> {
  try {
    const items = await fetchRadiationAlerts();
    const out: UnifiedAlert[] = [];
    for (const r of items.slice(0, 20)) {
      out.push({
        id: `rad-${r.id}`,
        source: 'radiation',
        severity: r.severity,
        title: `Radiation ${r.level.replace('_', ' ')} — ${r.locationName}`,
        body: `${r.cpm.toFixed(0)} CPM (${r.usvh.toFixed(3)} µSv/h)`,
        timestamp: r.capturedAt.getTime(),
        location: { lat: r.lat, lon: r.lon },
        relevanceScore: r.severity === 'critical' ? 95 : 65,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Volcano alerts (USGS) ─────────────────────────────────────────────────
async function pollVolcano(): Promise<void> {
  try {
    const items = await fetchVolcanoAlerts();
    const out: UnifiedAlert[] = [];
    for (const v of items) {
      if (v.alertLevel === 'Normal') continue;
      const sev: AlertSeverity = v.alertLevel === 'Warning' ? 'critical'
        : (v.alertLevel === 'Watch' ? 'high' : 'medium');
      out.push({
        id: `volcano-${v.id}`,
        source: 'volcano',
        severity: sev,
        title: `${v.name} — ${v.alertLevel} (${v.color})`,
        body: `${v.location} · ${v.observatory}`,
        timestamp: new Date(v.updatedAt).getTime() || Date.now(),
        location: { lat: v.lat, lon: v.lon },
        relevanceScore: sev === 'critical' ? 90 : 60,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Air quality (unhealthy+ cities) ───────────────────────────────────────
async function pollAirQuality(): Promise<void> {
  try {
    const items = await fetchAirQualityAlerts();
    const out: UnifiedAlert[] = [];
    for (const a of items) {
      const sev: AlertSeverity = a.aqi > 300 ? 'high' : (a.aqi > 200 ? 'medium' : 'low');
      out.push({
        id: a.id,
        source: 'air-quality',
        severity: sev,
        title: `Air quality ${a.aqiLevel.replace('_', ' ')} — ${a.city}`,
        body: `AQI ${a.aqi}${a.pm25 ? ` · PM2.5 ${a.pm25.toFixed(0)} µg/m³` : ''}`,
        timestamp: a.alertedAt.getTime(),
        location: { lat: a.lat, lon: a.lon },
        relevanceScore: 40,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

// ── Aviation hazards (PIREPs with coordinates) ────────────────────────────
async function pollAviation(): Promise<void> {
  try {
    const { pireps } = await fetchAviationHazards();
    const out: UnifiedAlert[] = [];
    for (const p of pireps.slice(0, 40)) {
      if (p.severity === 'low') continue;
      out.push({
        id: `pirep-${p.id}`,
        source: 'aviation-hazard',
        severity: p.severity,
        title: `${p.hazardType.toUpperCase()} ${p.intensity} — ${p.aircraft}`,
        body: p.rawText.slice(0, 300),
        timestamp: p.reportTime.getTime(),
        location: { lat: p.lat, lon: p.lon },
        relevanceScore: p.severity === 'critical' ? 80 : 50,
        acknowledged: false,
        pinned: false,
      });
    }
    if (out.length > 0) unifiedAlertStore.ingest(out);
  } catch { /* noop */ }
}

function tracked(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try { await fn(); recordFetch(name, true); }
    catch { recordFetch(name, false); }
  };
}

let started = false;
export function startIntelChannelsBridge(): void {
  if (started) return;
  started = true;
  const slow = [
    tracked('spc', pollSpc),
    tracked('disease', pollDisease),
    tracked('maritime', pollMaritime),
    tracked('travel-advisory', pollTravel),
    tracked('radiation', pollRadiation),
    tracked('volcano', pollVolcano),
    tracked('air-quality', pollAirQuality),
  ];
  const fast = [
    tracked('space-weather', pollSpaceWeather),
    tracked('aviation-hazard', pollAviation),
  ];
  for (const fn of [...slow, ...fast]) void fn();
  window.setInterval(() => { for (const fn of slow) void fn(); }, POLL_SLOW_MS);
  window.setInterval(() => { for (const fn of fast) void fn(); }, POLL_FAST_MS);
}
