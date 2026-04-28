/**
 * GDACS disaster feed proxy. No API key. Public RSS feed.
 * https://www.gdacs.org/xml/rss.xml
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://www.gdacs.org/xml/rss.xml';
const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ events: [], degraded: true, reason, source: 'gdacs.org', generatedAt: new Date().toISOString() });

function parseGdacsRss(xml) {
  const items = [];
  // Split on <item>...</item> blocks without using regex.exec on user input
  const itemTag = '<item';
  const closeTag = '</item>';
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf(itemTag, cursor);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    const block = xml.slice(start, end);
    const tagValue = (tag) => {
      const open = block.indexOf(`<${tag}`);
      if (open === -1) return '';
      const closeStart = block.indexOf('>', open);
      if (closeStart === -1) return '';
      const close = block.indexOf(`</${tag}>`, closeStart);
      if (close === -1) return '';
      return block.slice(closeStart + 1, close).trim()
        .replace(/^<!\[CDATA\[/, '')
        .replace(/\]\]>$/, '');
    };
    items.push({
      title: tagValue('title'),
      link: tagValue('link'),
      pubDate: tagValue('pubDate'),
      description: tagValue('description').replaceAll(/<[^>]{0,4096}>/g, ' ').slice(0, 500),
      alertLevel: tagValue('gdacs:alertlevel'),
      country: tagValue('gdacs:country'),
      severity: tagValue('gdacs:severity'),
      population: tagValue('gdacs:population'),
    });
    cursor = end + closeTag.length;
  }
  return items;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);
  try {
    const r = await fetch(UPSTREAM, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (gdacs)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return j(degraded(`GDACS returned HTTP ${r.status}`), 200, cors);
    const xml = await r.text();
    const events = parseGdacsRss(xml);
    const result = { events, count: events.length, source: 'gdacs.org', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`GDACS fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
