import {
  Cartesian3, Color, CustomDataSource, Entity,
  PointGraphics, ConstantProperty, ConstantPositionProperty, LabelGraphics,
  Cartesian2, type Viewer,
} from 'cesium';
import * as satellite from 'satellite.js';
import { getApiBaseUrl } from '@/services/runtime';

interface TleEntry { name: string; line1: string; line2: string }

function parseTles(text: string): TleEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
 const name = lines[i] ?? '';
 const line1 = lines[i + 1] ?? '';
 const line2 = lines[i + 2] ?? '';
 result.push({ name, line1, line2 });
  }
  return result;
}

export class GlobeSatellites {
  private source: CustomDataSource;
  private tles: TleEntry[] = [];
  private rafId: number | null = null;
  private enabled = false;
  private destroyed = false;

  constructor(private viewer: Viewer) {
 this.source = new CustomDataSource('satellites');
  }

  async mount(): Promise<void> {
 await this.viewer.dataSources.add(this.source);
 await this.fetchTles();
  }

  destroy(): void {
 this.destroyed = true;
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.viewer.dataSources.remove(this.source, true);
  }

  setEnabled(on: boolean): void {
 this.enabled = on;
 this.source.show = on;
 if (on) {
 this.propagateLoop();
 } else {
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 }
  }

  private async fetchTles(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/tle`);
 if (!res.ok) return;
 const text = await res.text();
 this.tles = parseTles(text);
 this.rebuildEntities();
 } catch { /* silent */ }
  }

  private rebuildEntities(): void {
 this.source.entities.removeAll();
 for (const tle of this.tles) {
 this.source.entities.add(new Entity({
 id: tle.name,
 point: new PointGraphics({
 pixelSize: new ConstantProperty(4),
 color: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
 outlineColor: new ConstantProperty(Color.BLACK),
 outlineWidth: new ConstantProperty(1),
 }),
 label: new LabelGraphics({
 text: new ConstantProperty(tle.name.trim()),
 font: new ConstantProperty('10px monospace'),
 fillColor: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
 pixelOffset: new ConstantProperty(new Cartesian2(8, 0)),
 show: new ConstantProperty(true),
 }),
 }));
 }
  }

  private propagateLoop(): void {
 if (!this.enabled || this.destroyed) return;
 this.rafId = requestAnimationFrame(() => {
 if (this.destroyed) return;
 this.propagate();
 this.propagateLoop();
 });
  }

  private propagate(): void {
 const now = new Date();
 for (const tle of this.tles) {
 try {
 const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
 const posVel = satellite.propagate(satrec, now);
 if (!posVel?.position) continue;
 const gmst = satellite.gstime(now);
 const geo = satellite.eciToGeodetic(posVel.position as satellite.EciVec3<number>, gmst);
 const lat = satellite.degreesLat(geo.latitude);
 const lon = satellite.degreesLong(geo.longitude);
 const alt = geo.height * 1000;
 const entity = this.source.entities.getById(tle.name);
 if (entity) {
 entity.position = new ConstantPositionProperty(Cartesian3.fromDegrees(lon, lat, alt));
 }
 } catch { /* bad TLE */ }
 }
  }
}
