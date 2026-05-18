import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExperimentManager,
  STORAGE_KEY,
  OBSERVATIONS_STORAGE_KEY,
  MAX_OBSERVATIONS,
  SIGNIFICANCE_LIFT_THRESHOLD,
  SIGNIFICANCE_MIN_SAMPLE,
  type Experiment,
} from '../../src/services/intelligence/experiment-manager.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-17T12:00:00Z');
const NOW_MS = NOW.getTime();

function baseDraft(overrides: Partial<Omit<Experiment, 'id' | 'status' | 'createdAt' | 'startedAt' | 'concludedAt'>> = {}) {
  return {
    name: 'Test experiment',
    description: 'Compare new scoring weights against control.',
    algorithmId: 'truth-score',
    trafficSplit: 0.5,
    hypothesis: 'New weights improve positive outcomes by 10%.',
    successMetric: 'positive-rate',
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-experiments"', () => {
  assert.equal(STORAGE_KEY, 'wm-experiments');
});

test('OBSERVATIONS_STORAGE_KEY is "wm-experiment-observations"', () => {
  assert.equal(OBSERVATIONS_STORAGE_KEY, 'wm-experiment-observations');
});

test('MAX_OBSERVATIONS is 5000', () => {
  assert.equal(MAX_OBSERVATIONS, 5000);
});

test('SIGNIFICANCE_LIFT_THRESHOLD is 0.05', () => {
  assert.equal(SIGNIFICANCE_LIFT_THRESHOLD, 0.05);
});

test('SIGNIFICANCE_MIN_SAMPLE is 30', () => {
  assert.equal(SIGNIFICANCE_MIN_SAMPLE, 30);
});

// ── create ───────────────────────────────────────────────────────────────

test('create assigns id, status=draft, createdAt=now', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const exp = svc.create(baseDraft());
  assert.ok(exp.id);
  assert.equal(exp.status, 'draft');
  assert.equal(exp.createdAt.getTime(), NOW_MS);
});

test('create preserves name/description/algorithmId/hypothesis/successMetric/trafficSplit', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const exp = svc.create(baseDraft({ name: 'Foo', trafficSplit: 0.3 }));
  assert.equal(exp.name, 'Foo');
  assert.equal(exp.trafficSplit, 0.3);
  assert.equal(exp.algorithmId, 'truth-score');
  assert.equal(exp.hypothesis, 'New weights improve positive outcomes by 10%.');
});

test('create assigns unique ids', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) ids.add(svc.create(baseDraft()).id);
  assert.equal(ids.size, 5);
});

test('create has no startedAt or concludedAt', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const exp = svc.create(baseDraft());
  assert.equal(exp.startedAt, undefined);
  assert.equal(exp.concludedAt, undefined);
});

// ── start ────────────────────────────────────────────────────────────────

test('start transitions draft to running, sets startedAt', () => {
  let t = NOW_MS;
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => t });
  const draft = svc.create(baseDraft());
  t += 60_000;
  const running = svc.start(draft.id);
  assert.equal(running.status, 'running');
  assert.equal(running.startedAt?.getTime(), NOW_MS + 60_000);
});

test('start throws on concluded experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.conclude(draft.id);
  assert.throws(() => svc.start(draft.id), /draft/);
});

test('start throws on already-running experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  assert.throws(() => svc.start(draft.id), /draft/);
});

test('start throws on paused experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.pause(draft.id);
  assert.throws(() => svc.start(draft.id), /draft/);
});

test('start throws on unknown id', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.throws(() => svc.start('does-not-exist'), /not found/);
});

// ── pause / resume ───────────────────────────────────────────────────────

test('pause transitions running to paused', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  const paused = svc.pause(draft.id);
  assert.equal(paused.status, 'paused');
});

test('pause throws on draft experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  assert.throws(() => svc.pause(draft.id), /running/);
});

test('pause throws on concluded experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.conclude(draft.id);
  assert.throws(() => svc.pause(draft.id), /running/);
});

test('resume transitions paused to running', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.pause(draft.id);
  const resumed = svc.resume(draft.id);
  assert.equal(resumed.status, 'running');
});

test('resume throws on draft experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  assert.throws(() => svc.resume(draft.id), /paused/);
});

test('resume throws on running experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  assert.throws(() => svc.resume(draft.id), /paused/);
});

// ── conclude ─────────────────────────────────────────────────────────────

test('conclude transitions running to concluded with concludedAt set', () => {
  let t = NOW_MS;
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => t });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  t += 3_600_000;
  const concluded = svc.conclude(draft.id);
  assert.equal(concluded.status, 'concluded');
  assert.equal(concluded.concludedAt?.getTime(), NOW_MS + 3_600_000);
});

test('conclude transitions paused to concluded', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.pause(draft.id);
  const concluded = svc.conclude(draft.id);
  assert.equal(concluded.status, 'concluded');
});

test('conclude throws on draft experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  assert.throws(() => svc.conclude(draft.id), /running|paused/);
});

test('conclude throws on already-concluded experiment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.conclude(draft.id);
  assert.throws(() => svc.conclude(draft.id), /running|paused/);
});

// ── assignArm ────────────────────────────────────────────────────────────

test('assignArm returns deterministic arm for same inputHash', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  const a1 = svc.assignArm(draft.id, 'user-abc-123');
  const a2 = svc.assignArm(draft.id, 'user-abc-123');
  assert.equal(a1, a2);
});

test('assignArm returns control or treatment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  const arm = svc.assignArm(draft.id, 'user-xyz');
  assert.ok(arm === 'control' || arm === 'treatment');
});

test('assignArm with trafficSplit=0 always returns control', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft({ trafficSplit: 0 }));
  svc.start(draft.id);
  for (let i = 0; i < 20; i++) {
    assert.equal(svc.assignArm(draft.id, `input-${i}`), 'control');
  }
});

test('assignArm with trafficSplit=1 always returns treatment', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft({ trafficSplit: 1 }));
  svc.start(draft.id);
  for (let i = 0; i < 20; i++) {
    assert.equal(svc.assignArm(draft.id, `input-${i}`), 'treatment');
  }
});

test('assignArm distributes roughly per trafficSplit across many hashes', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft({ trafficSplit: 0.5 }));
  svc.start(draft.id);
  let treatment = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    if (svc.assignArm(draft.id, `user-${i}`) === 'treatment') treatment += 1;
  }
  // 50% with tolerance — uniform hash should land within ±10%.
  assert.ok(treatment > N * 0.4 && treatment < N * 0.6, `treatment=${treatment} out of 50% window`);
});

test('assignArm throws when experiment is not running (draft)', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  assert.throws(() => svc.assignArm(draft.id, 'h'), /running/);
});

test('assignArm throws when experiment is paused', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.pause(draft.id);
  assert.throws(() => svc.assignArm(draft.id, 'h'), /running/);
});

test('assignArm throws when experiment is concluded', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.conclude(draft.id);
  assert.throws(() => svc.assignArm(draft.id, 'h'), /running/);
});

test('assignArm throws on unknown experiment id', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.throws(() => svc.assignArm('nope', 'h'), /not found/);
});

// ── recordObservation ────────────────────────────────────────────────────

test('recordObservation stores arm/outcome/inputHash/recordedAt', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: 'h1', outcome: 'positive' });
  const obs = svc.getObservations(draft.id);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.arm, 'control');
  assert.equal(obs[0]?.outcome, 'positive');
  assert.equal(obs[0]?.inputHash, 'h1');
  assert.equal(obs[0]?.recordedAt.getTime(), NOW_MS);
});

test('recordObservation assigns unique observation ids', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: 'h1', outcome: 'positive' });
  svc.recordObservation({ experimentId: draft.id, arm: 'treatment', inputHash: 'h2', outcome: 'negative' });
  const obs = svc.getObservations(draft.id);
  assert.notEqual(obs[0]?.id, obs[1]?.id);
});

test('recordObservation ring-buffer evicts oldest at MAX_OBSERVATIONS', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < MAX_OBSERVATIONS + 50; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'control',
      inputHash: `h${i}`,
      outcome: 'positive',
    });
  }
  const obs = svc.getObservations(draft.id, MAX_OBSERVATIONS + 100);
  assert.equal(obs.length, MAX_OBSERVATIONS);
});

// ── getResult ────────────────────────────────────────────────────────────

test('getResult returns insufficient-data when sampleSize < 30', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 10; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `c${i}`, outcome: 'positive' });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.recommendation, 'insufficient-data');
  assert.equal(r.isSignificant, false);
});

test('getResult.lift = treatmentPositiveRate - controlPositiveRate', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  // 20 control: 10 positive (0.5), 20 treatment: 16 positive (0.8) → lift = 0.3
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'control',
      inputHash: `c${i}`,
      outcome: i < 10 ? 'positive' : 'negative',
    });
  }
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'treatment',
      inputHash: `t${i}`,
      outcome: i < 16 ? 'positive' : 'negative',
    });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.controlPositiveRate, 0.5);
  assert.equal(r.treatmentPositiveRate, 0.8);
  assert.ok(Math.abs(r.lift - 0.3) < 1e-9, `lift=${r.lift}`);
});

test('getResult.recommendation=graduate when significant + lift > 0', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'control',
      inputHash: `c${i}`,
      outcome: i < 8 ? 'positive' : 'negative',
    });
  }
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'treatment',
      inputHash: `t${i}`,
      outcome: i < 16 ? 'positive' : 'negative',
    });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.isSignificant, true);
  assert.equal(r.recommendation, 'graduate');
});

test('getResult.recommendation=reject when significant + lift < 0', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'control',
      inputHash: `c${i}`,
      outcome: i < 16 ? 'positive' : 'negative',
    });
  }
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'treatment',
      inputHash: `t${i}`,
      outcome: i < 8 ? 'positive' : 'negative',
    });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.isSignificant, true);
  assert.equal(r.recommendation, 'reject');
});

test('getResult.recommendation=continue when sample>=30 but lift below threshold', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  // 20 control 10 positive (0.5), 25 treatment 13 positive (0.52) → lift=0.02, NOT > threshold
  for (let i = 0; i < 20; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'control',
      inputHash: `c${i}`,
      outcome: i < 10 ? 'positive' : 'negative',
    });
  }
  for (let i = 0; i < 25; i++) {
    svc.recordObservation({
      experimentId: draft.id,
      arm: 'treatment',
      inputHash: `t${i}`,
      outcome: i < 13 ? 'positive' : 'negative',
    });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.isSignificant, false);
  assert.equal(r.recommendation, 'continue');
});

test('getResult.sampleSize counts only control+treatment observations', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 7; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `c${i}`, outcome: 'positive' });
  }
  for (let i = 0; i < 13; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'treatment', inputHash: `t${i}`, outcome: 'negative' });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.sampleSize, 20);
});

test('getResult positive rate treats neutral as non-positive', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 4; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `c${i}`, outcome: 'positive' });
  }
  for (let i = 0; i < 6; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `cn${i}`, outcome: 'neutral' });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.controlPositiveRate, 0.4);
});

test('getResult with zero control observations sets controlPositiveRate=0', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 5; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'treatment', inputHash: `t${i}`, outcome: 'positive' });
  }
  const r = svc.getResult(draft.id);
  assert.equal(r.controlPositiveRate, 0);
});

// ── getExperiments / getObservations ─────────────────────────────────────

test('getExperiments returns all when no filter', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.create(baseDraft());
  svc.create(baseDraft({ name: 'B' }));
  assert.equal(svc.getExperiments().length, 2);
});

test('getExperiments filters by status', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const a = svc.create(baseDraft({ name: 'A' }));
  svc.create(baseDraft({ name: 'B' }));
  svc.start(a.id);
  assert.equal(svc.getExperiments('draft').length, 1);
  assert.equal(svc.getExperiments('running').length, 1);
  assert.equal(svc.getExperiments('paused').length, 0);
});

test('getObservations returns LIFO (newest first)', () => {
  let t = NOW_MS;
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => t });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 3; i++) {
    t += 1000;
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `c${i}`, outcome: 'positive' });
  }
  const obs = svc.getObservations(draft.id);
  assert.equal(obs[0]?.inputHash, 'c2');
  assert.equal(obs[1]?.inputHash, 'c1');
  assert.equal(obs[2]?.inputHash, 'c0');
});

test('getObservations respects limit', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  svc.start(draft.id);
  for (let i = 0; i < 10; i++) {
    svc.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: `c${i}`, outcome: 'positive' });
  }
  assert.equal(svc.getObservations(draft.id, 3).length, 3);
});

test('getObservations filters by experimentId', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const a = svc.create(baseDraft({ name: 'A' }));
  const b = svc.create(baseDraft({ name: 'B' }));
  svc.start(a.id);
  svc.start(b.id);
  svc.recordObservation({ experimentId: a.id, arm: 'control', inputHash: 'h1', outcome: 'positive' });
  svc.recordObservation({ experimentId: b.id, arm: 'treatment', inputHash: 'h2', outcome: 'negative' });
  const aObs = svc.getObservations(a.id);
  assert.equal(aObs.length, 1);
  assert.equal(aObs[0]?.experimentId, a.id);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on create', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.create(baseDraft());
  assert.ok(calls >= 1);
});

test('subscribe is notified on lifecycle change', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  const draft = svc.create(baseDraft());
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.start(draft.id);
  svc.pause(draft.id);
  svc.resume(draft.id);
  svc.conclude(draft.id);
  assert.ok(calls >= 4);
});

test('unsubscribe stops notifications', () => {
  const svc = createExperimentManager({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.create(baseDraft());
  assert.equal(calls, 0);
});

// ── persistence ──────────────────────────────────────────────────────────

test('experiments persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createExperimentManager({ storage, now: () => NOW_MS });
  const draft = svc1.create(baseDraft({ name: 'Persisted' }));
  svc1.start(draft.id);

  const svc2 = createExperimentManager({ storage, now: () => NOW_MS });
  const list = svc2.getExperiments();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'Persisted');
  assert.equal(list[0]?.status, 'running');
});

test('observations persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createExperimentManager({ storage, now: () => NOW_MS });
  const draft = svc1.create(baseDraft());
  svc1.start(draft.id);
  svc1.recordObservation({ experimentId: draft.id, arm: 'control', inputHash: 'h1', outcome: 'positive' });

  const svc2 = createExperimentManager({ storage, now: () => NOW_MS });
  const obs = svc2.getObservations(draft.id);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.inputHash, 'h1');
});
