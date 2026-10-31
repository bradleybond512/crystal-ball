import { isDesktopRuntime, toRuntimeUrl } from '../services/runtime';
import { getPersistentCache, setPersistentCache } from '../services/persistent-cache';
import { normalizeAcquisition, type NewsAcquisition } from '../services/news-provenance';

const VITE_ENV = (import.meta as { env?: { DEV?: boolean } }).env ?? {};
const isDev = VITE_ENV.DEV === true;

const responseAcquisitions = new WeakMap<Response, NewsAcquisition>();
export function getProxyResponseAcquisition(response: Response): NewsAcquisition {
  return responseAcquisitions.get(response) ?? normalizeAcquisition(undefined);
}

const RESPONSE_CACHE_PREFIX = 'api-response:';

interface CachedResponsePayload {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  acquisition?: NewsAcquisition;
}

// In production browser deployments, routes are handled by Vercel serverless functions.
// In local dev, Vite proxy handles these routes.
// In Tauri desktop mode, route requests need an absolute remote host.
export function proxyUrl(localPath: string): string {
  if (isDesktopRuntime()) {
 return toRuntimeUrl(localPath);
  }

  if (isDev) {
 return localPath;
  }

  return localPath;
}

function shouldPersistResponse(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('/api/') || url.includes('/api/'));
}

function buildResponseCacheKey(url: string): string {
  return `${RESPONSE_CACHE_PREFIX}${url}`;
}

function toCachedPayload(url: string, response: Response, body: string): CachedResponsePayload {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
 headers[key] = value;
  });

  return {
 url,
 status: response.status,
 statusText: response.statusText,
 headers,
 body,
 acquisition: { ...getProxyResponseAcquisition(response), cacheStoredAt: Date.now() },
  };
}

function toResponse(payload: CachedResponsePayload): Response {
  const response = new Response(payload.body, {
 status: payload.status,
 statusText: payload.statusText,
 headers: payload.headers,
  });
  responseAcquisitions.set(response, { ...normalizeAcquisition(payload.acquisition), delivery: 'persistent_cache' });
  return response;
}

async function fetchAndPersist(url: string, validateBody?: (body: string) => boolean, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  const attemptedAt = Date.now();
  try {
    response = await fetch(proxyUrl(url), { signal });
  } catch (error) {
    console.warn('[proxy] fetch failed for', url, error); // eslint-disable-line no-console
    throw error;
  }
  responseAcquisitions.set(response, normalizeAcquisition({ outcome: response.ok ? 'ok' : 'unavailable', attemptedAt }));
  if (response.ok && shouldPersistResponse(url)) {
 try {
 const body = await response.clone().text();
 if (!validateBody || validateBody(body)) void setPersistentCache(buildResponseCacheKey(url), toCachedPayload(url, response, body));
 } catch (error) {
 console.warn('[proxy] Failed to persist API response cache', error); // eslint-disable-line no-console
 }
  }
  return response;
}

export async function fetchWithProxy(url: string, validateBody?: (body: string) => boolean, signal?: AbortSignal): Promise<Response> {
  if (!shouldPersistResponse(url)) {
    try {
      return await fetch(proxyUrl(url), { signal });
    } catch (error) {
      console.warn('[proxy] fetch failed for', url, error); // eslint-disable-line no-console
      throw error;
    }
  }

  const cacheKey = buildResponseCacheKey(url);
  const cached = await getPersistentCache<CachedResponsePayload>(cacheKey);

  if (cached?.data && (!validateBody || validateBody(cached.data.body))) {
 void fetchAndPersist(url, validateBody, signal).catch((error) => {
 console.warn('[proxy] Background refresh failed for cached API response', error); // eslint-disable-line no-console
 });
 return toResponse(cached.data);
  }

  return fetchAndPersist(url, validateBody, signal);
}
