import {
  Cartesian3, Color, ColorMaterialProperty, CustomDataSource, CallbackProperty,
  EllipseGraphics, ConstantPositionProperty, Entity,
  HeightReference,
  type Viewer,
} from 'cesium';
import { timeCoherentRadius } from '@/services/globe/time-coherent-radius';
import type { GlobeDataManager } from '@/components/GlobeDataManager';
import { isAppActive, onActivityChange } from '@/services/app-activity';

const PULSE_DURATION_MS = 3000;
const PULSE_MAX_RADIUS_M = 80_000;

interface PulseEntry { entityId: string; startMs: number; cesiumEntity: Entity }

export class GlobePulse {
  private source: CustomDataSource;
  private pulses: PulseEntry[] = [];
  private rafId: number | null = null;
  private destroyed = false;
  private unsubActivity: (() => void) | null = null;

  constructor(private viewer: Viewer, private dataManager: GlobeDataManager) {
 this.source = new CustomDataSource('pulses');
  }

  mount(): void {
 this.viewer.dataSources.add(this.source).catch(() => { /* intentional */ });
 this.tick();
 this.unsubActivity = onActivityChange((active) => {
 if (active && !this.destroyed) this.tick();
 });
  }

  destroy(): void {
 this.unsubActivity?.();
 this.unsubActivity = null;
 this.destroyed = true;
 if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
 this.viewer.dataSources.remove(this.source, true);
  }

  private tick(): void {
 if (!isAppActive()) return;
 this.rafId = requestAnimationFrame(() => {
 if (this.destroyed) return;
 this.refreshPulses();
 this.tick();
 });
  }

  private refreshPulses(): void {
 const freshAlerts = this.dataManager.getTopAlerts(20).filter(
 a => a.lat !== undefined && a.lon !== undefined,
 );

 const tracked = new Set(this.pulses.map(p => p.entityId));
 for (const alert of freshAlerts) {
 const id = `${alert.type}:${alert.name}`;
 if (tracked.has(id)) continue;
 if (alert.lat === undefined || alert.lon === undefined) continue;
 const pos = Cartesian3.fromDegrees(alert.lon, alert.lat, 0);
 const startMs = Date.now();
 // Time-coherent so both ellipse axes read the same value per frame — a raw
 // CallbackProperty can grow between the semiMajor/semiMinor reads and throw
 // "semiMajorAxis must be >= semiMinorAxis", halting the render loop.
 const radiusCb = timeCoherentRadius(() => {
 const t = (Date.now() - startMs) % PULSE_DURATION_MS;
 return (t / PULSE_DURATION_MS) * PULSE_MAX_RADIUS_M;
 });
 const pulse: PulseEntry = {
 entityId: id,
 startMs,
 cesiumEntity: this.source.entities.add(new Entity({
 position: new ConstantPositionProperty(pos),
 ellipse: new EllipseGraphics({
 semiMajorAxis: radiusCb,
 semiMinorAxis: radiusCb,
 material: new ColorMaterialProperty(new CallbackProperty(() => {
 const t = (Date.now() - startMs) % PULSE_DURATION_MS;
 const alpha = 0.5 * (1 - t / PULSE_DURATION_MS);
 return Color.fromCssColorString('#60a5fa').withAlpha(alpha);
 }, false)),
 outline: false,
 height: 0,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 }),
 })),
 };
 this.pulses.push(pulse);
 }

 const freshIds = new Set(freshAlerts.map(a => `${a.type}:${a.name}`));
 this.pulses = this.pulses.filter(p => {
 if (!freshIds.has(p.entityId)) {
 this.source.entities.remove(p.cesiumEntity);
 return false;
 }
 return true;
 });
  }
}
