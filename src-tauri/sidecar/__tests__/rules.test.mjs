/**
 * Sidecar /api/intelligence/rules helpers — input validation, in-process
 * mirror store, evaluation parity with the TS engine.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  _resetRulesSidecar,
  deleteRuleSidecar,
  evaluateRulesAgainstEventSidecar,
  listRulesSidecar,
  ruleMatchesSidecar,
  upsertRuleSidecar,
  validateRuleInputSidecar,
} from '../local-api-server.mjs';

function ruleInput(over = {}) {
  return {
    name: 'Test',
    enabled: true,
    conditionOperator: 'AND',
    conditions: [{ field: 'domain', operator: 'equals', value: 'natural' }],
    actions: [{ type: 'notify' }],
    ...over,
  };
}

function observation(over = {}) {
  return {
    id: 'obs-1',
    sourceId: 'usgs',
    domain: 'natural',
    timestamp: Date.parse('2026-05-11T12:00:00Z'),
    location: { lat: 41.6, lon: -86.7 },
    severity: 'HIGH',
    title: 'M5.8 earthquake near La Porte',
    raw: { magnitude: 5.8 },
    entityIds: [],
    tags: ['earthquake'],
    ...over,
  };
}

test('validateRuleInputSidecar accepts a well-formed payload', () => {
  const r = validateRuleInputSidecar(ruleInput());
  assert.equal(r.ok, true);
  assert.equal(r.clean.name, 'Test');
});

test('validateRuleInputSidecar rejects null / empty name / unknown joins', () => {
  assert.equal(validateRuleInputSidecar(null).ok, false);
  assert.match(validateRuleInputSidecar(ruleInput({ name: '' })).error, /name is required/);
  assert.match(validateRuleInputSidecar(ruleInput({ conditionOperator: 'XOR' })).error, /AND or OR/);
});

test('validateRuleInputSidecar rejects unknown condition field / operator / action type', () => {
  assert.match(
    validateRuleInputSidecar(ruleInput({
      conditions: [{ field: 'weather', operator: 'equals', value: 'sunny' }] })).error,
    /invalid field/);
  assert.match(
    validateRuleInputSidecar(ruleInput({
      conditions: [{ field: 'domain', operator: 'matches', value: 'x' }] })).error,
    /invalid operator/);
  assert.match(
    validateRuleInputSidecar(ruleInput({
      actions: [{ type: 'detonate' }] })).error,
    /invalid action type/);
});

test('upsertRuleSidecar creates a new rule and assigns an id', () => {
  _resetRulesSidecar();
  const result = upsertRuleSidecar(ruleInput(), 1_000_000);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.match(result.rule.id, /^rule-/);
  assert.equal(listRulesSidecar().length, 1);
});

test('upsertRuleSidecar with existing id updates in place', () => {
  _resetRulesSidecar();
  const created = upsertRuleSidecar(ruleInput(), 1_000_000);
  const updated = upsertRuleSidecar({ ...ruleInput({ name: 'Renamed' }), id: created.rule.id });
  assert.equal(updated.created, false);
  assert.equal(updated.rule.name, 'Renamed');
  assert.equal(listRulesSidecar().length, 1);
});

test('deleteRuleSidecar returns true on hit, false on miss', () => {
  _resetRulesSidecar();
  const created = upsertRuleSidecar(ruleInput(), 1_000_000);
  assert.equal(deleteRuleSidecar('not-real'), false);
  assert.equal(deleteRuleSidecar(created.rule.id), true);
  assert.equal(listRulesSidecar().length, 0);
});

test('ruleMatchesSidecar AND requires every condition; OR any', () => {
  _resetRulesSidecar();
  const andRule = upsertRuleSidecar(ruleInput({
    conditionOperator: 'AND',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'natural' },
      { field: 'magnitude', operator: 'gt', value: 6 },
    ],
  })).rule;
  assert.equal(ruleMatchesSidecar(observation({ raw: { magnitude: 7 } }), andRule), true);
  assert.equal(ruleMatchesSidecar(observation({ raw: { magnitude: 4 } }), andRule), false);
  const orRule = upsertRuleSidecar(ruleInput({
    conditionOperator: 'OR',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'finance' }, // false
      { field: 'severity', operator: 'equals', value: 'HIGH' },  // true
    ],
  })).rule;
  assert.equal(ruleMatchesSidecar(observation(), orRule), true);
});

test('ruleMatchesSidecar: location near with haversine radiusKm', () => {
  _resetRulesSidecar();
  const r = upsertRuleSidecar(ruleInput({
    conditions: [{ field: 'location', operator: 'near',
      value: '41.6,-86.7', radiusKm: 50 }],
  })).rule;
  assert.equal(ruleMatchesSidecar(observation({ location: { lat: 41.6, lon: -86.7 } }), r), true);
  assert.equal(ruleMatchesSidecar(observation({ location: { lat: -33, lon: 151 } }), r), false);
  assert.equal(ruleMatchesSidecar(observation({ location: undefined }), r), false);
});

test('evaluateRulesAgainstEventSidecar: returns only matching rules', () => {
  _resetRulesSidecar();
  upsertRuleSidecar(ruleInput({ name: 'natural-only' }));
  upsertRuleSidecar(ruleInput({ name: 'finance-only',
    conditions: [{ field: 'domain', operator: 'equals', value: 'finance' }] }));
  const result = evaluateRulesAgainstEventSidecar({ event: observation() });
  assert.equal(result.ok, true);
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0].name, 'natural-only');
});

test('evaluateRulesAgainstEventSidecar honors a caller-supplied rules array', () => {
  _resetRulesSidecar();
  const oneOff = upsertRuleSidecar(ruleInput({ name: 'oneoff' })).rule;
  // After deleting it from the store, the caller can still pass it explicitly.
  deleteRuleSidecar(oneOff.id);
  const result = evaluateRulesAgainstEventSidecar({
    event: observation(),
    rules: [oneOff],
  });
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0].name, 'oneoff');
});
