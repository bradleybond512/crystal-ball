import {
  Cartesian3, Color, CustomDataSource, Entity,
  PolylineGraphics, ArcType, ConstantProperty, type Viewer,
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
 this.source.entities.add(new Entity({
 polyline: new PolylineGraphics({
 positions: new ConstantProperty([
 Cartesian3.fromDegrees(c.lon, c.lat),
 Cartesian3.fromDegrees(nearest.lon, nearest.lat),
 ]),
 width: new ConstantProperty(1.5),
 material: Color.fromCssColorString('#f87171').withAlpha(0.5),
 arcType: ArcType.GEODESIC,
 clampToGround: true,
 }),
 }));
 }
  }
}
