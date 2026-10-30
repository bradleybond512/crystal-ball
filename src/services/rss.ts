import type { Feed, NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';
import { classifyByKeyword, classifyWithAI } from './threat-classifier';
import { inferGeoHubsFromTitle } from './geo-hub-index';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { ingestHeadlines } from './trending-keywords';
import { getCurrentLanguage } from './i18n';
import { canQueueAiClassification, AI_CLASSIFY_MAX_PER_FEED } from './ai-classify-queue';
import { summarizeAdapterDataStates } from './adapter-provenance';
import { getProxyResponseAcquisition } from '@/utils/proxy';
import { normalizeAcquisition, normalizeNewsProvenance, newsDeliveryGroup, publicationMetadata, type NewsAcquisition, type NewsOutcome } from './news-provenance';
import type { BreakerDataState } from '@/utils/circuit-breaker';

const FEED_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FAILURES = 2;
const MAX_CACHE_ENTRIES = 100;
const FEED_SCOPE_SEPARATOR = '::';
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const feedCache = new Map<string, CachedFeedItems>();
const feedAttempts = new Map<string, Pick<NewsAcquisition, 'outcome' | 'attemptedAt'>>();
const CACHE_TTL = 20 * 60 * 1000;

function toSerializable(items: NewsItem[]): (Omit<NewsItem, 'pubDate'> & { pubDate: string })[] {
  return items.map(item => ({ ...item, pubDate: item.pubDate.toISOString() }));
}

function fromSerializable(items: (Omit<NewsItem, 'pubDate'> & { pubDate: string })[]): NewsItem[] {
  return items.map(item => ({ ...item, pubDate: new Date(item.pubDate) }));
}

function getFeedScope(feedName: string, lang: string): string {
  return `${feedName}${FEED_SCOPE_SEPARATOR}${lang}`;
}

function parseFeedScope(feedScope: string): { feedName: string; lang: string } {
  const splitIndex = feedScope.lastIndexOf(FEED_SCOPE_SEPARATOR);
  if (splitIndex === -1) return { feedName: feedScope, lang: 'en' };
  return {
 feedName: feedScope.slice(0, splitIndex),
 lang: feedScope.slice(splitIndex + FEED_SCOPE_SEPARATOR.length),
  };
}

function getPersistentFeedKey(feedScope: string): string {
  return `feed:${feedScope}`;
}

interface CachedFeedItems {
  items: NewsItem[];
  timestamp: number;
  acquisition: NewsAcquisition;
}

async function readPersistentFeed(key: string): Promise<CachedFeedItems | null> {
  type Serialized = (Omit<NewsItem, 'pubDate'> & { pubDate: string })[];
  const entry = await getPersistentCache<Serialized | { format: 'tracked-v1'; items: Serialized; acquisition: NewsAcquisition }>(key);
  if (!entry?.data) return null;
  if (!Array.isArray(entry.data) && entry.data.format !== 'tracked-v1') return null;
  const rows = Array.isArray(entry.data) ? entry.data : entry.data.items;
  if (!Array.isArray(rows) || !rows.every(item => item && typeof item.title === 'string' && Boolean(item.title.trim())
    && typeof item.source === 'string' && typeof item.link === 'string' && validRssLink(item.link) && Number.isFinite(Date.parse(item.pubDate)))) return null;
  const acquisition = normalizeAcquisition(Array.isArray(entry.data) ? undefined : entry.data.acquisition);
  const items = fromSerializable(rows).map(item => ({ ...item, provenance: {
    ...normalizeNewsProvenance(item.provenance), delivery: 'persistent_cache' as const,
  } }));
  return { items, timestamp: entry.updatedAt, acquisition: { ...acquisition, delivery: 'persistent_cache', acceptedCount: items.length } };
}

async function loadPersistentFeed(feedScope: string): Promise<CachedFeedItems | null> {
  const scopedKey = getPersistentFeedKey(feedScope);
  const scoped = await readPersistentFeed(scopedKey);
  if (scoped) return scoped;

  // Migration fallback: older builds stored feeds as `feed:<feedName>` without language scope.
  // Only use this for English to avoid mixing cached content across locales.
  const { feedName, lang } = parseFeedScope(feedScope);
  if (lang !== 'en') return null;
  return readPersistentFeed(`feed:${feedName}`);
}

// Clean up stale entries to prevent unbounded growth
function cleanupCaches(): void {
  const now = Date.now();

  for (const [key, value] of feedCache) {
 if (now - value.timestamp > CACHE_TTL * 2) {
 feedCache.delete(key);
 }
  }

  for (const [key, state] of feedFailures) {
 if (state.cooldownUntil > 0 && now > state.cooldownUntil) {
 feedFailures.delete(key);
 feedAttempts.delete(key);
 }
  }

  if (feedCache.size > MAX_CACHE_ENTRIES) {
 const entries = [...feedCache.entries()]
 .sort((a, b) => a[1].timestamp - b[1].timestamp);
 const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
 for (const [key] of toRemove) {
 feedCache.delete(key);
 }
  }
}

function isFeedOnCooldown(feedScope: string): boolean {
  const state = feedFailures.get(feedScope);
  if (!state) return false;
  if (Date.now() < state.cooldownUntil) return true;
  if (state.cooldownUntil > 0) feedFailures.delete(feedScope);
  return false;
}

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing, no-console, sonarjs/cognitive-complexity, sonarjs/no-clear-text-protocols, @typescript-eslint/no-empty-function */
function recordFeedFailure(feedScope: string): void {
  const state = feedFailures.get(feedScope) || { count: 0, cooldownUntil: 0 };
  state.count++;
  if (state.count >= MAX_FAILURES) {
 state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
 const { feedName, lang } = parseFeedScope(feedScope);
 console.warn(`[RSS] ${feedName} (${lang}) on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedScope, state);
}

function recordFeedSuccess(feedScope: string): void {
  feedFailures.delete(feedScope);
}

export function getFeedFailures(): Map<string, { count: number; cooldownUntil: number }> {
  const currentLang = getCurrentLanguage();
  const currentLangFailures = new Map<string, { count: number; cooldownUntil: number }>();

  for (const [feedScope, state] of feedFailures) {
 const { feedName, lang } = parseFeedScope(feedScope);
 if (lang === currentLang) {
 currentLangFailures.set(feedName, state);
 }
  }

  return currentLangFailures;
}


/**
 * Extract the best image URL from an RSS item element.
 * Tries multiple RSS image sources in priority order:
 * 1. media:content (Yahoo MRSS namespace)
 * 2. media:thumbnail (Yahoo MRSS namespace)
 * 3. <enclosure> with image type
 * 4. First <img> in description/content:encoded
 * Returns undefined if no image found. Never throws.
 */
function extractImageUrl(item: Element): string | undefined {
  const MRSS_NS = 'http://search.yahoo.com/mrss/';
  const IMG_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i;

  try {
 // 1. media:content with MRSS namespace
 const mediaContents = item.getElementsByTagNameNS(MRSS_NS, 'content');
 for (const mediaContent of mediaContents) {
 const el = mediaContent!;
 const url = el.getAttribute('url');
 if (!url) continue;
 const medium = el.getAttribute('medium');
 const type = el.getAttribute('type');
 // Accept if medium is image, type contains image, URL looks like image, or no type specified
 if (medium === 'image' || type?.startsWith('image/') || IMG_EXTENSIONS.test(url) || (!type && !medium)) {
 return url;
 }
 }
  } catch {
 // Namespace not supported or other XML issue, fall through
  }

  try {
 // 2. media:thumbnail with MRSS namespace
 const thumbnails = item.getElementsByTagNameNS(MRSS_NS, 'thumbnail');
 for (const thumbnail of thumbnails) {
 const url = thumbnail!.getAttribute('url');
 if (url) return url;
 }
  } catch {
 // Fall through
  }

  try {
 // 3. <enclosure> with image type
 const enclosures = item.getElementsByTagName('enclosure');
 for (const enclosure of enclosures) {
 const el = enclosure!;
 const type = el.getAttribute('type');
 const url = el.getAttribute('url');
 if (url && type?.startsWith('image/')) return url;
 }
  } catch {
 // Fall through
  }

  try {
 // 4. Fallback: parse first <img src="..."> from description or content:encoded
 const description = item.querySelector('description')?.textContent || '';
 const contentEncoded = item.getElementsByTagNameNS('http://purl.org/rss/1.0/modules/content/', 'encoded');
 const contentText = contentEncoded.length > 0 ? (contentEncoded[0]!.textContent || '') : '';
 const htmlContent = contentText || description;
 const imgMatch = /<img[^>]+src=["']([^"']+)["']/.exec(htmlContent);
 if (imgMatch?.[1]) return imgMatch[1];
  } catch {
 // Fall through
  }

  return undefined;
}

function validRssLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch { return false; }
}

function rssItemLink(item: Element, isAtom: boolean): string {
  if (isAtom) return item.querySelector('link[href]')?.getAttribute('href') ?? '';
  return item.querySelector('link')?.textContent ?? '';
}

function acceptedRssItem(item: Element, isAtom: boolean): boolean {
  return Boolean(item.querySelector('title')?.textContent?.trim()) && validRssLink(rssItemLink(item, isAtom));
}

export interface RssFeedFetchResult {
  acquisition: NewsAcquisition;
  items: NewsItem[];
  dataState: BreakerDataState;
}

export async function fetchFeedTracked(feed: Feed): Promise<RssFeedFetchResult> {
  if (feedCache.size > MAX_CACHE_ENTRIES / 2) cleanupCaches();
  const currentLang = getCurrentLanguage();
  const feedScope = getFeedScope(feed.name, currentLang);
  const cached = feedCache.get(feedScope);

  const cachedResult = (entry: CachedFeedItems, delivery: 'memory_cache' | 'persistent_cache', attempt?: Pick<NewsAcquisition, 'outcome' | 'attemptedAt'>): RssFeedFetchResult => {
    const acquisition = { ...entry.acquisition, delivery, ...attempt };
    return { items: entry.items.map(item => ({ ...item, provenance: {
      ...normalizeNewsProvenance(item.provenance), ...acquisition,
    } })), acquisition, dataState: { mode: 'cached', timestamp: acquisition.acquiredAt, offline: false } };
  };
  const cachedFallback = async (outcome?: NewsOutcome): Promise<RssFeedFetchResult> => {
    const attempt = outcome ? { outcome, attemptedAt: Date.now() } : feedAttempts.get(feedScope);
    if (attempt) feedAttempts.set(feedScope, attempt);
    if (cached) {
      return cachedResult(cached, 'memory_cache', attempt);
    }
    const persistent = await loadPersistentFeed(feedScope);
    if (persistent) {
      return cachedResult(persistent, 'persistent_cache', attempt);
    }
    return { items: [], acquisition: normalizeAcquisition(attempt), dataState: { mode: 'unavailable', timestamp: null, offline: false } };
  };

  if (isFeedOnCooldown(feedScope)) {
 return cachedFallback();
  }

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
 return cachedResult(cached, 'memory_cache');
  }

  try {
 let url = typeof feed.url === 'string' ? feed.url : feed.url.en;
 if (typeof feed.url !== 'string') {
 url = feed.url[currentLang] || feed.url.en || Object.values(feed.url)[0] || '';
 }

 if (!url) throw new Error(`No URL found for feed ${feed.name}`);

 const attemptedAt = Date.now();
 const response = await fetchWithProxy(url, body => {
 const document = new DOMParser().parseFromString(body, 'text/xml');
 if (document.querySelector('parsererror') || !['rss', 'feed', 'rdf:RDF'].includes(document.documentElement?.tagName ?? '')) return false;
 const rssRows = document.querySelectorAll('item');
 const isAtom = rssRows.length === 0;
 const rows = [...(isAtom ? document.querySelectorAll('entry') : rssRows)];
 return rows.length === 0 || rows.some(row => acceptedRssItem(row, isAtom));
 }, AbortSignal.timeout(10_000));
 if (!response.ok) {
 recordFeedFailure(feedScope);
 let outcome: NewsOutcome = 'unavailable';
 if (response.status === 429) outcome = 'rate_limited';
 if (response.status === 401 || response.status === 403) outcome = 'denied';
 return cachedFallback(outcome);
 }
 const text = await response.text();
 const parser = new DOMParser();
 const doc = parser.parseFromString(text, 'text/xml');

 const parseError = doc.querySelector('parsererror');
 if (parseError || !['rss', 'feed', 'rdf:RDF'].includes(doc.documentElement?.tagName ?? '')) {
 console.warn(`Parse error for ${feed.name}`);
 recordFeedFailure(feedScope);
 return cachedFallback('malformed');
 }

 let items = doc.querySelectorAll('item');
 const isAtom = items.length === 0;
 if (isAtom) items = doc.querySelectorAll('entry');

 const responseAcquisition = getProxyResponseAcquisition(response);
 const direct = !url.includes('/api/');
 const acquisition = normalizeAcquisition({ ...responseAcquisition, outcome: 'ok',
 ...(direct && { delivery: 'upstream', attemptedAt, acquiredAt: Date.now() }),
 });
 const parsed = [...items]
 .filter(item => acceptedRssItem(item, isAtom))
 .slice(0, 5)
 .map((item) => {
 const title = item.querySelector('title')?.textContent || '';
 const link = rssItemLink(item, isAtom);

 const pubDateStr = isAtom
 ? (item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '')
 : (item.querySelector('pubDate')?.textContent || '');
 const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
 const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
 const threat = classifyByKeyword(title, SITE_VARIANT);
 const isAlert = threat.level === 'critical' || threat.level === 'high';
 const geoMatches = inferGeoHubsFromTitle(title);
 const topGeo = geoMatches[0];

 return {
 source: feed.name,
 provenance: { ...acquisition, sourceId: feed.name, deliveryGroup: newsDeliveryGroup(url), ...publicationMetadata(pubDateStr), observedAt: acquisition.acquiredAt },
 title,
 link,
 pubDate,
 isAlert,
 threat,
 ...(topGeo && { lat: topGeo.hub.lat, lon: topGeo.hub.lon, locationName: topGeo.hub.name }),
 lang: feed.lang,
 ...(SITE_VARIANT === 'happy' && { imageUrl: extractImageUrl(item) }),
 };
 });

 acquisition.acceptedCount = parsed.length;
 acquisition.outcome = parsed.length > 0 ? 'ok' : 'empty';
 if (parsed.length === 0 && items.length > 0) acquisition.outcome = 'malformed';
 if (acquisition.outcome === 'malformed') { recordFeedFailure(feedScope); return cachedFallback('malformed'); }
 const cacheStoredAt = Date.now();
 acquisition.cacheStoredAt = cacheStoredAt;
 for (const item of parsed) Object.assign(item.provenance, acquisition);
 feedCache.set(feedScope, { items: parsed, timestamp: cacheStoredAt, acquisition });
 void setPersistentCache(getPersistentFeedKey(feedScope), { format: 'tracked-v1', items: toSerializable(parsed), acquisition });
 recordFeedSuccess(feedScope);
 feedAttempts.delete(feedScope);
 ingestHeadlines(parsed.map(item => ({
 title: item.title,
 pubDate: item.pubDate,
 source: item.source,
 link: item.link,
 })));

 const aiCandidates = parsed
 .filter(item => item.threat.source === 'keyword')
 .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
 .slice(0, AI_CLASSIFY_MAX_PER_FEED);

 for (const item of aiCandidates) {
 if (!canQueueAiClassification(item.title)) continue;
 classifyWithAI(item.title, SITE_VARIANT).then((aiResult) => {
 if (aiResult && aiResult.confidence > item.threat.confidence) {
 item.threat = aiResult;
 item.isAlert = aiResult.level === 'critical' || aiResult.level === 'high';
 }
 }).catch(() => {});
 }

 let mode: BreakerDataState['mode'] = 'unavailable';
 if (acquisition.delivery === 'upstream') mode = 'live';
 if (acquisition.delivery === 'persistent_cache') mode = 'cached';
 return { items: parsed, acquisition, dataState: { mode, timestamp: acquisition.acquiredAt, offline: false } };
  } catch (error) {
 console.error(`Failed to fetch ${feed.name}:`, error);
 recordFeedFailure(feedScope);
 return cachedFallback(error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? 'timeout' : 'unavailable');
  }
}
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing, no-console, sonarjs/cognitive-complexity, sonarjs/no-clear-text-protocols, @typescript-eslint/no-empty-function */

export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  const result = await fetchFeedTracked(feed);
  return result.items;
}

export interface RssCategoryFetchResult {
  feedAcquisitions: Record<string, NewsAcquisition>;
  items: NewsItem[];
  dataState: BreakerDataState;
}

export async function fetchCategoryFeedsTracked(
  feeds: Feed[],
  options: {
 batchSize?: number;
 onBatch?: (items: NewsItem[]) => void;
  } = {}
): Promise<RssCategoryFetchResult> {
  const topLimit = 20;
  const batchSize = options.batchSize ?? 5;
  const currentLang = getCurrentLanguage();

  // Filter feeds by language:
  // 1. Feeds with no explicit 'lang' are universal (or multi-url handled inside fetchFeed)
  // 2. Feeds with explicit 'lang' must match current UI language
  const filteredFeeds = feeds.filter(feed => !feed.lang || feed.lang === currentLang);

  const batches = chunkArray(filteredFeeds, batchSize);
  const topItems: NewsItem[] = [];
  const feedStates: BreakerDataState[] = [];
  const feedAcquisitions: Record<string, NewsAcquisition> = {};

  const ensureSortedDescending = () => [...topItems].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const insertTopItem = (item: NewsItem) => {
 if (topItems.length < topLimit) {
 topItems.push(item);
 if (topItems.length === topLimit) topItems.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
 return;
 }

 const itemTime = item.pubDate.getTime();
 if (itemTime <= topItems[0]!.pubDate.getTime()) return;

 topItems[0] = item;
 for (let i = 0; i < topItems.length - 1; i += 1) {
 if (topItems[i]!.pubDate.getTime() <= topItems[i + 1]!.pubDate.getTime()) break;
 [topItems[i], topItems[i + 1]] = [topItems[i + 1]!, topItems[i]!];
 }
  };

  for (const batch of batches) {
 const results = await Promise.all(batch.map((feed) => fetchFeedTracked(feed)));
 results.forEach((result, index) => { feedAcquisitions[batch[index]!.name] = result.acquisition; });
 feedStates.push(...results.map((result) => result.dataState));
 results.flatMap((result) => result.items).forEach((item) => insertTopItem(item));
 options.onBatch?.(ensureSortedDescending());
  }

  return { items: ensureSortedDescending(), feedAcquisitions, dataState: summarizeAdapterDataStates(feedStates) };
}

export async function fetchCategoryFeeds(
  feeds: Feed[],
  options: { batchSize?: number; onBatch?: (items: NewsItem[]) => void } = {},
): Promise<NewsItem[]> {
  const result = await fetchCategoryFeedsTracked(feeds, options);
  return result.items;
}
