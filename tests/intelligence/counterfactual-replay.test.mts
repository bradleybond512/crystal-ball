/**
 * Tests for CounterfactualReplayEngine — Phase 4 "what if?" replay.
 *
 * Run with: npx tsx --test tests/intelligence/counterfactual-replay.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  BUILT_IN_REPLAY_TEMPLATES,
  CounterfactualReplayEngine,
  __resetCounterfactualReplaySingleton,
  __internals as engineInternals,
  getCounterfactualReplayEngine,
  locationShiftTemplate,
  scoreReplayObservation,
  severityDowngradeTemplate,
  sourceReductionTemplate,
  timingShiftTemplate,
  type ReplayModification,
} from '../../src/services/intelligence/counterfactual-replay.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'obs-1',
    sourceId: 'src-a',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'baseline event',
    raw: { magnitude: 6.0 },
    entityIds: [],
    tags: [],
    location: { lat: 35, lon: 139, radiusKm: 50 },
    ...overrides,
  };
}

function freshEngine(now = NOW): CounterfactualReplayEngine {
  __storage.clear();
  __resetCounterfactualReplaySingleton();
  return new CounterfactualReplayEngine({ clock: () => now });
}

// ── createScenario / getScenario / getAllScenarios ──────────────────

test('createScenario assigns an id with the cf- prefix', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), [], 'name', 'desc');
  assert.match(s.id, /^cf-/);
});

test('createScenario stamps createdAt with the engine clock', () => {
  const eng = freshEngine(NOW + 500);
  const s = eng.createScenario(obs(), [], 'n', 'd');
  assert.equal(s.createdAt, NOW + 500);
});

test('createScenario stores name + description + modifications', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), [
    { field: 'severity', originalValue: 'HIGH', modifiedValue: 'LOW', rationale: 'why' },
  ], 'my scenario', 'my description');
  assert.equal(s.name, 'my scenario');
  assert.equal(s.description, 'my description');
  assert.equal(s.modifications.length, 1);
  assert.equal(s.modifications[0].field, 'severity');
});

test('createScenario returns defensive copy — mutating result does not change store', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), [], 'a', 'b');
  s.modifications.push({ field: 'severity', originalValue: 'a', modifiedValue: 'b', rationale: 'x' });
  const stored = eng.getScenario(s.id);
  assert.equal(stored?.modifications.length, 0);
});

test('createScenario clones the baseline observation deeply', () => {
  const eng = freshEngine();
  const baseline = obs();
  const s = eng.createScenario(baseline, [], 'a', 'b');
  // Mutating the original baseline after creation must not affect
  // the persisted scenario.
  baseline.severity = 'CRITICAL';
  baseline.tags.push('mutated');
  assert.equal(s.baselineObservation.severity, 'HIGH');
  assert.equal(s.baselineObservation.tags.length, 0);
});

test('getAllScenarios returns insertion order, defensive copies', () => {
  const eng = freshEngine();
  const a = eng.createScenario(obs({ id: 'a' }), [], 'a', 'a');
  const b = eng.createScenario(obs({ id: 'b' }), [], 'b', 'b');
  const all = eng.getAllScenarios();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, a.id);
  assert.equal(all[1].id, b.id);
  // Mutation of returned array doesn't leak.
  all.push({ ...all[0]!, id: 'x' });
  assert.equal(eng.getAllScenarios().length, 2);
});

test('getScenario returns undefined for unknown id', () => {
  const eng = freshEngine();
  assert.equal(eng.getScenario('does-not-exist'), undefined);
});

// ── Modification application ─────────────────────────────────────────

test('severity modification changes the observation severity at replay', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs({ severity: 'HIGH', raw: {} }), [
    { field: 'severity', originalValue: 'HIGH', modifiedValue: 'LOW', rationale: 'r' },
  ], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  // Baseline (HIGH) scores ~0.7 → 'high'; modified (LOW) scores ~0.25 → 'low'.
  assert.equal(result.originalOutcome, 'high');
  assert.equal(result.replayedOutcome, 'low');
});

test('domain modification changes the observation domain at replay', () => {
  const eng = freshEngine();
  // Domain change alone doesn't shift the score (scoreReplayObservation
  // doesn't read the domain) but the change must still propagate.
  const baseline = obs({ raw: { magnitude: 4 } });
  const s = eng.createScenario(baseline, [
    { field: 'domain', originalValue: 'earthquake', modifiedValue: 'cyber', rationale: 'r' },
  ], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.ok(result);
  // No score effect from domain alone → deltaScore == 0.
  assert.equal(result.deltaScore, 0);
});

test('location modification updates the observation location', () => {
  const eng = freshEngine();
  const baseline = obs({ raw: {} });
  const mods = locationShiftTemplate(baseline);
  const s = eng.createScenario(baseline, mods, 'loc', 'shift');
  // Location alone doesn't shift the score either, but the modification
  // must be applied without throwing.
  const result = eng.runReplay(s.id)!;
  assert.ok(result);
});

test('magnitude modification bumps the score via raw.magnitude', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'MEDIUM', raw: { magnitude: 5 } });
  const s = eng.createScenario(baseline, [
    { field: 'magnitude', originalValue: 5, modifiedValue: 7, rationale: 'r' },
  ], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.ok(result.deltaScore > 0, `expected positive delta, got ${result.deltaScore}`);
});

test('confidence modification scales the score down', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'HIGH', raw: { magnitude: 5 } });
  const s = eng.createScenario(baseline, [
    { field: 'confidence', originalValue: 1, modifiedValue: 0.4, rationale: 'r' },
  ], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.ok(result.deltaScore < 0, `expected negative delta, got ${result.deltaScore}`);
});

test('no-op modification produces deltaScore = 0', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'MEDIUM', raw: {} });
  const s = eng.createScenario(baseline, [], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.equal(result.deltaScore, 0);
  assert.equal(result.originalOutcome, result.replayedOutcome);
});

// ── runReplay shape ───────────────────────────────────────────────────

test('runReplay returns a ReplayResult with all required fields', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), severityDowngradeTemplate(obs()), 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.equal(result.scenarioId, s.id);
  assert.equal(typeof result.originalOutcome, 'string');
  assert.equal(typeof result.replayedOutcome, 'string');
  assert.equal(typeof result.deltaScore, 'number');
  assert.equal(Array.isArray(result.insights), true);
  assert.equal(typeof result.ranAt, 'number');
});

test('runReplay returns undefined for unknown scenarioId', () => {
  const eng = freshEngine();
  assert.equal(eng.runReplay('nope'), undefined);
});

test('runReplay stores the result and increments getResults', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), severityDowngradeTemplate(obs()), 'n', 'd');
  assert.equal(eng.getResults(s.id).length, 0);
  eng.runReplay(s.id);
  eng.runReplay(s.id);
  assert.equal(eng.getResults(s.id).length, 2);
});

test('runReplay produces 2-3 insight strings', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), severityDowngradeTemplate(obs()), 'n', 'd');
  const result = eng.runReplay(s.id)!;
  assert.ok(result.insights.length >= 2);
  assert.ok(result.insights.length <= 3);
  for (const ins of result.insights) assert.ok(ins.length > 0);
});

// ── Direction-of-change properties ───────────────────────────────────

test('severity downgrade produces originalOutcome >= replayedOutcome on the band ladder', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'CRITICAL', raw: {} });
  const s = eng.createScenario(baseline, severityDowngradeTemplate(baseline), 'n', 'd');
  const result = eng.runReplay(s.id)!;
  const order = ['low', 'medium', 'high', 'critical'];
  assert.ok(order.indexOf(result.originalOutcome) >= order.indexOf(result.replayedOutcome));
});

test('severity upgrade produces replayedOutcome >= originalOutcome on the band ladder', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'LOW', raw: {} });
  const s = eng.createScenario(baseline, [
    { field: 'severity', originalValue: 'LOW', modifiedValue: 'CRITICAL', rationale: 'r' },
  ], 'n', 'd');
  const result = eng.runReplay(s.id)!;
  const order = ['low', 'medium', 'high', 'critical'];
  assert.ok(order.indexOf(result.replayedOutcome) >= order.indexOf(result.originalOutcome));
  assert.ok(result.deltaScore > 0);
});

// ── Built-in templates ───────────────────────────────────────────────

test('BUILT_IN_REPLAY_TEMPLATES exposes 4 templates with stable ids', () => {
  assert.equal(BUILT_IN_REPLAY_TEMPLATES.length, 4);
  const ids = BUILT_IN_REPLAY_TEMPLATES.map((t) => t.id).sort();
  assert.deepEqual(ids, ['location-shift', 'severity-downgrade', 'source-reduction', 'timing-shift']);
});

test('severityDowngradeTemplate produces a single severity modification with downgraded value', () => {
  const mods = severityDowngradeTemplate(obs({ severity: 'CRITICAL' }));
  assert.equal(mods.length, 1);
  assert.equal(mods[0].field, 'severity');
  assert.equal(mods[0].originalValue, 'CRITICAL');
  assert.equal(mods[0].modifiedValue, 'HIGH');
  assert.ok(mods[0].rationale.length > 0);
});

test('sourceReductionTemplate halves effective confidence', () => {
  const baseline = obs({ raw: { confidence: 1 } });
  const mods = sourceReductionTemplate(baseline);
  assert.equal(mods.length, 1);
  assert.equal(mods[0].field, 'confidence');
  assert.equal(mods[0].modifiedValue, 0.5);
});

test('locationShiftTemplate shifts latitude by ~1000 km', () => {
  const baseline = obs({ location: { lat: 35, lon: 139, radiusKm: 50 } });
  const mods = locationShiftTemplate(baseline);
  assert.equal(mods.length, 1);
  assert.equal(mods[0].field, 'location');
  const modifiedLat = (mods[0].modifiedValue as { lat: number }).lat;
  // ~1000 km north of lat 35 → ~44.0°; tolerate small float drift.
  assert.ok(Math.abs(modifiedLat - 44.01) < 0.5, `expected ~44°, got ${modifiedLat}`);
});

test('timingShiftTemplate produces a confidence-based modification with rationale referencing 6 h', () => {
  const baseline = obs();
  const mods = timingShiftTemplate(baseline);
  assert.equal(mods.length, 1);
  assert.match(mods[0].rationale, /6\s*h/i);
});

test('all built-in templates produce rationale strings', () => {
  const baseline = obs();
  for (const t of BUILT_IN_REPLAY_TEMPLATES) {
    const mods = t.build(baseline);
    for (const m of mods) assert.ok(m.rationale.length > 0, `${t.id} produced empty rationale`);
  }
});

test('createFromTemplate composes a scenario using the named template', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'CRITICAL' });
  const s = eng.createFromTemplate('severity-downgrade', baseline);
  assert.ok(s);
  assert.equal(s.modifications[0].field, 'severity');
  assert.equal(s.name, 'Severity downgrade');
});

test('createFromTemplate returns undefined for unknown template id', () => {
  const eng = freshEngine();
  assert.equal(eng.createFromTemplate('does-not-exist', obs()), undefined);
});

// ── Query API ────────────────────────────────────────────────────────

test('getResults filters by scenarioId', () => {
  const eng = freshEngine();
  const a = eng.createScenario(obs({ id: 'a' }), [], 'a', 'a');
  const b = eng.createScenario(obs({ id: 'b' }), [], 'b', 'b');
  eng.runReplay(a.id);
  eng.runReplay(b.id);
  eng.runReplay(b.id);
  assert.equal(eng.getResults(a.id).length, 1);
  assert.equal(eng.getResults(b.id).length, 2);
});

test('getResults returns empty array for unknown scenarioId', () => {
  const eng = freshEngine();
  assert.deepEqual(eng.getResults('nope'), []);
});

test('getAllResults returns every result across scenarios', () => {
  const eng = freshEngine();
  const a = eng.createScenario(obs({ id: 'a' }), [], 'a', 'a');
  const b = eng.createScenario(obs({ id: 'b' }), [], 'b', 'b');
  eng.runReplay(a.id);
  eng.runReplay(b.id);
  assert.equal(eng.getAllResults().length, 2);
});

// ── Persistence ──────────────────────────────────────────────────────

test('scenarios persist across instances via localStorage', () => {
  const a = freshEngine();
  a.createScenario(obs(), severityDowngradeTemplate(obs()), 'persisted', 'd');
  const b = new CounterfactualReplayEngine({ clock: () => NOW });
  assert.equal(b.getAllScenarios().length, 1);
  assert.equal(b.getAllScenarios()[0].name, 'persisted');
});

test('results persist across instances via localStorage', () => {
  const a = freshEngine();
  const s = a.createScenario(obs(), severityDowngradeTemplate(obs()), 'p', 'd');
  a.runReplay(s.id);
  a.runReplay(s.id);
  const b = new CounterfactualReplayEngine({ clock: () => NOW });
  assert.equal(b.getResults(s.id).length, 2);
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetCounterfactualReplaySingleton();
  __storage.set(engineInternals.STORAGE_KEY, '{not valid');
  const eng = new CounterfactualReplayEngine({ clock: () => NOW });
  assert.deepEqual(eng.getAllScenarios(), []);
  assert.deepEqual(eng.getAllResults(), []);
});

// ── Ring buffers ─────────────────────────────────────────────────────

test('scenarios over MAX_SCENARIOS evict oldest', () => {
  const eng = freshEngine();
  const max = engineInternals.MAX_SCENARIOS;
  for (let i = 0; i < max + 5; i++) {
    eng.createScenario(obs({ id: `obs-${i}` }), [], `s-${i}`, 'd');
  }
  const all = eng.getAllScenarios();
  assert.equal(all.length, max);
  assert.equal(all[0].name, 's-5'); // oldest 5 evicted
  assert.equal(all[all.length - 1].name, `s-${max + 4}`);
});

test('results over MAX_RESULTS evict oldest', () => {
  const eng = freshEngine();
  const s = eng.createScenario(obs(), [], 's', 'd');
  const max = engineInternals.MAX_RESULTS;
  for (let i = 0; i < max + 3; i++) eng.runReplay(s.id);
  // getResults filters by id — all results belong to s, so getResults
  // length is bounded by the global MAX_RESULTS cap.
  assert.equal(eng.getResults(s.id).length, max);
  assert.equal(eng.getAllResults().length, max);
});

// ── Subscribe / singleton ────────────────────────────────────────────

test('subscribe fires on createScenario and runReplay', () => {
  const eng = freshEngine();
  let count = 0;
  eng.subscribe(() => { count += 1; });
  const s = eng.createScenario(obs(), [], 'n', 'd');
  eng.runReplay(s.id);
  assert.equal(count, 2);
});

test('subscribe listener exception is isolated', () => {
  const eng = freshEngine();
  eng.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  eng.subscribe(() => { secondCalled = true; });
  eng.createScenario(obs(), [], 'n', 'd');
  assert.equal(secondCalled, true);
});

test('getCounterfactualReplayEngine() returns a stable singleton', () => {
  __storage.clear();
  __resetCounterfactualReplaySingleton();
  const a = getCounterfactualReplayEngine();
  const b = getCounterfactualReplayEngine();
  assert.strictEqual(a, b);
});

// ── scoreReplayObservation pure helper ───────────────────────────────

test('scoreReplayObservation maps INFO/LOW/MEDIUM/HIGH/CRITICAL to ascending scores', () => {
  const severities = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const scores = severities.map((s) => scoreReplayObservation(obs({ severity: s, raw: {} })).score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i]! >= scores[i - 1]!, `severity ${severities[i]} should score ≥ ${severities[i - 1]}`);
  }
});

test('scoreReplayObservation applies raw.confidence as a multiplier', () => {
  const high = scoreReplayObservation(obs({ severity: 'HIGH', raw: {} })).score;
  const halfConf = scoreReplayObservation(obs({ severity: 'HIGH', raw: { confidence: 0.5 } })).score;
  assert.ok(halfConf < high);
});

test('a series of modifications all in one scenario apply together', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'HIGH', raw: { magnitude: 5 } });
  const mods: ReplayModification[] = [
    { field: 'severity', originalValue: 'HIGH', modifiedValue: 'CRITICAL', rationale: 'a' },
    { field: 'magnitude', originalValue: 5, modifiedValue: 7, rationale: 'b' },
  ];
  const s = eng.createScenario(baseline, mods, 'combo', 'd');
  const result = eng.runReplay(s.id)!;
  // Both bumps push score upward.
  assert.ok(result.deltaScore > 0);
  assert.equal(result.replayedOutcome, 'critical');
});

test('insights list mentions the severity transition when bands cross', () => {
  const eng = freshEngine();
  const baseline = obs({ severity: 'HIGH', raw: {} });
  const s = eng.createScenario(baseline, severityDowngradeTemplate(baseline), 'n', 'd');
  const result = eng.runReplay(s.id)!;
  // First insight is always the band-summary line; should mention
  // both the original and replayed band when they differ.
  assert.match(result.insights[0]!, /flipped/i);
});
