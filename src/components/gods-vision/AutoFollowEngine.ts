/**
 * AutoFollowEngine — Intelligent auto-pilot for God's Eye camera.
 *
 * Reads entity positions from GlobeDataManager's CustomDataSources,
 * scores them by layer importance (mode-weighted), and flies the camera
 * to the highest-priority targets in a cycle.
 *
 * Mode awareness:
 *  - War mode → prioritize conflicts, airstrikes, military
 *  - Disaster → prioritize earthquakes, GDACS, volcanoes, cyclones, fires
 *  - Finance → overview orbit, minimal fly-to
 *  - Peace/Ghost → balanced scoring
 */

import {
  Cartesian3,
  Cartographic,
  JulianDate,
  Math as CesiumMath,
  type Viewer,
  type Entity,
  type CustomDataSource,
} from 'cesium';
import type { AppMode } from '@/services/mode-manager';

export interface FollowTarget {
  id: string;
  layer: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
}

export interface AutoFollowOptions {
  cycleIntervalMs?: number; // default: 12000 (12s)
  flyDurationSec?: number; // default: 2.5
  altitudeMeters?: number; // default: 2_500_000 (2500 km)
}

const DEFAULT_CYCLE_MS = 12_000;
const DEFAULT_FLY_DURATION = 2.5;
const DEFAULT_ALT = 2_500_000;

/** Per-layer base importance (higher = more likely to be followed). */
const LAYER_WEIGHTS: Record<string, number> = {
  earthquakes: 3,
  gdacs: 4,
  conflicts: 3,
  airstrikes: 4,
  volcanoes: 3,
  cyclones: 4,
  fires: 2,
  flights: 1.5,
  vessels: 1,
  darkVessels: 2.5,
  nuclear: 1,
  cyber: 1.5,
  gpsJamming: 2,
  protests: 1.5,
  disease: 1,
  displacement: 1,
  hotspots: 2,
  satChange: 2,
};

/** Mode-specific multipliers for layer weights. */
const MODE_MULTIPLIERS: Record<string, Record<string, number>> = {};

/** Deterministic 0-1 value from a string, used for stable jitter. */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
 h = Math.trunc((h << 5) - h + (s.codePointAt(i) ?? 0));
  }
  return Math.abs(h % 1000) / 1000;
}

function entityToLatLon(entity: Entity): { lat: number; lon: number } | null {
  const pos = entity.position;
  if (!pos) return null;
  try {
 const cart = pos.getValue(JulianDate.fromDate(new Date()));
 if (!cart) return null;
 const carto = Cartographic.fromCartesian(cart);
 return {
 lat: CesiumMath.toDegrees(carto.latitude),
 lon: CesiumMath.toDegrees(carto.longitude),
 };
  } catch {
 return null;
  }
}

/** Inner edge of the temporal-weight band: |Δt| ≤ 30 min → 2× boost. */
const TEMPORAL_BOOST_INNER_MS = 30 * 60 * 1000;
/** Outer edge of the temporal-weight band: |Δt| ≥ 6 h → 0.5× damp. */
const TEMPORAL_BOOST_OUTER_MS = 6 * 60 * 60 * 1000;
const TEMPORAL_BOOST_MAX = 2;
const TEMPORAL_BOOST_MIN = 0.5;

/**
 * Multiplicative weight applied to an entity's score based on the proximity
 * of its timestamp to the current playback time. Designed for AI Director
 * mode 4D playback so the camera tracks events that were happening *then*,
 * not just events that are happening *now*.
 *
 * - |Δt| ≤ 30 min → 2.0 × score
 * - |Δt| ≥  6 h   → 0.5 × score
 * - between → log-linear interpolation
 */
export function temporalWeight(tsMs: number | null, playbackMs: number | null): number {
  if (tsMs === null || playbackMs === null) return 1;
  const dt = Math.abs(tsMs - playbackMs);
  if (dt <= TEMPORAL_BOOST_INNER_MS) return TEMPORAL_BOOST_MAX;
  if (dt >= TEMPORAL_BOOST_OUTER_MS) return TEMPORAL_BOOST_MIN;
  const inner = Math.log(TEMPORAL_BOOST_INNER_MS);
  const outer = Math.log(TEMPORAL_BOOST_OUTER_MS);
  const here = Math.log(dt);
  const fraction = (here - inner) / (outer - inner);
  return TEMPORAL_BOOST_MAX + (TEMPORAL_BOOST_MIN - TEMPORAL_BOOST_MAX) * fraction;
}

/**
 * Extract entity timestamp (last-updated) in ms epoch from PropertyBag.
 * Returns null if no timestamp is set.
 */
function entityTimestampMs(entity: Entity, julian: JulianDate): number | null {
  try {
 const bag = entity.properties?.getValue(julian) as { timestamp?: Date | string | number } | undefined;
 const ts = bag?.timestamp;
 if (ts instanceof Date) return ts.getTime();
 if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
 if (typeof ts === 'string') {
 const parsed = Date.parse(ts);
 return Number.isFinite(parsed) ? parsed : null;
 }
  } catch { /* none */ }
  return null;
}

export class AutoFollowEngine {
  private viewer: Viewer;
  private targets: FollowTarget[] = [];
  private currentIndex = 0;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private _active = false;
  private mode: AppMode | null = null;
  private opts: Required<AutoFollowOptions>;
  private onTargetChange: ((target: FollowTarget | null, index: number, total: number) => void) | null = null;
  private dataSources: () => Map<string, CustomDataSource>;
  /** Active 4D playback time, or null when scoring against wall-clock NOW. */
  private playbackMs: number | null = null;

  constructor(
 viewer: Viewer,
 dataSources: () => Map<string, CustomDataSource>,
 options?: AutoFollowOptions,
  ) {
 this.viewer = viewer;
 this.dataSources = dataSources;
 this.opts = {
 cycleIntervalMs: options?.cycleIntervalMs ?? DEFAULT_CYCLE_MS,
 flyDurationSec: options?.flyDurationSec ?? DEFAULT_FLY_DURATION,
 altitudeMeters: options?.altitudeMeters ?? DEFAULT_ALT,
 };
  }

  get active(): boolean {
 return this._active;
  }

  get currentTarget(): FollowTarget | null {
 return this.targets[this.currentIndex] ?? null;
  }

  get targetCount(): number {
 return this.targets.length;
  }

  setMode(mode: AppMode | null): void {
 this.mode = mode;
  }

  setOnTargetChange(cb: (target: FollowTarget | null, index: number, total: number) => void): void {
 this.onTargetChange = cb;
  }

  start(): void {
 if (this._active) return;
 this._active = true;
 this.currentIndex = 0;
 this.refreshTargets();

 if (this.targets.length > 0) {
 this.flyToCurrentTarget();
 }

 this.cycleTimer = setInterval(() => {
 this.refreshTargets();
 this.advanceToNext();
 }, this.opts.cycleIntervalMs);
  }

  stop(): void {
 if (!this._active) return;
 this._active = false;
 if (this.cycleTimer) {
 clearInterval(this.cycleTimer);
 this.cycleTimer = null;
 }
 this.onTargetChange?.(null, 0, 0);
  }

  toggle(): void {
 if (this._active) this.stop();
 else this.start();
  }

  skipToNext(): void {
 if (!this._active) return;
 this.advanceToNext();
  }

  /**
   * Refresh targets relative to a specific playback time. Used by 4D
   * AI Director mode so the camera follows what was important at the
   * point in time being played back, not just wall-clock NOW.
   */
  refreshAtTime(playbackMs: number): void {
 this.playbackMs = Number.isFinite(playbackMs) ? playbackMs : null;
 this.refreshTargets();
 this.playbackMs = null;
 if (this.targets.length > 0 && this._active) {
 this.flyToCurrentTarget();
 }
  }

  private refreshTargets(): void {
 const scored: FollowTarget[] = [];
 const sources = this.dataSources();

 for (const [layerName, source] of sources) {
 if (!source.show) continue;
 const baseWeight = LAYER_WEIGHTS[layerName] ?? 1;
 const modeMulti = (this.mode ? MODE_MULTIPLIERS[this.mode]?.[layerName] : 1) ?? 1;
 const weight = baseWeight * modeMulti;

 if (weight < 0.5) continue; // Skip nearly-zero-weight layers

 const entities = source.entities.values;
 // Sample up to 10 entities per layer to keep target list manageable
 const step = Math.max(1, Math.floor(entities.length / 10));
 const julian = JulianDate.fromDate(new Date());
 for (let i = 0; i < entities.length; i += step) {
 const entity = entities[i]!;
 const loc = entityToLatLon(entity);
 if (!loc) continue;

 const tsMs = entityTimestampMs(entity, julian);
 const baseScore = weight + simpleHash(entity.id) * 0.5;

 scored.push({
 id: entity.id,
 layer: layerName,
 name: (entity.description?.getValue(julian) as string)
 ?? entity.name
 ?? layerName,
 lat: loc.lat,
 lon: loc.lon,
 score: baseScore * temporalWeight(tsMs, this.playbackMs),
 });
 }
 }

 scored.sort((a, b) => b.score - a.score);
 this.targets = scored.slice(0, 30); // Top 30
  }

  private advanceToNext(): void {
 if (this.targets.length === 0) {
 this.onTargetChange?.(null, 0, 0);
 return;
 }
 this.currentIndex = (this.currentIndex + 1) % this.targets.length;
 this.flyToCurrentTarget();
  }

  private flyToCurrentTarget(): void {
 const target = this.targets[this.currentIndex];
 if (!target) return;

 this.viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(target.lon, target.lat, this.opts.altitudeMeters),
 duration: this.opts.flyDurationSec,
 });
 this.onTargetChange?.(target, this.currentIndex, this.targets.length);
  }

  /** Return the top-N priority targets using the current mode weights.
 *  Safe to call at any time — triggers a fresh scoring pass. */
  getPriorityTargets(n: number): FollowTarget[] {
 this.refreshTargets();
 return this.targets.slice(0, n);
  }

  destroy(): void {
 this.stop();
 this.onTargetChange = null;
  }
}
