import {
  Cartesian3,
  Matrix3,
  Quaternion,
  type Viewer,
  type Entity,
  type JulianDate,
} from 'cesium';

// Chase offset in entity ENU frame (meters): behind = -Y, above = +Z
const CHASE_BEHIND_M = 400;
const CHASE_ABOVE_M = 80;

// Spring factor for position smoothing (higher = snappier)
const SPRING = 4;

export class ChaseCamera {
  private viewer: Viewer;
  private target: Entity | null = null;
  private cockpitMode = false;
  private lastForward = Cartesian3.clone(Cartesian3.UNIT_X);
  private lastPos: Cartesian3 | null = null;

  constructor(viewer: Viewer) {
 this.viewer = viewer;
  }

  attachToEntity(entity: Entity): void {
 this.target = entity;
 this.lastPos = null;
  }

  detach(): void {
 this.target = null;
 this.lastPos = null;
  }

  toggleCockpit(): void {
 this.cockpitMode = !this.cockpitMode;
  }

  get isCockpit(): boolean {
 return this.cockpitMode;
  }

  update(dt: number, time: JulianDate): void {
 if (!this.target) return;

 const pos = this.target.position?.getValue(time) as Cartesian3 | undefined;
 if (!pos) return;

 if (this.cockpitMode) {
 this.updateCockpit(pos, time);
 } else {
 this.updateChase(pos, dt);
 }

 this.lastPos = Cartesian3.clone(pos);
  }

  private updateCockpit(pos: Cartesian3, time: JulianDate): void {
 const orientation = this.target?.orientation?.getValue(time) as Quaternion | undefined;

 if (orientation && Number.isFinite(orientation.x)) {
 // Entity's rotation in ECEF: column 0 = right, column 1 = forward, column 2 = up
 const m3 = Matrix3.fromQuaternion(orientation, new Matrix3());
 const dir = Matrix3.getColumn(m3, 1, new Cartesian3());
 const up = Matrix3.getColumn(m3, 2, new Cartesian3());
 Cartesian3.normalize(dir, dir);
 Cartesian3.normalize(up, up);

 this.viewer.camera.setView({
 destination: pos,
 orientation: { direction: dir, up },
 });
 } else {
 // No orientation — face the entity's travel direction
 const forward = this.computeForward(pos);
 const radialUp = Cartesian3.normalize(Cartesian3.clone(pos), new Cartesian3());
 const right = Cartesian3.cross(forward, radialUp, new Cartesian3());
 Cartesian3.normalize(right, right);
 const up = Cartesian3.cross(right, forward, new Cartesian3());
 Cartesian3.normalize(up, up);

 this.viewer.camera.setView({
 destination: pos,
 orientation: { direction: forward, up },
 });
 }
  }

  private updateChase(pos: Cartesian3, dt: number): void {
 const forward = this.computeForward(pos);

 // Chase position: behind the entity by CHASE_BEHIND_M in forward direction, CHASE_ABOVE_M up
 const radialUp = Cartesian3.normalize(Cartesian3.clone(pos), new Cartesian3());

 const behindVec = Cartesian3.multiplyByScalar(forward, -CHASE_BEHIND_M, new Cartesian3());
 const aboveVec = Cartesian3.multiplyByScalar(radialUp, CHASE_ABOVE_M, new Cartesian3());
 const targetChasePos = Cartesian3.add(
 Cartesian3.add(pos, behindVec, new Cartesian3()),
 aboveVec,
 new Cartesian3(),
 );

 // Spring-damp toward target chase position
 const currentPos = this.viewer.camera.position;
 const lerpFactor = Math.min(1, dt * SPRING);
 const smoothPos = Cartesian3.lerp(currentPos, targetChasePos, lerpFactor, new Cartesian3());

 // Look from chase position toward entity
 const dir = Cartesian3.subtract(pos, smoothPos, new Cartesian3());
 if (Cartesian3.magnitudeSquared(dir) < 1) return;
 Cartesian3.normalize(dir, dir);

 // Reorthogonalize up
 const right = Cartesian3.cross(dir, radialUp, new Cartesian3());
 if (Cartesian3.magnitudeSquared(right) < 1e-10) return;
 Cartesian3.normalize(right, right);
 const up = Cartesian3.cross(right, dir, new Cartesian3());
 Cartesian3.normalize(up, up);

 this.viewer.camera.setView({
 destination: smoothPos,
 orientation: { direction: dir, up },
 });
  }

  private computeForward(pos: Cartesian3): Cartesian3 {
 if (this.lastPos) {
 const delta = Cartesian3.subtract(pos, this.lastPos, new Cartesian3());
 if (Cartesian3.magnitudeSquared(delta) > 0.01) {
 this.lastForward = Cartesian3.normalize(delta, new Cartesian3());
 }
 }
 return this.lastForward;
  }
}

