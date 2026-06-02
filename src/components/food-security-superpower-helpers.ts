/**
 * Pure helpers for FoodSecuritySuperpowerPanel.
 *
 * Five sections, each derived from plain input data:
 *   1. Food Pressure Gauge       — composite from severity stats on food observations
 *   2. Commodity Risk Forecast   — wheat/corn/rice/soybeans + soft commodities risk view
 *   3. Famine Watch              — IPC Phase 3+ countries with population at risk
 *   4. Supply Chain Chokepoints  — food-impacting chokepoint observations
 *   5. Breadbasket Drought Watch — drought/heat-tagged events by breadbasket region
 *
 * No DOM, no fetch, no globals. Every input is a plain array or value so
 * the test file can fixture it directly. The panel file only does
 * scheduling + safe() wrapping around the live store reads.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import type { FoodInsecurityAlert, IpcPhase } from '@/services/food-insecurity';
import type { ShortageForecast } from '@/services/shortage/shortage-types';
import { escapeHtml } from '@/utils/sanitize';

// ── Severity scoring (shared with other domain panels) ─────────────

const OBS_SEVERITY_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 2, MEDIUM: 5, HIGH: 7, CRITICAL: 9,
};

export function severityNumeric(s: ObservationSeverity): number {
  return OBS_SEVERITY_SCORE[s] ?? 0;
}

// ── Food Pressure Gauge ────────────────────────────────────────────

export type PressureLevel = 'low' | 'elevated' | 'high' | 'critical';

export interface PressureGauge {
  level: PressureLevel;
  /** 0–100 composite. */
  score: number;
  eventCount: number;
  maxSeverity: ObservationSeverity;
  meanScore: number;
}

export function pressureLevel(score: number): PressureLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'elevated';
  return 'low';
}

export function computeFoodPressure(
  events: readonly ObservationEvent[],
): PressureGauge {
  if (events.length === 0) {
    return { level: 'low', score: 0, eventCount: 0, maxSeverity: 'INFO', meanScore: 0 };
  }
  let maxScore = 0;
  let maxLabel: ObservationSeverity = 'INFO';
  let sum = 0;
  for (const e of events) {
    const s = severityNumeric(e.severity);
    if (s > maxScore) { maxScore = s; maxLabel = e.severity; }
    sum += s;
  }
  const mean = sum / events.length;
  const score = clamp(Math.round((maxScore * 0.6 + mean * 0.4) * 10), 0, 100);
  return {
    level: pressureLevel(score),
    score,
    eventCount: events.length,
    maxSeverity: maxLabel,
    meanScore: round1(mean),
  };
}

// ── Commodity Risk Forecast ────────────────────────────────────────

export type CommodityTier = 'low' | 'watch' | 'elevated' | 'high' | 'critical';

export interface CommodityRow {
  commodity: string;
  tier: CommodityTier;
  riskScore: number;
  confidence: ShortageForecast['confidence'];
  region: string;
  horizonDays: number;
  topDrivers: string[];
  dataGapCount: number;
}

export function commodityRiskTier(score: number): CommodityTier {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'watch';
  return 'low';
}

const FOOD_COMMODITIES = new Set([
  'wheat', 'corn', 'rice', 'soybeans', 'sugar', 'coffee', 'cocoa', 'fertilizer',
]);

export function isFoodCommodity(name: string): boolean {
  return FOOD_COMMODITIES.has(name.toLowerCase());
}

export function commoditiesByRisk(
  forecasts: readonly ShortageForecast[],
  limit = 6,
): CommodityRow[] {
  return forecasts
    .filter((f) => isFoodCommodity(f.commodity))
    .map((f): CommodityRow => ({
      commodity: f.commodity,
      tier: commodityRiskTier(f.riskScore),
      riskScore: Math.round(f.riskScore),
      confidence: f.confidence,
      region: f.region,
      horizonDays: f.horizonDays,
      topDrivers: pickTopDrivers(f),
      dataGapCount: f.dataGaps.length,
    }))
    .sort((a, b) => b.riskScore - a.riskScore || a.commodity.localeCompare(b.commodity))
    .slice(0, limit);
}

function pickTopDrivers(f: ShortageForecast, n = 3): string[] {
  return [...f.drivers]
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((d) => d.label);
}

// ── Famine Watch (IPC Phase 3+) ────────────────────────────────────

export interface FamineRow {
  country: string;
  countryCode: string;
  phase: IpcPhase | null;
  phaseLabel: string;
  populationAffected: number | null;
  severity: FoodInsecurityAlert['severity'];
  source: FoodInsecurityAlert['source'];
  pubDate: Date;
  title: string;
}

export interface FamineSummary {
  rows: FamineRow[];
  phase3Plus: number;
  phase4Plus: number;
  phase5: number;
  totalPopulationAffected: number;
}

const PHASE_LABELS: Record<number, string> = {
  1: 'Minimal',
  2: 'Stressed',
  3: 'Crisis',
  4: 'Emergency',
  5: 'Catastrophe',
};

export function ipcPhaseLabel(phase: IpcPhase | null): string {
  if (phase === null) return 'Unknown';
  return PHASE_LABELS[phase] ?? 'Unknown';
}

export function buildFamineWatch(
  alerts: readonly FoodInsecurityAlert[],
  limit = 12,
): FamineSummary {
  const severe = alerts.filter((a) => (a.ipcPhase ?? 0) >= 3 || a.severity === 'critical' || a.severity === 'high');

  const rows: FamineRow[] = [...severe]
    .sort(famineSort)
    .slice(0, limit)
    .map((a) => ({
      country: a.country,
      countryCode: a.countryCode,
      phase: a.ipcPhase,
      phaseLabel: ipcPhaseLabel(a.ipcPhase),
      populationAffected: a.populationAffected,
      severity: a.severity,
      source: a.source,
      pubDate: a.pubDate,
      title: a.title,
    }));

  let phase3Plus = 0;
  let phase4Plus = 0;
  let phase5 = 0;
  let totalPop = 0;
  for (const a of severe) {
    const p = a.ipcPhase ?? 0;
    if (p >= 3) phase3Plus += 1;
    if (p >= 4) phase4Plus += 1;
    if (p === 5) phase5 += 1;
    if (typeof a.populationAffected === 'number' && Number.isFinite(a.populationAffected)) {
      totalPop += a.populationAffected;
    }
  }
  return { rows, phase3Plus, phase4Plus, phase5, totalPopulationAffected: totalPop };
}

function famineSort(a: FoodInsecurityAlert, b: FoodInsecurityAlert): number {
  const pa = a.ipcPhase ?? 0;
  const pb = b.ipcPhase ?? 0;
  if (pa !== pb) return pb - pa;
  const popA = a.populationAffected ?? 0;
  const popB = b.populationAffected ?? 0;
  if (popA !== popB) return popB - popA;
  return b.pubDate.getTime() - a.pubDate.getTime();
}

// ── Supply Chain Chokepoints ───────────────────────────────────────

export type ChokepointKind =
  | 'black-sea'
  | 'bosphorus'
  | 'suez'
  | 'panama'
  | 'strait'
  | 'port-closure'
  | 'rail-disruption'
  | 'export-ban'
  | 'other';

export interface ChokepointSignal {
  kind: ChokepointKind;
  title: string;
  severity: ObservationSeverity;
  timestamp: number;
  entityIds: string[];
}

const TAG_TO_CHOKEPOINT: Record<string, ChokepointKind> = {
  'chokepoint:black-sea': 'black-sea',
  'chokepoint:bosphorus': 'bosphorus',
  'chokepoint:suez': 'suez',
  'chokepoint:panama': 'panama',
  'export-ban': 'export-ban',
  'port-closure': 'port-closure',
  'rail-disruption': 'rail-disruption',
};

export function classifyChokepoint(ev: ObservationEvent): ChokepointKind | null {
  for (const t of ev.tags) {
    const direct = TAG_TO_CHOKEPOINT[t];
    if (direct) return direct;
    if (t.startsWith('chokepoint:strait')) return 'strait';
    if (t === 'chokepoint' || t.startsWith('chokepoint:')) return 'other';
  }
  return null;
}

export function buildChokepointSignals(
  events: readonly ObservationEvent[],
  limit = 8,
): ChokepointSignal[] {
  const matched: { ev: ObservationEvent; kind: ChokepointKind }[] = [];
  for (const ev of events) {
    const kind = classifyChokepoint(ev);
    if (kind) matched.push({ ev, kind });
  }
  const sorted = [...matched];
  sorted.sort((a, b) =>
    severityNumeric(b.ev.severity) - severityNumeric(a.ev.severity)
    || b.ev.timestamp - a.ev.timestamp);
  return sorted
    .slice(0, limit)
    .map(({ ev, kind }) => ({
      kind,
      title: ev.title,
      severity: ev.severity,
      timestamp: ev.timestamp,
      entityIds: [...ev.entityIds],
    }));
}

// ── Breadbasket Drought Watch ──────────────────────────────────────

export type Breadbasket =
  | 'north-america'
  | 'south-america'
  | 'europe'
  | 'black-sea'
  | 'india'
  | 'china'
  | 'australia'
  | 'sahel'
  | 'horn-of-africa'
  | 'southeast-asia'
  | 'other';

const REGION_LABEL: Record<Breadbasket, string> = {
  'north-america': 'North America',
  'south-america': 'South America',
  'europe': 'Europe',
  'black-sea': 'Black Sea',
  'india': 'India',
  'china': 'China',
  'australia': 'Australia',
  'sahel': 'Sahel',
  'horn-of-africa': 'Horn of Africa',
  'southeast-asia': 'Southeast Asia',
  'other': 'Other',
};

export function breadbasketLabel(b: Breadbasket): string {
  return REGION_LABEL[b];
}

const STRESS_TAGS = new Set([
  'drought', 'heatwave', 'crop-stress', 'flood', 'frost', 'monsoon-failure', 'wildfire-cropland',
]);

const REGION_TAG_TO_BREADBASKET: Record<string, Breadbasket> = {
  'region:north-america': 'north-america',
  'region:us-midwest': 'north-america',
  'region:south-america': 'south-america',
  'region:argentina-pampas': 'south-america',
  'region:brazil': 'south-america',
  'region:europe': 'europe',
  'region:eu': 'europe',
  'region:black-sea': 'black-sea',
  'region:ukraine': 'black-sea',
  'region:russia': 'black-sea',
  'region:india': 'india',
  'region:china': 'china',
  'region:australia': 'australia',
  'region:sahel': 'sahel',
  'region:horn-of-africa': 'horn-of-africa',
  'region:east-africa': 'horn-of-africa',
  'region:southeast-asia': 'southeast-asia',
};

function isStressTag(tag: string): boolean {
  return STRESS_TAGS.has(tag);
}

function regionFromEventTags(tags: readonly string[]): Breadbasket | null {
  for (const t of tags) {
    const hit = REGION_TAG_TO_BREADBASKET[t];
    if (hit) return hit;
  }
  return null;
}

interface LocationBox {
  region: Breadbasket;
  latMin: number; latMax: number;
  lonMin: number; lonMax: number;
}

const LOCATION_BOXES: readonly LocationBox[] = [
  { region: 'north-america',  latMin: 25,  latMax: 55,  lonMin: -125, lonMax: -65 },
  { region: 'south-america',  latMin: -45, latMax: -10, lonMin: -75,  lonMax: -35 },
  { region: 'black-sea',      latMin: 40,  latMax: 50,  lonMin: 30,   lonMax: 50 },
  { region: 'europe',         latMin: 35,  latMax: 60,  lonMin: -10,  lonMax: 30 },
  { region: 'india',          latMin: 5,   latMax: 35,  lonMin: 68,   lonMax: 90 },
  { region: 'china',          latMin: 20,  latMax: 50,  lonMin: 90,   lonMax: 135 },
  { region: 'australia',      latMin: -45, latMax: -10, lonMin: 110,  lonMax: 155 },
  { region: 'sahel',          latMin: 8,   latMax: 20,  lonMin: -20,  lonMax: 40 },
  { region: 'horn-of-africa', latMin: -5,  latMax: 18,  lonMin: 28,   lonMax: 55 },
  { region: 'southeast-asia', latMin: -10, latMax: 25,  lonMin: 90,   lonMax: 145 },
];

function regionFromLocation(lat: number, lon: number): Breadbasket {
  for (const box of LOCATION_BOXES) {
    if (lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax) {
      return box.region;
    }
  }
  return 'other';
}

export function regionOfEvent(ev: ObservationEvent): Breadbasket {
  const tagged = regionFromEventTags(ev.tags);
  if (tagged) return tagged;
  if (ev.location) return regionFromLocation(ev.location.lat, ev.location.lon);
  return 'other';
}

export interface BreadbasketBucket {
  region: Breadbasket;
  label: string;
  eventCount: number;
  maxSeverity: ObservationSeverity;
  /** 0–100 composite stress score within this region. */
  score: number;
  topTags: string[];
}

export function buildBreadbasketStress(
  events: readonly ObservationEvent[],
): BreadbasketBucket[] {
  const stress = events.filter((e) => e.tags.some((t) => isStressTag(t)));
  const byRegion = new Map<Breadbasket, ObservationEvent[]>();
  for (const ev of stress) {
    const region = regionOfEvent(ev);
    const arr = byRegion.get(region);
    if (arr) arr.push(ev);
    else byRegion.set(region, [ev]);
  }

  const out: BreadbasketBucket[] = [];
  for (const [region, list] of byRegion.entries()) {
    out.push(summarizeRegionStress(region, list));
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out;
}

interface StressAgg {
  maxScore: number;
  maxLabel: ObservationSeverity;
  sum: number;
  tagCount: Map<string, number>;
}

function aggregateStress(list: readonly ObservationEvent[]): StressAgg {
  const agg: StressAgg = { maxScore: 0, maxLabel: 'INFO', sum: 0, tagCount: new Map() };
  for (const ev of list) {
    const sNum = severityNumeric(ev.severity);
    if (sNum > agg.maxScore) { agg.maxScore = sNum; agg.maxLabel = ev.severity; }
    agg.sum += sNum;
    for (const t of ev.tags) {
      if (isStressTag(t)) agg.tagCount.set(t, (agg.tagCount.get(t) ?? 0) + 1);
    }
  }
  return agg;
}

function summarizeRegionStress(
  region: Breadbasket,
  list: readonly ObservationEvent[],
): BreadbasketBucket {
  const agg = aggregateStress(list);
  const meanScore = agg.sum / list.length;
  const score = clamp(Math.round((agg.maxScore * 0.6 + meanScore * 0.4) * 10), 0, 100);
  const topTags = [...agg.tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([t]) => t);
  return {
    region,
    label: breadbasketLabel(region),
    eventCount: list.length,
    maxSeverity: agg.maxLabel,
    score,
    topTags,
  };
}

// ── Formatting helpers ────────────────────────────────────────────

export function formatPopulation(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

export function formatTimeAgo(ts: number, now: number = Date.now()): string {
  const sec = Math.round((now - ts) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86_400)}d ago`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Composed view-model + renderer ────────────────────────────────

export interface FoodSecurityState {
  pressure: PressureGauge;
  commodities: CommodityRow[];
  famine: FamineSummary;
  chokepoints: ChokepointSignal[];
  breadbaskets: BreadbasketBucket[];
  generatedAt: number;
}

export interface FoodSecurityInputs {
  events: readonly ObservationEvent[];
  forecasts: readonly ShortageForecast[];
  alerts: readonly FoodInsecurityAlert[];
}

export function buildFoodSecurityState(
  inputs: FoodSecurityInputs,
  now: number = Date.now(),
): FoodSecurityState {
  return {
    pressure: computeFoodPressure(inputs.events),
    commodities: commoditiesByRisk(inputs.forecasts),
    famine: buildFamineWatch(inputs.alerts),
    chokepoints: buildChokepointSignals(inputs.events),
    breadbaskets: buildBreadbasketStress(inputs.events),
    generatedAt: now,
  };
}

export function renderFoodSecurityHtml(
  state: FoodSecurityState,
  nowFn: () => number = Date.now,
): string {
  return `<div class="food-sp-root">
    ${renderPressure(state.pressure)}
    ${renderCommodities(state.commodities)}
    ${renderFamine(state.famine)}
    ${renderChokepoints(state.chokepoints, nowFn())}
    ${renderBreadbaskets(state.breadbaskets)}
    <div class="food-sp-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(formatTimeAgo(state.generatedAt, nowFn()))}</div>
  </div>`;
}

function renderPressure(p: PressureGauge): string {
  return `<section class="food-sp-section" data-section="pressure">
    <h3 style="margin:0 0 6px 0;font-size:13px">Food Pressure Gauge</h3>
    <div class="food-sp-gauge" style="display:flex;gap:12px;align-items:baseline;padding:8px;border-radius:6px;background:${pressureBg(p.level)}">
      <span style="font-size:20px;font-weight:600;text-transform:uppercase">${escapeHtml(p.level)}</span>
      <span style="font-size:14px;opacity:0.85">score ${p.score}</span>
      <span style="font-size:11px;opacity:0.7">${p.eventCount} events · peak ${escapeHtml(p.maxSeverity)} · mean ${p.meanScore}</span>
    </div>
  </section>`;
}

function renderCommodities(rows: CommodityRow[]): string {
  if (rows.length === 0) {
    return emptySection('commodities', 'Commodity Risk Forecast', 'No commodity forecasts loaded.');
  }
  const items = rows.map((c) => {
    const gapSuffix = c.dataGapCount === 1 ? '' : 's';
    const gapLine = c.dataGapCount > 0
      ? `<div style="opacity:0.55;font-size:10px">⚠ ${c.dataGapCount} data gap${gapSuffix}</div>`
      : '';
    const driverLine = c.topDrivers.length > 0
      ? `<div style="opacity:0.65;margin-top:2px;font-size:11px">${c.topDrivers.map((d) => escapeHtml(d)).join(' · ')}</div>`
      : '';
    return `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:64px;text-transform:uppercase;font-weight:600;color:${tierColor(c.tier)}">${escapeHtml(c.tier)}</span>
    <strong>${escapeHtml(c.commodity)}</strong>
    <span style="opacity:0.65">· score ${c.riskScore} · ${escapeHtml(c.confidence)} conf · ${escapeHtml(c.region)} · ${c.horizonDays}d</span>
    ${driverLine}
    ${gapLine}
  </li>`;
  }).join('');
  return `<section class="food-sp-section" data-section="commodities">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Commodity Risk Forecast</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderFamine(f: FamineSummary): string {
  if (f.rows.length === 0) {
    return emptySection('famine', 'Famine Watch', 'No IPC Phase 3+ alerts.');
  }
  const rows = f.rows.map((r) => `<li style="padding:4px 0;font-size:12px">
    <strong>${escapeHtml(r.country)}</strong>
    ${r.phase === null ? '' : `<span style="opacity:0.7">· Phase ${r.phase} (${escapeHtml(r.phaseLabel)})</span>`}
    <span style="opacity:0.65">· ${escapeHtml(formatPopulation(r.populationAffected))} affected · ${escapeHtml(r.source)}</span>
  </li>`).join('');
  return `<section class="food-sp-section" data-section="famine">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Famine Watch</h3>
    <div style="font-size:11px;opacity:0.7;margin-bottom:4px">${f.phase3Plus} crisis · ${f.phase4Plus} emergency · ${f.phase5} catastrophe · ${escapeHtml(formatPopulation(f.totalPopulationAffected))} total</div>
    <ul style="list-style:none;padding:0;margin:0">${rows}</ul>
  </section>`;
}

function renderChokepoints(signals: ChokepointSignal[], now: number): string {
  if (signals.length === 0) {
    return emptySection('chokepoints', 'Supply Chain Chokepoints', 'No chokepoint disruptions tracked.');
  }
  const items = signals.map((s) => `<li style="padding:4px 0;font-size:12px">
    <span style="text-transform:uppercase;font-weight:600;font-size:10px;opacity:0.7">${escapeHtml(s.kind)}</span>
    <strong style="margin-left:6px">${escapeHtml(s.title)}</strong>
    <span style="opacity:0.6">· ${escapeHtml(s.severity)} · ${escapeHtml(formatTimeAgo(s.timestamp, now))}</span>
  </li>`).join('');
  return `<section class="food-sp-section" data-section="chokepoints">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Supply Chain Chokepoints</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderBreadbaskets(buckets: BreadbasketBucket[]): string {
  if (buckets.length === 0) {
    return emptySection('breadbasket', 'Breadbasket Drought Watch', 'No drought or crop-stress signals.');
  }
  const items = buckets.map((b) => `<li style="padding:4px 0;font-size:12px">
    <strong>${escapeHtml(b.label)}</strong>
    <span style="opacity:0.7">· score ${b.score} · ${b.eventCount} event${b.eventCount === 1 ? '' : 's'} · peak ${escapeHtml(b.maxSeverity)}</span>
    ${b.topTags.length > 0 ? `<div style="opacity:0.6;margin-top:2px;font-size:11px">${b.topTags.map((t) => escapeHtml(t)).join(', ')}</div>` : ''}
  </li>`).join('');
  return `<section class="food-sp-section" data-section="breadbasket">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Breadbasket Drought Watch</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function emptySection(slug: string, title: string, message: string): string {
  return `<section class="food-sp-section" data-section="${slug}">
    <h3 style="margin:8px 0 6px 0;font-size:13px">${escapeHtml(title)}</h3>
    <div class="food-sp-empty" style="opacity:0.6;font-size:12px">${escapeHtml(message)}</div>
  </section>`;
}

function pressureBg(level: PressureLevel): string {
  switch (level) {
    case 'critical': { return 'rgba(239, 68, 68, 0.18)'; }
    case 'high': { return 'rgba(249, 115, 22, 0.16)'; }
    case 'elevated': { return 'rgba(234, 179, 8, 0.14)'; }
    default: { return 'rgba(34, 197, 94, 0.12)'; }
  }
}

function tierColor(tier: CommodityTier): string {
  switch (tier) {
    case 'critical': { return '#ef4444'; }
    case 'high': { return '#f97316'; }
    case 'elevated': { return '#eab308'; }
    case 'watch': { return '#84cc16'; }
    default: { return '#22c55e'; }
  }
}
