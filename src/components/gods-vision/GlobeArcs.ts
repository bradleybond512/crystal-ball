import {
  Cartesian3, Cartographic, Color, ColorMaterialProperty, CustomDataSource, Entity,
  PolylineGraphics, ArcType, ConstantProperty, type Viewer,
  Math as CesiumMath,
} from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
 Math.sin(dLat / 2) ** 2 +
 Math.cos((lat1 * Math.PI) / 180) *
 Math.cos((lat2 * Math.PI) / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function densifyGeodesic(p0: Cartesian3, p1: Cartesian3, maxDeg = 2): Cartesian3[] {
  const c0 = Cartographic.fromCartesian(p0);
  const c1 = Cartographic.fromCartesian(p1);
  const dLon = Math.abs(CesiumMath.toDegrees(c1.longitude - c0.longitude));
  const dLat = Math.abs(CesiumMath.toDegrees(c1.latitude - c0.latitude));
  const steps = Math.max(1, Math.ceil(Math.max(dLon, dLat) / maxDeg));
  const result: Cartesian3[] = [p0];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    result.push(Cartesian3.fromRadians(
 CesiumMath.lerp(c0.longitude, c1.longitude, t),
 CesiumMath.lerp(c0.latitude, c1.latitude, t),
 0,
    ));
  }
  return result;
}

export class GlobeArcs {
  private source: CustomDataSource;
  private refreshId: number | null = null;

  constructor(private viewer: Viewer, private dataManager: GlobeDataManager) {
 this.source = new CustomDataSource('arcs');
  }

  mount(): void { this.viewer.dataSources.add(this.source).catch(() => { /* intentional */ }); }

  destroy(): void {
 if (this.refreshId != null) { clearInterval(this.refreshId); this.refreshId = null; }
 this.viewer.dataSources.remove(this.source, true);
  }

  setEnabled(on: boolean): void {
 this.source.show = on;
 if (on) {
 this.rebuild();
 this.refreshId = window.setInterval(() => this.rebuild(), 30_000);
 } else {
 if (this.refreshId != null) { clearInterval(this.refreshId); this.refreshId = null; }
 this.source.entities.removeAll();
 }
  }

  private rebuild(): void {
 this.source.entities.removeAll();
 const alerts = this.dataManager.getTopAlerts(40).filter(
 a => a.lat !== undefined && a.lon !== undefined,
 );
 const conflicts = alerts.filter(a => ['conflicts', 'airstrikes'].includes(a.type));
 const disasters = alerts.filter(a => ['earthquakes', 'gdacs', 'cyclones'].includes(a.type));

 for (const c of conflicts.slice(0, 10)) {
 if (c.lat === undefined || c.lon === undefined) continue;
 let nearest: (typeof disasters)[0] | null = null;
 let nearestDist = 2000;
 for (const d of disasters) {
 if (d.lat === undefined || d.lon === undefined) continue;
 const dist = haversineKm(c.lat, c.lon, d.lat, d.lon);
 if (dist < nearestDist) { nearest = d; nearestDist = dist; }
 }
 if (nearest?.lat === undefined || nearest.lon === undefined) continue;
 const p0 = Cartesian3.fromDegrees(c.lon, c.lat);
 const p1 = Cartesian3.fromDegrees(nearest.lon, nearest.lat);
 this.source.entities.add(new Entity({
 polyline: new PolylineGraphics({
 positions: new ConstantProperty(densifyGeodesic(p0, p1)),
 width: new ConstantProperty(1.5),
 material: new ColorMaterialProperty(Color.fromCssColorString('#f87171').withAlpha(0.5)),
 arcType: ArcType.NONE,
 }),
 }));
 }
  }
}
