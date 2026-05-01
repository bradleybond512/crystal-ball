/**
 * GlobePredictions — Tier 2 hover/click probability overlays.
 *
 * Renders one of:
 *   • A flight / cyclone probability cone (translucent polygon + center
 *     path) when {@link showCone} is called.
 *   • Concentric aftershock rings around an earthquake epicenter when
 *     {@link showAftershock} is called.
 *
 * Spec mandates max one active overlay at a time — every show*() call
 * clears the previous one. Clearing also runs on Esc / clicking elsewhere
 * (wired in by GodsEyeView in a follow-up).
 *
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 10)
 */

import {
  Cartesian3,
  Color,
  CustomDataSource,
  EllipseGraphics,
  Entity,
  HeightReference,
  PolygonGraphics,
  PolylineGraphics,
  PolygonHierarchy,
  type Viewer,
} from 'cesium';
import type { AftershockForecast, ForecastCone } from '@/services/forecast-engine';

const CONE_COLOR_BY_TYPE: Record<ForecastCone['type'], Color> = {
  cyclone: Color.fromCssColorString('#ffa500'),
  flight:  Color.fromCssColorString('#00c8ff'),
  fire:    Color.fromCssColorString('#ff6644'),
  vessel:  Color.fromCssColorString('#4488ff'),
};

const AFTERSHOCK_COLOR = Color.fromCssColorString('#ffc800');
const AFTERSHOCK_DISPLAY_THRESHOLD = 5; // only render M ≥ 5 rings; M4 rings are too noisy

export class GlobePredictions {
  private viewer: Viewer;
  private source: CustomDataSource;
  private activeEntities: Entity[] = [];

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.source = new CustomDataSource('4d-predictions');
  }

  mount(): void {
    this.viewer.dataSources.add(this.source).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[GlobePredictions] dataSources.add failed', error);
    });
  }

  destroy(): void {
    this.clear();
    this.viewer.dataSources.remove(this.source, true);
  }

  clear(): void {
    for (const e of this.activeEntities) this.source.entities.remove(e);
    this.activeEntities = [];
  }

  hasActive(): boolean {
    return this.activeEntities.length > 0;
  }

  showCone(cone: ForecastCone): void {
    this.clear();
    const color = CONE_COLOR_BY_TYPE[cone.type];

    if (cone.conePolygon.length >= 3) {
      const positions = cone.conePolygon.map(p => Cartesian3.fromDegrees(p.lon, p.lat));
      this.activeEntities.push(this.source.entities.add(new Entity({
        polygon: new PolygonGraphics({
          hierarchy: new PolygonHierarchy(positions),
          material: color.withAlpha(0.08),
          outline: true,
          outlineColor: color.withAlpha(0.25),
          heightReference: HeightReference.CLAMP_TO_GROUND,
        }),
      })));
    }

    if (cone.probablePath.length >= 2) {
      const pathPositions = cone.probablePath.map(p => Cartesian3.fromDegrees(p.lon, p.lat));
      this.activeEntities.push(this.source.entities.add(new Entity({
        polyline: new PolylineGraphics({
          positions: pathPositions,
          width: 2,
          material: color.withAlpha(0.5),
          clampToGround: true,
        }),
      })));
    }
  }

  showAftershock(forecast: AftershockForecast): void {
    this.clear();
    for (const ring of forecast.rings) {
      if (ring.magnitudeThreshold !== AFTERSHOCK_DISPLAY_THRESHOLD) continue;
      this.activeEntities.push(this.source.entities.add(new Entity({
        position: Cartesian3.fromDegrees(forecast.epicenterLon, forecast.epicenterLat),
        ellipse: new EllipseGraphics({
          semiMajorAxis: ring.radiusKm * 1000,
          semiMinorAxis: ring.radiusKm * 1000,
          material: AFTERSHOCK_COLOR.withAlpha(ring.probability * 0.15),
          outline: true,
          outlineColor: AFTERSHOCK_COLOR.withAlpha(ring.probability * 0.3),
          heightReference: HeightReference.CLAMP_TO_GROUND,
        }),
      })));
    }
  }
}
