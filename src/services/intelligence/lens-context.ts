/**
 * Lens Context — when a Situation is active/selected, panels can filter
 * their view down to what is relevant: matching domains, within the
 * situation's geographic footprint, and inside a focus time window.
 *
 * Pure store + injectable Storage + injectable Situation lookup so unit
 * tests run without a DOM, without sessionStorage, and without the live
 * SituationStoreV2 singleton.
 *
 * Persists `activeSituationId` + `isPinned` to **sessionStorage** so the
 * lens is forgotten on a fresh app launch — session-scoped focus, not a
 * long-term preference.
 */

import { escapeHtml } from "@/utils/sanitize";
import type { Situation } from './situation-store-v2';
import type { ObservationEvent } from '@/types/intelligence';
import { getSituationStoreV2 } from './situation-store-v2';
import { getSavedPlacesFilterService } from './saved-places-filter';

// ── Public types ─────────────────────────────────────────────────────────

export interface LensFocusLocation {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface LensContext {
  activeSituationId: string | null;
  activeSituation: Situation | null;
  focusDomains: string[];
  focusLocation: LensFocusLocation | null;
  focusTimeWindowMs: number;
  isPinned: boolean;
}

export interface LensContextService {
  getContext(): LensContext;
  setActiveSituation(situationId: string | null): void;
  pin(): void;
  unpin(): void;
  subscribe(cb: (ctx: LensContext) => void): () => void;
  isRelevant(obs: ObservationEvent): boolean;
  isRelevantDomain(domain: string): boolean;
  filterObservations<T extends ObservationEvent>(obs: T[]): T[];
  getSituationSummaryHtml(): string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LensContextOptions {
  /** Override the sessionStorage backing — useful for tests. */
  storage?: StorageLike | null;
  /** Override the Situation lookup — defaults to the v2 singleton. */
  lookupSituation?: (id: string) => Situation | undefined;
  /** Override the clock — defaults to Date.now. */
  now?: () => number;
}

export const STORAGE_KEY = 'wm-lens-context';
export const DEFAULT_FOCUS_TIME_WINDOW_MS = 6 * 60 * 60_000;
const DEFAULT_RADIUS_KM = 500;

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#a626a4', high: '#e94f37', medium: '#f5a524', low: '#9ca3af',
};

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


function resolveSessionStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ss = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    if (ss && typeof ss.getItem === 'function') return ss;
  }
  return null;
}

function defaultLookup(id: string): Situation | undefined {
  try { return getSituationStoreV2().getSituation(id); }
  catch { return undefined; }
}

function focusDomainsFor(sit: Situation): string[] {
  return [...new Set([sit.domain, ...sit.relatedDomains])];
}

function focusLocationFor(sit: Situation): LensFocusLocation | null {
  if (!sit.location) return null;
  return {
    lat: sit.location.lat,
    lon: sit.location.lon,
    radiusKm: sit.location.radiusKm > 0 ? sit.location.radiusKm : DEFAULT_RADIUS_KM,
  };
}

function snapshotContext(state: InternalState): LensContext {
  return {
    activeSituationId: state.activeSituationId,
    activeSituation: state.activeSituation ? { ...state.activeSituation } : null,
    focusDomains: [...state.focusDomains],
    focusLocation: state.focusLocation ? { ...state.focusLocation } : null,
    focusTimeWindowMs: state.focusTimeWindowMs,
    isPinned: state.isPinned,
  };
}

interface InternalState {
  activeSituationId: string | null;
  activeSituation: Situation | null;
  focusDomains: string[];
  focusLocation: LensFocusLocation | null;
  focusTimeWindowMs: number;
  isPinned: boolean;
}

function emptyState(): InternalState {
  return {
    activeSituationId: null,
    activeSituation: null,
    focusDomains: [],
    focusLocation: null,
    focusTimeWindowMs: DEFAULT_FOCUS_TIME_WINDOW_MS,
    isPinned: false,
  };
}

function rehydrate(
  state: InternalState,
  storage: StorageLike | null,
  lookup: (id: string) => Situation | undefined,
): void {
  if (!storage) return;
  let parsed: unknown;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.isPinned === 'boolean') state.isPinned = obj.isPinned;
  if (typeof obj.activeSituationId === 'string') {
    const sit = lookup(obj.activeSituationId);
    if (sit) applySituationOn(state, sit);
  }
}

function applySituationOn(target: InternalState, sit: Situation): void {
  target.activeSituationId = sit.id;
  target.activeSituation = sit;
  target.focusDomains = focusDomainsFor(sit);
  target.focusLocation = focusLocationFor(sit);
}

export function createLensContextService(options: LensContextOptions = {}): LensContextService {
  const storage = resolveSessionStorage(options.storage);
  const lookup = options.lookupSituation ?? defaultLookup;
  const clock = options.now ?? (() => Date.now());
  const state: InternalState = emptyState();
  const listeners = new Set<(ctx: LensContext) => void>();

  rehydrate(state, storage, lookup);

  function clearSituation(target: InternalState): void {
    target.activeSituationId = null;
    target.activeSituation = null;
    target.focusDomains = [];
    target.focusLocation = null;
  }

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        activeSituationId: state.activeSituationId,
        isPinned: state.isPinned,
      }));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = snapshotContext(state);
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function isRelevantObservation(obs: ObservationEvent): boolean {
    if (state.activeSituationId === null) return true;
    if (state.focusDomains.length > 0 && !state.focusDomains.includes(obs.domain)) {
      return false;
    }
    if (state.focusLocation && obs.location) {
      const dist = haversineKm(
        state.focusLocation.lat, state.focusLocation.lon,
        obs.location.lat, obs.location.lon,
      );
      if (dist > state.focusLocation.radiusKm) return false;
    }
    const now = clock();
    if (now - obs.timestamp > state.focusTimeWindowMs) return false;
    return true;
  }

  return {
    getContext(): LensContext {
      return snapshotContext(state);
    },

    setActiveSituation(situationId): void {
      if (state.isPinned) return;
      if (situationId === null) {
        clearSituation(state);
        persist();
        notify();
        return;
      }
      const sit = lookup(situationId);
      if (!sit) return;
      applySituationOn(state, sit);
      persist();
      notify();
    },

    pin(): void {
      if (state.isPinned) return;
      state.isPinned = true;
      persist();
      notify();
    },

    unpin(): void {
      if (!state.isPinned) return;
      state.isPinned = false;
      persist();
      notify();
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    isRelevantDomain(domain): boolean {
      if (state.activeSituationId === null || state.focusDomains.length === 0) return true;
      return state.focusDomains.includes(domain);
    },

    isRelevant(obs): boolean {
      return isRelevantObservation(obs);
    },

    filterObservations<T extends ObservationEvent>(obs: T[]): T[] {
      // Saved-places filter stacks on top of the situation lens —
      // when a saved place is active, geographic proximity is
      // enforced regardless of whether a situation is selected.
      const proximityFiltered = applySavedPlacesProximityFilter(obs);
      if (state.activeSituationId === null) return proximityFiltered;
      return proximityFiltered.filter((o) => isRelevantObservation(o));
    },

    getSituationSummaryHtml(): string {
      const sit = state.activeSituation;
      if (!sit) return '';
      const sevColor = SEVERITY_COLOR[sit.severity] ?? '#9ca3af';
      const domainList = state.focusDomains.map((d) => escapeHtml(d)).join(', ');
      return `<div class="lens-banner-content" data-situation-id="${escapeHtml(sit.id)}" style="display:flex;align-items:center;gap:8px;font-size:11px;color:#ddd;">
        <span style="background:${sevColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(sit.severity)}</span>
        <span style="font-weight:600;">${escapeHtml(sit.name)}</span>
        <span style="opacity:0.6;">— focus: ${domainList}</span>
      </div>`;
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: LensContextService | null = null;

export function getLensContextService(): LensContextService {
  _singleton ??= createLensContextService();
  return _singleton;
}

export function _resetLensContextSingletonForTests(): void {
  _singleton = null;
}

// Module-scope helper so the lens stays robust when the saved-places
// filter singleton is in an unusual state — falling back to the
// unfiltered input preserves the original lens semantics.
function applySavedPlacesProximityFilter<T extends ObservationEvent>(observations: T[]): T[] {
  try {
    return getSavedPlacesFilterService().filterObservations(observations);
  } catch {
    return observations;
  }
}
