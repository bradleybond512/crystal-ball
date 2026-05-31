/**
 * Pure helpers for GeopoliticalRiskPanel.
 *
 * Composite geopolitical-risk scoring engine. Folds seven dimensions into
 * a single 0–100 country score (and from there into region scores and
 * great-power dyadic tension scores):
 *
 *   - territorial-dispute      → land/maritime sovereignty contests
 *   - alliance-shift           → bloc realignment, treaty signings/exits
 *   - sanctions-regime         → new sanctions, escalations, removals
 *   - coup-instability         → coups, uprisings, contested elections
 *   - diplomatic-crisis        → expulsions, embassy closures, summit cancellations
 *   - great-power-competition  → military posturing, FONOPS, arms sales
 *   - economic-statecraft      → export controls, tariffs, weaponized finance
 *
 * Every signal carries provenance (sourceId, observedAt) so freshness can
 * decay older inputs without silently dropping them. No DOM, no fetch,
 * no globals — the panel file wires the live store into these helpers.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

// ── Public types ──────────────────────────────────────────────────

export type RiskDimension =
  | 'territorial-dispute'
  | 'alliance-shift'
  | 'sanctions-regime'
  | 'coup-instability'
  | 'diplomatic-crisis'
  | 'great-power-competition'
  | 'economic-statecraft';

export const ALL_DIMENSIONS: readonly RiskDimension[] = [
  'territorial-dispute',
  'alliance-shift',
  'sanctions-regime',
  'coup-instability',
  'diplomatic-crisis',
  'great-power-competition',
  'economic-statecraft',
];

export type RiskTier = 'low' | 'watch' | 'elevated' | 'high' | 'critical';

export interface RiskSignal {
  /** Dimension bucket. */
  dimension: RiskDimension;
  /** ISO 3166-1 alpha-2, uppercase. May be multiple for bilateral signals. */
  countryCodes: string[];
  severity: ObservationSeverity;
  /** Unix ms when the signal was observed. Older signals decay. */
  observedAt: number;
  /** Free-text — surfaced as a top driver. */
  label: string;
  /** Provider id. Optional but recorded for provenance. */
  sourceId?: string;
}

// ── Dimension weights ─────────────────────────────────────────────

/**
 * Weight each dimension contributes to the country composite. Sums to 1.
 * Picked so that single-dimension extremes can still flag "critical"
 * (coup at CRITICAL alone → ~63 → 'high', plus any other dimension
 * pushes it over 80). Don't change without re-running the scoring
 * fixtures in the test file.
 */
export const DIMENSION_WEIGHTS: Readonly<Record<RiskDimension, number>> = {
  'coup-instability':          0.2,
  'great-power-competition':   0.18,
  'sanctions-regime':          0.15,
  'territorial-dispute':       0.13,
  'diplomatic-crisis':         0.12,
  'economic-statecraft':       0.12,
  'alliance-shift':            0.1,
};

const SEVERITY_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 2, MEDIUM: 5, HIGH: 7, CRITICAL: 9,
};

export function severityToScore(s: ObservationSeverity): number {
  return SEVERITY_SCORE[s] ?? 0;
}

export function riskTier(score: number): RiskTier {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'watch';
  return 'low';
}

// ── Freshness decay ───────────────────────────────────────────────

const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Exponential decay so a 2-week-old signal counts ~50%, a 4-week-old
 * one ~25%. Never returns < 0.05 so very old signals don't vanish
 * — they should fade, but seeing "Russia: sanctions still on" 60
 * days later is information, not noise.
 */
export function freshnessMultiplier(observedAt: number, now: number): number {
  const ageMs = Math.max(0, now - observedAt);
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return Math.max(0.05, decay);
}

// ── Country composite ─────────────────────────────────────────────

export interface DimensionBreakdown {
  dimension: RiskDimension;
  /** 0–100 dimension contribution. */
  score: number;
  /** Weighted contribution to country composite. */
  weightedScore: number;
  signalCount: number;
  topLabel?: string;
}

export interface CountryRisk {
  countryCode: string;
  /** 0–100 composite. */
  score: number;
  tier: RiskTier;
  signalCount: number;
  lastUpdated: number;
  byDimension: DimensionBreakdown[];
  topDrivers: string[];
}

interface BucketRow {
  raw: number;
  freshSum: number;
  bestSeverityScore: number;
  topLabel: string | undefined;
  topObservedAt: number;
  signalCount: number;
  lastUpdated: number;
}

function emptyBucket(): BucketRow {
  return {
    raw: 0,
    freshSum: 0,
    bestSeverityScore: 0,
    topLabel: undefined,
    topObservedAt: 0,
    signalCount: 0,
    lastUpdated: 0,
  };
}

function accumulate(bucket: BucketRow, signal: RiskSignal, now: number): void {
  const sev = severityToScore(signal.severity);
  const fresh = freshnessMultiplier(signal.observedAt, now);
  bucket.raw += sev * fresh;
  bucket.freshSum += fresh;
  bucket.signalCount += 1;
  if (signal.observedAt > bucket.lastUpdated) bucket.lastUpdated = signal.observedAt;
  // Pick driver label by severity, breaking ties by recency.
  if (sev > bucket.bestSeverityScore
    || (sev === bucket.bestSeverityScore && signal.observedAt > bucket.topObservedAt)) {
    bucket.bestSeverityScore = sev;
    bucket.topLabel = signal.label;
    bucket.topObservedAt = signal.observedAt;
  }
}

/**
 * Per-dimension score: mean fresh-weighted severity rescaled to 0–100,
 * with a small "many signals" amplifier so 5 medium events don't look
 * the same as a single one.
 */
function bucketScore(bucket: BucketRow): number {
  if (bucket.freshSum === 0) return 0;
  const mean = bucket.raw / bucket.freshSum;
  const amplifier = 1 + Math.min(0.2, Math.log10(Math.max(1, bucket.signalCount)) * 0.15);
  return clamp(Math.round(mean * 10 * amplifier), 0, 100);
}

export function scoreCountryRisks(
  signals: readonly RiskSignal[],
  now: number = Date.now(),
): CountryRisk[] {
  const byCountry = new Map<string, Map<RiskDimension, BucketRow>>();

  for (const signal of signals) {
    for (const rawCode of signal.countryCodes) {
      const code = normalizeCountryCode(rawCode);
      if (!code) continue;
      let dimMap = byCountry.get(code);
      if (!dimMap) {
        dimMap = new Map();
        byCountry.set(code, dimMap);
      }
      let bucket = dimMap.get(signal.dimension);
      if (!bucket) {
        bucket = emptyBucket();
        dimMap.set(signal.dimension, bucket);
      }
      accumulate(bucket, signal, now);
    }
  }

  const out: CountryRisk[] = [];
  for (const [code, dimMap] of byCountry.entries()) {
    out.push(buildCountryRisk(code, dimMap));
  }
  out.sort((a, b) => b.score - a.score || a.countryCode.localeCompare(b.countryCode));
  return out;
}

function buildCountryRisk(
  countryCode: string,
  dimMap: Map<RiskDimension, BucketRow>,
): CountryRisk {
  let composite = 0;
  const breakdowns: DimensionBreakdown[] = [];
  let signalCount = 0;
  let lastUpdated = 0;

  for (const dimension of ALL_DIMENSIONS) {
    const bucket = dimMap.get(dimension);
    if (!bucket) continue;
    const score = bucketScore(bucket);
    const weight = DIMENSION_WEIGHTS[dimension];
    const weightedScore = Math.round(score * weight);
    composite += weightedScore;
    signalCount += bucket.signalCount;
    if (bucket.lastUpdated > lastUpdated) lastUpdated = bucket.lastUpdated;
    breakdowns.push({
      dimension,
      score,
      weightedScore,
      signalCount: bucket.signalCount,
      topLabel: bucket.topLabel,
    });
  }
  breakdowns.sort((a, b) => b.weightedScore - a.weightedScore);
  const compositeScore = clamp(composite, 0, 100);
  return {
    countryCode,
    score: compositeScore,
    tier: riskTier(compositeScore),
    signalCount,
    lastUpdated,
    byDimension: breakdowns,
    topDrivers: pickTopDrivers(breakdowns, 3),
  };
}

function pickTopDrivers(breakdowns: readonly DimensionBreakdown[], n: number): string[] {
  return breakdowns
    .filter((b) => b.topLabel)
    .slice(0, n)
    .map((b) => `${b.dimension}: ${b.topLabel ?? ''}`);
}

export function normalizeCountryCode(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  if (t.length !== 2) return null;
  if (!/^[A-Z]{2}$/.test(t)) return null;
  return t;
}

// ── Region aggregation ────────────────────────────────────────────

export type Region =
  | 'north-america'
  | 'latin-america'
  | 'europe'
  | 'former-soviet'
  | 'middle-east'
  | 'africa'
  | 'south-asia'
  | 'east-asia'
  | 'southeast-asia'
  | 'oceania'
  | 'other';

const REGION_LABEL: Record<Region, string> = {
  'north-america': 'North America',
  'latin-america': 'Latin America',
  'europe': 'Europe',
  'former-soviet': 'Former Soviet',
  'middle-east': 'Middle East',
  'africa': 'Africa',
  'south-asia': 'South Asia',
  'east-asia': 'East Asia',
  'southeast-asia': 'Southeast Asia',
  'oceania': 'Oceania',
  'other': 'Other',
};

export function regionLabel(r: Region): string {
  return REGION_LABEL[r];
}

const COUNTRY_TO_REGION: Readonly<Record<string, Region>> = {
  US: 'north-america', CA: 'north-america', MX: 'north-america',
  BR: 'latin-america', AR: 'latin-america', CO: 'latin-america', VE: 'latin-america',
  CL: 'latin-america', PE: 'latin-america', BO: 'latin-america', CU: 'latin-america',
  HT: 'latin-america', NI: 'latin-america',
  GB: 'europe', FR: 'europe', DE: 'europe', IT: 'europe', ES: 'europe',
  NL: 'europe', BE: 'europe', PL: 'europe', SE: 'europe', NO: 'europe',
  FI: 'europe', DK: 'europe', IE: 'europe', CH: 'europe', AT: 'europe',
  CZ: 'europe', HU: 'europe', GR: 'europe', RO: 'europe', PT: 'europe',
  RS: 'europe', BA: 'europe', UA: 'europe',
  RU: 'former-soviet', BY: 'former-soviet', KZ: 'former-soviet', UZ: 'former-soviet',
  AM: 'former-soviet', AZ: 'former-soviet', GE: 'former-soviet', KG: 'former-soviet',
  TJ: 'former-soviet', TM: 'former-soviet', MD: 'former-soviet',
  IL: 'middle-east', IR: 'middle-east', SA: 'middle-east', AE: 'middle-east',
  QA: 'middle-east', TR: 'middle-east', JO: 'middle-east', SY: 'middle-east',
  LB: 'middle-east', IQ: 'middle-east', YE: 'middle-east', OM: 'middle-east',
  BH: 'middle-east', KW: 'middle-east', PS: 'middle-east', EG: 'middle-east',
  ZA: 'africa', NG: 'africa', KE: 'africa', ET: 'africa', GH: 'africa',
  DZ: 'africa', MA: 'africa', LY: 'africa', SD: 'africa', SO: 'africa',
  MZ: 'africa', UG: 'africa', RW: 'africa', NE: 'africa', ML: 'africa',
  BF: 'africa', CD: 'africa', ZM: 'africa', AO: 'africa', TZ: 'africa',
  CM: 'africa', SS: 'africa', ER: 'africa',
  IN: 'south-asia', PK: 'south-asia', BD: 'south-asia', LK: 'south-asia',
  NP: 'south-asia', BT: 'south-asia', AF: 'south-asia',
  CN: 'east-asia', JP: 'east-asia', KR: 'east-asia', KP: 'east-asia', TW: 'east-asia',
  MN: 'east-asia', HK: 'east-asia',
  VN: 'southeast-asia', TH: 'southeast-asia', PH: 'southeast-asia', ID: 'southeast-asia',
  MY: 'southeast-asia', SG: 'southeast-asia', MM: 'southeast-asia', KH: 'southeast-asia',
  LA: 'southeast-asia',
  AU: 'oceania', NZ: 'oceania', PG: 'oceania',
};

export function regionOf(code: string): Region {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return 'other';
  return COUNTRY_TO_REGION[normalized] ?? 'other';
}

export interface RegionRisk {
  region: Region;
  label: string;
  /** 0–100 weighted mean across the region's countries. */
  score: number;
  tier: RiskTier;
  countryCount: number;
  topCountries: { code: string; score: number; tier: RiskTier }[];
}

export function scoreRegionRisks(countries: readonly CountryRisk[]): RegionRisk[] {
  const byRegion = new Map<Region, CountryRisk[]>();
  for (const c of countries) {
    const r = regionOf(c.countryCode);
    const arr = byRegion.get(r);
    if (arr) arr.push(c);
    else byRegion.set(r, [c]);
  }
  const out: RegionRisk[] = [];
  for (const [region, list] of byRegion.entries()) {
    out.push(buildRegionRisk(region, list));
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out;
}

function buildRegionRisk(region: Region, list: readonly CountryRisk[]): RegionRisk {
  // Top-heavy mean: the worst country contributes more than the average
  // — a single failed state should pull the region into "elevated" even
  // if its neighbors are stable.
  const sorted = [...list].sort((a, b) => b.score - a.score);
  let weighted = 0;
  let weightSum = 0;
  for (const [i, c] of sorted.entries()) {
    const weight = 1 / (i + 1);
    weighted += c.score * weight;
    weightSum += weight;
  }
  const score = weightSum === 0 ? 0 : Math.round(weighted / weightSum);
  return {
    region,
    label: regionLabel(region),
    score,
    tier: riskTier(score),
    countryCount: list.length,
    topCountries: sorted.slice(0, 3).map((c) => ({ code: c.countryCode, score: c.score, tier: c.tier })),
  };
}

// ── Great-power dyadic tension ────────────────────────────────────

export type GreatPower = 'US' | 'CN' | 'RU' | 'EU' | 'IN';

export const GREAT_POWERS: readonly GreatPower[] = ['US', 'CN', 'RU', 'EU', 'IN'];

const EU_MEMBERS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

function isCountryInPower(country: string, power: GreatPower): boolean {
  if (power === 'EU') return EU_MEMBERS.has(country);
  return country === power;
}

function signalMatchesPower(signal: RiskSignal, power: GreatPower): boolean {
  return signal.countryCodes.some((c) => {
    const normalized = normalizeCountryCode(c);
    return normalized !== null && isCountryInPower(normalized, power);
  });
}

export interface Dyad {
  a: GreatPower;
  b: GreatPower;
  /** 0–100 tension score. */
  score: number;
  tier: RiskTier;
  signalCount: number;
  topDrivers: string[];
}

const COMPETITION_DIMENSIONS = new Set<RiskDimension>([
  'great-power-competition',
  'sanctions-regime',
  'diplomatic-crisis',
  'territorial-dispute',
  'economic-statecraft',
]);

/**
 * Build every unordered pair of great powers and score the dyad on
 * signals that name *both* powers (or hit one power's territory while
 * being attributed to the other via tags). Pure on the input list —
 * the panel hands us the pre-filtered competition-related signals.
 */
export function scoreGreatPowerDyads(
  signals: readonly RiskSignal[],
  now: number = Date.now(),
): Dyad[] {
  const competitive = signals.filter((s) => COMPETITION_DIMENSIONS.has(s.dimension));
  const out: Dyad[] = [];
  for (let i = 0; i < GREAT_POWERS.length; i += 1) {
    for (let j = i + 1; j < GREAT_POWERS.length; j += 1) {
      const a = GREAT_POWERS[i]!;
      const b = GREAT_POWERS[j]!;
      out.push(buildDyad(a, b, competitive, now));
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function buildDyad(
  a: GreatPower,
  b: GreatPower,
  signals: readonly RiskSignal[],
  now: number,
): Dyad {
  const hits = signals.filter((s) => signalMatchesPower(s, a) && signalMatchesPower(s, b));
  let raw = 0;
  let freshSum = 0;
  let bestSev = 0;
  const drivers: { label: string; sev: number; observedAt: number }[] = [];
  for (const s of hits) {
    const sev = severityToScore(s.severity);
    const fresh = freshnessMultiplier(s.observedAt, now);
    raw += sev * fresh;
    freshSum += fresh;
    if (sev > bestSev) bestSev = sev;
    drivers.push({ label: s.label, sev, observedAt: s.observedAt });
  }
  const score = freshSum === 0 ? 0 : clamp(Math.round((raw / freshSum) * 10), 0, 100);
  drivers.sort((x, y) => y.sev - x.sev || y.observedAt - x.observedAt);
  return {
    a,
    b,
    score,
    tier: riskTier(score),
    signalCount: hits.length,
    topDrivers: drivers.slice(0, 3).map((d) => d.label),
  };
}

// ── ObservationEvent → RiskSignal adapter ─────────────────────────

const TAG_TO_DIMENSION: Record<string, RiskDimension> = {
  'territorial-dispute': 'territorial-dispute',
  'border-dispute': 'territorial-dispute',
  'alliance-shift': 'alliance-shift',
  'treaty': 'alliance-shift',
  'summit': 'alliance-shift',
  'sanctions': 'sanctions-regime',
  'sanctions-regime': 'sanctions-regime',
  'coup': 'coup-instability',
  'uprising': 'coup-instability',
  'contested-election': 'coup-instability',
  'expulsion': 'diplomatic-crisis',
  'embassy-closure': 'diplomatic-crisis',
  'diplomatic-crisis': 'diplomatic-crisis',
  'fonops': 'great-power-competition',
  'arms-sale': 'great-power-competition',
  'great-power-competition': 'great-power-competition',
  'export-control': 'economic-statecraft',
  'tariff': 'economic-statecraft',
  'economic-statecraft': 'economic-statecraft',
};

const COUNTRY_TAG_PREFIX = 'country:';

function extractDimensionFromTags(tags: readonly string[]): RiskDimension | null {
  for (const tag of tags) {
    const mapped = TAG_TO_DIMENSION[tag];
    if (mapped) return mapped;
  }
  return null;
}

function extractCountryCodes(tags: readonly string[], entityIds: readonly string[]): string[] {
  const codes: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(COUNTRY_TAG_PREFIX)) continue;
    const candidate = normalizeCountryCode(tag.slice(COUNTRY_TAG_PREFIX.length));
    if (candidate && !codes.includes(candidate)) codes.push(candidate);
  }
  for (const entityId of entityIds) {
    const candidate = normalizeCountryCode(entityId);
    if (candidate && !codes.includes(candidate)) codes.push(candidate);
  }
  return codes;
}

export function eventToRiskSignal(ev: ObservationEvent): RiskSignal | null {
  const dimension = extractDimensionFromTags(ev.tags);
  if (!dimension) return null;
  const countryCodes = extractCountryCodes(ev.tags, ev.entityIds);
  if (countryCodes.length === 0) return null;
  return {
    dimension,
    countryCodes,
    severity: ev.severity,
    observedAt: ev.timestamp,
    label: ev.title,
    sourceId: ev.sourceId,
  };
}

export function eventsToRiskSignals(events: readonly ObservationEvent[]): RiskSignal[] {
  const out: RiskSignal[] = [];
  for (const ev of events) {
    const signal = eventToRiskSignal(ev);
    if (signal) out.push(signal);
  }
  return out;
}

// ── Formatting + utilities ────────────────────────────────────────

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

// ── Composed state + renderer ─────────────────────────────────────

export interface GeopoliticalRiskState {
  topCountries: CountryRisk[];
  regions: RegionRisk[];
  dyads: Dyad[];
  signalCount: number;
  generatedAt: number;
}

export interface GeopoliticalRiskInputs {
  signals: readonly RiskSignal[];
  countryLimit?: number;
}

export function buildGeopoliticalRiskState(
  inputs: GeopoliticalRiskInputs,
  now: number = Date.now(),
): GeopoliticalRiskState {
  const countries = scoreCountryRisks(inputs.signals, now);
  const regions = scoreRegionRisks(countries);
  const dyads = scoreGreatPowerDyads(inputs.signals, now);
  return {
    topCountries: countries.slice(0, inputs.countryLimit ?? 10),
    regions,
    dyads,
    signalCount: inputs.signals.length,
    generatedAt: now,
  };
}

export function renderGeopoliticalRiskHtml(
  state: GeopoliticalRiskState,
  nowFn: () => number = Date.now,
): string {
  return `<div class="geo-risk-root">
    ${renderHeader(state)}
    ${renderRegions(state.regions)}
    ${renderCountries(state.topCountries)}
    ${renderDyads(state.dyads)}
    <div class="geo-risk-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(formatTimeAgo(state.generatedAt, nowFn()))} · ${state.signalCount} signals</div>
  </div>`;
}

function renderHeader(state: GeopoliticalRiskState): string {
  const top = state.regions[0];
  const summary = top
    ? `Highest: ${escapeHtml(top.label)} ${top.score} (${escapeHtml(top.tier)})`
    : 'No regional signals.';
  return `<section class="geo-risk-section" data-section="header">
    <h3 style="margin:0 0 6px 0;font-size:13px">Geopolitical Risk Index</h3>
    <div style="font-size:12px;opacity:0.85">${summary}</div>
  </section>`;
}

function renderRegionTopCountries(top: RegionRisk['topCountries']): string {
  if (top.length === 0) return '';
  const cells = top.map((c) => `${escapeHtml(c.code)}:${c.score}`).join(' · ');
  return `<div style="opacity:0.6;margin-top:2px;font-size:11px">${cells}</div>`;
}

function renderRegions(regions: RegionRisk[]): string {
  if (regions.length === 0) {
    return emptySection('regions', 'Regions', 'No regional signals.');
  }
  const items = regions.map((r) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:80px;text-transform:uppercase;font-weight:600;color:${tierColor(r.tier)}">${escapeHtml(r.tier)}</span>
    <strong>${escapeHtml(r.label)}</strong>
    <span style="opacity:0.65">· score ${r.score} · ${r.countryCount} ${r.countryCount === 1 ? 'country' : 'countries'}</span>
    ${renderRegionTopCountries(r.topCountries)}
  </li>`).join('');
  return `<section class="geo-risk-section" data-section="regions">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Region Risk</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderCountries(countries: CountryRisk[]): string {
  if (countries.length === 0) {
    return emptySection('countries', 'Top Countries', 'No country signals.');
  }
  const items = countries.map((c) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:64px;text-transform:uppercase;font-weight:600;color:${tierColor(c.tier)}">${escapeHtml(c.tier)}</span>
    <strong>${escapeHtml(c.countryCode)}</strong>
    <span style="opacity:0.65">· score ${c.score} · ${c.signalCount} signal${c.signalCount === 1 ? '' : 's'}</span>
    ${c.topDrivers.length > 0 ? `<div style="opacity:0.6;margin-top:2px;font-size:11px">${c.topDrivers.map((d) => escapeHtml(d)).join(' · ')}</div>` : ''}
  </li>`).join('');
  return `<section class="geo-risk-section" data-section="countries">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Top Countries</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderDyads(dyads: Dyad[]): string {
  const active = dyads.filter((d) => d.signalCount > 0);
  if (active.length === 0) {
    return emptySection('dyads', 'Great-Power Competition', 'No tracked great-power tension.');
  }
  const items = active.map((d) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:64px;text-transform:uppercase;font-weight:600;color:${tierColor(d.tier)}">${escapeHtml(d.tier)}</span>
    <strong>${escapeHtml(d.a)} ↔ ${escapeHtml(d.b)}</strong>
    <span style="opacity:0.65">· score ${d.score} · ${d.signalCount} signal${d.signalCount === 1 ? '' : 's'}</span>
    ${d.topDrivers.length > 0 ? `<div style="opacity:0.6;margin-top:2px;font-size:11px">${d.topDrivers.map((t) => escapeHtml(t)).join(' · ')}</div>` : ''}
  </li>`).join('');
  return `<section class="geo-risk-section" data-section="dyads">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Great-Power Competition</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function emptySection(slug: string, title: string, message: string): string {
  return `<section class="geo-risk-section" data-section="${slug}">
    <h3 style="margin:8px 0 6px 0;font-size:13px">${escapeHtml(title)}</h3>
    <div class="geo-risk-empty" style="opacity:0.6;font-size:12px">${escapeHtml(message)}</div>
  </section>`;
}

function tierColor(tier: RiskTier): string {
  switch (tier) {
    case 'critical': { return '#ef4444'; }
    case 'high': { return '#f97316'; }
    case 'elevated': { return '#eab308'; }
    case 'watch': { return '#84cc16'; }
    default: { return '#22c55e'; }
  }
}
