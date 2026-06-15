// src/services/survival/storm-posture-state.ts
import { fetchNWSAlerts } from '../nws-alerts.ts';
import { getSavedPlaces } from '../saved-places.ts';
import { buildSnapshot } from './world-snapshot.ts';
import { availableMoves } from './survival-moves.ts';
import { commitMove, applyPlanToPosture } from './survival-plan.ts';
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
    const snap = buildSnapshot({ weatherAlerts: alerts, savedPlaces: places, weatherFetchedAtMs: now, plan }, { now });
    current = snap;
    notify();
    void saveSnapshot(snap);
  } catch {
    // refresh failed — keep last snapshot
  }
}

export function commitStormMove(move: SurvivalMove, now = Date.now()): void {
  if (!current) return;
  const plan = commitMove(current.plan, move, now);
  const moves = availableMoves(current.posture, current, { now });
  current = { ...current, plan, posture: applyPlanToPosture(current.posture, plan, moves) };
  notify();
  void saveSnapshot(current);
}
