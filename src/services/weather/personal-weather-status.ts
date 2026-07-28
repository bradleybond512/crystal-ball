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
 * How long a confirmed clear stays trustworthy before it must be re-proven.
 * The status chip treats `isPersonalWeatherClearConfirmed()` as its ONLY
 * freshness signal — it no longer re-reads the shared NWS circuit-breaker
 * timestamp, which any unrelated re-fetch (e.g. the Air & Smoke panel) can
 * advance without the alert matcher ever running again. So the proof carries
 * its own staleness bound: matched to the weather-feed TTL, once the loader has
 * not re-proved clear within this window the confirmation lapses and the chip
 * falls back to neutral rather than asserting an all-clear it can no longer
 * vouch for (the app slept, the weather task stalled, NWS went unreachable).
 */
export const PERSONAL_WEATHER_CLEAR_TTL_MS = 30 * 60 * 1000;

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
 * Revoke a prior confirmed clear WITHOUT fabricating a threat: the loader calls
 * this when it gets a fresh feed it could not fully evaluate (a degraded zone
 * lookup or a crashed exposure match), so a standing "all clear" over an
 * unevaluated feed must drop to neutral. Only touches `clearConfirmedAt`; an
 * active threat (mutually exclusive with a confirmed clear) is never disturbed.
 * Notifies only when it actually changed so a redundant revoke does not churn
 * the chip.
 */
export function revokePersonalWeatherClearConfirmation(): void {
  if (clearConfirmedAt === null) return;
  clearConfirmedAt = null;
  notify();
}

/**
 * Whether the personal weather clear is CONFIRMED (a fresh feed proved no
 * matched threat) versus merely unevaluated. Reads self-heal like
 * `getPersonalWeatherThreat`: a lapsed threat is expired here too, but expiry
 * alone never fabricates a confirmed clear — only `confirmPersonalWeatherClear`
 * does. A confirmed clear also self-expires once it is older than
 * `PERSONAL_WEATHER_CLEAR_TTL_MS`, so a proof the loader can no longer refresh
 * (app asleep, weather task stalled, NWS unreachable) lapses to neutral instead
 * of lingering as a false all-clear. A proof stamped in the FUTURE relative to
 * `now` (a backward clock step after the confirm) is likewise untrustworthy and
 * fails closed — otherwise its negative age would sit below the TTL forever. The
 * status chip uses this as its sole freshness signal, so it stays neutral until
 * weather is proven AND current.
 */
export function isPersonalWeatherClearConfirmed(now: number = Date.now()): boolean {
  // Trigger the expiry self-heal so this read is consistent regardless of the
  // order the chip reads threat vs. confirmed-clear.
  getPersonalWeatherThreat(now);
  if (clearConfirmedAt !== null) {
    // Expire on age OUT of the trustworthy [0, TTL) window. A NEGATIVE age means
    // the proof was stamped in the future relative to `now` — a backward clock
    // step (NTP correction, manual clock set) after the confirm. A naive
    // `>= TTL` check treats that negative age as "still fresh" and would pin a
    // false ALL CLEAR indefinitely while the weather task is stalled. A future
    // stamp cannot be vouched for, so fail closed to neutral just like a lapsed
    // one. Only the normal forward window (0 ≤ age < TTL) keeps the clear proven.
    const age = now - clearConfirmedAt;
    if (age < 0 || age >= PERSONAL_WEATHER_CLEAR_TTL_MS) {
      // Null BEFORE notifying so a subscriber re-reading here sees the lapsed
      // state and this branch is already false (no re-entrant notify).
      clearConfirmedAt = null;
      notify();
    }
  }
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
 * What the data-loader should do with the chip state this weather tick.
 * - `publish`             — write the matched threat (always wins).
 * - `confirm_clear`       — a fresh, fully-evaluated feed proved no threat.
 * - `revoke_confirmation` — a feed we could NOT trust for a clear (stale /
 *                           unavailable, OR fresh-but-degraded matching); drop
 *                           any prior confirmed clear to neutral.
 */
export type ThreatPublicationDecision =
  | { action: 'publish'; value: PersonalWeatherThreat }
  | { action: 'confirm_clear' }
  | { action: 'revoke_confirmation' };

/**
 * Decide what to do with the chip state this weather tick, given the
 * freshly-selected threat, whether the underlying feed was a FRESH live read
 * (vs a stale/offline-cache fallback), and whether the match pipeline ran to
 * completion (no degraded zone lookup, no crashed exposure match).
 *
 * The data-loader derives the threat from whatever snapshot it has this tick. On
 * a stale offline snapshot that predates a new storm the candidate set is empty,
 * so a naive publish would `setPersonalWeatherThreat(null)` and assert "ALL
 * CLEAR" over a live warning — the reported bug, on the offline path.
 *
 * - A real MATCH always publishes: a warning matched over the user wins
 *   regardless of feed freshness or a degraded match elsewhere.
 * - A CLEAR (`null`) is only CONFIRMED on a fresh read whose matching completed,
 *   so the chip drops a genuinely-passed storm.
 * - A CLEAR on a fresh read whose matching DEGRADED is not trustworthy (a
 *   zone-only warning could hide behind the failed lookup): REVOKE any prior
 *   confirmed clear so the chip goes neutral instead of asserting an all-clear
 *   over a feed it could not evaluate.
 * - A CLEAR on a STALE/unavailable feed also REVOKES any prior confirmed clear:
 *   isWeatherFeedFresh goes false the moment the NWS breaker is unavailable, and
 *   a green chip must not ride a feed we can no longer read (it otherwise stood
 *   until the 30-min clear TTL lapsed — a stale all-clear over a live storm). A
 *   stale feed must never PROVE clear, and must not let a prior proof stand.
 *   `revokePersonalWeatherClearConfirmation` is a guarded no-op when nothing is
 *   standing, so this never disturbs an active threat or churns a neutral chip.
 */
export function decideThreatPublication(
  next: PersonalWeatherThreat | null,
  feedIsFresh: boolean,
  matchingComplete: boolean,
): ThreatPublicationDecision {
  if (next) return { action: 'publish', value: next };
  if (!feedIsFresh || !matchingComplete) return { action: 'revoke_confirmation' };
  return { action: 'confirm_clear' };
}

/** Inputs the data-loader captures over its severe-alert evaluation, fed into
 *  {@link isWeatherMatchingComplete}. */
export interface WeatherMatchingState {
  /** Extreme/Severe alerts on this feed. */
  severeAlertCount: number;
  /** Saved places the user has to match alerts against. */
  savedPlaceCount: number;
  /** A per-place UGC zone lookup failed this tick (zone picture incomplete). */
  zonesDegraded: boolean;
  /** Severe alerts with no usable polygon — they can ONLY match via the zone
   *  fallback, so a degraded zone lookup could hide them. */
  zoneOnlySevereAlertCount: number;
  /** An exposure match crashed or an alert was spatially unevaluable. */
  matchDegraded: boolean;
  /** The saved-place match set changed while the async evaluation was in flight. */
  placesChangedDuringEval: boolean;
}

/**
 * Whether this weather tick's match pipeline ran to completion — the
 * `matchingComplete` input {@link decideThreatPublication} uses to tell a proven
 * clear from a "could not fully evaluate, go neutral". `false` withholds the
 * clear (revoke to neutral CHECKING); `true` lets an empty feed prove clear.
 *
 * Incomplete when ANY of:
 * - `matchDegraded` — an exposure match crashed or an alert was unevaluable.
 * - `placesChangedDuringEval` — the match set changed mid-evaluation, so the
 *   clear was computed against a stale set (a newly-added place under a warning
 *   was never evaluated).
 * - a severe alert exists but the user has NO saved places — it is unplaceable,
 *   so the exposure sentinel keeps the selector silent and the tick reads clean
 *   even though a live severe warning is on the feed (the false ALL CLEAR).
 * - the zone lookup degraded AND a zone-only severe alert is on the feed — that
 *   alert could only have matched via the fallback that just failed, so its
 *   "no match" is not trustworthy.
 *
 * It must NOT over-block: an all-clear feed (no severe alerts) proves clear even
 * with no saved places or a degraded zone lookup — there is nothing severe
 * anywhere to have missed, and freezing the chip at CHECKING forever would just
 * desensitize the user.
 */
export function isWeatherMatchingComplete(state: WeatherMatchingState): boolean {
  if (state.matchDegraded) return false;
  if (state.placesChangedDuringEval) return false;
  if (state.severeAlertCount > 0 && state.savedPlaceCount === 0) return false;
  if (state.zonesDegraded && state.zoneOnlySevereAlertCount > 0) return false;
  return true;
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
 *
 * Already-expired candidates (expiry at/before `now`) are excluded BEFORE
 * ranking: an expired Extreme must not outrank a still-active Severe, win
 * selection, then self-clear the instant getPersonalWeatherThreat sees it past
 * expiry — silently dropping the genuine Severe warning over the user. `now`
 * defaults to Date.now() and matches getPersonalWeatherThreat's self-clear
 * boundary (at/after expiry is not live).
 */
export function selectPersonalWeatherThreat(
  candidates: readonly WeatherThreatCandidate[],
  exposureFloor: number,
  now: number = Date.now(),
): PersonalWeatherThreat | null {
  let best: PersonalWeatherThreat | null = null;
  for (const c of candidates) {
    if (c.expiresAt <= now) continue;
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

/**
 * The chip's own exposure floor is capped here, independent of the Big Event
 * detector's auto-tunable `exposureFloor` (default 70, tuner may raise to 90).
 * The chip is a safety indicator, not the calibrated notification threshold: a
 * raised detector floor must never blind it to a Severe/Extreme alert whose
 * personal exposure lands in the 70-89 band.
 */
export const PERSONAL_CHIP_EXPOSURE_FLOOR = 70;

/**
 * Clamp the detector's (possibly tuned-up) exposure floor to the chip's cap so
 * the chip stays at least as sensitive as PERSONAL_CHIP_EXPOSURE_FLOOR, while
 * still following the detector DOWN when it is more sensitive — never LESS
 * sensitive than the detector in either direction.
 */
export function chipExposureFloor(detectorFloor: number): number {
  return Math.min(detectorFloor, PERSONAL_CHIP_EXPOSURE_FLOOR);
}
