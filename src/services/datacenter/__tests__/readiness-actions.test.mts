import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessActions } from '../readiness-actions.ts';
import type { PowerPosture, WeatherPosture } from '../datacenter-types.ts';

const NOW = 1_700_000_000_000;

function power(over: Partial<PowerPosture> = {}): PowerPosture {
  return { level: 'normal', gridUtilizationPct: 60, gridAlerts: [], nearbyOutageCount: 0, drivers: [], ...over };
}
function weather(over: Partial<WeatherPosture> = {}): WeatherPosture {
  return { level: 'normal', activeHazards: [], stormMode: null, arrivalWindowMins: null, drivers: [], ...over };
}

test('all-clear yields no actions', () => {
  const actions = buildReadinessActions(power(), weather(), { now: NOW, overall: 'normal' });
  assert.equal(actions.length, 0);
});

test('tornado over site produces a now-urgency onsite_safety shelter action, sorted first', () => {
  const actions = buildReadinessActions(
    power(),
    weather({ level: 'critical', activeHazards: ['tornado'], arrivalWindowMins: 18 }),
    { now: NOW, overall: 'critical' },
  );
  assert.ok(actions.length > 0);
  assert.equal(actions[0]!.audience, 'onsite_safety');
  assert.equal(actions[0]!.urgency, 'now');
  assert.match(actions[0]!.title, /shelter|interior/i);
});

test('safety sorts above staffing above facility ops', () => {
  const actions = buildReadinessActions(
    power({ level: 'warning', gridUtilizationPct: 94, drivers: ['Grid at 94% of capacity'] }),
    weather({ level: 'warning', activeHazards: ['ice_storm'], arrivalWindowMins: 30 }),
    { now: NOW, overall: 'warning' },
  );
  const audiences = actions.map((a) => a.audience);
  const idxSafety = audiences.indexOf('onsite_safety');
  const idxStaffing = audiences.indexOf('commute_staffing');
  const idxOps = audiences.indexOf('facility_ops');
  if (idxSafety >= 0 && idxStaffing >= 0) assert.ok(idxSafety < idxStaffing);
  if (idxStaffing >= 0 && idxOps >= 0) assert.ok(idxStaffing < idxOps);
});

test('escalation action only appears at warning or above', () => {
  const calm = buildReadinessActions(power({ level: 'advisory' }), weather({ level: 'advisory' }), { now: NOW, overall: 'advisory' });
  assert.ok(!calm.some((a) => a.audience === 'escalation'));
  const hot = buildReadinessActions(power({ level: 'warning', gridUtilizationPct: 94 }), weather(), { now: NOW, overall: 'warning' });
  assert.ok(hot.some((a) => a.audience === 'escalation'));
});

test('heat alert produces a facility_ops pre-cool be_ready action', () => {
  const actions = buildReadinessActions(power(), weather({ level: 'advisory', activeHazards: ['extreme_heat'] }), { now: NOW, overall: 'advisory' });
  const op = actions.find((a) => a.audience === 'facility_ops' && /pre-cool|hvac/i.test(a.title));
  assert.ok(op);
  assert.equal(op!.urgency, 'be_ready');
});
