/**
 * Threat Convergence Service
 *
 * Aggregates geo-tagged events from multiple domains (conflicts, weather,
 * cyber, outages, earthquakes, protests, military) into spatial convergence
 * zones. When 3+ different signal types cluster within the same 1° grid cell
 * in a 24-hour window, a convergence ring is emitted.
 *
 * Consumes data from geo-convergence.ts cells and enriches with
 * domain-diversity scoring and severity weighting.
 */

import { type GeoEventType } from './geo-convergence';

export interface ConvergenceZone {
  id: string;
  lat: number;
  lon: number;
  /** Number of distinct signal domains present */
  domainCount: number;
  /** Total event count across all domains */
  totalEvents: number;
  /** 0–100 composite score = domainCount × diversity × severity */
  score: number;
  /** Contributing signal types */
  domains: GeoEventType[];
  /** Last event timestamp */
  lastSeen: number;
  /** Outer ring radius in meters (proportional to score) */
  radiusM: number;
  /** RGBA fill color */
  color: [number, number, number, number];
  /** RGBA ring color */
  ringColor: [number, number, number, number];
}

// ── Spatial Grid ─────────────────────────────────────────────────────────────

interface CellEntry {
  lat: number;
  lon: number;
  domains: Map<string, { count: number; lastSeen: number }>;
}

const grid = new Map<string, CellEntry>();
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_DOMAINS = 2;

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat)},${Math.floor(lon)}`;
}

export function ingestConvergenceEvent(
  lat: number,
  lon: number,
  domain: string,
  timestamp = Date.now(),
): void {
  const key = cellKey(lat, lon);
  let cell = grid.get(key);
  if (!cell) {
 cell = { lat: Math.floor(lat) + 0.5, lon: Math.floor(lon) + 0.5, domains: new Map() };
 grid.set(key, cell);
  }
  const existing = cell.domains.get(domain);
  cell.domains.set(domain, {
 count: (existing?.count ?? 0) + 1,
 lastSeen: Math.max(existing?.lastSeen ?? 0, timestamp),
  });
}

function prune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, cell] of grid) {
 for (const [domain, data] of cell.domains) {
 if (data.lastSeen < cutoff) cell.domains.delete(domain);
 }
 if (cell.domains.size === 0) grid.delete(key);
  }
}

// ── Score & Color ────────────────────────────────────────────────────────────

function scoreToColor(score: number): [number, number, number, number] {
  if (score >= 80) return [255, 40, 40, 55];
  if (score >= 60) return [255, 120, 20, 45];
  if (score >= 40) return [230, 190, 30, 35];
  return [60, 140, 255, 25];
}

function scoreToRingColor(score: number): [number, number, number, number] {
  if (score >= 80) return [255, 60, 60, 200];
  if (score >= 60) return [255, 140, 40, 180];
  if (score >= 40) return [240, 210, 50, 160];
  return [80, 160, 255, 120];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getConvergenceZones(): ConvergenceZone[] {
  prune();

  const zones: ConvergenceZone[] = [];
  for (const [id, cell] of grid) {
 if (cell.domains.size < MIN_DOMAINS) continue;

 const domainCount = cell.domains.size;
 let totalEvents = 0;
 let lastSeen = 0;
 const domainNames: GeoEventType[] = [];

 for (const [name, data] of cell.domains) {
 totalEvents += data.count;
 lastSeen = Math.max(lastSeen, data.lastSeen);
 domainNames.push(name as GeoEventType);
 }

 // Score: domain diversity is the main driver, boosted by total event count
 const diversityScore = Math.min(100, domainCount * 25);
 const volumeBoost = Math.min(20, Math.log2(totalEvents + 1) * 5);
 const score = Math.min(100, Math.round(diversityScore + volumeBoost));

 // Radius proportional to score: 30km base → 150km at score 100
 const radiusM = 30_000 + (score / 100) * 120_000;

 zones.push({
 id,
 lat: cell.lat,
 lon: cell.lon,
 domainCount,
 totalEvents,
 score,
 domains: domainNames,
 lastSeen,
 radiusM,
 color: scoreToColor(score),
 ringColor: scoreToRingColor(score),
 });
  }

  // Sort by score descending
  zones.sort((a, b) => b.score - a.score);
  return zones;
}

/** Reset all convergence data (for testing) */
export function resetConvergence(): void {
  grid.clear();
}
