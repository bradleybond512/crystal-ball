/**
 * Pure helpers used by FeedHealthPanel. Lives in its own file so tests
 * can import without dragging in `i18n` (Vite's import.meta.glob).
 */
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import type { FeedDefinition, FeedSnapshot } from '@/services/diagnostics/feed-catalog';

export interface SidecarFeedStatus {
  key?: string;
  lastSuccessAt?: number | string | null;
  lastError?: string | null;
  lastAttemptAt?: number | string | null;
}

export function collectDataFreshnessSnapshots(
  catalog: FeedDefinition[],
  source: { getAllSources: () => readonly { id: DataSourceId; lastUpdate: Date | null;
    lastError: string | null }[] } = dataFreshness,
): Record<string, FeedSnapshot> {
  const out: Record<string, FeedSnapshot> = {};
  const seen = new Map<DataSourceId, { lastUpdate: Date | null; lastError: string | null }>();
  for (const state of source.getAllSources()) {
    seen.set(state.id, { lastUpdate: state.lastUpdate, lastError: state.lastError });
  }
  for (const def of catalog) {
    if (!def.sourceId) continue;
    const state = seen.get(def.sourceId);
    if (!state) continue;
    const lastSuccessAt = state.lastUpdate?.getTime() ?? null;
    out[def.id] = {
      id: def.id,
      lastSuccessAt,
      lastError: state.lastError,
      lastAttemptAt: lastSuccessAt,
    };
  }
  return out;
}

export function mergeSidecarFeeds(
  feeds: SidecarFeedStatus[],
  catalog: FeedDefinition[],
): Record<string, FeedSnapshot> {
  const byKey = new Map<string, FeedDefinition>();
  for (const def of catalog) {
    if (def.sidecarKey) byKey.set(def.sidecarKey, def);
  }
  const out: Record<string, FeedSnapshot> = {};
  for (const feed of feeds) {
    const key = feed.key;
    if (!key) continue;
    const def = byKey.get(key);
    if (!def) continue;
    out[def.id] = {
      id: def.id,
      lastSuccessAt: toMs(feed.lastSuccessAt),
      lastError: feed.lastError ?? null,
      lastAttemptAt: toMs(feed.lastAttemptAt),
    };
  }
  return out;
}

function toMs(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shortenEndpoint(url: string): string {
  if (url.length <= 48) return url;
  try {
    const u = new URL(url);
    const path = u.pathname.length > 24 ? `${u.pathname.slice(0, 24)}…` : u.pathname;
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return `${url.slice(0, 45)}…`;
  }
}

export function groupBy<T, K>(items: T[], pick: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = pick(it);
    let bucket = out.get(k);
    if (!bucket) { bucket = []; out.set(k, bucket); }
    bucket.push(it);
  }
  return out;
}
