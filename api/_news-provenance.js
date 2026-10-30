// Acquisition is independent of publisher timestamps, which may be absent or invalid.
export function newsAcquisition(outcome, attemptedAt = null, acquiredAt = null, acceptedCount = 0, delivery = 'unknown', cacheStoredAt = null) {
  return { outcome, delivery, attemptedAt, acquiredAt, cacheStoredAt, acceptedCount };
}
export function newsFailure(error) {
  return error?.newsOutcome ?? (error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unavailable');
}
export function newsStatus(outcome) {
  return ({ denied: 403, rate_limited: 429, timeout: 504, malformed: 502, unavailable: 502, unconfigured: 503 })[outcome] ?? 200;
}
export function newsHttpOutcome(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'denied';
  return 'unavailable';
}
export function newsTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  return Number.isFinite(parsed) ? parsed : null;
}
export function newsHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch { return false; }
}
export function normalizeNewsRows(data, provider) {
  const rows = data?.[provider === 'newsapi' ? 'articles' : 'results'];
  if (!Array.isArray(rows)) throw Object.assign(new Error('news_malformed'), { newsOutcome: 'malformed' });
  const items = rows.flatMap((a, i) => {
    const link = provider === 'newsapi' ? a?.url : a?.link;
    if (typeof a?.title !== 'string' || !a.title.trim() || !newsHttpUrl(link)) return [];
    const rawDate = provider === 'newsapi' ? a.publishedAt : a.pubDate;
    const publishedAt = newsTimestamp(rawDate);
    const rawSource = provider === 'newsapi' ? a.source?.name : a.source_name ?? a.source_id;
    let source = provider === 'newsapi' ? 'NewsAPI' : 'NewsData';
    if (typeof rawSource === 'string' && rawSource.trim()) source = rawSource;
    let publicationState = 'known';
    if (rawDate == null || rawDate === '') publicationState = 'missing';
    else if (publishedAt === null) publicationState = 'invalid';
    return [{
      id: `${provider}-${i}`,
      source,
      title: a.title, link,
      pubDate: rawDate ?? new Date().toISOString(),
      description: a.description ?? '',
      imageUrl: (provider === 'newsapi' ? a.urlToImage : a.image_url) ?? undefined,
      provenance: { sourceId: provider, deliveryGroup: provider, publicationState, publishedAt, observedAt: null },
    }];
  });
  if (rows.length && !items.length) throw Object.assign(new Error('news_malformed'), { newsOutcome: 'malformed' });
  return items;
}
export function newsEnvelope(items, acquisition) {
  return { format: 'tracked-v1', items: items.map((item) => ({ ...item, provenance: { ...item.provenance, ...acquisition } })), acquisition };
}
export function legacyNewsItems(items) {
  return items.map((item) => {
    const legacy = { ...item };
    delete legacy.provenance;
    return legacy;
  });
}
