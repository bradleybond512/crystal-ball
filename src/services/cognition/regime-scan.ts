/**
 * Regime scan — surface the previously-dark BOCPD regime detector over the
 * HUD's per-domain pressure history.
 *
 * Recovered from commit 0ced5cff (lost in a rebase) as part of the Wave 5a
 * feature-surfacing pass.
 *
 * Runs a *fresh* detector across each domain's bounded pressure series and
 * returns the most-recent regime shift per domain, but only when that shift
 * landed within the last `RECENT_TAIL` samples (so stale shifts from earlier in
 * the series don't linger on the UI). Pure: the caller supplies the history;
 * no DOM, no fetch, no module-level state.
 */

import { createRegimeDetector, type RegimeShift } from './regime-detection';
import type { ForecastDomain } from '@/services/mode-forecast';
import type { PressureSample } from '@/services/pressure-history';

const RECENT_TAIL = 5;

export function scanRegimeShifts(
  history: Partial<Record<ForecastDomain, PressureSample[]>>,
): Partial<Record<ForecastDomain, RegimeShift>> {
  const out: Partial<Record<ForecastDomain, RegimeShift>> = {};
  for (const domain of Object.keys(history) as ForecastDomain[]) {
    const series = history[domain] ?? [];
    if (series.length < 2) continue;
    const detector = createRegimeDetector();
    let latest: RegimeShift | null = null;
    for (const s of series) {
      const shift = detector.feed(domain, s.value, s.timestamp);
      if (shift) latest = shift;
    }
    if (!latest) continue;
    const tailStart = series[Math.max(0, series.length - RECENT_TAIL)]!;
    if (latest.detectedAt >= tailStart.timestamp) out[domain] = latest;
  }
  return out;
}

export type CorrelationRegime = 'calm' | 'shifted';

export interface CorrelationRegimeEvidence {
  scannedAt: number;
  completeObservedAt: number | null;
  shifts: Partial<Record<ForecastDomain, RegimeShift>>;
}

const CORRELATION_DOMAINS: readonly ForecastDomain[] = ['finance', 'security', 'disaster', 'cyber'];
const CORRELATION_WARM_SAMPLES = 10;
const CORRELATION_FRESH_MS = 4 * 60_000;
const CORRELATION_SHIFT_MAX_AGE_MS = 6 * 3_600_000;

export function scanCorrelationRegime(
  history: Partial<Record<ForecastDomain, PressureSample[]>>,
  now: number,
): CorrelationRegimeEvidence {
  const qualified: Partial<Record<ForecastDomain, PressureSample[]>> = {};
  let completeObservedAt: number | null = now;
  for (const domain of CORRELATION_DOMAINS) {
    const samples: PressureSample[] = [];
    for (const sample of history[domain] ?? []) {
      const previous = samples[samples.length - 1]?.timestamp ?? 0;
      if (sample?.observed !== true || !Number.isFinite(sample.value)
        || sample.value < 0 || sample.value > 1 || !Number.isFinite(sample.timestamp)
        || sample.timestamp <= previous || sample.timestamp > now) {
        samples.length = 0;
        continue;
      }
      samples.push(sample);
    }
    qualified[domain] = samples;
    if (samples.length < CORRELATION_WARM_SAMPLES) completeObservedAt = null;
    else if (completeObservedAt !== null) completeObservedAt = Math.min(completeObservedAt, samples[samples.length - 1]!.timestamp);
  }
  return { scannedAt: now, completeObservedAt, shifts: scanRegimeShifts(qualified) };
}

function validCorrelationShift(shift: RegimeShift, domain: ForecastDomain, scannedAt: number): boolean {
  return shift.metric === domain && Number.isFinite(shift.detectedAt)
    && shift.detectedAt > 0 && shift.detectedAt <= scannedAt
    && Number.isFinite(shift.triggerValue) && shift.triggerValue >= 0 && shift.triggerValue <= 1
    && Number.isFinite(shift.runLength) && shift.runLength >= 0
    && Number.isFinite(shift.changeProbability) && shift.changeProbability > 0 && shift.changeProbability <= 1
    && ['up', 'down', 'unclear'].includes(shift.direction);
}

export function classifyCorrelationRegime(
  evidence: CorrelationRegimeEvidence | null,
  now: number,
  enabled: boolean,
): CorrelationRegime | undefined {
  if (!enabled || !evidence || !Number.isFinite(now) || now <= 0
    || !Number.isFinite(evidence.scannedAt) || evidence.scannedAt <= 0
    || evidence.scannedAt > now || now - evidence.scannedAt > CORRELATION_FRESH_MS) return undefined;
  let invalidShift = false;
  for (const domain of CORRELATION_DOMAINS) {
    const shift = evidence.shifts[domain];
    if (!shift) continue;
    if (!validCorrelationShift(shift, domain, evidence.scannedAt)) invalidShift = true;
    else if (now - shift.detectedAt <= CORRELATION_SHIFT_MAX_AGE_MS) return 'shifted';
  }
  if (invalidShift || evidence.completeObservedAt === null || !Number.isFinite(evidence.completeObservedAt)
    || evidence.completeObservedAt <= 0 || evidence.completeObservedAt > evidence.scannedAt
    || now - evidence.completeObservedAt > CORRELATION_FRESH_MS) return undefined;
  return 'calm';
}
