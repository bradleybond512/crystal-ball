/**
 * NOAA Storm Prediction Center (SPC) Convective Outlooks + Iowa State LSR Storm Reports
 * SPC Day 1 GeoJSON: https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson
 * SPC Day 2 GeoJSON: https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson
 * Iowa State LSR: https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=24
 */

import { dataFreshness } from '@/services/data-freshness';
import type { StormReportBatch } from './intelligence/outcome-resolvers';

export type ConvectiveRisk = 'TSTM' | 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';

export interface ConvectiveOutlook {
  id: string;
  day: 1 | 2;
  risk: ConvectiveRisk;
  label: string;
  coordinates: [number, number][][]; // polygon rings
  centroid?: [number, number];
  validTime: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface StormReport {
  id: string;
  type: 'tornado' | 'hail' | 'wind' | 'flooding' | 'other';
  magnitude: string;
  location: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  reportedAt: Date;
  remarks: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface SpcSummary {
  outlooks: ConvectiveOutlook[];
  reports: StormReport[];
  reportCoverage: StormReportCoverage;
  fetchedAt: Date;
  maxRisk: ConvectiveRisk | null;
}

export interface StormReportCoverage {
  fetchedAt: number;
  coverageStart: number;
  coverageEnd: number;
  complete: boolean;
}

export interface StormReportParseResult extends StormReportCoverage {
  items: StormReport[];
}

const SPC_DAY1_URL = 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson';
const SPC_DAY2_URL = 'https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson';
const LSR_URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=24';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const LSR_COVERAGE_MS = 24 * 60 * 60 * 1000;
export const MAX_STORM_REPORT_ROWS = 2000;

let outlooksCache: { items: ConvectiveOutlook[]; fetchedAt: number } | null = null;
let reportsCache: StormReportParseResult | null = null;

// Risk rank for ordering/severity
const RISK_RANK: Record<ConvectiveRisk, number> = {
  TSTM: 1,
  MRGL: 2,
  SLGT: 3,
  ENH: 4,
  MDT: 5,
  HIGH: 6,
};

const VALID_RISKS = new Set<string>(['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH']);

function riskSeverity(risk: ConvectiveRisk): ConvectiveOutlook['severity'] {
  if (risk === 'HIGH' || risk === 'MDT') return 'critical';
  if (risk === 'ENH') return 'high';
  if (risk === 'SLGT') return 'medium';
  return 'low'; // MRGL, TSTM
}

function computeCentroid(rings: [number, number][][]): [number, number] | undefined {
  const ring = rings[0];
  if (!ring || ring.length === 0) return undefined;
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of ring) {
 sumLon += lon;
 sumLat += lat;
  }
  return [sumLon / ring.length, sumLat / ring.length];
}

function extractRings(geometry: { type: string; coordinates: unknown }): [number, number][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
 return (geometry.coordinates as [number, number][][]) ?? [];
  }
  if (geometry.type === 'MultiPolygon') {
 const polys = (geometry.coordinates as [number, number][][][]) ?? [];
 // Flatten to array of rings
 return polys.flat();
  }
  return [];
}

async function fetchOutlookDay(day: 1 | 2): Promise<ConvectiveOutlook[]> {
  const url = day === 1 ? SPC_DAY1_URL : SPC_DAY2_URL;
  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) return [];
 const json = await res.json() as {
 features?: {
 properties?: { DN?: string; LABEL?: string; LABEL2?: string; VALID?: string; EXPIRE?: string };
 geometry?: { type: string; coordinates: unknown };
 }[];
 };
 if (!json || typeof json !== 'object') return [];
 const features = json.features ?? [];
 const results: ConvectiveOutlook[] = [];
 for (const [i, f] of features.entries()) {
 if (!f) continue;
 const props = f.properties ?? {};
 const dn = (props.DN ?? '').trim().toUpperCase();
 if (!VALID_RISKS.has(dn)) continue;
 const risk = dn as ConvectiveRisk;
 const coordinates = extractRings(f.geometry as { type: string; coordinates: unknown });
 if (coordinates.length === 0) continue;
 results.push({
 id: `spc-d${day}-${risk}-${i}`,
 day,
 risk,
 label: convectiveRiskLabel(risk),
 coordinates,
 centroid: computeCentroid(coordinates),
 validTime: props.VALID ?? props.EXPIRE ?? '',
 severity: riskSeverity(risk),
 });
 }
 return results;
  } catch {
 return [];
  }
}

export async function fetchSpcOutlooks(): Promise<ConvectiveOutlook[]> {
  if (outlooksCache && Date.now() - outlooksCache.fetchedAt < CACHE_TTL_MS) {
 return outlooksCache.items;
  }

  const [day1Result, day2Result] = await Promise.allSettled([
 fetchOutlookDay(1),
 fetchOutlookDay(2),
  ]);

  const items: ConvectiveOutlook[] = [
 ...(day1Result.status === 'fulfilled' ? day1Result.value : []),
 ...(day2Result.status === 'fulfilled' ? day2Result.value : []),
  ];

  // Sort by severity descending
  items.sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk]);

  outlooksCache = { items, fetchedAt: Date.now() };
  dataFreshness.recordUpdate('spc-outlook', items.length);
  return items;
}

function lsrTypeName(typeCode: string): StormReport['type'] {
  // Current IEM codes are defined in pyiem.reference.lsr_events.
  const c = typeCode.trim().toUpperCase();
  if (c === 'T' || c === 'W') return 'tornado';
  if (c === 'H') return 'hail';
  if (c === 'B' || c === 'D' || c === 'G' || c === 'M') return 'wind';
  if (c === 'E' || c === 'F') return 'flooding';
  return 'other';
}

function lsrSeverity(type: StormReport['type']): StormReport['severity'] {
  if (type === 'tornado') return 'critical';
  if (type === 'flooding') return 'high';
  if (type === 'hail' || type === 'wind') return 'medium';
  return 'low';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function parseStormReportFeature(
  value: unknown,
  index: number,
  fetchedAt: number,
): StormReport | null {
  if (!isRecord(value) || value.type !== 'Feature') return null;
  const properties = value.properties;
  const geometry = value.geometry;
  if (!isRecord(properties) || !isRecord(geometry) || geometry.type !== 'Point') {
    return null;
  }
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon: unknown = coordinates[0];
  const lat: unknown = coordinates[1];
  if (
    typeof lon !== 'number'
    || !Number.isFinite(lon)
    || lon < -180
    || lon > 180
    || typeof lat !== 'number'
    || !Number.isFinite(lat)
    || lat < -90
    || lat > 90
  ) {
    return null;
  }
  const typeCode = properties.type;
  const valid = properties.valid;
  if (
    typeof typeCode !== 'string'
    || typeCode.length === 0
    || typeCode.length > 32
    || typeof valid !== 'string'
  ) {
    return null;
  }
  const reportedAtMs = Date.parse(valid);
  if (
    !Number.isFinite(reportedAtMs)
    || reportedAtMs > fetchedAt + 5 * 60 * 1000
  ) {
    return null;
  }
  const type = lsrTypeName(typeCode);
  const magnitudeValue = properties.magnitude;
  let magnitude = '';
  if (typeof magnitudeValue === 'string') {
    magnitude = magnitudeValue.slice(0, 64);
  } else if (
    typeof magnitudeValue === 'number'
    && Number.isFinite(magnitudeValue)
  ) {
    magnitude = String(magnitudeValue);
  }
  return {
    id: `lsr-${index}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    type,
    magnitude,
    location: boundedText(properties.city, 128),
    county: boundedText(properties.county, 128),
    state: boundedText(properties.state, 32),
    lat,
    lon,
    reportedAt: new Date(reportedAtMs),
    remarks: boundedText(properties.remark, 1000),
    severity: lsrSeverity(type),
  };
}

export function parseStormReportPayload(
  payload: unknown,
  fetchedAt: number,
  coverageEnd: number = fetchedAt,
): StormReportParseResult {
  const safeFetchedAt = Number.isFinite(fetchedAt) ? fetchedAt : 0;
  const safeCoverageEnd = Number.isFinite(coverageEnd)
    && coverageEnd <= safeFetchedAt
    ? coverageEnd
    : safeFetchedAt;
  const base = {
    fetchedAt: safeFetchedAt,
    coverageStart: safeCoverageEnd - LSR_COVERAGE_MS,
    coverageEnd: safeCoverageEnd,
  };
  if (
    !Number.isFinite(fetchedAt)
    || !isRecord(payload)
    || payload.type !== 'FeatureCollection'
    || !Array.isArray(payload.features)
  ) {
    return { items: [], ...base, complete: false };
  }
  const truncated = payload.features.length > MAX_STORM_REPORT_ROWS;
  let complete = !truncated;
  const items: StormReport[] = [];
  for (const [index, feature] of payload.features
    .slice(0, MAX_STORM_REPORT_ROWS)
    .entries()) {
    const report = parseStormReportFeature(feature, index, fetchedAt);
    if (report) items.push(report);
    else complete = false;
  }
  const severityOrder: Record<StormReport['severity'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  items.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
    || a.reportedAt.getTime() - b.reportedAt.getTime());
  return { items, ...base, complete };
}

export function toStormReportBatch(
  snapshot: StormReportParseResult,
): StormReportBatch {
  return {
    reports: snapshot.items.map((report) => ({
      id: report.id,
      type: report.type,
      lat: report.lat,
      lon: report.lon,
      reportedAt: report.reportedAt.getTime(),
    })),
    fetchedAt: snapshot.fetchedAt,
    coverageStart: snapshot.coverageStart,
    coverageEnd: snapshot.coverageEnd,
    complete: snapshot.complete,
  };
}

export function getLatestStormReportBatch(): StormReportBatch | null {
  return reportsCache ? toStormReportBatch(reportsCache) : null;
}

async function fetchStormReportSnapshot(): Promise<StormReportParseResult> {
  if (reportsCache && Date.now() - reportsCache.fetchedAt < CACHE_TTL_MS) {
    return reportsCache;
  }

  try {
    const coverageEnd = Date.now();
    const res = await fetch(LSR_URL, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      dataFreshness.recordError('spc-outlook', `LSR HTTP ${res.status}`);
      return reportsCache ?? incompleteStormReportSnapshot(Date.now());
    }
    const fetchedAt = Date.now();
    const parsed = parseStormReportPayload(
      await res.json(),
      fetchedAt,
      coverageEnd,
    );
    reportsCache = parsed;
    dataFreshness.recordUpdate('spc-outlook', parsed.items.length);
    return parsed;
  } catch (error) {
    dataFreshness.recordError('spc-outlook', String(error));
    return reportsCache ?? incompleteStormReportSnapshot(Date.now());
  }
}

function incompleteStormReportSnapshot(now: number): StormReportParseResult {
  return {
    items: [],
    fetchedAt: now,
    coverageStart: now,
    coverageEnd: now,
    complete: false,
  };
}

export async function fetchStormReports(): Promise<StormReport[]> {
  const snapshot = await fetchStormReportSnapshot();
  return snapshot.items;
}

export async function fetchSpcSummary(): Promise<SpcSummary> {
  const [outlooks, reportSnapshot] = await Promise.all([
 fetchSpcOutlooks(),
 fetchStormReportSnapshot(),
  ]);

  let maxRisk: ConvectiveRisk | null = null;
  for (const o of outlooks) {
 if (maxRisk === null || RISK_RANK[o.risk] > RISK_RANK[maxRisk]) {
 maxRisk = o.risk;
 }
  }

 return {
 outlooks,
 reports: reportSnapshot.items,
 reportCoverage: {
 fetchedAt: reportSnapshot.fetchedAt,
 coverageStart: reportSnapshot.coverageStart,
 coverageEnd: reportSnapshot.coverageEnd,
 complete: reportSnapshot.complete,
 },
 fetchedAt: new Date(),
 maxRisk,
  };
}

export function convectiveRiskLabel(risk: ConvectiveRisk): string {
  const labels: Record<ConvectiveRisk, string> = {
 TSTM: 'Thunderstorm',
 MRGL: 'Marginal',
 SLGT: 'Slight',
 ENH: 'Enhanced',
 MDT: 'Moderate',
 HIGH: 'High',
  };
  return labels[risk] ?? risk;
}

export function spcSeverityClass(severity: string): string {
  return (
 {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
 }[severity] ?? 'eq-row'
  );
}
