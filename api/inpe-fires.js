/**
 * INPE / Brazil fire monitoring proxy. INPE's queimadas program publishes
 * a daily TerraBrasilis CSV/JSON for active fire detections. Free, no key.
 *
 * Endpoint emits the last 24h of fire detections; we limit to the most
 * recent 1000 to keep the payload reasonable.
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = null;

const j = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
});

const degraded = (reason) => ({ fires: [], degraded: true, reason, source: 'queimadas.dgi.inpe.br', generatedAt: new Date().toISOString() });

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return j({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return j({ error: 'Method not allowed' }, 405, cors);
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return j(_cache.payload, 200, cors);

  // Public CSV of focos in last 24h (continent of South America).
  const upstream = 'https://queimadas.dgi.inpe.br/api/focos/24h/csv?continente=AmericaDoSul';
  try {
    const r = await fetch(upstream, {
      headers: { 'User-Agent': 'CrystalBall/2.10.21 (inpe)', Accept: 'text/csv' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return j(degraded(`INPE returned HTTP ${r.status}`), 200, cors);
    const text = await r.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return j({ fires: [], count: 0, source: 'queimadas.dgi.inpe.br', generatedAt: new Date().toISOString() }, 200, cors);
    const headerCells = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const i = (k) => headerCells.indexOf(k);
    const iLat = i('lat') >= 0 ? i('lat') : i('latitude');
    const iLon = i('lon') >= 0 ? i('lon') : i('longitude');
    const iSat = i('satelite');
    const iDate = i('datahora');
    const iCountry = i('pais');
    const iState = i('estado');
    const iMunic = i('municipio');
    const iBioma = i('bioma');
    const iFrp = i('frp');
    const fires = [];
    for (let n = 1; n < lines.length && fires.length < 1000; n++) {
      const cells = lines[n].split(',');
      const lat = Number.parseFloat(cells[iLat]);
      const lon = Number.parseFloat(cells[iLon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      fires.push({
        lat, lon,
        sat: cells[iSat] ?? '',
        datetime: cells[iDate] ?? '',
        country: cells[iCountry] ?? '',
        state: cells[iState] ?? '',
        municipality: cells[iMunic] ?? '',
        biome: cells[iBioma] ?? '',
        frp: Number.parseFloat(cells[iFrp]) || 0,
      });
    }
    const result = { fires, count: fires.length, source: 'queimadas.dgi.inpe.br', generatedAt: new Date().toISOString() };
    _cache = { at: Date.now(), payload: result };
    return j(result, 200, cors);
  } catch (error) {
    return j(degraded(`INPE fetch failed: ${error?.message ?? error}`), 200, cors);
  }
}
