import assert from 'node:assert/strict';
import test from 'node:test';

import {
  couplingDriversFor,
  FOOD_COUPLING_RULES,
  ENERGY_COUPLING_RULES,
  type ActiveCascade,
} from '../cross-domain-coupling.ts';

test('a conflict→maritime cascade produces a cross_domain export-corridor driver for food', () => {
  const cascades: ActiveCascade[] = [{ from: 'conflict', to: 'maritime', severity: 70 }];
  const drivers = couplingDriversFor(cascades, FOOD_COUPLING_RULES);
  const corridor = drivers.find((d) => d.label.startsWith('Export-corridor'));
  assert.ok(corridor, 'export-corridor driver emitted');
  assert.equal(corridor!.kind, 'cross_domain');
  assert.equal(corridor!.score, 70);
  assert.equal(corridor!.polarity, 'risk');
  assert.match(corridor!.label, /conflict→maritime/);
});

test('no matching cascade → no drivers', () => {
  const drivers = couplingDriversFor([{ from: 'space', to: 'space', severity: 90 }], FOOD_COUPLING_RULES);
  assert.equal(drivers.length, 0);
});

test('the strongest matching cascade sets the score; one driver per rule', () => {
  const cascades: ActiveCascade[] = [
    { from: 'weather', to: 'maritime', severity: 40 },
    { from: 'conflict', to: 'maritime', severity: 85 },
  ];
  const drivers = couplingDriversFor(cascades, FOOD_COUPLING_RULES);
  const corridor = drivers.filter((d) => d.label.startsWith('Export-corridor'));
  assert.equal(corridor.length, 1, 'deduped to one driver per rule');
  assert.equal(corridor[0]!.score, 85, 'strongest cascade wins');
});

test('from-qualified rule only matches the specified antecedent', () => {
  // FOOD has { from: 'conflict', to: 'markets' }; a macro→markets cascade must NOT match it.
  const macro = couplingDriversFor([{ from: 'macro', to: 'markets', severity: 60 }], FOOD_COUPLING_RULES);
  assert.equal(macro.find((d) => d.label.startsWith('Conflict-driven')), undefined);
  const conflict = couplingDriversFor([{ from: 'conflict', to: 'markets', severity: 60 }], FOOD_COUPLING_RULES);
  assert.ok(conflict.find((d) => d.label.startsWith('Conflict-driven')));
});

test('scale attenuates the driver score', () => {
  const drivers = couplingDriversFor([{ from: 'weather', to: 'humanitarian', severity: 50 }], FOOD_COUPLING_RULES);
  const hum = drivers.find((d) => d.label.startsWith('Regional humanitarian'));
  assert.ok(hum);
  assert.equal(hum!.score, 40, '50 * 0.8 scale');
});

test('energy rules pick up infra + maritime cascades and carry factId', () => {
  const cascades: ActiveCascade[] = [
    { from: 'cyber', to: 'infra', severity: 75 },
    { from: 'conflict', to: 'maritime', severity: 55 },
  ];
  const drivers = couplingDriversFor(cascades, ENERGY_COUPLING_RULES, { factId: 'cmp-1' });
  assert.ok(drivers.length >= 2);
  assert.ok(drivers.every((d) => d.factId === 'cmp-1'));
  assert.ok(drivers.some((d) => d.label.startsWith('Cyber-driven')));
});
