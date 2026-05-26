/**
 * Pure helpers for CurrencyWarfarePanel.
 *
 * Tracks seven categories of monetary-conflict signal and folds them
 * into per-currency and per-bloc composite scores:
 *
 *   - fx-intervention            → central bank market interventions
 *   - peg-stress                 → managed-float / pegged regimes under strain
 *   - capital-flight             → outflow surges, gating, FX-reserve drain
 *   - dollar-weaponization       → USD exclusion threats, secondary sanctions
 *   - swift-exclusion            → SWIFT disconnection events / threats
 *   - competitive-devaluation    → tit-for-tat managed depreciation
 *   - reserve-shift              → reserve-currency rebalancing (CNY/EUR/Gold)
 *
 * No DOM, no fetch, no globals — the panel file wires the live observation
 * store into these helpers. Older signals decay (10-day half-life) but
 * never vanish, because a SWIFT cutoff three weeks ago is still material.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

// ── Public types ──────────────────────────────────────────────────

export type WarfareDimension =
  | 'fx-intervention'
  | 'peg-stress'
  | 'capital-flight'
  | 'dollar-weaponization'
  | 'swift-exclusion'
  | 'competitive-devaluation'
  | 'reserve-shift';

export const ALL_DIMENSIONS: readonly WarfareDimension[] = [
  'fx-intervention',
  'peg-stress',
  'capital-flight',
  'dollar-weaponization',
  'swift-exclusion',
  'competitive-devaluation',
  'reserve-shift',
];

export type WarfareTier = 'calm' | 'watch' | 'elevated' | 'stressed' | 'crisis';

export interface WarfareSignal {
  dimension: WarfareDimension;
  /** ISO-4217 codes, uppercase. Multiple currencies may share a signal. */
  currencyCodes: string[];
  severity: ObservationSeverity;
  observedAt: number;
  label: string;
  sourceId?: string;
}

// ── Dimension weights ─────────────────────────────────────────────

/**
 * Weights chosen so a single CRITICAL dollar-weaponization or SWIFT
 * exclusion gets a currency into "stressed" on its own, while a noisy
 * but lower-severity peg-stress / fx-intervention combo needs at least
 * two HIGH events to cross the same threshold.
 */
export const DIMENSION_WEIGHTS: Readonly<Record<WarfareDimension, number>> = {
  'dollar-weaponization':    0.2,
  'swift-exclusion':         0.18,
  'capital-flight':          0.15,
  'peg-stress':              0.13,
  'fx-intervention':         0.12,
  'competitive-devaluation': 0.12,
  'reserve-shift':           0.1,
};

const SEVERITY_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 2, MEDIUM: 5, HIGH: 7, CRITICAL: 9,
};

export function severityToScore(s: ObservationSeverity): number {
  return SEVERITY_SCORE[s] ?? 0;
}

export function warfareTier(score: number): WarfareTier {
  if (score >= 80) return 'crisis';
  if (score >= 60) return 'stressed';
  if (score >= 40) return 'elevated';
  if (score >= 20) return 'watch';
  return 'calm';
}

// ── Freshness decay ───────────────────────────────────────────────

const HALF_LIFE_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

/**
 * Currency-warfare events fade faster than territorial signals — a
 * sanctions announcement loses material relevance after a week or two
 * once the market has priced it in. Never returns < 0.05.
 */
export function freshnessMultiplier(observedAt: number, now: number): number {
  const ageMs = Math.max(0, now - observedAt);
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return Math.max(0.05, decay);
}

// ── Currency composite ────────────────────────────────────────────

export interface DimensionBreakdown {
  dimension: WarfareDimension;
  score: number;
  weightedScore: number;
  signalCount: number;
  topLabel?: string;
}

export interface CurrencyRisk {
  currencyCode: string;
  score: number;
  tier: WarfareTier;
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

function accumulate(bucket: BucketRow, signal: WarfareSignal, now: number): void {
  const sev = severityToScore(signal.severity);
  const fresh = freshnessMultiplier(signal.observedAt, now);
  bucket.raw += sev * fresh;
  bucket.freshSum += fresh;
  bucket.signalCount += 1;
  if (signal.observedAt > bucket.lastUpdated) bucket.lastUpdated = signal.observedAt;
  if (sev > bucket.bestSeverityScore
    || (sev === bucket.bestSeverityScore && signal.observedAt > bucket.topObservedAt)) {
    bucket.bestSeverityScore = sev;
    bucket.topLabel = signal.label;
    bucket.topObservedAt = signal.observedAt;
  }
}

function bucketScore(bucket: BucketRow): number {
  if (bucket.freshSum === 0) return 0;
  const mean = bucket.raw / bucket.freshSum;
  const amplifier = 1 + Math.min(0.2, Math.log10(Math.max(1, bucket.signalCount)) * 0.15);
  return clamp(Math.round(mean * 10 * amplifier), 0, 100);
}

export function scoreCurrencyRisks(
  signals: readonly WarfareSignal[],
  now: number = Date.now(),
): CurrencyRisk[] {
  const byCurrency = new Map<string, Map<WarfareDimension, BucketRow>>();

  for (const signal of signals) {
    for (const rawCode of signal.currencyCodes) {
      const code = normalizeCurrencyCode(rawCode);
      if (!code) continue;
      let dimMap = byCurrency.get(code);
      if (!dimMap) {
        dimMap = new Map();
        byCurrency.set(code, dimMap);
      }
      let bucket = dimMap.get(signal.dimension);
      if (!bucket) {
        bucket = emptyBucket();
        dimMap.set(signal.dimension, bucket);
      }
      accumulate(bucket, signal, now);
    }
  }

  const out: CurrencyRisk[] = [];
  for (const [code, dimMap] of byCurrency.entries()) {
    out.push(buildCurrencyRisk(code, dimMap));
  }
  out.sort((a, b) => b.score - a.score || a.currencyCode.localeCompare(b.currencyCode));
  return out;
}

function buildCurrencyRisk(
  currencyCode: string,
  dimMap: Map<WarfareDimension, BucketRow>,
): CurrencyRisk {
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
    currencyCode,
    score: compositeScore,
    tier: warfareTier(compositeScore),
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

export function normalizeCurrencyCode(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  if (t.length !== 3) return null;
  if (!/^[A-Z]{3}$/.test(t)) return null;
  return t;
}

// ── Currency-bloc aggregation ─────────────────────────────────────

export type CurrencyBloc =
  | 'usd-bloc'
  | 'eur-bloc'
  | 'cny-bloc'
  | 'gulf-pegs'
  | 'em-asia'
  | 'em-latam'
  | 'em-africa'
  | 'em-europe'
  | 'reserve-alts'
  | 'other';

const BLOC_LABEL: Record<CurrencyBloc, string> = {
  'usd-bloc': 'USD Bloc',
  'eur-bloc': 'EUR Bloc',
  'cny-bloc': 'CNY Bloc',
  'gulf-pegs': 'Gulf Pegs',
  'em-asia': 'EM Asia',
  'em-latam': 'EM LatAm',
  'em-africa': 'EM Africa',
  'em-europe': 'EM Europe',
  'reserve-alts': 'Reserve Alternatives',
  'other': 'Other',
};

export function blocLabel(b: CurrencyBloc): string {
  return BLOC_LABEL[b];
}

const CURRENCY_TO_BLOC: Readonly<Record<string, CurrencyBloc>> = {
  USD: 'usd-bloc', CAD: 'usd-bloc',
  EUR: 'eur-bloc', GBP: 'eur-bloc', CHF: 'eur-bloc', SEK: 'eur-bloc',
  NOK: 'eur-bloc', DKK: 'eur-bloc',
  CNY: 'cny-bloc', HKD: 'cny-bloc', MOP: 'cny-bloc',
  SAR: 'gulf-pegs', AED: 'gulf-pegs', QAR: 'gulf-pegs', OMR: 'gulf-pegs',
  BHD: 'gulf-pegs', KWD: 'gulf-pegs', JOD: 'gulf-pegs',
  JPY: 'em-asia', KRW: 'em-asia', INR: 'em-asia', IDR: 'em-asia',
  THB: 'em-asia', MYR: 'em-asia', PHP: 'em-asia', VND: 'em-asia',
  SGD: 'em-asia', TWD: 'em-asia', PKR: 'em-asia', BDT: 'em-asia',
  LKR: 'em-asia', NPR: 'em-asia',
  BRL: 'em-latam', MXN: 'em-latam', ARS: 'em-latam', CLP: 'em-latam',
  COP: 'em-latam', PEN: 'em-latam', VES: 'em-latam', BOB: 'em-latam',
  ZAR: 'em-africa', NGN: 'em-africa', EGP: 'em-africa', KES: 'em-africa',
  GHS: 'em-africa', MAD: 'em-africa', DZD: 'em-africa', TND: 'em-africa',
  TRY: 'em-europe', PLN: 'em-europe', HUF: 'em-europe', CZK: 'em-europe',
  RON: 'em-europe', RUB: 'em-europe', UAH: 'em-europe', BYN: 'em-europe',
  XAU: 'reserve-alts', XAG: 'reserve-alts', XDR: 'reserve-alts',
};

export function blocOf(code: string): CurrencyBloc {
  const normalized = normalizeCurrencyCode(code);
  if (!normalized) return 'other';
  return CURRENCY_TO_BLOC[normalized] ?? 'other';
}

export interface BlocRisk {
  bloc: CurrencyBloc;
  label: string;
  score: number;
  tier: WarfareTier;
  currencyCount: number;
  topCurrencies: { code: string; score: number; tier: WarfareTier }[];
}

export function scoreBlocRisks(currencies: readonly CurrencyRisk[]): BlocRisk[] {
  const byBloc = new Map<CurrencyBloc, CurrencyRisk[]>();
  for (const c of currencies) {
    const b = blocOf(c.currencyCode);
    const arr = byBloc.get(b);
    if (arr) arr.push(c);
    else byBloc.set(b, [c]);
  }
  const out: BlocRisk[] = [];
  for (const [bloc, list] of byBloc.entries()) {
    out.push(buildBlocRisk(bloc, list));
  }
  out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return out;
}

function buildBlocRisk(bloc: CurrencyBloc, list: readonly CurrencyRisk[]): BlocRisk {
  // Top-heavy mean — one currency in crisis pulls the whole bloc
  // into "elevated" even if its neighbors are fine.
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
    bloc,
    label: blocLabel(bloc),
    score,
    tier: warfareTier(score),
    currencyCount: list.length,
    topCurrencies: sorted.slice(0, 3).map((c) => ({
      code: c.currencyCode,
      score: c.score,
      tier: c.tier,
    })),
  };
}

// ── Reserve-shift trend ───────────────────────────────────────────

export interface ReserveShiftIndicator {
  /** Currency being rebalanced INTO (e.g. CNY, XAU). */
  targetCurrency: string;
  /** 0–100 composite of recent reserve-shift signals weighted by severity. */
  score: number;
  signalCount: number;
  topDrivers: string[];
}

export function scoreReserveShift(
  signals: readonly WarfareSignal[],
  now: number = Date.now(),
): ReserveShiftIndicator[] {
  const byTarget = new Map<string, { raw: number; fresh: number; drivers: { label: string; sev: number; ts: number }[]; count: number }>();
  for (const s of signals) {
    if (s.dimension !== 'reserve-shift') continue;
    for (const rawCode of s.currencyCodes) {
      const code = normalizeCurrencyCode(rawCode);
      if (!code) continue;
      let row = byTarget.get(code);
      if (!row) {
        row = { raw: 0, fresh: 0, drivers: [], count: 0 };
        byTarget.set(code, row);
      }
      const sev = severityToScore(s.severity);
      const f = freshnessMultiplier(s.observedAt, now);
      row.raw += sev * f;
      row.fresh += f;
      row.count += 1;
      row.drivers.push({ label: s.label, sev, ts: s.observedAt });
    }
  }
  const out: ReserveShiftIndicator[] = [];
  for (const [code, row] of byTarget.entries()) {
    const score = row.fresh === 0 ? 0 : clamp(Math.round((row.raw / row.fresh) * 10), 0, 100);
    const drivers = [...row.drivers].sort((a, b) => b.sev - a.sev || b.ts - a.ts);
    out.push({
      targetCurrency: code,
      score,
      signalCount: row.count,
      topDrivers: drivers.slice(0, 3).map((d) => d.label),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ── Dollar-weaponization + SWIFT-exclusion roll-ups ──────────────

export interface ExclusionEntry {
  currencyCode: string;
  score: number;
  signalCount: number;
  latest: number;
  drivers: string[];
}

interface ExclusionRow {
  raw: number;
  fresh: number;
  latest: number;
  drivers: { label: string; sev: number; ts: number }[];
  count: number;
}

function appendExclusionSignal(row: ExclusionRow, s: WarfareSignal, now: number): void {
  const sev = severityToScore(s.severity);
  const f = freshnessMultiplier(s.observedAt, now);
  row.raw += sev * f;
  row.fresh += f;
  row.count += 1;
  if (s.observedAt > row.latest) row.latest = s.observedAt;
  row.drivers.push({ label: s.label, sev, ts: s.observedAt });
}

function rollUpExclusion(
  signals: readonly WarfareSignal[],
  dimension: WarfareDimension,
  now: number,
): ExclusionEntry[] {
  const byCurrency = new Map<string, ExclusionRow>();
  for (const s of signals) {
    if (s.dimension !== dimension) continue;
    for (const rawCode of s.currencyCodes) {
      const code = normalizeCurrencyCode(rawCode);
      if (!code) continue;
      let row = byCurrency.get(code);
      if (!row) {
        row = { raw: 0, fresh: 0, latest: 0, drivers: [], count: 0 };
        byCurrency.set(code, row);
      }
      appendExclusionSignal(row, s, now);
    }
  }
  const out: ExclusionEntry[] = [];
  for (const [code, row] of byCurrency.entries()) {
    const score = row.fresh === 0 ? 0 : clamp(Math.round((row.raw / row.fresh) * 10), 0, 100);
    const drivers = [...row.drivers].sort((a, b) => b.sev - a.sev || b.ts - a.ts);
    out.push({
      currencyCode: code,
      score,
      signalCount: row.count,
      latest: row.latest,
      drivers: drivers.slice(0, 3).map((d) => d.label),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function scoreDollarWeaponization(
  signals: readonly WarfareSignal[],
  now: number = Date.now(),
): ExclusionEntry[] {
  return rollUpExclusion(signals, 'dollar-weaponization', now);
}

export function scoreSwiftExclusion(
  signals: readonly WarfareSignal[],
  now: number = Date.now(),
): ExclusionEntry[] {
  return rollUpExclusion(signals, 'swift-exclusion', now);
}

// ── ObservationEvent → WarfareSignal adapter ──────────────────────

const TAG_TO_DIMENSION: Record<string, WarfareDimension> = {
  'fx-intervention': 'fx-intervention',
  'fx-intervene': 'fx-intervention',
  'central-bank-intervention': 'fx-intervention',
  'peg-stress': 'peg-stress',
  'peg-break': 'peg-stress',
  'managed-float-stress': 'peg-stress',
  'capital-flight': 'capital-flight',
  'capital-controls': 'capital-flight',
  'reserve-drain': 'capital-flight',
  'dollar-weaponization': 'dollar-weaponization',
  'usd-exclusion': 'dollar-weaponization',
  'secondary-sanctions': 'dollar-weaponization',
  'swift-exclusion': 'swift-exclusion',
  'swift-disconnect': 'swift-exclusion',
  'swift': 'swift-exclusion',
  'competitive-devaluation': 'competitive-devaluation',
  'devaluation': 'competitive-devaluation',
  'currency-war': 'competitive-devaluation',
  'reserve-shift': 'reserve-shift',
  'de-dollarization': 'reserve-shift',
  'reserve-rebalance': 'reserve-shift',
};

const CURRENCY_TAG_PREFIX = 'currency:';

function extractDimensionFromTags(tags: readonly string[]): WarfareDimension | null {
  for (const tag of tags) {
    const mapped = TAG_TO_DIMENSION[tag];
    if (mapped) return mapped;
  }
  return null;
}

function extractCurrencyCodes(tags: readonly string[], entityIds: readonly string[]): string[] {
  const codes: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(CURRENCY_TAG_PREFIX)) continue;
    const candidate = normalizeCurrencyCode(tag.slice(CURRENCY_TAG_PREFIX.length));
    if (candidate && !codes.includes(candidate)) codes.push(candidate);
  }
  for (const entityId of entityIds) {
    const candidate = normalizeCurrencyCode(entityId);
    if (candidate && !codes.includes(candidate)) codes.push(candidate);
  }
  return codes;
}

export function eventToWarfareSignal(ev: ObservationEvent): WarfareSignal | null {
  const dimension = extractDimensionFromTags(ev.tags);
  if (!dimension) return null;
  const currencyCodes = extractCurrencyCodes(ev.tags, ev.entityIds);
  if (currencyCodes.length === 0) return null;
  return {
    dimension,
    currencyCodes,
    severity: ev.severity,
    observedAt: ev.timestamp,
    label: ev.title,
    sourceId: ev.sourceId,
  };
}

export function eventsToWarfareSignals(events: readonly ObservationEvent[]): WarfareSignal[] {
  const out: WarfareSignal[] = [];
  for (const ev of events) {
    const signal = eventToWarfareSignal(ev);
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

export interface CurrencyWarfareState {
  topCurrencies: CurrencyRisk[];
  blocs: BlocRisk[];
  reserveShift: ReserveShiftIndicator[];
  dollarWeaponization: ExclusionEntry[];
  swiftExclusion: ExclusionEntry[];
  signalCount: number;
  generatedAt: number;
}

export interface CurrencyWarfareInputs {
  signals: readonly WarfareSignal[];
  currencyLimit?: number;
}

export function buildCurrencyWarfareState(
  inputs: CurrencyWarfareInputs,
  now: number = Date.now(),
): CurrencyWarfareState {
  const currencies = scoreCurrencyRisks(inputs.signals, now);
  const blocs = scoreBlocRisks(currencies);
  const reserveShift = scoreReserveShift(inputs.signals, now);
  const dollarWeaponization = scoreDollarWeaponization(inputs.signals, now);
  const swiftExclusion = scoreSwiftExclusion(inputs.signals, now);
  return {
    topCurrencies: currencies.slice(0, inputs.currencyLimit ?? 10),
    blocs,
    reserveShift,
    dollarWeaponization,
    swiftExclusion,
    signalCount: inputs.signals.length,
    generatedAt: now,
  };
}

export function renderCurrencyWarfareHtml(
  state: CurrencyWarfareState,
  nowFn: () => number = Date.now,
): string {
  return `<div class="cw-root">
    ${renderHeader(state)}
    ${renderBlocs(state.blocs)}
    ${renderCurrencies(state.topCurrencies)}
    ${renderExclusionSection('dollar-weaponization', 'USD Weaponization', state.dollarWeaponization)}
    ${renderExclusionSection('swift-exclusion', 'SWIFT Exclusion', state.swiftExclusion)}
    ${renderReserveShift(state.reserveShift)}
    <div class="cw-footer" style="margin-top:8px;font-size:11px;opacity:0.6">Updated ${escapeHtml(formatTimeAgo(state.generatedAt, nowFn()))} · ${state.signalCount} signals</div>
  </div>`;
}

function renderHeader(state: CurrencyWarfareState): string {
  const top = state.blocs[0];
  const summary = top
    ? `Highest: ${escapeHtml(top.label)} ${top.score} (${escapeHtml(top.tier)})`
    : 'No currency-warfare signals.';
  return `<section class="cw-section" data-section="header">
    <h3 style="margin:0 0 6px 0;font-size:13px">Currency Warfare</h3>
    <div style="font-size:12px;opacity:0.85">${summary}</div>
  </section>`;
}

function renderBlocTopCurrencies(top: BlocRisk['topCurrencies']): string {
  if (top.length === 0) return '';
  const cells = top.map((c) => `${escapeHtml(c.code)}:${c.score}`).join(' · ');
  return `<div style="opacity:0.6;margin-top:2px;font-size:11px">${cells}</div>`;
}

function renderBlocs(blocs: BlocRisk[]): string {
  if (blocs.length === 0) {
    return emptySection('blocs', 'Blocs', 'No bloc signals.');
  }
  const items = blocs.map((b) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:88px;text-transform:uppercase;font-weight:600;color:${tierColor(b.tier)}">${escapeHtml(b.tier)}</span>
    <strong>${escapeHtml(b.label)}</strong>
    <span style="opacity:0.65">· score ${b.score} · ${b.currencyCount} ${b.currencyCount === 1 ? 'currency' : 'currencies'}</span>
    ${renderBlocTopCurrencies(b.topCurrencies)}
  </li>`).join('');
  return `<section class="cw-section" data-section="blocs">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Bloc Stress</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderDriverList(drivers: readonly string[]): string {
  if (drivers.length === 0) return '';
  const cells = drivers.map((d) => escapeHtml(d)).join(' · ');
  return `<div style="opacity:0.6;margin-top:2px;font-size:11px">${cells}</div>`;
}

function renderCurrencies(currencies: CurrencyRisk[]): string {
  if (currencies.length === 0) {
    return emptySection('currencies', 'Top Currencies', 'No currency signals.');
  }
  const items = currencies.map((c) => `<li style="padding:4px 0;font-size:12px">
    <span style="display:inline-block;width:72px;text-transform:uppercase;font-weight:600;color:${tierColor(c.tier)}">${escapeHtml(c.tier)}</span>
    <strong>${escapeHtml(c.currencyCode)}</strong>
    <span style="opacity:0.65">· score ${c.score} · ${c.signalCount} signal${c.signalCount === 1 ? '' : 's'}</span>
    ${renderDriverList(c.topDrivers)}
  </li>`).join('');
  return `<section class="cw-section" data-section="currencies">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Top Currencies</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderExclusionSection(
  slug: string,
  title: string,
  entries: readonly ExclusionEntry[],
): string {
  if (entries.length === 0) {
    return emptySection(slug, title, `No ${title.toLowerCase()} signals.`);
  }
  const items = entries.map((e) => `<li style="padding:4px 0;font-size:12px">
    <strong>${escapeHtml(e.currencyCode)}</strong>
    <span style="opacity:0.65">· score ${e.score} · ${e.signalCount} signal${e.signalCount === 1 ? '' : 's'}</span>
    ${renderDriverList(e.drivers)}
  </li>`).join('');
  return `<section class="cw-section" data-section="${slug}">
    <h3 style="margin:8px 0 6px 0;font-size:13px">${escapeHtml(title)}</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function renderReserveShift(entries: ReserveShiftIndicator[]): string {
  if (entries.length === 0) {
    return emptySection('reserve-shift', 'Reserve Shift', 'No reserve-shift signals.');
  }
  const items = entries.map((e) => `<li style="padding:4px 0;font-size:12px">
    <strong>${escapeHtml(e.targetCurrency)}</strong>
    <span style="opacity:0.65">· score ${e.score} · ${e.signalCount} signal${e.signalCount === 1 ? '' : 's'}</span>
    ${renderDriverList(e.topDrivers)}
  </li>`).join('');
  return `<section class="cw-section" data-section="reserve-shift">
    <h3 style="margin:8px 0 6px 0;font-size:13px">Reserve Shift</h3>
    <ul style="list-style:none;padding:0;margin:0">${items}</ul>
  </section>`;
}

function emptySection(slug: string, title: string, message: string): string {
  return `<section class="cw-section" data-section="${slug}">
    <h3 style="margin:8px 0 6px 0;font-size:13px">${escapeHtml(title)}</h3>
    <div class="cw-empty" style="opacity:0.6;font-size:12px">${escapeHtml(message)}</div>
  </section>`;
}

function tierColor(tier: WarfareTier): string {
  switch (tier) {
    case 'crisis': { return '#ef4444'; }
    case 'stressed': { return '#f97316'; }
    case 'elevated': { return '#eab308'; }
    case 'watch': { return '#84cc16'; }
    default: { return '#22c55e'; }
  }
}
