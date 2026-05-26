/**
 * Tests for SpaceSecurityPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/space-security-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  asatEventTypeLabel,
  asatEventTypeColor,
  threatLevelColor,
  threatLevelLabel,
  constellationHealthColor,
  constellationHealthLabel,
  flareClassColor,
  flareClassLabel,
  kpIndexColor,
  payloadTypeColor,
  payloadTypeLabel,
  orbitalRiskColor,
  orbitalRiskLabel,
  countHighThreats,
  countDegradedConstellations,
  countMilitaryLaunches,
  totalDebrisCount,
  ASAT_THREATS,
  CONSTELLATION_STATUS,
  SPACE_WEATHER,
  LAUNCH_ACTIVITY,
  ORBITAL_RISK_INDEX,
  type AsatEventType,
  type ThreatLevel,
  type ConstellationHealth,
  type FlareClass,
  type PayloadType,
  type OrbitalRisk,
  type AsatThreat,
  type ConstellationStatus,
  type LaunchActivity,
} from '../../src/components/space-security-helpers.ts';

// ── asatEventTypeLabel ────────────────────────────────────────────────────

test('asatEventTypeLabel: direct-ascent returns proper label', () => {
  assert.equal(asatEventTypeLabel('direct-ascent'), 'Direct Ascent');
});

test('asatEventTypeLabel: co-orbital returns proper label', () => {
  assert.equal(asatEventTypeLabel('co-orbital'), 'Co-orbital');
});

test('asatEventTypeLabel: cyber returns "Cyber"', () => {
  assert.equal(asatEventTypeLabel('cyber'), 'Cyber');
});

test('asatEventTypeLabel: jamming returns "Jamming"', () => {
  assert.equal(asatEventTypeLabel('jamming'), 'Jamming');
});

test('asatEventTypeLabel: debris-event returns proper label', () => {
  assert.equal(asatEventTypeLabel('debris-event'), 'Debris Event');
});

test('asatEventTypeLabel: all types return non-empty strings', () => {
  const types: AsatEventType[] = ['direct-ascent', 'co-orbital', 'cyber', 'jamming', 'debris-event'];
  for (const t of types) assert.ok(asatEventTypeLabel(t).length > 0);
});

// ── asatEventTypeColor ────────────────────────────────────────────────────

test('asatEventTypeColor: direct-ascent returns red', () => {
  assert.ok(asatEventTypeColor('direct-ascent').includes('#ef4444'));
});

test('asatEventTypeColor: co-orbital returns red', () => {
  assert.ok(asatEventTypeColor('co-orbital').includes('#ef4444'));
});

test('asatEventTypeColor: jamming returns yellow', () => {
  assert.ok(asatEventTypeColor('jamming').includes('#facc15'));
});

test('asatEventTypeColor: cyber returns orange', () => {
  assert.ok(asatEventTypeColor('cyber').includes('#fb923c'));
});

test('asatEventTypeColor: all types return non-empty strings', () => {
  const types: AsatEventType[] = ['direct-ascent', 'co-orbital', 'cyber', 'jamming', 'debris-event'];
  for (const t of types) assert.ok(asatEventTypeColor(t).length > 0);
});

// ── threatLevelColor ──────────────────────────────────────────────────────

test('threatLevelColor: low returns green', () => {
  assert.ok(threatLevelColor('low').includes('#4caf50'));
});

test('threatLevelColor: medium returns yellow', () => {
  assert.ok(threatLevelColor('medium').includes('#facc15'));
});

test('threatLevelColor: high returns orange', () => {
  assert.ok(threatLevelColor('high').includes('#fb923c'));
});

test('threatLevelColor: critical returns red', () => {
  assert.ok(threatLevelColor('critical').includes('#ef4444'));
});

test('threatLevelColor: all levels return non-empty strings', () => {
  const levels: ThreatLevel[] = ['low', 'medium', 'high', 'critical'];
  for (const l of levels) assert.ok(threatLevelColor(l).length > 0);
});

// ── threatLevelLabel ──────────────────────────────────────────────────────

test('threatLevelLabel: critical returns "Critical"', () => {
  assert.equal(threatLevelLabel('critical'), 'Critical');
});

test('threatLevelLabel: low returns "Low"', () => {
  assert.equal(threatLevelLabel('low'), 'Low');
});

// ── constellationHealthColor ──────────────────────────────────────────────

test('constellationHealthColor: nominal returns green', () => {
  assert.ok(constellationHealthColor('nominal').includes('#4caf50'));
});

test('constellationHealthColor: degraded returns yellow', () => {
  assert.ok(constellationHealthColor('degraded').includes('#facc15'));
});

test('constellationHealthColor: impaired returns orange', () => {
  assert.ok(constellationHealthColor('impaired').includes('#fb923c'));
});

test('constellationHealthColor: critical returns red', () => {
  assert.ok(constellationHealthColor('critical').includes('#ef4444'));
});

test('constellationHealthColor: all states return non-empty strings', () => {
  const states: ConstellationHealth[] = ['nominal', 'degraded', 'impaired', 'critical'];
  for (const s of states) assert.ok(constellationHealthColor(s).length > 0);
});

// ── constellationHealthLabel ──────────────────────────────────────────────

test('constellationHealthLabel: nominal returns "Nominal"', () => {
  assert.equal(constellationHealthLabel('nominal'), 'Nominal');
});

test('constellationHealthLabel: impaired returns "Impaired"', () => {
  assert.equal(constellationHealthLabel('impaired'), 'Impaired');
});

// ── flareClassColor ───────────────────────────────────────────────────────

test('flareClassColor: A returns grey', () => {
  assert.ok(flareClassColor('A').includes('#9e9e9e'));
});

test('flareClassColor: X returns red', () => {
  assert.ok(flareClassColor('X').includes('#ef4444'));
});

test('flareClassColor: M returns orange', () => {
  assert.ok(flareClassColor('M').includes('#fb923c'));
});

test('flareClassColor: C returns yellow', () => {
  assert.ok(flareClassColor('C').includes('#facc15'));
});

test('flareClassColor: B returns green', () => {
  assert.ok(flareClassColor('B').includes('#4caf50'));
});

test('flareClassColor: all classes return non-empty strings', () => {
  const classes: FlareClass[] = ['A', 'B', 'C', 'M', 'X'];
  for (const c of classes) assert.ok(flareClassColor(c).length > 0);
});

// ── flareClassLabel ───────────────────────────────────────────────────────

test('flareClassLabel: X includes "extreme"', () => {
  assert.ok(flareClassLabel('X').toLowerCase().includes('extreme'));
});

test('flareClassLabel: A includes "minimal"', () => {
  assert.ok(flareClassLabel('A').toLowerCase().includes('minimal'));
});

// ── kpIndexColor ──────────────────────────────────────────────────────────

test('kpIndexColor: kp >= 8 returns red', () => {
  assert.ok(kpIndexColor(8).includes('#ef4444'));
  assert.ok(kpIndexColor(9).includes('#ef4444'));
});

test('kpIndexColor: kp 6-7 returns orange', () => {
  assert.ok(kpIndexColor(6).includes('#fb923c'));
  assert.ok(kpIndexColor(7).includes('#fb923c'));
});

test('kpIndexColor: kp 4-5 returns yellow', () => {
  assert.ok(kpIndexColor(4).includes('#facc15'));
  assert.ok(kpIndexColor(5).includes('#facc15'));
});

test('kpIndexColor: kp < 4 returns green', () => {
  assert.ok(kpIndexColor(0).includes('#4caf50'));
  assert.ok(kpIndexColor(3).includes('#4caf50'));
});

// ── payloadTypeColor ──────────────────────────────────────────────────────

test('payloadTypeColor: military returns red', () => {
  assert.ok(payloadTypeColor('military').includes('#ef4444'));
});

test('payloadTypeColor: classified returns orange', () => {
  assert.ok(payloadTypeColor('classified').includes('#fb923c'));
});

test('payloadTypeColor: dual-use returns yellow', () => {
  assert.ok(payloadTypeColor('dual-use').includes('#facc15'));
});

test('payloadTypeColor: civilian returns green', () => {
  assert.ok(payloadTypeColor('civilian').includes('#4caf50'));
});

test('payloadTypeColor: all types return non-empty strings', () => {
  const types: PayloadType[] = ['military', 'dual-use', 'civilian', 'classified'];
  for (const t of types) assert.ok(payloadTypeColor(t).length > 0);
});

// ── payloadTypeLabel ──────────────────────────────────────────────────────

test('payloadTypeLabel: military returns "Military"', () => {
  assert.equal(payloadTypeLabel('military'), 'Military');
});

test('payloadTypeLabel: dual-use returns "Dual-Use"', () => {
  assert.equal(payloadTypeLabel('dual-use'), 'Dual-Use');
});

// ── orbitalRiskColor ──────────────────────────────────────────────────────

test('orbitalRiskColor: 0 returns grey', () => {
  assert.ok(orbitalRiskColor(0).includes('#9e9e9e'));
});

test('orbitalRiskColor: 4 returns red', () => {
  assert.ok(orbitalRiskColor(4).includes('#ef4444'));
});

test('orbitalRiskColor: all levels return non-empty strings', () => {
  const risks: OrbitalRisk[] = [0, 1, 2, 3, 4];
  for (const r of risks) assert.ok(orbitalRiskColor(r).length > 0);
});

// ── orbitalRiskLabel ──────────────────────────────────────────────────────

test('orbitalRiskLabel: 0 returns "Minimal"', () => {
  assert.equal(orbitalRiskLabel(0), 'Minimal');
});

test('orbitalRiskLabel: 4 returns "Severe"', () => {
  assert.equal(orbitalRiskLabel(4), 'Severe');
});

// ── countHighThreats ──────────────────────────────────────────────────────

test('countHighThreats: empty array returns 0', () => {
  assert.equal(countHighThreats([]), 0);
});

test('countHighThreats: counts high + critical', () => {
  const threats: AsatThreat[] = [
    { actor: 'A', eventType: 'direct-ascent', altitudeKm: 500, debrisCount: 100, threatLevel: 'critical', description: '' },
    { actor: 'B', eventType: 'jamming',       altitudeKm: 0,   debrisCount: 0,   threatLevel: 'high',     description: '' },
    { actor: 'C', eventType: 'cyber',         altitudeKm: 0,   debrisCount: 0,   threatLevel: 'medium',   description: '' },
    { actor: 'D', eventType: 'debris-event',  altitudeKm: 800, debrisCount: 200, threatLevel: 'low',      description: '' },
  ];
  assert.equal(countHighThreats(threats), 2);
});

test('countHighThreats: low/medium not counted', () => {
  const threats: AsatThreat[] = [
    { actor: 'A', eventType: 'cyber',   altitudeKm: 0, debrisCount: 0, threatLevel: 'low',    description: '' },
    { actor: 'B', eventType: 'jamming', altitudeKm: 0, debrisCount: 0, threatLevel: 'medium', description: '' },
  ];
  assert.equal(countHighThreats(threats), 0);
});

// ── countDegradedConstellations ───────────────────────────────────────────

test('countDegradedConstellations: empty array returns 0', () => {
  assert.equal(countDegradedConstellations([]), 0);
});

test('countDegradedConstellations: counts degraded + impaired + critical', () => {
  const constellations: ConstellationStatus[] = [
    { name: 'A', operator: 'x', activeSats: 10, degradedCount: 1, anomaly: '', health: 'degraded' },
    { name: 'B', operator: 'x', activeSats: 10, degradedCount: 2, anomaly: '', health: 'impaired' },
    { name: 'C', operator: 'x', activeSats: 10, degradedCount: 3, anomaly: '', health: 'critical' },
    { name: 'D', operator: 'x', activeSats: 10, degradedCount: 0, anomaly: '', health: 'nominal'  },
  ];
  assert.equal(countDegradedConstellations(constellations), 3);
});

// ── countMilitaryLaunches ─────────────────────────────────────────────────

test('countMilitaryLaunches: empty array returns 0', () => {
  assert.equal(countMilitaryLaunches([]), 0);
});

test('countMilitaryLaunches: counts military + classified', () => {
  const launches: LaunchActivity[] = [
    { nation: 'A', payloadType: 'military',   orbit: 'LEO', notableAspect: '' },
    { nation: 'B', payloadType: 'classified', orbit: 'GEO', notableAspect: '' },
    { nation: 'C', payloadType: 'dual-use',   orbit: 'MEO', notableAspect: '' },
    { nation: 'D', payloadType: 'civilian',   orbit: 'LEO', notableAspect: '' },
  ];
  assert.equal(countMilitaryLaunches(launches), 2);
});

// ── totalDebrisCount ──────────────────────────────────────────────────────

test('totalDebrisCount: empty array returns 0', () => {
  assert.equal(totalDebrisCount([]), 0);
});

test('totalDebrisCount: sums all debris', () => {
  const threats: AsatThreat[] = [
    { actor: 'A', eventType: 'direct-ascent', altitudeKm: 500, debrisCount: 1500, threatLevel: 'critical', description: '' },
    { actor: 'B', eventType: 'direct-ascent', altitudeKm: 865, debrisCount: 3000, threatLevel: 'critical', description: '' },
  ];
  assert.equal(totalDebrisCount(threats), 4500);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('ASAT_THREATS: is a non-empty array', () => {
  assert.ok(Array.isArray(ASAT_THREATS));
  assert.ok(ASAT_THREATS.length > 0);
});

test('ASAT_THREATS: all entries have valid fields', () => {
  for (const t of ASAT_THREATS) {
    assert.ok(t.actor.length > 0);
    assert.ok(['direct-ascent', 'co-orbital', 'cyber', 'jamming', 'debris-event'].includes(t.eventType));
    assert.ok(['low', 'medium', 'high', 'critical'].includes(t.threatLevel));
    assert.ok(t.altitudeKm >= 0);
    assert.ok(t.debrisCount >= 0);
    assert.ok(t.description.length > 0);
  }
});

test('ASAT_THREATS: contains at least one critical entry', () => {
  assert.ok(ASAT_THREATS.some((t) => t.threatLevel === 'critical'));
});

test('CONSTELLATION_STATUS: is a non-empty array', () => {
  assert.ok(Array.isArray(CONSTELLATION_STATUS));
  assert.ok(CONSTELLATION_STATUS.length > 0);
});

test('CONSTELLATION_STATUS: all entries have valid health and non-empty fields', () => {
  for (const c of CONSTELLATION_STATUS) {
    assert.ok(c.name.length > 0);
    assert.ok(c.operator.length > 0);
    assert.ok(['nominal', 'degraded', 'impaired', 'critical'].includes(c.health));
    assert.ok(c.activeSats > 0);
    assert.ok(c.degradedCount >= 0);
  }
});

test('CONSTELLATION_STATUS: contains GPS and Starlink', () => {
  const names = CONSTELLATION_STATUS.map((c) => c.name);
  assert.ok(names.includes('GPS (NAVSTAR)'));
  assert.ok(names.includes('Starlink'));
});

test('SPACE_WEATHER: is a non-empty array', () => {
  assert.ok(Array.isArray(SPACE_WEATHER));
  assert.ok(SPACE_WEATHER.length > 0);
});

test('SPACE_WEATHER: all entries have non-empty required fields', () => {
  for (const w of SPACE_WEATHER) {
    assert.ok(w.parameter.length > 0);
    assert.ok(w.currentValue.length > 0);
    assert.ok(w.affectedSystems.length > 0);
    assert.ok(w.forecast.length > 0);
  }
});

test('LAUNCH_ACTIVITY: is a non-empty array', () => {
  assert.ok(Array.isArray(LAUNCH_ACTIVITY));
  assert.ok(LAUNCH_ACTIVITY.length > 0);
});

test('LAUNCH_ACTIVITY: all entries have valid payload types', () => {
  for (const l of LAUNCH_ACTIVITY) {
    assert.ok(['military', 'dual-use', 'civilian', 'classified'].includes(l.payloadType));
    assert.ok(l.nation.length > 0);
    assert.ok(['LEO', 'MEO', 'GEO', 'HEO', 'Cislunar'].includes(l.orbit));
    assert.ok(l.notableAspect.length > 0);
  }
});

test('LAUNCH_ACTIVITY: contains at least one military payload', () => {
  assert.ok(LAUNCH_ACTIVITY.some((l) => l.payloadType === 'military'));
});

test('ORBITAL_RISK_INDEX: is a non-empty array', () => {
  assert.ok(Array.isArray(ORBITAL_RISK_INDEX));
  assert.ok(ORBITAL_RISK_INDEX.length > 0);
});

test('ORBITAL_RISK_INDEX: all entries have risk between 0 and 4', () => {
  for (const d of ORBITAL_RISK_INDEX) {
    assert.ok(d.risk >= 0 && d.risk <= 4);
    assert.ok(['LEO', 'MEO', 'GEO', 'HEO', 'Cislunar'].includes(d.regime));
  }
});

test('ORBITAL_RISK_INDEX: covers all 5 orbit regimes', () => {
  assert.equal(ORBITAL_RISK_INDEX.length, 5);
  const regimes = ORBITAL_RISK_INDEX.map((d) => d.regime);
  assert.ok(regimes.includes('LEO'));
  assert.ok(regimes.includes('GEO'));
  assert.ok(regimes.includes('Cislunar'));
});

test('ORBITAL_RISK_INDEX: LEO has highest risk (4)', () => {
  const leo = ORBITAL_RISK_INDEX.find((d) => d.regime === 'LEO');
  assert.equal(leo?.risk, 4);
});
