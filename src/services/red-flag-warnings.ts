/**
 * Red Flag / Fire Weather Warnings — SPC + NWS
 *
 * Sources:
 *  - SPC Fire Weather Outlook Day 1: GeoJSON polygons with risk levels
 *  - NWS active fire weather alerts
 *
 * Both are free, no API key required.
 */

import { createCircuitBreaker } from '@/utils';
import { rehydrateDate } from '@/services/cache-hydration';
import { fetchWithContext } from '@/services/fetch-with-context';

export interface FireWeatherOutlook {
  riskLevel: FireWeatherRisk;
  label: string;
  coordinates: [number, number][][];
  issueTime: string;
}

export type FireWeatherRisk = 'elevated' | 'critical' | 'extreme';

export interface RedFlagWarning {
  id: string;
  event: string;
  headline: string;
  areaDesc: string;
  severity: string;
  onset: Date;
  expires: Date;
  centroid?: [number, number];
}

const NWS_FIRE_URL = 'https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning,Fire%20Weather%20Watch';

const outlookBreaker = createCircuitBreaker<FireWeatherOutlook[]>({
  name: 'SPC-FireWx',
  cacheTtlMs: 30 * 60 * 1000,
});

const warningBreaker = createCircuitBreaker<RedFlagWarning[]>({
  name: 'NWS-RedFlag',
  cacheTtlMs: 10 * 60 * 1000,
  persistCache: true,
});

interface NWSAlertProps {
  id: string;
  properties: {
 event: string;
 headline: string;
 areaDesc: string;
 severity: string;
 onset: string;
 expires: string;
  };
  geometry?: {
 type: string;
 coordinates: number[][][] | number[][];
  };
}

export async function fetchRedFlagWarnings(): Promise<RedFlagWarning[]> {
  const warnings = await warningBreaker.execute(async () => {
 const res = await fetchWithContext('NWS red flag warnings', NWS_FIRE_URL, {
 headers: { 'User-Agent': 'CrystalBall/1.0' },
 signal: AbortSignal.timeout(10_000),
 });
 if (!res.ok) throw new Error(`NWS HTTP ${String(res.status)}`);

 const data = await res.json() as { features: NWSAlertProps[] };
 if (!data || !Array.isArray(data.features)) throw new Error('NWS unexpected response shape');

 return data.features.slice(0, 50).map(f => ({
 id: f.id,
 event: f.properties.event,
 headline: f.properties.headline ?? '',
 areaDesc: f.properties.areaDesc ?? '',
 severity: f.properties.severity,
 onset: new Date(f.properties.onset),
 expires: new Date(f.properties.expires),
 centroid: extractCentroid(f.geometry),
 }));
  }, []);
  return warnings.map(warning => ({
    ...warning,
    onset: rehydrateDate(warning.onset),
    expires: rehydrateDate(warning.expires),
  }));
}

export async function fetchFireWeatherOutlook(): Promise<FireWeatherOutlook[]> {
  return outlookBreaker.execute(async () => {
 // SPC publishes fire weather outlooks as GeoJSON Day 1
 const url = 'https://www.spc.noaa.gov/products/fire_wx/day1otlk_fire.lyr.geojson';
 const res = await fetchWithContext('SPC fire weather outlook', url, {
 signal: AbortSignal.timeout(10_000),
 });
 if (!res.ok) return [];

 const data = await res.json() as {
 features: {
 properties: { LABEL: string; ISSUE: string };
 geometry: { coordinates: number[][][][] | number[][][] };
 }[];
 };
 if (!data || !Array.isArray(data.features)) return [];

 return data.features.map(f => ({
 riskLevel: riskFromLabel(f.properties.LABEL),
 label: f.properties.LABEL,
 coordinates: normalizeCoords(f.geometry.coordinates),
 issueTime: f.properties.ISSUE ?? '',
 }));
  }, []);
}

function riskFromLabel(label: string): FireWeatherRisk {
  const l = label.toLowerCase();
  if (l.includes('extreme')) return 'extreme';
  if (l.includes('critical')) return 'critical';
  return 'elevated';
}

function normalizeCoords(coords: number[][][][] | number[][][]): [number, number][][] {
  if (!coords.length) return [];
  const first = coords[0];
  if (!first?.length) return [];
  const inner = first[0];
  if (!inner) return [];
  // MultiPolygon vs Polygon
  if (Array.isArray(inner[0])) {
 return (coords as number[][][][]).map(poly => {
 const ring = poly[0];
 return ring ? ring.map(c => [c[0] ?? 0, c[1] ?? 0] as [number, number]) : [];
 });
  }
  return [(first as number[][]).map(c => [c[0] ?? 0, c[1] ?? 0] as [number, number])];
}

function extractCentroid(geometry?: NWSAlertProps['geometry']): [number, number] | undefined {
  if (!geometry) return undefined;
  try {
 const flat = (geometry.coordinates as unknown as number[]).flat(Number.POSITIVE_INFINITY) as number[];
 const pairs: number[][] = [];
 for (let i = 0; i < flat.length - 1; i += 2) {
 pairs.push([flat[i] ?? 0, flat[i + 1] ?? 0]);
 }
 if (pairs.length === 0) return undefined;
 const sumLon = pairs.reduce((s, p) => s + (p[0] ?? 0), 0);
 const sumLat = pairs.reduce((s, p) => s + (p[1] ?? 0), 0);
 return [sumLon / pairs.length, sumLat / pairs.length];
  } catch {
 return undefined;
  }
}

export function riskColor(risk: FireWeatherRisk): string {
  const colors: Record<FireWeatherRisk, string> = {
 elevated: '#f97316',
 critical: '#ef4444',
 extreme: '#7c2d12',
  };
  return colors[risk];
}
