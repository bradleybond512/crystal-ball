/**
 * GlobeSeismicWaves — Layer 6 of the seismic intelligence stack.
 *
 * Reads the latest GlobeSeismicOverlay snapshot from
 * /api/seismic-globe-overlays (Layer 5) and renders three Cesium
 * primitives per event:
 *   - Epicenter pulsing dot, color by magnitude band
 *   - P-wave expanding ring (blue, current radius + decaying opacity)
 *   - S-wave expanding ring (red, thicker outline)
 *
 * Polls every 5s. Diff-based update — unchanged events stay; removed
 * eventIds clear all three of their entities; new eventIds add three.
 *
 * Layer toggle is persisted in localStorage. Clicking an epicenter
 * fires a custom DOM event the host can listen for to show a detail
 * card; the component itself does not own the card UI.
 */

import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CustomDataSource,
  type Entity,
  HeightReference,
  NearFarScalar,
  type Viewer,
} from 'cesium';
import { timeCoherentRadius } from '@/services/globe/time-coherent-radius';

import {
  type GlobeSeismicOverlay,
} from '../services/seismic/globe-overlay-emitter';
import {
  colorForMagnitude,
  diffOverlays,
  entityKey,
  ENTITY_KEYS,
} from '../services/seismic/seismic-waves-helpers';

// ── Constants ──────────────────────────────────────────────────────────

const ENDPOINT = '/api/seismic-globe-overlays';
const POLL_INTERVAL_MS = 5000;
const ENABLED_KEY = 'cb:globe-seismic-waves-enabled';
const PULSE_PERIOD_MS = 1500;
const EPICENTER_PULSE_MAX_M = 80_000;

// ── Custom event for detail card (host listens) ────────────────────────

export interface SeismicWaveClickDetail {
  eventId: string;
  lat: number;
  lon: number;
  magnitude: number | null;
}

const CLICK_EVENT_NAME = 'cb:globe-seismic-wave-click';

export function dispatchSeismicWaveClick(detail: SeismicWaveClickDetail): void {
  window.dispatchEvent(new CustomEvent<SeismicWaveClickDetail>(CLICK_EVENT_NAME, { detail }));
}

// ── Persistence ────────────────────────────────────────────────────────

export function isSeismicWavesEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw === null) return true; // default on
    return raw === '1';
  } catch {
    return true;
  }
}

export function setSeismicWavesEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
  } catch { /* localStorage may be unavailable */ }
}

// ── Component ──────────────────────────────────────────────────────────

export class GlobeSeismicWaves {
  private viewer: Viewer;
  private dataSource: CustomDataSource | null = null;
  private mounted = false;
  private enabled = isSeismicWavesEnabled();
  private currentOverlays: GlobeSeismicOverlay[] = [];
  private entitiesByKey = new Map<string, Entity>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.dataSource = new CustomDataSource('seismic-globe-waves');
    void this.viewer.dataSources.add(this.dataSource);
    if (this.enabled) this.startPolling();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopPolling();
    this.entitiesByKey.clear();
    this.currentOverlays = [];
    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = null;
    }
  }

  setEnabled(value: boolean): void {
    if (this.enabled === value) return;
    this.enabled = value;
    setSeismicWavesEnabled(value);
    if (this.mounted) {
      if (value) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.applyOverlays([]);
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── Polling ──────────────────────────────────────────────────────────

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
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return;
      const body = (await res.json()) as { overlays?: GlobeSeismicOverlay[] };
      if (!body || !Array.isArray(body.overlays)) return;
      this.applyOverlays(body.overlays);
    } catch { /* silent — best effort */ }
  }

  // ── Diff + entity render ─────────────────────────────────────────────

  /** Public for tests — applies a new overlay set, reconciling entities. */
  applyOverlays(next: readonly GlobeSeismicOverlay[]): void {
    if (!this.dataSource) return;
    const diff = diffOverlays(this.currentOverlays, next);

    for (const id of diff.removedIds) {
      this.removeOverlayEntities(id);
    }
    for (const overlay of diff.added) {
      this.addOverlayEntities(overlay);
    }
    // Updated overlays' radii/opacity get refreshed via the CallbackProperty
    // closure reading this.currentOverlays (set below) — no entity churn.

    this.currentOverlays = [...next];
  }

  private removeOverlayEntities(eventId: string): void {
    if (!this.dataSource) return;
    for (const suffix of Object.values(ENTITY_KEYS)) {
      const key = entityKey(eventId, suffix);
      const entity = this.entitiesByKey.get(key);
      if (entity) {
        this.dataSource.entities.remove(entity);
        this.entitiesByKey.delete(key);
      }
    }
  }

  private addOverlayEntities(overlay: GlobeSeismicOverlay): void {
    if (!this.dataSource) return;
    const color = Color.fromCssColorString(colorForMagnitude(overlay.magnitude).hex);

    // Epicenter dot — pulses on wall-clock time, doesn't need overlay state.
    const pulse = timeCoherentRadius(() => {
      const t = (Date.now() % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
      return t * EPICENTER_PULSE_MAX_M;
    });
    const epicenter = this.dataSource.entities.add({
      id: entityKey(overlay.eventId, ENTITY_KEYS.epicenter),
      position: Cartesian3.fromDegrees(overlay.lon, overlay.lat),
      point: {
        pixelSize: 10,
        color,
        outlineColor: Color.WHITE,
        outlineWidth: 1.5,
        scaleByDistance: new NearFarScalar(1.5e2, 2, 1.5e7, 0.5),
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      ellipse: {
        semiMinorAxis: pulse,
        semiMajorAxis: pulse,
        height: 0,
        material: new ColorMaterialProperty(color.withAlpha(0.25)),
        outline: false,
      },
      properties: {
        seismicEventId: overlay.eventId,
        seismicMagnitude: overlay.magnitude,
      },
    });
    this.entitiesByKey.set(entityKey(overlay.eventId, ENTITY_KEYS.epicenter), epicenter);

    // P-wave ring — radius/opacity read live from this.currentOverlays.
    const pRingRadius = timeCoherentRadius(() => this.currentRadiusKm(overlay.eventId, 'p') * 1000);
    const pRingColor = new CallbackProperty(
      () => Color.fromCssColorString('#5599ff').withAlpha(this.currentOpacity(overlay.eventId, 'p')),
      false,
    );
    const pRing = this.dataSource.entities.add({
      id: entityKey(overlay.eventId, ENTITY_KEYS.pWave),
      position: Cartesian3.fromDegrees(overlay.lon, overlay.lat),
      ellipse: {
        semiMinorAxis: pRingRadius,
        semiMajorAxis: pRingRadius,
        height: 0,
        outline: true,
        outlineColor: pRingColor,
        outlineWidth: 1,
        fill: false,
      },
    });
    this.entitiesByKey.set(entityKey(overlay.eventId, ENTITY_KEYS.pWave), pRing);

    // S-wave ring — slightly thicker outline, red.
    const sRingRadius = timeCoherentRadius(() => this.currentRadiusKm(overlay.eventId, 's') * 1000);
    const sRingColor = new CallbackProperty(
      () => Color.fromCssColorString('#ff3344').withAlpha(this.currentOpacity(overlay.eventId, 's')),
      false,
    );
    const sRing = this.dataSource.entities.add({
      id: entityKey(overlay.eventId, ENTITY_KEYS.sWave),
      position: Cartesian3.fromDegrees(overlay.lon, overlay.lat),
      ellipse: {
        semiMinorAxis: sRingRadius,
        semiMajorAxis: sRingRadius,
        height: 0,
        outline: true,
        outlineColor: sRingColor,
        outlineWidth: 2,
        fill: false,
      },
    });
    this.entitiesByKey.set(entityKey(overlay.eventId, ENTITY_KEYS.sWave), sRing);
  }

  private currentRadiusKm(eventId: string, kind: 'p' | 's'): number {
    const overlay = this.currentOverlays.find((o) => o.eventId === eventId);
    if (!overlay) return 0;
    return kind === 'p' ? overlay.pWaveRadiusKm : overlay.sWaveRadiusKm;
  }

  private currentOpacity(eventId: string, kind: 'p' | 's'): number {
    const overlay = this.currentOverlays.find((o) => o.eventId === eventId);
    if (!overlay) return 0;
    return kind === 'p' ? overlay.pWaveOpacity : overlay.sWaveOpacity;
  }

  // ── Test hooks ───────────────────────────────────────────────────────

  /** @internal */
  __getEntityCount(): number {
    return this.entitiesByKey.size;
  }

  /** @internal */
  __hasEntity(eventId: string, suffix: 'epicenter' | 'p-wave' | 's-wave'): boolean {
    return this.entitiesByKey.has(entityKey(eventId, suffix));
  }
}
