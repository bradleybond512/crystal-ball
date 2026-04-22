/**
 * Hypothesis Dedupe — fuses hypotheses that describe the same underlying
 * event from different reasoning surfaces.
 *
 * Multiple services can independently produce a hypothesis about, e.g.,
 * a Taiwan Strait buildup: threat-synthesis produces a cluster, situation-
 * engine emits an escalation, alert-correlator triggers a correlation
 * alert that surfaces as an alert-burst. The HUD showing all three is
 * "three things that are really one thing" — pure noise.
 *
 * This module provides a pure function `dedupeHypotheses(list)` that
 * groups hypotheses by:
 *   1. Region overlap (case-insensitive substring match)
 *   2. Evidence ID overlap (situationIds shared across hypotheses)
 *   3. Entity overlap (shared extracted entities from hypothesis-entities)
 *
 * Within a group, it keeps the hypothesis with the highest risk × confidence
 * and annotates it with a `fusedFrom` list so the HUD can show "fused from
 * cross-domain-cluster + situation-escalation" if we want.
 *
 * The analyst-loop applies this right before ranking, so feedback and
 * accuracy still work on the fused hypothesis's signature.
 */

import type { Hypothesis } from './analyst-loop';
import type { EscalationRisk } from './threat-synthesis';
import { extractEntitiesFromText } from './hypothesis-entities';

const RISK_RANK: Record<EscalationRisk, number> = {
  critical: 3, high: 2, moderate: 1, low: 0,
};

export interface FusedHypothesis extends Hypothesis {
  fusedFrom?: string[];
}

// ── Grouping keys ────────────────────────────────────────────────────────────

function normalizeRegion(region: string | undefined): string {
  return (region ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function evidenceIds(h: Hypothesis): Set<string> {
  return new Set(h.evidence.map(e => `${e.source}:${e.id}`));
}

function entityKeys(h: Hypothesis): Set<string> {
  // Extract directly from the hypothesis text — we can't use the
  // hypothesis-entities cache here because dedupe runs INSIDE
  // analyst-loop.rank() before the snapshot is dispatched, so the
  // cache still holds last-snapshot IDs that don't match this snapshot.
  const text = [h.statement, h.region ?? '', ...h.evidence.map(e => e.label)].join(' | ');
  return new Set(extractEntitiesFromText(text).map(m => `${m.kind}:${m.entity}`));
}

function overlaps<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

// ── Union-find for grouping ──────────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] === i) return i;
    const root = this.find(this.parent[i] ?? i);
    this.parent[i] = root;
    return root;
  }
  union(i: number, j: number): void {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri !== rj) this.parent[ri] = rj;
  }
  groups(): number[][] {
    const map = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      const bucket = map.get(root);
      if (bucket) bucket.push(i);
      else map.set(root, [i]);
    }
    return [...map.values()];
  }
}

// ── Similarity scoring ───────────────────────────────────────────────────────

function shouldMerge(a: Hypothesis, b: Hypothesis): boolean {
  // Strong signal: shared evidence IDs (same situation or alert).
  if (overlaps(evidenceIds(a), evidenceIds(b))) return true;
  // Strong signal: shared region AND shared entity.
  const regionA = normalizeRegion(a.region);
  const regionB = normalizeRegion(b.region);
  const sameRegion = regionA && regionB && (regionA === regionB || regionA.includes(regionB) || regionB.includes(regionA));
  if (sameRegion && overlaps(entityKeys(a), entityKeys(b))) return true;
  return false;
}

// ── Pick winner per group ────────────────────────────────────────────────────

function rankScore(h: Hypothesis): number {
  return RISK_RANK[h.risk] * 10 + h.confidence;
}

function pickWinner(group: Hypothesis[]): FusedHypothesis {
  const sorted = [...group].sort((a, b) => rankScore(b) - rankScore(a));
  const winner = sorted[0];
  if (!winner) throw new Error('empty group');
  if (group.length === 1) return winner;
  const fusedFrom = [...new Set(group.map(h => h.kind))].filter(k => k !== winner.kind);
  if (fusedFrom.length === 0) return winner;
  return { ...winner, fusedFrom };
}

// ── Public ───────────────────────────────────────────────────────────────────

/**
 * De-duplicate a list of hypotheses. Returns a new array where hypotheses
 * describing the same event are merged into a single representative.
 *
 * Stable: the order of non-merged hypotheses is preserved; merged
 * hypotheses keep the position of their highest-ranked member.
 */
export function dedupeHypotheses(hypotheses: Hypothesis[]): FusedHypothesis[] {
  if (hypotheses.length <= 1) return hypotheses as FusedHypothesis[];
  const uf = new UnionFind(hypotheses.length);
  for (let i = 0; i < hypotheses.length; i++) {
    for (let j = i + 1; j < hypotheses.length; j++) {
      const a = hypotheses[i];
      const b = hypotheses[j];
      if (a && b && shouldMerge(a, b)) uf.union(i, j);
    }
  }
  const groups = uf.groups();
  // Preserve the position of each group's top-ranked member.
  const winners: { idx: number; h: FusedHypothesis }[] = [];
  for (const group of groups) {
    const members = group
      .map(i => hypotheses[i])
      .filter((h): h is Hypothesis => h !== undefined);
    if (members.length === 0) continue;
    const winner = pickWinner(members);
    const winnerIndex = group[members.indexOf(winner as Hypothesis)] ?? group[0] ?? 0;
    winners.push({ idx: winnerIndex, h: winner });
  }
  winners.sort((a, b) => a.idx - b.idx);
  return winners.map(w => w.h);
}
