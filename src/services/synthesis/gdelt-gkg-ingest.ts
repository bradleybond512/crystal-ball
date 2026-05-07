/**
 * Live GDELT 2.0 ingestion → precedent-matcher corpus.
 *
 * Pure transformer + thin fetcher. The sidecar route at `/api/gdelt/events`
 * does the heavy lifting (fetching, unzipping, CSV parsing, filtering); this
 * module just merges fresh events into the in-process corpus, deduping by id
 * and capping the rolling window so the TF-IDF rebuild stays bounded.
 *
 * The merge function is the unit-test surface — it has no I/O so fixtures
 * stay deterministic.
 */

import type { HistoricalEvent } from './precedent-matcher';

export interface GdeltEventsResponse {
  events: HistoricalEvent[];
  updatedAt: number;
  source: string;
  count: number;
  degraded?: boolean;
  reason?: string;
  slice?: string;
}

/** Default rolling-window cap. The matcher's vocabulary is rebuilt every
 *  time the corpus changes, so an unbounded corpus would make ingestion
 *  O(N) on every cycle. Cap matches roughly one month of 15-min slices
 *  at the route's MAX_EVENTS=500 with typical conflict density. */
export const DEFAULT_CORPUS_CAP = 5000;

/** Fetch the latest GDELT slice from the sidecar.
 *  `apiBaseUrl` should be the runtime API base — e.g.
 *  `http://127.0.0.1:46123` in desktop, '' in web (relative). */
export async function fetchGdeltEvents(apiBaseUrl: string): Promise<GdeltEventsResponse> {
  const url = `${apiBaseUrl}/api/gdelt/events`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(35_000),
  });
  if (!r.ok) throw new Error(`/api/gdelt/events HTTP ${r.status}`);
  const payload = (await r.json()) as GdeltEventsResponse;
  if (!Array.isArray(payload?.events)) {
    throw new TypeError('/api/gdelt/events: malformed payload (events not array)');
  }
  return payload;
}

/** Merge fresh events into an existing corpus, deduping by id (last write
 *  wins so a re-fetched slice can correct earlier rows) and capping at
 *  `cap` newest-first by date.
 *
 *  Pure: no I/O, no hidden state, deterministic for any given input pair. */
export function mergeIntoCorpus(
  existing: readonly HistoricalEvent[],
  fresh: readonly HistoricalEvent[],
  cap: number = DEFAULT_CORPUS_CAP,
): HistoricalEvent[] {
  const byId = new Map<string, HistoricalEvent>();
  for (const ev of existing) byId.set(ev.id, ev);
  for (const ev of fresh) byId.set(ev.id, ev);     // overwrite duplicates
  const merged = [...byId.values()];
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (merged.length <= cap) return merged;
  return merged.slice(0, cap);
}

/** Convenience: fetch + merge in one call. Returns the new corpus. */
export async function refreshCorpusFromGdelt(
  apiBaseUrl: string,
  existingCorpus: readonly HistoricalEvent[],
  cap: number = DEFAULT_CORPUS_CAP,
): Promise<{ corpus: HistoricalEvent[]; response: GdeltEventsResponse }> {
  const response = await fetchGdeltEvents(apiBaseUrl);
  const corpus = mergeIntoCorpus(existingCorpus, response.events, cap);
  return { corpus, response };
}
