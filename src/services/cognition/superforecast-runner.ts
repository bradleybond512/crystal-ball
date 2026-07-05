/**
 * Superforecast Runner — on-demand, in-memory cache around superforecast(h).
 *
 * Mirrors the hypothesis-ensemble.ts runner pattern (run → cache → notify
 * subscribers → return), but keeps the cache purely in-memory keyed by h.id.
 * There is no IndexedDB persistence: a reload recomputes on next request.
 * This is the service half of the AnalystHUD "Deep forecast" opt-in surface.
 */

import type { Hypothesis } from '@/services/analyst-loop';
import { superforecast, type SuperForecast } from './superforecast';

const cache = new Map<string, SuperForecast>();
const listeners = new Set<(sf: SuperForecast) => void>();

function notify(sf: SuperForecast): void {
  for (const cb of listeners) {
    try {
      cb(sf);
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

/** Run the superforecaster for a hypothesis, cache by h.id, and notify subscribers. */
export async function runSuperforecast(h: Hypothesis): Promise<SuperForecast> {
  const sf = await superforecast(h);
  cache.set(h.id, sf);
  notify(sf);
  return sf;
}

/** Retrieve the cached superforecast for a hypothesis, or null if none. */
export function getCachedSuperforecast(h: Hypothesis): SuperForecast | null {
  return cache.get(h.id) ?? null;
}

export function subscribeSuperforecast(cb: (sf: SuperForecast) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
