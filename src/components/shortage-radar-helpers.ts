/**
 * Pure helpers extracted from ShortageRadarPanel so they can be tested
 * without a DOM. No imports of Panel or anything browser-specific.
 */

import type {
  ShortageSummaryEntry,
  FullSetCommodity,
  RiskLevel,
} from '@/services/shortage/shortage-fullset';
import { ALL_FULLSET_COMMODITIES } from '@/services/shortage/shortage-fullset';

export const PREV_LEVELS_LS_KEY = 'cb:shortage:prev-risk-levels';

/** A summary is "unwired" when its model ran with no useful inputs:
 *  zero risk score, no drivers, and a long list of data gaps. The UI
 *  surfaces this as "NO DATA" rather than the misleading green LOW that
 *  the raw model would suggest. */
export function isUnwired(entry: ShortageSummaryEntry): boolean {
  return (
    entry.riskScore === 0 &&
    entry.primaryDrivers.length === 0 &&
    entry.forecast.dataGaps.length >= 3
  );
}

/** Notification ladder gate: fire only on a HIGH→CRITICAL transition
 *  (or first observation if the panel is already CRITICAL on a fresh
 *  install). A no-op while the commodity remains CRITICAL across ticks. */
export function shouldFireCritical(prev: RiskLevel | undefined, current: RiskLevel): boolean {
  return current === 'CRITICAL' && prev !== 'CRITICAL';
}

/** Best-effort load of the persisted prev-risk-level map. Returns an
 *  empty Map when localStorage is unavailable or the payload is corrupt. */
export function loadPrevRiskLevels(
  storage: Pick<Storage, 'getItem'> | undefined,
): Map<FullSetCommodity, RiskLevel> {
  const out = new Map<FullSetCommodity, RiskLevel>();
  if (!storage) return out;
  try {
    const raw = storage.getItem(PREV_LEVELS_LS_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, RiskLevel>;
    for (const c of ALL_FULLSET_COMMODITIES) {
      const v = parsed[c];
      if (v === 'CRITICAL' || v === 'HIGH' || v === 'MODERATE' || v === 'LOW') {
        out.set(c, v);
      }
    }
  } catch {
    // Corrupt payload — silently fall back to an empty map.
  }
  return out;
}

export function savePrevRiskLevels(
  storage: Pick<Storage, 'setItem'> | undefined,
  map: ReadonlyMap<FullSetCommodity, RiskLevel>,
): void {
  if (!storage) return;
  try {
    const obj: Record<string, RiskLevel> = {};
    for (const [k, v] of map) obj[k] = v;
    storage.setItem(PREV_LEVELS_LS_KEY, JSON.stringify(obj));
  } catch {
    // localStorage may be full or unavailable; alert dedupe degrades to
    // in-memory only.
  }
}
