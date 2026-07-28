// src/services/survival/offline-playbook.ts
//
// E6 · Survival Kernel hardening — the all-axis offline playbook resolver.
//
// grid-down-certify.ts DETECTS the real grid-down failure mode: an elevated
// axis the operator can SEE but can't ACT on offline (`guidanceGapAxes` — an
// axis at band `elevated`+ with no threat and no driver to work from). It flags
// the gap; it does not fill it. This module fills it.
//
// Given only a WorldSnapshot — no network, no clock — it resolves, for every
// elevated axis, a concrete list of things the operator can do RIGHT NOW with
// no connectivity:
//
//   - physical_safety draws on the calibrated weather library
//     (preparedness-actions.ts), keyed by each carried threat's hazardKind, so
//     a Tornado Warning yields "move to the lowest interior room", not mush.
//     With no weather threat on the axis it falls back to a static safety play.
//   - the other seven axes (supply, financial, mobility, comms, health,
//     energy_water, security) each have a static, band-scaled offline playbook.
//     Every axis carries at least one action at the elevated floor, so an
//     elevated axis ALWAYS resolves to ≥1 action — the gap closes by
//     construction.
//
// Higher bands unlock escalation actions (each action declares the posture
// level at/above which it applies), so a `critical` axis gets more, and more
// urgent, guidance than a merely `elevated` one.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed
// snapshot alone.

import type {
  AxisState,
  SurvivalAxis,
  SurvivalBand,
  WorldSnapshot,
} from './survival-types.ts';
import { axisLabel, bandForLevel, SURVIVAL_AXES } from './survival-types.ts';
import { GUIDANCE_LEVEL } from './grid-down-certify.ts';
import type { PreparednessAction } from '../weather/preparedness-actions.ts';
import { actionsForHazard } from '../weather/preparedness-actions.ts';

/** Where a resolved action came from. */
export type OfflinePlaySource = 'weather_hazard' | 'axis_playbook';

export interface OfflinePlayItem {
  id: string;
  label: string;
  rationale?: string;
  /** 1 = do now, 5 = nice-to-have (mirrors PreparednessAction). */
  priority: 1 | 2 | 3 | 4 | 5;
  estimatedMinutes: number;
  source: OfflinePlaySource;
}

export interface AxisOfflinePlaybook {
  axis: SurvivalAxis;
  level: number;
  band: SurvivalBand;
  /** Plain-language reasons this axis needs an offline play (hazard labels for
   *  physical_safety, posture drivers otherwise). Never empty. */
  triggers: string[];
  actions: OfflinePlayItem[];
}

export interface OfflinePlaybookResult {
  capturedAtMs: number;
  /** One entry per elevated axis, worst-first. */
  playbooks: AxisOfflinePlaybook[];
  /** Elevated axes that resolved to zero actions. Empty by construction —
   *  surfaced so a regression (a new axis with no static playbook) is loud. */
  unresolvedAxes: SurvivalAxis[];
  headline: string;
}

export interface OfflinePlaybookOptions {
  /** Cap actions per axis (worst-first survive). Default: no cap. */
  maxPerAxis?: number;
}

// ── Static per-axis playbooks ────────────────────────────────────────────────
// Each action declares `minLevel`: the posture level at/above which it applies.
// Every axis has at least one action at the elevated floor (GUIDANCE_LEVEL), so
// any elevated axis resolves to ≥1 action.

interface AxisPlayAction extends PreparednessAction {
  /** Posture level (0–100) at/above which this action is offered. */
  minLevel: number;
}

const HIGH_BAND_LEVEL = 60; // band `high` — escalation actions unlock here.

const PHYSICAL_SAFETY_FALLBACK: readonly AxisPlayAction[] = [
  { id: 'ps-shelter', label: 'Move to the safest available interior space', rationale: 'Away from windows, exterior walls, and anything that could fall.', priority: 1, estimatedMinutes: 2, minLevel: GUIDANCE_LEVEL },
  { id: 'ps-shoes-light', label: 'Keep shoes and a flashlight within reach', priority: 2, estimatedMinutes: 1, minLevel: GUIDANCE_LEVEL },
  { id: 'ps-monitor', label: 'Monitor local emergency broadcasts', rationale: 'A battery or hand-crank radio works when the network does not.', priority: 2, estimatedMinutes: 2, minLevel: GUIDANCE_LEVEL },
  { id: 'ps-ready-evac', label: 'Stage a go-bag and be ready to evacuate if told to', priority: 1, estimatedMinutes: 10, minLevel: HIGH_BAND_LEVEL },
];

const AXIS_PLAYBOOKS: Record<Exclude<SurvivalAxis, 'physical_safety'>, readonly AxisPlayAction[]> = {
  supply: [
    { id: 'supply-inventory', label: 'Inventory food, water, and medications on hand', priority: 2, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'supply-refill-rx', label: 'Refill essential prescriptions while stores are open', priority: 2, estimatedMinutes: 30, minLevel: GUIDANCE_LEVEL },
    { id: 'supply-water', label: 'Fill containers (and the bathtub) with water', rationale: 'Municipal supply and pumps can fail with the grid.', priority: 1, estimatedMinutes: 15, minLevel: HIGH_BAND_LEVEL },
    { id: 'supply-ration', label: 'Plan rationing for at least 72 hours', priority: 2, estimatedMinutes: 10, minLevel: HIGH_BAND_LEVEL },
  ],
  financial: [
    { id: 'fin-cash', label: 'Withdraw a small cash reserve for card-outage days', rationale: 'ATMs and card readers go down when the network does.', priority: 2, estimatedMinutes: 20, minLevel: GUIDANCE_LEVEL },
    { id: 'fin-docs', label: 'Photograph and secure critical documents', priority: 3, estimatedMinutes: 15, minLevel: GUIDANCE_LEVEL },
    { id: 'fin-review-exposure', label: 'Review exposure on watchlisted positions', priority: 3, estimatedMinutes: 15, minLevel: HIGH_BAND_LEVEL },
  ],
  mobility: [
    { id: 'mob-fuel', label: 'Top off the vehicle fuel tank now', rationale: 'Fuel pumps need power; a full tank is your reserve.', priority: 2, estimatedMinutes: 15, minLevel: GUIDANCE_LEVEL },
    { id: 'mob-routes', label: 'Note two routes out that avoid the affected corridor', priority: 2, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'mob-avoid', label: 'Avoid non-essential travel through the affected area', priority: 2, estimatedMinutes: 0, minLevel: GUIDANCE_LEVEL },
    { id: 'mob-go-early', label: 'If you will leave, leave before conditions peak', priority: 1, estimatedMinutes: 0, minLevel: HIGH_BAND_LEVEL },
  ],
  comms: [
    { id: 'comms-charge', label: 'Charge phone, laptop, and battery banks', priority: 1, estimatedMinutes: 5, minLevel: GUIDANCE_LEVEL },
    { id: 'comms-contact', label: 'Confirm an out-of-area contact and a meeting point', rationale: 'Long-distance often works when local circuits are jammed.', priority: 2, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'comms-offline-map', label: 'Download offline maps of your area', priority: 3, estimatedMinutes: 5, minLevel: GUIDANCE_LEVEL },
    { id: 'comms-radio', label: 'Locate a battery/hand-crank radio; tune to NWR or local', priority: 2, estimatedMinutes: 5, minLevel: HIGH_BAND_LEVEL },
    { id: 'comms-conserve', label: 'Switch phones to low-power / text-only to conserve battery', priority: 2, estimatedMinutes: 2, minLevel: HIGH_BAND_LEVEL },
  ],
  health: [
    { id: 'health-rx', label: 'Gather at least 7 days of essential medications', priority: 1, estimatedMinutes: 15, minLevel: GUIDANCE_LEVEL },
    { id: 'health-firstaid', label: 'Locate the first-aid kit and check its supplies', priority: 2, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'health-vulnerable', label: 'Check on anyone medically vulnerable in the household', priority: 1, estimatedMinutes: 10, minLevel: HIGH_BAND_LEVEL },
    { id: 'health-nearest-care', label: 'Note the nearest open urgent care and its route', priority: 2, estimatedMinutes: 5, minLevel: HIGH_BAND_LEVEL },
  ],
  energy_water: [
    { id: 'ew-charge', label: 'Charge all devices and power banks now', priority: 1, estimatedMinutes: 5, minLevel: GUIDANCE_LEVEL },
    { id: 'ew-fridge-cold', label: 'Set fridge/freezer cold; stage coolers and ice', priority: 3, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'ew-store-water', label: 'Store drinking water — 1 gal/person/day for 3 days', priority: 1, estimatedMinutes: 15, minLevel: HIGH_BAND_LEVEL },
    { id: 'ew-generator-outside', label: 'Stage any generator and fuel OUTDOORS — never indoors', rationale: 'Generator exhaust indoors is a leading cause of CO deaths after outages.', priority: 2, estimatedMinutes: 10, minLevel: HIGH_BAND_LEVEL },
    { id: 'ew-backup-climate', label: 'Prepare a safe backup heat or cooling plan', priority: 2, estimatedMinutes: 10, minLevel: HIGH_BAND_LEVEL },
  ],
  security: [
    { id: 'sec-secure', label: 'Secure doors, windows, and valuables', priority: 2, estimatedMinutes: 10, minLevel: GUIDANCE_LEVEL },
    { id: 'sec-aware', label: 'Track local advisories; avoid crowds and unrest', priority: 2, estimatedMinutes: 0, minLevel: GUIDANCE_LEVEL },
    { id: 'sec-id-cash', label: 'Keep IDs and some cash on your person', priority: 3, estimatedMinutes: 5, minLevel: GUIDANCE_LEVEL },
    { id: 'sec-defensible-room', label: 'Identify a defensible interior room', priority: 2, estimatedMinutes: 5, minLevel: HIGH_BAND_LEVEL },
  ],
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/** Normalize a posture level to 0–100, treating non-finite as 0. Shared by the
 *  per-axis gate and the energy_water coupling so both read the same number. */
function clampLevel(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function bySeverity(a: OfflinePlayItem, b: OfflinePlayItem): number {
  return a.priority - b.priority || a.estimatedMinutes - b.estimatedMinutes;
}

/** Keep the more urgent of two same-id actions: lower priority wins, then fewer
 *  estimated minutes. Makes dedup independent of the order hazards are scanned. */
function moreUrgent(a: OfflinePlayItem, b: OfflinePlayItem): OfflinePlayItem {
  return bySeverity(a, b) <= 0 ? a : b;
}

function toItem(a: PreparednessAction, source: OfflinePlaySource): OfflinePlayItem {
  const item: OfflinePlayItem = {
    id: a.id, label: a.label, priority: a.priority, estimatedMinutes: a.estimatedMinutes, source,
  };
  if (a.rationale !== undefined) item.rationale = a.rationale;
  return item;
}

/** physical_safety: prefer the calibrated weather library, keyed by each
 *  threat's hazardKind. Power-outage actions are folded in when energy_water is
 *  also under strain. Falls back to the static safety play when the axis is
 *  elevated with no weather threat (the pure guidanceGap case). */
function resolvePhysicalSafety(
  state: AxisState,
  energyWaterElevated: boolean,
): { actions: OfflinePlayItem[]; triggers: string[] } {
  const level = clampLevel(state.level);
  const withHazard = state.threats.filter((t) => t.hazardKind);
  if (withHazard.length === 0) {
    const actions = PHYSICAL_SAFETY_FALLBACK
      .filter((a) => level >= a.minLevel)
      .map((a) => toItem(a, 'axis_playbook'))
      .sort(bySeverity);
    return { actions, triggers: triggersFor(state) };
  }

  const byId = new Map<string, OfflinePlayItem>();
  const triggers: string[] = [];
  for (const threat of withHazard) {
    if (threat.hazardLabel && !triggers.includes(threat.hazardLabel)) triggers.push(threat.hazardLabel);
    for (const a of actionsForHazard(threat.hazardKind, { includeOutageActions: energyWaterElevated, max: 8 })) {
      // A duplicate id across two hazards is the same concrete action, but its
      // priority can differ per hazard — keep the more urgent copy so the result
      // is independent of the order the hazards are scanned.
      const item = toItem(a, 'weather_hazard');
      const prior = byId.get(a.id);
      byId.set(a.id, prior ? moreUrgent(prior, item) : item);
    }
  }
  return {
    actions: [...byId.values()].sort(bySeverity),
    // Hazard labels can all be empty; never emit an empty trigger list.
    triggers: triggers.length > 0 ? triggers : triggersFor(state),
  };
}

function resolveOtherAxis(axis: Exclude<SurvivalAxis, 'physical_safety'>, state: AxisState): OfflinePlayItem[] {
  const level = clampLevel(state.level);
  return AXIS_PLAYBOOKS[axis]
    .filter((a) => level >= a.minLevel)
    .map((a) => toItem(a, 'axis_playbook'))
    .sort(bySeverity);
}

/** Reasons to show alongside the play. Posture drivers when present; a generic
 *  note otherwise so the field is never empty. */
function triggersFor(state: AxisState): string[] {
  const drivers = state.drivers.filter((d) => d && d.trim().length > 0);
  if (drivers.length > 0) return [...drivers];
  return [`${axisLabel(state.axis)} posture is ${bandForLevel(state.level)}`];
}

export function resolveOfflinePlaybook(
  snapshot: WorldSnapshot,
  options: OfflinePlaybookOptions = {},
): OfflinePlaybookResult {
  // Floor the cap to a whole number ≥1: a cap of 0 (or a fraction below 1) would
  // slice every elevated axis to zero actions, silently re-opening the guidance
  // gap this resolver exists to close.
  const maxPerAxis = Number.isFinite(options.maxPerAxis)
    ? Math.max(1, Math.floor(options.maxPerAxis as number))
    : Infinity;
  const energyWaterElevated = clampLevel(snapshot.posture.axes.find((a) => a.axis === 'energy_water')?.level ?? 0) >= GUIDANCE_LEVEL;

  const playbooks: AxisOfflinePlaybook[] = [];
  const unresolvedAxes: SurvivalAxis[] = [];

  for (const axis of SURVIVAL_AXES) {
    const state = snapshot.posture.axes.find((a) => a.axis === axis);
    if (!state) continue;
    const level = clampLevel(state.level);
    if (level < GUIDANCE_LEVEL) continue;

    let actions: OfflinePlayItem[];
    let triggers: string[];
    if (axis === 'physical_safety') {
      const resolved = resolvePhysicalSafety(state, energyWaterElevated);
      actions = resolved.actions;
      triggers = resolved.triggers;
    } else {
      actions = resolveOtherAxis(axis, state);
      triggers = triggersFor(state);
    }

    if (actions.length === 0) {
      // Should be unreachable: every axis has a floor action at GUIDANCE_LEVEL.
      unresolvedAxes.push(axis);
      continue;
    }

    playbooks.push({
      axis,
      level,
      band: bandForLevel(level),
      triggers,
      actions: Number.isFinite(maxPerAxis) ? actions.slice(0, maxPerAxis) : actions,
    });
  }

  playbooks.sort((a, b) => b.level - a.level || SURVIVAL_AXES.indexOf(a.axis) - SURVIVAL_AXES.indexOf(b.axis));

  return {
    capturedAtMs: snapshot.capturedAtMs,
    playbooks,
    unresolvedAxes,
    headline: buildHeadline(playbooks, unresolvedAxes),
  };
}

function buildHeadline(playbooks: readonly AxisOfflinePlaybook[], unresolvedAxes: readonly SurvivalAxis[]): string {
  if (unresolvedAxes.length > 0) {
    return `Offline playbook incomplete — ${unresolvedAxes.map((a) => axisLabel(a)).join(', ')} resolved no action.`;
  }
  if (playbooks.length === 0) {
    return 'No axis is elevated — no offline action required.';
  }
  const totalActions = playbooks.reduce((n, p) => n + p.actions.length, 0);
  const worst = playbooks[0]!;
  const axisWord = playbooks.length === 1 ? 'axis needs' : 'axes need';
  return `${playbooks.length} ${axisWord} offline action — ${axisLabel(worst.axis)} (${worst.band}) leads; ${totalActions} steps staged.`;
}
