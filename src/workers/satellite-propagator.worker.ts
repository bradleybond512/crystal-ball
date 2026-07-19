/**
 * Satellite SGP4 Propagation Web Worker
 *
 * Receives TLE data, propagates all satellite positions at 1Hz,
 * and posts position arrays back to the main thread.
 */
/* eslint-disable no-console -- worker thread has no localStorage, so logDebug is unavailable; console is the only diagnostic sink here */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  eciToEcf,
  ecfToLookAngles,
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

interface PassLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt?: number;
}

type WorkerMessage =
  | { type: 'loadTLEs'; tles: TLEInput[] }
  | { type: 'requestOrbitPath'; request: OrbitPathRequest }
  | { type: 'stop' }
  | { type: 'computePasses'; satellites: TLEInput[]; locations: PassLocation[]; durationHours: number };

let tles: TLEInput[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;
let consecutivePropagateFailures = 0;
const MAX_PROPAGATE_FAILURES = 5;

function propagateAll(): void {
  try {
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
  consecutivePropagateFailures = 0;
  } catch (error) {
    consecutivePropagateFailures += 1;
    console.warn('[satellite-worker] propagateAll error', error);
    // Per-satellite errors are already skipped above, so a throw here is a
    // systemic failure. After repeated failures, rethrow so it surfaces as an
    // uncaught worker error and the main thread restarts us instead of this
    // 1Hz loop logging forever.
    if (consecutivePropagateFailures >= MAX_PROPAGATE_FAILURES) {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      throw error;
    }
  }
}

function computeOrbitPath(req: OrbitPathRequest): void {
  try {
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
  } catch (error) {
    console.warn('[satellite-worker] computeOrbitPath failed for noradId', req.noradId, error);
    self.postMessage({ type: 'orbitPath', noradId: req.noradId, points: [] });
  }
}

interface PassRecord {
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

interface PassState {
  inPass: boolean;
  riseTime: number;
  maxEl: number;
  maxElTime: number;
}

function getElevationDeg(satrec: ReturnType<typeof twoline2satrec>, t: Date, gmst: number, observerGd: { longitude: number; latitude: number; height: number }): number | null {
  const posVel = propagate(satrec, t);
  if (!posVel.position || typeof posVel.position === 'boolean') return null;
  const ecf = eciToEcf(posVel.position, gmst);
  const lookAngles = ecfToLookAngles(observerGd, ecf);
  return lookAngles.elevation * (180 / Math.PI);
}

function applyPassStep(state: PassState, elDeg: number, tMs: number, minElevation: number, sat: TLEInput, loc: PassLocation, passes: PassRecord[]): void {
  if (elDeg >= minElevation && !state.inPass) {
    state.inPass = true;
    state.riseTime = tMs;
    state.maxEl = elDeg;
    state.maxElTime = tMs;
  } else if (elDeg >= minElevation) {
    if (elDeg > state.maxEl) {
      state.maxEl = elDeg;
      state.maxElTime = tMs;
    }
  } else if (state.inPass) {
    state.inPass = false;
    passes.push({
      satelliteId: String(sat.noradId),
      satelliteName: sat.name,
      locationId: loc.id,
      locationName: loc.name,
      riseTime: state.riseTime,
      maxElevationTime: state.maxElTime,
      setTime: tMs,
      maxElevation: Math.round(state.maxEl * 10) / 10,
      duration: Math.round((tMs - state.riseTime) / 1000),
    });
  }
}

function computePassesForSatLoc(satrec: ReturnType<typeof twoline2satrec>, sat: TLEInput, loc: PassLocation, totalSteps: number, stepMs: number, minElevation: number, passes: PassRecord[], startMs: number): void {
  const observerGd = {
    longitude: loc.lon * (Math.PI / 180),
    latitude: loc.lat * (Math.PI / 180),
    height: (loc.alt ?? 0) / 1000,
  };
  const state: PassState = { inPass: false, riseTime: 0, maxEl: 0, maxElTime: 0 };

  for (let step = 0; step <= totalSteps; step++) {
    const t = new Date(startMs + step * stepMs);
    const gmst = gstime(t);
    const elDeg = getElevationDeg(satrec, t, gmst, observerGd);
    if (elDeg === null) continue;
    applyPassStep(state, elDeg, t.getTime(), minElevation, sat, loc, passes);
  }

  // Flush an open pass at the window boundary so we don't drop a partial pass
  if (state.inPass) {
    const endMs = startMs + totalSteps * stepMs;
    passes.push({
      satelliteId: String(sat.noradId),
      satelliteName: sat.name,
      locationId: loc.id,
      locationName: loc.name,
      riseTime: state.riseTime,
      maxElevationTime: state.maxElTime,
      setTime: endMs,
      maxElevation: Math.round(state.maxEl * 10) / 10,
      duration: Math.round((endMs - state.riseTime) / 1000),
    });
  }
}

async function computePasses(
  satellites: TLEInput[],
  locations: PassLocation[],
  durationHours: number,
): Promise<void> {
  const passes: PassRecord[] = [];
  const stepMs = 30_000;
  const totalSteps = Math.floor((durationHours * 3_600_000) / stepMs);
  const minElevation = 10;
  const startMs = Date.now();

  for (const [i, satellite] of satellites.entries()) {
    const sat = satellite!;
    try {
      const satrec = twoline2satrec(sat.line1, sat.line2);
      for (const loc of locations) {
        computePassesForSatLoc(satrec, sat, loc, totalSteps, stepMs, minElevation, passes, startMs);
      }
    } catch {
      // Skip satellites with bad TLEs
    }
    // Yield every 10 satellites so the 1Hz position update interval keeps firing
    if (i % 10 === 9) await new Promise<void>(r => setTimeout(r, 0));
  }
  self.postMessage({ type: 'passes', passes });
}

self.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
  // Workers receive messages only from their owning page; origin is always empty string.
  if (e.origin !== '' && e.origin !== self.location.origin) return;
  try {
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

  if (msg.type === 'computePasses') {
 void computePasses(msg.satellites, msg.locations, msg.durationHours);
  }

  if (msg.type === 'stop') {
 if (intervalId != null) clearInterval(intervalId);
 intervalId = null;
 tles = [];
  }
  } catch (error) {
    // Per-request errors are caught inside computeOrbitPath/computePasses, so a
    // throw reaching here is systemic. Log then rethrow so it surfaces as an
    // uncaught worker error and the main thread restarts us, rather than
    // silently continuing in a broken state.
    console.error('[satellite-worker] unhandled message error', error);
    throw error;
  }
});
