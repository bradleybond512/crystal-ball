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

export interface LifelineProviderHealth {
  id?: string;
  state?: string;
  acceptedRows?: number;
  droppedRows?: number;
  observedAt?: Date | number | string | null;
  retrievedAt?: Date | number | string | null;
  sourceObservedAt?: Date | number | string | null;
  reasonCode?: string;
}

const LIFELINE_FEED_IDS: Readonly<Record<string, string>> = {
  osm: 'openstreetmap-lifelines',
  'fema-open-shelters': 'fema-open-shelters',
  'fema-recovery-centers': 'fema-recovery-centers',
  'ornl-odin': 'ornl-odin',
};

export function collectDataFreshnessSnapshots(
  catalog: FeedDefinition[],
  source: { getAllSources: () => readonly { id: DataSourceId; lastUpdate: Date | null;
    lastError: string | null; lastErrorAt?: number | null }[] } = dataFreshness,
): Record<string, FeedSnapshot> {
  const out: Record<string, FeedSnapshot> = {};
  const seen = new Map<DataSourceId, { lastUpdate: Date | null; lastError: string | null;
    lastErrorAt?: number | null }>();
  for (const state of source.getAllSources()) {
    seen.set(state.id, { lastUpdate: state.lastUpdate, lastError: state.lastError, lastErrorAt: state.lastErrorAt });
  }
  const sourceBindingCounts = new Map<DataSourceId, number>();
  for (const def of catalog) {
    if (def.sourceId) sourceBindingCounts.set(def.sourceId, (sourceBindingCounts.get(def.sourceId) ?? 0) + 1);
  }
  for (const def of catalog) {
    // One aggregate freshness state cannot prove which of several upstreams
    // ran. Misconfigured shared identities therefore fail closed to `never`.
    if (!def.sourceId || sourceBindingCounts.get(def.sourceId) !== 1) continue;
    const state = seen.get(def.sourceId);
    if (!state) continue;
    const lastSuccessAt = state.lastUpdate?.getTime() ?? null;
    const lastErrorAt = Number.isFinite(state.lastErrorAt) ? state.lastErrorAt! : null;
    out[def.id] = {
      id: def.id,
      lastSuccessAt,
      lastError: state.lastError,
      lastAttemptAt: lastSuccessAt === null ? lastErrorAt
        : (lastErrorAt === null ? lastSuccessAt : Math.max(lastSuccessAt, lastErrorAt)),
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

/**
 * Convert Lifelines provider telemetry into feed-health snapshots. A provider
 * is never marked successful merely because its HTTP request returned: at
 * least one validated adapter row must reach the domain response.
 */
export function mergeLifelineProviderHealth(
  providers: LifelineProviderHealth[],
): Record<string, FeedSnapshot> {
  const out: Record<string, FeedSnapshot> = {};
  for (const provider of providers) {
    const id = provider.id ? LIFELINE_FEED_IDS[provider.id] : undefined;
    if (!id) continue;
    const at = toMs(provider.retrievedAt ?? provider.observedAt);
    const acceptedRows = typeof provider.acceptedRows === 'number'
      && Number.isSafeInteger(provider.acceptedRows) && provider.acceptedRows >= 0
      ? provider.acceptedRows : 0;
    const contributed = acceptedRows > 0
      && (provider.state === 'ok' || provider.state === 'partial');
    out[id] = {
      id,
      lastSuccessAt: contributed ? at : null,
      lastAttemptAt: at,
      lastError: contributed ? null : (provider.reasonCode || (acceptedRows === 0
        ? 'no_contributed_rows'
        : `provider_${provider.state || 'error'}`)),
    };
  }
  return out;
}

const LIFELINE_PROVIDER_STATES = new Set(['ok', 'empty', 'partial', 'stale', 'error']);
const MAX_LIFELINE_PROVIDER_ROWS = 5_000;
const MAX_LIFELINE_PROVIDERS = 8;
const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60_000;
const EARLIEST_EVENT_TIME_MS = Date.UTC(2000, 0, 1);

/** Strictly validate the shared document event before it can update provider
 * health. Invalid rows, duplicates, and future timestamps are rejected as a
 * whole event so untrusted same-document payloads cannot paint a feed green. */
export function parseLifelineProviderHealthEvent(
  detail: unknown,
  now = Date.now(),
): LifelineProviderHealth[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const value = detail as Record<string, unknown>;
  if (value.schemaVersion !== 2 || !Array.isArray(value.providers)
    || value.providers.length === 0 || value.providers.length > MAX_LIFELINE_PROVIDERS) return [];
  const eventAt = toMs(value.fetchedAt as Date | number | string | null | undefined);
  if (eventAt === null || eventAt < EARLIEST_EVENT_TIME_MS
    || eventAt > now + MAX_EVENT_FUTURE_SKEW_MS) return [];
  const providers: LifelineProviderHealth[] = [];
  const seenIds = new Set<string>();
  for (const raw of value.providers) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const provider = raw as Record<string, unknown>;
    if (typeof provider.id !== 'string'
      || !Object.prototype.hasOwnProperty.call(LIFELINE_FEED_IDS, provider.id)
      || seenIds.has(provider.id)
      || typeof provider.state !== 'string' || !LIFELINE_PROVIDER_STATES.has(provider.state)
      || !Number.isSafeInteger(provider.acceptedRows) || (provider.acceptedRows as number) < 0
      || (provider.acceptedRows as number) > MAX_LIFELINE_PROVIDER_ROWS
      || !Number.isSafeInteger(provider.droppedRows) || (provider.droppedRows as number) < 0
      || (provider.droppedRows as number) > MAX_LIFELINE_PROVIDER_ROWS) return [];
    const timestamp = provider.retrievedAt ?? provider.observedAt;
    const explicitRetrievedAt = toMs(timestamp as Date | number | string | null | undefined);
    if (timestamp !== undefined && timestamp !== null && explicitRetrievedAt === null) return [];
    if (explicitRetrievedAt === null && (provider.state === 'ok' || provider.state === 'partial')) return [];
    const retrievedAt = explicitRetrievedAt ?? eventAt;
    if (retrievedAt < EARLIEST_EVENT_TIME_MS || retrievedAt > now + MAX_EVENT_FUTURE_SKEW_MS) return [];
    if (provider.reasonCode !== undefined
      && (typeof provider.reasonCode !== 'string' || provider.reasonCode.length > 160)) return [];
    seenIds.add(provider.id);
    providers.push({
      id: provider.id,
      state: provider.state,
      acceptedRows: provider.acceptedRows as number,
      droppedRows: provider.droppedRows as number,
      retrievedAt,
      observedAt: retrievedAt,
      ...(typeof provider.reasonCode === 'string' ? { reasonCode: provider.reasonCode } : {}),
    });
  }
  return providers;
}

/**
 * Merge telemetry without letting an older poll overwrite a newer direct
 * provider result. Equal timestamps prefer `incoming`, allowing a direct
 * lifeline event to win when callers apply it last.
 */
export function mergeFeedSnapshotsByAttempt(
  current: Record<string, FeedSnapshot>,
  incoming: Record<string, FeedSnapshot>,
): Record<string, FeedSnapshot> {
  const out = { ...current };
  for (const [id, candidate] of Object.entries(incoming)) {
    const existing = out[id];
    const existingAttempt = existing?.lastAttemptAt ?? Number.NEGATIVE_INFINITY;
    const candidateAttempt = candidate.lastAttemptAt ?? Number.NEGATIVE_INFINITY;
    if (!existing || candidateAttempt >= existingAttempt) out[id] = candidate;
  }
  return out;
}

function toMs(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
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
