/**
 * Tests for WaterSecurityPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/water-security-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All helpers are exported from the
 * helpers module for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stressColor,
  stressLabel,
  driverLabel,
  conflictTypeLabel,
  tensionColor,
  damTypeLabel,
  damSeverityColor,
  attackTypeLabel,
  attackTypeColor,
  hydroRiskColor,
  hydroRiskLabel,
  formatPopM,
  countCriticalStress,
  countArmedConflicts,
  STRESS_HOTSPOTS,
  TRANSBOUNDARY_CONFLICTS,
  DAM_WATCH,
  INFRA_ATTACKS,
  HYDRO_INDEX,
  type StressLevel,
  type HydroRisk,
  type WaterStressHotspot,
  type TransboundaryConflict,
} from '../../src/components/water-security-helpers.ts';

// ── stressColor ───────────────────────────────────────────────────────────

test('stressColor: 0 returns grey (low stress)', () => {
  assert.ok(stressColor(0).includes('#9e9e9e'));
});

test('stressColor: 1 returns green (medium)', () => {
  assert.ok(stressColor(1).includes('#4caf50'));
});

test('stressColor: 2 returns yellow (high)', () => {
  assert.ok(stressColor(2).includes('#facc15'));
});

test('stressColor: 3 returns orange (very high)', () => {
  assert.ok(stressColor(3).includes('#fb923c'));
});

test('stressColor: 4 returns red (extremely high)', () => {
  assert.ok(stressColor(4).includes('#ef4444'));
});

// ── stressLabel ───────────────────────────────────────────────────────────

test('stressLabel: 0 returns "Low"', () => {
  assert.equal(stressLabel(0), 'Low');
});

test('stressLabel: 4 returns "Extremely High"', () => {
  assert.equal(stressLabel(4), 'Extremely High');
});

test('stressLabel: all levels return non-empty strings', () => {
  const levels: StressLevel[] = [0, 1, 2, 3, 4];
  for (const l of levels) assert.ok(stressLabel(l).length > 0);
});

// ── driverLabel ───────────────────────────────────────────────────────────

test('driverLabel: overuse returns "Overuse"', () => {
  assert.equal(driverLabel('overuse'), 'Overuse');
});

test('driverLabel: all drivers return non-empty strings', () => {
  for (const d of ['overuse', 'drought', 'pollution', 'conflict'] as const) {
    assert.ok(driverLabel(d).length > 0);
  }
});

// ── conflictTypeLabel ─────────────────────────────────────────────────────

test('conflictTypeLabel: diplomatic returns "Diplomatic"', () => {
  assert.equal(conflictTypeLabel('diplomatic'), 'Diplomatic');
});

test('conflictTypeLabel: armed returns "Armed"', () => {
  assert.equal(conflictTypeLabel('armed'), 'Armed');
});

test('conflictTypeLabel: economic returns "Economic"', () => {
  assert.equal(conflictTypeLabel('economic'), 'Economic');
});

// ── tensionColor ──────────────────────────────────────────────────────────

test('tensionColor: low returns green', () => {
  assert.ok(tensionColor('low').includes('#4caf50'));
});

test('tensionColor: critical returns red', () => {
  assert.ok(tensionColor('critical').includes('#ef4444'));
});

test('tensionColor: medium returns yellow', () => {
  assert.ok(tensionColor('medium').includes('#facc15'));
});

test('tensionColor: high returns orange', () => {
  assert.ok(tensionColor('high').includes('#fb923c'));
});

// ── damTypeLabel ──────────────────────────────────────────────────────────

test('damTypeLabel: structural concern returns proper label', () => {
  assert.equal(damTypeLabel('structural concern'), 'Structural Concern');
});

test('damTypeLabel: low storage returns "Low Storage"', () => {
  assert.equal(damTypeLabel('low storage'), 'Low Storage');
});

test('damTypeLabel: weaponization risk returns proper label', () => {
  assert.equal(damTypeLabel('weaponization risk'), 'Weaponization Risk');
});

// ── damSeverityColor ──────────────────────────────────────────────────────

test('damSeverityColor: watch returns yellow', () => {
  assert.ok(damSeverityColor('watch').includes('#facc15'));
});

test('damSeverityColor: warning returns orange', () => {
  assert.ok(damSeverityColor('warning').includes('#fb923c'));
});

test('damSeverityColor: critical returns red', () => {
  assert.ok(damSeverityColor('critical').includes('#ef4444'));
});

// ── attackTypeLabel ───────────────────────────────────────────────────────

test('attackTypeLabel: contamination returns "Contamination"', () => {
  assert.equal(attackTypeLabel('contamination'), 'Contamination');
});

test('attackTypeLabel: physical destruction returns proper label', () => {
  assert.equal(attackTypeLabel('physical destruction'), 'Physical Destruction');
});

test('attackTypeLabel: cyber returns "Cyber"', () => {
  assert.equal(attackTypeLabel('cyber'), 'Cyber');
});

// ── attackTypeColor ───────────────────────────────────────────────────────

test('attackTypeColor: physical destruction returns red', () => {
  assert.ok(attackTypeColor('physical destruction').includes('#ef4444'));
});

test('attackTypeColor: contamination returns orange', () => {
  assert.ok(attackTypeColor('contamination').includes('#fb923c'));
});

test('attackTypeColor: cyber returns yellow', () => {
  assert.ok(attackTypeColor('cyber').includes('#facc15'));
});

// ── hydroRiskColor ────────────────────────────────────────────────────────

test('hydroRiskColor: 0 returns grey', () => {
  assert.ok(hydroRiskColor(0).includes('#9e9e9e'));
});

test('hydroRiskColor: 4 returns red', () => {
  assert.ok(hydroRiskColor(4).includes('#ef4444'));
});

test('hydroRiskColor: all levels return non-empty strings', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) assert.ok(hydroRiskColor(r).length > 0);
});

// ── hydroRiskLabel ────────────────────────────────────────────────────────

test('hydroRiskLabel: 0 returns "Minimal"', () => {
  assert.equal(hydroRiskLabel(0), 'Minimal');
});

test('hydroRiskLabel: 4 returns "Severe"', () => {
  assert.equal(hydroRiskLabel(4), 'Severe');
});

test('hydroRiskLabel: all levels return non-empty strings', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) assert.ok(hydroRiskLabel(r).length > 0);
});

// ── formatPopM ────────────────────────────────────────────────────────────

test('formatPopM: >= 100 rounds to whole number', () => {
  assert.equal(formatPopM(180), '180M');
});

test('formatPopM: 10-99 shows no decimal', () => {
  assert.equal(formatPopM(60), '60M');
});

test('formatPopM: < 10 shows one decimal', () => {
  assert.equal(formatPopM(1.5), '1.5M');
});

test('formatPopM: 40 rounds correctly', () => {
  assert.equal(formatPopM(40), '40M');
});

// ── countCriticalStress ───────────────────────────────────────────────────

test('countCriticalStress: empty array returns 0', () => {
  assert.equal(countCriticalStress([]), 0);
});

test('countCriticalStress: counts stressLevel >= 3', () => {
  const hotspots: WaterStressHotspot[] = [
    { region: 'A', stressLevel: 4, primaryDriver: 'drought', populationAffectedM: 10 },
    { region: 'B', stressLevel: 3, primaryDriver: 'overuse', populationAffectedM: 20 },
    { region: 'C', stressLevel: 2, primaryDriver: 'pollution', populationAffectedM: 5 },
    { region: 'D', stressLevel: 0, primaryDriver: 'conflict', populationAffectedM: 3 },
  ];
  assert.equal(countCriticalStress(hotspots), 2);
});

test('countCriticalStress: level 2 is not counted', () => {
  const hotspots: WaterStressHotspot[] = [
    { region: 'A', stressLevel: 2, primaryDriver: 'drought', populationAffectedM: 10 },
    { region: 'B', stressLevel: 1, primaryDriver: 'overuse', populationAffectedM: 5 },
  ];
  assert.equal(countCriticalStress(hotspots), 0);
});

// ── countArmedConflicts ───────────────────────────────────────────────────

test('countArmedConflicts: empty array returns 0', () => {
  assert.equal(countArmedConflicts([]), 0);
});

test('countArmedConflicts: counts armed conflictType', () => {
  const conflicts: TransboundaryConflict[] = [
    { waterBody: 'R1', countries: 'A/B', conflictType: 'armed',      tensionLevel: 'high',     downstreamPopM: 10 },
    { waterBody: 'R2', countries: 'C/D', conflictType: 'diplomatic', tensionLevel: 'medium',   downstreamPopM: 5  },
    { waterBody: 'R3', countries: 'E/F', conflictType: 'economic',   tensionLevel: 'low',      downstreamPopM: 3  },
  ];
  assert.equal(countArmedConflicts(conflicts), 1);
});

test('countArmedConflicts: counts critical tensionLevel even if not armed', () => {
  const conflicts: TransboundaryConflict[] = [
    { waterBody: 'R1', countries: 'A/B', conflictType: 'diplomatic', tensionLevel: 'critical', downstreamPopM: 10 },
    { waterBody: 'R2', countries: 'C/D', conflictType: 'economic',   tensionLevel: 'high',     downstreamPopM: 5  },
  ];
  assert.equal(countArmedConflicts(conflicts), 1);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('STRESS_HOTSPOTS: is a non-empty array', () => {
  assert.ok(Array.isArray(STRESS_HOTSPOTS));
  assert.ok(STRESS_HOTSPOTS.length > 0);
});

test('STRESS_HOTSPOTS: all entries have valid stressLevel (0-4)', () => {
  for (const s of STRESS_HOTSPOTS) {
    assert.ok(s.stressLevel >= 0 && s.stressLevel <= 4);
    assert.ok(s.populationAffectedM > 0);
  }
});

test('STRESS_HOTSPOTS: contains at least one level-4 entry', () => {
  assert.ok(STRESS_HOTSPOTS.some((s) => s.stressLevel === 4));
});

test('TRANSBOUNDARY_CONFLICTS: is a non-empty array', () => {
  assert.ok(Array.isArray(TRANSBOUNDARY_CONFLICTS));
  assert.ok(TRANSBOUNDARY_CONFLICTS.length > 0);
});

test('TRANSBOUNDARY_CONFLICTS: all entries have required fields', () => {
  for (const c of TRANSBOUNDARY_CONFLICTS) {
    assert.ok(c.waterBody.length > 0);
    assert.ok(c.countries.length > 0);
    assert.ok(['diplomatic', 'armed', 'economic'].includes(c.conflictType));
    assert.ok(['low', 'medium', 'high', 'critical'].includes(c.tensionLevel));
    assert.ok(c.downstreamPopM > 0);
  }
});

test('DAM_WATCH: is a non-empty array', () => {
  assert.ok(Array.isArray(DAM_WATCH));
  assert.ok(DAM_WATCH.length > 0);
});

test('DAM_WATCH: all entries have valid severity', () => {
  for (const d of DAM_WATCH) {
    assert.ok(['watch', 'warning', 'critical'].includes(d.severity));
  }
});

test('DAM_WATCH: contains at least one critical entry', () => {
  assert.ok(DAM_WATCH.some((d) => d.severity === 'critical'));
});

test('INFRA_ATTACKS: is a non-empty array', () => {
  assert.ok(Array.isArray(INFRA_ATTACKS));
  assert.ok(INFRA_ATTACKS.length > 0);
});

test('INFRA_ATTACKS: all entries have non-empty impact strings', () => {
  for (const a of INFRA_ATTACKS) {
    assert.ok(a.impact.length > 0);
    assert.ok(['contamination', 'physical destruction', 'cyber'].includes(a.attackType));
  }
});

test('HYDRO_INDEX: is a non-empty array', () => {
  assert.ok(Array.isArray(HYDRO_INDEX));
  assert.ok(HYDRO_INDEX.length > 0);
});

test('HYDRO_INDEX: all entries have risk between 0 and 4', () => {
  for (const r of HYDRO_INDEX) {
    assert.ok(r.risk >= 0 && r.risk <= 4);
  }
});

test('HYDRO_INDEX: contains at least one severe (risk 4) entry', () => {
  assert.ok(HYDRO_INDEX.some((r) => r.risk === 4));
});

test('HYDRO_INDEX: covers 6 regions', () => {
  assert.equal(HYDRO_INDEX.length, 6);
});
