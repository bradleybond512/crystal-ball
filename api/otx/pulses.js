/**
 * AlienVault OTX subscribed-pulses polling loop with rolling 200-pulse
 * window. Distinct from the existing /api/otx-pulses route, which is a
 * single-shot fetch (no incremental polling, no rolling cache).
 *
 * GET /api/otx/pulses
 *   → { pulses: OtxPulse[], updatedAt, count, source, lastPolledAt }
 *
 * Behavior:
 *   - 30-min upstream poll cadence (CACHE_TTL_MS). Within the TTL, returns
 *     the cached rolling window without hitting OTX.
 *   - On each upstream fetch, uses modified_since={lastPolledAt} so OTX
 *     only returns delta. New pulses are merged into the rolling cache,
 *     deduped by id, sorted newest-first by `modified`, capped at 200.
 *   - Cold start fetches with limit=50, no modified_since.
 *
 * Companion client helper at src/services/cyber/otx-ingest.ts maps each
 * cached pulse through apt-tracker.matchPulseToGroup → pulseToActivityEvent
 * to feed the APT activity ledger.
 */

import { getCorsHeaders, isDisallowedOrigin } from '../_cors.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://otx.alienvault.com/api/v1/pulses/subscribed';
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const PAGE_LIMIT = 50;       // matches OTX recommended page size
const ROLLING_CAP = 200;     // total pulses retained across polls

let _state = {
  pulses: [],          // rolling window, newest-first
  lastPolledAt: 0,     // wall-clock ms of most recent successful upstream call
  lastModifiedIso: '', // most-recent `modified` timestamp seen — used for delta fetches
};

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason, extra = {}) => ({
  pulses: [], count: 0, source: 'otx.alienvault.com',
  updatedAt: Date.now(), degraded: true, reason, ...extra,
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);

  const key = process.env.OTX_API_KEY;
  if (!key) return j(degraded('OTX_API_KEY not set'), 200, cors);

  // Within TTL → serve cached rolling window without upstream call.
  if (_state.lastPolledAt && Date.now() - _state.lastPolledAt < CACHE_TTL_MS) {
    return j(buildResponse(), 200, cors);
  }

  try {
    const fresh = await fetchDelta(key, _state.lastModifiedIso);
    _state = mergePulses(_state, fresh);
    return j(buildResponse(), 200, cors);
  } catch (error) {
    // On upstream failure, serve stale cache if we have one — preserve
    // the contract so the apt-tracker doesn't lose the window during
    // an OTX hiccup.
    if (_state.pulses.length > 0) {
      return j({ ...buildResponse(), staleAfterError: String(error?.message ?? error) }, 200, cors);
    }
    return j(degraded(`OTX fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}

async function fetchDelta(apiKey, sinceIso) {
  const url = new URL(UPSTREAM);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (sinceIso) url.searchParams.set('modified_since', sinceIso);
  const r = await fetch(url.toString(), {
    headers: { 'X-OTX-API-KEY': apiKey, 'User-Agent': 'CrystalBall (otx)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const payload = await r.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

/** Pure merge: combine existing rolling window with fresh delta, dedupe
 *  by id (fresh wins so re-served pulses get updated metadata), sort
 *  newest-first by `modified`, cap at ROLLING_CAP.
 *
 *  Exported for unit testing. Returns a new state object — does not
 *  mutate the input. */
export function mergePulses(state, fresh) {
  const byId = new Map();
  for (const p of state.pulses) if (p?.id) byId.set(p.id, p);
  for (const p of fresh) if (p?.id) byId.set(p.id, p);
  const merged = [...byId.values()];
  merged.sort((a, b) => (b?.modified ?? '').localeCompare(a?.modified ?? ''));
  const capped = merged.slice(0, ROLLING_CAP);
  const newestModified = capped[0]?.modified ?? state.lastModifiedIso;
  return {
    pulses: capped,
    lastPolledAt: Date.now(),
    lastModifiedIso: newestModified || state.lastModifiedIso,
  };
}

function buildResponse() {
  return {
    pulses: _state.pulses,
    count: _state.pulses.length,
    source: 'otx.alienvault.com',
    updatedAt: Date.now(),
    lastPolledAt: _state.lastPolledAt,
    lastModifiedIso: _state.lastModifiedIso,
  };
}

export function __resetStateForTests() {
  _state = { pulses: [], lastPolledAt: 0, lastModifiedIso: '' };
}
