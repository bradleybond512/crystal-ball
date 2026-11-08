// Disk is an untrusted boundary. Accept only internally consistent tracked
// NewsAPI successes; never turn legacy rows or failure records into acquisition.
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const acquisitionKeys = ['outcome', 'delivery', 'attemptedAt', 'acquiredAt', 'cacheStoredAt', 'acceptedCount'];
const deliveries = new Set(['upstream', 'server_cache', 'memory_cache', 'persistent_cache']);

export function isPersistedNewsEnvelope(value, now = Date.now()) {
  if (!record(value) || value.format !== 'tracked-v1' || !Array.isArray(value.items) || !record(value.acquisition)) return false;
  const a = value.acquisition;
  if (a.outcome !== (value.items.length ? 'ok' : 'empty') || a.acceptedCount !== value.items.length || !deliveries.has(a.delivery)) return false;
  if (![a.attemptedAt, a.acquiredAt, a.cacheStoredAt].every((time) => Number.isSafeInteger(time) && time > 0 && time <= now)) return false;
  if (a.attemptedAt > a.acquiredAt || a.acquiredAt > a.cacheStoredAt) return false;
  return value.items.every((item) => {
    if (!record(item) || !nonempty(item.id) || !nonempty(item.source) || !nonempty(item.title) || typeof item.link !== 'string') return false;
    if (typeof item.pubDate !== 'string' || typeof item.description !== 'string' || (item.imageUrl !== undefined && typeof item.imageUrl !== 'string')) return false;
    try {
      const url = new URL(item.link);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return false;
    } catch { return false; }
    const p = item.provenance;
    if (!record(p) || p.sourceId !== 'newsapi' || p.deliveryGroup !== 'newsapi' || p.observedAt !== null) return false;
    if (!acquisitionKeys.every((key) => p[key] === a[key])) return false;
    if (p.publicationState === 'known') {
      if (typeof item.pubDate !== 'string') return false;
      const parsed = Date.parse(item.pubDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
      return Number.isFinite(parsed) && p.publishedAt === parsed;
    }
    // Missing upstream timestamps may have a legacy display-date fallback.
    // That display value is not evidence of publication or observation.
    if (p.publicationState === 'invalid' && Number.isFinite(Date.parse(item.pubDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')))) return false;
    return ['missing', 'invalid'].includes(p.publicationState) && p.publishedAt === null;
  });
}
