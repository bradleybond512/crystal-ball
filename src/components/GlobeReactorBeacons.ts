import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  type Viewer,
} from 'cesium';
import { timeCoherentRadius } from '@/services/globe/time-coherent-radius';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface ReactorAlertDetail {
  lat: number;
  lon: number;
  severity: Severity;
  title: string;
  alertId: string;
}

const BEACON_TTL_MS = 5 * 60 * 1000;
const PULSE_PERIOD_MS = 2000;
const PULSE_MAX_RADIUS_M = 50_000;

function severityColor(severity: Severity): Color {
  switch (severity) {
 case 'high': { return Color.fromCssColorString('#ff6600');
 }
 case 'medium': { return Color.fromCssColorString('#ffaa00');
 }
 case 'low': { return Color.fromCssColorString('#ffdd00');
 }
 default: { return Color.fromCssColorString('#ff0033');
 }
  }
}

function pulseRadius(): number {
  const t = (Date.now() % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  return t * PULSE_MAX_RADIUS_M;
}

export class GlobeReactorBeacons {
  private viewer: Viewer;
  private dataSource: CustomDataSource | null = null;
  private entities = new Map<string, Entity>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private mounted = false;

  constructor(viewer: Viewer) {
 this.viewer = viewer;
  }

  mount(): void {
 if (this.mounted) return;
 this.mounted = true;
 this.dataSource = new CustomDataSource('cyber-reactor-beacons');
 void this.viewer.dataSources.add(this.dataSource);
 window.addEventListener('wm:cyber-reactor-alert', this.handleAlert);
  }

  destroy(): void {
 if (!this.mounted) return;
 this.mounted = false;
 window.removeEventListener('wm:cyber-reactor-alert', this.handleAlert);
 for (const t of this.timeouts.values()) clearTimeout(t);
 this.timeouts.clear();
 this.entities.clear();
 if (this.dataSource) {
 this.viewer.dataSources.remove(this.dataSource, true);
 this.dataSource = null;
 }
  }

  flyTo(alertId: string): boolean {
 const entity = this.entities.get(alertId);
 if (!entity) return false;
 void this.viewer.flyTo(entity, { duration: 2 });
 return true;
  }

  private handleAlert = (e: Event): void => {
 const detail = (e as CustomEvent<ReactorAlertDetail>).detail;
 if (!detail) return;
 const { lat, lon, severity, title, alertId } = detail;
 if (
 typeof lat !== 'number' ||
 typeof lon !== 'number' ||
 typeof alertId !== 'string' ||
 typeof title !== 'string'
 ) return;
 this.addBeacon(lat, lon, severity, title, alertId);
  };

  private addBeacon(
 lat: number,
 lon: number,
 severity: Severity,
 title: string,
 alertId: string,
  ): void {
 if (!this.dataSource) return;

 const existingTimeout = this.timeouts.get(alertId);
 if (existingTimeout) clearTimeout(existingTimeout);
 const existingEntity = this.entities.get(alertId);
 if (existingEntity) this.dataSource.entities.remove(existingEntity);

 const color = severityColor(severity);

 // Time-coherent so both ellipse axes read one radius per frame (a growing
 // pulse otherwise throws "semiMajorAxis must be >= semiMinorAxis").
 const radiusCb = timeCoherentRadius(pulseRadius);
 const entity = this.dataSource.entities.add({
 position: Cartesian3.fromDegrees(lon, lat),
 point: {
 pixelSize: 12,
 color,
 outlineColor: Color.WHITE,
 outlineWidth: 2,
 scaleByDistance: new NearFarScalar(1.5e2, 2, 1.5e7, 0.5),
 heightReference: HeightReference.CLAMP_TO_GROUND,
 },
 ellipse: {
 semiMinorAxis: radiusCb,
 semiMajorAxis: radiusCb,
 height: 0,
 material: new ColorMaterialProperty(color.withAlpha(0.3)),
 outline: false,
 },
 label: {
 text: title,
 font: '12px sans-serif',
 fillColor: Color.WHITE,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: LabelStyle.FILL_AND_OUTLINE,
 pixelOffset: new Cartesian2(0, -20),
 showBackground: true,
 backgroundColor: Color.fromCssColorString('rgba(0,0,0,0.7)'),
 backgroundPadding: new Cartesian2(8, 4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
 },
 });

 this.entities.set(alertId, entity);

 const timeout = setTimeout(() => {
 const e2 = this.entities.get(alertId);
 if (e2 && this.dataSource) this.dataSource.entities.remove(e2);
 this.entities.delete(alertId);
 this.timeouts.delete(alertId);
 }, BEACON_TTL_MS);
 this.timeouts.set(alertId, timeout);
  }
}
