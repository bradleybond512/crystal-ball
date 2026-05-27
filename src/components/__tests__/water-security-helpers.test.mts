import assert from 'node:assert/strict';
import test from 'node:test';

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
  type WaterDriver,
  type ConflictType,
  type TensionLevel,
  type DamType,
  type DamSeverity,
  type AttackType,
  type HydroRisk,
  type WaterStressHotspot,
  type TransboundaryConflict,
  type DamWatch,
  type InfraAttack,
  type HydroRegion,
} from '../water-security-helpers.ts';

// ── stressColor ─────────────────────────────────────────────────────────────

test('stressColor returns a non-empty string for every StressLevel', () => {
  const levels: StressLevel[] = [0, 1, 2, 3, 4];
  for (const l of levels) {
    const c = stressColor(l);
    assert.ok(c.length > 0, `stressColor(${l}) should be non-empty`);
  }
});

test('stressColor(0) is grey / none variant', () => {
  assert.ok(stressColor(0).includes('9e9e9e') || stressColor(0).includes('none'));
});

test('stressColor(4) is red / critical variant', () => {
  assert.ok(stressColor(4).includes('ef4444') || stressColor(4).includes('critical'));
});

test('stressColor values are all distinct', () => {
  const levels: StressLevel[] = [0, 1, 2, 3, 4];
  const values = levels.map(stressColor);
  const unique = new Set(values);
  assert.equal(unique.size, 5);
});

// ── stressLabel ─────────────────────────────────────────────────────────────

test('stressLabel returns a non-empty string for every StressLevel', () => {
  const levels: StressLevel[] = [0, 1, 2, 3, 4];
  for (const l of levels) {
    assert.ok(stressLabel(l).length > 0, `stressLabel(${l}) should be non-empty`);
  }
});

test('stressLabel(0) is Low', () => {
  assert.equal(stressLabel(0), 'Low');
});

test('stressLabel(4) is Extremely High', () => {
  assert.equal(stressLabel(4), 'Extremely High');
});

test('stressLabel values are all distinct', () => {
  const levels: StressLevel[] = [0, 1, 2, 3, 4];
  const values = levels.map(stressLabel);
  const unique = new Set(values);
  assert.equal(unique.size, 5);
});

// ── driverLabel ─────────────────────────────────────────────────────────────

test('driverLabel covers every WaterDriver', () => {
  const drivers: WaterDriver[] = ['overuse', 'drought', 'pollution', 'conflict'];
  for (const d of drivers) {
    assert.ok(driverLabel(d).length > 0, `driverLabel(${d}) should be non-empty`);
  }
});

test('driverLabel returns capitalized strings', () => {
  const drivers: WaterDriver[] = ['overuse', 'drought', 'pollution', 'conflict'];
  for (const d of drivers) {
    const label = driverLabel(d);
    assert.equal(label[0], label[0].toUpperCase(), `${label} should be capitalized`);
  }
});

// ── conflictTypeLabel ────────────────────────────────────────────────────────

test('conflictTypeLabel covers every ConflictType', () => {
  const types: ConflictType[] = ['diplomatic', 'armed', 'economic'];
  for (const t of types) {
    assert.ok(conflictTypeLabel(t).length > 0, `conflictTypeLabel(${t}) should be non-empty`);
  }
});

test('conflictTypeLabel returns distinct values', () => {
  const types: ConflictType[] = ['diplomatic', 'armed', 'economic'];
  const values = types.map(conflictTypeLabel);
  assert.equal(new Set(values).size, 3);
});

// ── tensionColor ─────────────────────────────────────────────────────────────

test('tensionColor covers every TensionLevel', () => {
  const levels: TensionLevel[] = ['low', 'medium', 'high', 'critical'];
  for (const l of levels) {
    assert.ok(tensionColor(l).length > 0, `tensionColor(${l}) should be non-empty`);
  }
});

test('tensionColor(critical) is red variant', () => {
  assert.ok(tensionColor('critical').includes('ef4444') || tensionColor('critical').includes('critical'));
});

test('tensionColor(low) is green variant', () => {
  assert.ok(tensionColor('low').includes('4caf50') || tensionColor('low').includes('low'));
});

test('tensionColor values are all distinct', () => {
  const levels: TensionLevel[] = ['low', 'medium', 'high', 'critical'];
  const values = levels.map(tensionColor);
  assert.equal(new Set(values).size, 4);
});

// ── damTypeLabel ─────────────────────────────────────────────────────────────

test('damTypeLabel covers every DamType', () => {
  const types: DamType[] = ['structural concern', 'low storage', 'weaponization risk'];
  for (const t of types) {
    assert.ok(damTypeLabel(t).length > 0, `damTypeLabel(${t}) should be non-empty`);
  }
});

test('damTypeLabel(weaponization risk) includes Weaponization', () => {
  assert.ok(damTypeLabel('weaponization risk').includes('Weaponization'));
});

// ── damSeverityColor ─────────────────────────────────────────────────────────

test('damSeverityColor covers every DamSeverity', () => {
  const severities: DamSeverity[] = ['watch', 'warning', 'critical'];
  for (const s of severities) {
    assert.ok(damSeverityColor(s).length > 0, `damSeverityColor(${s}) should be non-empty`);
  }
});

test('damSeverityColor(critical) is red variant', () => {
  assert.ok(damSeverityColor('critical').includes('ef4444') || damSeverityColor('critical').includes('critical'));
});

test('damSeverityColor values are all distinct', () => {
  const severities: DamSeverity[] = ['watch', 'warning', 'critical'];
  const values = severities.map(damSeverityColor);
  assert.equal(new Set(values).size, 3);
});

// ── attackTypeLabel ───────────────────────────────────────────────────────────

test('attackTypeLabel covers every AttackType', () => {
  const types: AttackType[] = ['contamination', 'physical destruction', 'cyber'];
  for (const t of types) {
    assert.ok(attackTypeLabel(t).length > 0, `attackTypeLabel(${t}) should be non-empty`);
  }
});

test('attackTypeLabel returns distinct values', () => {
  const types: AttackType[] = ['contamination', 'physical destruction', 'cyber'];
  const values = types.map(attackTypeLabel);
  assert.equal(new Set(values).size, 3);
});

// ── attackTypeColor ───────────────────────────────────────────────────────────

test('attackTypeColor covers every AttackType', () => {
  const types: AttackType[] = ['contamination', 'physical destruction', 'cyber'];
  for (const t of types) {
    assert.ok(attackTypeColor(t).length > 0, `attackTypeColor(${t}) should be non-empty`);
  }
});

test('attackTypeColor(physical destruction) is red variant', () => {
  assert.ok(attackTypeColor('physical destruction').includes('ef4444') || attackTypeColor('physical destruction').includes('critical'));
});

// ── hydroRiskColor ────────────────────────────────────────────────────────────

test('hydroRiskColor covers every HydroRisk level', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) {
    assert.ok(hydroRiskColor(r).length > 0, `hydroRiskColor(${r}) should be non-empty`);
  }
});

test('hydroRiskColor(4) is red variant', () => {
  assert.ok(hydroRiskColor(4).includes('ef4444') || hydroRiskColor(4).includes('critical'));
});

test('hydroRiskColor values are all distinct', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  const values = risks.map(hydroRiskColor);
  assert.equal(new Set(values).size, 5);
});

// ── hydroRiskLabel ────────────────────────────────────────────────────────────

test('hydroRiskLabel covers every HydroRisk level', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) {
    assert.ok(hydroRiskLabel(r).length > 0, `hydroRiskLabel(${r}) should be non-empty`);
  }
});

test('hydroRiskLabel(0) is Minimal', () => {
  assert.equal(hydroRiskLabel(0), 'Minimal');
});

test('hydroRiskLabel(4) is Severe', () => {
  assert.equal(hydroRiskLabel(4), 'Severe');
});

test('hydroRiskLabel values are all distinct', () => {
  const risks: HydroRisk[] = [0, 1, 2, 3, 4];
  const values = risks.map(hydroRiskLabel);
  assert.equal(new Set(values).size, 5);
});

// ── formatPopM ────────────────────────────────────────────────────────────────

test('formatPopM formats >=100 as integer with M suffix', () => {
  assert.equal(formatPopM(180), '180M');
  assert.equal(formatPopM(100), '100M');
});

test('formatPopM formats 10-99 with no decimal', () => {
  assert.equal(formatPopM(40), '40M');
  assert.equal(formatPopM(60), '60M');
});

test('formatPopM formats <10 with one decimal', () => {
  assert.equal(formatPopM(1.5), '1.5M');
  assert.equal(formatPopM(8), '8.0M');
});

test('formatPopM always ends in M', () => {
  [0.5, 5, 50, 500].forEach((n) => {
    assert.ok(formatPopM(n).endsWith('M'), `formatPopM(${n}) should end with M`);
  });
});

// ── countCriticalStress ────────────────────────────────────────────────────────

test('countCriticalStress returns 0 for empty array', () => {
  assert.equal(countCriticalStress([]), 0);
});

test('countCriticalStress counts stressLevel >= 3', () => {
  const hotspots: WaterStressHotspot[] = [
    { region: 'A', stressLevel: 2, primaryDriver: 'drought', populationAffectedM: 10 },
    { region: 'B', stressLevel: 3, primaryDriver: 'overuse', populationAffectedM: 20 },
    { region: 'C', stressLevel: 4, primaryDriver: 'conflict', populationAffectedM: 30 },
  ];
  assert.equal(countCriticalStress(hotspots), 2);
});

test('countCriticalStress excludes stressLevel < 3', () => {
  const hotspots: WaterStressHotspot[] = [
    { region: 'A', stressLevel: 0, primaryDriver: 'drought', populationAffectedM: 10 },
    { region: 'B', stressLevel: 1, primaryDriver: 'overuse', populationAffectedM: 20 },
    { region: 'C', stressLevel: 2, primaryDriver: 'pollution', populationAffectedM: 5 },
  ];
  assert.equal(countCriticalStress(hotspots), 0);
});

test('countCriticalStress on STRESS_HOTSPOTS static data returns >= 2', () => {
  assert.ok(countCriticalStress(STRESS_HOTSPOTS) >= 2);
});

// ── countArmedConflicts ────────────────────────────────────────────────────────

test('countArmedConflicts returns 0 for empty array', () => {
  assert.equal(countArmedConflicts([]), 0);
});

test('countArmedConflicts counts armed conflictType', () => {
  const conflicts: TransboundaryConflict[] = [
    { waterBody: 'A', countries: 'X/Y', conflictType: 'armed',      tensionLevel: 'high',   downstreamPopM: 10 },
    { waterBody: 'B', countries: 'X/Z', conflictType: 'diplomatic', tensionLevel: 'low',    downstreamPopM: 5  },
  ];
  assert.equal(countArmedConflicts(conflicts), 1);
});

test('countArmedConflicts counts critical tensionLevel regardless of conflictType', () => {
  const conflicts: TransboundaryConflict[] = [
    { waterBody: 'A', countries: 'X/Y', conflictType: 'diplomatic', tensionLevel: 'critical', downstreamPopM: 10 },
    { waterBody: 'B', countries: 'X/Z', conflictType: 'economic',   tensionLevel: 'medium',   downstreamPopM: 5  },
  ];
  assert.equal(countArmedConflicts(conflicts), 1);
});

test('countArmedConflicts on TRANSBOUNDARY_CONFLICTS static data returns >= 2', () => {
  assert.ok(countArmedConflicts(TRANSBOUNDARY_CONFLICTS) >= 2);
});

// ── Static data integrity ─────────────────────────────────────────────────────

test('STRESS_HOTSPOTS has at least 5 entries', () => {
  assert.ok(STRESS_HOTSPOTS.length >= 5);
});

test('STRESS_HOTSPOTS entries have valid stressLevel 0-4', () => {
  for (const h of STRESS_HOTSPOTS) {
    assert.ok(h.stressLevel >= 0 && h.stressLevel <= 4, `stressLevel ${h.stressLevel} out of range`);
  }
});

test('STRESS_HOTSPOTS entries have positive populationAffectedM', () => {
  for (const h of STRESS_HOTSPOTS) {
    assert.ok(h.populationAffectedM > 0, `${h.region} has non-positive population`);
  }
});

test('TRANSBOUNDARY_CONFLICTS has at least 4 entries', () => {
  assert.ok(TRANSBOUNDARY_CONFLICTS.length >= 4);
});

test('TRANSBOUNDARY_CONFLICTS entries have non-empty waterBody', () => {
  for (const c of TRANSBOUNDARY_CONFLICTS) {
    assert.ok(c.waterBody.length > 0, 'waterBody should be non-empty');
  }
});

test('DAM_WATCH has at least 4 entries', () => {
  assert.ok(DAM_WATCH.length >= 4);
});

test('DAM_WATCH entries have non-empty facility and country', () => {
  for (const d of DAM_WATCH) {
    assert.ok(d.facility.length > 0, 'facility should be non-empty');
    assert.ok(d.country.length > 0, 'country should be non-empty');
  }
});

test('INFRA_ATTACKS has at least 3 entries', () => {
  assert.ok(INFRA_ATTACKS.length >= 3);
});

test('INFRA_ATTACKS entries have non-empty impact', () => {
  for (const a of INFRA_ATTACKS) {
    assert.ok(a.impact.length > 0, 'impact should be non-empty');
  }
});

test('HYDRO_INDEX has at least 4 entries', () => {
  assert.ok(HYDRO_INDEX.length >= 4);
});

test('HYDRO_INDEX risk values are all 0-4', () => {
  for (const h of HYDRO_INDEX) {
    assert.ok(h.risk >= 0 && h.risk <= 4, `risk ${h.risk} out of range`);
  }
});
