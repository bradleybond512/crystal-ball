/** Truthful acquisition metadata. Legacy article Dates remain separate. */
export type NewsOutcome = 'unknown' | 'disabled' | 'unconfigured' | 'ok' | 'empty'
  | 'denied' | 'rate_limited' | 'timeout' | 'malformed' | 'unavailable';
export type NewsDelivery = 'unknown' | 'upstream' | 'server_cache' | 'memory_cache' | 'persistent_cache';
export type NewsPublicationState = 'known' | 'missing' | 'invalid' | 'unknown';
export type NewsDeliveryGroup = 'google-rss' | `rss-direct:${string}` | 'gdelt' | 'newsapi' | 'newsdata' | 'unknown';

export interface NewsAcquisition {
  outcome: NewsOutcome;
  delivery: NewsDelivery;
  attemptedAt: number | null;
  acquiredAt: number | null;
  cacheStoredAt: number | null;
  acceptedCount: number;
}

export interface NewsProvenance extends NewsAcquisition {
  sourceId: string;
  deliveryGroup: NewsDeliveryGroup;
  publicationState: NewsPublicationState;
  publishedAt: number | null;
  observedAt: number | null;
}

export interface NewsFetchResult<T> {
  items: T[];
  acquisition: NewsAcquisition;
}

export interface TrackedNewsEnvelope<T> extends NewsFetchResult<T> {
  format: 'tracked-v1';
}

const OUTCOMES: readonly NewsOutcome[] = ['unknown', 'disabled', 'unconfigured', 'ok', 'empty', 'denied', 'rate_limited', 'timeout', 'malformed', 'unavailable'];
const DELIVERIES: readonly NewsDelivery[] = ['unknown', 'upstream', 'server_cache', 'memory_cache', 'persistent_cache'];
const PUBLICATION_STATES: readonly NewsPublicationState[] = ['known', 'missing', 'invalid', 'unknown'];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function enumValue<T extends string>(value: unknown, prefix: string, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const candidate = value.startsWith(prefix) ? value.slice(prefix.length).toLowerCase() : value;
  return allowed.find(entry => entry === candidate) ?? fallback;
}

/** Receipt, generation, and cache timestamps never imply acquisition. */
export function normalizeNewsTimestamp(value: unknown, now = Date.now()): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now ? value : null;
}

export function normalizeAcquisition(value: unknown, now = Date.now()): NewsAcquisition {
  const input = record(value);
  return {
    outcome: enumValue(input.outcome, 'NEWS_OUTCOME_', OUTCOMES, 'unknown'),
    delivery: enumValue(input.delivery, 'NEWS_DELIVERY_', DELIVERIES, 'unknown'),
    attemptedAt: normalizeNewsTimestamp(input.attemptedAt, now),
    acquiredAt: normalizeNewsTimestamp(input.acquiredAt, now),
    cacheStoredAt: normalizeNewsTimestamp(input.cacheStoredAt, now),
    acceptedCount: typeof input.acceptedCount === 'number' && Number.isSafeInteger(input.acceptedCount) && input.acceptedCount >= 0
      ? input.acceptedCount : 0,
  };
}

/** Call at a provider boundary using its raw publication field, before legacy fallbacks. */
export function publicationMetadata(value: unknown, now = Date.now()): Pick<NewsProvenance, 'publicationState' | 'publishedAt'> {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return { publicationState: 'missing', publishedAt: null };
  }
  let epoch = Number.NaN;
  if (typeof value === 'number') epoch = value;
  else if (value instanceof Date) epoch = value.getTime();
  else if (typeof value === 'string') epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch <= 0) return { publicationState: 'invalid', publishedAt: null };
  if (epoch > now) return { publicationState: 'unknown', publishedAt: null };
  return { publicationState: 'known', publishedAt: epoch };
}

/** Derive from configuration, never article links or publisher names. */
export function newsDeliveryGroup(configuredUrlOrProvider: string): NewsDeliveryGroup {
  if (configuredUrlOrProvider === 'gdelt' || configuredUrlOrProvider === 'newsapi' || configuredUrlOrProvider === 'newsdata') {
    return configuredUrlOrProvider;
  }
  try {
    // Feed configuration uses this existing wrapper in both web and desktop builds.
    const wrapper = new URL(configuredUrlOrProvider, 'https://configured.invalid');
    const target = wrapper.pathname === '/api/rss-proxy' ? wrapper.searchParams.get('url') : null;
    const url = target ? new URL(target) : new URL(configuredUrlOrProvider);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'unknown';
    if (url.hostname === 'news.google.com') return 'google-rss';
    return url.hostname ? `rss-direct:${url.hostname}` : 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeDeliveryGroup(value: unknown): NewsDeliveryGroup {
  if (value === 'google-rss' || value === 'gdelt' || value === 'newsapi' || value === 'newsdata') return value;
  if (typeof value === 'string' && value.startsWith('rss-direct:')) {
    const host = value.slice('rss-direct:'.length);
    const group = newsDeliveryGroup(`https://${host}`);
    if (group === value) return group;
  }
  return 'unknown';
}

export function normalizeNewsProvenance(value: unknown, now = Date.now()): NewsProvenance {
  const input = record(value);
  let publicationState = enumValue(input.publicationState, 'NEWS_PUBLICATION_STATE_', PUBLICATION_STATES, 'unknown');
  const publishedAt = publicationState === 'known' ? normalizeNewsTimestamp(input.publishedAt, now) : null;
  if (publicationState === 'known' && publishedAt === null) publicationState = 'unknown';
  return {
    ...normalizeAcquisition(input, now),
    sourceId: typeof input.sourceId === 'string' ? input.sourceId : '',
    deliveryGroup: normalizeDeliveryGroup(input.deliveryGroup),
    publicationState,
    publishedAt,
    observedAt: normalizeNewsTimestamp(input.observedAt, now),
  };
}

/** A null age cannot authorize a freshness-limited fallback. */
export function acquisitionAge(acquisition: Pick<NewsAcquisition, 'acquiredAt'>, now = Date.now()): number | null {
  const acquiredAt = normalizeNewsTimestamp(acquisition.acquiredAt, now);
  return acquiredAt === null ? null : now - acquiredAt;
}

const PROTO_OUTCOMES = {
  unknown: 'NEWS_OUTCOME_UNSPECIFIED', disabled: 'NEWS_OUTCOME_DISABLED',
  unconfigured: 'NEWS_OUTCOME_UNCONFIGURED', ok: 'NEWS_OUTCOME_OK', empty: 'NEWS_OUTCOME_EMPTY',
  denied: 'NEWS_OUTCOME_DENIED', rate_limited: 'NEWS_OUTCOME_RATE_LIMITED', timeout: 'NEWS_OUTCOME_TIMEOUT',
  malformed: 'NEWS_OUTCOME_MALFORMED', unavailable: 'NEWS_OUTCOME_UNAVAILABLE',
} as const;
const PROTO_DELIVERIES = {
  unknown: 'NEWS_DELIVERY_UNSPECIFIED', upstream: 'NEWS_DELIVERY_UPSTREAM',
  server_cache: 'NEWS_DELIVERY_SERVER_CACHE', memory_cache: 'NEWS_DELIVERY_MEMORY_CACHE',
  persistent_cache: 'NEWS_DELIVERY_PERSISTENT_CACHE',
} as const;
const PROTO_PUBLICATION_STATES = {
  unknown: 'NEWS_PUBLICATION_STATE_UNSPECIFIED', known: 'NEWS_PUBLICATION_STATE_KNOWN',
  missing: 'NEWS_PUBLICATION_STATE_MISSING', invalid: 'NEWS_PUBLICATION_STATE_INVALID',
} as const;

/** Serialize absent times as absent protobuf fields, without changing their meaning. */
export function newsAcquisitionToProto(value: NewsAcquisition, now = Date.now()) {
  const acquisition = normalizeAcquisition(value, now);
  return {
    outcome: PROTO_OUTCOMES[acquisition.outcome],
    delivery: PROTO_DELIVERIES[acquisition.delivery],
    ...(acquisition.attemptedAt !== null && { attemptedAt: acquisition.attemptedAt }),
    ...(acquisition.acquiredAt !== null && { acquiredAt: acquisition.acquiredAt }),
    ...(acquisition.cacheStoredAt !== null && { cacheStoredAt: acquisition.cacheStoredAt }),
    acceptedCount: acquisition.acceptedCount,
  };
}

export function newsProvenanceToProto(value: NewsProvenance, now = Date.now()) {
  const provenance = normalizeNewsProvenance(value, now);
  return {
    ...newsAcquisitionToProto(provenance, now),
    sourceId: provenance.sourceId,
    deliveryGroup: provenance.deliveryGroup,
    publicationState: PROTO_PUBLICATION_STATES[provenance.publicationState],
    ...(provenance.publishedAt !== null && { publishedAt: provenance.publishedAt }),
    ...(provenance.observedAt !== null && { observedAt: provenance.observedAt }),
  };
}
