/**
 * Tests for OrganizedCrimeSuperpowerPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/organized-crime-superpower-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All helpers are exported from the
 * helpers module for testability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityColor,
  activityLabel,
  enterpriseLabel,
  seizureTrendArrow,
  seizureTrendColor,
  interdictionLabel,
  traffickingTypeLabel,
  networkSizeLabel,
  enforcementResponseLabel,
  launderingMethodLabel,
  enforcementActionLabel,
  enforcementActionColor,
  formatVolumeBn,
  stabilityColor,
  stabilityLabel,
  countCritical,
  countCrisisRoutes,
  CARTELS,
  ROUTES,
  HUMAN_TRAFFICKING,
  LAUNDERING,
  NEXUS,
  type ActivityLevel,
  type CriminalEnterprise,
  type SeizureTrend,
  type TraffickingType,
  type LaunderingMethod,
  type StabilityImpact,
  type CartelSyndicate,
  type TraffickingRoute,
} from '../../src/components/organized-crime-superpower-helpers.ts';

// ── activityColor ─────────────────────────────────────────────────────────

test('activityColor: dormant returns grey', () => {
  assert.ok(activityColor('dormant').includes('#9e9e9e'));
});

test('activityColor: active returns green', () => {
  assert.ok(activityColor('active').includes('#4caf50'));
});

test('activityColor: elevated returns yellow', () => {
  assert.ok(activityColor('elevated').includes('#facc15'));
});

test('activityColor: critical returns red', () => {
  assert.ok(activityColor('critical').includes('#ef4444'));
});

// ── activityLabel ─────────────────────────────────────────────────────────

test('activityLabel: all levels return non-empty strings', () => {
  const levels: ActivityLevel[] = ['dormant', 'active', 'elevated', 'critical'];
  for (const l of levels) {
    assert.ok(activityLabel(l).length > 0);
  }
});

test('activityLabel: critical returns "Critical"', () => {
  assert.equal(activityLabel('critical'), 'Critical');
});

// ── enterpriseLabel ───────────────────────────────────────────────────────

test('enterpriseLabel: drug returns "Drug Trade"', () => {
  assert.equal(enterpriseLabel('drug'), 'Drug Trade');
});

test('enterpriseLabel: trafficking returns human trafficking label', () => {
  assert.ok(enterpriseLabel('trafficking').toLowerCase().includes('traffick'));
});

test('enterpriseLabel: cyber and arms return non-empty strings', () => {
  const types: CriminalEnterprise[] = ['cyber', 'arms'];
  for (const t of types) {
    assert.ok(enterpriseLabel(t).length > 0);
  }
});

// ── seizureTrendArrow ─────────────────────────────────────────────────────

test('seizureTrendArrow: up returns ▲', () => {
  assert.equal(seizureTrendArrow('up'), '▲');
});

test('seizureTrendArrow: down returns ▼', () => {
  assert.equal(seizureTrendArrow('down'), '▼');
});

test('seizureTrendArrow: flat returns →', () => {
  assert.equal(seizureTrendArrow('flat'), '→');
});

// ── seizureTrendColor ─────────────────────────────────────────────────────

test('seizureTrendColor: up returns orange (rising seizures = problem)', () => {
  assert.ok(seizureTrendColor('up').includes('#fb923c'));
});

test('seizureTrendColor: down returns green (falling seizures = improving)', () => {
  assert.ok(seizureTrendColor('down').includes('#4caf50'));
});

test('seizureTrendColor: flat returns grey', () => {
  assert.ok(seizureTrendColor('flat').includes('#9e9e9e'));
});

// ── interdictionLabel ─────────────────────────────────────────────────────

test('interdictionLabel: all pressures return non-empty strings', () => {
  const pressures: TraffickingRoute['interdictionPressure'][] = ['low', 'medium', 'high'];
  for (const p of pressures) {
    assert.ok(interdictionLabel(p).length > 0);
  }
});

test('interdictionLabel: high returns "High pressure"', () => {
  assert.equal(interdictionLabel('high'), 'High pressure');
});

// ── traffickingTypeLabel ──────────────────────────────────────────────────

test('traffickingTypeLabel: labor returns "Labor"', () => {
  assert.equal(traffickingTypeLabel('labor'), 'Labor');
});

test('traffickingTypeLabel: sexual returns sexual exploitation label', () => {
  assert.ok(traffickingTypeLabel('sexual').toLowerCase().includes('sexual'));
});

test('traffickingTypeLabel: organ returns organ trafficking label', () => {
  assert.ok(traffickingTypeLabel('organ').toLowerCase().includes('organ'));
});

// ── networkSizeLabel ──────────────────────────────────────────────────────

test('networkSizeLabel: all sizes return non-empty strings', () => {
  const sizes: ('small' | 'medium' | 'large')[] = ['small', 'medium', 'large'];
  for (const s of sizes) {
    assert.ok(networkSizeLabel(s).length > 0);
  }
});

test('networkSizeLabel: large returns organization label', () => {
  assert.ok(networkSizeLabel('large').toLowerCase().includes('large'));
});

// ── enforcementResponseLabel ──────────────────────────────────────────────

test('enforcementResponseLabel: none returns "No response"', () => {
  assert.equal(enforcementResponseLabel('none'), 'No response');
});

test('enforcementResponseLabel: strong returns "Strong"', () => {
  assert.equal(enforcementResponseLabel('strong'), 'Strong');
});

// ── launderingMethodLabel ─────────────────────────────────────────────────

test('launderingMethodLabel: real estate returns "Real Estate"', () => {
  assert.equal(launderingMethodLabel('real estate'), 'Real Estate');
});

test('launderingMethodLabel: crypto returns "Cryptocurrency"', () => {
  assert.equal(launderingMethodLabel('crypto'), 'Cryptocurrency');
});

test('launderingMethodLabel: shell companies and trade-based return non-empty', () => {
  const methods: LaunderingMethod[] = ['shell companies', 'trade-based'];
  for (const m of methods) {
    assert.ok(launderingMethodLabel(m).length > 0);
  }
});

// ── enforcementActionLabel ────────────────────────────────────────────────

test('enforcementActionLabel: none returns "No action"', () => {
  assert.equal(enforcementActionLabel('none'), 'No action');
});

test('enforcementActionLabel: sanctioned returns "Sanctioned"', () => {
  assert.equal(enforcementActionLabel('sanctioned'), 'Sanctioned');
});

// ── enforcementActionColor ────────────────────────────────────────────────

test('enforcementActionColor: none returns grey', () => {
  assert.ok(enforcementActionColor('none').includes('#9e9e9e'));
});

test('enforcementActionColor: sanctioned returns red', () => {
  assert.ok(enforcementActionColor('sanctioned').includes('#ef4444'));
});

test('enforcementActionColor: investigating returns yellow', () => {
  assert.ok(enforcementActionColor('investigating').includes('#facc15'));
});

// ── formatVolumeBn ────────────────────────────────────────────────────────

test('formatVolumeBn: values >= 100 round to whole number', () => {
  assert.equal(formatVolumeBn(120), '$120B');
});

test('formatVolumeBn: values 10-99 show no decimal', () => {
  assert.equal(formatVolumeBn(26), '$26B');
});

test('formatVolumeBn: values < 10 show one decimal', () => {
  assert.equal(formatVolumeBn(9.4), '$9.4B');
});

test('formatVolumeBn: 3.2 formats as $3.2B', () => {
  assert.equal(formatVolumeBn(3.2), '$3.2B');
});

// ── stabilityColor ────────────────────────────────────────────────────────

test('stabilityColor: 0 returns grey (minimal impact)', () => {
  assert.ok(stabilityColor(0).includes('#9e9e9e'));
});

test('stabilityColor: 4 returns red (severe)', () => {
  assert.ok(stabilityColor(4).includes('#ef4444'));
});

test('stabilityColor: 2 returns yellow (moderate)', () => {
  assert.ok(stabilityColor(2).includes('#facc15'));
});

// ── stabilityLabel ────────────────────────────────────────────────────────

test('stabilityLabel: 0 returns "Minimal"', () => {
  assert.equal(stabilityLabel(0), 'Minimal');
});

test('stabilityLabel: 4 returns "Severe"', () => {
  assert.equal(stabilityLabel(4), 'Severe');
});

test('stabilityLabel: all impact levels return non-empty strings', () => {
  const impacts: StabilityImpact[] = [0, 1, 2, 3, 4];
  for (const i of impacts) {
    assert.ok(stabilityLabel(i).length > 0);
  }
});

// ── countCritical ─────────────────────────────────────────────────────────

test('countCritical: empty array returns 0', () => {
  assert.equal(countCritical([]), 0);
});

test('countCritical: counts critical + elevated', () => {
  const cartels: CartelSyndicate[] = [
    { name: 'A', region: 'X', activityLevel: 'critical', primaryEnterprise: 'drug', territoryStatus: '' },
    { name: 'B', region: 'Y', activityLevel: 'elevated', primaryEnterprise: 'cyber', territoryStatus: '' },
    { name: 'C', region: 'Z', activityLevel: 'active', primaryEnterprise: 'arms', territoryStatus: '' },
    { name: 'D', region: 'W', activityLevel: 'dormant', primaryEnterprise: 'trafficking', territoryStatus: '' },
  ];
  assert.equal(countCritical(cartels), 2);
});

test('countCritical: dormant and active are not counted', () => {
  const cartels: CartelSyndicate[] = [
    { name: 'A', region: 'X', activityLevel: 'dormant', primaryEnterprise: 'drug', territoryStatus: '' },
    { name: 'B', region: 'Y', activityLevel: 'active', primaryEnterprise: 'drug', territoryStatus: '' },
  ];
  assert.equal(countCritical(cartels), 0);
});

// ── countCrisisRoutes ─────────────────────────────────────────────────────

test('countCrisisRoutes: empty array returns 0', () => {
  assert.equal(countCrisisRoutes([]), 0);
});

test('countCrisisRoutes: counts routes with seizure up + low interdiction', () => {
  const routes: TraffickingRoute[] = [
    { origin: 'A', transit: 'B', destination: 'C', commodity: 'X', seizureTrend: 'up', estimatedVolume: '1t', interdictionPressure: 'low' },
    { origin: 'A', transit: 'B', destination: 'C', commodity: 'X', seizureTrend: 'up', estimatedVolume: '1t', interdictionPressure: 'high' },
    { origin: 'A', transit: 'B', destination: 'C', commodity: 'X', seizureTrend: 'flat', estimatedVolume: '1t', interdictionPressure: 'low' },
  ];
  assert.equal(countCrisisRoutes(routes), 1);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('CARTELS: is a non-empty array', () => {
  assert.ok(Array.isArray(CARTELS));
  assert.ok(CARTELS.length > 0);
});

test('CARTELS: all entries have required fields', () => {
  for (const c of CARTELS) {
    assert.ok(typeof c.name === 'string' && c.name.length > 0);
    assert.ok(typeof c.region === 'string');
    assert.ok(['dormant', 'active', 'elevated', 'critical'].includes(c.activityLevel));
    assert.ok(['drug', 'trafficking', 'cyber', 'arms'].includes(c.primaryEnterprise));
  }
});

test('ROUTES: is a non-empty array', () => {
  assert.ok(Array.isArray(ROUTES));
  assert.ok(ROUTES.length > 0);
});

test('ROUTES: all entries have valid seizureTrend values', () => {
  for (const r of ROUTES) {
    assert.ok(['up', 'down', 'flat'].includes(r.seizureTrend));
    assert.ok(['low', 'medium', 'high'].includes(r.interdictionPressure));
  }
});

test('HUMAN_TRAFFICKING: is a non-empty array', () => {
  assert.ok(Array.isArray(HUMAN_TRAFFICKING));
  assert.ok(HUMAN_TRAFFICKING.length > 0);
});

test('HUMAN_TRAFFICKING: all entries have positive estimatedVictims', () => {
  for (const h of HUMAN_TRAFFICKING) {
    assert.ok(h.estimatedVictims > 0);
    assert.ok(['labor', 'sexual', 'organ'].includes(h.type));
  }
});

test('LAUNDERING: is a non-empty array', () => {
  assert.ok(Array.isArray(LAUNDERING));
  assert.ok(LAUNDERING.length > 0);
});

test('LAUNDERING: all entries have positive estimatedVolumeBn', () => {
  for (const m of LAUNDERING) {
    assert.ok(m.estimatedVolumeBn > 0);
  }
});

test('NEXUS: is a non-empty array', () => {
  assert.ok(Array.isArray(NEXUS));
  assert.ok(NEXUS.length > 0);
});

test('NEXUS: all entries have stabilityImpact between 0 and 4', () => {
  for (const n of NEXUS) {
    assert.ok(n.stabilityImpact >= 0 && n.stabilityImpact <= 4);
  }
});

test('CARTELS: contains at least one critical entry', () => {
  assert.ok(CARTELS.some((c) => c.activityLevel === 'critical'));
});

test('NEXUS: contains at least one severe (impact 4) entry', () => {
  assert.ok(NEXUS.some((n) => n.stabilityImpact === 4));
});
