/**
 * AWC PIREP proxy.
 * Upstream: https://aviationweather.gov/cgi-bin/json/PirepJSON.php?distm=200
 */

import {
  envelope,
  extractItems,
  fetchUpstream,
  jsonResponse,
  parseTimestamp,
  pickFinite,
  pickString,
  preflight,
  withCache,
} from './_aviation-helpers.js';

export const config = { runtime: 'edge' };

const SOURCE = 'aviationweather.gov';
const CACHE_KEY = 'aviation:pireps';

function inferHazard(icing, turb, text) {
  if (icing && String(icing).trim()) return 'icing';
  if (turb && String(turb).trim()) return 'turbulence';
  if (/\bICE|ICING\b/i.test(text)) return 'icing';
  if (/\bTURB|CHOP|BMPY\b/i.test(text)) return 'turbulence';
  if (/WIND SHEAR|WS\b/i.test(text)) return 'wind_shear';
  return 'other';
}

function inferIntensity(icing, turb, text) {
  const raw = `${String(icing ?? '')} ${String(turb ?? '')} ${text}`.toUpperCase();
  if (raw.includes('EXTRM') || raw.includes('XTRM')) return 'extreme';
  if (raw.includes('SEV')) return 'severe';
  if (raw.includes('MOD')) return 'moderate';
  if (raw.includes('LGT') || raw.includes('LIGHT')) return 'light';
  if (raw.includes('TRC') || raw.includes('TRACE')) return 'trace';
  return 'light';
}

function normalizePirep(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const props = item.properties ?? item;
  const rawText = pickString(props.rawOb, props.text, props.rawPirep);
  if (!rawText) return null;
  const hazard = inferHazard(props.icingType, props.turbType, rawText);
  if (hazard === 'other') return null;
  return {
    id: pickString(props.id, props.aircraftRef) ?? `pirep-${idx}`,
    hazard,
    intensity: inferIntensity(props.icingInt, props.turbInt, rawText),
    altitudeFt: pickFinite(props.fltlvl, props.altitude_ft_msl),
    lat: pickFinite(props.lat, props.latitude),
    lon: pickFinite(props.lon, props.longitude),
    reportedAt: parseTimestamp(props.obsTime, props.obs_time) ?? Date.now(),
    aircraftType: pickString(props.acType, props.aircraft_type),
    rawText: rawText.trim(),
  };
}

async function fetchPireps() {
  const url = 'https://aviationweather.gov/cgi-bin/json/PirepJSON.php?distm=200';
  const response = await fetchUpstream(url);
  if (!response.ok) {
    throw new Error(`PIREP upstream HTTP ${response.status}`);
  }
  const payload = await response.json();
  const items = extractItems(payload, ['data', 'features', 'pireps']);
  const out = [];
  for (const [idx, item] of items.entries()) {
    const norm = normalizePirep(item, idx);
    if (norm) out.push(norm);
  }
  return envelope(out, SOURCE);
}

export default async function handler(req) {
  const { cors, response } = preflight(req, 'GET, OPTIONS');
  if (response) return response;
  const result = await withCache(CACHE_KEY, SOURCE, fetchPireps);
  return jsonResponse(result, 200, cors);
}
