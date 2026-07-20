/**
 * Maps a `SelfTestReport` (one row per domain) into an operational
 * mission-state level the UI can hoist into the toolbar pill.
 *
 * Distinct from `mission-state-mapper.ts`: that module operates on
 * per-feed health and returns the uppercase 4-state enum
 * (NOMINAL/LIMITED/DEGRADED/ENHANCED) used by the Diagnostic Self-Test
 * Panel. This module is the lowercase report-driven variant used by the
 * new Self-Test Runner panel + toolbar.
 *
 * Pure / deterministic / no DOM / no fetch.
 */

import type { SelfTestReport, SmokeStatus } from './self-test-runner';
import { TOP_PRIORITY_DOMAINS } from './self-test-runner';

export type MissionState = 'nominal' | 'reduced' | 'degraded' | 'critical';

export interface MissionStateOptions {
  /** Domains whose failure forces a `critical` rollup regardless of
   *  global percentages. Defaults to TOP_PRIORITY_DOMAINS. */
  topPriorityDomains?: readonly string[];
  /** Fraction of FAILED domains that flips global to `degraded`. */
  degradedFailThreshold?: number;
  /** Fraction of WARNED domains that flips global to `reduced`. */
  reducedWarnThreshold?: number;
}

export const DEFAULT_DEGRADED_FAIL_THRESHOLD = 0.5;
export const DEFAULT_REDUCED_WARN_THRESHOLD = 0.25;

/**
 * Compute the mission-state level from a self-test report. Order of
 * precedence (highest wins):
 *
 *   critical  any top-priority domain (earthquakes, weather, nuclear by
 *             default) is in FAIL
 *   degraded  more than `degradedFailThreshold` of domains are FAIL
 *   reduced   more than `reducedWarnThreshold` of domains are WARN OR
 *             any domain is FAIL but the global fail-ratio is sub-threshold
 *   nominal   everything else (including all-pass)
 *
 * An empty report (no domains) returns `nominal`. The thresholds are
 * configurable so the UI can present an "operator mode" slider later.
 */
export function getMissionState(
  report: SelfTestReport,
  options: MissionStateOptions = {},
): MissionState {
  const topPriority = options.topPriorityDomains ?? TOP_PRIORITY_DOMAINS;
  const degradedFailThreshold = options.degradedFailThreshold ?? DEFAULT_DEGRADED_FAIL_THRESHOLD;
  const reducedWarnThreshold = options.reducedWarnThreshold ?? DEFAULT_REDUCED_WARN_THRESHOLD;

  const entries = Object.entries(report.results);
  if (entries.length === 0) return 'nominal';

  for (const domain of topPriority) {
    const result = report.results[domain];
    if (result?.status === 'fail') return 'critical';
  }

  const total = entries.length;
  const failed = countStatus(entries, 'fail');
  const warned = countStatus(entries, 'warn');

  if (failed / total > degradedFailThreshold) return 'degraded';
  if (warned / total > reducedWarnThreshold || failed > 0) return 'reduced';
  return 'nominal';
}

/** Human-readable label paired with each mission state — convenient for
 *  the toolbar pill and the export bundle. */
export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  nominal:  'Nominal',
  reduced:  'Reduced Capability',
  degraded: 'Degraded',
  critical: 'Critical',
};

/** CSS color tokens to render the mission state. Hex so the toolbar
 *  pill works in both the dark-mode and light-mode themes. */
export const MISSION_STATE_COLOR: Record<MissionState, string> = {
  nominal:  '#4caf50',
  reduced:  '#ffc107',
  degraded: '#ff9800',
  critical: '#ff453a',
};

/** Order from healthiest to worst; useful for sorting / comparing two
 *  states (e.g. "did mission state regress this minute?"). */
export const MISSION_STATE_ORDER: readonly MissionState[] = [
  'nominal',
  'reduced',
  'degraded',
  'critical',
];

function countStatus(
  entries: readonly (readonly [string, { status: SmokeStatus }])[],
  status: SmokeStatus,
): number {
  let n = 0;
  for (const [, r] of entries) if (r.status === status) n += 1;
  return n;
}
