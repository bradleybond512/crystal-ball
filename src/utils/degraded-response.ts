/**
 * Shared helpers for the sidecar's degraded-response envelope.
 *
 * The sidecar emits `{ ok:true, data:[], items:[], degraded:true,
 * reason: "<source> is down" }` when an upstream API is unavailable.
 * Panels need to recognize that envelope and surface the reason
 * instead of either crashing on `null.cases` / `undefined.flights`,
 * or showing generic "loading" forever.
 *
 * Pure: structural shape inspection only. No network, no DOM.
 */

export interface DegradedEnvelope {
  degraded?: boolean;
  reason?: string;
  /** ISO timestamp the sidecar generated this response. */
  generatedAt?: string;
  /** Endpoint the panel was polling — useful for the user message. */
  endpoint?: string;
}

/**
 * Returns true when the payload looks like a sidecar degraded
 * response. Conservative: only `degraded === true` qualifies, so a
 * panel that returns its own `{degraded:false}` shape is unaffected.
 */
export function isDegradedResponse(payload: unknown): payload is DegradedEnvelope {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  return obj.degraded === true;
}

/**
 * Extract a human-readable reason from the envelope. Returns empty
 * string when the payload isn't degraded OR when the sidecar didn't
 * provide a `reason` field. Callers can fall back to their own
 * generic message in the empty case.
 */
export function degradedReason(payload: unknown): string {
  if (!isDegradedResponse(payload)) return '';
  const obj = payload as Record<string, unknown>;
  if (typeof obj.reason === 'string' && obj.reason.length > 0) return obj.reason;
  return '';
}

/**
 * Build a plain-English unavailable message panels can pass to
 * `showError(...)`. Includes the reason + an actionable hint that
 * the panel will retry on its normal cadence.
 */
export function degradedMessage(
  payload: unknown,
  options: { sourceLabel?: string; retryHint?: string } = {},
): string {
  const reason = degradedReason(payload);
  const source = options.sourceLabel ?? 'Source';
  const hint = options.retryHint ?? 'Will retry on the next refresh.';
  if (!reason) return `${source} unavailable. ${hint}`;
  return `${source} unavailable: ${reason}. ${hint}`;
}

/**
 * Convenience for panels that look at one upstream subsource and
 * want to detect the "all sources null" pattern (e.g. disease
 * outbreaks returning `{reliefweb: null, who: null}`).
 */
export function isAllSubsourcesNull(payload: unknown, keys: readonly string[]): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  if (keys.length === 0) return false;
  return keys.every((k) => obj[k] === null || obj[k] === undefined);
}
