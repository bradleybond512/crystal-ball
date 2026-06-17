/**
 * RainViewer — free global weather radar composite tiles
 *
 * Source: https://www.rainviewer.com/api.html
 * No API key required. Covers global NEXRAD/OPERA/JMA/BOM radar composites.
 * Returns past radar frames (up to 2 hours) + short-term forecast frames.
 * Tiles are 256x256 PNG in standard web mercator (z/x/y).
 */

import { dataFreshness } from '@/services/data-freshness';

export interface RadarFrame {
  path: string;
  time: number;  // Unix epoch seconds
  type: 'past' | 'forecast';
}

export interface RadarState {
  host: string;
  frames: RadarFrame[];
  currentIndex: number;
}

const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { state: RadarState; fetchedAt: number } | null = null;

interface RainViewerResponse {
  host: string;
  radar: {
 past: { path: string; time: number }[];
 nowcast: { path: string; time: number }[];
  };
}

export async function fetchRadarFrames(): Promise<RadarState> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.state;

  try {
 const res = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
 if (!res.ok) throw new Error(`RainViewer HTTP ${String(res.status)}`);

 const data = await res.json() as RainViewerResponse;
 if (!data || typeof data !== 'object' || !data.radar) throw new Error('RainViewer unexpected response shape');

 const frames: RadarFrame[] = [
 ...( Array.isArray(data.radar.past) ? data.radar.past : []).map(f => ({ path: f.path, time: f.time, type: 'past' as const })),
 ...(Array.isArray(data.radar.nowcast) ? data.radar.nowcast : []).map(f => ({ path: f.path, time: f.time, type: 'forecast' as const })),
 ];

 const state: RadarState = {
 host: data.host,
 frames,
 currentIndex: data.radar.past.length - 1,
 };

 cache = { state, fetchedAt: Date.now() };
 dataFreshness.recordUpdate('rainviewer-radar', frames.length);
 return state;
  } catch (error) {
 dataFreshness.recordError('rainviewer-radar', String(error));
 throw error;
  }
}

export function getRadarTileUrl(state: RadarState, frameIndex?: number): string {
  const idx = frameIndex ?? state.currentIndex;
  const frame = state.frames[idx];
  if (!frame) return '';
  return `${state.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

export function getRadarFrameTime(state: RadarState, frameIndex?: number): Date {
  const idx = frameIndex ?? state.currentIndex;
  const frame = state.frames[idx];
  return frame ? new Date(frame.time * 1000) : new Date();
}
