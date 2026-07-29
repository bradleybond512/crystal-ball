/**
 * Baseline model source ids (ACC-301/ACC-302) — shared so every
 * baseline's history filter can exclude ALL baseline-sourced records
 * (never train a baseline on another baseline), without circular
 * imports between the model modules.
 */

export const HIERARCHICAL_BASE_RATE_SOURCE_ID = 'hierarchical-base-rate';
export const PERSISTENCE_BASELINE_SOURCE_ID = 'persistence-baseline';
export const MOMENTUM_BASELINE_SOURCE_ID = 'momentum-baseline';

export const BASELINE_SOURCE_IDS: ReadonlySet<string> = new Set([
  HIERARCHICAL_BASE_RATE_SOURCE_ID,
  PERSISTENCE_BASELINE_SOURCE_ID,
  MOMENTUM_BASELINE_SOURCE_ID,
]);

export function isBaselineSourceId(sourceId: string): boolean {
  return BASELINE_SOURCE_IDS.has(sourceId);
}
