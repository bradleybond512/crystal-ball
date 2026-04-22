/**
 * Auto-Brief — reactive threat briefs on mode-forecast critical crossover.
 *
 * Listens to `cb:mode-advisory` from mode-forecast. When a domain crosses
 * a critical pressure level, dispatches a focused Claude-agent query and
 * caches the resulting brief for the HUD to render.
 *
 * Guardrails:
 *   - off by default; user opts in via setAutoBriefEnabled(true)
 *   - Ghost Mode suppresses both the call and the surfacing
 *   - per-domain cooldown caps spend (default 60 min)
 *   - requires `aiClaude` runtime feature
 */

import { generateText } from './llm-adapter';
import { isGhostMode } from './mode-manager';
import { isFeatureAvailable } from './runtime-config';
import type { ForecastSnapshot, ForecastDomain, ModeAdvisory } from './mode-forecast';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutoBrief {
  domain: ForecastDomain;
  generatedAt: number;
  pressure: number;
  /** Full agent response text. */
  text: string;
  /** Abbreviated summary suitable for HUD. */
  summary: string;
  /** Which provider generated this brief. */
  provider?: 'local' | 'cloud-agent' | 'cloud-chat' | 'none';
}

// ── Tuning ────────────────────────────────────────────────────────────────────

const CRITICAL_THRESHOLD = 0.8;
const COOLDOWN_MS = 60 * 60 * 1000;
const ENABLED_KEY = 'crystalball-auto-brief-enabled';
const STORAGE_KEY = 'crystalball-auto-brief-v1';
const EVENT_NAME = 'cb:auto-brief';

const DOMAIN_PROMPT: Record<ForecastDomain, string> = {
  finance:
    'Finance pressure is rising. Pull market summary, sanctions news, and any economic indicators. ' +
    'Produce a 3-bullet brief: (1) what just changed, (2) second-order effects, (3) forward watch 24h.',
  security:
    'Security pressure is rising. Pull risk scores and news for active conflict zones and elevated theaters. ' +
    'Produce a 3-bullet brief: (1) what just changed, (2) escalation vectors, (3) forward watch 24h.',
  disaster:
    'Disaster pressure is rising. Pull weather alerts, seismic events, and active disaster situations. ' +
    'Produce a 3-bullet brief: (1) what just changed, (2) cascade risks, (3) forward watch 24h.',
  cyber:
    'Cyber pressure is rising. Pull latest IOC data and news on recent cyberattacks or infrastructure compromises. ' +
    'Produce a 3-bullet brief: (1) what just changed, (2) affected sectors, (3) forward watch 24h.',
};

// ── State ─────────────────────────────────────────────────────────────────────

const lastBriefAt: Partial<Record<ForecastDomain, number>> = {};
const lastPressure: Partial<Record<ForecastDomain, number>> = {};
const inFlight = new Set<ForecastDomain>();

// ── Enabled toggle ────────────────────────────────────────────────────────────

export function isAutoBriefEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function setAutoBriefEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* ignore */ }
}

// ── Persistence ──────────────────────────────────────────────────────────────

function persistBrief(brief: AutoBrief): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) as Record<string, AutoBrief> : {};
    existing[brief.domain] = brief;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch { /* quota */ }
}

export function getLatestBriefs(): Record<ForecastDomain, AutoBrief | undefined> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { finance: undefined, security: undefined, disaster: undefined, cyber: undefined };
    }
    const parsed = JSON.parse(raw) as Partial<Record<ForecastDomain, AutoBrief>>;
    return {
      finance: parsed.finance,
      security: parsed.security,
      disaster: parsed.disaster,
      cyber: parsed.cyber,
    };
  } catch {
    return { finance: undefined, security: undefined, disaster: undefined, cyber: undefined };
  }
}

// ── Brief generation ──────────────────────────────────────────────────────────

function summarize(text: string): string {
  // Take the first two lines that look like content; trim to 240 chars.
  const lines = text
    .split(/\n/)
    .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(l => l.length > 15);
  return lines.slice(0, 2).join(' ').slice(0, 240);
}

async function runBrief(domain: ForecastDomain, pressure: number): Promise<void> {
  if (inFlight.has(domain)) return;
  inFlight.add(domain);
  try {
    const res = await generateText(DOMAIN_PROMPT[domain], { maxTokens: 500 });
    if (!res.text) return;
    const brief: AutoBrief = {
      domain,
      pressure,
      generatedAt: Date.now(),
      text: res.text,
      summary: summarize(res.text),
      provider: res.provider,
    };
    persistBrief(brief);
    document.dispatchEvent(new CustomEvent<AutoBrief>(EVENT_NAME, { detail: brief }));
  } catch {
    // Swallow; will retry next time cooldown expires.
  } finally {
    inFlight.delete(domain);
  }
}

function crossedCritical(domain: ForecastDomain, advisory: ModeAdvisory): boolean {
  const prev = lastPressure[domain] ?? 0;
  const crossed = prev < CRITICAL_THRESHOLD && advisory.pressure >= CRITICAL_THRESHOLD;
  lastPressure[domain] = advisory.pressure;
  return crossed;
}

function cooldownOk(domain: ForecastDomain): boolean {
  const last = lastBriefAt[domain] ?? 0;
  return Date.now() - last >= COOLDOWN_MS;
}

function handleForecast(snapshot: ForecastSnapshot): void {
  if (!isAutoBriefEnabled()) return;
  if (isGhostMode()) return;
  if (!isFeatureAvailable('aiClaude')) return;

  for (const advisory of snapshot.advisories) {
    // Keep lastPressure in sync even when not triggering a run.
    const crossed = crossedCritical(advisory.domain, advisory);
    if (!crossed) continue;
    if (!cooldownOk(advisory.domain)) continue;
    lastBriefAt[advisory.domain] = Date.now();
    void runBrief(advisory.domain, advisory.pressure);
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startAutoBrief(): void {
  if (started) return;
  started = true;
  document.addEventListener('cb:mode-advisory', (e: Event) => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    handleForecast(ce.detail);
  });
}

export function subscribeAutoBrief(cb: (brief: AutoBrief) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<AutoBrief>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
