import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePowerPosture } from '../power-posture.ts';
import type { GridAlert } from '../../power-grid.ts';

function alert(severity: GridAlert['severity']): GridAlert {
  return { id: `a-${severity}`, severity, title: `${severity} event`, description: '', region: 'PJM', timestamp: 0 };
}

test('normal when load is low and no alerts', () => {
  const p = computePowerPosture({ gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0 });
  assert.equal(p.level, 'normal');
  assert.deepEqual(p.drivers, []);
});

test('warning at 92% utilization boundary', () => {
  const p = computePowerPosture({ gridUtilizationPct: 92, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'warning');
  assert.ok(p.drivers.some((d) => d.includes('92')));
});

test('advisory just below the warning threshold', () => {
  const p = computePowerPosture({ gridUtilizationPct: 86, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'advisory');
});

test('grid emergency alert is critical', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [alert('emergency')], nearbyOutageCount: 0 });
  assert.equal(p.level, 'critical');
});

test('grid warning alert is warning even at low load', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [alert('warning')], nearbyOutageCount: 0 });
  assert.equal(p.level, 'warning');
});

test('major nearby outage is critical', () => {
  const p = computePowerPosture({ gridUtilizationPct: 50, gridAlerts: [], nearbyOutageCount: 8000 });
  assert.equal(p.level, 'critical');
  assert.ok(p.drivers.some((d) => d.includes('8')));
});

test('null utilization does not throw and yields normal absent other signals', () => {
  const p = computePowerPosture({ gridUtilizationPct: null, gridAlerts: [], nearbyOutageCount: null });
  assert.equal(p.level, 'normal');
  assert.equal(p.gridUtilizationPct, null);
});
