/**
 * Live pair view-model for CorrelationMapPanel — turns kernel-scored
 * CorrelatedPair output into a renderable row shape (domain arrow,
 * confidence, learned-rule badge, regime-boost flag, factor chips).
 *
 * Pure: no DOM, no fetch, no imports from components.
 */

import type { CorrelatedPair } from '../intelligence/correlate-engine';
import { LEARNED_RULE_PREFIX } from './learned-rules';

export interface FactorChip {
  key: string;
  value: number;
}

export interface LivePairRow {
  ruleId: string;
  learned: boolean;
  edgeType: string;
  fromDomain: string;
  toDomain: string;
  fromTitle: string;
  toTitle: string;
  confidence: number;
  ageMs: number;
  regimeBoosted: boolean;
  reliabilityLearned: boolean;
  factorChips: FactorChip[];
  explanation: string;
}

const MAX_ROWS = 30;

/** True if a value has the minimum shape buildLivePairRows can safely render.
 *  The correlation store hydrates persisted pairs from localStorage, so a
 *  corrupted/stale entry can reach here after a reload — drop it silently
 *  rather than throwing and blanking the whole panel. */
function isRenderablePair(p: unknown): p is CorrelatedPair {
  if (typeof p !== 'object' || p === null) return false;
  const c = p as Record<string, unknown>;
  if (typeof c.ruleId !== 'string') return false;
  if (!(c.detectedAt instanceof Date) || !Number.isFinite(c.detectedAt.getTime())) return false;
  if (typeof c.confidence !== 'number' || !Number.isFinite(c.confidence)) return false;
  if (!isEventLike(c.eventA) || !isEventLike(c.eventB)) return false;
  return true;
}

function isEventLike(e: unknown): e is { domain: string; title: unknown } {
  return typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>).domain === 'string';
}

export function buildLivePairRows(pairs: readonly CorrelatedPair[], now: number): LivePairRow[] {
  return pairs
    .filter((p) => isRenderablePair(p))
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
    .slice(0, MAX_ROWS)
    .map((p) => {
      const f = p.confidenceDetail?.factors;
      const chips: FactorChip[] = f
        ? (Object.entries(f) as [string, number][])
            .filter(([k, v]) => k !== 'base' && Math.abs(v - 1) > 0.001)
            .map(([key, value]) => ({ key, value: Math.round(value * 100) / 100 }))
        : [];
      return {
        ruleId: p.ruleId,
        learned: p.ruleId.startsWith(LEARNED_RULE_PREFIX),
        edgeType: p.edgeType,
        fromDomain: p.eventA.domain,
        toDomain: p.eventB.domain,
        fromTitle: typeof p.eventA.title === 'string' ? p.eventA.title : '',
        toTitle: typeof p.eventB.title === 'string' ? p.eventB.title : '',
        confidence: p.confidence,
        ageMs: Math.max(0, now - p.detectedAt.getTime()),
        regimeBoosted: (f?.regime ?? 1) > 1,
        reliabilityLearned: f != null && Math.abs(f.reliability - 1) > 0.001,
        factorChips: chips,
        explanation: p.confidenceDetail?.explanation ?? '',
      };
    });
}
