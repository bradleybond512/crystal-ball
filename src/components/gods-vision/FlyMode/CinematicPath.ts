import {
  Cartesian3,
  CatmullRomSpline,
  type Viewer,
} from 'cesium';
import type { FollowTarget } from '@/components/gods-vision/AutoFollowEngine';

// Altitude band for cinematic waypoints (meters above sea level)
const WAYPOINT_ALT_MIN = 600_000;
const WAYPOINT_ALT_MAX = 2_500_000;

// Seconds per waypoint along the spline
const SECS_PER_WAYPOINT = 10;

// How far ahead (in spline-time units) to look for the direction vector
const LOOK_AHEAD = 0.15;

export class CinematicPath {
  private viewer: Viewer;
  private spline: CatmullRomSpline | null = null;
  private splineMax = 1;
  private t = 0;
  private totalSecs = 60;

  constructor(viewer: Viewer, targets: FollowTarget[]) {
 this.viewer = viewer;
 this.buildSpline(targets);
  }

  private buildSpline(targets: FollowTarget[]): void {
 if (targets.length < 2) return;

 // Scatter waypoints at varied altitudes for a dynamic feel
 const points: Cartesian3[] = targets.map((tgt, i) => {
 const frac = i / (targets.length - 1);
 const alt = WAYPOINT_ALT_MIN + frac * (WAYPOINT_ALT_MAX - WAYPOINT_ALT_MIN);
 return Cartesian3.fromDegrees(tgt.lon, tgt.lat, alt);
 });

 // Close the loop so the camera cycles indefinitely
 points.push(points[0]!);

 const times = points.map((_, i) => i);
 this.spline = new CatmullRomSpline({ times, points });
 this.splineMax = times[times.length - 1]!;
 this.totalSecs = targets.length * SECS_PER_WAYPOINT;

 // Start from current camera position if possible — find nearest point
 this.t = 0;
  }

  update(dt: number): void {
 if (!this.spline) return;

 // Advance along spline, loop back at the end
 this.t += (dt / this.totalSecs) * this.splineMax;
 if (this.t >= this.splineMax) this.t = 0;

 const pos = this.spline.evaluate(this.t, new Cartesian3());

 // Look-ahead direction for smooth heading
 const aheadT = Math.min(this.t + LOOK_AHEAD, this.splineMax - 0.01);
 const ahead = this.spline.evaluate(aheadT, new Cartesian3());

 const dir = Cartesian3.subtract(ahead, pos, new Cartesian3());
 if (Cartesian3.magnitudeSquared(dir) < 1) return; // degenerate
 Cartesian3.normalize(dir, dir);

 // "Up" = radial away from Earth center — gives free natural banking on turns
 const radialUp = Cartesian3.normalize(Cartesian3.clone(pos), new Cartesian3());

 // Reorthogonalize up against direction so the frame is orthonormal
 const right = Cartesian3.cross(dir, radialUp, new Cartesian3());
 if (Cartesian3.magnitudeSquared(right) < 1e-10) return; // near-degenerate
 Cartesian3.normalize(right, right);
 const up = Cartesian3.cross(right, dir, new Cartesian3());
 Cartesian3.normalize(up, up);

 this.viewer.camera.setView({
 destination: pos,
 orientation: { direction: dir, up },
 });
  }

  destroy(): void {
 this.spline = null;
  }
}
