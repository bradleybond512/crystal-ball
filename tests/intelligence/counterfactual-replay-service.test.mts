import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CounterfactualReplayService,
  STORAGE_KEY,
  MAX_SCENARIOS,
  ALERT_THRESHOLD,
  cloneEvent,
  applyModification,
  applyModificationsToEvent,
  computeRunStats,
  buildSummary,
  severityIndex,
  parseScenarios,
  _setInstanceForTests,
  _resetIdCounter,
  type Modification,
} from '../../src/services/intelligence/counterfactual-replay-service.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';
import type { ScoredEvent } from '../../src/services/intelligence/driver-scorer.ts';

const NOW = 1_700_000_000_000;

function event(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'e1',
    sourceId: 'usgs-earthquake',
    domain: 'earthquake',
    timestamp: NOW - 60_000,
    severity: 'HIGH',
    title: 'M5.2 near Tokyo',
    location: { lat: 35.68, lon: 139.65 },
    raw: { magnitude: 5.2, depth_km: 30 },
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function mod(overrides: Partial<Modification> = {}): Modification {
  return {
    observationId: 'e1',
    field: 'severity',
    originalValue: 'HIGH',
    modifiedValue: 'CRITICAL',
    ...overrides,
  };
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}

function makeService(now: () => number = () => NOW) {
  _resetIdCounter();
  return new CounterfactualReplayService(fakeStorage(), now);
}

function scored(overrides: Partial<ScoredEvent> = {}): ScoredEvent {
  return {
    ...event(),
    driverScore: 0.5,
    drivers: [],
    scoreReason: '',
    ...overrides,
  };
}

// ── Constants / config sanity ────────────────────────────────────────────

test('MAX_SCENARIOS is 100 (spec)', () => {
  assert.equal(MAX_SCENARIOS, 100);
});

test('ALERT_THRESHOLD is in (0, 1)', () => {
  assert.ok(ALERT_THRESHOLD > 0 && ALERT_THRESHOLD < 1);
});

test('STORAGE_KEY is the v1 suffix (avoids legacy engine collision)', () => {
  assert.match(STORAGE_KEY, /^wm-counterfactual-replay/);
});

// ── Pure helpers: cloneEvent ─────────────────────────────────────────────

test('cloneEvent deep-clones nested objects', () => {
  const a = event({ raw: { magnitude: 5, depth_km: 30 }, location: { lat: 1, lon: 2 } });
  const b = cloneEvent(a);
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.raw, b.raw);
  assert.notStrictEqual(a.location, b.location);
  assert.deepEqual(a, b);
});

test('cloneEvent: mutating clone does not affect the original', () => {
  const a = event({ raw: { magnitude: 5 } });
  const b = cloneEvent(a);
  (b.raw as { magnitude: number }).magnitude = 9;
  assert.equal((a.raw as { magnitude: number }).magnitude, 5);
});

// ── Pure helpers: applyModification ──────────────────────────────────────

test('applyModification: top-level field replace', () => {
  const e = event();
  applyModification(e, mod({ field: 'severity', modifiedValue: 'CRITICAL' }));
  assert.equal(e.severity, 'CRITICAL');
});

test('applyModification: nested raw.magnitude replace', () => {
  const e = event({ raw: { magnitude: 5.2 } });
  applyModification(e, { observationId: 'e1', field: 'raw.magnitude', originalValue: 5.2, modifiedValue: 8.5 });
  assert.equal((e.raw as { magnitude: number }).magnitude, 8.5);
});

test('applyModification: nested location.lat replace', () => {
  const e = event({ location: { lat: 1, lon: 2 } });
  applyModification(e, { observationId: 'e1', field: 'location.lat', originalValue: 1, modifiedValue: 50 });
  assert.equal(e.location?.lat, 50);
});

test('applyModification: invalid intermediate path is a silent no-op', () => {
  const e = event({ raw: undefined });
  applyModification(e, { observationId: 'e1', field: 'raw.magnitude', originalValue: 0, modifiedValue: 9 });
  assert.equal(e.raw, undefined);
});

test('applyModification: empty field path is a no-op', () => {
  const e = event();
  applyModification(e, { observationId: 'e1', field: '', originalValue: 'HIGH', modifiedValue: 'CRITICAL' });
  assert.equal(e.severity, 'HIGH');
});

// ── Pure helpers: applyModificationsToEvent ──────────────────────────────

test('applyModificationsToEvent: only applies matching observationId', () => {
  const e = event();
  const out = applyModificationsToEvent(e, [
    mod({ observationId: 'e1', modifiedValue: 'CRITICAL' }),
    mod({ observationId: 'OTHER', modifiedValue: 'LOW' }),
  ]);
  assert.equal(out.severity, 'CRITICAL');
});

test('applyModificationsToEvent: leaves the original event untouched', () => {
  const e = event();
  applyModificationsToEvent(e, [mod({ modifiedValue: 'CRITICAL' })]);
  assert.equal(e.severity, 'HIGH');
});

test('applyModificationsToEvent: applies multiple modifications to the same event', () => {
  const e = event({ raw: { magnitude: 5, depth_km: 30 } });
  const out = applyModificationsToEvent(e, [
    { observationId: 'e1', field: 'raw.magnitude', originalValue: 5, modifiedValue: 7 },
    { observationId: 'e1', field: 'raw.depth_km',  originalValue: 30, modifiedValue: 5 },
  ]);
  const r = out.raw as { magnitude: number; depth_km: number };
  assert.equal(r.magnitude, 7);
  assert.equal(r.depth_km, 5);
});

// ── Pure helpers: computeRunStats + buildSummary + severityIndex ─────────

test('computeRunStats: counts events at or above ALERT_THRESHOLD', () => {
  const s = computeRunStats([
    scored({ id: 'a', driverScore: 0.2 }),
    scored({ id: 'b', driverScore: ALERT_THRESHOLD }),
    scored({ id: 'c', driverScore: 0.9 }),
  ]);
  assert.equal(s.alertCount, 2);
});

test('computeRunStats: maxSeverity is the maximum driverScore', () => {
  const s = computeRunStats([
    scored({ id: 'a', driverScore: 0.1 }),
    scored({ id: 'b', driverScore: 0.7 }),
    scored({ id: 'c', driverScore: 0.3 }),
  ]);
  assert.equal(s.maxSeverity, 0.7);
});

test('computeRunStats: empty input → zeros', () => {
  assert.deepEqual(computeRunStats([]), { alertCount: 0, maxSeverity: 0 });
});

test('buildSummary: no-change phrasing', () => {
  const s = buildSummary({ alertCount: 2, maxSeverity: 0.5 }, { alertCount: 2, maxSeverity: 0.5 });
  assert.match(s, /no change/);
});

test('buildSummary: more-alerts phrasing', () => {
  const s = buildSummary({ alertCount: 1, maxSeverity: 0.5 }, { alertCount: 3, maxSeverity: 0.5 });
  assert.match(s, /2 more alerts/);
});

test('buildSummary: fewer-alerts phrasing', () => {
  const s = buildSummary({ alertCount: 3, maxSeverity: 0.5 }, { alertCount: 1, maxSeverity: 0.5 });
  assert.match(s, /2 fewer alerts/);
});

test('buildSummary: severity delta is shown only when non-zero', () => {
  const sNo = buildSummary({ alertCount: 1, maxSeverity: 0.5 }, { alertCount: 1, maxSeverity: 0.5 });
  assert.equal(sNo.includes('max severity'), false);
  const sYes = buildSummary({ alertCount: 1, maxSeverity: 0.5 }, { alertCount: 1, maxSeverity: 0.7 });
  assert.match(sYes, /max severity \+20%/);
});

test('severityIndex maps the ladder rungs', () => {
  assert.equal(severityIndex('INFO'), 0);
  assert.equal(severityIndex('LOW'), 1);
  assert.equal(severityIndex('MEDIUM'), 2);
  assert.equal(severityIndex('HIGH'), 3);
  assert.equal(severityIndex('CRITICAL'), 4);
});

// ── Persistence: parseScenarios ──────────────────────────────────────────

test('parseScenarios: null / malformed → []', () => {
  assert.deepEqual(parseScenarios(null), []);
  assert.deepEqual(parseScenarios(''), []);
  assert.deepEqual(parseScenarios('not-json'), []);
  assert.deepEqual(parseScenarios('{"x":1}'), []); // not an array
});

test('parseScenarios: skips entries missing required fields', () => {
  const raw = JSON.stringify([
    { id: 'a', name: 'A', baselineObservations: [event()], modifications: [] },
    { id: 'b' },
    { id: 'c', name: 'C', baselineObservations: 'not-array', modifications: [] },
  ]);
  const out = parseScenarios(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'a');
});

// ── Service: createScenario ──────────────────────────────────────────────

test('createScenario assigns a unique id and persists', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [mod()]);
  assert.ok(s.id.startsWith('cf-'));
  assert.equal(svc.size(), 1);
});

test('createScenario rejects empty name', () => {
  const svc = makeService();
  assert.throws(() => svc.createScenario('   ', [event()], []));
});

test('createScenario deep-clones the input observations + modifications', () => {
  const svc = makeService();
  const ev = event();
  const m = mod();
  const s = svc.createScenario('Test', [ev], [m]);
  // Mutating callers' refs should not leak into the stored scenario.
  ev.severity = 'LOW';
  m.modifiedValue = 'INFO';
  const stored = svc.getScenario(s.id)!;
  assert.equal(stored.baselineObservations[0]?.severity, 'HIGH');
  assert.equal(stored.modifications[0]?.modifiedValue, 'CRITICAL');
});

// ── Service: replayScenario ──────────────────────────────────────────────

test('replayScenario throws on unknown id', () => {
  const svc = makeService();
  assert.throws(() => svc.replayScenario('does-not-exist'));
});

test('replayScenario returns a result whose scenarioId matches the input', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [mod()]);
  const result = svc.replayScenario(s.id);
  assert.equal(result.scenarioId, s.id);
});

test('replayScenario: identity modification (HIGH→HIGH) → zero deltaAlertCount', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [
    mod({ field: 'severity', originalValue: 'HIGH', modifiedValue: 'HIGH' }),
  ]);
  const result = svc.replayScenario(s.id);
  assert.equal(result.deltaAlertCount, 0);
});

test('replayScenario: severity upgrade increases modified max severity', () => {
  // Bump LOW → CRITICAL on a fresh, near-saved-place earthquake so the
  // driver-scorer rewards the change.
  const svc = makeService();
  const s = svc.createScenario('Test', [event({ severity: 'LOW' })], [
    mod({ field: 'severity', originalValue: 'LOW', modifiedValue: 'CRITICAL' }),
  ]);
  const result = svc.replayScenario(s.id);
  assert.ok(result.modifiedMaxSeverity >= result.originalMaxSeverity);
});

test('replayScenario: deltaAlertCount = modified - original', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event({ severity: 'LOW' })], [
    mod({ field: 'severity', originalValue: 'LOW', modifiedValue: 'CRITICAL' }),
  ]);
  const result = svc.replayScenario(s.id);
  assert.equal(result.deltaAlertCount, result.modifiedAlertCount - result.originalAlertCount);
});

test('replayScenario writes the result back into the scenario record', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [mod()]);
  const result = svc.replayScenario(s.id);
  const stored = svc.getScenario(s.id)!;
  assert.deepEqual(stored.result, result);
  assert.equal(typeof stored.replayedAt, 'number');
});

test('replayScenario can be called multiple times (re-runs replace prior result)', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [mod()]);
  svc.replayScenario(s.id);
  const second = svc.replayScenario(s.id);
  const stored = svc.getScenario(s.id)!;
  assert.deepEqual(stored.result, second);
});

// ── Service: getScenarios / getResult / deleteScenario ──────────────────

test('getScenarios returns every stored scenario', () => {
  const svc = makeService();
  svc.createScenario('A', [event({ id: 'a' })], []);
  svc.createScenario('B', [event({ id: 'b' })], []);
  assert.equal(svc.getScenarios().length, 2);
});

test('getResult returns undefined until replayScenario runs', () => {
  const svc = makeService();
  const s = svc.createScenario('Test', [event()], [mod()]);
  assert.equal(svc.getResult(s.id), undefined);
  svc.replayScenario(s.id);
  assert.ok(svc.getResult(s.id) !== undefined);
});

test('getResult returns undefined for unknown id', () => {
  const svc = makeService();
  assert.equal(svc.getResult('nope'), undefined);
});

test('deleteScenario removes and reports true; second call returns false', () => {
  const svc = makeService();
  const s = svc.createScenario('A', [event()], []);
  assert.equal(svc.deleteScenario(s.id), true);
  assert.equal(svc.deleteScenario(s.id), false);
});

test('clearAll empties the store', () => {
  const svc = makeService();
  svc.createScenario('A', [event({ id: 'a' })], []);
  svc.createScenario('B', [event({ id: 'b' })], []);
  svc.clearAll();
  assert.equal(svc.size(), 0);
});

// ── Service: cap eviction ───────────────────────────────────────────────

test(`evicts oldest scenarios beyond MAX_SCENARIOS (${MAX_SCENARIOS})`, () => {
  const svc = makeService();
  const firstId = svc.createScenario('first', [event()], []).id;
  for (let i = 1; i < MAX_SCENARIOS; i++) {
    svc.createScenario(`s${i}`, [event()], []);
  }
  // We're at the cap exactly — adding one more must evict the first.
  svc.createScenario('overflow', [event()], []);
  assert.equal(svc.size(), MAX_SCENARIOS);
  assert.equal(svc.getScenario(firstId), undefined);
});

// ── Service: singleton ──────────────────────────────────────────────────

test('getInstance returns the same instance on repeat calls', () => {
  _setInstanceForTests(null);
  const a = CounterfactualReplayService.getInstance();
  const b = CounterfactualReplayService.getInstance();
  assert.strictEqual(a, b);
  _setInstanceForTests(null);
});

test('_setInstanceForTests can inject + reset the singleton', () => {
  const stub = makeService();
  _setInstanceForTests(stub);
  assert.strictEqual(CounterfactualReplayService.getInstance(), stub);
  _setInstanceForTests(null);
  assert.notStrictEqual(CounterfactualReplayService.getInstance(), stub);
  _setInstanceForTests(null);
});

// ── Persistence round-trip ──────────────────────────────────────────────

test('persisted scenarios reload on a fresh service over the same storage', () => {
  const storage = fakeStorage();
  _resetIdCounter();
  const a = new CounterfactualReplayService(storage, () => NOW);
  a.createScenario('Test', [event()], [mod()]);
  const b = new CounterfactualReplayService(storage, () => NOW);
  assert.equal(b.size(), 1);
});

test('persistence writes under STORAGE_KEY', () => {
  const storage = fakeStorage();
  const svc = new CounterfactualReplayService(storage, () => NOW);
  svc.createScenario('Test', [event()], [mod()]);
  assert.ok(storage._map.get(STORAGE_KEY)?.includes('Test'));
});
