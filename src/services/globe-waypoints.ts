import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium';
import type { CameraBookmark } from './camera-bookmarks';
import { safeSetItem } from '../utils/safe-storage';

const STORAGE_KEY = 'crystalball-waypoints';

export interface Waypoint extends CameraBookmark {
  id: string;
  name: string;
}

export function loadWaypoints(): Waypoint[] {
  try {
 return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Waypoint[];
  } catch { return []; }
}

export function saveWaypoint(wp: Waypoint): void {
  const all = loadWaypoints().filter(w => w.id !== wp.id);
  all.push(wp);
  safeSetItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteWaypoint(id: string): void {
  const all = loadWaypoints().filter(w => w.id !== id);
  safeSetItem(STORAGE_KEY, JSON.stringify(all));
}

export class WaypointTour {
  private waypoints: Waypoint[];
  private idx = 0;
  private running = false;
  private timeoutId: number | null = null;

  constructor(private viewer: Viewer, private dwellMs = 5000) {
 this.waypoints = loadWaypoints();
  }

  start(): void {
 if (this.waypoints.length === 0) return;
 this.running = true;
 this.flyNext();
  }

  stop(): void {
 this.running = false;
 if (this.timeoutId != null) { clearTimeout(this.timeoutId); this.timeoutId = null; }
  }

  private flyNext(): void {
 if (!this.running || this.waypoints.length === 0) return;
 const wp = this.waypoints[this.idx % this.waypoints.length];
 if (!wp) return;
 this.viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt),
 orientation: {
 heading: CesiumMath.toRadians(wp.heading),
 pitch: CesiumMath.toRadians(wp.pitch),
 roll: 0,
 },
 duration: 3,
 complete: () => {
 this.timeoutId = window.setTimeout(() => {
 this.idx++;
 this.flyNext();
 }, this.dwellMs);
 },
 });
  }
}
