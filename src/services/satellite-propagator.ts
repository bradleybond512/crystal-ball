/**
 * Satellite Propagator — main-thread API wrapping the SGP4 Web Worker
 *
 * Sends TLE data to the worker, receives position updates at 1Hz,
 * and dispatches them to registered listeners.
 */

import type { SatelliteTLE } from '@/services/satellite-catalog';
import { logDebug } from './reasoning-debug';

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
  private _lastCatalog: SatelliteTLE[] | null = null;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _restartCount = 0;
  private static readonly MAX_RESTARTS = 5;

  start(catalog: SatelliteTLE[]): void {
 this._lastCatalog = catalog;
 this.stop();

 this.worker = new Worker(
 new URL('@/workers/satellite-propagator.worker.ts', import.meta.url),
 { type: 'module' },
 );

 // If the worker crashes (malformed TLE, satellite.js exception), terminate it
 // immediately — so it can't post stale results during the gap — then restart
 // after 5s, capped so a deterministically-crashing catalog can't loop forever.
 this.worker.addEventListener('error', (e: ErrorEvent) => {
   if (this.worker) { this.worker.terminate(); this.worker = null; }
   if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
   if (this._restartCount >= SatellitePropagator.MAX_RESTARTS) {
     logDebug({ level: 'error', category: 'other', source: 'satellite-propagator',
       message: 'worker crashed too many times — giving up restarts',
       data: { error: e.message, restarts: this._restartCount } });
     return;
   }
   this._restartCount += 1;
   logDebug({ level: 'error', category: 'other', source: 'satellite-propagator',
     message: 'worker error — restarting in 5s', data: { error: e.message, attempt: this._restartCount } });
   this._restartTimer = setTimeout(() => {
     this._restartTimer = null;
     if (this._lastCatalog) this.start(this._lastCatalog);
   }, 5000);
 });

 this.worker.addEventListener('message', (e: MessageEvent) => {
 const msg = e.data as { type: string; positions?: SatellitePosition[]; noradId?: number; points?: [number, number, number][]; passes?: SatellitePass[] };

 if (msg.type === 'positions' && msg.positions) {
 this._restartCount = 0; // worker is producing output again — clear the crash budget
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
 if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
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
