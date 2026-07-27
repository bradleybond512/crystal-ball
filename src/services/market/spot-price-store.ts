import type { FusedFact } from '../providers/fusion-ingest';

export interface SpotPriceObservation {
  symbol: string;
  price: number;
  observedAt: number;
  providerIds: readonly string[];
  independentSourceCount: number;
  confidence: number;
}

export interface SpotPriceDiagnostics {
  symbolCount: number;
  sampleCount: number;
  latestObservedAt: number | null;
  staleSymbolCount: number;
}

export const MAX_SPOT_SAMPLES_PER_SYMBOL = 192;
const STORAGE_KEY = 'crystalball-fused-spot-history-v1';
const STALE_AFTER_MS = 30 * 60 * 1000;
const histories = new Map<string, SpotPriceObservation[]>();
let loaded = false;

function normalizeSymbol(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.=+-]{0,15}$/.test(normalized)) return null;
  return normalized;
}

function isValidObservation(value: unknown): value is SpotPriceObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.symbol === 'string'
    && normalizeSymbol(row.symbol) !== null
    && typeof row.price === 'number'
    && Number.isFinite(row.price)
    && row.price > 0
    && typeof row.observedAt === 'number'
    && Number.isFinite(row.observedAt)
    && row.observedAt >= 0
    && Array.isArray(row.providerIds)
    && row.providerIds.every((id) => typeof id === 'string' && id.length > 0)
    && typeof row.independentSourceCount === 'number'
    && Number.isInteger(row.independentSourceCount)
    && row.independentSourceCount >= 1
    && typeof row.confidence === 'number'
    && Number.isFinite(row.confidence)
    && row.confidence >= 0
    && row.confidence <= 1;
}

function cloneObservation(row: SpotPriceObservation): SpotPriceObservation {
  return { ...row, providerIds: [...row.providerIds] };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (!isValidObservation(value)) continue;
      insertObservation(cloneObservation(value), false);
    }
  } catch {
    histories.clear();
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...histories.values()].flat()),
    );
  } catch {
    // Forecast resolution remains available in-memory when storage is unavailable.
  }
}

function observationQuality(row: SpotPriceObservation): number {
  return row.independentSourceCount * 10 + row.confidence;
}

function insertObservation(
  observation: SpotPriceObservation,
  shouldPersist: boolean,
): void {
  const history = histories.get(observation.symbol) ?? [];
  const duplicateIndex = history.findIndex(
    (candidate) => candidate.observedAt === observation.observedAt,
  );
  if (duplicateIndex === -1) {
    history.push(observation);
  } else {
    const existing = history[duplicateIndex]!;
    if (observationQuality(observation) <= observationQuality(existing)) return;
    history[duplicateIndex] = observation;
  }
  history.sort((a, b) => a.observedAt - b.observedAt);
  if (history.length > MAX_SPOT_SAMPLES_PER_SYMBOL) {
    history.splice(0, history.length - MAX_SPOT_SAMPLES_PER_SYMBOL);
  }
  histories.set(observation.symbol, history);
  if (shouldPersist) persist();
}

export function recordFusedSpotPrices(facts: readonly FusedFact[]): number {
  ensureLoaded();
  let recorded = 0;
  for (const fact of facts) {
    const symbol = typeof fact.key === 'string' ? normalizeSymbol(fact.key) : null;
    if (
      !symbol
      || !Number.isFinite(fact.value)
      || fact.value <= 0
      || !Number.isFinite(fact.occurredAt)
      || fact.occurredAt < 0
      || fact.fusion.independentSourceCount < 1
      || !Number.isFinite(fact.fusion.confidenceMultiplier)
    ) {
      continue;
    }
    const disagreeingProviderIds = new Set(
      fact.fusion.disagreements.flatMap((disagreement) => disagreement.providerIds),
    );
    const providerIds = fact.providerIds.filter(
      (providerId) =>
        typeof providerId === 'string'
        && providerId.length > 0
        && !disagreeingProviderIds.has(providerId),
    );
    if (providerIds.length === 0) continue;
    const before = histories.get(symbol)?.find(
      (candidate) => candidate.observedAt === fact.occurredAt,
    );
    insertObservation({
      symbol,
      price: fact.value,
      observedAt: fact.occurredAt,
      providerIds: [...providerIds],
      independentSourceCount: fact.fusion.independentSourceCount,
      confidence: Math.max(0, Math.min(1, fact.fusion.confidenceMultiplier)),
    }, false);
    const after = histories.get(symbol)?.find(
      (candidate) => candidate.observedAt === fact.occurredAt,
    );
    if (after !== before) recorded += 1;
  }
  if (recorded > 0) persist();
  return recorded;
}

export function getLatestSpotPrice(
  symbol: string,
  asOf: number = Number.POSITIVE_INFINITY,
): SpotPriceObservation | null {
  ensureLoaded();
  const normalized = normalizeSymbol(symbol);
  if (!normalized || !Number.isFinite(asOf) && asOf !== Number.POSITIVE_INFINITY) return null;
  const history = histories.get(normalized) ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const observation = history[index]!;
    if (observation.observedAt <= asOf) return cloneObservation(observation);
  }
  return null;
}

export function getSpotPriceHistory(
  symbol: string,
  options: { sinceExclusive?: number; untilInclusive?: number } = {},
): SpotPriceObservation[] {
  ensureLoaded();
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return [];
  const sinceExclusive = options.sinceExclusive ?? Number.NEGATIVE_INFINITY;
  const untilInclusive = options.untilInclusive ?? Number.POSITIVE_INFINITY;
  return (histories.get(normalized) ?? [])
    .filter((row) =>
      row.observedAt > sinceExclusive && row.observedAt <= untilInclusive)
    .map((row) => cloneObservation(row));
}

export function getSpotPriceDiagnostics(now: number = Date.now()): SpotPriceDiagnostics {
  ensureLoaded();
  let sampleCount = 0;
  let latestObservedAt: number | null = null;
  let staleSymbolCount = 0;
  for (const history of histories.values()) {
    sampleCount += history.length;
    const latest = history[history.length - 1]?.observedAt ?? null;
    if (latest !== null) {
      latestObservedAt = latestObservedAt === null
        ? latest
        : Math.max(latestObservedAt, latest);
      if (now - latest > STALE_AFTER_MS) staleSymbolCount += 1;
    }
  }
  return {
    symbolCount: histories.size,
    sampleCount,
    latestObservedAt,
    staleSymbolCount,
  };
}

export function _resetSpotPriceStoreForTests(
  options: { clearPersistence?: boolean } = {},
): void {
  histories.clear();
  loaded = false;
  if (options.clearPersistence && typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
