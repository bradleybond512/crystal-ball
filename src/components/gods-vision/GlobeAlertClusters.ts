/**
 * GlobeAlertClusters — renders alert clusters from the geo-clustering
 * service as severity-colored pulsing rings on the Cesium globe.
 *
 * Listens to `cb:alert-clusters` events dispatched by alert-geo-cluster.ts.
 */

import {
  Cartesian3, Color, ColorMaterialProperty, CustomDataSource, Entity,
  ConstantPositionProperty, EllipseGraphics, CallbackProperty,
  HeightReference,
  type Viewer,
} from 'cesium';
import { timeCoherentRadius } from '@/services/globe/time-coherent-radius';
import type { AlertCluster } from '@/services/alert-geo-cluster';

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  info: '#60a5fa',
};

export class GlobeAlertClusters {
  private source: CustomDataSource;
  private destroyed = false;
  private cleanup: (() => void) | null = null;

  constructor(private viewer: Viewer) {
    this.source = new CustomDataSource('alertClusters');
  }

  private readonly handleClusters = (e: Event): void => {
    const det = (e as CustomEvent<{ clusters: AlertCluster[] }>).detail;
    if (det) this.update(det.clusters);
  };

  mount(): void {
    this.viewer.dataSources.add(this.source).catch(() => { /* intentional */ });
    document.addEventListener('cb:alert-clusters', this.handleClusters);
    this.cleanup = () => document.removeEventListener('cb:alert-clusters', this.handleClusters);
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanup?.();
    this.viewer.dataSources.remove(this.source, true);
  }

  private update(clusters: AlertCluster[]): void {
    if (this.destroyed) return;
    this.source.entities.removeAll();

    for (const c of clusters) {
      const baseColor = Color.fromCssColorString(SEV_COLOR[c.maxSeverity] ?? '#60a5fa');
      const radiusM = Math.max(50_000, c.radius * 1000);
      const startMs = Date.now();

      // Time-coherent: both ellipse axes must read one value per frame, else a
      // growing radius throws "semiMajorAxis must be >= semiMinorAxis".
      const radiusCb = timeCoherentRadius(() => {
        const t = (Date.now() - startMs) % 4000;
        return radiusM * (0.6 + 0.4 * (t / 4000));
      });
      this.source.entities.add(new Entity({
        position: new ConstantPositionProperty(Cartesian3.fromDegrees(c.lon, c.lat, 0)),
        ellipse: new EllipseGraphics({
          semiMajorAxis: radiusCb,
          semiMinorAxis: radiusCb,
          material: new ColorMaterialProperty(new CallbackProperty(() => {
            const t = (Date.now() - startMs) % 4000;
            const alpha = 0.35 * (1 - t / 4000);
            return baseColor.withAlpha(alpha);
          }, false)),
          outline: true,
          outlineColor: new CallbackProperty(() => {
            const t = (Date.now() - startMs) % 4000;
            return baseColor.withAlpha(0.6 * (1 - t / 4000));
          }, false) as unknown as import('cesium').Property,
          outlineWidth: new CallbackProperty(() => {
            return Math.max(1, c.alerts.length);
          }, false) as unknown as import('cesium').Property,
          height: 0,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        }),
        description: `${c.alerts.length} alerts · ${c.maxSeverity}` as unknown as import('cesium').Property,
      }));
    }
  }
}
