import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';
import { isFeatureAvailable, isFeatureEnabled } from '@/services/runtime-config';
import type { NewsItem } from '@/types';
import { normalizeAcquisition, normalizeNewsProvenance, publicationMetadata, type NewsFetchResult } from './news-provenance';

export interface NewsApiArticle {
  id: string;
  source: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  imageUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function supplementalResult(outcome: string, attemptedAt: number | null = null): NewsFetchResult<NewsItem> {
  return { items: [], acquisition: normalizeAcquisition({ outcome, attemptedAt }) };
}

function supplementalHttpOutcome(status: number): 'denied' | 'rate_limited' | 'unavailable' {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'denied';
  return 'unavailable';
}

function supplementalItem(row: unknown, provider: 'newsapi' | 'newsdata', tracked: boolean): NewsItem | null {
  if (!isRecord(row) || typeof row.title !== 'string' || !row.title.trim()
    || typeof row.link !== 'string' || typeof row.source !== 'string') return null;
  try {
    const url = new URL(row.link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch { return null; }
  const provenance = normalizeNewsProvenance(tracked ? row.provenance : undefined);
  return {
    source: row.source, title: row.title, link: row.link,
    pubDate: new Date(typeof row.pubDate === 'string' ? row.pubDate : ''), isAlert: false,
    threat: { level: 'info', category: 'general', source: 'keyword', confidence: 0 },
    provenance: { ...provenance, sourceId: provenance.sourceId || row.source, deliveryGroup: provider,
      ...(!tracked && publicationMetadata(row.pubDate)) },
  };
}

/** Legacy arrays carry no acquisition proof, even when delivered over HTTP 200. */
export function normalizeSupplementalNews(body: unknown, provider: 'newsapi' | 'newsdata'): NewsFetchResult<NewsItem> {
  const envelope = isRecord(body) ? body : null;
  const tracked = envelope?.format === 'tracked-v1';
  let rows: unknown = body;
  if (tracked) rows = envelope?.items;
  if (!Array.isArray(rows) || (tracked && !isRecord(envelope?.acquisition))) return supplementalResult('malformed');
  const acquisition = normalizeAcquisition(tracked ? envelope?.acquisition : undefined);
  const items: NewsItem[] = [];
  for (const row of rows as unknown[]) {
    const item = supplementalItem(row, provider, tracked);
    if (!item) return supplementalResult('malformed');
    items.push(item);
  }
  if (tracked && ((acquisition.outcome === 'ok' && items.length === 0)
    || (acquisition.outcome === 'empty' && items.length > 0)
    || acquisition.acceptedCount !== items.length)) return supplementalResult('malformed');
  return { items, acquisition: { ...acquisition, acceptedCount: items.length } };
}

async function supplementalResponse(response: Response, provider: 'newsapi' | 'newsdata', attemptedAt: number): Promise<NewsFetchResult<NewsItem>> {
  let body: unknown;
  try { body = await response.json(); }
  catch { return supplementalResult(response.ok ? 'malformed' : supplementalHttpOutcome(response.status), attemptedAt); }
  const normalized = normalizeSupplementalNews(body, provider);
  if (response.ok) return normalized;
  if (isRecord(body) && body.format === 'tracked-v1'
    && ['disabled', 'unconfigured', 'denied', 'rate_limited', 'timeout', 'malformed', 'unavailable'].includes(normalized.acquisition.outcome)) return normalized;
  return supplementalResult(supplementalHttpOutcome(response.status), attemptedAt);
}

export async function fetchSupplementalNews(provider: 'newsapi' | 'newsdata', params: URLSearchParams): Promise<NewsFetchResult<NewsItem>> {
  const feature = provider === 'newsapi' ? 'newsApiHeadlines' : 'newsDataFeed';
  if (!isFeatureEnabled(feature)) return supplementalResult('disabled');
  if (isDesktopRuntime() && !isFeatureAvailable(feature)) return supplementalResult('unconfigured');
  params.set('responseMode', 'tracked-v1');
  const attemptedAt = Date.now();
  try {
    const endpoint = provider === 'newsapi' ? 'newsapi-headlines' : 'newsdata-feed';
    const response = await fetch(`${getApiBaseUrl()}/api/${endpoint}?${params}`, { signal: AbortSignal.timeout(10_000) });
    return await supplementalResponse(response, provider, attemptedAt);
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return supplementalResult(timeout ? 'timeout' : 'unavailable', attemptedAt);
  }
}

export async function fetchNewsApiHeadlinesTracked(query = 'geopolitics world news', pageSize = 10): Promise<NewsFetchResult<NewsItem>> {
  return fetchSupplementalNews('newsapi', new URLSearchParams({ q: query, pageSize: String(pageSize) }));
}

export async function fetchNewsApiHeadlines(query = 'geopolitics world news', pageSize = 10): Promise<NewsItem[]> {
  const result = await fetchNewsApiHeadlinesTracked(query, pageSize);
  return result.items;
}
