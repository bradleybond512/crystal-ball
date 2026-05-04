/**
 * USNI Fleet & Marine Tracker proxy. No API key needed — uses
 * the public USNI WordPress JSON feed and parses the weekly post.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

// Category 4137 is the "fleet-tracker" slug. The previous ID (27) was the
// retired "fleet-and-marine-tracker" category and now returns an empty list.
const UPSTREAM = 'https://news.usni.org/wp-json/wp/v2/posts?categories=4137&per_page=1';
const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ fleet: [], degraded: true, reason, source: 'news.usni.org', generatedAt: new Date().toISOString() });

// Length-bounded tag pattern avoids the ReDoS-flagged unbounded greedy
// `<[^>]+>`; tags above 4096 chars are not real HTML in our inputs.
const RE_HTML_TAG = /<[^>]{0,4096}>/g;

function stripHtml(html) {
  return html.replaceAll(RE_HTML_TAG, ' ').replaceAll('&nbsp;', ' ').replaceAll(/\s+/g, ' ').trim();
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (usni)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`USNI returned HTTP ${r.status}`), 200, cors);
    const posts = await r.json();
    const post = Array.isArray(posts) && posts[0] ? posts[0] : null;
    if (!post) return j(degraded('No USNI fleet post found'), 200, cors);
    const result = {
      fleet: [{
        title: post?.title?.rendered ?? '',
        link: post?.link ?? '',
        date: post?.date ?? '',
        excerpt: stripHtml(post?.excerpt?.rendered ?? '').slice(0, 500),
        content: stripHtml(post?.content?.rendered ?? '').slice(0, 4000),
      }],
      source: 'news.usni.org',
      generatedAt: new Date().toISOString(),
    };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`USNI fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
