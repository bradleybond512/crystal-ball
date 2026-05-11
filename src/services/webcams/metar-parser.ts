import type { MetarCloudLayer, MetarData, MetarStation } from './metar-types';

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const cleaned = v.replace(/[+]$/, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseCloudLayer(raw: unknown): MetarCloudLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const coverRaw = typeof o.cover === 'string' ? o.cover.toUpperCase() : '';
  const cover = (
    ['SKC', 'CLR', 'FEW', 'SCT', 'BKN', 'OVC', 'VV', 'OVX'] as const
  ).find((c) => c === coverRaw);
  if (!cover) return null;
  return {
    cover,
    baseFt: toFiniteNumber(o.base),
  };
}

export function parseMetarRow(raw: unknown): MetarData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const stationId = typeof o.icaoId === 'string' ? o.icaoId.trim() : '';
  if (!stationId) return null;

  const cloudsRaw = Array.isArray(o.clouds) ? o.clouds : [];
  const clouds = cloudsRaw
    .map((c) => parseCloudLayer(c))
    .filter((c): c is MetarCloudLayer => c !== null);

  return {
    stationId,
    observedAtSec: toFiniteNumber(o.obsTime),
    rawObservation: typeof o.rawOb === 'string' ? o.rawOb : null,
    windDirDeg: toFiniteNumber(o.wdir),
    windSpeedKt: toFiniteNumber(o.wspd),
    windGustKt: toFiniteNumber(o.wgst),
    visibilityMi: toFiniteNumber(o.visib),
    ceilingFt: null,
    weather: typeof o.wxString === 'string' && o.wxString.length > 0 ? o.wxString : null,
    tempC: toFiniteNumber(o.temp),
    dewpointC: toFiniteNumber(o.dewp),
    altimeterInHg: toFiniteNumber(o.altim),
    clouds,
  };
}

export function parseMetarResponse(payload: unknown): MetarData[] {
  const rows = Array.isArray(payload) ? payload : [];
  const out: MetarData[] = [];
  for (const row of rows) {
    const parsed = parseMetarRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseStationRow(raw: unknown): MetarStation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const icaoId = typeof o.icaoId === 'string' ? o.icaoId.trim() : '';
  const lat = toFiniteNumber(o.lat);
  const lon = toFiniteNumber(o.lon);
  if (!icaoId || lat === null || lon === null) return null;
  return {
    icaoId,
    lat,
    lon,
    elevFt: toFiniteNumber(o.elev),
    site: typeof o.site === 'string' ? o.site : '',
    state: typeof o.state === 'string' ? o.state : '',
    country: typeof o.country === 'string' ? o.country : '',
  };
}

export function parseStationResponse(payload: unknown): MetarStation[] {
  const rows = Array.isArray(payload) ? payload : [];
  const out: MetarStation[] = [];
  for (const row of rows) {
    const parsed = parseStationRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}
