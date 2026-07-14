/**
 * GlobeTrails — comet-tail polyline trails behind moving entities.
 *
 * Each tracked entity gets a Float64Array ring buffer of (lon, lat, timeMs)
 * tuples. Buffer length is bounded by MAX_POINTS_PER_TRAIL; total trail count
 * is bounded by MAX_TRAILS. Points older than the per-layer window are
 * trimmed on each refresh tick.
 *
 * Trails are rendered as N-1 individual segment polylines per trail so each
 * segment can carry its own alpha (Cesium's entity-API ColorMaterialProperty
 * is single-color). The tail segment is fully transparent and the head segment
 * is fully opaque, with linear interpolation between them. A predictive
 * segment past the head extrapolates one trail-length ahead using the most
 * recent heading + speed and renders at half alpha to flag the uncertainty.
 */

import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  CustomDataSource,
  Entity,
  PolylineGraphics,
  PolylineDashMaterialProperty,
  type Viewer,
} from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

interface TrailConfig {
  layerName: string;
  windowMs: number;
  color: Color;
  width: number;
}

const TRAIL_CONFIGS: readonly TrailConfig[] = [
  { layerName: 'flights',     windowMs:  6 * 3_600_000, color: Color.fromCssColorString('#00c8ff'), width: 2 },
  { layerName: 'vessels',     windowMs: 12 * 3_600_000, color: Color.fromCssColorString('#4488ff'), width: 1.5 },
  { layerName: 'darkVessels', windowMs: 12 * 3_600_000, color: Color.fromCssColorString('#ff453a'), width: 1.5 },
  { layerName: 'cyclones',    windowMs:  7 * 86_400_000, color: Color.fromCssColorString('#ffa500'), width: 3 },
];

const MAX_TRAILS = 200;
const MAX_POINTS_PER_TRAIL = 50;
const REFRESH_MS = 5000;
const POINT_STRIDE = 3; // [lon, lat, timeMs]
const PREDICTIVE_ALPHA = 0.35;
const MAX_PREDICTIVE_DEG = 5; // never extrapolate more than ~550 km in the predictive segment

interface SegmentSlot {
  entity: Entity;
  positions: ConstantProperty;
  color: ConstantProperty;
}

interface TrailEntry {
  entityId: string;
  layerName: string;
  buffer: Float64Array;
  head: number;
  count: number;
  segments: SegmentSlot[];
  predictive: SegmentSlot | null;
  config: TrailConfig;
}

export class GlobeTrails {
  private viewer: Viewer;
  private dataManager: GlobeDataManager;
  private source: CustomDataSource;
  private trails = new Map<string, TrailEntry>();
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Returns the reference time used for the trail-window cutoff. In live
   * mode this is `Date.now()`; in 4D historical playback the host supplies
   * a getter that resolves to the current scrubbed time so trails stay
   * visible at older timestamps.
   */
  private getPlaybackTime: () => number;
  private addPromise: Promise<unknown> | null = null;

  constructor(
    viewer: Viewer,
    dataManager: GlobeDataManager,
    getPlaybackTime: () => number = () => Date.now(),
  ) {
    this.viewer = viewer;
    this.dataManager = dataManager;
    this.getPlaybackTime = getPlaybackTime;
    this.source = new CustomDataSource('4d-trails');
  }

  mount(): void {
    this.addPromise = this.viewer.dataSources.add(this.source);
    this.addPromise.catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[GlobeTrails] dataSources.add failed', error);
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
    // If the add hasn't settled, chain the remove so we don't leak the
    // data source into the viewer when add resolves after destroy.
    const pending = this.addPromise ?? Promise.resolve();
    pending
      .then(() => this.viewer.dataSources.remove(this.source, true))
      .catch(() => { /* add failed — nothing to remove */ });
    this.trails.clear();
  }

  get activeTrailCount(): number { return this.trails.size; }

  private refresh(): void {
    const seenIds = new Set<string>();

    for (const config of TRAIL_CONFIGS) {
      const positions = this.dataManager.getEntityPositionHistory(config.layerName);
      for (const pos of positions) {
        if (this.trails.size >= MAX_TRAILS && !this.trails.has(pos.id)) continue;
        seenIds.add(pos.id);
        let trail = this.trails.get(pos.id);
        if (!trail) {
          trail = this.createTrail(pos.id, config);
          this.trails.set(pos.id, trail);
        }
        this.pushPoint(trail, pos.lon, pos.lat, pos.timeMs, config.windowMs);
      }
    }

    for (const trail of this.trails.values()) {
      this.renderTrail(trail);
    }

    // Drop trails whose entity disappeared.
    for (const [id, trail] of this.trails) {
      if (!seenIds.has(id)) {
        this.removeTrail(trail);
        this.trails.delete(id);
      }
    }
  }

  private createTrail(entityId: string, config: TrailConfig): TrailEntry {
    const buffer = new Float64Array(MAX_POINTS_PER_TRAIL * POINT_STRIDE);
    return {
      entityId,
      layerName: config.layerName,
      buffer,
      head: 0,
      count: 0,
      segments: [],
      predictive: null,
      config,
    };
  }

  private pushPoint(trail: TrailEntry, lon: number, lat: number, timeMs: number, windowMs: number): void {
    const idx = trail.head * POINT_STRIDE;
    trail.buffer[idx] = lon;
    trail.buffer[idx + 1] = lat;
    trail.buffer[idx + 2] = timeMs;
    trail.head = (trail.head + 1) % MAX_POINTS_PER_TRAIL;
    if (trail.count < MAX_POINTS_PER_TRAIL) trail.count++;

    const cutoff = this.getPlaybackTime() - windowMs;
    while (trail.count > 0) {
      const oldest = ((trail.head - trail.count + MAX_POINTS_PER_TRAIL) % MAX_POINTS_PER_TRAIL) * POINT_STRIDE;
      if ((trail.buffer[oldest + 2] ?? 0) >= cutoff) break;
      trail.count--;
    }
  }

  /**
   * Resolve the trail buffer to an ordered array of (lon, lat) pairs from
   * tail (oldest) to head (newest).
   */
  private collectPoints(trail: TrailEntry): { lon: number; lat: number }[] {
    if (trail.count === 0) return [];
    const out: { lon: number; lat: number }[] = [];
    for (let i = 0; i < trail.count; i++) {
      const idx = ((trail.head - trail.count + i + MAX_POINTS_PER_TRAIL) % MAX_POINTS_PER_TRAIL) * POINT_STRIDE;
      out.push({ lon: trail.buffer[idx] ?? 0, lat: trail.buffer[idx + 1] ?? 0 });
    }
    return out;
  }

  private renderTrail(trail: TrailEntry): void {
    const points = this.collectPoints(trail);
    const desiredSegments = Math.max(0, points.length - 1);

    while (trail.segments.length > desiredSegments) {
      const slot = trail.segments.pop();
      if (slot) this.source.entities.remove(slot.entity);
    }
    while (trail.segments.length < desiredSegments) {
      trail.segments.push(this.createSegmentSlot(trail.config.width, false));
    }

    for (let i = 0; i < desiredSegments; i++) {
      const a = points[i];
      const b = points[i + 1];
      const slot = trail.segments[i];
      if (!a || !b || !slot) continue;
      const tailFrac = i / desiredSegments;
      const headFrac = (i + 1) / desiredSegments;
      const alpha = (tailFrac + headFrac) / 2; // average alpha across the segment
      slot.positions.setValue([
        Cartesian3.fromDegrees(a.lon, a.lat),
        Cartesian3.fromDegrees(b.lon, b.lat),
      ]);
      slot.color.setValue(trail.config.color.withAlpha(alpha));
    }

    this.updatePredictiveSegment(trail, points);
  }

  /**
   * Velocity-based predictive segment that extends one trail-length past the
   * head using the average of the last few segments. Rendered as a low-alpha
   * dashed polyline so the overall trail visually previews the next step.
   */
  private updatePredictiveSegment(trail: TrailEntry, points: { lon: number; lat: number }[]): void {
    if (points.length < 2) {
      if (trail.predictive) {
        this.source.entities.remove(trail.predictive.entity);
        trail.predictive = null;
      }
      return;
    }

    const head = points[points.length - 1]!;
    // Average direction over the last few segments (smoother than raw last segment).
    const sampleN = Math.min(5, points.length - 1);
    let dLon = 0;
    let dLat = 0;
    for (let i = points.length - sampleN - 1; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      if (!p1 || !p2) continue;
      dLon += p2.lon - p1.lon;
      dLat += p2.lat - p1.lat;
    }
    dLon /= sampleN;
    dLat /= sampleN;

    // Scale predictive vector to one trail-length, but cap to MAX_PREDICTIVE_DEG.
    const trailLengthScale = sampleN > 0 ? (points.length - 1) / sampleN : 1;
    let predLon = dLon * trailLengthScale;
    let predLat = dLat * trailLengthScale;
    const mag = Math.hypot(predLon, predLat);
    if (mag > MAX_PREDICTIVE_DEG) {
      const scale = MAX_PREDICTIVE_DEG / mag;
      predLon *= scale;
      predLat *= scale;
    }
    if (mag < 1e-6) {
      // Stationary entity — drop any existing predictive segment.
      if (trail.predictive) {
        this.source.entities.remove(trail.predictive.entity);
        trail.predictive = null;
      }
      return;
    }

    trail.predictive ??= this.createSegmentSlot(trail.config.width, true);
    trail.predictive.positions.setValue([
      Cartesian3.fromDegrees(head.lon, head.lat),
      Cartesian3.fromDegrees(head.lon + predLon, head.lat + predLat),
    ]);
    trail.predictive.color.setValue(trail.config.color.withAlpha(PREDICTIVE_ALPHA));
  }

  private createSegmentSlot(width: number, dashed: boolean): SegmentSlot {
    const positions = new ConstantProperty([Cartesian3.ZERO, Cartesian3.ZERO]);
    const color = new ConstantProperty(Color.TRANSPARENT);
    const material = dashed
      ? new PolylineDashMaterialProperty({ color, dashLength: 8 })
      : new ColorMaterialProperty(color);
    const entity = this.source.entities.add(new Entity({
      polyline: new PolylineGraphics({
        positions,
        width,
        material,
        clampToGround: true,
      }),
    }));
    return { entity, positions, color };
  }

  private removeTrail(trail: TrailEntry): void {
    for (const slot of trail.segments) this.source.entities.remove(slot.entity);
    if (trail.predictive) this.source.entities.remove(trail.predictive.entity);
    trail.segments.length = 0;
    trail.predictive = null;
  }
}
