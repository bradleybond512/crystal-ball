import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnergyWaterContributor } from '../energy-water-contributor.ts';
import type { PowerPostureInput } from '../../datacenter/power-posture.ts';
import type { GridAlert } from '../../power-grid.ts';

const NOW = 1_700_000_000_000;

function alert(over: Partial<GridAlert> = {}): GridAlert {
  return {
    id: 'a1',
    severity: 'warning',
    title: 'Grid stress',
    description: '',
    region: 'MISO',
    timestamp: NOW,
    ...over,
  };
}

function input(over: Partial<PowerPostureInput> = {}): PowerPostureInput {
  return { gridUtilizationPct: null, gridAlerts: [], nearbyOutageCount: null, ...over };
}

test('all-normal input produces no threats', () => {
  const c = makeEnergyWaterContributor(input());
  assert.deepEqual(c.contribute(NOW), []);
});

test('utilization >=92 -> one warning energy_water threat (severity 75)', () => {
  const threats = makeEnergyWaterContributor(input({ gridUtilizationPct: 95 })).contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'energy_water');
  assert.equal(t.threatLevel, 'warning');
  assert.equal(t.severity, 75);
  assert.equal(t.sourceEventId, 'grid-util');
});

test('utilization >=85 and <92 -> advisory (severity 50)', () => {
  const threats = makeEnergyWaterContributor(input({ gridUtilizationPct: 88 })).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.threatLevel, 'advisory');
  assert.equal(threats[0]!.severity, 50);
});

test('nearby outage >=5000 -> emergency (severity 95)', () => {
  const threats = makeEnergyWaterContributor(input({ nearbyOutageCount: 6000 })).contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.threatLevel, 'emergency');
  assert.equal(t.severity, 95);
  assert.equal(t.sourceEventId, 'grid-outage');
});

test('nearby outage >=1000 and <5000 -> warning (severity 75)', () => {
  const threats = makeEnergyWaterContributor(input({ nearbyOutageCount: 1500 })).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.threatLevel, 'warning');
  assert.equal(threats[0]!.severity, 75);
});

test('emergency alert -> one emergency threat; info alert -> none', () => {
  const emergency = makeEnergyWaterContributor(
    input({ gridAlerts: [alert({ id: 'a1', severity: 'emergency', title: 'Rolling blackouts', region: 'MISO' })] }),
  ).contribute(NOW);
  assert.equal(emergency.length, 1);
  const t = emergency[0]!;
  assert.equal(t.axis, 'energy_water');
  assert.equal(t.threatLevel, 'emergency');
  assert.equal(t.severity, 95);
  assert.equal(t.sourceEventId, 'grid-alert-a1');

  const info = makeEnergyWaterContributor(
    input({ gridAlerts: [alert({ severity: 'info' })] }),
  ).contribute(NOW);
  assert.deepEqual(info, []);
});

test('combined signals -> three threats in order util/outage/alert', () => {
  const threats = makeEnergyWaterContributor(
    input({
      gridUtilizationPct: 88,
      nearbyOutageCount: 2000,
      gridAlerts: [alert({ id: 'z9', severity: 'warning', title: 'Load shed', region: 'PJM' })],
    }),
  ).contribute(NOW);
  assert.equal(threats.length, 3);
  for (const t of threats) assert.equal(t.axis, 'energy_water');
  assert.equal(threats[0]!.sourceEventId, 'grid-util');
  assert.equal(threats[1]!.sourceEventId, 'grid-outage');
  assert.equal(threats[2]!.sourceEventId, 'grid-alert-z9');
});
