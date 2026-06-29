/**
 * Cross-domain coupling: turn active intelligence cascades (from
 * compound-risk) into shortage `cross_domain` drivers, so a detected
 * war→port-closure or storm→infrastructure cascade dynamically raises the
 * relevant commodity's risk instead of the two layers staying siloed.
 *
 * Pure: no DOM, no fetch, no globals. A commodity model passes its active
 * cascades + its coupling rules and appends the returned drivers.
 */

import type { ShortageDriver, ShortageDriverKind } from './shortage-types.ts';

export interface ActiveCascade {
  from: string;
  to: string;
  /** 0..100 severity of the compound risk this cascade belongs to. */
  severity: number;
}

export interface CouplingRule {
  /** Match a cascade by its consequent domain (required) and optionally its
   *  antecedent domain. e.g. { to: 'maritime' } or { from: 'conflict', to: 'markets' }. */
  match: { from?: string; to: string };
  label: string;
  /** Driver bucket; defaults to 'cross_domain'. */
  kind?: ShortageDriverKind;
  /** Multiply cascade severity by this (0..1+) for the driver score. Default 1. */
  scale?: number;
}

export interface CouplingOptions {
  factId?: string;
}

/** One driver per rule that at least one active cascade matches, scored from
 *  the strongest matching cascade's severity. */
export function couplingDriversFor(
  cascades: readonly ActiveCascade[],
  rules: readonly CouplingRule[],
  options: CouplingOptions = {},
): ShortageDriver[] {
  const out: ShortageDriver[] = [];
  for (const rule of rules) {
    const best = bestMatchingCascade(cascades, rule);
    if (!best) continue;
    out.push({
      kind: rule.kind ?? 'cross_domain',
      score: clamp(0, 100, best.severity * (rule.scale ?? 1)),
      label: `${rule.label} (${best.from}→${best.to})`,
      polarity: 'risk',
      ...(options.factId ? { factId: options.factId } : {}),
    });
  }
  return out;
}

function matchesRule(c: ActiveCascade, rule: CouplingRule): boolean {
  if (c.to !== rule.match.to) return false;
  return rule.match.from === undefined || c.from === rule.match.from;
}

function bestMatchingCascade(
  cascades: readonly ActiveCascade[],
  rule: CouplingRule,
): ActiveCascade | undefined {
  let best: ActiveCascade | undefined;
  for (const c of cascades) {
    if (matchesRule(c, rule) && (best === undefined || c.severity > best.severity)) best = c;
  }
  return best;
}

/** Grains/food: export corridors and prices are hit by maritime/market
 *  cascades, especially conflict-driven ones. */
export const FOOD_COUPLING_RULES: readonly CouplingRule[] = [
  { match: { to: 'maritime' }, label: 'Export-corridor stress from a maritime cascade' },
  { match: { from: 'conflict', to: 'markets' }, label: 'Conflict-driven market disruption' },
  { match: { to: 'humanitarian' }, label: 'Regional humanitarian cascade', scale: 0.8 },
];

/** Energy: grid/pipeline (infra) and shipping-lane (maritime) cascades raise
 *  fuel-supply risk. */
export const ENERGY_COUPLING_RULES: readonly CouplingRule[] = [
  { match: { to: 'infra' }, label: 'Grid/pipeline cascade' },
  { match: { to: 'maritime' }, label: 'Shipping-lane disruption' },
  { match: { from: 'cyber', to: 'infra' }, label: 'Cyber-driven infrastructure cascade' },
];

function clamp(lo: number, hi: number, x: number): number {
  return Math.min(hi, Math.max(lo, x));
}
