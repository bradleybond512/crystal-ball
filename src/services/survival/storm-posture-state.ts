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

    // Survival guard: never erase a known threat because of a DATA GAP. The alert
    // feed returns [] on upstream failure with HTTP 200, so an outage can look like
    // "all clear". Only keep the last posture when the weather data is actually
    // STALE (the fetch did not refresh) AND prior alerts are still unexpired. A
    // legitimate all-clear on FRESH data (NWS canceled the alert, or the affected
    // place was moved/removed) updates normally.
    const hadThreat = (current?.posture.overallLevel ?? 0) > 0;
    const nowAllClear = next.posture.overallLevel === 0;
    const priorUnexpired = current?.weatherAlerts.some((a) => Date.parse(a.expires) > now) ?? false;
    const weatherStale = !(next.freshness.find((f) => f.domain === 'weather')?.ok ?? false);
    if (hadThreat && nowAllClear && priorUnexpired && weatherStale) {
      notify(); // keep last posture during a data gap, but re-render so the stale banner ages
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
