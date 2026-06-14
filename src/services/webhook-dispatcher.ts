/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, no-console, sonarjs/no-nested-template-literals */
/**
 * Webhook Dispatcher — outbound notifications to Slack / Discord / generic endpoints
 *
 * Persists user-defined webhook configurations in localStorage and dispatches
 * formatted payloads when critical/high-severity events occur (compound threats,
 * strike packages, anomaly engine). Formats per platform:
 *  - Slack: { text, attachments: [{ color, fields }] }
 *  - Discord: { embeds: [{ title, description, color, timestamp, footer }] }
 *  - Generic: raw WebhookPayload JSON
 *
 * Guardrails:
 *  - Per-webhook rate limit: 1 dispatch / 30s
 *  - Per-request timeout: 5s (AbortSignal)
 *  - Severity filtering (critical / high / all)
 *  - Errors swallowed per webhook (console.warn only)
 *
 * Integration: call `initWebhookDispatcher()` once at startup from data-loader.
 */

import { anomalyEngine, type Anomaly } from '@/services/anomaly-detection';
import type { CompoundThreat } from '@/services/compound-threat';
import type { StrikePackage } from '@/services/strike-package';
import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type WebhookFormat = 'slack' | 'discord' | 'generic';
export type WebhookSeverityFilter = 'critical' | 'high' | 'all';

export interface WebhookConfig {
  id: string;
  url: string;
  format: WebhookFormat;
  severityFilter: WebhookSeverityFilter;
  enabled: boolean;
  secret?: string;
  label?: string;
}

export interface WebhookPayload {
  title: string;
  body: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  source: string;
  url?: string;
  timestamp: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cb-webhooks';
const RATE_LIMIT_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 5 * 1000;

/** Slack attachment colors (hex) keyed by severity. */
const SLACK_COLORS: Record<WebhookPayload['severity'], string> = {
  critical: '#ff0000',
  high: '#ff9800',
  medium: '#ffeb3b',
  low: '#4caf50',
  info: '#3b82f6',
};

/** Discord embed colors (decimal int) keyed by severity. */
const DISCORD_COLORS: Record<WebhookPayload['severity'], number> = {
  critical: 0xFF_00_00,
  high: 0xFF_98_00,
  medium: 0xFF_EB_3B,
  low: 0x4C_AF_50,
  info: 0x3B_82_F6,
};

// ──────────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────────

/** Per-webhook last-dispatch timestamps for rate limiting. */
const lastDispatchAt = new Map<string, number>();

// ──────────────────────────────────────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────────────────────────────────────

/** Load persisted webhook configurations. Returns [] on error or missing data. */
export function getWebhookConfigs(): WebhookConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is WebhookConfig =>
        !!c &&
        typeof c.id === 'string' &&
        typeof c.url === 'string' &&
        (c.format === 'slack' || c.format === 'discord' || c.format === 'generic') &&
        (c.severityFilter === 'critical' || c.severityFilter === 'high' || c.severityFilter === 'all') &&
        typeof c.enabled === 'boolean',
    );
  } catch {
    return [];
  }
}

/** Persist the full list. Internal helper. */
function writeConfigs(configs: WebhookConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch (error) {
    console.warn('[webhook-dispatcher] Failed to persist configs:', error);
  }
}

/** Upsert a webhook configuration by id. */
export function saveWebhookConfig(config: WebhookConfig): void {
  const configs = getWebhookConfigs();
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx === -1) {
    configs.push(config);
  } else {
    configs[idx] = config;
  }
  writeConfigs(configs);
}

/** Remove a webhook configuration by id. */
export function deleteWebhookConfig(id: string): void {
  const configs = getWebhookConfigs().filter((c) => c.id !== id);
  writeConfigs(configs);
  lastDispatchAt.delete(id);
}

/** Flip the enabled flag for a single webhook. */
export function toggleWebhook(id: string, enabled: boolean): void {
  const configs = getWebhookConfigs();
  const target = configs.find((c) => c.id === id);
  if (!target) return;
  target.enabled = enabled;
  writeConfigs(configs);
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────────

/** Build a Slack-compatible payload with a colored attachment. */
export function formatForSlack(payload: WebhookPayload): {
  text: string;
  attachments: { color: string; fields: { title: string; value: string; short: boolean }[] }[];
} {
  return {
    text: payload.title,
    attachments: [
      {
        color: SLACK_COLORS[payload.severity],
        fields: [
          { title: 'Severity', value: payload.severity.toUpperCase(), short: true },
          { title: 'Source', value: payload.source, short: true },
          { title: 'Details', value: payload.body, short: false },
          ...(payload.url
            ? [{ title: 'Link', value: payload.url, short: false }]
            : []),
        ],
      },
    ],
  };
}

/** Build a Discord-compatible payload with a colored embed. */
export function formatForDiscord(payload: WebhookPayload): {
  embeds: {
    title: string;
    description: string;
    color: number;
    timestamp: string;
    footer: { text: string };
    url?: string;
  }[];
} {
  const embed: {
    title: string;
    description: string;
    color: number;
    timestamp: string;
    footer: { text: string };
    url?: string;
  } = {
    title: payload.title,
    description: payload.body,
    color: DISCORD_COLORS[payload.severity],
    timestamp: new Date(payload.timestamp).toISOString(),
    footer: { text: `Crystal Ball · ${payload.source} · ${payload.severity.toUpperCase()}` },
  };
  if (payload.url) embed.url = payload.url;
  return { embeds: [embed] };
}

/** Return the raw payload for generic webhook endpoints. */
export function formatGeneric(payload: WebhookPayload): WebhookPayload {
  return payload;
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────────────────

/** Returns true if the payload should be delivered for this webhook. */
function passesSeverityFilter(payload: WebhookPayload, filter: WebhookSeverityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'high') return payload.severity === 'critical' || payload.severity === 'high';
  return payload.severity === 'critical';
}

/** Returns true if this webhook is within its rate-limit window. */
function isRateLimited(id: string, now: number): boolean {
  const last = lastDispatchAt.get(id);
  return last != null && now - last < RATE_LIMIT_MS;
}

/** Serialize per-format body for the outbound POST. */
function buildBody(config: WebhookConfig, payload: WebhookPayload): string {
  if (config.format === 'slack') return JSON.stringify(formatForSlack(payload));
  if (config.format === 'discord') return JSON.stringify(formatForDiscord(payload));
  return JSON.stringify(formatGeneric(payload));
}

/**
 * Deliver the payload to a single webhook, respecting timeout + swallowing errors.
 *
 * Desktop (Tauri): the tightened CSP `connect-src` forbids the renderer from
 * POSTing to arbitrary webhook hosts, so delivery routes through the sidecar's
 * SSRF-validated `/api/local-webhook-dispatch` route (not CSP-bound; it validates
 * + IP-pins the target). The desktop fetch wrapper auto-injects the local API
 * bearer token, which that route requires. `/api/local-*` also blocks cloud
 * fallback, so the webhook URL + secret never reach the remote API.
 *
 * Web: there is no Tauri CSP and no sidecar, so POST the webhook directly (the
 * pre-tightening behavior). Cross-origin reachability is governed by the browser.
 */
async function dispatchOne(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (isDesktopRuntime()) {
      const res = await fetch(`${getApiBaseUrl()}/api/local-webhook-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: config.url, body: buildBody(config, payload), secret: config.secret }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[webhook-dispatcher] ${config.label ?? config.id} dispatch failed (sidecar ${res.status})`);
        return;
      }
      const result = (await res.json()) as { delivered?: boolean; upstreamStatus?: number };
      if (!result.delivered) {
        console.warn(`[webhook-dispatcher] ${config.label ?? config.id} returned ${result.upstreamStatus ?? 'unknown'}`);
      }
    } else {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.secret) headers['X-Webhook-Secret'] = config.secret;
      const res = await fetch(config.url, {
        method: 'POST',
        headers,
        body: buildBody(config, payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[webhook-dispatcher] ${config.label ?? config.id} returned ${res.status}`);
      }
    }
  } catch (error) {
    console.warn(`[webhook-dispatcher] ${config.label ?? config.id} failed:`, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Iterate all enabled webhooks and dispatch the payload to each that passes
 * its severity filter and rate-limit check. Never throws.
 */
export async function dispatchToWebhooks(payload: WebhookPayload): Promise<void> {
  const configs = getWebhookConfigs().filter((c) => c.enabled);
  if (configs.length === 0) return;
  const now = Date.now();
  const tasks: Promise<void>[] = [];
  for (const config of configs) {
    if (!passesSeverityFilter(payload, config.severityFilter)) continue;
    if (isRateLimited(config.id, now)) continue;
    lastDispatchAt.set(config.id, now);
    tasks.push(dispatchOne(config, payload));
  }
  try {
    await Promise.all(tasks);
  } catch {
    /* per-webhook errors already swallowed in dispatchOne */
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Event adapters
// ──────────────────────────────────────────────────────────────────────────────

/** Map arbitrary severity tokens to the canonical WebhookPayload severity. */
function normalizeSeverity(sev: unknown): WebhookPayload['severity'] {
  if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low' || sev === 'info') {
    return sev;
  }
  if (sev === 'warning') return 'medium';
  if (sev === 'elevated') return 'medium';
  if (sev === 'routine') return 'low';
  return 'info';
}

/** Build a payload from a compound threat (CompoundThreat). */
function payloadFromCompoundThreat(threat: CompoundThreat): WebhookPayload {
  const categories = Array.isArray(threat.hazardCategories) ? threat.hazardCategories.join(', ') : '';
  return {
    title: `Compound threat detected — ${threat.hazardCount} hazards`,
    body: `Overlapping hazards${categories ? ` (${categories})` : ''} at ${threat.lat.toFixed(2)}, ${threat.lon.toFixed(2)} · radius ${threat.radiusKm}km`,
    severity: normalizeSeverity(threat.overallSeverity),
    source: 'compound-threat',
    timestamp: Date.now(),
  };
}

/** Build a payload from a strike package. */
function payloadFromStrikePackage(pkg: StrikePackage): WebhookPayload {
  return {
    title: `Strike package · ${pkg.label}`,
    body: pkg.description ?? `${pkg.packageType} detected`,
    severity: normalizeSeverity(pkg.threatLevel),
    source: 'strike-package',
    timestamp: Date.now(),
  };
}

/** Build a payload from an anomaly detection. */
function payloadFromAnomaly(anomaly: Anomaly): WebhookPayload {
  return {
    title: `Anomaly · ${anomaly.source} (${anomaly.type})`,
    body: anomaly.description,
    severity: normalizeSeverity(anomaly.severity),
    source: `anomaly:${anomaly.source}`,
    timestamp: anomaly.timestamp,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────────────────────

let initialized = false;

/**
 * Wire the dispatcher to compound-threat, strike-package, and anomaly events.
 * Idempotent — safe to call multiple times.
 */
export function initWebhookDispatcher(): void {
  if (initialized) return;
  initialized = true;

  // Compound threats: dispatch critical + high overlaps
  document.addEventListener('wm:compound-threats-updated', (e: Event) => {
    const detail = (e as CustomEvent<CompoundThreat[]>).detail;
    if (!Array.isArray(detail)) return;
    for (const threat of detail) {
      if (threat.overallSeverity === 'critical' || threat.overallSeverity === 'high') {
        void dispatchToWebhooks(payloadFromCompoundThreat(threat));
      }
    }
  });

  // Strike packages: dispatch criticals only
  document.addEventListener('wm:strike-packages', (e: Event) => {
    const detail = (e as CustomEvent<StrikePackage[]>).detail;
    if (!Array.isArray(detail)) return;
    for (const pkg of detail) {
      if (pkg.threatLevel === 'critical') {
        void dispatchToWebhooks(payloadFromStrikePackage(pkg));
      }
    }
  });

  // Anomalies: dispatch criticals only
  anomalyEngine.subscribe((anomaly) => {
    if (anomaly.severity === 'critical') {
      void dispatchToWebhooks(payloadFromAnomaly(anomaly));
    }
  });
}
