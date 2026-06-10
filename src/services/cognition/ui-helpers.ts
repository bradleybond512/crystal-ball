/**
 * Cognition UI Helpers — PR 6 of the Cognitive Enhancement Plan.
 *
 * Pure, deterministic formatting utilities shared across the UI wiring surfaces
 * (AnalystHUD, CommandCenterPanel). No DOM, no fetch, no globals at import time.
 *
 * Also exports:
 *   - Flag guard API  (cogFlags): per-feature on/off persisted to localStorage
 *     key `crystalball-cognition-flags-v1`.
 *   - Destructive wipe helpers: wipeEpisodicMemory, wipeJournalEntries,
 *     resetOperatorModelStore — thin wrappers over each service's existing
 *     clear/reset entry point.
 *
 * Design invariants:
 *   - Every formatter returns a non-empty string (never throws on bad input).
 *   - Flag guards default to enabled (opt-out, not opt-in).
 *   - Wipe helpers are synchronous-first (localStorage cleared immediately),
 *     IDB cleared fire-and-forget.
 */

import type { Recall } from './episodic-memory';
import type { SuperForecast } from './superforecast';
import type { Estimate } from './probability-aggregation';
import type { CollectionAction } from './evoi-planner';
import type { EntityDossier } from './entity-dossier';
import type { ReliabilityCurve } from './recalibration';
import type { CalibrationComparison } from './forecast-journal';

// ── Cognition feature flags ───────────────────────────────────────────────────

export type CognitionFlagKey =
  | 'episodic-memory'
  | 'personalization'
  | 'superforecast';

const FLAGS_KEY = 'crystalball-cognition-flags-v1';

/** Default: all flags enabled. */
const FLAG_DEFAULTS: Record<CognitionFlagKey, boolean> = {
  'episodic-memory': true,
  'personalization': true,
  'superforecast': true,
};

function loadFlags(): Record<CognitionFlagKey, boolean> {
  try {
    if (typeof localStorage === 'undefined') return { ...FLAG_DEFAULTS };
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return { ...FLAG_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<CognitionFlagKey, boolean>>;
    return {
      'episodic-memory': parsed['episodic-memory'] ?? FLAG_DEFAULTS['episodic-memory'],
      'personalization': parsed['personalization'] ?? FLAG_DEFAULTS['personalization'],
      'superforecast': parsed['superforecast'] ?? FLAG_DEFAULTS['superforecast'],
    };
  } catch {
    return { ...FLAG_DEFAULTS };
  }
}

function saveFlags(flags: Record<CognitionFlagKey, boolean>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
  } catch { /* quota */ }
}

export const cogFlags = {
  get(key: CognitionFlagKey): boolean {
    return loadFlags()[key];
  },
  set(key: CognitionFlagKey, value: boolean): void {
    const flags = loadFlags();
    flags[key] = value;
    saveFlags(flags);
  },
  all(): Record<CognitionFlagKey, boolean> {
    return loadFlags();
  },
};

// ── Destructive wipe helpers ──────────────────────────────────────────────────

/**
 * Wipe all episodic memory.
 * Clears localStorage synchronously; IDB cleared fire-and-forget via
 * reasoning-memory putMemory (overwrite with empty array).
 */
export function wipeEpisodicMemory(): void {
  const key = 'crystalball-cognition-episodic-v1';
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch { /* ignore */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    void mod.putMemory(key, []);
  } catch { /* test / unavailable */ }
  // Also clear the analog score cache (no external import needed — event).
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('crystalball-cognition-analog-cache-v1');
    }
  } catch { /* ignore */ }
}

/**
 * Wipe the operator forecast journal.
 * Clears localStorage synchronously; IDB cleared fire-and-forget.
 */
export function wipeJournalEntries(): void {
  const key = 'crystalball-cognition-journal-v1';
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch { /* ignore */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    void mod.putMemory(key, []);
  } catch { /* test / unavailable */ }
}

/**
 * Reset the operator model to factory defaults.
 * Delegates to the service's own resetOperatorModel() so the in-memory
 * singleton is also cleared (not just the persistence layer).
 */
export function resetOperatorModelStore(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/cognition/operator-model') as {
      resetOperatorModel: () => void;
    };
    mod.resetOperatorModel();
  } catch { /* unavailable in pure unit tests */ }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Format an outcome badge string for an episode recall.
 * Returns a short ASCII tag: [materialized], [fizzled], [contradictory], etc.
 */
export function formatOutcomeBadge(
  outcome: string | undefined,
  contradictory?: boolean,
): string {
  if (contradictory) return '[contradictory]';
  switch (outcome) {
    case 'materialized': return '[materialized]';
    case 'fizzled':      return '[fizzled]';
    case 'partial':      return '[partial]';
    case 'unknown':      return '[unknown]';
    default:             return '[pending]';
  }
}

/**
 * Format a similarity percentage as a readable string.
 * e.g. 0.74 → "74%"
 */
export function formatSimilarityPct(similarity: number): string {
  return `${Math.round(similarity * 100)}%`;
}

/**
 * Format a conformal prediction interval as a whisker string.
 * e.g. p=0.62, lo=0.48, hi=0.76 → "62% [48–76%]"
 * Falls back gracefully when interval data is unavailable.
 */
export function formatIntervalWhisker(
  p: number,
  lo: number | undefined,
  hi: number | undefined,
): string {
  const pct = `${Math.round(p * 100)}%`;
  if (lo === undefined || hi === undefined) return pct;
  const loPct = Math.round(lo * 100);
  const hiPct = Math.round(hi * 100);
  if (loPct === 0 && hiPct === 100) {
    // Uninformative interval — suppress the whisker.
    return pct;
  }
  return `${pct} [${loPct}–${hiPct}%]`;
}

/**
 * Format the estimates table from a SuperForecast into a human-readable list.
 * Returns an array of lines (source / p% / weight).
 */
export function formatEstimatesTable(estimates: readonly Estimate[]): string[] {
  if (estimates.length === 0) return ['(no estimates)'];
  return estimates.map(e => {
    const pPct = `${Math.round(e.p * 100)}%`;
    const wPct = `${Math.round(e.weight * 100)}%`;
    return `${e.source}: ${pPct} (weight ${wPct})`;
  });
}

/**
 * Summarise a SuperForecast spread into a human readable description.
 * e.g. 0.18 → "spread 18%" (moderate disagreement)
 */
export function formatSpreadLabel(spread: number): string {
  const pct = Math.round(spread * 100);
  if (pct >= 30) return `spread ${pct}% — high disagreement`;
  if (pct >= 15) return `spread ${pct}% — moderate disagreement`;
  return `spread ${pct}% — consensus`;
}

/**
 * Format the trajectory arrow for an entity dossier.
 * ▲ heating / ▬ stable / ▼ cooling
 */
export function formatTrajectoryArrow(trajectory: EntityDossier['trajectory']): string {
  switch (trajectory) {
    case 'heating': return '▲';
    case 'cooling': return '▼';
    default:        return '▬';
  }
}

/**
 * Format the trajectory evidence counts into a tooltip string.
 * e.g. "7d: 12 events / prior 21d: 8 events"
 */
export function formatTrajectoryTooltip(dossier: EntityDossier): string {
  const ev = dossier.trajectoryEvidence;
  const rr = ev.rateRatio !== null ? ` (rate ratio ${ev.rateRatio.toFixed(2)}x)` : ' (insufficient samples)';
  return `7d: ${ev.recent7dCount} events / prior 21d: ${ev.prior21dCount} events${rr}`;
}

/**
 * Format a calibration report card line for a reliability curve.
 * Returns a one-line summary of system Brier + miscalibration description.
 *
 * Example: "Brier 0.18 (n=52) — most miscalibrated at 50–60% bin"
 */
export function formatCalibrationSummary(curve: ReliabilityCurve): string {
  const n = curve.sampleSize;
  if (n === 0) return 'No resolved forecasts yet — calibration data accumulating.';

  const brierStr = curve.brier.toFixed(3);
  // Find the bin with the biggest |observedRate - predictedMean| gap.
  let maxGap = 0;
  let worstBin: ReliabilityCurve['bins'][0] | null = null;
  for (const bin of curve.bins) {
    if (bin.n === 0) continue;
    const gap = Math.abs(bin.observedRate - bin.predictedMean);
    if (gap > maxGap) { maxGap = gap; worstBin = bin; }
  }
  const worstStr = worstBin
    ? ` — most miscalibrated at ${Math.round(worstBin.lo * 100)}–${Math.round(worstBin.hi * 100)}% bin (gap ${Math.round(maxGap * 100)} pp)`
    : '';

  return `Brier ${brierStr} (n=${n})${worstStr}`;
}

/**
 * Format a CalibrationComparison into a readable "you vs system" line.
 * Returns empty string when humanEdge is null (insufficient data).
 */
export function formatComparisonLine(cmp: CalibrationComparison): string {
  if (cmp.humanEdge === null) {
    const opN = cmp.operator.n;
    const sysN = cmp.system.n;
    const needed = 30;
    return `Log ${Math.max(0, needed - opN)} more forecasts to unlock comparison (you: n=${opN}, system: n=${sysN}).`;
  }
  const edge = cmp.humanEdge;
  const sign = edge > 0 ? '+' : '';
  if (edge > 0) {
    return `You outperform the system (humanEdge ${sign}${edge.toFixed(3)}) — your calls ranked up.`;
  } else if (edge < 0) {
    return `System outperforms you (humanEdge ${edge.toFixed(3)}) — keep logging to improve.`;
  }
  return `You and the system are equally calibrated (Brier ${cmp.operator.brier.toFixed(3)}).`;
}

/**
 * Format an EVOI CollectionAction for display.
 * Returns a short label with info gain in bits.
 */
export function formatEvoiChip(action: CollectionAction): string {
  const bits = action.expectedInfoGainBits.toFixed(2);
  return `${action.label} (+${bits} bits)`;
}

/**
 * Format an analog recall line for the "Past analogs" block.
 * Returns a compact description: similarity %, outcome badge, explanation.
 */
export function formatAnalogLine(recall: Recall): string {
  const sim = formatSimilarityPct(recall.similarity);
  const badge = formatOutcomeBadge(recall.episode.outcome, recall.episode.contradictory);
  const age = recall.ageDays < 1
    ? 'today'
    : recall.ageDays < 30
    ? `${Math.round(recall.ageDays)}d ago`
    : `${Math.round(recall.ageDays / 30)}mo ago`;
  return `${sim} ${badge} ${age} — ${recall.explanation}`;
}

// ── Type re-exports (so HUD/Panel imports stay minimal) ───────────────────────

export type { Recall, SuperForecast, Estimate, CollectionAction, EntityDossier, ReliabilityCurve, CalibrationComparison };
