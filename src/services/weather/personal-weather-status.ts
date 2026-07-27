/**
 * Holds the user's CURRENT personal weather threat — the worst Extreme/
 * Severe NWS alert matched to one of their saved places — so the composite
 * status chip (EEWStatusBar → SummaryStrip) can stop showing "ALL CLEAR"
 * during an actual storm over the user.
 *
 * Deliberately PERSONAL, not national: the national feed always has severe
 * weather somewhere, so feeding it into the chip would pin it non-clear and
 * cause alarm fatigue. The data-loader notification path (which already
 * matches each alert's polygon/zones against saved places) is the single
 * writer; it records the worst personal match per weather tick and clears
 * when nothing matches. The threat also self-expires so a missed clear
 * (e.g. the app was asleep) still lets the chip recover on its own.
 */

export type PersonalWeatherSeverity = 'extreme' | 'severe';

export interface PersonalWeatherThreat {
  severity: PersonalWeatherSeverity;
  /** Human label for the driving alert (e.g. "Tornado Warning"). */
  label: string;
  /** Epoch ms after which the threat is considered over (alert expiry). */
  expiresAt: number;
}

let current: PersonalWeatherThreat | null = null;

/**
 * Epoch ms at which a FRESH weather read last PROVED no matched threat — i.e.
 * the clear is confirmed, not merely unknown. `null` means we have never proven
 * clear (boot, or a stale/failed feed that could not authorize a clear). The
 * status chip uses this to tell apart "confirmed all-clear" (green) from "not
 * yet evaluated" (neutral CHECKING), so it never asserts safety it has not
 * verified. Invariant: whenever this is non-null, `current` is null.
 */
let clearConfirmedAt: number | null = null;

/** Notified whenever the threat changes so the composite status chip can
 *  refresh immediately instead of waiting for its next 30s poll. */
type ThreatListener = () => void;
const listeners = new Set<ThreatListener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Best-effort: one misbehaving subscriber must not stop the others (or
      // strand the writer). The status bar refresh is the only real listener.
    }
  }
}

/**
 * Subscribe to threat changes. Returns an unsubscribe function. The status bar
 * subscribes so a mid-poll match (e.g. a Tornado Warning) repaints the chip at
 * once rather than leaving "ALL CLEAR" up for up to 30 seconds.
 */
export function subscribePersonalWeatherThreat(listener: ThreatListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set (or clear, with `null`) the active personal weather threat. Setting a
 *  real threat un-confirms any prior clear: a new storm over the user means the
 *  earlier "all clear" no longer holds. */
export function setPersonalWeatherThreat(threat: PersonalWeatherThreat | null): void {
  current = threat;
  if (threat !== null) clearConfirmedAt = null;
  notify();
}

/**
 * The active personal weather threat, or `null` when there is none. Reads
 * self-heal: a threat whose expiry has passed is cleared and reported as
 * `null` so a stale storm can never keep the chip lit.
 */
export function getPersonalWeatherThreat(now: number = Date.now()): PersonalWeatherThreat | null {
  if (current && now >= current.expiresAt) {
    current = null;
    // Notify AFTER nulling so a subscriber re-reading here sees the cleared
    // state and the guard above is already false (no re-entrant notify).
    notify();
  }
  return current;
}

/** Explicitly clear the active threat. Notifies subscribers so the chip clears
 *  immediately, but only when there was actually a threat to clear (a redundant
 *  clear must not churn the status bar). Does NOT confirm the clear — an
 *  explicit clear is not the same as a fresh feed proving the area safe. */
export function clearPersonalWeatherThreat(): void {
  if (current === null) return;
  current = null;
  notify();
}

/**
 * Record that a FRESH weather read proved no matched threat: drop any active
 * threat AND mark the clear as confirmed so the chip may show a real "all
 * clear". Only the data-loader publication path (on a genuinely current feed)
 * calls this — a stale/failed feed must never prove clear. Notifies subscribers
 * when the state actually changes so the chip leaves the neutral CHECKING look.
 */
export function confirmPersonalWeatherClear(now: number = Date.now()): void {
  const changed = current !== null || clearConfirmedAt === null;
  current = null;
  clearConfirmedAt = now;
  if (changed) notify();
}

/**
 * Whether the personal weather clear is CONFIRMED (a fresh feed proved no
 * matched threat) versus merely unevaluated. Reads self-heal like
 * `getPersonalWeatherThreat`: a lapsed threat is expired here too, but expiry
 * alone never fabricates a confirmed clear — only `confirmPersonalWeatherClear`
 * does. The status chip uses this to stay neutral until weather is proven.
 */
export function isPersonalWeatherClearConfirmed(now: number = Date.now()): boolean {
  // Trigger the expiry self-heal so this read is consistent regardless of the
  // order the chip reads threat vs. confirmed-clear.
  getPersonalWeatherThreat(now);
  return clearConfirmedAt !== null;
}

/** One severe/extreme alert with its computed PERSONAL exposure — the input
 *  the data-loader hands the selector below (built from the same polygon/zone
 *  match the notification path already runs). */
export interface WeatherThreatCandidate {
  /** Raw NWS severity, e.g. 'Extreme' | 'Severe' | 'Moderate'. */
  severity: string;
  /** Human label for the alert (e.g. "Tornado Warning"). */
  event: string;
  /** Personal exposure 0–100 (higher = more directly over a saved place). */
  exposure: number;
  /** Epoch ms the alert expires. */
  expiresAt: number;
}

/**
 * Coerce an NWS alert's `expires` — which is a `Date` when freshly fetched but
 * an ISO STRING after the offline cache JSON round-trips it (and defensively a
 * number) — into an epoch-ms threat expiry. Falls back to `now + fallbackMs`
 * only when the value is genuinely unusable, so a matched storm gets its real
 * expiry (and can self-clear on time) instead of a blanket extra hour.
 */
export function resolveThreatExpiryMs(
  expires: unknown,
  now: number = Date.now(),
  fallbackMs: number = 60 * 60 * 1000,
): number {
  const parsed = toEpochMs(expires);
  return parsed ?? (now + fallbackMs);
}

function toEpochMs(expires: unknown): number | null {
  if (expires instanceof Date) {
    const ms = expires.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof expires === 'number') {
    return Number.isFinite(expires) ? expires : null;
  }
  if (typeof expires === 'string') {
    const ms = Date.parse(expires);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Decide whether — and with what value — to publish the chip threat this weather
 * tick, given the freshly-selected threat and whether the underlying feed was a
 * FRESH live read (vs a stale/offline-cache fallback).
 *
 * The data-loader derives the threat from whatever snapshot it has this tick. On
 * a stale offline snapshot that predates a new storm the candidate set is empty,
 * so a naive publish would `setPersonalWeatherThreat(null)` and assert "ALL
 * CLEAR" over a live warning — the reported bug, on the offline path.
 *
 * - A real MATCH always publishes: a warning matched over the user wins
 *   regardless of feed freshness.
 * - A CLEAR (`null`) is honored ONLY on a fresh read (`write: true, value: null`)
 *   so the chip drops a genuinely-passed storm. On a stale/failed feed the clear
 *   is SUPPRESSED (`write: false`); the caller leaves the prior threat in place
 *   and it self-expires on its own. A stale feed must never PROVE clear.
 */
export function decideThreatPublication(
  next: PersonalWeatherThreat | null,
  feedIsFresh: boolean,
): { write: boolean; value: PersonalWeatherThreat | null } {
  if (next) return { write: true, value: next };
  if (feedIsFresh) return { write: true, value: null };
  return { write: false, value: null };
}

const CANDIDATE_SEVERITY_RANK: Record<PersonalWeatherSeverity, number> = {
  extreme: 2,
  severe: 1,
};

/** Map a raw NWS severity onto our two-level personal severity, or `null` for
 *  anything below Severe (Moderate/Minor/Unknown never light the chip). */
const RAW_SEVERITY_MAP: Record<string, PersonalWeatherSeverity> = {
  Extreme: 'extreme',
  Severe: 'severe',
};

/**
 * Pick the WORST personal weather threat from the batch: the Extreme/Severe
 * alert whose personal exposure clears `exposureFloor` (the same Big Event
 * floor the notification path uses to decide a warning is over the user).
 * Extreme outranks Severe; ties keep the later-expiring alert so the chip
 * stays lit for the longest-lived threat. Returns `null` when nothing
 * matches, which the caller uses to clear the chip.
 */
export function selectPersonalWeatherThreat(
  candidates: readonly WeatherThreatCandidate[],
  exposureFloor: number,
): PersonalWeatherThreat | null {
  let best: PersonalWeatherThreat | null = null;
  for (const c of candidates) {
    if (c.exposure < exposureFloor) continue;
    const severity = RAW_SEVERITY_MAP[c.severity] ?? null;
    if (severity === null) continue;
    const rank = CANDIDATE_SEVERITY_RANK[severity];
    if (
      best === null ||
      rank > CANDIDATE_SEVERITY_RANK[best.severity] ||
      (rank === CANDIDATE_SEVERITY_RANK[best.severity] && c.expiresAt > best.expiresAt)
    ) {
      best = { severity, label: c.event, expiresAt: c.expiresAt };
    }
  }
  return best;
}
