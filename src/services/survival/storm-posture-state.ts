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
    const priorFetchedAt = current?.freshness.find((f) => f.domain === 'weather')?.fetchedAtMs;
    // Real successful-fetch time when available; otherwise carry the prior
    // snapshot's fetch time so a failed/never-confirmed fetch stays honestly stale
    // (so the data-gap guard preserves a hydrated threat at grid-down startup).
    // Only fall back to `now` on a true cold start with no prior data at all.
    const weatherFetchedAtMs = nwsLastUpdate ? nwsLastUpdate.getTime() : (priorFetchedAt ?? now);
    const next = buildSnapshot({ weatherAlerts: alerts, savedPlaces: places, weatherFetchedAtMs, plan }, { now });

    // Survival guard: an EMPTY alert result must never clear an unexpired threat.
    // The feed returns [] + HTTP 200 on upstream failure (recorded as a "success",
    // so no freshness signal can tell failure from a real all-clear). Genuine
    // clears always arrive as NON-empty fetches — an NWS cancel message, or alerts
    // that simply no longer match a moved/removed place — so those update normally.
    // A truly empty fetch is treated as a possible data gap: keep the last posture
    // until the prior alerts expire on their own (a feed-independent signal).
    const fetchWasEmpty = rawAlerts.length === 0;
    const hadThreat = (current?.posture.overallLevel ?? 0) > 0;
    const nowAllClear = next.posture.overallLevel === 0;
    const priorUnexpired = current?.weatherAlerts.some((a) => Date.parse(a.expires) > now) ?? false;
    if (fetchWasEmpty && hadThreat && nowAllClear && priorUnexpired) {
      notify(); // keep last posture during a possible data gap; re-render so the stale banner ages
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
