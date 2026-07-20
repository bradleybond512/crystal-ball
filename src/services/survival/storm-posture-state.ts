// src/services/survival/storm-posture-state.ts
import { fetchNWSAlerts } from '../nws-alerts.ts';
import { getSavedPlaces } from '../saved-places.ts';
import { dataFreshness } from '../data-freshness.ts';
import { computeShortageFullSet, type ShortageSummaryEntry } from '../shortage/shortage-fullset.ts';
import {
  loadShortageInputsWithStatus,
  mergeShortageEntriesByFeedStatus,
  healthyCommodities,
  type ShortageFeedId,
} from '../shortage/shortage-input-bridge.ts';
import { buildSnapshot } from './world-snapshot.ts';
import { commitMove, applyPlanToPosture } from './survival-plan.ts';
import { computeMultiAxisPosture } from './survival-posture.ts';
import { makeWeatherContributor } from './weather-contributor.ts';
import { makeSupplyContributor } from './supply-contributor.ts';
import { makeFinancialContributor } from './financial-contributor.ts';
import { makeSecurityContributor } from './security-contributor.ts';
import { getForecastSnapshot } from '../mode-forecast';
import { availableMovesFrom } from './survival-moves.ts';
import { makeWeatherMoveProvider } from './weather-move-provider.ts';
import { makeSupplyMoveProvider } from './supply-move-provider.ts';
import { adaptLiveAlert, adaptSavedPlace, type LiveAlertInput } from './storm-posture-adapter.ts';
import { saveSnapshot, loadLatestSnapshot } from './snapshot-store.ts';
import type { PostureContributor } from './posture-contributor.ts';
import type { SurvivalMove, SurvivalPosture, WorldSnapshot } from './survival-types.ts';

// ── Shortage-entry TTL cache ────────────────────────────────────────────────
// The three shortage feeds (drought / chokepoint / grid) move slowly, but
// refreshStormPosture runs ~every 120s. Refetching them on every storm tick is
// wasteful, so cache the computed entries and only re-fetch (via
// loadShortageInputsWithStatus) when older than SHORTAGE_TTL_MS. Last-write-wins;
// no concurrency guard.
const SHORTAGE_TTL_MS = 15 * 60_000;
let cachedShortageEntries: ShortageSummaryEntry[] = [];
let cachedShortageAtMs = 0;
let hasShortageCache = false;

/** Decide how a refresh result interacts with the cached supply entries, now at
 *  per-feed granularity. Each shortage feed (drought / grid / chokepoint) reports
 *  its own health via `dataFreshness`, so we distinguish a FULL refresh, a PARTIAL
 *  outage, and a TOTAL outage:
 *
 *  - `'replace'`  — every feed is healthy → the fresh full set is authoritative.
 *  - `'merge'`    — a partial outage with a warm cache → keep the cached entry for
 *                   any commodity whose feed is down, refresh the rest
 *                   (`mergeShortageEntriesByFeedStatus`). This is the fix for the
 *                   gap where one dead feed used to downgrade its commodities to
 *                   baseline even though the others were fine.
 *  - `'keep'`     — a total outage with a warm cache → preserve all prior risk and
 *                   throttle the next retry.
 *  - `'passthrough'` — a COLD start (no cache) under anything short of a fully
 *                   clean refresh → return baseline but do NOT become authoritative,
 *                   so a hydrated snapshot's supply threats are preserved by
 *                   `supplyContributorForBase` (fail-closed). We refuse to seed the
 *                   cache from incomplete data and clobber a known risk.
 *
 *  Pure + exported so the decision is unit-testable. */
export type ShortageCacheAction = 'replace' | 'merge' | 'keep' | 'passthrough';
export function shortageCacheAction(
  gotAnyFeed: boolean,
  allFeedsOk: boolean,
  hasCache: boolean,
): ShortageCacheAction {
  if (allFeedsOk) return 'replace';
  if (!hasCache) return 'passthrough';
  return gotAnyFeed ? 'merge' : 'keep';
}

/** Returns the supply-axis shortage entries, refreshing from the live feeds only
 *  when the cache is empty or older than the TTL. Each feed reports its own health
 *  (see `loadShortageInputsWithStatus`), so a partial outage keeps the cached
 *  entries for the dead feed's commodities while refreshing the rest, and a total
 *  outage preserves the whole prior cache — never downgrading a known risk to
 *  baseline because a feed failed. `now` is injected for determinism. */
async function getSupplyEntries(now: number): Promise<ShortageSummaryEntry[]> {
  if (hasShortageCache && now - cachedShortageAtMs < SHORTAGE_TTL_MS) {
    return cachedShortageEntries;
  }
  let inputs: Awaited<ReturnType<typeof loadShortageInputsWithStatus>>['inputs'] = {};
  let feedsOk: Record<ShortageFeedId, boolean> = {
    'drought-monitor': false,
    'power-grid-alerts': false,
    'chokepoint-status': false,
  };
  try {
    const res = await loadShortageInputsWithStatus();
    inputs = res.inputs;
    feedsOk = res.feedsOk;
  } catch { /* leave all feeds marked failed */ }

  const gotAnyFeed = feedsOk['drought-monitor'] || feedsOk['power-grid-alerts'] || feedsOk['chokepoint-status'];
  const allFeedsOk = feedsOk['drought-monitor'] && feedsOk['power-grid-alerts'] && feedsOk['chokepoint-status'];
  const action = shortageCacheAction(gotAnyFeed, allFeedsOk, hasShortageCache);

  if (action === 'keep') {
    // Total outage with a warm cache — preserve all known risk; throttle next retry.
    // (Skip recomputing entirely so the all-baseline result can't pollute trend state.)
    cachedShortageAtMs = now;
    return cachedShortageEntries;
  }
  if (action === 'passthrough') {
    // Cold start under an incomplete refresh: return baseline WITHOUT becoming
    // authoritative, so `supplyContributorForBase` preserves any hydrated supply
    // threat (fail-closed). We refuse to seed the cache from partial/no data.
    return computeShortageFullSet(inputs, { now });
  }
  if (action === 'merge') {
    // Partial outage + warm cache: recompute ONLY the healthy-feed commodities (so
    // down-feed commodities never write a discarded baseline score into trend
    // memory), then keep cached entries for everything whose feed is down.
    const fresh = computeShortageFullSet(inputs, { now, only: healthyCommodities(feedsOk) });
    cachedShortageEntries = mergeShortageEntriesByFeedStatus(fresh, cachedShortageEntries, feedsOk);
  } else {
    // 'replace' — every feed healthy; the fresh full set is authoritative.
    cachedShortageEntries = computeShortageFullSet(inputs, { now });
  }
  cachedShortageAtMs = now;
  hasShortageCache = true;
  return cachedShortageEntries;
}

/** Yields the supply contributor to drive the supply axis. When the shortage
 *  cache has been populated by at least one live refresh, the live entries
 *  drive supply. Before that first refresh (e.g. a grid-down cold start after
 *  `hydrateStormPosture()`), the cache is empty but the persisted snapshot may
 *  still carry a supply threat — recomputing from `[]` would silently clear it.
 *  In that cold-cache case we fall back to the supply threats already present
 *  on the snapshot's posture (these survive grid-down via the persisted
 *  snapshot and are the original, unmitigated threats since `applyPlanToPosture`
 *  preserves each axis's `threats` array). */
export function supplyContributorForBase(base: WorldSnapshot | null): PostureContributor {
  if (hasShortageCache) return makeSupplyContributor(cachedShortageEntries);
  const existing = base?.posture.axes.find((a) => a.axis === 'supply')?.threats ?? [];
  return { id: 'supply', contribute: () => [...existing] };
}

/** Re-derive posture across weather + supply contributors, then re-apply the
 *  committed plan once on the fresh base. Weather behavior is unchanged: the
 *  same weather contributor + weather moves feed in; supply is additive. It also
 *  adds the financial and security contributors (from mode-forecast) when a
 *  forecast snapshot is present. The base is computed without the plan and the plan is applied
 *  exactly once, so this never double-counts the committed move effects. The
 *  supply contributor is built from `supplyBase` (the snapshot whose persisted
 *  supply threats are the cold-cache fallback). */
function withSupplyPosture(snapshot: WorldSnapshot, now: number, supplyBase: WorldSnapshot | null): WorldSnapshot {
  const forecast = getForecastSnapshot();
  const base: SurvivalPosture = computeMultiAxisPosture({
    contributors: [
      makeWeatherContributor(snapshot.weatherAlerts, snapshot.savedPlaces),
      supplyContributorForBase(supplyBase),
      ...(forecast ? [makeFinancialContributor(forecast), makeSecurityContributor(forecast)] : []),
    ],
    freshness: snapshot.freshness,
    capturedAtMs: snapshot.capturedAtMs,
  }, { now });

  if (snapshot.plan.committed.length === 0) return { ...snapshot, posture: base };

  const moves = availableMovesFrom(
    [makeWeatherMoveProvider(), makeSupplyMoveProvider()],
    base,
    now,
  );
  return { ...snapshot, posture: applyPlanToPosture(base, snapshot.plan, moves) };
}

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
    // Weather-only base snapshot first: the survival/all-clear guard below
    // must stay weather-driven (supply is a slow-moving baseline that would
    // otherwise keep overallLevel > 0 and defeat the all-clear detection).
    const weatherOnly = buildSnapshot({ weatherAlerts: alerts, savedPlaces: places, weatherFetchedAtMs, plan }, { now });

    // Survival guard: an upstream FAILURE must never clear an unexpired threat,
    // but a genuine all-clear must. The sidecar now signals upstream failure with
    // HTTP 503 (instead of []+200), so `dataFreshness` records an error and
    // `lastUpdate` does NOT advance — only a confirmed successful fetch advances it.
    // We treat the fetch as confirmed-fresh only when that timestamp is recent.
    // On a confirmed-fresh all-clear (incl. an NWS cancel that dropped the alert
    // from /active) we DO clear. Only a failure/outage keeps the prior posture
    // until the prior alerts expire on their own (a feed-independent signal).
    const freshThisCycle = nwsLastUpdate != null && (now - nwsLastUpdate.getTime()) < 5 * 60_000;
    const priorWeatherLevel = current
      ? (current.posture.axes.find((a) => a.axis === 'physical_safety')?.level ?? 0)
      : 0;
    const hadThreat = priorWeatherLevel > 0;
    const nowAllClear = (weatherOnly.posture.axes.find((a) => a.axis === 'physical_safety')?.level ?? 0) === 0;
    const priorUnexpired = current?.weatherAlerts.some((a) => Date.parse(a.expires) > now) ?? false;
    if (!freshThisCycle && hadThreat && nowAllClear && priorUnexpired) {
      notify(); // keep last posture during a failure/data gap; re-render so the stale banner ages
      return;
    }

    // Thread supply into the stored snapshot after the weather-driven guard.
    // Live shortage feeds (TTL-cached) drive the supply axis; a feed failure
    // degrades to baseline inside getSupplyEntries. Once this resolves the cache
    // is populated, so withSupplyPosture uses the live entries (not the fallback).
    await getSupplyEntries(now);
    const next = withSupplyPosture(weatherOnly, now, current);
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
  const rebuilt = buildSnapshot(
    { weatherAlerts: current.weatherAlerts, savedPlaces: current.savedPlaces, weatherFetchedAtMs, plan },
    { now: current.capturedAtMs },
  );
  // Reuse the last cached supply entries (commit only re-applies an already-
  // committed plan; it never needs a fresh shortage fetch). Before the first
  // live refresh populates the cache (grid-down cold start), fall back to the
  // current snapshot's persisted supply threats so committing a move doesn't
  // clear a hydrated supply axis.
  current = withSupplyPosture(rebuilt, current.capturedAtMs, current);
  notify();
  void saveSnapshot(current);
}
