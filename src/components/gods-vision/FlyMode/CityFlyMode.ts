import type { Viewer } from 'cesium';
import { Cartesian3 } from 'cesium';
import { FreeFlyCamera } from './FreeFlyCamera';
import type { BuildingTileManager } from '@/services/building-tiles';

// Minimum altitude when in city mode (meters) — below terrain sampling kicks in
const CITY_MIN_ALT = 5;

export class CityFlyMode extends FreeFlyCamera {
  private buildingTiles: BuildingTileManager;
  private originalMinZoom = 1500;

  constructor(viewer: Viewer, canvas: HTMLCanvasElement, buildingTiles: BuildingTileManager) {
 super(viewer, canvas);
 this.buildingTiles = buildingTiles;
  }

  override activate(): void {
 // Lower zoom floor so you can fly between buildings
 const ctrl = this.viewer.scene.screenSpaceCameraController;
 this.originalMinZoom = ctrl.minimumZoomDistance;
 ctrl.minimumZoomDistance = CITY_MIN_ALT;

 // Try to load Google Photorealistic 3D Tiles, fall back to Cesium OSM Buildings
 void this.buildingTiles.forceTier(1).then((loaded) => {
 if (!loaded) void this.buildingTiles.forceTier(2);
 });

 // Fly down to a closer altitude if currently high up
 const camera = this.viewer.camera;
 const alt = camera.positionCartographic.height;
 if (alt > 50_000) {
 const carto = camera.positionCartographic;
 camera.flyTo({
 destination: Cartesian3.fromRadians(carto.longitude, carto.latitude, 2000),
 duration: 3,
 });
 }

 super.activate();
  }

  override deactivate(): void {
 // Restore minimum zoom
 const ctrl = this.viewer.scene.screenSpaceCameraController;
 ctrl.minimumZoomDistance = this.originalMinZoom;

 super.deactivate();
  }

  override update(dt: number): void {
 super.update(dt);
 this.clampToGround();
  }

  private clampToGround(): void {
 const camera = this.viewer.camera;
 const alt = camera.positionCartographic.height;
 if (alt < CITY_MIN_ALT) {
 // Nudge camera back up to minimum
 camera.moveUp(CITY_MIN_ALT - alt);
 }
  }
}
