/**
 * VirusTotal IOC reputation lookup. Requires VIRUSTOTAL_API_KEY (free 4 req/min).
 *   GET /api/virustotal-lookup?indicator=…&type=domain|ip|url|hash
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { requireAppAuth, clampQueryParam } from './_auth.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ result: null, degraded: true, reason, source: 'virustotal.com', generatedAt: new Date().toISOString() });

function detectType(indicator) {
  const t = indicator.trim();
  if (/^[a-f0-9]{32}$/i.test(t) || /^[a-f0-9]{40}$/i.test(t) || /^[a-f0-9]{64}$/i.test(t)) return 'hash';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return 'ip';
  if (t.startsWith('http://') || t.startsWith('https://')) return 'url';
  return 'domain';
}

function endpointFor(itype, indicator) {
  switch (itype) {
    case 'ip': { return `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(indicator)}`;
    }
    case 'domain': { return `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(indicator)}`;
    }
    case 'hash': { return `https://www.virustotal.com/api/v3/files/${encodeURIComponent(indicator)}`;
    }
    case 'url': {
      // VT requires base64url-encoded URL ID for /urls/.
      // base64url-safe: replace `+`/`/` and trim 0–2 trailing `=` padding
      // chars (bounded to dodge the slow-regex linter rule).
      const b64 = btoa(indicator).replaceAll('+', '-').replaceAll('/', '_').replace(/={0,2}$/, '');
      return `https://www.virustotal.com/api/v3/urls/${b64}`;
    }
    default: { return null;
    }
  }
}

// Conservative cap: VirusTotal accepts URLs up to ~2k, hashes are
// fixed-width, IPs/domains are short. 4096 chars is generous and
// blocks abuse via gigantic payloads.
const MAX_INDICATOR_LENGTH = 4096;

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  // Key-spending oracle path. Gate before we hit the upstream.
  const denied = requireAppAuth(req, cors);
  if (denied) return denied;

  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) return j(degraded('VIRUSTOTAL_API_KEY not set'), 200, cors);

  const url = new URL(req.url);
  const indicator = clampQueryParam(url.searchParams.get('indicator'), MAX_INDICATOR_LENGTH);
  if (!indicator) return j({ error: 'indicator query param required' }, 400, cors);
  const itype = (url.searchParams.get('type') || detectType(indicator)).toLowerCase();
  const endpoint = endpointFor(itype, indicator);
  if (!endpoint) return j({ error: `Unsupported type: ${itype}` }, 400, cors);

  const cacheKey = `${itype}|${indicator}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return j(cached.payload, 200, cors);

  try {
    const r = await fetch(endpoint, {
      headers: {
        'x-apikey': key,
        Accept: 'application/json',
        'User-Agent': 'CrystalBall/2.10.21',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 404) return j({ result: null, indicator, type: itype, found: false, source: 'virustotal.com', generatedAt: new Date().toISOString() }, 200, cors);
    if (!r.ok) return j(degraded(`VirusTotal returned HTTP ${r.status}`), 200, cors);
    const payload = await r.json();
    const stats = payload?.data?.attributes?.last_analysis_stats ?? {};
    const result = {
      indicator,
      type: itype,
      found: true,
      stats,
      reputation: payload?.data?.attributes?.reputation ?? null,
      total_votes: payload?.data?.attributes?.total_votes ?? null,
      last_analysis_date: payload?.data?.attributes?.last_analysis_date ?? null,
      tags: payload?.data?.attributes?.tags ?? [],
      categories: payload?.data?.attributes?.categories ?? null,
      source: 'virustotal.com',
      generatedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), payload: result });
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`VirusTotal fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
