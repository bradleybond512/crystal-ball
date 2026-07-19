/**
 * Mode Forecast — Posture Advisory
 *
 * Modes are now manual (see mode-manager.ts), but users still benefit from an
 * advisory that says "signals are shifting toward domain X — consider
 * focusing there." This service watches rolling signal pressure across
 * domains and emits advisories when a domain crosses a rising threshold.
 *
 * Advisories are suggestions, not triggers. They never call setMode(). They
 * surface through a `cb:mode-advisory` event and a small persisted snapshot,
 * so a HUD or sidebar affordance can render them.
 *
 * Domains tracked:
 *   - finance   (market volatility, economic anomalies)
 *   - security  (military situations, war signals)
 *   - disaster  (natural-hazard situations, seismic anomalies)
 *   - cyber     (cyber situations, cyber anomalies)
 *
 * Each domain has a rolling EWMA of "pressure" (derived from situations +
 * anomalies). When the slope is positive and the level exceeds a threshold,
 * an advisory is emitted. When pressure recedes, the advisory is cleared.
 */

import { situationEngine } from './situation-engine';
import { anomalyEngine } from './anomaly-detection';
import type { Situation, SituationDomain } from './situation-types';
import { isAboveNormal, deviationSigma, getBaseline } from './pressure-baselines';
import { logDebug } from './reasoning-debug';
import { recordLatency, incrementCounter } from './reasoning-metrics';
import { formatDurationMinutes } from '../utils/format-duration';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ForecastDomain = 'finance' | 'security' | 'disaster' | 'cyber';

export interface ModeAdvisory {
  domain: ForecastDomain;
  /** 0–1 current pressure level. */
  pressure: number;
  /** Pressure delta over the last window (positive = rising). */
  slope: number;
  /** Projected time until threshold crossover, or null if already above. */
  etaMin: number | null;
  /** Short analyst-voice statement. */
  statement: string;
  timestamp: number;
}

export interface ForecastSnapshot {
  timestamp: number;
  advisories: ModeAdvisory[];
  /** Per-domain pressure telemetry for debug UIs. */
  pressure: Record<ForecastDomain, number>;
}

// ── Tuning ────────────────────────────────────────────────────────────────────

const BASE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const EWMA_ALPHA = 0.3;                  // responsiveness; higher = snappier
export const ADVISORY_THRESHOLD = 0.5;   // emit once pressure exceeds this
const CLEAR_THRESHOLD = 0.35;            // hysteresis — don't flap at boundary
const STORAGE_KEY = 'crystalball-mode-forecast-v1';
const EVENT_NAME = 'cb:mode-advisory';

const DOMAIN_LABELS: Record<ForecastDomain, string> = {
  finance: 'Finance',
  security: 'Security',
  disaster: 'Disaster',
  cyber: 'Cyber',
};

// ── Pressure computation ─────────────────────────────────────────────────────

const PHASE_WEIGHT: Record<Situation['phase'], number> = {
  resolved: 0,
  active: 1,
  developing: 0.7,
  emerging: 0.4,
  'de-escalating': 0.2,
};

function situationWeight(s: Situation): number {
  return s.confidence * PHASE_WEIGHT[s.phase];
}

function domainPressureFromSituations(
  situations: Situation[],
  domains: SituationDomain[],
): number {
  let sum = 0;
  for (const s of situations) {
    if (!domains.includes(s.domain)) continue;
    sum += situationWeight(s);
  }
  // Normalize: 3 fully active situations with confidence 1.0 → pressure 1.0.
  return Math.min(1, sum / 3);
}

const ANOMALY_SEV_WEIGHT = { critical: 1, warning: 0.6, info: 0.25 } as const;

function domainPressureFromAnomalies(prefix: string): number {
  const anomalies = anomalyEngine.getActiveAnomalies();
  let sum = 0;
  for (const a of anomalies) {
    if (!a.source.startsWith(prefix)) continue;
    const sevWeight = ANOMALY_SEV_WEIGHT[a.severity] ?? 0.25;
    sum += Math.min(1, Math.abs(a.zScore) / 6) * sevWeight;
  }
  return Math.min(1, sum);
}

function computeRawPressure(domain: ForecastDomain, situations: Situation[]): number {
  switch (domain) {
    case 'finance': {
      const sit = domainPressureFromSituations(situations, ['economic']);
      const anom =
        domainPressureFromAnomalies('market:') * 0.6 +
        domainPressureFromAnomalies('matrix:') * 0.2;
      return Math.min(1, sit * 0.6 + anom * 0.6);
    }
    case 'security': {
      const sit = domainPressureFromSituations(situations, ['military', 'civil_unrest']);
      const anom = domainPressureFromAnomalies('military:');
      return Math.min(1, sit * 0.7 + anom * 0.5);
    }
    case 'disaster': {
      const sit = domainPressureFromSituations(situations, ['natural_hazard', 'infrastructure']);
      const anom =
        domainPressureFromAnomalies('weather:') * 0.6 +
        domainPressureFromAnomalies('seismic:') * 0.6;
      return Math.min(1, sit * 0.7 + anom * 0.5);
    }
    case 'cyber': {
      const sit = domainPressureFromSituations(situations, ['cyber']);
      const anom = domainPressureFromAnomalies('cyber:');
      return Math.min(1, sit * 0.7 + anom * 0.6);
    }
  }
}

// ── EWMA state ────────────────────────────────────────────────────────────────

const pressure: Record<ForecastDomain, number> = {
  finance: 0, security: 0, disaster: 0, cyber: 0,
};
const previousPressure: Record<ForecastDomain, number> = {
  finance: 0, security: 0, disaster: 0, cyber: 0,
};
/** Previous slope per domain — for computing acceleration (second derivative). */
const previousSlope: Record<ForecastDomain, number> = {
  finance: 0, security: 0, disaster: 0, cyber: 0,
};
const advised = new Set<ForecastDomain>();

function updateEwma(domain: ForecastDomain, raw: number): number {
  previousPressure[domain] = pressure[domain];
  const next = EWMA_ALPHA * raw + (1 - EWMA_ALPHA) * pressure[domain];
  pressure[domain] = next;
  return next;
}

/** Solve quadratic for smallest positive root. Returns cycles or null. */
function quadraticEtaCycles(slope: number, acceleration: number, gap: number): number | null {
  const a = 0.5 * acceleration;
  const discriminant = slope * slope + 4 * a * gap;
  if (discriminant < 0) return slope > 0 ? gap / slope : null;
  const sqrtD = Math.sqrt(discriminant);
  const t1 = (-slope + sqrtD) / (2 * a);
  const t2 = (-slope - sqrtD) / (2 * a);
  const posRoots = [t1, t2].filter(t => t > 0 && Number.isFinite(t));
  return posRoots.length > 0 ? Math.min(...posRoots) : null;
}

function cyclesToMinutes(cycles: number): number | null {
  const minutes = (cycles * BASE_INTERVAL_MS) / 60_000;
  return minutes <= 120 ? Math.round(minutes) : null;
}

/**
 * Non-linear ETA: accounts for pressure acceleration (second derivative).
 * If accelerating, shorten ETA; if decelerating, extend it.
 * Uses quadratic extrapolation: p(t) = current + slope*t + 0.5*accel*t²
 */
function etaToThreshold(current: number, slope: number, acceleration: number, threshold: number): number | null {
  if (current >= threshold) return null;
  if (slope <= 0 && acceleration <= 0) return null;

  const gap = threshold - current;

  if (Math.abs(acceleration) > 0.001) {
    const cycles = quadraticEtaCycles(slope, acceleration, gap);
    return cycles === null ? null : cyclesToMinutes(cycles);
  }

  if (slope <= 0) return null;
  return cyclesToMinutes(gap / slope);
}

function trendLabel(slope: number): string {
  if (slope > 0.02) return 'still climbing';
  if (slope < -0.02) return 'receding';
  return 'plateaued';
}

function buildStatement(
  domain: ForecastDomain,
  level: number,
  slope: number,
  etaMin: number | null,
): string {
  const name = DOMAIN_LABELS[domain];
  const pct = (level * 100).toFixed(0);
  if (etaMin !== null) {
    return `${name} pressure rising (${pct}%, +${(slope * 100).toFixed(0)} pts/cycle) — threshold in ~${formatDurationMinutes(etaMin)}.`;
  }
  return `${name} pressure elevated at ${pct}% — ${trendLabel(slope)}.`;
}

// ── Cycle ─────────────────────────────────────────────────────────────────────

function persist(snapshot: ForecastSnapshot): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
}

export function getForecastSnapshot(): ForecastSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as ForecastSnapshot : null;
  } catch { return null; }
}

export function runForecastCycle(): ForecastSnapshot {
  const t0 = performance.now();
  const situations = situationEngine.getSituations();
  const domains: ForecastDomain[] = ['finance', 'security', 'disaster', 'cyber'];
  const advisories: ModeAdvisory[] = [];

  for (const d of domains) {
    const raw = computeRawPressure(d, situations);
    const level = updateEwma(d, raw);
    const slope = level - previousPressure[d];
    const acceleration = slope - previousSlope[d];
    previousSlope[d] = slope;

    const wasAdvised = advised.has(d);
    // Fixed-threshold check (existing behavior).
    const passesFixedThreshold = wasAdvised ? level >= CLEAR_THRESHOLD : level >= ADVISORY_THRESHOLD;
    // Temporal-baseline check: once the baseline has enough samples, require
    // the reading to also be anomalous for its hour-of-week. Until then,
    // fall back to the fixed threshold alone so boot-time isn't silent.
    // Use explicit .sufficient rather than a `sigma === 0` proxy — sigma
    // can also be 0 for sufficient-but-flat baselines, which would cause
    // the temporal check to be bypassed when it shouldn't be.
    const baselineReady = getBaseline(d).sufficient;
    const passesTemporal = isAboveNormal(d, level);
    const sigma = deviationSigma(d, level);
    const nowAdvised = passesFixedThreshold && (!baselineReady || passesTemporal);

    if (nowAdvised) {
      advised.add(d);
      const eta = etaToThreshold(level, slope, acceleration, ADVISORY_THRESHOLD);
      advisories.push({
        domain: d,
        pressure: level,
        slope,
        etaMin: eta,
        statement: buildStatement(d, level, slope, eta) +
          (sigma >= 2 ? ` (${sigma.toFixed(1)}σ above hour-of-week baseline)` : ''),
        timestamp: Date.now(),
      });
    } else if (wasAdvised) {
      advised.delete(d);
    }
  }

  advisories.sort((a, b) => b.pressure - a.pressure);

  const snapshot: ForecastSnapshot = {
    timestamp: Date.now(),
    advisories,
    pressure: { ...pressure },
  };
  persist(snapshot);
  document.dispatchEvent(new CustomEvent<ForecastSnapshot>(EVENT_NAME, { detail: snapshot }));
  const latencyMs = performance.now() - t0;
  recordLatency('forecast-cycle', latencyMs);
  incrementCounter('forecast-cycle.runs');
  logDebug({ level: 'info', category: 'forecast', source: 'mode-forecast',
    message: 'cycle complete', latencyMs,
    data: { advisories: advisories.length, pressure: { ...pressure } } });
  return snapshot;
}

// ── Background loop ──────────────────────────────────────────────────────────

let started = false;
let timerId: ReturnType<typeof setTimeout> | null = null;

function scheduleNext(): void {
  if (!started) return;
  timerId = setTimeout(() => {
    if (!started) return;
    try { runForecastCycle(); } catch { /* keep looping */ }
    scheduleNext();
  }, BASE_INTERVAL_MS);
}

export function startModeForecast(): void {
  if (started) return;
  started = true;
  // Defer the initial cycle so pressure-history, pressure-baselines,
  // auto-brief, sidecar-pusher, and the HUD subscribe before the first
  // cb:mode-advisory dispatches.
  setTimeout(() => {
    try { runForecastCycle(); } catch { /* ignore */ }
  }, 0);
  scheduleNext();
}

export function stopModeForecast(): void {
  started = false;
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

export function subscribeModeAdvisory(cb: (snapshot: ForecastSnapshot) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
