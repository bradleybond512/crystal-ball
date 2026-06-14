// src/services/survival/world-snapshot.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { DomainFreshness, SurvivalPlan, SurvivalPosture, WorldSnapshot } from './survival-types.ts';
import { axisLabel } from './survival-types.ts';
import { emptyPlan } from './survival-plan.ts';
import { applyPlanToPosture } from './survival-plan.ts';
import { computePosture } from './survival-posture.ts';
import { availableMoves } from './survival-moves.ts';

export const SNAPSHOT_VERSION = 1;
const DEFAULT_STALE_AFTER_MS = 15 * 60_000;

export interface SnapshotInputs {
  weatherAlerts: readonly NwsAlertMinimal[];
  savedPlaces: readonly SavedPlace[];
  weatherFetchedAtMs: number;
  plan?: SurvivalPlan;
}

export interface SnapshotOptions {
  now?: number;
  staleAfterMs?: number;
}

export function buildSnapshot(inputs: SnapshotInputs, options: SnapshotOptions = {}): WorldSnapshot {
  const now = options.now ?? Date.now();
  const staleAfter = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const ageMs = now - inputs.weatherFetchedAtMs;
  const freshness: DomainFreshness[] = [{
    domain: 'weather',
    fetchedAtMs: inputs.weatherFetchedAtMs,
    ageMs,
    ok: ageMs <= staleAfter,
  }];

  const weatherAlerts = [...inputs.weatherAlerts];
  const savedPlaces = [...inputs.savedPlaces];
  const basePosture: SurvivalPosture = computePosture({ weatherAlerts, savedPlaces, freshness, capturedAtMs: now }, { now });
  const plan = inputs.plan ?? emptyPlan();
  const baseSnapshot: WorldSnapshot = {
    version: SNAPSHOT_VERSION,
    capturedAtMs: now,
    freshness,
    weatherAlerts,
    savedPlaces,
    posture: basePosture,
    plan,
  };

  if (plan.committed.length === 0) return baseSnapshot;

  const moves = availableMoves(basePosture, baseSnapshot, { now });
  const posture = applyPlanToPosture(basePosture, plan, moves);
  return { ...baseSnapshot, posture };
}

export function serializeSnapshot(snapshot: WorldSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserializeSnapshot(json: string): WorldSnapshot {
  const parsed = JSON.parse(json) as WorldSnapshot;
  if (parsed.version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version ${parsed.version}`);
  }
  return parsed;
}

export interface StormPostureView {
  posture: SurvivalPosture;
  weatherAgeMs: number;
  isStale: boolean;
  worstAxisLabel: string;
}

/** Project a (possibly offline / stale) snapshot into the view the UI renders.
 *  Needs no live inputs — this is the grid-down guarantee. */
export function projectView(snapshot: WorldSnapshot, options: { now?: number } = {}): StormPostureView {
  const now = options.now ?? snapshot.capturedAtMs;
  const weather = snapshot.freshness.find((f) => f.domain === 'weather');
  const weatherAgeMs = weather ? now - weather.fetchedAtMs : 0;
  const isStale = weather ? weatherAgeMs > DEFAULT_STALE_AFTER_MS : true;

  const staleNote = `weather feed stale (${Math.round(weatherAgeMs / 60_000)} min old)`;
  const posture = isStale && !snapshot.posture.staleInputs.some((s) => s.includes('weather'))
    ? { ...snapshot.posture, staleInputs: [...snapshot.posture.staleInputs, staleNote] }
    : snapshot.posture;

  return {
    posture,
    weatherAgeMs,
    isStale,
    worstAxisLabel: axisLabel(snapshot.posture.worstAxis),
  };
}
