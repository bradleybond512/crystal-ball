/**
 * Tests for GlobalMigrationCrisisPanel — pure helper functions and data constants.
 *
 * Run with: npx tsx --test tests/components/global-migration-crisis-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. Panel class construction requires a
 * full DOM environment and is covered by the panel smoke harness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migrationSeverityColor,
  causeLabel,
  causeIcon,
  trendArrow,
  trendColor,
  tensionColor,
  tensionTierLabel,
  capacityStatusLabel,
  capacityStatusColor,
  campCapacityColor,
  programStatusLabel,
  programStatusColor,
  formatDisplacedCount,
  formatBeneficiaries,
  criticalCampCount,
  activeBorderCrisisCount,
  totalDisplacedMillions,
  DISPLACEMENT_CRISES,
  BORDER_PRESSURE_POINTS,
  CAMP_STATUSES,
  REPATRIATION_PROGRAMS,
  REGIONAL_DISPLACEMENT_INDEX,
  type DisplacementCause,
  type DisplacementTrend,
  type BorderCapacityStatus,
  type ProgramStatus,
  type BorderTensionLevel,
  type CampStatus,
  type BorderPressurePoint,
} from '../../src/components/global-migration-crisis-helpers.ts';

// ── migrationSeverityColor ────────────────────────────────────────────

test('migrationSeverityColor returns green for low', () => {
  assert.equal(migrationSeverityColor('low'), '#4caf50');
});

test('migrationSeverityColor returns orange for medium', () => {
  assert.equal(migrationSeverityColor('medium'), '#ff9800');
});

test('migrationSeverityColor returns red for high', () => {
  assert.equal(migrationSeverityColor('high'), '#f44336');
});

test('migrationSeverityColor returns dark red for critical', () => {
  assert.equal(migrationSeverityColor('critical'), '#b71c1c');
});

// ── causeLabel ────────────────────────────────────────────────────────

test('causeLabel returns Conflict for conflict', () => {
  assert.equal(causeLabel('conflict'), 'Conflict');
});

test('causeLabel returns Climate for climate', () => {
  assert.equal(causeLabel('climate'), 'Climate');
});

test('causeLabel returns Disaster for disaster', () => {
  assert.equal(causeLabel('disaster'), 'Disaster');
});

test('causeLabel returns Persecution for persecution', () => {
  assert.equal(causeLabel('persecution'), 'Persecution');
});

test('causeLabel falls back to raw value for unknown', () => {
  const unknown = 'unknown' as DisplacementCause;
  assert.equal(causeLabel(unknown), 'unknown');
});

// ── causeIcon ─────────────────────────────────────────────────────────

test('causeIcon returns non-empty string for conflict', () => {
  assert.ok(causeIcon('conflict').length > 0);
});

test('causeIcon returns non-empty string for all known causes', () => {
  const causes: DisplacementCause[] = ['conflict', 'climate', 'disaster', 'persecution'];
  for (const cause of causes) {
    assert.ok(causeIcon(cause).length > 0, `missing icon for ${cause}`);
  }
});

// ── trendArrow ────────────────────────────────────────────────────────

test('trendArrow returns ↑ for increasing', () => {
  assert.equal(trendArrow('increasing'), '↑');
});

test('trendArrow returns ↓ for decreasing', () => {
  assert.equal(trendArrow('decreasing'), '↓');
});

test('trendArrow returns → for stable', () => {
  assert.equal(trendArrow('stable'), '→');
});

// ── trendColor ────────────────────────────────────────────────────────

test('trendColor returns red for increasing', () => {
  assert.equal(trendColor('increasing'), '#f44336');
});

test('trendColor returns green for decreasing', () => {
  assert.equal(trendColor('decreasing'), '#4caf50');
});

test('trendColor returns grey for stable', () => {
  assert.equal(trendColor('stable'), '#9e9e9e');
});

// ── tensionColor ──────────────────────────────────────────────────────

test('tensionColor level 0 returns ok var', () => {
  assert.ok(tensionColor(0).includes('severity-ok'));
});

test('tensionColor level 1 returns info var', () => {
  assert.ok(tensionColor(1).includes('severity-info'));
});

test('tensionColor level 2 returns medium var', () => {
  assert.ok(tensionColor(2).includes('severity-medium'));
});

test('tensionColor level 3 returns high var', () => {
  assert.ok(tensionColor(3).includes('severity-high'));
});

test('tensionColor level 4 returns critical var', () => {
  assert.ok(tensionColor(4).includes('severity-critical'));
});

// ── tensionTierLabel ──────────────────────────────────────────────────

test('tensionTierLabel 0 returns Normal', () => {
  assert.equal(tensionTierLabel(0), 'Normal');
});

test('tensionTierLabel 1 returns Watch', () => {
  assert.equal(tensionTierLabel(1), 'Watch');
});

test('tensionTierLabel 2 returns Elevated', () => {
  assert.equal(tensionTierLabel(2), 'Elevated');
});

test('tensionTierLabel 3 returns High', () => {
  assert.equal(tensionTierLabel(3), 'High');
});

test('tensionTierLabel 4 returns Critical', () => {
  assert.equal(tensionTierLabel(4), 'Critical');
});

// ── capacityStatusLabel ───────────────────────────────────────────────

test('capacityStatusLabel returns Normal', () => {
  assert.equal(capacityStatusLabel('normal'), 'Normal');
});

test('capacityStatusLabel returns Stressed', () => {
  assert.equal(capacityStatusLabel('stressed'), 'Stressed');
});

test('capacityStatusLabel returns Overwhelmed', () => {
  assert.equal(capacityStatusLabel('overwhelmed'), 'Overwhelmed');
});

test('capacityStatusLabel returns Closed', () => {
  assert.equal(capacityStatusLabel('closed'), 'Closed');
});

test('capacityStatusLabel falls back to raw value for unknown', () => {
  const unknown = 'unknown' as BorderCapacityStatus;
  assert.equal(capacityStatusLabel(unknown), 'unknown');
});

// ── capacityStatusColor ───────────────────────────────────────────────

test('capacityStatusColor returns green for normal', () => {
  assert.equal(capacityStatusColor('normal'), '#4caf50');
});

test('capacityStatusColor returns orange for stressed', () => {
  assert.equal(capacityStatusColor('stressed'), '#ff9800');
});

test('capacityStatusColor returns red for overwhelmed', () => {
  assert.equal(capacityStatusColor('overwhelmed'), '#f44336');
});

// ── campCapacityColor ─────────────────────────────────────────────────

test('campCapacityColor returns green for < 80%', () => {
  assert.equal(campCapacityColor(70), '#4caf50');
});

test('campCapacityColor returns orange for 81-100%', () => {
  assert.equal(campCapacityColor(90), '#ff9800');
});

test('campCapacityColor returns red for 101-120%', () => {
  assert.equal(campCapacityColor(110), '#f44336');
});

test('campCapacityColor returns dark red for > 120%', () => {
  assert.equal(campCapacityColor(130), '#b71c1c');
});

test('campCapacityColor returns green at exactly 80%', () => {
  assert.equal(campCapacityColor(80), '#4caf50');
});

test('campCapacityColor returns red at exactly 120%', () => {
  assert.equal(campCapacityColor(120), '#f44336');
});

// ── programStatusLabel ────────────────────────────────────────────────

test('programStatusLabel returns Active', () => {
  assert.equal(programStatusLabel('active'), 'Active');
});

test('programStatusLabel returns Suspended', () => {
  assert.equal(programStatusLabel('suspended'), 'Suspended');
});

test('programStatusLabel returns Planned', () => {
  assert.equal(programStatusLabel('planned'), 'Planned');
});

test('programStatusLabel returns Completed', () => {
  assert.equal(programStatusLabel('completed'), 'Completed');
});

test('programStatusLabel falls back for unknown', () => {
  const unknown = 'unknown' as ProgramStatus;
  assert.equal(programStatusLabel(unknown), 'unknown');
});

// ── programStatusColor ────────────────────────────────────────────────

test('programStatusColor returns green for active', () => {
  assert.equal(programStatusColor('active'), '#4caf50');
});

test('programStatusColor returns red for suspended', () => {
  assert.equal(programStatusColor('suspended'), '#f44336');
});

test('programStatusColor returns orange for planned', () => {
  assert.equal(programStatusColor('planned'), '#ff9800');
});

test('programStatusColor returns grey for completed', () => {
  assert.equal(programStatusColor('completed'), '#9e9e9e');
});

// ── formatDisplacedCount ──────────────────────────────────────────────

test('formatDisplacedCount shows K for < 1000K', () => {
  assert.equal(formatDisplacedCount(950), '950K');
});

test('formatDisplacedCount shows whole millions', () => {
  assert.equal(formatDisplacedCount(8_000), '8M');
});

test('formatDisplacedCount shows decimal millions', () => {
  assert.equal(formatDisplacedCount(13_500), '13.5M');
});

test('formatDisplacedCount shows 1M at exactly 1000K', () => {
  assert.equal(formatDisplacedCount(1_000), '1M');
});

test('formatDisplacedCount shows 2.1M', () => {
  assert.equal(formatDisplacedCount(2_100), '2.1M');
});

// ── formatBeneficiaries ───────────────────────────────────────────────

test('formatBeneficiaries returns — for 0', () => {
  assert.equal(formatBeneficiaries(0), '—');
});

test('formatBeneficiaries shows raw count for small numbers', () => {
  assert.equal(formatBeneficiaries(500), '500/mo');
});

test('formatBeneficiaries shows K/mo for thousands', () => {
  assert.equal(formatBeneficiaries(3_200), '3.2K/mo');
});

test('formatBeneficiaries shows 1.8K/mo', () => {
  assert.equal(formatBeneficiaries(1_800), '1.8K/mo');
});

// ── criticalCampCount ─────────────────────────────────────────────────

test('criticalCampCount counts camps at >= 120%', () => {
  const camps: CampStatus[] = [
    { name: 'A', country: 'X', populationThousands: 100, capacityPct: 145, primaryNationality: 'N', criticalNeeds: [] },
    { name: 'B', country: 'X', populationThousands: 50, capacityPct: 120, primaryNationality: 'N', criticalNeeds: [] },
    { name: 'C', country: 'X', populationThousands: 30, capacityPct: 110, primaryNationality: 'N', criticalNeeds: [] },
  ];
  assert.equal(criticalCampCount(camps), 2);
});

test('criticalCampCount returns 0 for empty array', () => {
  assert.equal(criticalCampCount([]), 0);
});

test('criticalCampCount excludes camps below 120%', () => {
  const camps: CampStatus[] = [
    { name: 'A', country: 'X', populationThousands: 100, capacityPct: 119, primaryNationality: 'N', criticalNeeds: [] },
  ];
  assert.equal(criticalCampCount(camps), 0);
});

// ── activeBorderCrisisCount ───────────────────────────────────────────

test('activeBorderCrisisCount counts tension >= 3', () => {
  const borders: BorderPressurePoint[] = [
    { name: 'A', dailyCrossings: 1000, capacityStatus: 'overwhelmed', tensionLevel: 4 },
    { name: 'B', dailyCrossings: 500, capacityStatus: 'stressed', tensionLevel: 3 },
    { name: 'C', dailyCrossings: 200, capacityStatus: 'stressed', tensionLevel: 2 },
    { name: 'D', dailyCrossings: 100, capacityStatus: 'normal', tensionLevel: 1 },
  ];
  assert.equal(activeBorderCrisisCount(borders), 2);
});

test('activeBorderCrisisCount returns 0 for empty', () => {
  assert.equal(activeBorderCrisisCount([]), 0);
});

test('activeBorderCrisisCount excludes tension <= 2', () => {
  const borders: BorderPressurePoint[] = [
    { name: 'A', dailyCrossings: 100, capacityStatus: 'normal', tensionLevel: 2 },
  ];
  assert.equal(activeBorderCrisisCount(borders), 0);
});

// ── totalDisplacedMillions ────────────────────────────────────────────

test('totalDisplacedMillions sums crises and returns millions', () => {
  const total = totalDisplacedMillions(DISPLACEMENT_CRISES);
  assert.ok(total > 50, `expected > 50M, got ${total}`);
});

test('totalDisplacedMillions returns 0 for empty array', () => {
  assert.equal(totalDisplacedMillions([]), 0);
});

test('totalDisplacedMillions rounds to 1 decimal place', () => {
  const str = String(totalDisplacedMillions(DISPLACEMENT_CRISES));
  const parts = str.split('.');
  if (parts.length > 1) {
    assert.ok(parts[1]!.length <= 1, `too many decimal places: ${str}`);
  }
});

// ── Static data shape ─────────────────────────────────────────────────

test('DISPLACEMENT_CRISES has at least 5 entries', () => {
  assert.ok(DISPLACEMENT_CRISES.length >= 5);
});

test('DISPLACEMENT_CRISES entries have required fields', () => {
  for (const c of DISPLACEMENT_CRISES) {
    assert.ok(typeof c.name === 'string' && c.name.length > 0, `name missing`);
    assert.ok(typeof c.region === 'string', `region missing for ${c.name}`);
    assert.ok(c.displacedThousands > 0, `displacedThousands invalid for ${c.name}`);
    assert.ok(['conflict', 'climate', 'disaster', 'persecution'].includes(c.cause), `bad cause: ${c.cause}`);
    assert.ok(['increasing', 'stable', 'decreasing'].includes(c.trend), `bad trend: ${c.trend}`);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(c.severity), `bad severity: ${c.severity}`);
  }
});

test('BORDER_PRESSURE_POINTS has at least 5 entries', () => {
  assert.ok(BORDER_PRESSURE_POINTS.length >= 5);
});

test('BORDER_PRESSURE_POINTS tensionLevel is 0-4', () => {
  for (const b of BORDER_PRESSURE_POINTS) {
    assert.ok(b.tensionLevel >= 0 && b.tensionLevel <= 4, `tensionLevel out of range: ${b.tensionLevel}`);
  }
});

test('CAMP_STATUSES has at least 5 entries', () => {
  assert.ok(CAMP_STATUSES.length >= 5);
});

test('CAMP_STATUSES entries have valid capacityPct', () => {
  for (const c of CAMP_STATUSES) {
    assert.ok(c.capacityPct > 0, `capacityPct invalid for ${c.name}`);
    assert.ok(Array.isArray(c.criticalNeeds), `criticalNeeds missing for ${c.name}`);
  }
});

test('REPATRIATION_PROGRAMS has at least 5 entries', () => {
  assert.ok(REPATRIATION_PROGRAMS.length >= 5);
});

test('REPATRIATION_PROGRAMS statuses are valid', () => {
  const valid = new Set(['active', 'suspended', 'planned', 'completed']);
  for (const p of REPATRIATION_PROGRAMS) {
    assert.ok(valid.has(p.status), `bad status: ${p.status}`);
  }
});

test('REGIONAL_DISPLACEMENT_INDEX has 6 entries', () => {
  assert.equal(REGIONAL_DISPLACEMENT_INDEX.length, 6);
});

test('REGIONAL_DISPLACEMENT_INDEX scores are 0-4', () => {
  for (const r of REGIONAL_DISPLACEMENT_INDEX) {
    assert.ok(r.score >= 0 && r.score <= 4, `score out of range: ${r.score} for ${r.region}`);
  }
});

// ── Data quality ──────────────────────────────────────────────────────

test('DISPLACEMENT_CRISES has at least one critical entry', () => {
  assert.ok(DISPLACEMENT_CRISES.some((c) => c.severity === 'critical'));
});

test('BORDER_PRESSURE_POINTS has at least one overwhelmed entry', () => {
  assert.ok(BORDER_PRESSURE_POINTS.some((b) => b.capacityStatus === 'overwhelmed'));
});

test('CAMP_STATUSES has at least one over-capacity camp', () => {
  assert.ok(CAMP_STATUSES.some((c) => c.capacityPct > 100));
});

test('REPATRIATION_PROGRAMS has at least one active program', () => {
  assert.ok(REPATRIATION_PROGRAMS.some((p) => p.status === 'active'));
});

test('REPATRIATION_PROGRAMS has at least one suspended program', () => {
  assert.ok(REPATRIATION_PROGRAMS.some((p) => p.status === 'suspended'));
});

test('REGIONAL_DISPLACEMENT_INDEX includes Sub-Saharan Africa', () => {
  assert.ok(REGIONAL_DISPLACEMENT_INDEX.some((r) => r.region === 'Sub-Saharan Africa'));
});

test('REGIONAL_DISPLACEMENT_INDEX includes Europe', () => {
  assert.ok(REGIONAL_DISPLACEMENT_INDEX.some((r) => r.region === 'Europe'));
});

// ── Helper integration ────────────────────────────────────────────────

test('criticalCampCount on real CAMP_STATUSES >= 2', () => {
  assert.ok(criticalCampCount(CAMP_STATUSES) >= 2);
});

test('activeBorderCrisisCount on real BORDER_PRESSURE_POINTS >= 3', () => {
  assert.ok(activeBorderCrisisCount(BORDER_PRESSURE_POINTS) >= 3);
});
