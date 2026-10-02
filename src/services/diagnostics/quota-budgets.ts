/**
 * API budgets (R4-BUG-005 step 2): the sidecar's Quota Governor reports, per
 * quota-limited provider, how much of each rolling window has been used,
 * where background refreshes stop (80%), and any cooldown a provider asked
 * for. This module fetches and validates that report for System Diagnostic.
 * The payload carries counts, limits and times only — no keys or URLs — and
 * every field is checked before it reaches the renderer.
 */
import { getApiBaseUrl } from '@/services/runtime';

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

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : null;
}

function parseWindow(raw: unknown): QuotaWindowStatus | null {
  if (!isRecord(raw)) return null;
  const windowMs = finiteOrNull(raw.windowMs);
  const used = finiteOrNull(raw.used);
  if (windowMs === null || windowMs <= 0 || used === null || used < 0) return null;
  return { windowMs, used, limit: finiteOrNull(raw.limit), backgroundCeiling: finiteOrNull(raw.backgroundCeiling) };
}

function parseRemaining(raw: unknown): QuotaProviderStatus['providerRemaining'] {
  if (!isRecord(raw)) return null;
  const value = finiteOrNull(raw.value);
  const at = finiteOrNull(raw.at);
  return value === null || at === null ? null : { value, at };
}

function parseProvider(raw: unknown): QuotaProviderStatus | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const label = text(raw.label);
  const unit = text(raw.unit);
  const state = raw.state as QuotaState;
  if (!id || !label || !unit || !STATES.has(state) || !Array.isArray(raw.windows)) return null;
  const windows = raw.windows.map((w) => parseWindow(w));
  if (windows.length === 0 || windows.includes(null)) return null;
  const tokens = finiteOrNull(raw.tokens);
  return {
    id,
    label,
    unit,
    estimate: raw.estimate === true,
    unverified: raw.unverified === true,
    observeOnly: raw.observeOnly === true,
    state,
    windows: windows as QuotaWindowStatus[],
    cooldownUntil: finiteOrNull(raw.cooldownUntil),
    cooldownReason: text(raw.cooldownReason),
    budgetFreesAt: finiteOrNull(raw.budgetFreesAt),
    providerRemaining: parseRemaining(raw.providerRemaining),
    last429At: finiteOrNull(raw.last429At),
    ...(tokens !== null && { tokens }),
  };
}

/** Validate the sidecar's report; malformed providers are dropped, not trusted. */
export function parseQuotaStatus(raw: unknown): QuotaStatusReport | null {
  if (!isRecord(raw) || !Array.isArray(raw.providers)) return null;
  const asOf = finiteOrNull(raw.asOf);
  if (asOf === null) return null;
  const providers = raw.providers
    .slice(0, MAX_PROVIDERS)
    .map((p) => parseProvider(p))
    .filter((p): p is QuotaProviderStatus => p !== null);
  const throttledHosts = Array.isArray(raw.throttledHosts)
    ? raw.throttledHosts.flatMap((h) => {
      if (!isRecord(h)) return [];
      const host = text(h.host);
      const until = finiteOrNull(h.until);
      return host && until !== null ? [{ host, until }] : [];
    }).slice(0, MAX_PROVIDERS)
    : [];
  return { asOf, targetShare: finiteOrNull(raw.targetShare) ?? 0.8, providers, throttledHosts };
}

export async function fetchQuotaStatus(fetchImpl: typeof fetch = fetch): Promise<QuotaStatusResult> {
  try {
    const resp = await fetchImpl(`${getApiBaseUrl()}/api/quota/status`, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const report = parseQuotaStatus(await resp.json());
    return report ? { ok: true, report } : { ok: false, error: 'unexpected response' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
