// AI situational-brief generator (manual, toolbar-triggered).
//
// Aggregates current threat state from sidecar endpoints, builds a single
// prompt, and calls llm-adapter.generateText() so Ollama users get local
// generation and cloud calls go through the daily budget. The companion
// auto-brief.ts handles automatic critical-crossover briefs on its own
// schedule; this module is the on-demand variant.
/* eslint-disable sonarjs/no-alphabetical-sort, sonarjs/cognitive-complexity, sonarjs/no-nested-template-literals -- short prompt-builder; sorts are over a fixed enum of source keys (locale-insensitive on purpose for stable fingerprint) */

import { generateText, type LlmResult } from '@/services/llm-adapter';
import { getApiBaseUrl } from '@/services/runtime';
import { getSecretState } from '@/services/runtime-config';

export const AI_BRIEF_TTL_MS = 30 * 60 * 1000;
export const AI_BRIEF_MODEL = 'claude-haiku-4-5-20251001';

export const AI_BRIEF_SYSTEM_PROMPT = [
  'You are an intelligence analyst.',
  'Given current threat data, produce a concise three-paragraph situation report:',
  '(1) most elevated threats right now,',
  '(2) trends and trajectories,',
  '(3) what warrants monitoring in the next 24h.',
  'Be specific with numbers. No bullet points. No headers.',
].join(' ');

// ── Types ────────────────────────────────────────────────────────────────────

export type ThreatSourceKey =
  | 'spaceweather'
  | 'alerts'
  | 'wildfires'
  | 'gdelt'
  | 'acled'
  | 'economic'
  | 'vessels';

export interface ThreatStateSnapshot {
  spaceweather?: unknown;
  alerts?: unknown;
  wildfires?: unknown;
  gdelt?: unknown;
  acled?: unknown;
  economic?: unknown;
  vessels?: unknown;
  sources: { ok: ThreatSourceKey[]; missing: ThreatSourceKey[]; failed: ThreatSourceKey[] };
}

export interface AiBriefSuccess {
  text: string;
  generatedAt: string;
  provider: LlmResult['provider'];
  model?: string;
  cached: boolean;
}

export interface AiBriefError {
  reason: 'no-api-key' | 'no-data' | 'llm-failed' | 'budget-exhausted' | 'unknown';
  message: string;
}

interface CacheEntry {
  fingerprint: string;
  generatedAt: number;
  text: string;
  provider: LlmResult['provider'];
  model?: string;
}

// ── Endpoint table — verified against main on 2026-05-07 ────────────────────
// /api/aviation/sigmets does not exist on main and is intentionally omitted.
// /api/wildfires/hotspots was renamed to /api/wildfire/incidents.
// /api/gdelt/events was renamed to /api/gdelt-intel.

const ENDPOINTS: { key: ThreatSourceKey; path: string }[] = [
  { key: 'spaceweather', path: '/api/spaceweather/status' },
  { key: 'alerts', path: '/api/alerts/active' },
  { key: 'wildfires', path: '/api/wildfire/incidents' },
  { key: 'gdelt', path: '/api/gdelt-intel' },
  { key: 'acled', path: '/api/acled-events' },
  { key: 'economic', path: '/api/economic-stress' },
  { key: 'vessels', path: '/api/dark-vessels' },
];

// ── Pure helpers ─────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  // Stable stringify: sort object keys so reordered shapes hash the same.
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => safeStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${safeStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function fnv1aHash(str: string): string {
  let hash = 0x81_1C_9D_C5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.codePointAt(i) ?? 0;
    hash = (hash * 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function snapshotFingerprint(snapshot: ThreatStateSnapshot): string {
  const stable: Record<string, unknown> = {};
  const keys: ThreatSourceKey[] = ['spaceweather', 'alerts', 'wildfires', 'gdelt', 'acled', 'economic', 'vessels'];
  for (const k of keys) {
    if (snapshot[k] !== undefined) stable[k] = snapshot[k];
  }
  // Sort source-status arrays so order doesn't change the hash.
  stable['sources/ok'] = [...snapshot.sources.ok].sort();
  stable['sources/missing'] = [...snapshot.sources.missing].sort();
  stable['sources/failed'] = [...snapshot.sources.failed].sort();
  return fnv1aHash(safeStringify(stable));
}

function summarizeForPrompt(value: unknown, maxChars = 400): string {
  if (value === null || value === undefined) return 'no data';
  if (typeof value === 'string') return value.slice(0, maxChars);
  if (typeof value === 'object' && 'summary' in (value as object)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.summary === 'string') {
      const summary = obj.summary;
      const extras: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'summary') continue;
        if (typeof v === 'number' || typeof v === 'string') extras.push(`${k}=${v}`);
      }
      return `${summary}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`.slice(0, maxChars);
    }
  }
  try {
    return JSON.stringify(value).slice(0, maxChars);
  } catch {
    return 'unparseable';
  }
}

export function buildPrompt(snapshot: ThreatStateSnapshot): string {
  const sections: string[] = [];
  if (snapshot.spaceweather) sections.push(`## Space weather\n${summarizeForPrompt(snapshot.spaceweather)}`);
  if (snapshot.alerts) sections.push(`## Active CAP alerts\n${summarizeForPrompt(snapshot.alerts)}`);
  if (snapshot.wildfires) sections.push(`## Wildfire incidents\n${summarizeForPrompt(snapshot.wildfires)}`);
  if (snapshot.gdelt) sections.push(`## GDELT geopolitical signals\n${summarizeForPrompt(snapshot.gdelt)}`);
  if (snapshot.acled) sections.push(`## ACLED conflict events\n${summarizeForPrompt(snapshot.acled)}`);
  if (snapshot.economic) sections.push(`## Economic stress\n${summarizeForPrompt(snapshot.economic)}`);
  if (snapshot.vessels) sections.push(`## Maritime vessel signals\n${summarizeForPrompt(snapshot.vessels)}`);

  if (sections.length === 0) sections.push('No current data available from any source.');

  if (snapshot.sources.missing.length > 0) {
    sections.push(`## Data gaps — missing\n${snapshot.sources.missing.join(', ')}`);
  }
  if (snapshot.sources.failed.length > 0) {
    sections.push(`## Data gaps — failed\n${snapshot.sources.failed.join(', ')}`);
  }
  return sections.join('\n\n');
}

export function shouldRegenerate(
  cache: CacheEntry | null,
  fingerprint: string,
  nowMs: number,
): boolean {
  if (!cache) return true;
  if (cache.fingerprint !== fingerprint) return true;
  if (nowMs - cache.generatedAt > AI_BRIEF_TTL_MS) return true;
  return false;
}

// ── Side-effecting orchestrator ──────────────────────────────────────────────

export interface FetchSnapshotOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}

export async function fetchThreatStateSnapshot(opts: FetchSnapshotOptions = {}): Promise<ThreatStateSnapshot> {
  const fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl ?? getApiBaseUrl();

  const ok: ThreatSourceKey[] = [];
  const failed: ThreatSourceKey[] = [];
  const missing: ThreatSourceKey[] = [];
  const data: Partial<Record<ThreatSourceKey, unknown>> = {};

  await Promise.all(ENDPOINTS.map(async ({ key, path }) => {
    try {
      const res = await fetcher(`${base}${path}`, { signal: opts.signal });
      if (!res.ok) {
        failed.push(key);
        return;
      }
      const json: unknown = await res.json();
      data[key] = json;
      ok.push(key);
    } catch {
      failed.push(key);
    }
  }));

  return {
    ...data,
    sources: { ok, missing, failed },
  };
}

// ── Brief generator + cache ─────────────────────────────────────────────────

let _cache: CacheEntry | null = null;

export function resetAiBriefCache(): void {
  _cache = null;
}

export function getCachedAiBrief(): CacheEntry | null {
  return _cache;
}

export interface GenerateAiBriefOptions {
  force?: boolean;
  /** Test seam — defaults to fetchThreatStateSnapshot. */
  snapshotProvider?: () => Promise<ThreatStateSnapshot>;
  /** Test seam — defaults to llm-adapter generateText. */
  generator?: typeof generateText;
  /** Test seam — defaults to runtime-config secret state probe. */
  isApiKeyConfigured?: () => boolean;
  /** Test seam — defaults to Date.now. */
  now?: () => number;
}

function defaultIsApiKeyConfigured(): boolean {
  return getSecretState('ANTHROPIC_API_KEY').present;
}

export async function generateAiBrief(opts: GenerateAiBriefOptions = {}): Promise<AiBriefSuccess | AiBriefError> {
  const snapshotProvider = opts.snapshotProvider ?? fetchThreatStateSnapshot;
  const llm = opts.generator ?? generateText;
  const apiKeyConfigured = (opts.isApiKeyConfigured ?? defaultIsApiKeyConfigured)();
  const now = (opts.now ?? Date.now)();

  const snapshot = await snapshotProvider();
  const fingerprint = snapshotFingerprint(snapshot);

  if (!opts.force && _cache && !shouldRegenerate(_cache, fingerprint, now)) {
    return {
      text: _cache.text,
      generatedAt: new Date(_cache.generatedAt).toISOString(),
      provider: _cache.provider,
      model: _cache.model,
      cached: true,
    };
  }

  if (snapshot.sources.ok.length === 0) {
    return { reason: 'no-data', message: 'No threat data available — every upstream source is unreachable.' };
  }

  const prompt = buildPrompt(snapshot);
  const result = await llm(prompt, { system: AI_BRIEF_SYSTEM_PROMPT, maxTokens: 600 });

  if (result.provider === 'none' || !result.text) {
    if (!apiKeyConfigured) {
      return { reason: 'no-api-key', message: 'Configure ANTHROPIC_API_KEY in settings to enable AI briefs.' };
    }
    return { reason: 'budget-exhausted', message: 'Daily cloud LLM budget reached. Try again later or configure local Ollama.' };
  }

  _cache = {
    fingerprint,
    generatedAt: now,
    text: result.text,
    provider: result.provider,
    model: result.model,
  };

  return {
    text: result.text,
    generatedAt: new Date(now).toISOString(),
    provider: result.provider,
    model: result.model,
    cached: false,
  };
}
