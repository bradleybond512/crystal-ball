/**
 * Superforecast state — on-demand runtime entry point for the superforecaster
 * pipeline (COGNITIVE_ENHANCEMENT_PLAN PR 6 slice).
 *
 * superforecast.ts deliberately has no automatic cadence ("cost control
 * first"); this module is the sanctioned on-demand call site. It:
 *
 *   1. Runs superforecast(h) with a 15-min signature-keyed cache + in-flight
 *      dedupe (imitating hypothesis-projection.ts).
 *   2. Pushes a live-vs-shadow probability pair into the shadow-rollout
 *      ledger (PR 13 activation) so `npm run cognition:shadow-report` gets
 *      real data — live = the existing forecastAll() probability, shadow =
 *      the superforecast pipeline's probability.
 *   3. Persists the shadow verdict snapshot (fire-and-forget by design).
 *
 * The live-forecast dependency is injectable so tests stay DOM-free; the
 * default resolves lazily (dynamic import) for the same reason.
 *
 * IMPORTANT: shadow pairs are pushed ONLY from requestSuperforecast(), never
 * from render paths — render fires many times per snapshot and would flood
 * the ledger.
 */

import type { Hypothesis } from '@/services/analyst-loop';
import { signatureFor } from '@/services/hypothesis-feedback';
import { superforecast, type SuperForecast } from './superforecast';
import { pushSuperforecastPair, persistVerdictSnapshot } from './shadow-rollout';

export interface SuperforecastStateDeps {
  /** Live-system probability for the same hypothesis (shadow-pair "live" leg). */
  liveForecast?: (h: Hypothesis) => Promise<number | undefined> | number | undefined;
  /** Pipeline runner (for tests). Defaults to the real superforecast(). */
  run?: (h: Hypothesis) => Promise<SuperForecast>;
  now?: () => number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  forecast: SuperForecast;
  generatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SuperForecast>>();

async function defaultLiveForecast(h: Hypothesis): Promise<number | undefined> {
  try {
    // Lazy import: keeps DOM-adjacent modules out of the node test path.
    const [{ forecastAll }, { getLatestPCI }] = await Promise.all([
      import('@/services/intelligence/hypothesis-forecast'),
      import('@/services/intelligence/predictive-crisis-index'),
    ]);
    return forecastAll([h], getLatestPCI())[0]?.probability;
  } catch {
    return undefined;
  }
}

/** Cached result for display. Null when never run or older than the TTL. */
export function getCachedSuperforecast(
  h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>,
  now: () => number = Date.now,
): SuperForecast | null {
  const entry = cache.get(signatureFor(h));
  if (!entry) return null;
  if (now() - entry.generatedAt > CACHE_TTL_MS) return null;
  return entry.forecast;
}

/**
 * Run (or reuse) the superforecast for a hypothesis. Concurrent callers for
 * the same signature share one pipeline run. Every fresh run pushes a
 * live-vs-shadow pair and persists the verdict snapshot.
 */
export function requestSuperforecast(
  h: Hypothesis,
  deps: SuperforecastStateDeps = {},
): Promise<SuperForecast> {
  const now = deps.now ?? Date.now;
  const sig = signatureFor(h);

  const cached = getCachedSuperforecast(h, now);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(sig);
  if (pending) return pending;

  const run = deps.run ?? superforecast;
  const liveForecast = deps.liveForecast ?? defaultLiveForecast;

  const promise = (async () => {
    const forecast = await run(h);
    cache.set(sig, { forecast, generatedAt: now() });

    // PR 13 activation: shadow-compare the pipeline against the live system.
    // Fire-and-forget — pair recording must never fail the caller.
    try {
      const liveP = await liveForecast(h);
      if (liveP !== undefined && Number.isFinite(liveP)) {
        pushSuperforecastPair(sig, liveP, forecast.probability);
        persistVerdictSnapshot();
      }
    } catch {
      // Shadow accounting is best-effort by design.
    }

    return forecast;
  })().finally(() => {
    inFlight.delete(sig);
  });

  inFlight.set(sig, promise);
  return promise;
}

/** Clear cache + in-flight map (for tests). */
export function _resetSuperforecastStateForTests(): void {
  cache.clear();
  inFlight.clear();
}
