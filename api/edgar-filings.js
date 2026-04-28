/**
 * SEC EDGAR recent filings proxy. Public, key-free.
 *   GET /api/edgar-filings              → atom feed of latest 8-K filings
 *   GET /api/edgar-filings?cik=…        → per-company recent submissions JSON
 *   GET /api/edgar-filings?type=10-K    → filing-type filter on the latest feed
 *
 * EDGAR mandates a real User-Agent identifying the requester; bare or
 * generic UA strings are 403'd.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ filings: [], degraded: true, reason, source: 'sec.gov', generatedAt: new Date().toISOString() });

const UA = 'CrystalBall (Bradley Bond bradley_bond@me.com)';

function pickAtomEntries(xml) {
  const out = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<entry', cursor);
    if (start === -1) break;
    const end = xml.indexOf('</entry>', start);
    if (end === -1) break;
    out.push(xml.slice(start, end + 8));
    cursor = end + 8;
  }
  return out;
}

function tagText(block, tag) {
  const open = block.indexOf(`<${tag}`);
  if (open === -1) return '';
  const gt = block.indexOf('>', open);
  if (gt === -1) return '';
  const close = block.indexOf(`</${tag}>`, gt);
  if (close === -1) return '';
  return block.slice(gt + 1, close).trim();
}

function attrValue(block, tag, attr) {
  const open = block.indexOf(`<${tag}`);
  if (open === -1) return '';
  const gt = block.indexOf('>', open);
  if (gt === -1) return '';
  const segment = block.slice(open, gt);
  const needle = `${attr}="`;
  const at = segment.indexOf(needle);
  if (at === -1) return '';
  const closeQuote = segment.indexOf('"', at + needle.length);
  return closeQuote === -1 ? '' : segment.slice(at + needle.length, closeQuote);
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(req.url);
  const cik = url.searchParams.get('cik');
  const filingType = url.searchParams.get('type') || '8-K';
  const cacheKey = cik ? `cik:${cik}` : `feed:${filingType}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    if (cik) {
      const padded = String(cik).replace(/\D/g, '').padStart(10, '0');
      const r = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return j(degraded(`EDGAR submissions returned HTTP ${r.status}`), 200, cors);
      const payload = await r.json();
      const recent = payload?.filings?.recent ?? {};
      const len = Math.min(50, Array.isArray(recent.form) ? recent.form.length : 0);
      const filings = [];
      for (let i = 0; i < len; i++) {
        filings.push({
          form: recent.form?.[i] ?? '',
          accession: recent.accessionNumber?.[i] ?? '',
          filingDate: recent.filingDate?.[i] ?? '',
          reportDate: recent.reportDate?.[i] ?? '',
          primaryDocument: recent.primaryDocument?.[i] ?? '',
          primaryDocDescription: recent.primaryDocDescription?.[i] ?? '',
        });
      }
      const result = { entity: payload?.name ?? '', cik: padded, filings, count: filings.length, source: 'sec.gov', generatedAt: new Date().toISOString() };
      cache.set(cacheKey, { at: Date.now(), payload: result });
      return j(result, 200, cors);
    }

    // Latest filings atom feed
    const params = new URLSearchParams({
      action: 'getcompany',
      type: filingType,
      owner: 'include',
      count: '40',
      output: 'atom',
    });
    const r = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?${params.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/atom+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return j(degraded(`EDGAR feed returned HTTP ${r.status}`), 200, cors);
    const xml = await r.text();
    const entries = pickAtomEntries(xml);
    const filings = entries.map((entry) => ({
      title: tagText(entry, 'title'),
      summary: tagText(entry, 'summary').replaceAll(/<[^>]{0,4096}>/g, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 400),
      updated: tagText(entry, 'updated'),
      link: attrValue(entry, 'link', 'href'),
    })).filter((f) => f.link);
    const result = { filings, type: filingType, count: filings.length, source: 'sec.gov', generatedAt: new Date().toISOString() };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`EDGAR fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
