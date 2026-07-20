/**
 * Satellite Propagator — main-thread API wrapping the SGP4 Web Worker
 *
 * Sends TLE data to the worker, receives position updates at 1Hz,
 * and dispatches them to registered listeners.
 */

import type { SatelliteTLE } from '@/services/satellite-catalog';

export interface SatellitePosition {
  noradId: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKmS: number;
}

export interface OrbitPath {
  noradId: number;
  points: [number, number, number][]; // [lon, lat, altKm]
}

export interface SatellitePass {
  satelliteId: string;
  satelliteName: string;
  locationId: string;
  locationName: string;
  riseTime: number;
  maxElevationTime: number;
  setTime: number;
  maxElevation: number;
  duration: number;
}

type PositionListener = (positions: SatellitePosition[]) => void;
type OrbitPathListener = (path: OrbitPath) => void;
type PassListener = (passes: SatellitePass[]) => void;

class SatellitePropagator {
  private worker: Worker | null = null;
  private positionListeners: PositionListener[] = [];
  private orbitPathListeners: OrbitPathListener[] = [];
  private passListeners: PassListener[] = [];
  private latestPositions: SatellitePosition[] = [];

  start(catalog: SatelliteTLE[]): void {
 this.stop();

 this.worker = new Worker(
 new URL('@/workers/satellite-propagator.worker.ts', import.meta.url),
 { type: 'module' },
 );

 this.worker.addEventListener('message', (e: MessageEvent) => {
 const msg = e.data as { type: string; positions?: SatellitePosition[]; noradId?: number; points?: [number, number, number][]; passes?: SatellitePass[] };

 if (msg.type === 'positions' && msg.positions) {
 this.latestPositions = msg.positions;
 for (const listener of this.positionListeners) {
 listener(msg.positions);
 }
 }

 if (msg.type === 'orbitPath' && msg.noradId != null && msg.points) {
 const path: OrbitPath = { noradId: msg.noradId, points: msg.points };
 for (const listener of this.orbitPathListeners) {
 listener(path);
 }
 }

 if (msg.type === 'passes' && msg.passes) {
 for (const listener of this.passListeners) {
 listener(msg.passes);
 }
 }
 });

 // If the SGP4 worker crashes (e.g. malformed TLE data, OOM), position updates
 // stop silently without this handler — callers keep seeing stale coordinates.
 // Restart the worker so listeners recover on the next TLE refresh cycle.
 this.worker.addEventListener('error', (e: ErrorEvent) => {
 console.error('[SatProp] Worker crashed — restarting on next TLE load:', e.message);
 if (this.worker) {
 this.worker.terminate();
 this.worker = null;
 }
 this.latestPositions = [];
 });

 this.worker.postMessage({
 type: 'loadTLEs',
 tles: catalog.map(s => ({
 noradId: s.noradId,
 name: s.name,
 line1: s.line1,
 line2: s.line2,
 })),
 });
  }

  stop(): void {
 if (this.worker) {
 this.worker.postMessage({ type: 'stop' });
 this.worker.terminate();
 this.worker = null;
 }
 this.latestPositions = [];
  }

  requestOrbitPath(satellite: SatelliteTLE, durationMinutes = 90): void {
 this.worker?.postMessage({
 type: 'requestOrbitPath',
 request: {
 noradId: satellite.noradId,
 line1: satellite.line1,
 line2: satellite.line2,
 durationMinutes,
 },
 });
  }

  onPositions(listener: PositionListener): () => void {
 this.positionListeners.push(listener);
 return () => {
 this.positionListeners = this.positionListeners.filter(l => l !== listener);
 };
  }

  onOrbitPath(listener: OrbitPathListener): () => void {
 this.orbitPathListeners.push(listener);
 return () => {
 this.orbitPathListeners = this.orbitPathListeners.filter(l => l !== listener);
 };
  }

  requestPasses(satellites: SatelliteTLE[], locations: { id: string; name: string; lat: number; lon: number; alt?: number }[], durationHours = 6): void {
 this.worker?.postMessage({
 type: 'computePasses',
 satellites: satellites.map(s => ({
 noradId: s.noradId,
 name: s.name,
 line1: s.line1,
 line2: s.line2,
 })),
 locations,
 durationHours,
 });
  }

  onPasses(listener: PassListener): () => void {
 this.passListeners.push(listener);
 return () => {
 this.passListeners = this.passListeners.filter(l => l !== listener);
 };
  }

  getLatestPositions(): SatellitePosition[] {
 return this.latestPositions;
  }
}

export const satellitePropagator = new SatellitePropagator();
