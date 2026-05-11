/**
 * EEW renderer-side pusher — Layer 8.
 *
 * Runs the alert engine on a 30s tick:
 *   1. Pull current fused events + saved places from caller-supplied
 *      providers
 *   2. Run `evaluateEewAlerts` to produce alerts + updated ledger
 *   3. Filter alerts by tier toggles
 *   4. Escalate any TIER_5 to iMessage (best-effort, no retry)
 *   5. Push the resulting status snapshot to /api/eew-status
 *   6. Persist ledger + recent alerts via persistence module
 *
 * Best-effort. Errors swallowed. Web build is a no-op (no sidecar).
 */

import { isDesktopRuntime } from '../runtime';
import {
  type EewAlert,
  type EewTier,
  evaluateEewAlerts,
} from './eew-alert-engine';
import { applyOutcome, escalateTier5ToImessage } from './eew-imessage';
import {
  appendRecentAlerts,
  getInMemoryLedger,
  persistEewLedger,
  setInMemoryLedger,
} from './eew-ledger-persistence';
import { filterAlertsByTierToggles, getEewSettings } from './eew-settings';
import type { FusedSeismicEvent } from './seismic-fusion';
import type { SavedPlaceLite } from './shaking-estimator';

const ENDPOINT = '/api/eew-status';
const TICK_MS = 30 * 1000;

// ── Status payload (matches sidecar route shape) ───────────────────────

const TIER_RANK: Record<EewTier, number> = {
  TIER_1_INFO: 1,
  TIER_2_WATCH: 2,
  TIER_3_WARNING: 3,
  TIER_4_SEVERE: 4,
  TIER_5_EXTREME: 5,
};

export interface EewStatusPayload {
  activeAlerts: EewAlert[];
  highestTier: EewTier | null;
  lastEventId: string | null;
  asOf: number;
}

// ── Public API ─────────────────────────────────────────────────────────

export interface EewPusherDeps {
  getEvents: () => readonly FusedSeismicEvent[];
  getSavedPlaces: () => readonly SavedPlaceLite[];
  /** Inject for tests. Default uses fetch(ENDPOINT). */
  pushToSidecar?: (payload: EewStatusPayload) => Promise<void>;
  /** Inject for tests. */
  now?: () => number;
}

let started = false;
let tickHandle: ReturnType<typeof setInterval> | null = null;

export function startEewPusher(deps: EewPusherDeps): void {
  if (started) return;
  started = true;
  if (!isDesktopRuntime()) return;
  void runEewTick(deps);
  tickHandle = setInterval(() => { void runEewTick(deps); }, TICK_MS);
}

export function stopEewPusher(): void {
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  started = false;
}

/**
 * One iteration of the engine + push pipeline. Public for tests so
 * they don't have to wait for a real interval to fire.
 */
export async function runEewTick(deps: EewPusherDeps): Promise<void> {
  const now = (deps.now ?? Date.now)();
  const events = deps.getEvents();
  const savedPlaces = deps.getSavedPlaces();

  const settings = getEewSettings();

  // Run engine
  const { alerts, updatedLedger } = evaluateEewAlerts({
    events,
    savedPlaces,
    ledger: getInMemoryLedger(),
    nowMs: now,
  });

  // Filter by user tier toggles
  const filtered = filterAlertsByTierToggles(alerts, settings);

  // TIER_5 escalation — best effort, no retry
  const escalated: EewAlert[] = [];
  for (const alert of filtered) {
    if (alert.tier === 'TIER_5_EXTREME') {
      const outcome = await escalateTier5ToImessage(alert, now, {
        enabled: settings.imessageTier5Enabled,
      });
      escalated.push(applyOutcome(alert, outcome));
    } else {
      escalated.push(alert);
    }
  }

  // Update in-memory ledger + recent alerts
  setInMemoryLedger(updatedLedger);
  if (escalated.length > 0) appendRecentAlerts(escalated);

  // Persist (best effort)
  try {
    await persistEewLedger();
  } catch { /* silent */ }

  // Build status payload + push to sidecar (best effort)
  const payload: EewStatusPayload = {
    activeAlerts: escalated,
    highestTier: highestTierFromLedger(updatedLedger.events),
    lastEventId: escalated[escalated.length - 1]?.eventId ?? null,
    asOf: now,
  };
  const pusher = deps.pushToSidecar ?? defaultPusher;
  try { await pusher(payload); } catch { /* silent */ }
}

function highestTierFromLedger(
  events: Record<string, { highestTier: EewTier }>,
): EewTier | null {
  let best: EewTier | null = null;
  let bestRank = 0;
  for (const entry of Object.values(events)) {
    const rank = TIER_RANK[entry.highestTier];
    if (rank > bestRank) { bestRank = rank; best = entry.highestTier; }
  }
  return best;
}

async function defaultPusher(payload: EewStatusPayload): Promise<void> {
  await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
