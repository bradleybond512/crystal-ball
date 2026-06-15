// src/services/survival/storm-posture-state.ts
import { fetchNWSAlerts } from '../nws-alerts.ts';
import { getSavedPlaces } from '../saved-places.ts';
import { dataFreshness } from '../data-freshness.ts';
import { buildSnapshot } from './world-snapshot.ts';
import { commitMove } from './survival-plan.ts';
import { adaptLiveAlert, adaptSavedPlace, type LiveAlertInput } from './storm-posture-adapter.ts';
import { saveSnapshot, loadLatestSnapshot } from './snapshot-store.ts';
import type { SurvivalMove, WorldSnapshot } from './survival-types.ts';

let current: WorldSnapshot | null = null;
const listeners = new Set<() => void>();

function notify(): void { for (const l of listeners) { try { l(); } catch { /* isolate */ } } }

export function getStormSnapshot(): WorldSnapshot | null { return current; }

export function subscribeStormPosture(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function hydrateStormPosture(): Promise<void> {
  if (current) return;
  const saved = await loadLatestSnapshot();
  if (saved && !current) { current = saved; notify(); }
}

export async function refreshStormPosture(now = Date.now()): Promise<void> {
  try {
    const rawAlerts = await fetchNWSAlerts();
    const appPlaces = getSavedPlaces();
    const alerts = (rawAlerts as unknown as LiveAlertInput[]).map((a) => adaptLiveAlert(a));
    const places = appPlaces.map((p) => adaptSavedPlace(p));
    const plan = current?.plan;
    const nwsLastUpdate = dataFreshness.getSource('nws-alerts')?.lastUpdate;
    const weatherFetchedAtMs = nwsLastUpdate ? nwsLastUpdate.getTime() : now;
    const next = buildSnapshot({ weatherAlerts: alerts, savedPlaces: places, weatherFetchedAtMs, plan }, { now });

    // Survival guard: never erase a known threat because a refresh came back
    // empty (the alert feed returns [] on upstream failure with HTTP 200). Keep
    // the last snapshot while the prior alerts are still unexpired; only allow a
    // genuine all-clear once those alerts have expired.
    const hadThreat = (current?.posture.overallLevel ?? 0) > 0;
    const nowAllClear = next.posture.overallLevel === 0;
    const priorUnexpired = current?.weatherAlerts.some((a) => Date.parse(a.expires) > now) ?? false;
    if (hadThreat && nowAllClear && priorUnexpired) {
      notify(); // keep last posture, but re-render so the stale banner ages
      return;
    }

    current = next;
    notify();
    void saveSnapshot(next);
  } catch {
    // refresh failed — keep last snapshot
  }
}

export function commitStormMove(move: SurvivalMove, now = Date.now()): void {
  if (!current) return;
  const plan = commitMove(current.plan, move, now);
  const weatherFetchedAtMs = current.freshness.find((f) => f.domain === 'weather')?.fetchedAtMs ?? current.capturedAtMs;
  current = buildSnapshot(
    { weatherAlerts: current.weatherAlerts, savedPlaces: current.savedPlaces, weatherFetchedAtMs, plan },
    { now: current.capturedAtMs },
  );
  notify();
  void saveSnapshot(current);
}
