/**
 * Vulners CVE search proxy. Requires VULNERS_API_KEY.
 * GET /api/vulners-search?query=…&size=20
 *   Defaults to the latest CVEs published in the last 7 days.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { requireAppAuth, clampQueryParam } from './_auth.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_QUERY_LENGTH = 1024;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ items: [], degraded: true, reason, source: 'vulners.com', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  // Key-spending oracle path. Gate before we hit the upstream.
  const denied = requireAppAuth(req, cors);
  if (denied) return denied;

  const key = process.env.VULNERS_API_KEY;
  if (!key) return j(degraded('VULNERS_API_KEY not set'), 200, cors);

  const url = new URL(req.url);
  const query = clampQueryParam(url.searchParams.get('query'), MAX_QUERY_LENGTH) || 'type:cve AND order:published';
  const sizeRaw = Number.parseInt(url.searchParams.get('size') || '25', 10);
  const size = Math.max(1, Math.min(50, Number.isFinite(sizeRaw) ? sizeRaw : 25));
  const cacheKey = `${query}|${size}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const r = await fetch('https://vulners.com/api/v3/search/lucene/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CrystalBall/2.10.21 (vulners)',
      },
      body: JSON.stringify({ query, size, apiKey: key }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`Vulners returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const docs = payload?.data?.search ?? [];
    const items = docs.map((d) => {
      const src = d?._source ?? {};
      return {
        id: src.id ?? d?._id ?? '',
        title: src.title ?? '',
        description: src.description ?? '',
        cvss: src?.cvss?.score ?? null,
        cvss3: src?.cvss3?.cvssV3?.baseScore ?? null,
        published: src.published ?? null,
        modified: src.modified ?? null,
        href: src.href ?? '',
        type: src.type ?? '',
        bulletinFamily: src.bulletinFamily ?? '',
      };
    });
    const result = {
      items,
      query,
      count: items.length,
      source: 'vulners.com',
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`Vulners fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
