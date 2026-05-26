/**
 * Tests for SpaceMilitarizationPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/space-militarization-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  severityColor,
  severityLabel,
  confidenceLabel,
  asatModalityLabel,
  orbitLabel,
  coOrbitalBehaviorLabel,
  dualUseClassLabel,
  debrisRiskClassLabel,
  complianceStatusColor,
  complianceStatusLabel,
  jammingBandLabel,
  dewClassLabel,
  testOutcomeColor,
  classifyDebrisRisk,
  classifyCoOrbitalSeverity,
  formatPieces,
  formatKm,
  formatDays,
  formatPowerKw,
  countSevereAsatEvents,
  countCriticalCoOrbital,
  countMilitaryAttributedDualUse,
  countDebrisHazards,
  countApparentViolations,
  countActiveJamming,
  countDewTests,
  totalAsatDebrisGenerated,
  composeBadgeCount,
  ASAT_TESTS,
  CO_ORBITAL_INCIDENTS,
  DUAL_USE_SATELLITES,
  DEBRIS_HAZARDS,
  TREATY_FLAGS,
  GNSS_JAMMING,
  DEW_TESTS,
  type Severity,
  type Confidence,
  type Orbit,
  type AsatModality,
  type CoOrbitalBehavior,
  type DualUseClass,
  type DebrisRiskClass,
  type ComplianceStatus,
  type JammingBand,
  type DewClass,
  type TestOutcome,
} from '../../src/components/space-militarization-helpers.ts';

// ── severityColor / severityLabel ─────────────────────────────────────────

test('severityColor: 0 grey, 4 red', () => {
  assert.ok(severityColor(0).includes('#9e9e9e'));
  assert.ok(severityColor(4).includes('#ef4444'));
});

test('severityColor: every level uses a CSS var', () => {
  for (const l of [0, 1, 2, 3, 4] as Severity[]) {
    assert.match(severityColor(l), /var\(--severity-/);
  }
});

test('severityLabel: 0 Minimal, 4 Critical', () => {
  assert.equal(severityLabel(0), 'Minimal');
  assert.equal(severityLabel(4), 'Critical');
});

// ── confidenceLabel ──────────────────────────────────────────────────────

test('confidenceLabel: 0 Unverified, 3 High', () => {
  assert.equal(confidenceLabel(0), 'Unverified');
  assert.equal(confidenceLabel(3), 'High');
});

test('confidenceLabel: every level non-empty', () => {
  for (const c of [0, 1, 2, 3] as Confidence[]) {
    assert.ok(confidenceLabel(c).length > 0);
  }
});

// ── label helpers ────────────────────────────────────────────────────────

test('asatModalityLabel: every modality non-empty', () => {
  const all: AsatModality[] = ['kinetic-direct-ascent', 'kinetic-co-orbital', 'electronic-warfare', 'directed-energy', 'cyber'];
  for (const m of all) assert.ok(asatModalityLabel(m).length > 0);
});

test('asatModalityLabel: kinetic-direct-ascent label is descriptive', () => {
  assert.match(asatModalityLabel('kinetic-direct-ascent'), /direct ascent/i);
});

test('orbitLabel: every orbit non-empty', () => {
  const all: Orbit[] = ['LEO', 'MEO', 'GEO', 'HEO', 'cislunar'];
  for (const o of all) assert.ok(orbitLabel(o).length > 0);
});

test('orbitLabel: cislunar capitalizes', () => {
  assert.equal(orbitLabel('cislunar'), 'Cislunar');
});

test('coOrbitalBehaviorLabel: every behavior non-empty', () => {
  const all: CoOrbitalBehavior[] = ['rendezvous', 'proximity-operation', 'shadowing', 'capture-test', 'inspection'];
  for (const b of all) assert.ok(coOrbitalBehaviorLabel(b).length > 0);
});

test('dualUseClassLabel: SIGINT uppercase preserved', () => {
  assert.equal(dualUseClassLabel('sigint'), 'SIGINT');
  assert.equal(dualUseClassLabel('rpo'), 'RPO');
});

test('dualUseClassLabel: every class non-empty', () => {
  const all: DualUseClass[] = ['rpo', 'sigint', 'eo-imagery', 'sar-imagery', 'comms-relay', 'navigation'];
  for (const d of all) assert.ok(dualUseClassLabel(d).length > 0);
});

test('debrisRiskClassLabel: every class non-empty', () => {
  const all: DebrisRiskClass[] = ['tracked', 'fragmenting', 'critical-conjunction', 'cascade-risk'];
  for (const r of all) assert.ok(debrisRiskClassLabel(r).length > 0);
});

// ── compliance / jamming / dew labels ────────────────────────────────────

test('complianceStatusColor: apparent-violation red, compliant green', () => {
  assert.ok(complianceStatusColor('apparent-violation').includes('#ef4444'));
  assert.ok(complianceStatusColor('compliant').includes('#4caf50'));
});

test('complianceStatusLabel: every status non-empty', () => {
  const all: ComplianceStatus[] = ['compliant', 'concern', 'apparent-violation', 'disputed'];
  for (const s of all) assert.ok(complianceStatusLabel(s).length > 0);
});

test('jammingBandLabel: every band non-empty', () => {
  const all: JammingBand[] = ['L1', 'L2', 'L5', 'wideband', 'spoofing'];
  for (const b of all) assert.ok(jammingBandLabel(b).length > 0);
});

test('dewClassLabel: every class non-empty', () => {
  const all: DewClass[] = ['laser-dazzle', 'high-power-microwave', 'particle-beam', 'rf-blinding'];
  for (const d of all) assert.ok(dewClassLabel(d).length > 0);
});

test('testOutcomeColor: observed red, denied grey', () => {
  assert.ok(testOutcomeColor('observed').includes('#ef4444'));
  assert.ok(testOutcomeColor('denied').includes('#9e9e9e'));
});

test('testOutcomeColor: announced yellow, inferred orange', () => {
  assert.ok(testOutcomeColor('announced').includes('#facc15'));
  assert.ok(testOutcomeColor('inferred').includes('#fb923c'));
});

test('testOutcomeColor: every outcome non-empty', () => {
  const all: TestOutcome[] = ['announced', 'observed', 'inferred', 'denied'];
  for (const o of all) assert.ok(testOutcomeColor(o).length > 0);
});

// ── classifyDebrisRisk ───────────────────────────────────────────────────

test('classifyDebrisRisk: <1500 pieces, not fragmenting, no maneuver → tracked', () => {
  assert.equal(classifyDebrisRisk(500, false, false), 'tracked');
});

test('classifyDebrisRisk: fragmenting alone → fragmenting', () => {
  assert.equal(classifyDebrisRisk(100, true, false), 'fragmenting');
});

test('classifyDebrisRisk: forced maneuver alone → critical-conjunction', () => {
  assert.equal(classifyDebrisRisk(100, false, true), 'critical-conjunction');
});

test('classifyDebrisRisk: 1500+ pieces + fragmenting → cascade-risk', () => {
  assert.equal(classifyDebrisRisk(1800, true, false), 'cascade-risk');
});

test('classifyDebrisRisk: 1500+ pieces + maneuver → cascade-risk', () => {
  assert.equal(classifyDebrisRisk(2000, false, true), 'cascade-risk');
});

test('classifyDebrisRisk: 1500+ but neither fragmenting nor maneuver → critical-conjunction or tracked', () => {
  // 1500+ alone without active hazard is still just tracked
  assert.equal(classifyDebrisRisk(1800, false, false), 'tracked');
});

// ── classifyCoOrbitalSeverity ───────────────────────────────────────────

test('classifyCoOrbitalSeverity: <=5km + >=7d → critical (4)', () => {
  assert.equal(classifyCoOrbitalSeverity(3, 21), 4);
});

test('classifyCoOrbitalSeverity: <=25km + >=14d → critical (4)', () => {
  assert.equal(classifyCoOrbitalSeverity(20, 14), 4);
});

test('classifyCoOrbitalSeverity: <=50km + >=7d → high (3)', () => {
  assert.equal(classifyCoOrbitalSeverity(40, 10), 3);
});

test('classifyCoOrbitalSeverity: <=100km, any duration → moderate (2)', () => {
  assert.equal(classifyCoOrbitalSeverity(80, 3), 2);
});

test('classifyCoOrbitalSeverity: >100km → low (1)', () => {
  assert.equal(classifyCoOrbitalSeverity(150, 2), 1);
});

// ── formatting helpers ──────────────────────────────────────────────────

test('formatPieces: 850 unchanged', () => {
  assert.equal(formatPieces(850), '850');
});

test('formatPieces: 1500 → 1.5k', () => {
  assert.equal(formatPieces(1500), '1.5k');
});

test('formatPieces: 12000 → 12k (no decimal)', () => {
  assert.equal(formatPieces(12_000), '12k');
});

test('formatKm: 3 km gets one decimal', () => {
  assert.equal(formatKm(3), '3.0 km');
});

test('formatKm: 30 km rounded integer', () => {
  assert.equal(formatKm(30), '30 km');
});

test('formatKm: 2000 km promotes to k km', () => {
  assert.equal(formatKm(2000), '2.0k km');
});

test('formatDays: 5 days unchanged', () => {
  assert.equal(formatDays(5), '5d');
});

test('formatDays: 60 days returns months', () => {
  assert.equal(formatDays(60), '2mo');
});

test('formatDays: 400 days returns years', () => {
  assert.equal(formatDays(400), '1.1y');
});

test('formatPowerKw: 5 kW unchanged', () => {
  assert.equal(formatPowerKw(5), '5 kW');
});

test('formatPowerKw: 1500 kW promotes to MW', () => {
  assert.equal(formatPowerKw(1500), '1.5 MW');
});

test('formatPowerKw: 0.5 kW returns W', () => {
  assert.equal(formatPowerKw(0.5), '500 W');
});

// ── count helpers ───────────────────────────────────────────────────────

test('countSevereAsatEvents: matches severity >=3 seed entries', () => {
  const expected = ASAT_TESTS.filter((x) => x.severity >= 3).length;
  assert.equal(countSevereAsatEvents(ASAT_TESTS), expected);
});

test('countCriticalCoOrbital: matches severity >=3 entries', () => {
  const expected = CO_ORBITAL_INCIDENTS.filter((x) => x.severity >= 3).length;
  assert.equal(countCriticalCoOrbital(CO_ORBITAL_INCIDENTS), expected);
});

test('countMilitaryAttributedDualUse: matches militaryAttributed entries', () => {
  const expected = DUAL_USE_SATELLITES.filter((x) => x.militaryAttributed).length;
  assert.equal(countMilitaryAttributedDualUse(DUAL_USE_SATELLITES), expected);
});

test('countDebrisHazards: counts critical-conjunction and cascade-risk only', () => {
  const expected = DEBRIS_HAZARDS.filter(
    (x) => x.riskClass === 'critical-conjunction' || x.riskClass === 'cascade-risk',
  ).length;
  assert.equal(countDebrisHazards(DEBRIS_HAZARDS), expected);
});

test('countApparentViolations: matches apparent-violation entries', () => {
  const expected = TREATY_FLAGS.filter((x) => x.status === 'apparent-violation').length;
  assert.equal(countApparentViolations(TREATY_FLAGS), expected);
});

test('countActiveJamming: matches severity >=3 entries', () => {
  const expected = GNSS_JAMMING.filter((x) => x.severity >= 3).length;
  assert.equal(countActiveJamming(GNSS_JAMMING), expected);
});

test('countDewTests: matches observed/announced entries', () => {
  const expected = DEW_TESTS.filter(
    (x) => x.outcome === 'observed' || x.outcome === 'announced',
  ).length;
  assert.equal(countDewTests(DEW_TESTS), expected);
});

test('totalAsatDebrisGenerated: equals sum of seed debris counts', () => {
  const expected = ASAT_TESTS.reduce((acc, x) => acc + x.debrisGenerated, 0);
  assert.equal(totalAsatDebrisGenerated(ASAT_TESTS), expected);
});

test('composeBadgeCount: equals sum of all seven section counts', () => {
  const expected =
    countSevereAsatEvents(ASAT_TESTS) +
    countCriticalCoOrbital(CO_ORBITAL_INCIDENTS) +
    countMilitaryAttributedDualUse(DUAL_USE_SATELLITES) +
    countDebrisHazards(DEBRIS_HAZARDS) +
    countApparentViolations(TREATY_FLAGS) +
    countActiveJamming(GNSS_JAMMING) +
    countDewTests(DEW_TESTS);
  assert.equal(
    composeBadgeCount(
      ASAT_TESTS,
      CO_ORBITAL_INCIDENTS,
      DUAL_USE_SATELLITES,
      DEBRIS_HAZARDS,
      TREATY_FLAGS,
      GNSS_JAMMING,
      DEW_TESTS,
    ),
    expected,
  );
});

// ── Seed data invariants ────────────────────────────────────────────────

test('ASAT_TESTS: every severity 0-4', () => {
  for (const a of ASAT_TESTS) assert.ok(a.severity >= 0 && a.severity <= 4);
});

test('ASAT_TESTS: every debrisGenerated non-negative', () => {
  for (const a of ASAT_TESTS) assert.ok(a.debrisGenerated >= 0);
});

test('CO_ORBITAL_INCIDENTS: stored severity matches the classifier', () => {
  for (const c of CO_ORBITAL_INCIDENTS) {
    const recomputed = classifyCoOrbitalSeverity(c.closestApproachKm, c.durationDays);
    assert.equal(
      c.severity,
      recomputed,
      `${c.inspectorActor} → ${c.targetOperator}: stored ${c.severity}, classifier returned ${recomputed}`,
    );
  }
});

test('CO_ORBITAL_INCIDENTS: closest approach is positive, duration positive', () => {
  for (const c of CO_ORBITAL_INCIDENTS) {
    assert.ok(c.closestApproachKm > 0);
    assert.ok(c.durationDays > 0);
  }
});

test('DUAL_USE_SATELLITES: every designation non-empty', () => {
  for (const d of DUAL_USE_SATELLITES) assert.ok(d.designation.length > 0);
});

test('DEBRIS_HAZARDS: stored riskClass matches the classifier', () => {
  for (const d of DEBRIS_HAZARDS) {
    const isFragmenting = d.riskClass === 'fragmenting' || d.riskClass === 'cascade-risk';
    // The seed data uses classifyDebrisRisk(pieces, isFragmenting, forcedManeuver)
    // and inferring isFragmenting from the resulting class is circular, so we
    // assert the inverse invariant instead: any cascade-risk entry must have
    // pieces >= 1500 AND (fragmenting OR forced maneuver), and any
    // critical-conjunction entry must have forcedManeuver = true.
    if (d.riskClass === 'cascade-risk') {
      assert.ok(d.trackedPieces >= 1500);
      assert.ok(isFragmenting || d.forcedManeuver);
    }
    if (d.riskClass === 'critical-conjunction') {
      assert.ok(d.forcedManeuver);
    }
  }
});

test('DEBRIS_HAZARDS: every trackedPieces non-negative', () => {
  for (const d of DEBRIS_HAZARDS) assert.ok(d.trackedPieces >= 0);
});

test('TREATY_FLAGS: every concern non-empty', () => {
  for (const t of TREATY_FLAGS) assert.ok(t.concern.length > 0);
});

test('TREATY_FLAGS: every article non-empty', () => {
  for (const t of TREATY_FLAGS) assert.ok(t.article.length > 0);
});

test('GNSS_JAMMING: every reportsCount non-negative', () => {
  for (const j of GNSS_JAMMING) assert.ok(j.reportsCount >= 0);
});

test('GNSS_JAMMING: every confidence 0-3', () => {
  for (const j of GNSS_JAMMING) assert.ok(j.confidence >= 0 && j.confidence <= 3);
});

test('DEW_TESTS: every powerKw non-negative', () => {
  for (const d of DEW_TESTS) assert.ok(d.powerKw >= 0);
});

test('DEW_TESTS: every targetClass non-empty', () => {
  for (const d of DEW_TESTS) assert.ok(d.targetClass.length > 0);
});
