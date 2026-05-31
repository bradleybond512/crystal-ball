/**
 * Tests for TerrorismSuperpowerPanel — pure helpers + reference data.
 *
 * Run with: npx tsx --test tests/components/terrorism-superpower-panel.test.mts
 *
 * No DOM required — all helpers are exported from
 * `terrorism-superpower-helpers.ts` for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityColor,
  activityLabel,
  attackMethodColor,
  attackMethodLabel,
  confidenceLabel,
  confidenceWidthPct,
  countCriticalGroups,
  countCriticalSignals,
  countSevereZones,
  deriveActiveThreats,
  deriveAttackPatterns,
  severityColor,
  severityLabel,
  signalTypeLabel,
  threatLevelColor,
  threatLevelLabel,
  timeAgo,
  trendArrow,
  trendColor,
  DESIGNATED_GROUPS,
  RADICALIZATION_SIGNALS,
  THREAT_ZONES,
  type AttackMethod,
  type GroupActivityLevel,
  type IncidentSeverity,
  type RadicalizationSignalType,
  type ThreatLevel,
} from '../../src/components/terrorism-superpower-helpers.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

const NOW = 1_745_000_000_000;

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'o-1',
    sourceId: 'test',
    domain: 'terrorism',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'fixture',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── severityColor / severityLabel ────────────────────────────────────────

test('severityColor: critical returns red', () => {
  assert.ok(severityColor('critical').includes('#ef4444'));
});

test('severityColor: low returns green', () => {
  assert.ok(severityColor('low').includes('#4caf50'));
});

test('severityLabel: critical returns "Critical"', () => {
  assert.equal(severityLabel('critical'), 'Critical');
});

test('severityLabel: all four levels return non-empty', () => {
  const levels: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
  for (const l of levels) assert.ok(severityLabel(l).length > 0);
});

// ── attackMethodColor / Label ────────────────────────────────────────────

test('attackMethodLabel: bombing returns "Bombing / IED"', () => {
  assert.equal(attackMethodLabel('bombing'), 'Bombing / IED');
});

test('attackMethodLabel: covers all five methods with distinct strings', () => {
  const methods: AttackMethod[] = ['bombing', 'shooting', 'vehicle', 'cyber', 'chemical'];
  const labels = new Set(methods.map((m) => attackMethodLabel(m)));
  assert.equal(labels.size, methods.length);
});

test('attackMethodColor: cyber returns blue accent', () => {
  assert.ok(attackMethodColor('cyber').includes('#4a9eff'));
});

test('attackMethodColor: chemical returns deep red', () => {
  assert.ok(attackMethodColor('chemical').includes('#b71c1c'));
});

// ── trend ────────────────────────────────────────────────────────────────

test('trendArrow: rising returns up arrow', () => {
  assert.equal(trendArrow('rising'), '▲');
});

test('trendArrow: falling returns down arrow', () => {
  assert.equal(trendArrow('falling'), '▼');
});

test('trendArrow: flat returns horizontal arrow', () => {
  assert.equal(trendArrow('flat'), '→');
});

test('trendColor: rising is red, falling is green, flat is grey', () => {
  assert.ok(trendColor('rising').includes('#ef4444'));
  assert.ok(trendColor('falling').includes('#4caf50'));
  assert.ok(trendColor('flat').includes('#9e9e9e'));
});

// ── activity ─────────────────────────────────────────────────────────────

test('activityLabel: covers all four levels', () => {
  const levels: GroupActivityLevel[] = ['dormant', 'active', 'elevated', 'critical'];
  for (const l of levels) assert.ok(activityLabel(l).length > 0);
});

test('activityColor: critical returns red, dormant returns grey', () => {
  assert.ok(activityColor('critical').includes('#ef4444'));
  assert.ok(activityColor('dormant').includes('#9e9e9e'));
});

// ── threat zone ──────────────────────────────────────────────────────────

test('threatLevelColor: level 0 grey, level 4 red', () => {
  assert.ok(threatLevelColor(0).includes('#9e9e9e'));
  assert.ok(threatLevelColor(4).includes('#ef4444'));
});

test('threatLevelLabel: 0 -> Minimal, 4 -> Severe', () => {
  assert.equal(threatLevelLabel(0), 'Minimal');
  assert.equal(threatLevelLabel(4), 'Severe');
});

test('threatLevelLabel: covers all five tiers with distinct strings', () => {
  const tiers: ThreatLevel[] = [0, 1, 2, 3, 4];
  const labels = new Set(tiers.map((t) => threatLevelLabel(t)));
  assert.equal(labels.size, tiers.length);
});

// ── radicalization signal ────────────────────────────────────────────────

test('signalTypeLabel: covers all four signal types', () => {
  const types: RadicalizationSignalType[] = ['recruitment', 'propaganda', 'financing', 'training'];
  for (const t of types) assert.ok(signalTypeLabel(t).length > 0);
});

test('confidenceLabel: low/medium/high return distinct labels', () => {
  const labels = new Set([confidenceLabel('low'), confidenceLabel('medium'), confidenceLabel('high')]);
  assert.equal(labels.size, 3);
});

test('confidenceWidthPct: high > medium > low and all in [0, 100]', () => {
  const low = confidenceWidthPct('low');
  const med = confidenceWidthPct('medium');
  const hi = confidenceWidthPct('high');
  assert.ok(low < med && med < hi);
  for (const v of [low, med, hi]) assert.ok(v >= 0 && v <= 100);
});

// ── timeAgo ──────────────────────────────────────────────────────────────

test('timeAgo: <60s ago returns "now"', () => {
  assert.equal(timeAgo(NOW - 30 * 1000, NOW), 'now');
});

test('timeAgo: minutes ago returns "Xm ago"', () => {
  assert.equal(timeAgo(NOW - 5 * 60 * 1000, NOW), '5m ago');
});

test('timeAgo: hours ago returns "Xh ago"', () => {
  assert.equal(timeAgo(NOW - 3 * 60 * 60 * 1000, NOW), '3h ago');
});

test('timeAgo: days ago returns "Xd ago"', () => {
  assert.equal(timeAgo(NOW - 2 * 24 * 60 * 60 * 1000, NOW), '2d ago');
});

test('timeAgo: future timestamp returns "future"', () => {
  assert.equal(timeAgo(NOW + 1000, NOW), 'future');
});

// ── countCritical helpers ────────────────────────────────────────────────

test('countCriticalGroups: counts critical + elevated', () => {
  const count = countCriticalGroups(DESIGNATED_GROUPS);
  const manual = DESIGNATED_GROUPS.filter((g) => g.activityLevel === 'critical' || g.activityLevel === 'elevated').length;
  assert.equal(count, manual);
  assert.ok(count > 0);
});

test('countSevereZones: counts zones at threat level >= 3', () => {
  const count = countSevereZones(THREAT_ZONES);
  const manual = THREAT_ZONES.filter((z) => z.level >= 3).length;
  assert.equal(count, manual);
});

test('countCriticalSignals: counts high + critical severity', () => {
  const count = countCriticalSignals(RADICALIZATION_SIGNALS);
  const manual = RADICALIZATION_SIGNALS.filter((s) => s.severity === 'high' || s.severity === 'critical').length;
  assert.equal(count, manual);
});

// ── reference catalogues ────────────────────────────────────────────────

test('DESIGNATED_GROUPS includes ISIS, Al-Qaeda, JNIM', () => {
  const names = DESIGNATED_GROUPS.map((g) => g.name);
  assert.ok(names.some((n) => n.includes('ISIS')));
  assert.ok(names.some((n) => n.includes('Al-Qaeda')));
  assert.ok(names.some((n) => n.includes('JNIM')));
});

test('THREAT_ZONES covers all eight regions specified', () => {
  const regions = THREAT_ZONES.map((z) => z.region);
  for (const expected of [
    'Western Europe', 'Eastern Europe', 'Middle East', 'North Africa',
    'Sub-Saharan Africa', 'South Asia', 'Southeast Asia', 'Americas',
  ]) {
    assert.ok(regions.includes(expected as typeof regions[number]), `missing ${expected}`);
  }
});

test('RADICALIZATION_SIGNALS covers all four signal types', () => {
  const types = new Set(RADICALIZATION_SIGNALS.map((s) => s.signalType));
  for (const t of ['recruitment', 'propaganda', 'financing', 'training']) {
    assert.ok(types.has(t as RadicalizationSignalType));
  }
});

// ── deriveActiveThreats ─────────────────────────────────────────────────

test('deriveActiveThreats: ignores non-terrorism domain events', () => {
  const events: ObservationEvent[] = [obs({ domain: 'finance', title: 'bombing of bank account' })];
  assert.equal(deriveActiveThreats(events, NOW).length, 0);
});

test('deriveActiveThreats: ignores events older than 48h', () => {
  const old: ObservationEvent = obs({
    title: 'bombing in market', timestamp: NOW - 49 * 60 * 60 * 1000,
  });
  assert.equal(deriveActiveThreats([old], NOW).length, 0);
});

test('deriveActiveThreats: ignores events without a classifiable method', () => {
  const events: ObservationEvent[] = [obs({ title: 'press conference' })];
  assert.equal(deriveActiveThreats(events, NOW).length, 0);
});

test('deriveActiveThreats: classifies bombing via title keyword', () => {
  const events: ObservationEvent[] = [obs({ title: 'IED detonation in Kabul' })];
  const rows = deriveActiveThreats(events, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.attackType, 'bombing');
});

test('deriveActiveThreats: classifies shooting via title keyword', () => {
  const events: ObservationEvent[] = [obs({ title: 'armed assault on convoy', tags: ['terrorism'] })];
  const rows = deriveActiveThreats(events, NOW);
  assert.equal(rows[0]?.attackType, 'shooting');
});

test('deriveActiveThreats: extracts group name from `group:` tag', () => {
  const events: ObservationEvent[] = [
    obs({ title: 'bombing in Mogadishu', tags: ['group:Al-Shabaab'] }),
  ];
  assert.equal(deriveActiveThreats(events, NOW)[0]!.group, 'Al-Shabaab');
});

test('deriveActiveThreats: falls back to scanning title for known groups', () => {
  const events: ObservationEvent[] = [obs({ title: 'ISIS claims responsibility for bombing' })];
  assert.equal(deriveActiveThreats(events, NOW)[0]!.group, 'ISIS');
});

test('deriveActiveThreats: marks unattributed when no group found', () => {
  const events: ObservationEvent[] = [obs({ title: 'IED detonation in market' })];
  assert.equal(deriveActiveThreats(events, NOW)[0]!.group, 'Unattributed');
});

test('deriveActiveThreats: sorts by severity desc then newest-first', () => {
  const events: ObservationEvent[] = [
    obs({ id: 'a', title: 'bombing', severity: 'MEDIUM', timestamp: NOW - 1000 }),
    obs({ id: 'b', title: 'bombing', severity: 'CRITICAL', timestamp: NOW - 5000 }),
    obs({ id: 'c', title: 'bombing', severity: 'CRITICAL', timestamp: NOW - 1000 }),
  ];
  const rows = deriveActiveThreats(events, NOW);
  assert.equal(rows[0]!.id, 'c'); // CRITICAL + newest
  assert.equal(rows[1]!.id, 'b'); // CRITICAL + older
  assert.equal(rows[2]!.id, 'a'); // MEDIUM
});

test('deriveActiveThreats: caps at 10 rows', () => {
  const events: ObservationEvent[] = Array.from({ length: 25 }, (_, i) => obs({
    id: `e-${i}`, title: `bombing #${i}`, timestamp: NOW - 60 * 1000 - i,
  }));
  assert.equal(deriveActiveThreats(events, NOW).length, 10);
});

test('deriveActiveThreats: formats location from observation.location', () => {
  const events: ObservationEvent[] = [obs({
    title: 'bombing', location: { lat: 33.5138, lon: 36.2765 },
  })];
  const row = deriveActiveThreats(events, NOW)[0]!;
  assert.match(row.location, /33\.\d{2}, 36\.\d{2}/);
});

test('deriveActiveThreats: location is "Unknown" when no coords', () => {
  const events: ObservationEvent[] = [obs({ title: 'bombing' })];
  assert.equal(deriveActiveThreats(events, NOW)[0]!.location, 'Unknown');
});

test('deriveActiveThreats: maps observation severity case-insensitively', () => {
  const events: ObservationEvent[] = [obs({ title: 'bombing', severity: 'CRITICAL' })];
  assert.equal(deriveActiveThreats(events, NOW)[0]!.severity, 'critical');
});

// ── deriveAttackPatterns ─────────────────────────────────────────────────

test('deriveAttackPatterns: always returns rows for all five methods', () => {
  const rows = deriveAttackPatterns([], NOW);
  const methods = new Set(rows.map((r) => r.method));
  assert.equal(rows.length, 5);
  for (const m of ['bombing', 'shooting', 'vehicle', 'cyber', 'chemical']) {
    assert.ok(methods.has(m as AttackMethod));
  }
});

test('deriveAttackPatterns: counts only last-30-day terrorism events', () => {
  const events: ObservationEvent[] = [
    obs({ id: 'a', title: 'bombing', timestamp: NOW - 1 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'b', title: 'bombing', timestamp: NOW - 45 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'c', title: 'bombing', domain: 'finance', timestamp: NOW - 1 * 24 * 60 * 60 * 1000 }),
  ];
  const rows = deriveAttackPatterns(events, NOW);
  const bombing = rows.find((r) => r.method === 'bombing')!;
  assert.equal(bombing.count, 1);
});

test('deriveAttackPatterns: trend rises when recent > 1.2x prior', () => {
  const events: ObservationEvent[] = [
    obs({ id: 'r1', title: 'bombing', timestamp: NOW - 1 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'r2', title: 'bombing', timestamp: NOW - 2 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'r3', title: 'bombing', timestamp: NOW - 3 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'r4', title: 'bombing', timestamp: NOW - 4 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p1', title: 'bombing', timestamp: NOW - 10 * 24 * 60 * 60 * 1000 }),
  ];
  const bombing = deriveAttackPatterns(events, NOW).find((r) => r.method === 'bombing')!;
  assert.equal(bombing.trend, 'rising');
});

test('deriveAttackPatterns: trend falls when recent < 0.8x prior', () => {
  const events: ObservationEvent[] = [
    obs({ id: 'r1', title: 'bombing', timestamp: NOW - 1 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p1', title: 'bombing', timestamp: NOW - 8 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p2', title: 'bombing', timestamp: NOW - 9 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p3', title: 'bombing', timestamp: NOW - 10 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p4', title: 'bombing', timestamp: NOW - 11 * 24 * 60 * 60 * 1000 }),
  ];
  const bombing = deriveAttackPatterns(events, NOW).find((r) => r.method === 'bombing')!;
  assert.equal(bombing.trend, 'falling');
});

test('deriveAttackPatterns: trend flat when recent ~= prior', () => {
  const events: ObservationEvent[] = [
    obs({ id: 'r1', title: 'bombing', timestamp: NOW - 1 * 24 * 60 * 60 * 1000 }),
    obs({ id: 'p1', title: 'bombing', timestamp: NOW - 10 * 24 * 60 * 60 * 1000 }),
  ];
  const bombing = deriveAttackPatterns(events, NOW).find((r) => r.method === 'bombing')!;
  assert.equal(bombing.trend, 'flat');
});

test('deriveAttackPatterns: ignores unclassifiable titles', () => {
  const events: ObservationEvent[] = [
    obs({ title: 'press release', timestamp: NOW - 1000 }),
  ];
  const total = deriveAttackPatterns(events, NOW).reduce((acc, r) => acc + r.count, 0);
  assert.equal(total, 0);
});

test('deriveAttackPatterns: classifies cyber via tag keywords', () => {
  const events: ObservationEvent[] = [
    obs({ title: 'targeted attack', tags: ['ransomware'], timestamp: NOW - 1 * 60 * 60 * 1000 }),
  ];
  const cyber = deriveAttackPatterns(events, NOW).find((r) => r.method === 'cyber')!;
  assert.equal(cyber.count, 1);
});
