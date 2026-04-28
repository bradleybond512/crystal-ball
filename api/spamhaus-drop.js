/**
 * Spamhaus DROP & EDROP lists proxy. Public, key-free.
 * Returns combined IPv4 prefixes with their SBL/DROP IDs.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 60 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ entries: [], degraded: true, reason, source: 'spamhaus.org', generatedAt: new Date().toISOString() });

const FEEDS = [
  { id: 'drop', url: 'https://www.spamhaus.org/drop/drop.txt' },
  { id: 'edrop', url: 'https://www.spamhaus.org/drop/edrop.txt' },
];

function parseDrop(text, listId) {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(';'))
    .map((line) => {
      const semi = line.indexOf(';');
      const cidr = (semi === -1 ? line : line.slice(0, semi)).trim();
      const meta = (semi === -1 ? '' : line.slice(semi + 1)).trim();
      return { cidr, ref: meta, list: listId };
    })
    .filter((e) => e.cidr.includes('/'));
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const responses = await Promise.allSettled(FEEDS.map(async (feed) => {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'CrystalBall/2.10.21', Accept: 'text/plain' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return [];
      return parseDrop(await r.text(), feed.id);
    }));
    const entries = responses.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
    const result = { entries, count: entries.length, source: 'spamhaus.org', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`Spamhaus DROP fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
