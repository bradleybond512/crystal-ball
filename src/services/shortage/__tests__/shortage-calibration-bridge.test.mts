import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
};

import {
  toPredictionRecord,
  recordShortagePredictions,
  resolveShortagePrediction,
  resolveShortageFromObservation,
  settleExpiredShortagePredictions,
  shortagePredictionProbability,
  shortagePredictionId,
  shortagePredictionClaim,
  shortageKeyPrefix,
  domainForShortage,
  sourceIdForShortage,
  forecastsWithLiveInputs,
  CONFIDENCE_WEIGHT,
  SHORTAGE_ELEVATED_THRESHOLD,
} from '../shortage-calibration-bridge.ts';
import type { ShortageConfidence, ShortageDomain, ShortageForecast } from '../shortage-types.ts';
import { getCalibrationStore, recordPrediction, _resetCalibrationForTests } from '../../intelligence/forecast-calibration-adapter.ts';

beforeEach(() => { mem.clear(); _resetCalibrationForTests(); });

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 18, 0, 0, 0); // UTC midnight — aligned to the daily bucket boundary

function forecast(over: Partial<ShortageForecast> = {}): ShortageForecast {
  return {
    commodity: 'wheat',
    domain: 'food' as ShortageDomain,
    region: 'global',
    horizonDays: 60,
    riskScore: 70,
    confidence: 'high' as ShortageConfidence,
    drivers: [],
    confirmingIndicators: [],
    invalidatingIndicators: [],
    dataGaps: [],
    lastUpdated: new Date(NOW).toISOString(),
    ...over,
  };
}

// ── Probability derivation ────────────────────────────────────────────────

test('probability equals raw riskScore/100 at high confidence', () => {
  assert.equal(shortagePredictionProbability({ riskScore: 70, confidence: 'high' }), 0.7);
  assert.equal(shortagePredictionProbability({ riskScore: 30, confidence: 'high' }), 0.3);
});

test('low confidence shrinks probability toward the 0.5 prior', () => {
  // 0.5 + (0.70 - 0.5) * 0.55 = 0.61
  assert.equal(shortagePredictionProbability({ riskScore: 70, confidence: 'low' }), 0.61);
  // symmetric below 0.5: 0.5 + (0.20 - 0.5) * 0.55 = 0.335
  assert.equal(shortagePredictionProbability({ riskScore: 20, confidence: 'low' }), 0.335);
});

test('medium confidence shrinks less than low', () => {
  const low = shortagePredictionProbability({ riskScore: 90, confidence: 'low' });
  const med = shortagePredictionProbability({ riskScore: 90, confidence: 'medium' });
  const high = shortagePredictionProbability({ riskScore: 90, confidence: 'high' });
  assert.ok(low < med && med < high, `${low} < ${med} < ${high}`);
  assert.equal(high, 0.9);
});

test('probability is clamped into [0,1] for out-of-range riskScore', () => {
  assert.equal(shortagePredictionProbability({ riskScore: 250, confidence: 'high' }), 1);
  assert.equal(shortagePredictionProbability({ riskScore: -40, confidence: 'high' }), 0);
});

test('CONFIDENCE_WEIGHT is monotonic low < medium < high == 1', () => {
  assert.ok(CONFIDENCE_WEIGHT.low < CONFIDENCE_WEIGHT.medium);
  assert.ok(CONFIDENCE_WEIGHT.medium < CONFIDENCE_WEIGHT.high);
  assert.equal(CONFIDENCE_WEIGHT.high, 1);
});

// ── Domain mapping ────────────────────────────────────────────────────────

test('domain mapping: food/fertilizer/water → macro, energy → markets', () => {
  assert.equal(domainForShortage('food'), 'macro');
  assert.equal(domainForShortage('fertilizer'), 'macro');
  assert.equal(domainForShortage('water'), 'macro');
  assert.equal(domainForShortage('energy'), 'markets');
});

// ── Id + claim + source ───────────────────────────────────────────────────

test('prediction id is stable within a daily window and normalizes case/space', () => {
  const a = shortagePredictionId({ commodity: 'Natural Gas', region: 'EU' }, NOW);
  const b = shortagePredictionId({ commodity: 'natural gas', region: 'eu' }, NOW + DAY_MS - 1);
  assert.equal(a, b);
  assert.match(a, /^shortage:natural-gas:eu:\d+$/);
});

test('different day bucket produces a different id', () => {
  const a = shortagePredictionId({ commodity: 'wheat', region: 'global' }, NOW);
  const b = shortagePredictionId({ commodity: 'wheat', region: 'global' }, NOW + DAY_MS);
  assert.notEqual(a, b);
});

test('key prefix is the id minus the bucket and is a prefix of the id', () => {
  const prefix = shortageKeyPrefix('wheat', 'global');
  assert.equal(prefix, 'shortage:wheat:global:');
  assert.ok(shortagePredictionId({ commodity: 'wheat', region: 'global' }, NOW).startsWith(prefix));
});

test('claim references commodity, region, horizon, and elevated threshold', () => {
  const claim = shortagePredictionClaim({ commodity: 'diesel', region: 'US Gulf', horizonDays: 30 });
  assert.match(claim, /diesel/);
  assert.match(claim, /US Gulf/);
  assert.match(claim, /30d/);
  assert.match(claim, new RegExp(`>${SHORTAGE_ELEVATED_THRESHOLD}`));
});

test('sourceId is per-commodity and normalized', () => {
  assert.equal(sourceIdForShortage('Jet Fuel'), 'shortage:jet-fuel');
});

// ── toPredictionRecord (pure core) ────────────────────────────────────────

test('toPredictionRecord builds a well-formed pending record', () => {
  const rec = toPredictionRecord(forecast({ commodity: 'corn', domain: 'food', horizonDays: 90 }), NOW);
  assert.equal(rec.status, 'pending');
  assert.equal(rec.domain, 'macro');
  assert.equal(rec.sourceId, 'shortage:corn');
  assert.equal(rec.predictedAt, NOW);
  assert.equal(rec.resolveBy, NOW + 90 * DAY_MS);
  assert.equal(rec.algorithmVersion, '1.0.0');
  assert.equal(rec.targetKey, 'shortage:corn:global');
  assert.equal(rec.probability, 0.7);
});

// ── recordShortagePredictions (store) ─────────────────────────────────────

test('records one pending prediction per forecast', () => {
  recordShortagePredictions([forecast({ commodity: 'wheat' }), forecast({ commodity: 'corn' })], NOW);
  assert.equal(getCalibrationStore().all().length, 2);
});

test('idempotent within the same daily window', () => {
  recordShortagePredictions([forecast()], NOW);
  recordShortagePredictions([forecast()], NOW + DAY_MS - 1); // same bucket
  assert.equal(getCalibrationStore().all().length, 1);
});

test('a new day logs a fresh prediction', () => {
  recordShortagePredictions([forecast()], NOW);
  recordShortagePredictions([forecast()], NOW + DAY_MS); // next bucket
  assert.equal(getCalibrationStore().all().length, 2);
});

// ── Resolution ────────────────────────────────────────────────────────────

test('resolveShortagePrediction resolves the in-window pending record and returns its count', () => {
  recordShortagePredictions([forecast({ commodity: 'rice', region: 'asia' })], NOW);
  const n = resolveShortagePrediction('rice', 'asia', true, NOW + DAY_MS);
  assert.equal(n, 1);
  const rec = getCalibrationStore().all().find((r) => r.sourceId === 'shortage:rice')!;
  assert.equal(rec.status, 'resolved_true');
  assert.equal(rec.resolvedAt, NOW + DAY_MS);
});

test('resolveShortagePrediction returns 0 when nothing is pending', () => {
  assert.equal(resolveShortagePrediction('soybeans', 'brazil', true, NOW), 0);
});

test('resolveShortagePrediction grades ALL still-open in-window predictions, not just the newest', () => {
  // 60-day horizons + daily dedupe → both claims are open at NOW+2d.
  recordShortagePredictions([forecast({ commodity: 'gasoline', region: 'us', riskScore: 40 })], NOW);
  recordShortagePredictions([forecast({ commodity: 'gasoline', region: 'us', riskScore: 90 })], NOW + DAY_MS);
  const n = resolveShortagePrediction('gasoline', 'us', true, NOW + 2 * DAY_MS);
  assert.equal(n, 2);
  const recs = getCalibrationStore().all().filter((r) => r.sourceId === 'shortage:gasoline');
  assert.ok(recs.every((r) => r.status === 'resolved_true'));
});

test('an observation after the window closes does not resolve the expired claim', () => {
  recordShortagePredictions([forecast({ commodity: 'corn', region: 'us', horizonDays: 90 })], NOW);
  // 100 days later — past the 90-day resolveBy.
  const n = resolveShortagePrediction('corn', 'us', true, NOW + 100 * DAY_MS);
  assert.equal(n, 0);
  const rec = getCalibrationStore().all().find((r) => r.sourceId === 'shortage:corn')!;
  assert.equal(rec.status, 'pending');
});

test('resolveShortageFromObservation resolves true only above the threshold (strict >)', () => {
  recordShortagePredictions([forecast({ commodity: 'natgas', region: 'eu' })], NOW);
  // exactly at threshold → not elevated, no resolution.
  assert.equal(resolveShortageFromObservation({ commodity: 'natgas', region: 'eu', riskScore: SHORTAGE_ELEVATED_THRESHOLD }, NOW + DAY_MS), 0);
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'shortage:natgas')!.status, 'pending');
  // above threshold → resolves true.
  assert.equal(resolveShortageFromObservation({ commodity: 'natgas', region: 'eu', riskScore: SHORTAGE_ELEVATED_THRESHOLD + 1 }, NOW + DAY_MS), 1);
  const resolved = getCalibrationStore().all().find((r) => r.sourceId === 'shortage:natgas')!;
  assert.equal(resolved.status, 'resolved_true');
  assert.equal(resolved.resolutionProvenance?.kind, 'proxy');
  assert.equal(resolved.resolutionProvenance?.resolverId, 'shortage-observation-v1');
});

test('a subthreshold observation never resolves a claim false mid-window', () => {
  recordShortagePredictions([forecast({ commodity: 'jetfuel', region: 'global', horizonDays: 30 })], NOW);
  const n = resolveShortageFromObservation({ commodity: 'jetfuel', region: 'global', riskScore: SHORTAGE_ELEVATED_THRESHOLD - 1 }, NOW + DAY_MS);
  assert.equal(n, 0);
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'shortage:jetfuel')!.status, 'pending');
});

test('settleExpiredShortagePredictions marks overdue pending records false, leaves in-window ones alone', () => {
  recordShortagePredictions([forecast({ commodity: 'wheat', region: 'r1', horizonDays: 30 })], NOW);        // resolveBy NOW+30d
  recordShortagePredictions([forecast({ commodity: 'diesel', region: 'r2', horizonDays: 90 })], NOW);        // resolveBy NOW+90d
  const n = settleExpiredShortagePredictions(NOW + 45 * DAY_MS);
  assert.equal(n, 1);
  const settled = getCalibrationStore().all().find((r) => r.sourceId === 'shortage:wheat')!;
  assert.equal(settled.status, 'resolved_false');
  assert.equal(settled.resolutionProvenance?.kind, 'proxy');
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'shortage:diesel')!.status, 'pending');
});

test('settleExpiredShortagePredictions leaves a claim open at exactly resolveBy (boundary matches isOpenAt)', () => {
  recordShortagePredictions([forecast({ commodity: 'rice', region: 'r1', horizonDays: 30 })], NOW);
  const resolveBy = NOW + 30 * DAY_MS;
  // at exactly resolveBy: not yet settled false...
  assert.equal(settleExpiredShortagePredictions(resolveBy), 0);
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'shortage:rice')!.status, 'pending');
  // ...and an on-deadline elevated observation can still grade it true.
  assert.equal(resolveShortageFromObservation({ commodity: 'rice', region: 'r1', riskScore: 99 }, resolveBy), 1);
  assert.equal(getCalibrationStore().all().find((r) => r.sourceId === 'shortage:rice')!.status, 'resolved_true');
});

test('settleExpiredShortagePredictions is scoped to shortage-owned records', () => {
  // A non-shortage record in the same ledger must be untouched.
  recordPrediction({
    id: 'analyst:x:1', sourceId: 'analyst-loop', domain: 'other', claim: 'x',
    probability: 0.5, predictedAt: NOW, resolveBy: NOW + DAY_MS, status: 'pending',
  });
  recordShortagePredictions([forecast({ commodity: 'wheat', region: 'r1', horizonDays: 1 })], NOW);
  settleExpiredShortagePredictions(NOW + 10 * DAY_MS);
  assert.equal(getCalibrationStore().all().find((r) => r.id === 'analyst:x:1')!.status, 'pending');
});

// ── forecastsWithLiveInputs (P1 gate: first-render baseline poisoning) ─────

test('forecastsWithLiveInputs: an entirely-empty inputs map records nothing', () => {
  const entries = [
    { commodity: 'wheat', forecast: forecast({ commodity: 'wheat' }) },
    { commodity: 'corn', forecast: forecast({ commodity: 'corn' }) },
  ];
  assert.deepEqual(forecastsWithLiveInputs(entries, {}), []);
});

test('forecastsWithLiveInputs: partial inputs pass only the matching commodities', () => {
  const wheat = forecast({ commodity: 'wheat' });
  const corn = forecast({ commodity: 'corn' });
  const entries = [
    { commodity: 'wheat', forecast: wheat },
    { commodity: 'corn', forecast: corn },
  ];
  assert.deepEqual(forecastsWithLiveInputs(entries, { wheat: {} }), [wheat]);
});

test('forecastsWithLiveInputs: every commodity keyed in inputs passes through', () => {
  const wheat = forecast({ commodity: 'wheat' });
  const corn = forecast({ commodity: 'corn' });
  const entries = [
    { commodity: 'wheat', forecast: wheat },
    { commodity: 'corn', forecast: corn },
  ];
  assert.deepEqual(forecastsWithLiveInputs(entries, { wheat: {}, corn: {} }), [wheat, corn]);
});

test('resolved shortage predictions feed the store Brier score', () => {
  recordShortagePredictions([forecast({ commodity: 'wheat', region: 'r1', riskScore: 90, confidence: 'high' })], NOW);
  resolveShortagePrediction('wheat', 'r1', true, NOW + DAY_MS);
  const brier = getCalibrationStore().brier();
  assert.equal(brier.evaluated, 1);
  // p=0.9, outcome=1 → (0.9-1)^2 = 0.01
  assert.ok(Math.abs(brier.score - 0.01) < 1e-9, `brier ${brier.score}`);
});
