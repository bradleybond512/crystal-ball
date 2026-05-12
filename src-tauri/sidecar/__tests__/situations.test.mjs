/**
 * Sidecar /api/intelligence/situations helpers — input validation + the
 * in-process mirror store. The renderer-side store (situation-store.ts)
 * stays canonical; this mirror is for replay/integration tooling.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  _resetSituationsSidecar,
  createSituationSidecar,
  getSituationSidecar,
  listActiveSituationsSidecar,
  validateSituationInput,
} from '../local-api-server.mjs';

function input(over = {}) {
  return {
    name: 'Test situation',
    status: 'active',
    severity: 'high',
    domain: 'natural',
    summary: 'A test',
    observationIds: ['obs-1'],
    correlationIds: [],
    tags: ['storm'],
    confidence: 0.7,
    ...over,
  };
}

test('validateSituationInput accepts a well-formed payload', () => {
  const r = validateSituationInput(input());
  assert.equal(r.ok, true);
  assert.equal(r.clean.name, 'Test situation');
});

test('validateSituationInput rejects null / non-object input', () => {
  assert.equal(validateSituationInput(null).ok, false);
  assert.equal(validateSituationInput(42).ok, false);
  assert.equal(validateSituationInput('hello').ok, false);
});

test('validateSituationInput rejects missing or empty name', () => {
  assert.match(validateSituationInput(input({ name: '' })).error, /name is required/);
  assert.match(validateSituationInput(input({ name: '   ' })).error, /name is required/);
});

test('validateSituationInput rejects unknown status / severity', () => {
  assert.match(validateSituationInput(input({ status: 'pending' })).error, /invalid status/);
  assert.match(validateSituationInput(input({ severity: 'severe' })).error, /invalid severity/);
});

test('validateSituationInput clamps confidence into [0,1]', () => {
  assert.equal(validateSituationInput(input({ confidence: 5 })).clean.confidence, 1);
  assert.equal(validateSituationInput(input({ confidence: -3 })).clean.confidence, 0);
  assert.equal(validateSituationInput(input({ confidence: 'huh' })).clean.confidence, 0.5);
});

test('validateSituationInput keeps valid location, drops malformed', () => {
  const goodLoc = validateSituationInput(input({
    location: { lat: 41, lon: -86, radiusKm: 50 } })).clean.location;
  assert.deepEqual(goodLoc, { lat: 41, lon: -86, radiusKm: 50 });
  const badLat = validateSituationInput(input({
    location: { lat: 200, lon: 0, radiusKm: 10 } })).clean.location;
  assert.equal(badLat, null);
  const negRadius = validateSituationInput(input({
    location: { lat: 0, lon: 0, radiusKm: -5 } })).clean.location;
  assert.equal(negRadius, null);
});

test('createSituationSidecar appends to the mirror and assigns an id', () => {
  _resetSituationsSidecar();
  const { ok, situation } = createSituationSidecar(input(), 1_000_000);
  assert.equal(ok, true);
  assert.match(situation.id, /^sit-/);
  assert.equal(situation.startedAt, 1_000_000);
  assert.equal(situation.updatedAt, 1_000_000);
  assert.equal(listActiveSituationsSidecar().length, 1);
});

test('createSituationSidecar rejects invalid input without mutating the mirror', () => {
  _resetSituationsSidecar();
  const r = createSituationSidecar({ name: '', status: 'active' });
  assert.equal(r.ok, false);
  assert.equal(listActiveSituationsSidecar().length, 0);
});

test('listActiveSituationsSidecar excludes resolved entries', () => {
  _resetSituationsSidecar();
  createSituationSidecar(input({ name: 'one' }), 1000);
  createSituationSidecar(input({ name: 'two', status: 'resolved' }), 2000);
  const active = listActiveSituationsSidecar().map((s) => s.name);
  assert.deepEqual(active, ['one']);
});

test('getSituationSidecar returns null on miss, copy on hit', () => {
  _resetSituationsSidecar();
  const { situation } = createSituationSidecar(input(), 1000);
  assert.equal(getSituationSidecar('nope'), null);
  const hit = getSituationSidecar(situation.id);
  assert.equal(hit.id, situation.id);
  // Mutating the result must not bleed into the store.
  hit.name = 'tampered';
  assert.equal(getSituationSidecar(situation.id).name, 'Test situation');
});
