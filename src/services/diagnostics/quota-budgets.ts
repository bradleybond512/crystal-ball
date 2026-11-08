/**
 * API budgets (R4-BUG-005 step 2): the sidecar's Quota Governor reports, per
 * quota-limited provider, how much of each rolling window has been used,
 * where background refreshes stop (80%), and any cooldown a provider asked
 * for. This module fetches and validates that report for System Diagnostic.
 * The payload carries counts, limits and times only — no keys or URLs — and
 * every field is checked before it reaches the renderer.
 */
import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

export type QuotaState = 'ok' | 'paced' | 'background_paused' | 'cooldown';

export interface QuotaWindowStatus {
  windowMs: number;
  limit: number | null;
  backgroundCeiling: number | null;
  used: number;
}

export interface QuotaProviderStatus {
  id: string;
  label: string;
  unit: string;
  estimate: boolean;
  unverified: boolean;
  observeOnly: boolean;
  state: QuotaState;
  windows: QuotaWindowStatus[];
  cooldownUntil: number | null;
  cooldownReason: string | null;
  budgetFreesAt: number | null;
  providerRemaining: { value: number; at: number } | null;
  last429At: number | null;
  tokens?: number;
}

export interface QuotaStatusReport {
  asOf: number;
  targetShare: number;
  providers: QuotaProviderStatus[];
  throttledHosts: { host: string; until: number }[];
}

export type QuotaStatusResult = { ok: true; report: QuotaStatusReport } | { ok: false; error: string };

const STATES = new Set<QuotaState>(['ok', 'paced', 'background_paused', 'cooldown']);
const MAX_PROVIDERS = 64;
const MAX_TEXT = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
function timestamp(value: unknown): value is number { return nonnegative(value) && value <= 8.64e15; }
function nullableTimestamp(value: unknown): value is number | null { return value === null || timestamp(value); }
function nullableNumber(value: unknown): value is number | null { return value === null || nonnegative(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT; }
function parseWindow(raw: unknown): QuotaWindowStatus | null {
  if (!isRecord(raw) || !nonnegative(raw.windowMs) || raw.windowMs === 0 || !nonnegative(raw.used) || !nullableNumber(raw.limit) || !nullableNumber(raw.backgroundCeiling)) return null;
  if (raw.limit === null ? raw.backgroundCeiling !== null : raw.limit === 0 || raw.backgroundCeiling === null || raw.backgroundCeiling > raw.limit) return null;
  return { windowMs: raw.windowMs, used: raw.used, limit: raw.limit, backgroundCeiling: raw.backgroundCeiling };
}
function parseProvider(raw: unknown): QuotaProviderStatus | null {
  if (!isRecord(raw) || !text(raw.id) || !text(raw.label) || !text(raw.unit) || !STATES.has(raw.state as QuotaState)) return null;
  if (![raw.estimate, raw.unverified, raw.observeOnly].every(v => typeof v === 'boolean')) return null;
  if (!Array.isArray(raw.windows) || raw.windows.length === 0 || raw.windows.length > 8) return null;
  const windows = raw.windows.map(w => parseWindow(w));
  if (windows.includes(null)) return null;
  if (![raw.cooldownUntil, raw.budgetFreesAt, raw.last429At].every(v => nullableTimestamp(v))) return null;
  if (raw.cooldownReason !== null && !text(raw.cooldownReason)) return null;
  let remaining: QuotaProviderStatus['providerRemaining'] = null;
  if (raw.providerRemaining !== null) {
    if (!isRecord(raw.providerRemaining) || !nonnegative(raw.providerRemaining.value) || !timestamp(raw.providerRemaining.at)) return null;
    remaining = { value: raw.providerRemaining.value, at: raw.providerRemaining.at };
  }
  if (raw.tokens !== undefined && !nonnegative(raw.tokens)) return null;
  return { id: raw.id, label: raw.label, unit: raw.unit, state: raw.state as QuotaState,
    estimate: raw.estimate as boolean, unverified: raw.unverified as boolean, observeOnly: raw.observeOnly as boolean,
    windows: windows as QuotaWindowStatus[], cooldownUntil: raw.cooldownUntil as number | null,
    cooldownReason: raw.cooldownReason as string | null, budgetFreesAt: raw.budgetFreesAt as number | null,
    providerRemaining: remaining, last429At: raw.last429At as number | null,
    ...(raw.tokens === undefined ? {} : { tokens: raw.tokens as number }) };
}
/** Reject an invalid report, never turn rejected rows into a healthy empty view. */
export function parseQuotaStatus(raw: unknown): QuotaStatusReport | null {
  if (!isRecord(raw) || !timestamp(raw.asOf) || raw.targetShare !== 0.8) return null;
  if (!Array.isArray(raw.providers) || raw.providers.length === 0 || raw.providers.length > MAX_PROVIDERS) return null;
  if (!Array.isArray(raw.throttledHosts) || raw.throttledHosts.length > MAX_PROVIDERS) return null;
  const providers = raw.providers.map(p => parseProvider(p));
  if (providers.includes(null)) return null;
  if (new Set(providers.map(p => p!.id)).size !== providers.length) return null;
  const hosts: QuotaStatusReport['throttledHosts'] = [];
  for (const h of raw.throttledHosts) {
    if (!isRecord(h) || !text(h.host) || !timestamp(h.until)) return null;
    hosts.push({ host: h.host, until: h.until });
  }
  return { asOf: raw.asOf, targetShare: raw.targetShare, providers: providers as QuotaProviderStatus[], throttledHosts: hosts };
}

export async function fetchQuotaStatus(fetchImpl: typeof fetch = fetch, signal?: AbortSignal, desktop = isDesktopRuntime()): Promise<QuotaStatusResult> {
  if (!desktop) return { ok: false, error: 'desktop sidecar required' };
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) return { ok: false, error: 'request cancelled' };
    const work = (async (): Promise<QuotaStatusResult> => {
      const resp = await fetchImpl(`${getApiBaseUrl()}/api/quota/status`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const report = parseQuotaStatus(await resp.json());
      return report ? { ok: true, report } : { ok: false, error: 'unexpected response' };
    })();
    if (!signal) return await work;
    const cancelled = new Promise<QuotaStatusResult>(resolve => {
      onAbort = () => resolve({ ok: false, error: 'request cancelled or timed out' });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return await Promise.race([work, cancelled]);
  } catch {
    // Do not echo network URLs, credentials or arbitrary response bodies.
    return { ok: false, error: 'sidecar unavailable' };
  } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
}

/** "1 min", "1 h", "24 h", "7 days", "30 days". */
export function formatWindow(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours <= 24) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

/** "in 12 min", "in 3 h", "in 2 days", or "now". */
export function formatUntil(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
