/**
 * Water evidence service.
 *
 * EPA SDWIS rows are compliance history, not live local drinking-water
 * advisories. USGS Water Services readings are surface-water measurements,
 * not evidence that treated tap water is safe or unsafe. This boundary keeps
 * those evidence classes separate and leaves live potable status unknown
 * until an explicit potable-water authority feed is integrated.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export type WaterAlertSeverity = 'safe' | 'advisory' | 'do-not-use' | 'unknown';
export type WaterAlertType = 'boil-water' | 'do-not-use' | 'contamination' | 'treatment-outage' | 'general';
export type WaterEvidenceKind = 'official-potable-advisory' | 'epa-compliance-history';

export interface WaterAlert {
  id: string;
  type: WaterAlertType;
  severity: WaterAlertSeverity;
  title: string;
  description: string;
  systemName: string;
  state: string;
  issuedAt: Date;
  expiresAt: Date | null;
  evidenceKind?: WaterEvidenceKind;
  sourceObservedAt?: Date | null;
  sourceUrl?: string;
}

export interface WaterSystem {
  id: string;
  name: string;
  state: string;
  populationServed: number;
  status: WaterAlertSeverity;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  violations: number;
  lastInspection: Date | null;
  evidenceKind?: 'epa-compliance-history';
}

export interface SurfaceWaterMeasurement {
  id: string;
  source: 'usgs-surface-water';
  siteCode?: string;
  siteName: string;
  parameterCode: string;
  parameterName: string;
  value: number;
  unit?: string;
  lat?: number;
  lon?: number;
  retrievedAt: Date;
  sourceObservedAt?: Date;
}

export interface WaterQualityData {
  /** Legacy field. Contains only explicit potable advisories, never EPA or USGS inference. */
  alerts: WaterAlert[];
  systems: WaterSystem[];
  summary: {
    totalSystems: number;
    safeSystems: number;
    advisorySystems: number;
    doNotUseSystems: number;
    unknownSystems: number;
  };
  fetchedAt: Date;
  retrievedAt: Date;
  potableStatus: WaterAlertSeverity;
  potableAdvisories: WaterAlert[];
  complianceRecords: WaterAlert[];
  surfaceMeasurements: SurfaceWaterMeasurement[];
  sourceCoverage: {
    epaCompliance: 'available' | 'unavailable';
    usgsSurfaceWater: 'available' | 'unavailable';
    potableAdvisories: 'not-configured';
  };
  limitations: string[];
}

export interface NormalizedEpaCompliance {
  records: WaterAlert[];
  systems: WaterSystem[];
}

export interface WaterQualityBuildInput {
  retrievedAt: Date;
  epa: NormalizedEpaCompliance & { ok: boolean };
  usgs: { ok: boolean; measurements: SurfaceWaterMeasurement[] };
  potableAdvisories?: WaterAlert[];
}

export interface WaterQualityLocation {
  lat: number;
  lon: number;
  radiusKm?: number;
}

export interface WaterQualitySavedPlaceLike extends WaterQualityLocation {
  primary?: boolean;
}

/** Select one bounded location for the panel without merging unrelated places. */
export function selectWaterQualityLocation(
  places: readonly WaterQualitySavedPlaceLike[],
): WaterQualityLocation | undefined {
  const place = places.find((candidate) => candidate.primary) ?? places[0];
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)
    || place.lat < -90 || place.lat > 90 || place.lon < -180 || place.lon > 180) return undefined;
  const radiusKm = Number.isFinite(place.radiusKm)
    ? Math.max(1, Math.min(50, place.radiusKm ?? 25))
    : 25;
  return { lat: place.lat, lon: place.lon, radiusKm };
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const EPA_SOURCE_URL = 'https://echo.epa.gov/trends/comparative-maps-dashboards/drinking-water-dashboard';
const USGS_PARAMS = new Set(['00010', '00300', '00400', '00095', '00665', '00631']);
const cache = new Map<string, { data: WaterQualityData; fetchedAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value: unknown, max = 240): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validCoordinate(value: unknown, min: number, max: number): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= min && parsed <= max ? parsed : undefined;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isValidRfc3339CivilTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (!year || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (monthDays[month - 1] ?? 0);
}

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'unknown';
}

function boundedSourceDate(value: unknown, retrievedAt: Date): Date | null {
  if (typeof value !== 'string' || !isValidRfc3339CivilTime(value)) return null;
  const parsed = parseDate(value);
  if (!parsed) return null;
  return parsed.getTime() >= Math.max(Date.UTC(2000, 0, 1), retrievedAt.getTime() - 24 * 60 * 60 * 1000)
    && parsed.getTime() <= retrievedAt.getTime() + 5 * 60 * 1000
    ? parsed
    : null;
}

function parameterName(code: string, fallback?: string): string {
  return fallback ?? ({
    '00010': 'Water temperature',
    '00300': 'Dissolved oxygen',
    '00400': 'pH',
    '00095': 'Specific conductance',
    '00665': 'Total phosphorus',
    '00631': 'Nitrate plus nitrite',
  }[code] ?? `USGS parameter ${code}`);
}

function normalizeModernUsgs(raw: Record<string, unknown>, retrievedAt: Date): SurfaceWaterMeasurement[] {
  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) return [];
  const bySiteParameter = new Map<string, SurfaceWaterMeasurement>();
  for (const feature of raw.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) continue;
    const properties = feature.properties;
    const parameterCode = safeString(properties.parameter_code, 16);
    const siteCode = safeString(properties.monitoring_location_id, 48);
    const value = finiteNumber(properties.value);
    if (!parameterCode || !USGS_PARAMS.has(parameterCode) || !siteCode || value === undefined) continue;
    const sourceObservedAt = boundedSourceDate(properties.time, retrievedAt);
    if (!sourceObservedAt) continue;
    const geometry = isRecord(feature.geometry) && feature.geometry.type === 'Point'
      && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : [];
    const lon = validCoordinate(geometry[0], -180, 180);
    const lat = validCoordinate(geometry[1], -90, 90);
    if (lat === undefined || lon === undefined) continue;
    const measurement: SurfaceWaterMeasurement = {
      id: `usgs-surface:${stablePart(siteCode)}:${parameterCode}:${sourceObservedAt?.getTime() ?? retrievedAt.getTime()}`,
      source: 'usgs-surface-water', siteCode,
      siteName: safeString(properties.monitoring_location_name, 160) ?? siteCode,
      parameterCode, parameterName: parameterName(parameterCode), value,
      ...(safeString(properties.unit_of_measure, 40) ? { unit: safeString(properties.unit_of_measure, 40) } : {}),
      lat, lon, retrievedAt,
      ...(sourceObservedAt ? { sourceObservedAt } : {}),
    };
    const key = `${siteCode}:${parameterCode}`;
    const prior = bySiteParameter.get(key);
    if (!prior || (measurement.sourceObservedAt?.getTime() ?? 0) > (prior.sourceObservedAt?.getTime() ?? 0)) {
      bySiteParameter.set(key, measurement);
    }
  }
  return [...bySiteParameter.values()];
}

/** Normalize USGS surface-water telemetry without assigning potable-water meaning. */
export function normalizeUsgsSurfaceWaterResponse(raw: unknown, retrievedAt: Date): SurfaceWaterMeasurement[] {
  if (!isRecord(raw)) return [];
  if (raw.type === 'FeatureCollection') return normalizeModernUsgs(raw, retrievedAt);
  if (!isRecord(raw.value) || !Array.isArray(raw.value.timeSeries)) return [];
  const measurements: SurfaceWaterMeasurement[] = [];
  for (const item of raw.value.timeSeries) {
    if (!isRecord(item)) continue;
    const sourceInfo = isRecord(item.sourceInfo) ? item.sourceInfo : {};
    const variable = isRecord(item.variable) ? item.variable : {};
    const variableCodes = Array.isArray(variable.variableCode) ? variable.variableCode : [];
    const codeRecord = variableCodes.find(isRecord);
    const parameterCode = safeString(codeRecord?.value, 16);
    if (!parameterCode || !USGS_PARAMS.has(parameterCode)) continue;
    const valueGroups = Array.isArray(item.values) ? item.values : [];
    const firstGroup = valueGroups.find(isRecord);
    const readings = firstGroup && Array.isArray(firstGroup.value) ? firstGroup.value : [];
    const latest = readings
      .filter(isRecord)
      .map((reading) => ({
        reading,
        at: boundedSourceDate(reading.dateTime, retrievedAt),
      }))
      .filter((candidate) => candidate.at !== null)
      .sort((left, right) => (right.at?.getTime() ?? 0) - (left.at?.getTime() ?? 0))[0]?.reading;
    const value = latest ? finiteNumber(latest.value) : undefined;
    if (value === undefined) continue;
    const siteName = safeString(sourceInfo.siteName) ?? 'Unnamed USGS surface-water site';
    const siteCodes = Array.isArray(sourceInfo.siteCode) ? sourceInfo.siteCode : [];
    const siteCodeRecord = siteCodes.find(isRecord);
    const siteCode = safeString(siteCodeRecord?.value, 40);
    const displayParameterName = parameterName(parameterCode, safeString(variable.variableName));
    const unitRecord = isRecord(variable.unit) ? variable.unit : {};
    const unit = safeString(unitRecord.unitCode, 40);
    const geoLocation = isRecord(sourceInfo.geoLocation) ? sourceInfo.geoLocation : {};
    const geogLocation = isRecord(geoLocation.geogLocation) ? geoLocation.geogLocation : {};
    const lat = validCoordinate(geogLocation.latitude, -90, 90);
    const lon = validCoordinate(geogLocation.longitude, -180, 180);
    const sourceObservedAt = latest ? boundedSourceDate(latest.dateTime, retrievedAt) : null;
    measurements.push({
      id: `usgs-surface:${stablePart(siteCode ?? siteName)}:${parameterCode}:${sourceObservedAt?.getTime() ?? retrievedAt.getTime()}`,
      source: 'usgs-surface-water',
      ...(siteCode ? { siteCode } : {}),
      siteName,
      parameterCode,
      parameterName: displayParameterName,
      value,
      ...(unit ? { unit } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(lon !== undefined ? { lon } : {}),
      retrievedAt,
      ...(sourceObservedAt ? { sourceObservedAt } : {}),
    });
  }
  return measurements;
}

/** Normalize EPA compliance rows without translating them into live advisories. */
export function normalizeEpaComplianceResponse(raw: unknown): NormalizedEpaCompliance {
  if (!isRecord(raw) || !Array.isArray(raw.violations)) return { records: [], systems: [] };
  const records: WaterAlert[] = [];
  const systemMap = new Map<string, WaterSystem>();
  for (const item of raw.violations) {
    if (!isRecord(item) || item.is_health_based_ind !== 'Y') continue;
    const pwsid = safeString(item.pwsid, 32);
    const systemName = safeString(item.pws_name) ?? (pwsid ? `Public water system ${pwsid}` : undefined);
    const violationCode = safeString(item.violation_code, 32);
    const violationName = safeString(item.violation_name)
      ?? (violationCode ? `Violation code ${violationCode}` : undefined);
    if (!pwsid || !/^[a-z0-9-]{4,32}$/i.test(pwsid) || !systemName || !violationName) continue;
    const contaminantCode = safeString(item.contaminant_code, 32);
    const contaminant = safeString(item.contaminant_name)
      ?? (contaminantCode ? `code ${contaminantCode}` : undefined);
    const stateValue = safeString(item.state_code, 2) ?? '';
    const state = /^[A-Z]{2}$/.test(stateValue) ? stateValue : '';
    const sourceObservedAt = parseDate(item.compl_per_begin_date ?? item.compliance_begin_date);
    const population = typeof item.population_served_count === 'number'
      && Number.isSafeInteger(item.population_served_count) && item.population_served_count >= 0
      ? item.population_served_count : 0;
    records.push({
      id: `epa-compliance:${stablePart(pwsid)}:${stablePart(violationName)}:${sourceObservedAt?.getTime() ?? 'date-unknown'}`,
      type: 'general',
      severity: 'unknown',
      title: `EPA compliance record — ${violationName}`,
      description: `${contaminant ? `Contaminant or rule: ${contaminant}. ` : ''}This is compliance history, not a live boil-water or do-not-use notice. Check the water utility or local health department for current instructions.`,
      systemName,
      state,
      issuedAt: sourceObservedAt ?? new Date(0),
      expiresAt: null,
      evidenceKind: 'epa-compliance-history',
      sourceObservedAt,
      sourceUrl: EPA_SOURCE_URL,
    });
    const existing = systemMap.get(pwsid);
    if (existing) {
      existing.violations += 1;
    } else {
      systemMap.set(pwsid, {
        id: pwsid,
        name: systemName,
        state,
        populationServed: population,
        status: 'unknown',
        lat: null,
        lon: null,
        distanceKm: null,
        violations: 1,
        lastInspection: null,
        evidenceKind: 'epa-compliance-history',
      });
    }
  }
  return { records, systems: [...systemMap.values()] };
}

function potableStatusFromExplicitAdvisories(advisories: WaterAlert[]): WaterAlertSeverity {
  if (advisories.some((item) => item.evidenceKind === 'official-potable-advisory' && item.severity === 'do-not-use')) return 'do-not-use';
  if (advisories.some((item) => item.evidenceKind === 'official-potable-advisory' && item.severity === 'advisory')) return 'advisory';
  if (advisories.some((item) => item.evidenceKind === 'official-potable-advisory' && item.severity === 'safe')) return 'safe';
  return 'unknown';
}

export function buildWaterQualitySnapshot(input: WaterQualityBuildInput): WaterQualityData {
  const potableAdvisories = (input.potableAdvisories ?? [])
    .filter((item) => item.evidenceKind === 'official-potable-advisory');
  const systems = input.epa.systems.map((system) => ({ ...system, status: 'unknown' as const }));
  return {
    alerts: potableAdvisories,
    systems,
    summary: {
      totalSystems: systems.length,
      safeSystems: 0,
      advisorySystems: 0,
      doNotUseSystems: 0,
      unknownSystems: systems.length,
    },
    fetchedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    potableStatus: potableStatusFromExplicitAdvisories(potableAdvisories),
    potableAdvisories,
    complianceRecords: input.epa.records,
    surfaceMeasurements: input.usgs.measurements,
    sourceCoverage: {
      epaCompliance: input.epa.ok ? 'available' : 'unavailable',
      usgsSurfaceWater: input.usgs.ok ? 'available' : 'unavailable',
      potableAdvisories: 'not-configured',
    },
    limitations: [
      'EPA SDWIS compliance history and USGS surface-water sensors do not establish that tap water is safe.',
      'Live potable-water status is unknown until an explicit utility or public-health advisory is available.',
    ],
  };
}

function waterBbox(location: WaterQualityLocation): string | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)
    || location.lat < -90 || location.lat > 90 || location.lon < -180 || location.lon > 180) return null;
  const radiusKm = Math.max(5, Math.min(50, location.radiusKm ?? 25));
  const latDelta = Math.min(0.5, radiusKm / 111.32);
  const lonDelta = Math.min(0.5, radiusKm / (111.32 * Math.max(0.2, Math.cos(location.lat * Math.PI / 180))));
  const west = Math.max(-180, location.lon - lonDelta);
  const east = Math.min(180, location.lon + lonDelta);
  const south = Math.max(-90, location.lat - latDelta);
  const north = Math.min(90, location.lat + latDelta);
  return [west, south, east, north].map((value) => value.toFixed(6)).join(',');
}

async function fetchUsgs(location: WaterQualityLocation | undefined, retrievedAt: Date): Promise<{ ok: boolean; measurements: SurfaceWaterMeasurement[] }> {
  const bbox = location ? waterBbox(location) : null;
  if (!bbox) return { ok: false, measurements: [] };
  const url = `${getApiBaseUrl()}/api/usgs-water-proxy?bbox=${encodeURIComponent(bbox)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) return { ok: false, measurements: [] };
    const raw: unknown = await response.json().catch(() => null);
    if (!isRecord(raw) || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
      return { ok: false, measurements: [] };
    }
    const measurements = normalizeUsgsSurfaceWaterResponse(raw, retrievedAt);
    return { ok: raw.features.length === 0 || measurements.length > 0, measurements };
  } catch {
    return { ok: false, measurements: [] };
  }
}

async function fetchEpa(): Promise<NormalizedEpaCompliance & { ok: boolean }> {
  // EPA's global VIOLATION table is not a bounded local feed and its dates are
  // compliance history, not live advisories. Keep the adapter unavailable
  // until a jurisdiction/utility identifier can scope an official query.
  return { ok: false, records: [], systems: [] };
}

export async function fetchWaterQuality(location?: WaterQualityLocation): Promise<WaterQualityData> {
  const bbox = location ? waterBbox(location) : null;
  const cacheKey = bbox ?? 'no-location';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  const retrievedAt = new Date();
  const [usgs, epa] = await Promise.all([fetchUsgs(location, retrievedAt), fetchEpa()]);
  const data = buildWaterQualitySnapshot({ retrievedAt, epa, usgs });
  const itemCount = data.complianceRecords.length + data.surfaceMeasurements.length;
  if (itemCount > 0) {
    dataFreshness.recordUpdate('water-quality', itemCount);
    if (!cache.has(cacheKey) && cache.size >= 50) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { data, fetchedAt: retrievedAt.getTime() });
  } else {
    dataFreshness.recordError('water-quality', epa.ok || usgs.ok
      ? 'Water sources returned no contributed rows'
      : 'EPA compliance and USGS surface-water sources unavailable');
  }
  return data;
}
