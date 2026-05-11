/**
 * Mission State Service — maps feed staleness to an overall
 * operational posture: NOMINAL / DEGRADED / CRITICAL.
 *
 * Rules:
 *   - ≥3 critical feeds stale  → CRITICAL
 *   - ≥5 any feeds stale       → DEGRADED
 *   - otherwise                → NOMINAL
 *
 * Critical feeds are the five highest-impact data sources:
 *   usgs (earthquakes), nws-alerts, firms (wildfire),
 *   ais (vessels), space-weather.
 *
 * Reads from the shared dataFreshness singleton — no fetch, no DOM.
 * Dispatches `wm:mission-state-changed` on the document when state
 * transitions (browser-only; safe to call from SSR / Node tests).
 */

import { dataFreshness, type DataSourceId, type DataSourceState } from '@/services/data-freshness';

// ── Types ────────────────────────────────────────────────────────────────

export type MissionState = 'NOMINAL' | 'DEGRADED' | 'CRITICAL';

export interface MissionStateDetail {
  state: MissionState;
  staleFeedCount: number;
  criticalStaleFeedCount: number;
  /** Display names of all stale feeds (not just the critical ones). */
  staleFeedNames: string[];
}

export interface MissionStateChangedDetail {
  state: MissionState;
  previous: MissionState;
}

// ── Constants ────────────────────────────────────────────────────────────

const CRITICAL_FEED_IDS = new Set<DataSourceId>([
  'usgs',
  'nws-alerts',
  'firms',
  'ais',
  'space-weather',
]);

const STALE_STATUSES = new Set(['stale', 'very_stale', 'no_data', 'error']);

// ── Module state ─────────────────────────────────────────────────────────

let lastState: MissionState | undefined;
let _sourcesOverride: (() => DataSourceState[]) | undefined;

// ── Public API ───────────────────────────────────────────────────────────

export function getMissionStateDetail(): MissionStateDetail {
  const sources = (_sourcesOverride ?? (() => dataFreshness.getAllSources()))();

  const staleCritical = sources.filter(
    (s) => CRITICAL_FEED_IDS.has(s.id) && STALE_STATUSES.has(s.status),
  );
  const staleAll = sources.filter(
    (s) => s.status !== 'disabled' && STALE_STATUSES.has(s.status),
  );

  let state: MissionState;
  if (staleCritical.length >= 3) {
    state = 'CRITICAL';
  } else if (staleAll.length >= 5) {
    state = 'DEGRADED';
  } else {
    state = 'NOMINAL';
  }

  if (lastState !== undefined && state !== lastState) {
    _dispatchStateChange(state, lastState);
  }
  lastState = state;

  return {
    state,
    staleFeedCount: staleAll.length,
    criticalStaleFeedCount: staleCritical.length,
    staleFeedNames: staleAll.map((s) => s.name),
  };
}

export function getMissionState(): MissionState {
  return getMissionStateDetail().state;
}

/** Reset module state. Tests only. */
export function _resetMissionState(): void {
  lastState = undefined;
  _sourcesOverride = undefined;
}

/** Override the sources provider. Tests only. */
export function _setSourcesOverride(fn: (() => DataSourceState[]) | undefined): void {
  _sourcesOverride = fn;
}

// ── Internal ─────────────────────────────────────────────────────────────

function _dispatchStateChange(state: MissionState, previous: MissionState): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent<MissionStateChangedDetail>('wm:mission-state-changed', {
      detail: { state, previous },
    }),
  );
}
