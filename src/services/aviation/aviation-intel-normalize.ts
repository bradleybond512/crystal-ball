/**
 * Aviation intelligence — pure-deterministic normalizers.
 *
 * Each function takes a raw upstream JSON payload (already parsed) and
 * returns a typed array. No I/O. The sidecar routes call fetch + JSON.parse
 * + these normalizers; unit tests call them with static fixtures.
 *
 * Plan invariants:
 *   - Bad upstream payloads must NOT throw - return [] and let the caller
 *     mark the envelope `degraded`.
 *   - String fields are trimmed; missing/non-finite numbers become null
 *     (not NaN) so JSON serialization stays clean.
 */

import type {
  AirportGroundDelay,
  AviationNotam,
  AviationPirep,
  AviationSigmet,
  MilitaryAircraft,
  NotamClassification,
  PirepHazard,
  SigmetHazard,
  VolcanicAshAdvisory,
} from './aviation-intel-types';

// FAA NOTAM normalizer

export function normalizeNotams(payload: unknown): AviationNotam[] {
  const items = extractItems(payload, ['items', 'data', 'notams']);
  const out: AviationNotam[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const root = item as Record<string, unknown>;
    const props = (root.properties as Record<string, unknown> | undefined) ?? root;
    const core =
      (props.coreNOTAMData as Record<string, unknown> | undefined) ??
      (props.notamTranslation as Record<string, unknown> | undefined) ??
      props;
    const notam = (core.notam as Record<string, unknown> | undefined) ?? core;
    const text = pickString(
      notam.text,
      notam.message,
      notam.simpleText,
      notam.notamText,
      props.notamText,
    );
    if (!text) continue;
    const notamNumber = pickString(notam.number, notam.notamNumber, notam.id) ?? '';
    const classifierRaw = pickString(notam.classification, notam.notamType, props.classification);
    const classification = classifierRaw
      ? normalizeClassification(classifierRaw, text)
      : normalizeClassification('', text);
    const center = parseCenterRadius(text);
    const altitudeFt = parseAltitudeBand(text);
    out.push({
      id: notamNumber || `notam-${out.length}`,
      notamNumber,
      classification,
      affectedFir: pickString(notam.affectedFIR, notam.fir) ?? null,
      featureName: pickString(notam.featureName, notam.feature) ?? null,
      icaoId: pickString(notam.icaoLocation, notam.location, notam.icaoId) ?? null,
      text: text.trim(),
      effectiveStart: parseTimestamp(notam.effectiveStart, notam.startDate),
      effectiveEnd: parseTimestamp(notam.effectiveEnd, notam.endDate),
      ...(center ? { center } : {}),
      ...(altitudeFt ? { altitudeFt } : {}),
      presidential: /\bpresidential|VIP movement|VIP\b/i.test(text),
    });
  }
  return out;
}

function normalizeClassification(raw: string, text: string): NotamClassification {
  const upper = raw.toUpperCase();
  if (upper === 'FDC' || /TFR/i.test(text)) return /TFR/i.test(text) ? 'TFR' : 'FDC';
  if (upper === 'DOM' || upper === 'INTL') return upper as NotamClassification;
  return 'OTHER';
}

const CENTER_RE = /(\d{1,2})(\d{2})([NS])/;
const RADIUS_RE = /(\d{1,3})\s*NM/i;
const LON_RE = /(\d{1,3})(\d{2})([EW])/;

function parseCenterRadius(text: string): { lat: number; lon: number; radiusNm: number } | undefined {
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const lat = text.match(CENTER_RE);
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const lon = text.match(LON_RE);
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const r = text.match(RADIUS_RE);
  if (!lat || !lon || !r) return undefined;
  const latDec = ddmToDecimal(lat[1]!, lat[2]!, lat[3]!);
  const lonDec = ddmToDecimal(lon[1]!, lon[2]!, lon[3]!);
  const radiusNm = Number.parseInt(r[1]!, 10);
  if (!Number.isFinite(latDec) || !Number.isFinite(lonDec) || !Number.isFinite(radiusNm)) return undefined;
  return { lat: latDec, lon: lonDec, radiusNm };
}

function ddmToDecimal(deg: string, min: string, hemi: string): number {
  const d = Number.parseInt(deg, 10);
  const mins = Number.parseInt(min, 10);
  if (!Number.isFinite(d) || !Number.isFinite(mins)) return Number.NaN;
  const dec = d + mins / 60;
  const sign = hemi === 'S' || hemi === 'W' ? -1 : 1;
  return dec * sign;
}

const FL_RE = /(?:SFC|GND).*?FL\s?(\d{2,3})/i;
const FT_RE = /(\d{3,5})\s*FT?\s*MSL/i;

function parseAltitudeBand(text: string): { min: number | null; max: number | null } | undefined {
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const fl = text.match(FL_RE);
  if (fl?.[1]) return { min: 0, max: Number.parseInt(fl[1], 10) * 100 };
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const ft = text.match(FT_RE);
  if (ft?.[1]) return { min: 0, max: Number.parseInt(ft[1], 10) };
  return undefined;
}

// SIGMET / AIRMET normalizer

export function normalizeSigmets(payload: unknown, isAirmet = false): AviationSigmet[] {
  const items = extractItems(payload, ['data', 'features', 'sigmets', 'airmets']);
  const out: AviationSigmet[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const root = item as Record<string, unknown>;
    const props = (root.properties as Record<string, unknown> | undefined) ?? root;
    const text = pickString(props.rawSigmet, props.rawAirmet, props.text, props.rawAir, props.rawSig);
    if (!text) continue;
    const hazard = inferHazard(props.hazard, text);
    const severity = inferSeverity(props.severity, text);
    const polygon = extractPolygon(root.geometry, props.coords, props.area);
    const altitudeFt = extractAltitude(props.altitudeLow1, props.altitudeHi1, text);
    out.push({
      id: pickString(props.id, props.airSigmetId) ?? `sigmet-${out.length}`,
      hazard,
      severity,
      ...(altitudeFt ? { altitudeFt } : {}),
      polygon,
      text: text.trim(),
      validFrom: parseTimestamp(props.validTimeFrom, props.validFrom) ?? Date.now(),
      validTo: parseTimestamp(props.validTimeTo, props.validTo) ?? Date.now() + 6 * 3_600_000,
      isAirmet,
    });
  }
  return out;
}

function inferHazard(rawHazard: unknown, text: string): SigmetHazard {
  const raw = (typeof rawHazard === 'string' ? rawHazard : '').toUpperCase();
  if (raw.includes('VA') || /VOLCANIC ASH|ASHTOPS/i.test(text)) return 'volcanic_ash';
  if (raw.includes('TURB') || /\bTURB|TURBULENCE\b/i.test(text)) return 'turbulence';
  if (raw.includes('ICE') || /\bICE|ICING\b/i.test(text)) return 'icing';
  if (raw.includes('TS') || /TS\b|THUNDERSTORM/i.test(text)) return 'thunderstorm';
  if (raw === 'MTN OBSCN' || /MTN OBSCN|MOUNTAIN OBSCURATION/i.test(text)) return 'mountain_obscuration';
  if (raw === 'IFR' || /\bIFR\b/i.test(text)) return 'ifr';
  return 'other';
}

function inferSeverity(rawSeverity: unknown, text: string): AviationSigmet['severity'] {
  const raw = (typeof rawSeverity === 'string' ? rawSeverity : '').toUpperCase();
  if (raw.includes('SEV') || /SEVERE/i.test(text)) return 'severe';
  if (raw.includes('EXTRM') || /EXTREME/i.test(text)) return 'extreme';
  if (raw.includes('MOD') || /MODERATE|MOD\b/i.test(text)) return 'moderate';
  return 'light';
}

function extractPolygon(
  geometry: unknown,
  coords: unknown,
  area: unknown,
): { lat: number; lon: number }[] {
  if (geometry && typeof geometry === 'object') {
    const g = geometry as { type?: string; coordinates?: unknown };
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const ring: unknown = g.coordinates[0];
      if (Array.isArray(ring)) return parseLonLatPairs(ring as unknown[]);
    }
  }
  if (Array.isArray(coords)) return parseLonLatPairs(coords);
  if (typeof area === 'string') return parseAreaString(area);
  return [];
}

function parseLonLatPairs(arr: unknown[]): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (const pt of arr) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const lon = Number(pt[0]);
      const lat = Number(pt[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lat, lon });
    } else if (pt && typeof pt === 'object') {
      const p = pt as { lat?: unknown; lon?: unknown; latitude?: unknown; longitude?: unknown };
      const lat = Number(p.lat ?? p.latitude);
      const lon = Number(p.lon ?? p.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
    }
  }
  return out;
}

const AREA_PAIR_RE = /(\d{2,3})(\d{2})([NS])\s+(\d{2,3})(\d{2})([EW])/g;

function parseAreaString(s: string): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (const m of s.matchAll(AREA_PAIR_RE)) {
    const lat = ddmToDecimal(m[1]!, m[2]!, m[3]!);
    const lon = ddmToDecimal(m[4]!, m[5]!, m[6]!);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
  }
  return out;
}

const FL_RANGE_RE = /FL\s*(\d{2,3})\s*[-/]\s*FL?\s*(\d{2,3})/i;

function extractAltitude(
  low: unknown,
  hi: unknown,
  text: string,
): { min: number; max: number } | undefined {
  const lo = Number(low);
  const high = Number(hi);
  if (Number.isFinite(lo) && Number.isFinite(high)) {
    return { min: lo, max: high };
  }
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec, sonarjs/prefer-regexp-exec
  const flMatch = text.match(FL_RANGE_RE);
  if (flMatch) {
    return { min: Number.parseInt(flMatch[1]!, 10) * 100, max: Number.parseInt(flMatch[2]!, 10) * 100 };
  }
  return undefined;
}

// PIREP normalizer

export function normalizePireps(payload: unknown): AviationPirep[] {
  const items = extractItems(payload, ['data', 'features', 'pireps']);
  const out: AviationPirep[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const root = item as Record<string, unknown>;
    const props = (root.properties as Record<string, unknown> | undefined) ?? root;
    const rawText = pickString(props.rawOb, props.text, props.rawPirep);
    if (!rawText) continue;
    const hazard = inferPirepHazard(props.icingType, props.turbType, rawText);
    if (hazard === 'other') continue;
    const intensity = inferPirepIntensity(props.icingInt, props.turbInt, rawText);
    out.push({
      id: pickString(props.id, props.aircraftRef) ?? `pirep-${out.length}`,
      hazard,
      intensity,
      altitudeFt: pickFinite(props.fltlvl, props.altitude_ft_msl) ?? null,
      lat: pickFinite(props.lat, props.latitude) ?? null,
      lon: pickFinite(props.lon, props.longitude) ?? null,
      reportedAt: parseTimestamp(props.obsTime, props.obs_time) ?? Date.now(),
      aircraftType: pickString(props.acType, props.aircraft_type) ?? null,
      rawText: rawText.trim(),
    });
  }
  return out;
}

function asStringTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function inferPirepHazard(icing: unknown, turb: unknown, text: string): PirepHazard {
  if (asStringTrimmed(icing)) return 'icing';
  if (asStringTrimmed(turb)) return 'turbulence';
  if (/\bICE|ICING\b/i.test(text)) return 'icing';
  if (/\bTURB|CHOP|BMPY\b/i.test(text)) return 'turbulence';
  if (/WIND SHEAR|WS\b/i.test(text)) return 'wind_shear';
  return 'other';
}

function inferPirepIntensity(
  icing: unknown,
  turb: unknown,
  text: string,
): AviationPirep['intensity'] {
  const raw = `${asStringTrimmed(icing)} ${asStringTrimmed(turb)} ${text}`.toUpperCase();
  if (raw.includes('EXTRM') || raw.includes('XTRM')) return 'extreme';
  if (raw.includes('SEV')) return 'severe';
  if (raw.includes('MOD')) return 'moderate';
  if (raw.includes('LGT') || raw.includes('LIGHT')) return 'light';
  if (raw.includes('TRC') || raw.includes('TRACE')) return 'trace';
  return 'light';
}

// Military aircraft normalizer

const MIL_CALLSIGN_PREFIXES: Record<string, MilitaryAircraft['type']> = {
  RCH: 'transport',
  REACH: 'transport',
  CNV: 'tanker',
  PAT: 'tanker',
  GOLD: 'tanker',
  SHELL: 'tanker',
  TEAL: 'recon',
  HOMER: 'recon',
  MAGIC: 'recon',
  SENTRY: 'recon',
  RIVET: 'recon',
  PYTHON: 'fighter',
  RAGE: 'fighter',
  VIPER: 'fighter',
  EAGLE: 'fighter',
  RAIDER: 'bomber',
  DOOM: 'bomber',
  BISON: 'bomber',
  ARMY: 'helo',
  PEDRO: 'helo',
  DUSTOFF: 'helo',
};

export function normalizeMilitaryAircraft(payload: unknown): MilitaryAircraft[] {
  const items = extractMilitaryItems(payload);
  const out: MilitaryAircraft[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const callsign = (pickString(r.flight, r.r, r.callsign) ?? '').trim() || null;
    const icao24 = (pickString(r.hex, r.icao24, r.icao) ?? '').toLowerCase().trim();
    if (!icao24) continue;
    const altMeters = pickFinite(r.alt_baro, r.geom_alt, r.baro_altitude);
    out.push({
      icao24,
      callsign,
      type: classifyMilitaryType(callsign, r.t),
      country: pickString(r.r_country, r.origin_country, r.country) ?? null,
      lat: pickFinite(r.lat, r.latitude) ?? null,
      lon: pickFinite(r.lon, r.longitude) ?? null,
      altitudeFt: altMeters === null ? pickFinite(r.alt_geom) : metersToFeet(altMeters),
      velocityKts: pickFinite(r.gs, r.velocity) ?? null,
      heading: pickFinite(r.track, r.heading) ?? null,
      squawk: pickString(r.squawk) ?? null,
      lastSeen: parseTimestamp(r.seen, r.last_contact) ?? Date.now(),
      emergency: ['7500', '7600', '7700'].includes(asStringTrimmed(r.squawk)),
    });
  }
  return out;
}

function extractMilitaryItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.ac)) return p.ac;
    if (Array.isArray(p.aircraft)) return p.aircraft;
    if (Array.isArray(p.states)) {
      // OpenSky states/all shape: array-of-arrays.
      return p.states.map((row: unknown) => {
        if (!Array.isArray(row)) return null;
        const r = row as readonly unknown[];
        return {
          icao24: r[0] as unknown,
          callsign: r[1] as unknown,
          origin_country: r[2] as unknown,
          last_contact: typeof r[4] === 'number' ? r[4] * 1000 : null,
          lon: r[5] as unknown,
          lat: r[6] as unknown,
          baro_altitude: r[7] as unknown,
          velocity: r[9] as unknown,
          track: r[10] as unknown,
          squawk: r[14] as unknown,
        };
      });
    }
    if (Array.isArray(p.data)) return p.data;
  }
  return [];
}

function classifyMilitaryType(
  callsign: string | null,
  acTypeRaw: unknown,
): MilitaryAircraft['type'] {
  if (callsign) {
    const upper = callsign.replace(/\d{1,8}$/, '').toUpperCase();
    for (const [prefix, type] of Object.entries(MIL_CALLSIGN_PREFIXES)) {
      if (upper.startsWith(prefix)) return type;
    }
  }
  const t = typeof acTypeRaw === 'string' ? acTypeRaw.toUpperCase() : '';
  if (/^C-?(5|17|130)|^KC-?\d|KC-?135|KC-?46/.test(t)) return 'tanker';
  if (/^F-?(15|16|18|22|35)/.test(t)) return 'fighter';
  if (/^B-?(1|2|52)/.test(t)) return 'bomber';
  if (/AWACS|RC-?135|U-?2|RQ-?4/.test(t)) return 'recon';
  if (/^(UH|HH|CH|MH)-?\d/.test(t)) return 'helo';
  return 'unknown';
}

function metersToFeet(m: number): number {
  return Math.round(m * 3.280_84);
}

// Airport delays normalizer

export function normalizeDelays(payload: unknown): AirportGroundDelay[] {
  const items = extractItems(payload, ['delays', 'events', 'data', 'airports']);
  const out: AirportGroundDelay[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const airport = (pickString(r.airport, r.iata, r.icao, r.location) ?? '').toUpperCase();
    if (!airport) continue;
    out.push({
      airport,
      reason: pickString(r.reason, r.cause, r.eventType) ?? 'unspecified',
      avgDelayMinutes: pickFinite(r.avgDelay, r.avg_delay_minutes, r.average_delay_minutes),
      maxDelayMinutes: pickFinite(r.maxDelay, r.max_delay_minutes),
      programType: classifyProgram(pickString(r.eventType, r.programType, r.type) ?? ''),
      startedAt: parseTimestamp(r.startTime, r.startedAt),
      endsAt: parseTimestamp(r.endTime, r.endsAt),
    });
  }
  return out;
}

function classifyProgram(raw: string): AirportGroundDelay['programType'] {
  const u = raw.toUpperCase();
  if (u.includes('STOP')) return 'ground_stop';
  if (u.includes('GROUND') || u.includes('GDP')) return 'ground_delay';
  if (u.includes('ARRIVAL') || u.includes('AAR')) return 'arrival_delay';
  return 'other';
}

// VAAC ash normalizer

export function normalizeVolcanicAsh(payload: unknown): VolcanicAshAdvisory[] {
  const items = extractItems(payload, ['data', 'features', 'volcanoes', 'advisories']);
  const out: VolcanicAshAdvisory[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const props = (r.properties as Record<string, unknown> | undefined) ?? r;
    const polygon = extractPolygon(r.geometry, props.coords, props.area);
    if (polygon.length < 3) continue;
    const text = pickString(props.text, props.advisoryText, props.rawText) ?? '';
    const lo = pickFinite(props.altitudeLow, props.minAlt) ?? 0;
    const hi = pickFinite(props.altitudeHi, props.maxAlt) ?? 0;
    out.push({
      id: pickString(props.id, props.advisoryId) ?? `vaac-${out.length}`,
      volcano: pickString(props.volcano, props.name) ?? 'unknown',
      polygon,
      altitudeFt: { min: lo, max: hi },
      validFrom: parseTimestamp(props.validFrom, props.startTime) ?? Date.now(),
      validTo: parseTimestamp(props.validTo, props.endTime) ?? Date.now() + 6 * 3_600_000,
      source: 'NOAA',
      text,
    });
  }
  return out;
}

// Helpers

function extractItems(payload: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    for (const key of keys) {
      const v = p[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickFinite(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseTimestamp(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Heuristic: <= 10 digits -> seconds, otherwise ms.
      return v < 10_000_000_000 ? v * 1000 : v;
    }
    if (typeof v === 'string' && v.trim()) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}
