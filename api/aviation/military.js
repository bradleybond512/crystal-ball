/**
 * Military aircraft proxy. Combines:
 *   - https://api.adsb.lol/v2/mil   (free, no key, primary)
 *   - https://opensky-network.org/api/states/all (free, no key, fallback)
 * Deduplicates by ICAO24.
 */

import {
  envelope,
  fetchUpstream,
  jsonResponse,
  normalizeMilitary,
  preflight,
  withCache,
} from './_aviation-helpers.js';

export const config = { runtime: 'edge' };

const SOURCE = 'adsb.lol+opensky';
const CACHE_KEY = 'aviation:military';

async function fetchAdsbMil() {
  try {
    const resp = await fetchUpstream('https://api.adsb.lol/v2/mil');
    if (!resp.ok) return [];
    const payload = await resp.json();
    return normalizeMilitary(payload);
  } catch {
    return [];
  }
}

async function fetchOpenSkyMilFallback() {
  try {
    const resp = await fetchUpstream('https://opensky-network.org/api/states/all');
    if (!resp.ok) return [];
    const payload = await resp.json();
    return normalizeMilitary(payload).filter((ac) => ac.type !== 'unknown');
  } catch {
    return [];
  }
}

async function fetchMilitary() {
  const out = new Map();
  for (const ac of await fetchAdsbMil()) {
    out.set(ac.icao24, ac);
  }
  if (out.size === 0) {
    for (const ac of await fetchOpenSkyMilFallback()) {
      out.set(ac.icao24, ac);
    }
  }
  return envelope([...out.values()], SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchMilitary);
  return jsonResponse(result, 200, cors);
}
