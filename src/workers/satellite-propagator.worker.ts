/**
 * Satellite SGP4 Propagation Web Worker
 *
 * Receives TLE data, propagates all satellite positions at 1Hz,
 * and posts position arrays back to the main thread.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
} from 'satellite.js';

interface TLEInput {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
}

interface SatellitePosition {
  noradId: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKmS: number;
}

interface OrbitPathRequest {
  noradId: number;
  line1: string;
  line2: string;
  durationMinutes: number;
}

type WorkerMessage =
  | { type: 'loadTLEs'; tles: TLEInput[] }
  | { type: 'requestOrbitPath'; request: OrbitPathRequest }
  | { type: 'stop' };

let tles: TLEInput[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;

function propagateAll(): void {
  const now = new Date();
  const gmst = gstime(now);
  const positions: SatellitePosition[] = [];

  for (const tle of tles) {
 try {
 const satrec = twoline2satrec(tle.line1, tle.line2);
 const result = propagate(satrec, now);
 const posEci = result.position;
 const velEci = result.velocity;
 const geo = eciToGeodetic(posEci, gmst);

 let velocity = 0;
 if (velEci) {
 velocity = Math.hypot(velEci.x, velEci.y, velEci.z);
 }

 const latDeg = geo.latitude * (180 / Math.PI);
 const lonDeg = geo.longitude * (180 / Math.PI);
 const altKm = geo.height;

 positions.push({
 noradId: tle.noradId,
 lat: latDeg,
 lon: lonDeg,
 altKm,
 velocityKmS: velocity,
 });
 } catch {
 // Skip satellites with bad TLEs
 }
  }

  self.postMessage({ type: 'positions', positions });
}

function computeOrbitPath(req: OrbitPathRequest): void {
  const satrec = twoline2satrec(req.line1, req.line2);
  const points: [number, number, number][] = [];
  const now = Date.now();
  const stepMs = 60_000; // 1-minute steps
  const steps = req.durationMinutes;

  for (let i = 0; i <= steps; i++) {
 const time = new Date(now + i * stepMs);
 const gmst = gstime(time);
 const result = propagate(satrec, time);
 const geo = eciToGeodetic(result.position, gmst);
 points.push([
 geo.longitude * (180 / Math.PI),
 geo.latitude * (180 / Math.PI),
 geo.height,
 ]);
  }

  self.postMessage({ type: 'orbitPath', noradId: req.noradId, points });
}

self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  // Workers receive messages only from their owning page; origin is always empty string.
  if (e.origin !== '' && e.origin !== self.location.origin) return;

  const msg = e.data;

  if (msg.type === 'loadTLEs') {
 tles = msg.tles;
 if (intervalId != null) clearInterval(intervalId);
 propagateAll();
 intervalId = setInterval(propagateAll, 1000);
  }

  if (msg.type === 'requestOrbitPath') {
 computeOrbitPath(msg.request);
  }

  if (msg.type === 'stop') {
 if (intervalId != null) clearInterval(intervalId);
 intervalId = null;
 tles = [];
  }
});
