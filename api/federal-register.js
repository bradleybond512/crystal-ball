/**
 * Federal Register documents proxy. Public, key-free.
 *   GET /api/federal-register?type=presidential_document&days=7
 *   GET /api/federal-register?term=executive%20order&per_page=20
 *
 * Defaults to the last 7 days of presidential documents (executive orders,
 * proclamations, memoranda) — the most operationally relevant slice.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ documents: [], degraded: true, reason, source: 'federalregister.gov', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'presidential_document';
  const term = url.searchParams.get('term') || '';
  const perPage = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('per_page') || '40', 10) || 40));
  const days = Math.min(60, Math.max(1, Number.parseInt(url.searchParams.get('days') || '14', 10) || 14));

  const cacheKey = `${type}|${term}|${perPage}|${days}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    'per_page': String(perPage),
    'order': 'newest',
    'fields[]': 'title',
    'conditions[publication_date][gte]': since,
  });
  // Multi-value fields[] additions:
  params.append('fields[]', 'document_number');
  params.append('fields[]', 'publication_date');
  params.append('fields[]', 'type');
  params.append('fields[]', 'abstract');
  params.append('fields[]', 'html_url');
  params.append('fields[]', 'agency_names');
  params.append('fields[]', 'president');
  if (type) params.set('conditions[type]', type);
  if (term) params.set('conditions[term]', term);

  try {
    const r = await fetch(`https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CrystalBall/2.10.21' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`Federal Register returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const documents = results.map((d) => ({
      id: d?.document_number ?? '',
      title: d?.title ?? '',
      type: d?.type ?? '',
      abstract: (d?.abstract ?? '').slice(0, 600),
      publicationDate: d?.publication_date ?? '',
      agencies: d?.agency_names ?? [],
      president: d?.president?.name ?? null,
      link: d?.html_url ?? '',
    }));
    const result = {
      documents,
      count: documents.length,
      filter: { type, term, days, since },
      source: 'federalregister.gov',
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`Federal Register fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
