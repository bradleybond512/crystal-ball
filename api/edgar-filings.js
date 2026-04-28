/**
 * SEC EDGAR recent filings proxy. Public, key-free.
 *   GET /api/edgar-filings              → atom feed of latest 8-K filings
 *   GET /api/edgar-filings?cik=…        → per-company recent submissions JSON
 *   GET /api/edgar-filings?type=10-K    → filing-type filter on the latest feed
 *
 * Default response is an `EdgarFiling[]` array (matching the existing
 * sidecar route + `src/services/sec-edgar.ts` which casts `await
 * res.json() as EdgarFiling[]`). The CIK lookup branch returns the same
 * shape — clients that want company metadata read it from `entity` /
 * `cik` properties on the (otherwise empty) array would need a separate
 * route, so we keep the array contract uniform.
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

// ── EdgarFiling shape (mirrors src/services/sec-edgar.ts EdgarFiling) ──
// Bounded regexes (`{0,N}` instead of unbounded `+`) avoid super-linear
// backtracking on pathological inputs.
const RE_HTML_TAG = /<[^>]{0,4096}>/g;
const RE_WHITESPACE = /\s+/g;
const RE_CIK = /\(CIK (\d{1,16})\)/;
const RE_CIK_SUFFIX = /\s{0,8}\(CIK \d{1,16}\).{0,512}$/;

function buildFilingFromAtom(entry, fallbackIndex) {
  const title = tagText(entry, 'title');
  const accession = tagText(entry, 'id').split('=').pop() || null;
  const summaryHtml = tagText(entry, 'summary');
  const summaryText = summaryHtml.replaceAll(RE_HTML_TAG, ' ').replaceAll(RE_WHITESPACE, ' ').trim();
  // Atom title format is e.g. "8-K - COMPANY NAME (CIK 0001234567) (Filer)"
  const dashIdx = title.indexOf(' - ');
  const formType = dashIdx === -1 ? '' : title.slice(0, dashIdx).trim();
  let company = dashIdx === -1 ? title.trim() : title.slice(dashIdx + 3).trim();
  let cik = null;
  const cikMatch = company.match(RE_CIK);
  if (cikMatch) {
    cik = cikMatch[1];
    company = company.replace(RE_CIK_SUFFIX, '').trim();
  }
  return {
    id: accession ?? `edgar-${fallbackIndex}`,
    company,
    cik,
    formType,
    filedAt: tagText(entry, 'updated') || null,
    description: summaryText.slice(0, 400),
    accessionNo: accession,
  };
}

function buildFilingFromSubmission(recent, i, padded, entityName) {
  const accession = recent.accessionNumber?.[i] ?? null;
  return {
    id: accession ?? `cik-${padded}-${i}`,
    company: entityName,
    cik: padded,
    formType: recent.form?.[i] ?? '',
    filedAt: recent.filingDate?.[i] ?? null,
    description: recent.primaryDocDescription?.[i] ?? '',
    accessionNo: accession,
  };
}

async function fetchByCik(cik) {
  const padded = String(cik).replace(/\D/g, '').padStart(10, '0');
  const r = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return [];
  const payload = await r.json();
  const recent = payload?.filings?.recent ?? {};
  const len = Math.min(50, Array.isArray(recent.form) ? recent.form.length : 0);
  const entityName = payload?.name ?? '';
  const filings = [];
  for (let i = 0; i < len; i++) filings.push(buildFilingFromSubmission(recent, i, padded, entityName));
  return filings;
}

async function fetchLatestFeed(filingType) {
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
  if (!r.ok) return [];
  const xml = await r.text();
  const entries = pickAtomEntries(xml);
  return entries.map((entry, i) => buildFilingFromAtom(entry, i));
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
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.filings, 200, cors);

  try {
    const filings = cik ? await fetchByCik(cik) : await fetchLatestFeed(filingType);
    cache.set(cacheKey, { at: Date.now(), filings });
    return j(filings, 200, cors);
  } catch {
    // Empty array preserves the EdgarFiling[] contract so panels render
    // as "no filings" rather than crashing on .length / .slice of a
    // non-array.
    return j([], 200, cors);
  }
}
