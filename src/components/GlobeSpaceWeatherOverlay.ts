/**
 * GlobeSpaceWeatherOverlay — Cesium entity wiring for PR 3 of the
 * space weather stack.
 *
 * Consumes the descriptors produced by `globe-overlay.buildOverlayDescriptor`:
 *   - Aurora oval ring (north + south parallels at visibility latitude)
 *     when Kp ≥ 5, color stepped by storm level
 *   - Pulsing point + halo at the subsolar point when an X-class flare
 *     is active, animated via a Cesium CallbackProperty
 *
 * Mirrors GlobeSeismicWaves' lifecycle:
 *   - Polls /api/spaceweather/status every 5 min
 *   - mount / destroy reconcile a CustomDataSource on the viewer
 *   - localStorage-backed enabled flag for HUD toggle parity
 *   - Class is thin; the math is already in services/spaceweather/globe-overlay
 */

import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  type Entity,
  HeightReference,
  type Viewer,
} from 'cesium';

import {
  buildOverlayDescriptor,
  flarePulseRadiusM,
  type AuroraRing,
  type FlarePulse,
  type GlobeOverlayDescriptor,
} from '@/services/spaceweather/globe-overlay';
import type { SpaceWxStatus } from '@/services/spaceweather/swpc-monitor';

const ENDPOINT = '/api/spaceweather/status';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const ENABLED_KEY = 'cb:globe-space-weather-enabled';
const DATA_SOURCE_NAME = 'space-weather-overlay';

const ENTITY_IDS = {
  auroraNorth: 'sw-aurora-north',
  auroraSouth: 'sw-aurora-south',
  flarePoint: 'sw-flare-point',
  flarePulse: 'sw-flare-pulse',
} as const;

export function isSpaceWeatherOverlayEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

export function setSpaceWeatherOverlayEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
  } catch { /* localStorage may be unavailable */ }
}

export class GlobeSpaceWeatherOverlay {
  private viewer: Viewer;
  private dataSource: CustomDataSource | null = null;
  private mounted = false;
  private enabled = isSpaceWeatherOverlayEnabled();
  private currentDescriptor: GlobeOverlayDescriptor = { visible: false, aurora: null, flarePulse: null };
  private pulseStartMs: number = Date.now();
  private entities = new Map<string, Entity>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.dataSource = new CustomDataSource(DATA_SOURCE_NAME);
    void this.viewer.dataSources.add(this.dataSource);
    if (this.enabled) this.startPolling();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopPolling();
    this.entities.clear();
    this.currentDescriptor = { visible: false, aurora: null, flarePulse: null };
    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = null;
    }
  }

  setEnabled(value: boolean): void {
    if (this.enabled === value) return;
    this.enabled = value;
    setSpaceWeatherOverlayEnabled(value);
    if (this.mounted) {
      if (value) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.applyDescriptor({ visible: false, aurora: null, flarePulse: null });
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    void this.fetchAndApply();
    this.pollTimer = setInterval(() => {
      void this.fetchAndApply();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchAndApply(): Promise<void> {
    try {
      const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const status = (await res.json()) as SpaceWxStatus;
      this.applyStatus(status);
    } catch { /* silent — best-effort */ }
  }

  /** Public for tests + callers that already have a SpaceWxStatus (e.g.
   * fixture-driven panels). Builds the descriptor and reconciles entities. */
  applyStatus(status: SpaceWxStatus | null): void {
    this.applyDescriptor(buildOverlayDescriptor(status));
  }

  // ── Descriptor reconciliation ───────────────────────────────────────────

  /** Public for tests — applies a descriptor directly. */
  applyDescriptor(next: GlobeOverlayDescriptor): void {
    if (!this.dataSource) return;
    // Aurora rings
    if (next.aurora) {
      this.upsertAurora(next.aurora);
    } else {
      this.removeEntity(ENTITY_IDS.auroraNorth);
      this.removeEntity(ENTITY_IDS.auroraSouth);
    }
    // Flare pulse — reset the pulse-start clock when a new flare turns on.
    if (next.flarePulse) {
      const wasFlaring = this.currentDescriptor.flarePulse !== null;
      if (!wasFlaring) this.pulseStartMs = Date.now();
      this.upsertFlarePulse(next.flarePulse);
    } else {
      this.removeEntity(ENTITY_IDS.flarePoint);
      this.removeEntity(ENTITY_IDS.flarePulse);
    }
    this.currentDescriptor = next;
  }

  private upsertAurora(ring: AuroraRing): void {
    if (!this.dataSource) return;
    const cssColor = Color.fromBytes(
      Math.round(ring.color.r * 255),
      Math.round(ring.color.g * 255),
      Math.round(ring.color.b * 255),
      Math.round(ring.color.a * 255),
    );
    const northPositions = Cartesian3.fromDegreesArray(
      ring.ringNorth.flatMap(([lon, lat]) => [lon, lat]),
    );
    const southPositions = Cartesian3.fromDegreesArray(
      ring.ringSouth.flatMap(([lon, lat]) => [lon, lat]),
    );
    this.upsertPolyline(ENTITY_IDS.auroraNorth, northPositions, cssColor, ring.widthPx);
    this.upsertPolyline(ENTITY_IDS.auroraSouth, southPositions, cssColor, ring.widthPx);
  }

  private upsertPolyline(
    id: string,
    positions: Cartesian3[],
    color: Color,
    widthPx: number,
  ): void {
    if (!this.dataSource) return;
    const existing = this.entities.get(id);
    if (existing) {
      this.dataSource.entities.remove(existing);
    }
    const entity = this.dataSource.entities.add({
      id,
      polyline: {
        positions,
        width: widthPx,
        material: new ColorMaterialProperty(color),
        clampToGround: false,
      },
    });
    this.entities.set(id, entity);
  }

  private upsertFlarePulse(pulse: FlarePulse): void {
    if (!this.dataSource) return;
    // Snapshot for the CallbackProperty closure — keeps the inner /
    // outer radii stable even when the descriptor object is replaced.
    const inner = pulse.innerRadiusM;
    const outer = pulse.outerRadiusM;
    const period = pulse.pulsePeriodMs;

    // Subsolar focal point — small bright dot.
    this.removeEntity(ENTITY_IDS.flarePoint);
    const point = this.dataSource.entities.add({
      id: ENTITY_IDS.flarePoint,
      position: Cartesian3.fromDegrees(pulse.subsolarLonDeg, pulse.subsolarLatDeg),
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString('#fef3c7'),
        outlineColor: Color.fromCssColorString('#f59e0b'),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
    this.entities.set(ENTITY_IDS.flarePoint, point);

    // Animated pulsing halo — radius oscillates inner ↔ outer over the period.
    this.removeEntity(ENTITY_IDS.flarePulse);
    const radius = new CallbackProperty(
      () => flarePulseRadiusM(Date.now(), this.pulseStartMs, period, inner, outer),
      false,
    );
    const haloColor = new CallbackProperty(
      () => {
        const r = flarePulseRadiusM(Date.now(), this.pulseStartMs, period, inner, outer);
        const t = outer === inner ? 0 : (r - inner) / (outer - inner);
        // Fade as the halo expands — stronger at inner, fainter at outer.
        const alpha = 0.45 * (1 - t) + 0.1;
        return Color.fromCssColorString('#a855f7').withAlpha(alpha);
      },
      false,
    );
    const halo = this.dataSource.entities.add({
      id: ENTITY_IDS.flarePulse,
      position: Cartesian3.fromDegrees(pulse.subsolarLonDeg, pulse.subsolarLatDeg),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        height: 0,
        material: new ColorMaterialProperty(haloColor),
        outline: false,
      },
    });
    this.entities.set(ENTITY_IDS.flarePulse, halo);
  }

  private removeEntity(id: string): void {
    if (!this.dataSource) return;
    const entity = this.entities.get(id);
    if (entity) {
      this.dataSource.entities.remove(entity);
      this.entities.delete(id);
    }
  }

  // ── Test hooks ──────────────────────────────────────────────────────────

  /** @internal */
  __getEntityCount(): number {
    return this.entities.size;
  }

  /** @internal */
  __hasEntity(id: keyof typeof ENTITY_IDS): boolean {
    return this.entities.has(ENTITY_IDS[id]);
  }
}
