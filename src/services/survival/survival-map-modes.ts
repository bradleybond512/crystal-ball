// src/services/survival/survival-map-modes.ts
/**
 * Survival map-modes controller (E4 glue).
 *
 * Holds the set of active `SurvivalAxis` modes and folds `resolveLayerVisibility`
 * onto a host's live `MapLayers` state. Engaging the first mode snapshots the
 * user's current layers as the baseline; toggles recompute from that baseline
 * (so unmanaged base-map layers stay exactly as the user had them); clearing all
 * modes restores the baseline. The host injects get/set so this stays testable
 * with no DeckGL/DOM import.
 */
import type { MapLayers } from '../../types/index.ts';
import type { SurvivalAxis } from './survival-types.ts';
import { applyModeVisibility } from './map-modes-apply.ts';
import { toggleMode, isolateMode } from './map-modes.ts';

export interface MapModeHost {
  getLayers(): MapLayers;
  /** Push the new layer state to the map. `persist` is true ONLY on
   *  clear/restore — a mode's temporary filtered view must NOT be written to the
   *  user's saved layer preferences, or a reload while a mode is active would
   *  boot the map filtered with no chip/Clear to undo it. */
  setLayers(next: MapLayers, persist: boolean): void;
}

export interface SurvivalMapModes {
  active(): readonly SurvivalAxis[];
  isActive(axis: SurvivalAxis): boolean;
  toggle(axis: SurvivalAxis): void;
  isolate(axis: SurvivalAxis): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

export function createSurvivalMapModes(host: MapModeHost): SurvivalMapModes {
  let active: SurvivalAxis[] = [];
  let baseline: MapLayers | null = null;
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const l of listeners) l(); };

  const applyActive = (): void => {
    const base = baseline ?? host.getLayers();
    host.setLayers(applyModeVisibility(base, active), false); // transient view — don't persist
    emit();
  };

  return {
    active: () => active,
    isActive: (axis) => active.includes(axis),
    toggle(axis) {
      if (active.length === 0) baseline = { ...host.getLayers() };
      active = toggleMode(active, axis);
      if (active.length === 0) { this.clear(); return; }
      applyActive();
    },
    isolate(axis) {
      if (active.length === 0) baseline = { ...host.getLayers() };
      active = isolateMode(axis);
      applyActive();
    },
    clear() {
      active = [];
      if (baseline) { host.setLayers(baseline, true); baseline = null; } // restore + persist
      emit();
    },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

// ── Singleton (host injected once at boot by panel-layout) ─────────────────

let singleton: SurvivalMapModes | null = null;

/** Install the app's DeckGL-backed host. Called once during bootstrap. */
export function setMapModeHost(host: MapModeHost): SurvivalMapModes {
  singleton = createSurvivalMapModes(host);
  return singleton;
}

/** The active controller, or null before the host is installed (e.g. tests,
 *  or the map not yet mounted) — callers no-op when null. */
export function survivalMapModes(): SurvivalMapModes | null {
  return singleton;
}
