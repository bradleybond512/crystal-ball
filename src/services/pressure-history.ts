/**
 * Pressure History — rolling per-domain mode-forecast history and
 * critical-crossing desktop notifications.
 *
 * Keeps the last N pressure samples per domain so the HUD can render a
 * sparkline alongside each advisory. Also fires a one-shot desktop
 * notification via notificationDispatcher the first time a domain's
 * pressure crosses the critical threshold in a given crossing-window,
 * using the `correlation` alert source so Ghost-Mode + quiet-hours
 * suppression apply for free.
 */

import { notificationDispatcher } from './notification-dispatcher';
import type { UnifiedAlert } from './unified-alerts';
import type { ForecastDomain, ForecastSnapshot } from './mode-forecast';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PressureSample {
  timestamp: number;
  value: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HISTORY_MAX = 30;            // ~60 min at 2-min forecast cadence
const CRITICAL_THRESHOLD = 0.8;
const CRITICAL_RESET_HYSTERESIS = 0.65;
const STORAGE_KEY = 'crystalball-pressure-history-v1';
const EVENT_NAME = 'cb:pressure-history';

const DOMAINS: ForecastDomain[] = ['finance', 'security', 'disaster', 'cyber'];

const DOMAIN_LABEL: Record<ForecastDomain, string> = {
  finance: 'Finance',
  security: 'Security',
  disaster: 'Disaster',
  cyber: 'Cyber',
};

// ── State ─────────────────────────────────────────────────────────────────────

const history: Record<ForecastDomain, PressureSample[]> = {
  finance: [], security: [], disaster: [], cyber: [],
};
const aboveCritical: Record<ForecastDomain, boolean> = {
  finance: false, security: false, disaster: false, cyber: false,
};
let loaded = false;

interface Persisted {
  history?: Partial<Record<ForecastDomain, PressureSample[]>>;
  aboveCritical?: Partial<Record<ForecastDomain, boolean>>;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.history) {
      for (const d of DOMAINS) {
        const arr = parsed.history[d];
        if (Array.isArray(arr)) history[d] = arr.slice(-HISTORY_MAX);
      }
    }
    if (parsed.aboveCritical) {
      for (const d of DOMAINS) {
        if (typeof parsed.aboveCritical[d] === 'boolean') {
          aboveCritical[d] = parsed.aboveCritical[d];
        }
      }
    }
  } catch { /* ignore */ }
}

function save(): void {
  const out: Persisted = { history, aboveCritical };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); }
  catch { /* quota */ }
}

// ── Notifications ────────────────────────────────────────────────────────────

function fireCriticalNotification(domain: ForecastDomain, pressure: number): void {
  const label = DOMAIN_LABEL[domain];
  const alert: UnifiedAlert = {
    // Content-stable id: a domain sitting above critical is one condition, not a
    // new alert on every sample. Bucketing by domain + hour (instead of
    // Date.now()) coalesces the repeats while still re-alerting hourly if the
    // pressure stays critical.
    id: `pressure-crit-${domain}-${Math.floor(Date.now() / (60 * 60 * 1000))}`,
    source: 'correlation',
    severity: 'critical',
    title: `${label} pressure critical`,
    body: `${label} domain pressure crossed the critical threshold (${(pressure * 100).toFixed(0)}%). Review posture advisories.`,
    timestamp: Date.now(),
    relevanceScore: 90,
    acknowledged: false,
    pinned: false,
  };
  notificationDispatcher.dispatchNotification(alert, 'sound+banner');
}

function maybeFireCritical(domain: ForecastDomain, pressure: number): void {
  const was = aboveCritical[domain];
  if (!was && pressure >= CRITICAL_THRESHOLD) {
    aboveCritical[domain] = true;
    fireCriticalNotification(domain, pressure);
  } else if (was && pressure < CRITICAL_RESET_HYSTERESIS) {
    aboveCritical[domain] = false;
  }
}

// ── Ingestion ────────────────────────────────────────────────────────────────

function handleForecast(snapshot: ForecastSnapshot): void {
  load();
  const now = snapshot.timestamp || Date.now();
  for (const d of DOMAINS) {
    const value = snapshot.pressure[d] ?? 0;
    const series = history[d];
    series.push({ timestamp: now, value });
    if (series.length > HISTORY_MAX) series.splice(0, series.length - HISTORY_MAX);
    maybeFireCritical(d, value);
  }
  save();
  document.dispatchEvent(new CustomEvent<Record<ForecastDomain, PressureSample[]>>(EVENT_NAME, {
    detail: { ...history },
  }));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Current per-domain pressure series, oldest first. */
export function getPressureHistory(): Record<ForecastDomain, PressureSample[]> {
  load();
  return {
    finance: [...history.finance],
    security: [...history.security],
    disaster: [...history.disaster],
    cyber: [...history.cyber],
  };
}

/**
 * Build an SVG path string (width × height) for a pressure series so the HUD
 * can drop it straight into an inline <svg>. Values are normalized to [0,1].
 */
export function buildSparklinePath(series: PressureSample[], width: number, height: number): string {
  if (series.length === 0) return '';
  if (series.length === 1) {
    // Clamp to [0,1] for consistency with the multi-element branch — protects
    // against out-of-range values corrupting the SVG viewport.
    const raw = series[0]?.value ?? 0;
    const v = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
    const y = height * (1 - v);
    return `M 0 ${y.toFixed(1)} L ${width} ${y.toFixed(1)}`;
  }
  const step = width / (series.length - 1);
  return series.map((s, i) => {
    const x = (i * step).toFixed(1);
    const y = (height * (1 - Math.max(0, Math.min(1, s.value)))).toFixed(1);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startPressureHistory(): void {
  if (started) return;
  started = true;
  load();
  document.addEventListener('cb:mode-advisory', (e: Event) => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    handleForecast(ce.detail);
  });
}

export function subscribePressureHistory(
  cb: (h: Record<ForecastDomain, PressureSample[]>) => void,
): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<Record<ForecastDomain, PressureSample[]>>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
