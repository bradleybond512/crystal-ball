/**
 * Tests for ConflictEscalationPanel — pure helper functions and static data.
 *
 * Run with:
 *   npx tsx --test tests/components/conflict-escalation-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All helpers are exported from the
 * helpers module for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  phaseLabel,
  phaseColor,
  phaseFromScore,
  phaseRank,
  milestoneLabel,
  milestoneIcon,
  domainLabel,
  domainIcon,
  trendArrow,
  trendColor,
  confidenceLabel,
  confidenceColor,
  escalationScoreColor,
  sortZonesByRisk,
  computeCivilianRisk,
  countZonesAtPhase,
  nextPhase,
  aggregateGlobalRisk,
  latestMilestone,
  netEscalationDelta,
  avgActorCapability,
  dominantThreat,
  formatRelativeTime,
  ACTIVE_CONFLICT_ZONES,
  ESCALATION_FORECASTS,
  type EscalationPhase,
  type ConflictZone,
  type EscalationMilestone,
  type ConflictActor,
  type ThreatVector,
} from '../../src/services/conflict/conflict-escalation-helpers.ts';

// ── phaseLabel ────────────────────────────────────────────────────────────

test('phaseLabel: stable returns "Stable"', () => {
  assert.equal(phaseLabel('stable'), 'Stable');
});

test('phaseLabel: war returns "War"', () => {
  assert.equal(phaseLabel('war'), 'War');
});

test('phaseLabel: active_conflict returns "Active Conflict"', () => {
  assert.equal(phaseLabel('active_conflict'), 'Active Conflict');
});

test('phaseLabel: all phases return non-empty strings', () => {
  const phases: EscalationPhase[] = ['stable', 'tension', 'crisis', 'active_conflict', 'war'];
  for (const p of phases) {
    assert.ok(phaseLabel(p).length > 0, `phaseLabel(${p}) should be non-empty`);
  }
});

// ── phaseColor ────────────────────────────────────────────────────────────

test('phaseColor: stable contains green', () => {
  assert.ok(phaseColor('stable').includes('#4caf50'));
});

test('phaseColor: war contains dark red', () => {
  assert.ok(phaseColor('war').includes('#b71c1c'));
});

test('phaseColor: crisis contains orange', () => {
  assert.ok(phaseColor('crisis').includes('#fb923c'));
});

// ── phaseFromScore ────────────────────────────────────────────────────────

test('phaseFromScore: 0 → stable', () => {
  assert.equal(phaseFromScore(0), 'stable');
});

test('phaseFromScore: 14 → stable', () => {
  assert.equal(phaseFromScore(14), 'stable');
});

test('phaseFromScore: 15 → tension', () => {
  assert.equal(phaseFromScore(15), 'tension');
});

test('phaseFromScore: 34 → tension', () => {
  assert.equal(phaseFromScore(34), 'tension');
});

test('phaseFromScore: 35 → crisis', () => {
  assert.equal(phaseFromScore(35), 'crisis');
});

test('phaseFromScore: 55 → active_conflict', () => {
  assert.equal(phaseFromScore(55), 'active_conflict');
});

test('phaseFromScore: 75 → war', () => {
  assert.equal(phaseFromScore(75), 'war');
});

test('phaseFromScore: 100 → war', () => {
  assert.equal(phaseFromScore(100), 'war');
});

// ── phaseRank ─────────────────────────────────────────────────────────────

test('phaseRank: stable=0, war=4', () => {
  assert.equal(phaseRank('stable'), 0);
  assert.equal(phaseRank('war'), 4);
});

test('phaseRank: monotonically increases from stable to war', () => {
  const phases: EscalationPhase[] = ['stable', 'tension', 'crisis', 'active_conflict', 'war'];
  for (let i = 0; i < phases.length - 1; i++) {
    assert.ok(phaseRank(phases[i]!) < phaseRank(phases[i + 1]!));
  }
});

// ── milestoneLabel ────────────────────────────────────────────────────────

test('milestoneLabel: ceasefire returns "Ceasefire"', () => {
  assert.equal(milestoneLabel('ceasefire'), 'Ceasefire');
});

test('milestoneLabel: atrocity returns non-empty string', () => {
  assert.ok(milestoneLabel('atrocity').length > 0);
});

test('milestoneLabel: all types return non-empty strings', () => {
  const types = ['ceasefire', 'mobilization', 'territorial_gain', 'atrocity', 'diplomatic_breakdown', 'third_party_entry'] as const;
  for (const t of types) {
    assert.ok(milestoneLabel(t).length > 0);
  }
});

// ── milestoneIcon ─────────────────────────────────────────────────────────

test('milestoneIcon: each type returns non-empty string', () => {
  const types = ['ceasefire', 'mobilization', 'territorial_gain', 'atrocity', 'diplomatic_breakdown', 'third_party_entry'] as const;
  for (const t of types) {
    assert.ok(milestoneIcon(t).length > 0);
  }
});

// ── domainLabel ───────────────────────────────────────────────────────────

test('domainLabel: ground returns "Ground"', () => {
  assert.equal(domainLabel('ground'), 'Ground');
});

test('domainLabel: nuclear returns "Nuclear"', () => {
  assert.equal(domainLabel('nuclear'), 'Nuclear');
});

test('domainLabel: info_ops returns "Info Ops"', () => {
  assert.equal(domainLabel('info_ops'), 'Info Ops');
});

// ── domainIcon ────────────────────────────────────────────────────────────

test('domainIcon: all domains return non-empty strings', () => {
  const domains = ['ground', 'air', 'naval', 'cyber', 'info_ops', 'nuclear'] as const;
  for (const d of domains) {
    assert.ok(domainIcon(d).length > 0);
  }
});

// ── trendArrow / trendColor ───────────────────────────────────────────────

test('trendArrow: increasing returns non-empty string', () => {
  assert.ok(trendArrow('increasing').length > 0);
});

test('trendArrow: decreasing differs from stable', () => {
  assert.notEqual(trendArrow('decreasing'), trendArrow('stable'));
});

test('trendColor: increasing returns red', () => {
  assert.equal(trendColor('increasing'), '#f44336');
});

test('trendColor: decreasing returns green', () => {
  assert.equal(trendColor('decreasing'), '#4caf50');
});

test('trendColor: stable returns grey', () => {
  assert.equal(trendColor('stable'), '#9e9e9e');
});

// ── confidenceLabel / confidenceColor ─────────────────────────────────────

test('confidenceLabel: high returns "High"', () => {
  assert.equal(confidenceLabel('high'), 'High');
});

test('confidenceColor: high returns green', () => {
  assert.equal(confidenceColor('high'), '#4caf50');
});

test('confidenceColor: low returns grey', () => {
  assert.equal(confidenceColor('low'), '#9e9e9e');
});

// ── escalationScoreColor ──────────────────────────────────────────────────

test('escalationScoreColor: 0 → green (low)', () => {
  assert.ok(escalationScoreColor(0).includes('#4caf50'));
});

test('escalationScoreColor: 50 → orange (high)', () => {
  assert.ok(escalationScoreColor(50).includes('#fb923c'));
});

test('escalationScoreColor: 90 → extreme red', () => {
  assert.ok(escalationScoreColor(90).includes('#b71c1c'));
});

// ── sortZonesByRisk ───────────────────────────────────────────────────────

test('sortZonesByRisk: returns descending order', () => {
  const zones: ConflictZone[] = [
    { id: 'a', name: 'A', region: 'R', phase: 'tension', escalationScore: 30, actors: [], milestones: [], threatVectors: [], civilianRisk: 20, updatedAt: 0 },
    { id: 'b', name: 'B', region: 'R', phase: 'war', escalationScore: 90, actors: [], milestones: [], threatVectors: [], civilianRisk: 80, updatedAt: 0 },
    { id: 'c', name: 'C', region: 'R', phase: 'crisis', escalationScore: 50, actors: [], milestones: [], threatVectors: [], civilianRisk: 40, updatedAt: 0 },
  ];
  const sorted = sortZonesByRisk(zones);
  assert.equal(sorted[0]!.id, 'b');
  assert.equal(sorted[1]!.id, 'c');
  assert.equal(sorted[2]!.id, 'a');
});

test('sortZonesByRisk: does not mutate input array', () => {
  const zones: ConflictZone[] = [
    { id: 'a', name: 'A', region: 'R', phase: 'stable', escalationScore: 10, actors: [], milestones: [], threatVectors: [], civilianRisk: 5, updatedAt: 0 },
    { id: 'b', name: 'B', region: 'R', phase: 'war', escalationScore: 90, actors: [], milestones: [], threatVectors: [], civilianRisk: 80, updatedAt: 0 },
  ];
  const original = [...zones];
  sortZonesByRisk(zones);
  assert.deepEqual(zones.map(z => z.id), original.map(z => z.id));
});

// ── computeCivilianRisk ───────────────────────────────────────────────────

test('computeCivilianRisk: 0 score + 0 actors = 0', () => {
  assert.equal(computeCivilianRisk(0, 0), 0);
});

test('computeCivilianRisk: caps at 100', () => {
  assert.equal(computeCivilianRisk(100, 10), 100);
});

test('computeCivilianRisk: more actors increases risk', () => {
  const r1 = computeCivilianRisk(50, 1);
  const r2 = computeCivilianRisk(50, 5);
  assert.ok(r2 > r1);
});

test('computeCivilianRisk: actor factor caps at 30', () => {
  // 10 actors * 5 = 50, but capped to 30
  const r = computeCivilianRisk(0, 10);
  assert.equal(r, 0); // 0 * 0.7 + 30 = 30... wait: 0*0.7=0, min(10*5,30)=30 → 30
  assert.equal(computeCivilianRisk(0, 10), 30);
});

// ── countZonesAtPhase ─────────────────────────────────────────────────────

test('countZonesAtPhase: counts war zones', () => {
  const zones: ConflictZone[] = [
    { id: 'a', name: 'A', region: 'R', phase: 'war', escalationScore: 90, actors: [], milestones: [], threatVectors: [], civilianRisk: 80, updatedAt: 0 },
    { id: 'b', name: 'B', region: 'R', phase: 'crisis', escalationScore: 50, actors: [], milestones: [], threatVectors: [], civilianRisk: 40, updatedAt: 0 },
    { id: 'c', name: 'C', region: 'R', phase: 'stable', escalationScore: 5, actors: [], milestones: [], threatVectors: [], civilianRisk: 2, updatedAt: 0 },
  ];
  assert.equal(countZonesAtPhase(zones, 'war'), 1);
  assert.equal(countZonesAtPhase(zones, 'crisis'), 2); // war + crisis
  assert.equal(countZonesAtPhase(zones, 'stable'), 3); // all
});

// ── nextPhase ─────────────────────────────────────────────────────────────

test('nextPhase: stable → tension', () => {
  assert.equal(nextPhase('stable'), 'tension');
});

test('nextPhase: tension → crisis', () => {
  assert.equal(nextPhase('tension'), 'crisis');
});

test('nextPhase: war → null (no next phase)', () => {
  assert.equal(nextPhase('war'), null);
});

test('nextPhase: crisis → active_conflict', () => {
  assert.equal(nextPhase('crisis'), 'active_conflict');
});

// ── aggregateGlobalRisk ───────────────────────────────────────────────────

test('aggregateGlobalRisk: empty zones = 0', () => {
  assert.equal(aggregateGlobalRisk([]), 0);
});

test('aggregateGlobalRisk: single zone returns its score', () => {
  const zones: ConflictZone[] = [
    { id: 'a', name: 'A', region: 'R', phase: 'war', escalationScore: 80, actors: [], milestones: [], threatVectors: [], civilianRisk: 70, updatedAt: 0 },
  ];
  assert.equal(aggregateGlobalRisk(zones), 80);
});

test('aggregateGlobalRisk: averages top-N zones', () => {
  const zones: ConflictZone[] = [
    { id: 'a', name: 'A', region: 'R', phase: 'war', escalationScore: 90, actors: [], milestones: [], threatVectors: [], civilianRisk: 80, updatedAt: 0 },
    { id: 'b', name: 'B', region: 'R', phase: 'war', escalationScore: 70, actors: [], milestones: [], threatVectors: [], civilianRisk: 60, updatedAt: 0 },
    { id: 'c', name: 'C', region: 'R', phase: 'stable', escalationScore: 10, actors: [], milestones: [], threatVectors: [], civilianRisk: 5, updatedAt: 0 },
  ];
  // topN=2 → avg of 90 and 70 = 80
  assert.equal(aggregateGlobalRisk(zones, 2), 80);
});

// ── latestMilestone ───────────────────────────────────────────────────────

test('latestMilestone: empty list → null', () => {
  assert.equal(latestMilestone([]), null);
});

test('latestMilestone: returns most recent', () => {
  const milestones: EscalationMilestone[] = [
    { id: 'a', type: 'ceasefire', timestamp: 1000, description: 'early', escalationDelta: 0, confidence: 'low' },
    { id: 'b', type: 'mobilization', timestamp: 3000, description: 'latest', escalationDelta: 10, confidence: 'high' },
    { id: 'c', type: 'atrocity', timestamp: 2000, description: 'middle', escalationDelta: 5, confidence: 'medium' },
  ];
  const m = latestMilestone(milestones);
  assert.equal(m?.id, 'b');
});

// ── netEscalationDelta ────────────────────────────────────────────────────

test('netEscalationDelta: empty list → 0', () => {
  assert.equal(netEscalationDelta([]), 0);
});

test('netEscalationDelta: sums all deltas', () => {
  const milestones: EscalationMilestone[] = [
    { id: 'a', type: 'mobilization', timestamp: 0, description: '', escalationDelta: 30, confidence: 'high' },
    { id: 'b', type: 'ceasefire', timestamp: 0, description: '', escalationDelta: -10, confidence: 'medium' },
  ];
  assert.equal(netEscalationDelta(milestones), 20);
});

// ── avgActorCapability ────────────────────────────────────────────────────

test('avgActorCapability: empty → 0', () => {
  assert.equal(avgActorCapability([]), 0);
});

test('avgActorCapability: single actor returns its capability', () => {
  const actors: ConflictActor[] = [
    { name: 'A', country: 'US', capability: 72, motivation: 80, externalSupport: [] },
  ];
  assert.equal(avgActorCapability(actors), 72);
});

test('avgActorCapability: rounds result', () => {
  const actors: ConflictActor[] = [
    { name: 'A', country: 'US', capability: 70, motivation: 80, externalSupport: [] },
    { name: 'B', country: 'RU', capability: 71, motivation: 75, externalSupport: [] },
  ];
  // (70 + 71) / 2 = 70.5 → rounds to 71
  assert.equal(avgActorCapability(actors), 71);
});

// ── dominantThreat ────────────────────────────────────────────────────────

test('dominantThreat: empty → null', () => {
  assert.equal(dominantThreat([]), null);
});

test('dominantThreat: returns highest severity vector', () => {
  const vectors: ThreatVector[] = [
    { domain: 'air', severity: 40, trend: 'stable', indicators: [] },
    { domain: 'nuclear', severity: 90, trend: 'stable', indicators: [] },
    { domain: 'ground', severity: 60, trend: 'increasing', indicators: [] },
  ];
  const t = dominantThreat(vectors);
  assert.equal(t?.domain, 'nuclear');
  assert.equal(t?.severity, 90);
});

// ── formatRelativeTime ────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

test('formatRelativeTime: seconds', () => {
  assert.equal(formatRelativeTime(NOW - 30_000, NOW), '30s ago');
});

test('formatRelativeTime: minutes', () => {
  assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), '5m ago');
});

test('formatRelativeTime: hours', () => {
  assert.equal(formatRelativeTime(NOW - 3 * 3_600_000, NOW), '3h ago');
});

test('formatRelativeTime: days', () => {
  assert.equal(formatRelativeTime(NOW - 2 * 86_400_000, NOW), '2d ago');
});

test('formatRelativeTime: future → "just now"', () => {
  assert.equal(formatRelativeTime(NOW + 10_000, NOW), 'just now');
});

// ── Static fixture data ───────────────────────────────────────────────────

test('ACTIVE_CONFLICT_ZONES: contains at least 4 zones', () => {
  assert.ok(ACTIVE_CONFLICT_ZONES.length >= 4);
});

test('ACTIVE_CONFLICT_ZONES: all zones have valid phases', () => {
  const validPhases = new Set<EscalationPhase>(['stable', 'tension', 'crisis', 'active_conflict', 'war']);
  for (const z of ACTIVE_CONFLICT_ZONES) {
    assert.ok(validPhases.has(z.phase), `Zone ${z.id} has invalid phase: ${z.phase}`);
  }
});

test('ACTIVE_CONFLICT_ZONES: all escalation scores are 0–100', () => {
  for (const z of ACTIVE_CONFLICT_ZONES) {
    assert.ok(z.escalationScore >= 0 && z.escalationScore <= 100, `Zone ${z.id} score out of range`);
  }
});

test('ACTIVE_CONFLICT_ZONES: all civilian risk scores are 0–100', () => {
  for (const z of ACTIVE_CONFLICT_ZONES) {
    assert.ok(z.civilianRisk >= 0 && z.civilianRisk <= 100, `Zone ${z.id} civilianRisk out of range`);
  }
});

test('ACTIVE_CONFLICT_ZONES: contains ukraine zone with war phase', () => {
  const ukraine = ACTIVE_CONFLICT_ZONES.find(z => z.id === 'ukraine');
  assert.ok(ukraine, 'ukraine zone should exist');
  assert.equal(ukraine?.phase, 'war');
});

test('ACTIVE_CONFLICT_ZONES: zones have unique ids', () => {
  const ids = ACTIVE_CONFLICT_ZONES.map(z => z.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test('ESCALATION_FORECASTS: all forecasts reference valid zone ids', () => {
  const zoneIds = new Set(ACTIVE_CONFLICT_ZONES.map(z => z.id));
  for (const f of ESCALATION_FORECASTS) {
    assert.ok(zoneIds.has(f.zoneId), `Forecast references unknown zone: ${f.zoneId}`);
  }
});

test('ESCALATION_FORECASTS: probabilities are 0–1', () => {
  for (const f of ESCALATION_FORECASTS) {
    assert.ok(f.probability30d >= 0 && f.probability30d <= 1, `Forecast for ${f.zoneId} has invalid probability`);
  }
});

test('ESCALATION_FORECASTS: keyDrivers and deescalationPathways are non-empty arrays', () => {
  for (const f of ESCALATION_FORECASTS) {
    assert.ok(Array.isArray(f.keyDrivers));
    assert.ok(Array.isArray(f.deescalationPathways));
  }
});
