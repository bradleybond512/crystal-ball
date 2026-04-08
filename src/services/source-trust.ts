/* eslint-disable sonarjs/void-use */
/**
 * Per-source trust score (0–1). Multiplied into alert hotness so noisy/low-
 * confidence feeds don't get the same panic budget as authoritative ones.
 *
 * Calibration: 1.0 = official government / direct sensor; 0.5 = OSINT/aggregator;
 * <0.5 = chatter/heuristic.
 */

import type { AlertSource } from './unified-alerts';

export const SOURCE_TRUST: Record<AlertSource, number> = {
  'breaking-news': 0.7,
  'nws': 1,
  'gdacs': 1,
  'tsunami': 1,
  'volcano': 0.95,
  'oref': 1,
  'hazard': 0.85,
  'correlation': 0.9,
  'cyber': 0.6,
  'resource': 0.7,
  'local-ids': 0.45,
  'earthquake': 1,
  'fire': 0.9,
  'cyclone': 1,
};

export function getSourceTrust(source: AlertSource): number {
  return SOURCE_TRUST[source] ?? 0.7;
}
