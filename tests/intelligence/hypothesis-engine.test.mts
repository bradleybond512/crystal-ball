/**
 * Tests for the competitive Hypothesis Engine (Phase 4).
 *
 * Service-only tests (no DOM). Stubs localStorage at module load so
 * hydration + persistence paths are reachable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// localStorage stub — must be installed before importing the engine.
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
  HypothesisEngine,
  __internals,
  __resetHypothesisEngineSingleton,
  getHypothesisEngine,
  type Hypothesis,
  type HypothesisSet,
} from '../../src/services/intelligence/hypothesis-engine.ts';
import { templatesForDomain } from '../../src/services/intelligence/hypothesis-templates.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeObservation(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'test',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test observation',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function makeSituation(
  overrides: Partial<Situation> = {},
): Situation {
  const observations = overrides.observations ?? [makeObservation({ id: 'a' })];
  return {
    id: 'sit-1',
    name: 'Test situation',
    domain: 'earthquake',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    summary: 'Test',
    observations,
    edges: [],
    entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

function freshEngine(): HypothesisEngine {
  __storage.clear();
  return new HypothesisEngine({ clock: () => NOW });
}

function topPosterior(set: HypothesisSet): Hypothesis {
  return [...set.hypotheses].sort((a, b) => b.posteriorProbability - a.posteriorProbability)[0]!;
}

// ── generateHypotheses: shape ────────────────────────────────────────

test('generateHypotheses produces at most 3 hypotheses per set', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  assert.ok(set.hypotheses.length <= 3, `got ${set.hypotheses.length}`);
  assert.ok(set.hypotheses.length >= 2, 'expected at least 2 hypotheses');
});

test('generateHypotheses produces unique labels', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation({ domain: 'maritime' }));
  const labels = set.hypotheses.map((h) => h.label);
  assert.equal(new Set(labels).size, labels.length);
});

test('generateHypotheses returns leading hypothesis with highest posterior', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  const leading = set.hypotheses.find((h) => h.status === 'leading')!;
  for (const other of set.hypotheses) {
    if (other.id === leading.id) continue;
    assert.ok(leading.posteriorProbability >= other.posteriorProbability);
  }
});

test('generateHypotheses posteriors sum to ~1 across the set', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  const sum = set.hypotheses.reduce((acc, h) => acc + h.posteriorProbability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-3, `sum=${sum}`);
});

test('generateHypotheses with no tags still produces a valid set anchored on priors', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation({
    observations: [makeObservation({ id: 'a', tags: [] })],
  }));
  assert.ok(set.hypotheses.length >= 2);
  // The leading hypothesis with no evidence should still come from the
  // template with the highest prior.
  assert.equal(set.hypotheses[0]!.status, 'leading');
});

test('generateHypotheses persists support counts based on tag matching', () => {
  const engine = freshEngine();
  // tags match "natural seismic event" supporting fragments (e.g. 'tectonic')
  const set = engine.generateHypotheses(makeSituation({
    observations: [
      makeObservation({ id: 'a', tags: ['tectonic'] }),
      makeObservation({ id: 'b', tags: ['mainshock'] }),
    ],
  }));
  const natural = set.hypotheses.find((h) => /Natural/i.test(h.label))!;
  assert.ok(natural.supportingObservationIds.length >= 2);
});

test('generateHypotheses can promote a non-default hypothesis when evidence pushes it ahead', () => {
  const engine = freshEngine();
  // Heavy 'induced' tags should beat the higher-prior 'Natural' template
  // because the natural template explicitly contradicts on 'induced'.
  const set = engine.generateHypotheses(makeSituation({
    observations: [
      makeObservation({ id: 'a', tags: ['induced', 'injection-well', 'shallow'] }),
      makeObservation({ id: 'b', tags: ['induced', 'injection-well', 'shallow'] }),
      makeObservation({ id: 'c', tags: ['injection', 'shallow', 'induced'] }),
    ],
  }));
  const leading = set.hypotheses.find((h) => h.status === 'leading')!;
  assert.match(leading.label, /Induced/i);
});

// ── Status assignment ───────────────────────────────────────────────

test('only one hypothesis can be marked leading', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  const leadingCount = set.hypotheses.filter((h) => h.status === 'leading').length;
  assert.equal(leadingCount, 1);
});

test('non-leading hypotheses are contending or eliminated', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  for (const h of set.hypotheses) {
    if (h.status === 'leading') continue;
    assert.ok(['contending', 'eliminated'].includes(h.status));
  }
});

test('hypothesis below 0.1 normalized posterior is marked eliminated with reason', () => {
  const engine = freshEngine();
  // Strong support for one template + strong contradictions for the
  // others should drive several below threshold.
  const set = engine.generateHypotheses(makeSituation({
    observations: [
      makeObservation({ id: 'a', tags: ['tectonic', 'mainshock'] }),
      makeObservation({ id: 'b', tags: ['tectonic', 'mainshock'] }),
      makeObservation({ id: 'c', tags: ['tectonic', 'mainshock'] }),
      makeObservation({ id: 'd', tags: ['tectonic', 'mainshock'] }),
      makeObservation({ id: 'e', tags: ['tectonic', 'mainshock'] }),
      // Hammer the alternates' contradicting fragments.
      makeObservation({ id: 'f', tags: ['precursor', 'aftershock'] }),
      makeObservation({ id: 'g', tags: ['precursor', 'aftershock'] }),
      makeObservation({ id: 'h', tags: ['precursor', 'aftershock'] }),
    ],
  }));
  const eliminated = set.hypotheses.find((h) => h.status === 'eliminated');
  if (eliminated) {
    assert.ok(eliminated.eliminatedReason && eliminated.eliminatedReason.length > 0);
  }
  // At minimum, no eliminated hypothesis has posterior >= 0.1
  for (const h of set.hypotheses) {
    if (h.status === 'eliminated') assert.ok(h.posteriorProbability < 0.1);
  }
});

// ── rivalryScore + consensusReached ─────────────────────────────────

test('rivalryScore is high when top-2 hypotheses are close', () => {
  // Construct posteriors directly via internals to isolate the metric.
  const a: Hypothesis = baseHyp({ posteriorProbability: 0.45 });
  const b: Hypothesis = baseHyp({ posteriorProbability: 0.42 });
  const score = __internals.computeRivalryScore([a, b]);
  assert.ok(score > 0.85, `score=${score}`);
});

test('rivalryScore is low when leading dominates', () => {
  const a: Hypothesis = baseHyp({ posteriorProbability: 0.9 });
  const b: Hypothesis = baseHyp({ posteriorProbability: 0.05 });
  const score = __internals.computeRivalryScore([a, b]);
  assert.ok(score < 0.2, `score=${score}`);
});

test('rivalryScore is 0 with fewer than 2 hypotheses', () => {
  assert.equal(__internals.computeRivalryScore([]), 0);
  assert.equal(__internals.computeRivalryScore([baseHyp({ posteriorProbability: 0.9 })]), 0);
});

test('consensusReached when leader > 0.75 and second < 0.2', () => {
  const ok = __internals.hasConsensus([
    baseHyp({ posteriorProbability: 0.8 }),
    baseHyp({ posteriorProbability: 0.1 }),
  ]);
  assert.equal(ok, true);
});

test('consensusReached false when second hypothesis is above 0.2', () => {
  const result = __internals.hasConsensus([
    baseHyp({ posteriorProbability: 0.8 }),
    baseHyp({ posteriorProbability: 0.25 }),
  ]);
  assert.equal(result, false);
});

test('consensusReached false when leader does not clear 0.75', () => {
  const result = __internals.hasConsensus([
    baseHyp({ posteriorProbability: 0.7 }),
    baseHyp({ posteriorProbability: 0.1 }),
  ]);
  assert.equal(result, false);
});

// ── confidence interval ─────────────────────────────────────────────

test('confidence interval lower bound ≥ 0 and upper ≤ 1', () => {
  const engine = freshEngine();
  const set = engine.generateHypotheses(makeSituation());
  for (const h of set.hypotheses) {
    assert.ok(h.confidenceInterval[0] >= 0);
    assert.ok(h.confidenceInterval[1] <= 1);
    assert.ok(h.confidenceInterval[0] <= h.confidenceInterval[1]);
  }
});

test('CI narrows as supporting observations accumulate', () => {
  const narrow = __internals.betaConfidenceInterval(50, 0);
  const wide = __internals.betaConfidenceInterval(0, 0);
  const narrowWidth = narrow[1] - narrow[0];
  const wideWidth = wide[1] - wide[0];
  assert.ok(narrowWidth < wideWidth, `narrow=${narrowWidth} wide=${wideWidth}`);
});

// ── Bayesian update ─────────────────────────────────────────────────

test('bayesianPosterior returns prior when no evidence', () => {
  const p = __internals.bayesianPosterior(0.4, 0, 0);
  assert.equal(p, 0.4);
});

test('bayesianPosterior decreases with contradicting evidence', () => {
  const supportOnly = __internals.bayesianPosterior(0.5, 3, 0);
  const contradicted = __internals.bayesianPosterior(0.5, 3, 5);
  assert.ok(contradicted < supportOnly);
});

test('bayesianPosterior clamps to [0, 1] even at the asymptotes', () => {
  const infiniteSupport = __internals.bayesianPosterior(0.5, Infinity, 0);
  assert.ok(infiniteSupport >= 0 && infiniteSupport <= 1, `out of range: ${infiniteSupport}`);
  assert.equal(__internals.bayesianPosterior(-1, 0, 0), 0);
  assert.equal(__internals.bayesianPosterior(2, 0, 0), 1);
});

// ── updateHypotheses ────────────────────────────────────────────────

test('updateHypotheses returns undefined for unknown situation', () => {
  const engine = freshEngine();
  assert.equal(engine.updateHypotheses('does-not-exist', []), undefined);
});

test('updateHypotheses re-ranks on new evidence', () => {
  const engine = freshEngine();
  engine.generateHypotheses(makeSituation({
    observations: [makeObservation({ id: 'a', tags: [] })],
  }));
  // Feed strong "induced" evidence to flip the leader.
  const updated = engine.updateHypotheses('sit-1', [
    makeObservation({ id: 'b', tags: ['induced', 'shallow', 'injection-well'] }),
    makeObservation({ id: 'c', tags: ['induced', 'shallow', 'injection-well'] }),
    makeObservation({ id: 'd', tags: ['induced', 'shallow', 'injection-well'] }),
  ])!;
  const leading = topPosterior(updated);
  assert.match(leading.label, /Induced/i);
});

test('updateHypotheses does not duplicate observation IDs in support lists', () => {
  const engine = freshEngine();
  engine.generateHypotheses(makeSituation({
    observations: [makeObservation({ id: 'a', tags: ['tectonic'] })],
  }));
  engine.updateHypotheses('sit-1', [makeObservation({ id: 'a', tags: ['tectonic'] })])!;
  const set = engine.getHypothesisSet('sit-1')!;
  const natural = set.hypotheses.find((h) => /Natural/i.test(h.label))!;
  const unique = new Set(natural.supportingObservationIds);
  assert.equal(unique.size, natural.supportingObservationIds.length);
});

// ── getHypothesisSet / getAllSets ──────────────────────────────────

test('getHypothesisSet returns the stored set or undefined', () => {
  const engine = freshEngine();
  assert.equal(engine.getHypothesisSet('missing'), undefined);
  engine.generateHypotheses(makeSituation());
  assert.ok(engine.getHypothesisSet('sit-1'));
});

test('getAllSets returns all stored sets', () => {
  const engine = freshEngine();
  engine.generateHypotheses(makeSituation({ id: 's1' }));
  engine.generateHypotheses(makeSituation({ id: 's2', domain: 'cyber' }));
  assert.equal(engine.getAllSets().length, 2);
});

test('getHypothesisSet returns a defensive copy — mutating it does not corrupt the engine', () => {
  const engine = freshEngine();
  engine.generateHypotheses(makeSituation());
  const set = engine.getHypothesisSet('sit-1')!;
  set.hypotheses.length = 0;
  assert.equal(engine.getHypothesisSet('sit-1')!.hypotheses.length > 0, true);
});

// ── subscribe ────────────────────────────────────────────────────────

test('subscribe fires the listener on generate', () => {
  const engine = freshEngine();
  let calls = 0;
  engine.subscribe(() => { calls += 1; });
  engine.generateHypotheses(makeSituation());
  assert.equal(calls, 1);
});

test('subscribe fires the listener on update', () => {
  const engine = freshEngine();
  engine.generateHypotheses(makeSituation());
  let calls = 0;
  engine.subscribe(() => { calls += 1; });
  engine.updateHypotheses('sit-1', [makeObservation({ id: 'b' })]);
  assert.equal(calls, 1);
});

test('subscribe returns an unsubscribe fn', () => {
  const engine = freshEngine();
  let calls = 0;
  const unsubscribe = engine.subscribe(() => { calls += 1; });
  engine.generateHypotheses(makeSituation());
  unsubscribe();
  engine.generateHypotheses(makeSituation({ id: 's2' }));
  assert.equal(calls, 1);
});

test('subscribe: listener exception does not break the broadcast', () => {
  const engine = freshEngine();
  let second = false;
  engine.subscribe(() => { throw new Error('boom'); });
  engine.subscribe(() => { second = true; });
  engine.generateHypotheses(makeSituation());
  assert.equal(second, true);
});

// ── persistence ─────────────────────────────────────────────────────

test('hypothesis sets persist across engine instances', () => {
  __storage.clear();
  const a = new HypothesisEngine({ clock: () => NOW });
  a.generateHypotheses(makeSituation());
  const b = new HypothesisEngine({ clock: () => NOW });
  const set = b.getHypothesisSet('sit-1');
  assert.ok(set, 'expected persisted set on new instance');
  assert.equal(set!.hypotheses.length > 0, true);
});

test('corrupt localStorage payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-hypothesis-sets', 'not-json');
  const engine = new HypothesisEngine({ clock: () => NOW });
  assert.equal(engine.getAllSets().length, 0);
});

// ── templates + singleton ───────────────────────────────────────────

test('templatesForDomain returns generic fallback for unknown domains', () => {
  const t = templatesForDomain('unmapped-domain');
  assert.ok(t.length >= 3);
  // Generic bank contains "Isolated incident"
  assert.ok(t.some((x) => /Isolated incident/i.test(x.label)));
});

test('templatesForDomain returns the earthquake bank for "earthquake"', () => {
  const t = templatesForDomain('earthquake');
  assert.ok(t.some((x) => /Natural seismic/i.test(x.label)));
});

test('templatesForDomain returns a fresh array each call (safe to mutate)', () => {
  const t1 = templatesForDomain('weather');
  t1.length = 0;
  const t2 = templatesForDomain('weather');
  assert.ok(t2.length > 0);
});

test('getHypothesisEngine returns a stable singleton', () => {
  __resetHypothesisEngineSingleton();
  const a = getHypothesisEngine();
  const b = getHypothesisEngine();
  assert.equal(a, b);
});

// ── Helpers for tests ────────────────────────────────────────────────

function baseHyp(overrides: Partial<Hypothesis>): Hypothesis {
  return {
    id: 'h',
    situationId: 's',
    label: 'L',
    description: 'D',
    supportingObservationIds: [],
    contradictingObservationIds: [],
    priorProbability: 0.5,
    posteriorProbability: 0.5,
    confidenceInterval: [0, 1],
    status: 'contending',
    generatedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

// ── Teardown ────────────────────────────────────────────────────────

test('teardown clears singleton + storage', () => {
  __resetHypothesisEngineSingleton();
  __storage.clear();
  assert.ok(true);
});
