/**
 * GlobePillars — vertical intensity bars at conflict/disaster locations.
 *
 * Each event spawns a Cesium CylinderGraphics whose:
 *   - length encodes how long the event has been active (20 km per hour
 *     since timestamp, capped at 500 km),
 *   - bottom radius encodes severity (5 km per severity unit, capped at 50 km),
 *   - color matches the swimlane lane category (red conflicts, orange
 *     disasters, yellow seismic).
 *
 * Total bar count is capped at MAX_PILLARS; ranking is by severity so the
 * most critical events always render. Sources refresh every 10 s; that's
 * coarse enough to skip Cesium scene churn but fine enough that a freshly
 * arriving high-severity event reaches the user inside a single tick.
 *
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 7)
 */

import {
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  CylinderGraphics,
  CallbackProperty,
  type MaterialProperty,
  type Viewer,
} from 'cesium';
import type { GlobeDataManager, EntityTimestampedSample } from '@/components/GlobeDataManager';

const MAX_PILLARS = 100;
const PILLAR_LAYERS: readonly string[] = ['conflicts', 'airstrikes', 'gdacs', 'cyclones', 'earthquakes'];
const REFRESH_MS = 10_000;
const HEIGHT_PER_HOUR_M = 20_000;
const MAX_HEIGHT_M = 500_000;
const RADIUS_PER_SEVERITY_M = 5000;
const MAX_RADIUS_M = 50_000;

const CATEGORY_COLORS: Record<string, Color> = {
  conflicts:   Color.fromCssColorString('#ff3333').withAlpha(0.6),
  airstrikes:  Color.fromCssColorString('#ff3333').withAlpha(0.7),
  gdacs:       Color.fromCssColorString('#ffa500').withAlpha(0.6),
  cyclones:    Color.fromCssColorString('#ffa500').withAlpha(0.5),
  earthquakes: Color.fromCssColorString('#ffc800').withAlpha(0.5),
};

interface PillarEntity { layerName: string; cesium: Entity }

export class GlobePillars {
  private viewer: Viewer;
  private dataManager: GlobeDataManager;
  private source: CustomDataSource;
  private pillars = new Map<string, PillarEntity>();
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private addPromise: Promise<unknown> | null = null;

  constructor(viewer: Viewer, dataManager: GlobeDataManager) {
    this.viewer = viewer;
    this.dataManager = dataManager;
    this.source = new CustomDataSource('4d-pillars');
  }

  mount(): void {
    this.addPromise = this.viewer.dataSources.add(this.source);
    this.addPromise.catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[GlobePillars] dataSources.add failed', error);
    });
    this.refresh();
    this.refreshTimer = setInterval(() => {
      if (!this.destroyed) this.refresh();
    }, REFRESH_MS);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    // Chain the remove off the add promise so it doesn't leak when the
    // add resolves after destroy.
    const pending = this.addPromise ?? Promise.resolve();
    pending
      .then(() => this.viewer.dataSources.remove(this.source, true))
      .catch(() => { /* add failed — nothing to remove */ });
    this.pillars.clear();
  }

  get activePillarCount(): number { return this.pillars.size; }

  private refresh(): void {
    const candidates: (EntityTimestampedSample & { layerName: string })[] = [];
    for (const layerName of PILLAR_LAYERS) {
      const entities = this.dataManager.getLayerEntitiesWithTimestamps(layerName);
      for (const e of entities) candidates.push({ ...e, layerName });
    }
    candidates.sort((a, b) => b.severity - a.severity);
    type LocatedCandidate = EntityTimestampedSample & { layerName: string; lat: number; lon: number };
    const top = candidates.filter((e): e is LocatedCandidate => e.lat != null && e.lon != null).slice(0, MAX_PILLARS);

    const seenIds = new Set<string>();
    for (const e of top) {
      seenIds.add(e.id);
      if (this.pillars.has(e.id)) continue;

      const nowMs = Date.now();
      const durationHrs = Math.max(1, (nowMs - e.timeMs) / 3_600_000);
      const heightM = Math.min(MAX_HEIGHT_M, durationHrs * HEIGHT_PER_HOUR_M);
      const radiusM = Math.min(MAX_RADIUS_M, e.severity * RADIUS_PER_SEVERITY_M);
      const color = CATEGORY_COLORS[e.layerName] ?? Color.WHITE.withAlpha(0.4);

      const cesium = this.source.entities.add(new Entity({
        position: Cartesian3.fromDegrees(e.lon, e.lat, heightM / 2),
        cylinder: new CylinderGraphics({
          length: heightM,
          topRadius: radiusM * 0.3,
          bottomRadius: radiusM,
          material: new CallbackProperty(() => color, false) as unknown as MaterialProperty,
          outline: true,
          outlineColor: color.withAlpha(0.3),
          outlineWidth: 1,
          numberOfVerticalLines: 0,
        }),
      }));
      this.pillars.set(e.id, { layerName: e.layerName, cesium });
    }

    for (const [id, pillar] of this.pillars) {
      if (!seenIds.has(id)) {
        this.source.entities.remove(pillar.cesium);
        this.pillars.delete(id);
      }
    }
  }
}
