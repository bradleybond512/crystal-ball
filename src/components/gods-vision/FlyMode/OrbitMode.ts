import { Cartesian3, Matrix4, type Viewer } from 'cesium';

const ORBIT_SPEED_RAD_PER_S = 0.15;

export class OrbitMode {
  private rafId: number | null = null;
  private orbitAngle = 0;
  private target: Cartesian3 | null = null;
  private orbitRadius = 50_000;
  private lastTime = 0;

  constructor(private viewer: Viewer) {}

  activate(): void {
 const cam = this.viewer.camera;
 const carto = cam.positionCartographic;
 this.target = Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
 this.orbitRadius = Cartesian3.distance(cam.positionWC, this.target);
 this.orbitAngle = cam.heading;
 this.lastTime = performance.now();
 this.loop();
  }

  deactivate(): void {
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.target = null;
 // Release look-at lock
 this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }

  update(dt: number): void { if (dt) { /* no-op: driven by own RAF */ } }

  private loop(): void {
 this.rafId = requestAnimationFrame((now) => {
 const dt = Math.min((now - this.lastTime) / 1000, 0.1);
 this.lastTime = now;
 if (!this.target) return;
 this.orbitAngle += ORBIT_SPEED_RAD_PER_S * dt;
 const target = this.target;
 const normal = Cartesian3.normalize(target, new Cartesian3());
 const up = new Cartesian3(0, 0, 1);
 const east = Cartesian3.normalize(
 Cartesian3.cross(up, normal, new Cartesian3()), new Cartesian3()
 );
 const north = Cartesian3.cross(normal, east, new Cartesian3());
 const camPos = Cartesian3.add(
 Cartesian3.add(
 Cartesian3.multiplyByScalar(east, Math.sin(this.orbitAngle) * this.orbitRadius, new Cartesian3()),
 Cartesian3.multiplyByScalar(north, Math.cos(this.orbitAngle) * this.orbitRadius, new Cartesian3()),
 new Cartesian3(),
 ),
 Cartesian3.multiplyByScalar(normal, this.orbitRadius * 0.4, new Cartesian3()),
 new Cartesian3(),
 );
 this.viewer.camera.lookAt(target, camPos);
 this.loop();
 });
  }
}
