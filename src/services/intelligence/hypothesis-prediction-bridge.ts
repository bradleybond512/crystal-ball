/**
 * Hypothesis → Prediction bridge. Every analyst-loop cycle logs its ranked
 * hypotheses as pending PredictionRecords so the calibration ledger can
 * grade the analyst layer (plan invariant: "every forecast must be logged
 * and later evaluated"). Keyed by feedback signature + a 6h window bucket
 * so successive 5-minute cycles don't spam duplicates.
 *
 * Resolution hook: hypothesis-accuracy calls resolveHypothesisPrediction
 * when it grades hit/miss after the 2-hour window.
 */

import { signatureFor } from '@/services/hypothesis-feedback';
import { entitiesFromHypothesis } from '@/services/hypothesis-entities';
import type { Hypothesis } from '@/services/analyst-loop';
import {
  getLatestSpotPrice,
  type SpotPriceObservation,
} from '@/services/market/spot-price-store';
import {
  getCalibrationStore,
  recordPrediction,
  resolvePrediction,
} from './forecast-calibration-adapter';
import type { MarketMoveCriteria } from './forecast-calibration';
import type { FactDomain } from './types';

const WINDOW_MS = 6 * 60 * 60 * 1000;        // dedupe bucket
export const HYPOTHESIS_OUTCOME_HORIZON_MS = 2 * 60 * 60 * 1000;
export const MARKET_CRITERIA_MIN_ABS_PCT = 3;
const MAX_MARKET_BASIS_AGE_MS = 20 * 60 * 1000;
const UP_CUE = /\b(?:rally|rallies|surge|surges|spike|spikes|soar|soars|rebound|rebounds|jump|jumps)\b/i;
const DOWN_CUE = /\b(?:drop|drops|fall|falls|sell-off|selloff|crash|crashes|plunge|plunges|slump|slumps|decline|declines)\b/i;

type PredictionIdentityHypothesis = Pick<Hypothesis, 'kind' | 'evidence' | 'region'>;

export function predictionIdFor(
  h: PredictionIdentityHypothesis,
  now: number,
): string {
  const bucket = Math.floor(now / WINDOW_MS);
  return `hyp:${signatureFor(h)}:${bucket}`;
}

const SITUATION_DOMAIN_MAP: Readonly<Record<string, FactDomain>> = {
  military: 'conflict',
  economic: 'markets',
  natural_hazard: 'weather',
  cyber: 'cyber',
  infrastructure: 'infra',
  health: 'humanitarian',
  civil_unrest: 'conflict',
  compound: 'other',
};

const ALERT_SOURCE_DOMAIN_MAP: Readonly<Record<string, FactDomain>> = {
  nws: 'weather',
  gdacs: 'humanitarian',
  tsunami: 'weather',
  volcano: 'weather',
  oref: 'conflict',
  cyber: 'cyber',
  earthquake: 'weather',
  fire: 'weather',
  cyclone: 'weather',
  'power-grid': 'infra',
  'comms-health': 'infra',
  'space-weather': 'space',
  spc: 'weather',
  disease: 'humanitarian',
  maritime: 'maritime',
  'air-quality': 'weather',
  'aviation-hazard': 'aviation',
};

export function factDomainForSituationDomain(domain: string): FactDomain {
  return SITUATION_DOMAIN_MAP[domain] ?? 'other';
}

export function factDomainForAlertSource(source: string): FactDomain {
  return ALERT_SOURCE_DOMAIN_MAP[source] ?? 'other';
}

export function factDomainForSignalSource(source: string): FactDomain {
  const prefix = source.split(':', 1)[0]?.toLowerCase() ?? '';
  if (prefix in SITUATION_DOMAIN_MAP) return factDomainForSituationDomain(prefix);
  if (prefix in ALERT_SOURCE_DOMAIN_MAP) return factDomainForAlertSource(prefix);
  if (['market', 'markets', 'finance'].includes(prefix)) return 'markets';
  if (['macro', 'economy'].includes(prefix)) return 'macro';
  if (['aviation', 'flight'].includes(prefix)) return 'aviation';
  if (['maritime', 'shipping'].includes(prefix)) return 'maritime';
  if (['infra', 'power', 'grid', 'comms'].includes(prefix)) return 'infra';
  return 'other';
}

/** Only use a domain-specific calibration curve when upstream evidence agrees
 *  on one domain. Mixed-domain hypotheses stay in the explicit `other` pool
 *  instead of contaminating one domain's reliability history. */
export function domainForHypothesis(
  h: Pick<Hypothesis, 'domains'>,
): FactDomain {
  const domains = [...new Set(h.domains)];
  return domains.length === 1 ? domains[0]! : 'other';
}

export function targetKeyForHypothesis(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
): string {
  return `hypothesis:${signatureFor(h)}`;
}

export function claimForHypothesisOutcome(
  h: Pick<Hypothesis, 'statement'>,
): string {
  return `Within the next 2 hours, supporting evidence will remain hot or escalate for: ${h.statement}`;
}

type SpotPriceLookup = (
  symbol: string,
  asOf: number,
) => SpotPriceObservation | null;

function spotSymbolFor(entity: string): string {
  const normalized = entity.toUpperCase();
  if (/^(?:BTC|ETH|SOL|XRP)-USD$/.test(normalized)) {
    return normalized.slice(0, -4);
  }
  return normalized;
}

export function marketCriteriaFor(
  hypothesis: Hypothesis,
  predictedAt: number,
  spotFor: SpotPriceLookup = getLatestSpotPrice,
): MarketMoveCriteria | undefined {
  if (domainForHypothesis(hypothesis) !== 'markets') return undefined;
  const tickers = [...new Set(
    entitiesFromHypothesis(hypothesis)
      .filter((mention) => mention.kind === 'ticker')
      .map((mention) => spotSymbolFor(mention.entity)),
  )];
  if (tickers.length !== 1) return undefined;
  const hasUpCue = UP_CUE.test(hypothesis.statement);
  const hasDownCue = DOWN_CUE.test(hypothesis.statement);
  if (hasUpCue === hasDownCue) return undefined;
  const symbol = tickers[0]!;
  const basis = spotFor(symbol, predictedAt);
  if (
    !basis
    || !Number.isFinite(basis.price)
    || basis.price <= 0
    || !Number.isFinite(basis.observedAt)
    || basis.observedAt > predictedAt
    || predictedAt - basis.observedAt > MAX_MARKET_BASIS_AGE_MS
  ) {
    return undefined;
  }
  return {
    kind: 'market_move',
    symbol,
    direction: hasUpCue ? 'up' : 'down',
    minAbsPct: MARKET_CRITERIA_MIN_ABS_PCT,
    basisPrice: basis.price,
    basisObservedAt: basis.observedAt,
  };
}

export function recordHypothesisPredictions(
  hypotheses: readonly Hypothesis[],
  now: number = Date.now(),
  spotFor: SpotPriceLookup = getLatestSpotPrice,
): void {
  const store = getCalibrationStore();
  for (const h of hypotheses) {
    const id = predictionIdFor(h, now);
    if (store.get(id)) continue; // already logged this window
    recordPrediction({
      id,
      sourceId: 'analyst-loop',
      targetKey: targetKeyForHypothesis(h),
      domain: domainForHypothesis(h),
      claim: claimForHypothesisOutcome(h),
      probability: Math.max(0, Math.min(1, h.confidence)),
      predictedAt: now,
      resolveBy: now + HYPOTHESIS_OUTCOME_HORIZON_MS,
      status: 'pending',
      criteria: marketCriteriaFor(h, now, spotFor),
      algorithmVersion: 'analyst-loop-v2',
    });
  }
}

/** Resolve the most recent pending prediction for this hypothesis's
 *  signature. Called by hypothesis-accuracy when it grades hit/miss. */
export function resolveHypothesisPrediction(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
  hit: boolean,
  now: number = Date.now(),
): boolean {
  return resolveHypothesisPredictionBySig(signatureFor(h), hit, now);
}

/** Resolve by pre-computed signature string. Use this from hypothesis-accuracy
 *  which stores the signature at stamp time, avoiding a re-derivation. */
export function resolveHypothesisPredictionBySig(
  sig: string,
  hit: boolean,
  now: number = Date.now(),
): boolean {
  const store = getCalibrationStore();
  const targetKey = `hypothesis:${sig}`;
  const sigPrefix = `hyp:${sig}:`;
  const due = store.all()
    .filter((r) =>
      r.status === 'pending'
      && (r.targetKey === targetKey || r.id.startsWith(sigPrefix))
      && r.resolveBy <= now)
    .sort((a, b) => a.predictedAt - b.predictedAt);
  let resolved = false;
  for (const target of due) {
    resolved = resolvePrediction(target.id, hit, now) || resolved;
  }
  return resolved;
}
