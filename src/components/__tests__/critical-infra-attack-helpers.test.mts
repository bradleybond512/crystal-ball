import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAttackRiskScore,
  classifyRiskLabel,
  buildAttackSummary,
  filterActiveAttacks,
  sortAttacksBySeverity,
  formatSector,
  formatVector,
  formatRecoveryStatus,
  formatAttributionConfidence,
  getSeverityWeight,
  getVectorMultiplier,
  isOngoingAttack,
  groupBySector,
  getTopThreats,
  sampleInfraAttackEvents,
  type InfraAttackEvent,
} from '../critical-infra-attack-helpers.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = Date.now();
const day = 24 * 60 * 60 * 1_000;

function makeEvent(overrides: Partial<InfraAttackEvent> = {}): InfraAttackEvent {
  return {
    id: 'test-event',
    sector: 'power_grid',
    vector: 'physical',
    severity: 'medium',
    recoveryStatus: 'recovering',
    attribution: null,
    attributionConfidence: 'unknown',
    location: 'Test Location',
    timestamp: now - day,
    description: 'Test event',
    sourceUrls: [],
    ...overrides,
  };
}

// ── computeAttackRiskScore ────────────────────────────────────────────────────

test('computeAttackRiskScore returns 0 for empty array', () => {
  assert.equal(computeAttackRiskScore([]), 0);
});

test('computeAttackRiskScore returns positive value for a single critical event', () => {
  const ev = makeEvent({ severity: 'critical', vector: 'cyber', timestamp: now - day });
  const score = computeAttackRiskScore([ev]);
  assert.ok(score > 0, `Expected score > 0, got ${score}`);
});

test('computeAttackRiskScore caps at 100', () => {
  const events: InfraAttackEvent[] = Array.from({ length: 20 }, (_, i) =>
    makeEvent({ id: `ev-${i}`, severity: 'critical', vector: 'combined', timestamp: now }),
  );
  assert.equal(computeAttackRiskScore(events), 100);
});

test('computeAttackRiskScore: old event (>30 days) gets 0.1 weight', () => {
  const recentEv = makeEvent({ severity: 'medium', vector: 'physical', timestamp: now - day });
  const oldEv = makeEvent({ severity: 'medium', vector: 'physical', timestamp: now - 35 * day });
  const recentScore = computeAttackRiskScore([recentEv]);
  const oldScore = computeAttackRiskScore([oldEv]);
  assert.ok(oldScore < recentScore, `old=${oldScore} should be < recent=${recentScore}`);
});

test('computeAttackRiskScore: event >7 days gets 0.5 weight', () => {
  const fresh = makeEvent({ severity: 'high', vector: 'physical', timestamp: now - day });
  const stale = makeEvent({ severity: 'high', vector: 'physical', timestamp: now - 10 * day });
  const freshScore = computeAttackRiskScore([fresh]);
  const staleScore = computeAttackRiskScore([stale]);
  assert.ok(staleScore < freshScore, `stale=${staleScore} should be < fresh=${freshScore}`);
  assert.ok(Math.abs(staleScore - freshScore * 0.5) < 0.01, 'stale should be ~half fresh');
});

test('computeAttackRiskScore: combined vector scores higher than physical at same severity', () => {
  const physical = makeEvent({ vector: 'physical', severity: 'high', timestamp: now });
  const combined = makeEvent({ vector: 'combined', severity: 'high', timestamp: now });
  assert.ok(computeAttackRiskScore([combined]) > computeAttackRiskScore([physical]));
});

// ── classifyRiskLabel ─────────────────────────────────────────────────────────

test('classifyRiskLabel: score 0 → Low', () => {
  assert.equal(classifyRiskLabel(0), 'Low');
});

test('classifyRiskLabel: score 19 → Low', () => {
  assert.equal(classifyRiskLabel(19), 'Low');
});

test('classifyRiskLabel: score 20 → Guarded', () => {
  assert.equal(classifyRiskLabel(20), 'Guarded');
});

test('classifyRiskLabel: score 39 → Guarded', () => {
  assert.equal(classifyRiskLabel(39), 'Guarded');
});

test('classifyRiskLabel: score 40 → Elevated', () => {
  assert.equal(classifyRiskLabel(40), 'Elevated');
});

test('classifyRiskLabel: score 59 → Elevated', () => {
  assert.equal(classifyRiskLabel(59), 'Elevated');
});

test('classifyRiskLabel: score 60 → High', () => {
  assert.equal(classifyRiskLabel(60), 'High');
});

test('classifyRiskLabel: score 79 → High', () => {
  assert.equal(classifyRiskLabel(79), 'High');
});

test('classifyRiskLabel: score 80 → Severe', () => {
  assert.equal(classifyRiskLabel(80), 'Severe');
});

test('classifyRiskLabel: score 100 → Severe', () => {
  assert.equal(classifyRiskLabel(100), 'Severe');
});

// ── buildAttackSummary ────────────────────────────────────────────────────────

test('buildAttackSummary: correct totalAttacks', () => {
  const events = [makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })];
  const summary = buildAttackSummary(events);
  assert.equal(summary.totalAttacks, 3);
});

test('buildAttackSummary: counts critical events', () => {
  const events = [
    makeEvent({ id: 'a', severity: 'critical' }),
    makeEvent({ id: 'b', severity: 'high' }),
    makeEvent({ id: 'c', severity: 'critical' }),
  ];
  assert.equal(buildAttackSummary(events).criticalCount, 2);
});

test('buildAttackSummary: counts ongoing events', () => {
  const events = [
    makeEvent({ id: 'a', recoveryStatus: 'ongoing' }),
    makeEvent({ id: 'b', recoveryStatus: 'contained' }),
    makeEvent({ id: 'c', recoveryStatus: 'ongoing' }),
  ];
  assert.equal(buildAttackSummary(events).ongoingCount, 2);
});

test('buildAttackSummary: bySector counts are correct', () => {
  const events = [
    makeEvent({ id: 'a', sector: 'power_grid' }),
    makeEvent({ id: 'b', sector: 'power_grid' }),
    makeEvent({ id: 'c', sector: 'water_system' }),
  ];
  const { bySector } = buildAttackSummary(events);
  assert.equal(bySector.power_grid, 2);
  assert.equal(bySector.water_system, 1);
  assert.equal(bySector.communications, 0);
  assert.equal(bySector.transport, 0);
});

test('buildAttackSummary: byVector counts are correct', () => {
  const events = [
    makeEvent({ id: 'a', vector: 'cyber' }),
    makeEvent({ id: 'b', vector: 'cyber' }),
    makeEvent({ id: 'c', vector: 'combined' }),
  ];
  const { byVector } = buildAttackSummary(events);
  assert.equal(byVector.cyber, 2);
  assert.equal(byVector.combined, 1);
  assert.equal(byVector.physical, 0);
});

test('buildAttackSummary: empty events gives zero counts', () => {
  const summary = buildAttackSummary([]);
  assert.equal(summary.totalAttacks, 0);
  assert.equal(summary.criticalCount, 0);
  assert.equal(summary.ongoingCount, 0);
  assert.equal(summary.riskScore, 0);
});

// ── filterActiveAttacks ───────────────────────────────────────────────────────

test('filterActiveAttacks: very old event is filtered out', () => {
  const old = makeEvent({ id: 'old', timestamp: now - 100 * day });
  const result = filterActiveAttacks([old], 90 * day);
  assert.equal(result.length, 0);
});

test('filterActiveAttacks: recent event is included', () => {
  const recent = makeEvent({ id: 'recent', timestamp: now - day });
  const result = filterActiveAttacks([recent], 90 * day);
  assert.equal(result.length, 1);
});

test('filterActiveAttacks: boundary event at exactly windowMs is excluded', () => {
  const boundary = makeEvent({ id: 'boundary', timestamp: now - 90 * day - 1 });
  const result = filterActiveAttacks([boundary], 90 * day);
  assert.equal(result.length, 0);
});

// ── sortAttacksBySeverity ─────────────────────────────────────────────────────

test('sortAttacksBySeverity: orders critical > high > medium > low', () => {
  const events = [
    makeEvent({ id: 'low', severity: 'low' }),
    makeEvent({ id: 'critical', severity: 'critical' }),
    makeEvent({ id: 'medium', severity: 'medium' }),
    makeEvent({ id: 'high', severity: 'high' }),
  ];
  const sorted = sortAttacksBySeverity(events);
  assert.equal(sorted[0]?.severity, 'critical');
  assert.equal(sorted[1]?.severity, 'high');
  assert.equal(sorted[2]?.severity, 'medium');
  assert.equal(sorted[3]?.severity, 'low');
});

test('sortAttacksBySeverity: does not mutate the original array', () => {
  const events = [makeEvent({ id: 'a', severity: 'low' }), makeEvent({ id: 'b', severity: 'critical' })];
  const original = [...events];
  sortAttacksBySeverity(events);
  assert.equal(events[0]?.id, original[0]?.id);
});

// ── formatSector ──────────────────────────────────────────────────────────────

test('formatSector: returns non-empty string for all values', () => {
  const sectors: InfraAttackEvent['sector'][] = ['power_grid', 'water_system', 'communications', 'transport'];
  for (const s of sectors) {
    assert.ok(formatSector(s).length > 0, `formatSector(${s}) should be non-empty`);
  }
});

// ── formatVector ──────────────────────────────────────────────────────────────

test('formatVector: returns non-empty string for all values', () => {
  const vectors: InfraAttackEvent['vector'][] = ['physical', 'cyber', 'combined'];
  for (const v of vectors) {
    assert.ok(formatVector(v).length > 0, `formatVector(${v}) should be non-empty`);
  }
});

// ── formatRecoveryStatus ──────────────────────────────────────────────────────

test('formatRecoveryStatus: returns non-empty string for all values', () => {
  const statuses: InfraAttackEvent['recoveryStatus'][] = ['contained', 'recovering', 'ongoing', 'unknown'];
  for (const s of statuses) {
    assert.ok(formatRecoveryStatus(s).length > 0, `formatRecoveryStatus(${s}) should be non-empty`);
  }
});

// ── formatAttributionConfidence ───────────────────────────────────────────────

test('formatAttributionConfidence: returns non-empty string for all values', () => {
  const confs: InfraAttackEvent['attributionConfidence'][] = ['confirmed', 'high', 'medium', 'low', 'unknown'];
  for (const c of confs) {
    assert.ok(formatAttributionConfidence(c).length > 0, `formatAttributionConfidence(${c}) should be non-empty`);
  }
});

// ── getSeverityWeight ─────────────────────────────────────────────────────────

test('getSeverityWeight: critical=40', () => {
  assert.equal(getSeverityWeight('critical'), 40);
});

test('getSeverityWeight: high=25', () => {
  assert.equal(getSeverityWeight('high'), 25);
});

test('getSeverityWeight: medium=10', () => {
  assert.equal(getSeverityWeight('medium'), 10);
});

test('getSeverityWeight: low=5', () => {
  assert.equal(getSeverityWeight('low'), 5);
});

// ── getVectorMultiplier ───────────────────────────────────────────────────────

test('getVectorMultiplier: combined=1.5', () => {
  assert.equal(getVectorMultiplier('combined'), 1.5);
});

test('getVectorMultiplier: cyber=1.2', () => {
  assert.equal(getVectorMultiplier('cyber'), 1.2);
});

test('getVectorMultiplier: physical=1.0', () => {
  assert.equal(getVectorMultiplier('physical'), 1.0);
});

// ── isOngoingAttack ───────────────────────────────────────────────────────────

test('isOngoingAttack: true only for ongoing', () => {
  assert.equal(isOngoingAttack(makeEvent({ recoveryStatus: 'ongoing' })), true);
  assert.equal(isOngoingAttack(makeEvent({ recoveryStatus: 'recovering' })), false);
  assert.equal(isOngoingAttack(makeEvent({ recoveryStatus: 'contained' })), false);
  assert.equal(isOngoingAttack(makeEvent({ recoveryStatus: 'unknown' })), false);
});

// ── groupBySector ─────────────────────────────────────────────────────────────

test('groupBySector: groups events into correct buckets', () => {
  const events = [
    makeEvent({ id: 'a', sector: 'power_grid' }),
    makeEvent({ id: 'b', sector: 'power_grid' }),
    makeEvent({ id: 'c', sector: 'water_system' }),
  ];
  const groups = groupBySector(events);
  assert.equal(groups.get('power_grid')?.length, 2);
  assert.equal(groups.get('water_system')?.length, 1);
  assert.equal(groups.get('communications'), undefined);
});

test('groupBySector: returns empty map for empty input', () => {
  const groups = groupBySector([]);
  assert.equal(groups.size, 0);
});

// ── getTopThreats ─────────────────────────────────────────────────────────────

test('getTopThreats: respects limit', () => {
  const events = Array.from({ length: 10 }, (_, i) =>
    makeEvent({ id: `ev-${i}`, severity: 'medium' }),
  );
  const top = getTopThreats(events, 3);
  assert.equal(top.length, 3);
});

test('getTopThreats: returns critical events first', () => {
  const events = [
    makeEvent({ id: 'low', severity: 'low' }),
    makeEvent({ id: 'critical', severity: 'critical' }),
    makeEvent({ id: 'high', severity: 'high' }),
  ];
  const top = getTopThreats(events, 3);
  assert.equal(top[0]?.severity, 'critical');
});

test('getTopThreats: limit larger than array returns all', () => {
  const events = [makeEvent({ id: 'a' }), makeEvent({ id: 'b' })];
  assert.equal(getTopThreats(events, 100).length, 2);
});

// ── sampleInfraAttackEvents ───────────────────────────────────────────────────

test('sampleInfraAttackEvents: returns at least 1 event', () => {
  const events = sampleInfraAttackEvents();
  assert.ok(events.length >= 1, `Expected ≥1 event, got ${events.length}`);
});

test('sampleInfraAttackEvents: each event has a valid id', () => {
  for (const ev of sampleInfraAttackEvents()) {
    assert.ok(ev.id.length > 0, `Event id should be non-empty`);
  }
});

test('sampleInfraAttackEvents: each event has a valid sector', () => {
  const valid = new Set<string>(['power_grid', 'water_system', 'communications', 'transport']);
  for (const ev of sampleInfraAttackEvents()) {
    assert.ok(valid.has(ev.sector), `Unexpected sector: ${ev.sector}`);
  }
});

test('sampleInfraAttackEvents: each event has a valid severity', () => {
  const valid = new Set<string>(['critical', 'high', 'medium', 'low']);
  for (const ev of sampleInfraAttackEvents()) {
    assert.ok(valid.has(ev.severity), `Unexpected severity: ${ev.severity}`);
  }
});

test('sampleInfraAttackEvents: each event has a non-empty location', () => {
  for (const ev of sampleInfraAttackEvents()) {
    assert.ok(ev.location.length > 0, `Location should be non-empty`);
  }
});
