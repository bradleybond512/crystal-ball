// src/services/survival/grid-down-certify.ts
//
// E6 · Survival Kernel hardening — grid-down "zero bars" certification.
//
// E1 proved the grid-down guarantee for ONE domain (weather → physical_safety):
// with the network off, the slice still renders from the last WorldSnapshot,
// data-age marked. E6 generalizes that guarantee to ALL eight survival axes and
// makes it *checkable*: given only a snapshot, can the operator still SEE every
// axis and ACT on every elevated one, entirely offline?
//
// This module answers that as a pure certification. For each axis it decides:
//   - readable  — is the axis present in the snapshot's posture at all? (if not,
//                 there is nothing to render offline → blind)
//   - stale     — is the axis's backing data older than the offline tolerance?
//                 (offline data is inevitably old; we flag it, we don't panic)
//   - blind     — is it SO old it can no longer be trusted to certify? (a hard
//                 horizon well beyond the stale flag)
//   - guidance  — for an elevated axis, is there something to act on offline
//                 (a threat or a driver on it, both carried in the snapshot)? An
//                 elevated axis with no offline play is the real failure mode.
//
// The overall certification passes only when nothing is blind and every axis
// that needs an offline play has one. Staleness within the blind horizon
// degrades an axis but — since old-but-readable data is exactly what grid-down
// is for — does not by itself revoke the certification.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// snapshot + options alone.

import type {
  DomainFreshness,
  SnapshotDomain,
  SurvivalAxis,
  SurvivalPosture,
  WorldSnapshot,
} from './survival-types.ts';
import { axisLabel, bandForLevel, bandRank, SURVIVAL_AXES } from './survival-types.ts';

/** Which snapshot domain's freshness backs each axis. Axes with no dedicated
 *  domain fall back to the whole-snapshot capture age. Extends as E6 widens the
 *  snapshot beyond weather. */
const AXIS_FRESHNESS_DOMAIN: Partial<Record<SurvivalAxis, SnapshotDomain>> = {
  physical_safety: 'weather',
};

/** An axis needs an offline play once it reaches this level (band `elevated`).
 *  Exported so the offline-playbook resolver keys its "elevated" floor off the
 *  exact same threshold this certification flags as a guidance gap. */
export const GUIDANCE_LEVEL = 40;

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60_000; // 6h — flag as stale beyond this
export const DEFAULT_BLIND_AFTER_MS = 24 * 60 * 60_000; // 24h — too old to certify at all

export type GridDownStatus = 'ready' | 'degraded' | 'blind';

export interface GridDownAxisVerdict {
  axis: SurvivalAxis;
  status: GridDownStatus;
  /** 0–100 posture level carried in the snapshot (0 if the axis is absent). */
  level: number;
  /** Age of the data backing this axis, ms. */
  dataAgeMs: number;
  /** The axis is present in the snapshot posture and can be rendered offline. */
  readable: boolean;
  /** Backing data is older than the stale tolerance (but still within blind). */
  stale: boolean;
  /** This axis is elevated enough to require an offline play. */
  needsGuidance: boolean;
  /** There is a threat or driver on this axis to act on offline. */
  hasGuidance: boolean;
  /** Plain-language reason for the status. */
  reason: string;
}

export interface GridDownCertification {
  capturedAtMs: number;
  now: number;
  axisVerdicts: GridDownAxisVerdict[];
  /** Axes with nothing renderable offline (absent, or data past the blind horizon). */
  blindAxes: SurvivalAxis[];
  /** Elevated axes with no offline play. */
  guidanceGapAxes: SurvivalAxis[];
  /** Readable axes on data older than the stale tolerance. */
  staleAxes: SurvivalAxis[];
  /** True when nothing is blind and every elevated axis has an offline play. */
  certified: boolean;
  headline: string;
}

export interface GridDownOptions {
  now?: number;
  staleAfterMs?: number;
  blindAfterMs?: number;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, finite(n)));
}

/** Age of the data backing `axis`: its dedicated domain freshness if present,
 *  else the whole-snapshot capture age. */
function axisDataAgeMs(axis: SurvivalAxis, snapshot: WorldSnapshot, now: number): number {
  const domain = AXIS_FRESHNESS_DOMAIN[axis];
  if (domain) {
    const f: DomainFreshness | undefined = snapshot.freshness.find((x) => x.domain === domain);
    if (f) return Math.max(0, now - finite(f.fetchedAtMs));
  }
  return Math.max(0, now - finite(snapshot.capturedAtMs));
}

/** Does this axis carry actionable offline content — an active threat or a
 *  named driver — that the operator could work from with no network? (Committed
 *  moves are deliberately not credited here: the snapshot carries only moveIds,
 *  not the roster needed to resolve which axis a move affects, and an elevated
 *  axis effectively always has threats/drivers to act on.) */
function axisHasOfflinePlay(posture: SurvivalPosture, axis: SurvivalAxis): boolean {
  const state = posture.axes.find((a) => a.axis === axis);
  if (!state) return false;
  return state.threats.length > 0 || state.drivers.length > 0;
}

function verdictFor(
  axis: SurvivalAxis,
  snapshot: WorldSnapshot,
  now: number,
  staleAfterMs: number,
  blindAfterMs: number,
): GridDownAxisVerdict {
  const state = snapshot.posture.axes.find((a) => a.axis === axis);
  const dataAgeMs = axisDataAgeMs(axis, snapshot, now);
  const level = state ? clampLevel(state.level) : 0;
  const readable = Boolean(state);
  const needsGuidance = level >= GUIDANCE_LEVEL;
  const hasGuidance = readable && axisHasOfflinePlay(snapshot.posture, axis);

  if (!readable) {
    return {
      axis, status: 'blind', level: 0, dataAgeMs, readable: false, stale: false,
      needsGuidance: false, hasGuidance: false,
      reason: `${axisLabel(axis)} is absent from the snapshot — nothing to render offline.`,
    };
  }

  if (dataAgeMs > blindAfterMs) {
    return {
      axis, status: 'blind', level, dataAgeMs, readable: true, stale: true,
      needsGuidance, hasGuidance,
      reason: `${axisLabel(axis)} data is ${Math.round(dataAgeMs / 3_600_000)}h old — past the ${Math.round(blindAfterMs / 3_600_000)}h trust horizon.`,
    };
  }

  const stale = dataAgeMs > staleAfterMs;

  if (needsGuidance && !hasGuidance) {
    return {
      axis, status: 'degraded', level, dataAgeMs, readable: true, stale,
      needsGuidance, hasGuidance: false,
      reason: `${axisLabel(axis)} is ${bandForLevel(level)} but carries no offline play (no threat or driver).`,
    };
  }

  if (stale) {
    return {
      axis, status: 'degraded', level, dataAgeMs, readable: true, stale: true,
      needsGuidance, hasGuidance,
      reason: `${axisLabel(axis)} renders offline but its data is ${Math.round(dataAgeMs / 3_600_000)}h old.`,
    };
  }

  return {
    axis, status: 'ready', level, dataAgeMs, readable: true, stale: false,
    needsGuidance, hasGuidance,
    reason: `${axisLabel(axis)} renders and acts fully offline.`,
  };
}

export function certifyGridDown(snapshot: WorldSnapshot, options: GridDownOptions = {}): GridDownCertification {
  // A non-finite clock can't age anything — fall back to the capture time (the
  // projectView default: "assume the snapshot is current") rather than leaking
  // NaN, which would make every stale/blind comparison false and certify a dead
  // snapshot fail-open.
  const now = Number.isFinite(options.now) ? (options.now as number) : finite(snapshot.capturedAtMs);
  const staleAfterMs = Math.max(0, finite(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
  const blindAfterMs = Math.max(staleAfterMs, finite(options.blindAfterMs ?? DEFAULT_BLIND_AFTER_MS));

  const axisVerdicts = SURVIVAL_AXES.map((axis) => verdictFor(axis, snapshot, now, staleAfterMs, blindAfterMs));

  const blindAxes = axisVerdicts.filter((v) => v.status === 'blind').map((v) => v.axis);
  const guidanceGapAxes = axisVerdicts.filter((v) => v.needsGuidance && !v.hasGuidance && v.readable).map((v) => v.axis);
  const staleAxes = axisVerdicts.filter((v) => v.readable && v.stale && v.status !== 'blind').map((v) => v.axis);

  const certified = blindAxes.length === 0 && guidanceGapAxes.length === 0;

  const headline = buildHeadline(axisVerdicts, blindAxes, guidanceGapAxes, staleAxes, certified);

  return { capturedAtMs: snapshot.capturedAtMs, now, axisVerdicts, blindAxes, guidanceGapAxes, staleAxes, certified, headline };
}

/** The single most-threatened axis among a set, for headline naming. */
function worstOf(axes: readonly SurvivalAxis[], verdicts: readonly GridDownAxisVerdict[]): SurvivalAxis | null {
  let worst: GridDownAxisVerdict | null = null;
  for (const v of verdicts) {
    if (!axes.includes(v.axis)) continue;
    if (!worst || bandRank(bandForLevel(v.level)) > bandRank(bandForLevel(worst.level))) worst = v;
  }
  return worst ? worst.axis : null;
}

function buildHeadline(
  verdicts: readonly GridDownAxisVerdict[],
  blindAxes: readonly SurvivalAxis[],
  guidanceGapAxes: readonly SurvivalAxis[],
  staleAxes: readonly SurvivalAxis[],
  certified: boolean,
): string {
  const total = verdicts.length;
  if (!certified) {
    if (blindAxes.length > 0) {
      const worst = worstOf(blindAxes, verdicts) ?? blindAxes[0]!;
      const more = blindAxes.length > 1 ? ` (+${blindAxes.length - 1} more)` : '';
      return `Not grid-down certified — ${axisLabel(worst)} is blind offline${more}.`;
    }
    const worst = worstOf(guidanceGapAxes, verdicts) ?? guidanceGapAxes[0]!;
    const more = guidanceGapAxes.length > 1 ? ` (+${guidanceGapAxes.length - 1} more)` : '';
    return `Not grid-down certified — ${axisLabel(worst)} is elevated with no offline play${more}.`;
  }
  if (staleAxes.length > 0) {
    return `Grid-down certified — all ${total} axes render and act offline; ${staleAxes.length} on stale data.`;
  }
  return `Grid-down certified — all ${total} axes render and act fully offline.`;
}
