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

/** Set (or clear, with `null`) the active personal weather threat. */
export function setPersonalWeatherThreat(threat: PersonalWeatherThreat | null): void {
  current = threat;
  notify();
}

/**
 * The active personal weather threat, or `null` when there is none. Reads
 * self-heal: a threat whose expiry has passed is cleared and reported as
 * `null` so a stale storm can never keep the chip lit.
 */
export function getPersonalWeatherThreat(now: number = Date.now()): PersonalWeatherThreat | null {
  if (current && now >= current.expiresAt) current = null;
  return current;
}

/** Explicitly clear the active threat. */
export function clearPersonalWeatherThreat(): void {
  current = null;
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
