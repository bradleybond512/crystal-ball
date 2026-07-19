import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptPowerGridAlertsToInput } from '../grid-energy-adapter.ts';
import { makeEnergyWaterContributor } from '../energy-water-contributor.ts';
import type { PowerGridAlert } from '../../power-grid-alerts';

const NOW = 1_700_000_000_000;

function alert(over: Partial<PowerGridAlert> = {}): PowerGridAlert {
  return {
    id: 'a1', title: 'Grid Emergency Alert 3', description: 'EEA3 declared',
    source: 'NERC', region: 'Texas', alertType: 'emergency',
    pubDate: new Date(NOW), url: 'https://x', severity: 'critical',
    ...over,
  };
}

test('empty input → null util/outage and no grid alerts', () => {
  const input = adaptPowerGridAlertsToInput([]);
  assert.equal(input.gridUtilizationPct, null);
  assert.equal(input.nearbyOutageCount, null);
  assert.deepEqual(input.gridAlerts, []);
});

test('PowerGridAlert severity maps to the GridAlert severity band', () => {
  const pairs: Array<[PowerGridAlert['severity'], string]> = [
    ['critical', 'emergency'], ['high', 'warning'], ['medium', 'watch'], ['low', 'info'],
  ];
  for (const [sev, expected] of pairs) {
    const [g] = adaptPowerGridAlertsToInput([alert({ severity: sev })]).gridAlerts;
    assert.equal(g!.severity, expected, `${sev} → ${expected}`);
  }
});

test('alert fields (id/title/description/region/timestamp) are carried through', () => {
  const [g] = adaptPowerGridAlertsToInput([
    alert({ id: 'z9', title: 'T', description: 'D', region: 'WECC', pubDate: new Date(NOW) }),
  ]).gridAlerts;
  assert.equal(g!.id, 'z9');
  assert.equal(g!.title, 'T');
  assert.equal(g!.description, 'D');
  assert.equal(g!.region, 'WECC');
  assert.equal(g!.timestamp, NOW);
});

// ── End-to-end: adapter → energy_water contributor ────────────────────────────

test('critical grid alert → one emergency energy_water threat (severity 95)', () => {
  const input = adaptPowerGridAlertsToInput([alert({ severity: 'critical' })]);
  const threats = makeEnergyWaterContributor(input).contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'energy_water');
  assert.equal(t.threatLevel, 'emergency');
  assert.equal(t.severity, 95);
});

test('high → warning, medium → watch through the contributor', () => {
  const high = makeEnergyWaterContributor(adaptPowerGridAlertsToInput([alert({ id: 'h', severity: 'high' })])).contribute(NOW);
  assert.equal(high[0]!.threatLevel, 'warning');
  const medium = makeEnergyWaterContributor(adaptPowerGridAlertsToInput([alert({ id: 'm', severity: 'medium' })])).contribute(NOW);
  assert.equal(medium[0]!.threatLevel, 'watch');
});

test('low-severity (info) grid alert produces no energy_water threat', () => {
  const input = adaptPowerGridAlertsToInput([alert({ severity: 'low' })]);
  assert.deepEqual(makeEnergyWaterContributor(input).contribute(NOW), []);
});

test('no util/outage source means only grid alerts drive the axis', () => {
  const input = adaptPowerGridAlertsToInput([alert({ severity: 'critical' })]);
  // Exactly one threat, and it came from the alert (sourceEventId grid-alert-*).
  const threats = makeEnergyWaterContributor(input).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.match(threats[0]!.sourceEventId, /^grid-alert-/);
});

test('multiple alerts of mixed severity produce the expected threat set', () => {
  const input = adaptPowerGridAlertsToInput([
    alert({ id: 'c', severity: 'critical' }),
    alert({ id: 'h', severity: 'high' }),
    alert({ id: 'l', severity: 'low' }), // dropped (info → normal)
  ]);
  const threats = makeEnergyWaterContributor(input).contribute(NOW);
  assert.equal(threats.length, 2);
  for (const t of threats) assert.equal(t.axis, 'energy_water');
});
