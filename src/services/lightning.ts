/**
 * Lightning detection — Blitzortung.org
 *
 * Uses the public Blitzortung tile server for lightning density maps.
 * No API key required. Tiles update every ~5 minutes.
 * Also provides a polling-based strike feed for recent individual strikes.
 *
 * Tile URL pattern: https://map.blitzortung.org/GETjson.php
 * We use the tile overlay for map visualization.
 */

import { dataFreshness } from './data-freshness';

export interface LightningStrike {
  lat: number;
  lon: number;
  time: number; // Unix ms
  intensity: number;  // kA (kiloamperes)
}

const STRIKES_URL = 'https://map.blitzortung.org/GETjson.php';
const CACHE_TTL_MS = 2 * 60 * 1000;

let cache: { strikes: LightningStrike[]; fetchedAt: number } | null = null;

interface BlitzStrike {
  lat: number;
  lon: number;
  time: number;  // nanoseconds
  sig: number;
}

export async function fetchLightningStrikes(): Promise<LightningStrike[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.strikes;

  try {
 const res = await fetch(STRIKES_URL, {
 signal: AbortSignal.timeout(8000),
 headers: { Accept: 'application/json' },
 });
 if (!res.ok) {
 dataFreshness.recordError('lightning', `HTTP ${res.status}`);
 return cache?.strikes ?? [];
 }

 const data = await res.json() as BlitzStrike[];
 if (!Array.isArray(data)) {
 dataFreshness.recordError('lightning', 'malformed response');
 return cache?.strikes ?? [];
 }

 const strikes: LightningStrike[] = data.slice(0, 500).map(s => ({
 lat: s.lat,
 lon: s.lon,
 time: Math.floor(s.time / 1_000_000),
 intensity: Math.abs(s.sig),
 }));

 cache = { strikes, fetchedAt: Date.now() };
 dataFreshness.recordUpdate('lightning', strikes.length);
 return strikes;
  } catch (error) {
 dataFreshness.recordError('lightning', String(error));
 return cache?.strikes ?? [];
  }
}

/** Blitzortung tile URL for DeckGL/Cesium tile layers — density heatmap */
export function getLightningTileUrl(): string {
  const now = Math.floor(Date.now() / 1000);
  return `https://map.blitzortung.org/Maps/Standard/index.php?interactive=0&NavigationStandard=0&TileLayer=1&timestamp=${String(now)}&z={z}&x={x}&y={y}`;
}

/** Age-based opacity for strike visualization (fades over 30 minutes) */
export function strikeOpacity(strikeTimeMs: number): number {
  const ageMs = Date.now() - strikeTimeMs;
  const maxAge = 30 * 60 * 1000;
  if (ageMs >= maxAge) return 0;
  return 1 - ageMs / maxAge;
}

/** Strike intensity to color (yellow → orange → red) */
export function strikeColor(intensity: number): [number, number, number] {
  if (intensity > 100) return [255, 50, 50];
  if (intensity > 50) return [255, 150, 0];
  return [255, 255, 50];
}
