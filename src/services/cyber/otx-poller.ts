/**
 * OTX (AlienVault) pulse poller — feeds the apt-tracker activity feed.
 *
 * apt-tracker.ts already owns the OtxPulse → AptActivityEvent
 * conversion via `matchPulseToGroup` + `pulseToActivityEvent`. This
 * module owns:
 *   - parsing the OTX API response envelope (`{results: Pulse[]}`)
 *   - dedup by pulse ID against a prior set
 *   - cursor management (max `modified` across the seen set)
 *
 * Pure functions only; the sidecar drives the periodic fetch.
 */

import type { OtxPulse } from './apt-tracker';

// ── Public types ───────────────────────────────────────────────────────

export interface OtxPollerState {
  /** Pulses currently retained, newest-first by `modified`. */
  pulses: OtxPulse[];
  /** ISO timestamp of the most recently observed pulse — sent as
   *  `modified_since` on the next request to skip already-seen pulses. */
  cursor: string | null;
}

export interface OtxIngestOptions {
  /** Hard cap on retained pulses. Default 200 per spec. */
  cap?: number;
}

// ── Constants ──────────────────────────────────────────────────────────

export const OTX_PULSES_DEFAULT_CAP = 200;

// ── Parser ─────────────────────────────────────────────────────────────

/**
 * Pull pulses out of an OTX API response. Tolerant of two shapes:
 *   - `{ results: Pulse[] }` (paginated list response)
 *   - `Pulse[]` (raw array response)
 */
export function parseOtxResponse(raw: unknown): OtxPulse[] {
  if (Array.isArray(raw)) return raw.filter((p) => isPulseLike(p)) as OtxPulse[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results.filter((p) => isPulseLike(p)) as OtxPulse[];
  }
  return [];
}

function isPulseLike(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as Record<string, unknown>).id === 'string'
    && ((value as Record<string, unknown>).id as string).length > 0;
}

// ── Initial state ──────────────────────────────────────────────────────

export function emptyOtxPollerState(): OtxPollerState {
  return { pulses: [], cursor: null };
}

// ── Ingest ─────────────────────────────────────────────────────────────

/**
 * Merge a fresh batch of pulses into the prior state, deduping by pulse
 * id and capping at `OTX_PULSES_DEFAULT_CAP` (newest-first by `modified`).
 * Pure function — returns a new state, doesn't mutate.
 */
export function ingestOtxPulses(
  prior: OtxPollerState,
  fresh: readonly OtxPulse[],
  options: OtxIngestOptions = {},
): OtxPollerState {
  const cap = options.cap ?? OTX_PULSES_DEFAULT_CAP;

  // Build a map by id; new pulses overwrite old (so an updated pulse
  // gets its newer fields).
  const byId = new Map<string, OtxPulse>();
  for (const pulse of prior.pulses) {
    if (pulse.id) byId.set(pulse.id, pulse);
  }
  for (const pulse of fresh) {
    if (pulse.id) byId.set(pulse.id, pulse);
  }

  // Sort newest-first by `modified` (fallback to `created`, then no
  // sort key → bottom). Cap.
  const merged = [...byId.values()].sort((a, b) => {
    const ka = pulseSortKey(a);
    const kb = pulseSortKey(b);
    return kb.localeCompare(ka);
  }).slice(0, cap);

  return { pulses: merged, cursor: maxModified(merged) };
}

function pulseSortKey(pulse: OtxPulse): string {
  return pulse.modified ?? pulse.created ?? '';
}

function maxModified(pulses: readonly OtxPulse[]): string | null {
  let best: string | null = null;
  for (const pulse of pulses) {
    const key = pulseSortKey(pulse);
    if (key && (best === null || key > best)) best = key;
  }
  return best;
}

// ── URL builder ────────────────────────────────────────────────────────

export interface OtxUrlOptions {
  modifiedSince?: string | null;
  limit?: number;
}

export function buildOtxSubscribedUrl(options: OtxUrlOptions = {}): string {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 50));
  if (options.modifiedSince) params.set('modified_since', options.modifiedSince);
  return `https://otx.alienvault.com/api/v1/pulses/subscribed?${params.toString()}`;
}

// ── Test hooks ─────────────────────────────────────────────────────────

export const __INTERNAL = {
  pulseSortKey,
  maxModified,
  isPulseLike,
};
