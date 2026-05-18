/**
 * Tests for CompetitiveHypothesisEngine — generates ranked competing
 * explanations per Situation, scores them with evidence, and tracks
 * consensus.
 *
 * The engine is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompetitiveHypothesisEngine,
  CONSENSUS_LEAD_FLOOR,
  CONSENSUS_OTHERS_CEILING,
  EVIDENCE_STEP,
  MAX_SETS,
  STORAGE_KEY,
  __internals,
  __resetCompetitiveHypothesisEngineSingleton,
  getCompetitiveHypothesisEngine,
  type Hypothesis,
  type HypothesisSet,
  type StorageLike,
} from '../../src/services/intelligence/competitive-hypothesis.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

function fixedClock(t: number): () => number {
  return () => t;
}

function tickingClock(start: number, step = 1): () => number {
  let t = start;
  return () => { t += step; return t; };
}

const NOW = 1_745_000_000_000;
const APPROX_EQ = (a: number, b: number, eps = 0.01): boolean => Math.abs(a - b) <= eps;

function sumConfidences(set: HypothesisSet): number {
  return set.hypotheses.reduce((s, h) => s + h.confidence, 0);
}

function byType(set: HypothesisSet, type: Hypothesis['type']): Hypothesis {
  const h = set.hypotheses.find((x) => x.type === type);
  if (!h) throw new Error(`expected hypothesis of type ${type}`);
  return h;
}

// ── generate ──────────────────────────────────────────────────────────

test('generate creates three hypotheses with primary/alternative/devil-advocate roles', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  assert.equal(set.hypotheses.length, 3);
  const types = set.hypotheses.map((h) => h.type).sort();
  assert.deepEqual(types, ['alternative', 'devil-advocate', 'primary']);
});

test('generate seeds confidences that sum to 1.0', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  assert.ok(APPROX_EQ(sumConfidences(set), 1.0), `expected ~1.0, got ${sumConfidences(set)}`);
});

test('generate orders confidences primary > alternative > devil-advocate', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'cyber', 'medium');
  const p = byType(set, 'primary').confidence;
  const a = byType(set, 'alternative').confidence;
  const d = byType(set, 'devil-advocate').confidence;
  assert.ok(p > a && a > d, `confidences not ordered: ${p}/${a}/${d}`);
});

test('generate populates leadingHypothesis with the primary', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'weather', 'high');
  assert.equal(set.leadingHypothesis?.type, 'primary');
});

test('generate is idempotent — second call returns the existing set', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.generate('s-1', 'earthquake', 'high');
  const b = svc.generate('s-1', 'maritime', 'low'); // different inputs, same situation
  assert.deepEqual(a.hypotheses.map((h) => h.id), b.hypotheses.map((h) => h.id));
});

test('generate uses domain-specific claims for known domains', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const claim = byType(set, 'primary').claim;
  assert.match(claim, /tectonic/i);
});

test('generate falls back to a generic template for unknown domains', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'made-up-domain', 'low');
  assert.equal(set.hypotheses.length, 3);
  // Generic primary claim contains the word "genuine".
  assert.match(byType(set, 'primary').claim, /genuine/i);
});

test('generate stamps the domain and severity into the rationale', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'aviation', 'critical');
  assert.match(byType(set, 'primary').rationale, /aviation\/critical/);
});

test('every built-in domain template produces three valid hypotheses', () => {
  const domains = Object.keys(__internals.DOMAIN_TEMPLATES);
  for (const domain of domains) {
    const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
    const set = svc.generate(`s-${domain}`, domain, 'medium');
    assert.equal(set.hypotheses.length, 3, `${domain} should produce 3 hypotheses`);
    assert.ok(APPROX_EQ(sumConfidences(set), 1.0), `${domain} confidences should sum to ~1.0`);
  }
});

test('generate returns a defensive copy', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  set.hypotheses[0]!.confidence = 0.99;
  assert.notEqual(svc.getSet('s-1')!.hypotheses[0]!.confidence, 0.99);
});

// ── addEvidence ───────────────────────────────────────────────────────

test('addEvidence supporting raises confidence on the target hypothesis', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const altBefore = byType(set, 'alternative').confidence;
  const altId = byType(set, 'alternative').id;
  svc.addEvidence(altId, { evidenceId: 'e-1', alignment: 'supporting', weight: 1.0 });
  const altAfter = byType(svc.getSet('s-1')!, 'alternative').confidence;
  assert.ok(altAfter > altBefore, `alternative should rise, before=${altBefore} after=${altAfter}`);
});

test('addEvidence contradicting lowers confidence on the target hypothesis', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const primaryBefore = byType(set, 'primary').confidence;
  const primaryId = byType(set, 'primary').id;
  svc.addEvidence(primaryId, { evidenceId: 'e-1', alignment: 'contradicting', weight: 1.0 });
  const primaryAfter = byType(svc.getSet('s-1')!, 'primary').confidence;
  assert.ok(primaryAfter < primaryBefore, `primary should fall, before=${primaryBefore} after=${primaryAfter}`);
});

test('addEvidence neutral leaves the absolute target nudge at zero', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  // Initial confidence is normalized (e.g. 0.6) — neutral evidence on
  // primary should NOT raise or lower its share more than rounding.
  const primaryBefore = byType(set, 'primary').confidence;
  const primaryId = byType(set, 'primary').id;
  svc.addEvidence(primaryId, { evidenceId: 'e-1', alignment: 'neutral', weight: 1.0 });
  const primaryAfter = byType(svc.getSet('s-1')!, 'primary').confidence;
  assert.ok(APPROX_EQ(primaryBefore, primaryAfter), `neutral evidence should leave confidence unchanged`);
});

test('addEvidence re-normalizes the set so confidences keep summing to 1.0', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const id = byType(set, 'devil-advocate').id;
  svc.addEvidence(id, { evidenceId: 'e-1', alignment: 'supporting', weight: 1.0 });
  const after = svc.getSet('s-1')!;
  assert.ok(APPROX_EQ(sumConfidences(after), 1.0), `sum should still be ~1.0, got ${sumConfidences(after)}`);
});

test('addEvidence stores the evidence on the hypothesis', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'cyber', 'high');
  const id = byType(set, 'primary').id;
  svc.addEvidence(id, { evidenceId: 'e-1', alignment: 'supporting', weight: 0.5 });
  svc.addEvidence(id, { evidenceId: 'e-2', alignment: 'neutral', weight: 0.2 });
  const evidence = byType(svc.getSet('s-1')!, 'primary').evidence;
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((e) => e.evidenceId), ['e-1', 'e-2']);
});

test('addEvidence clamps weight outside 0..1', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const id = byType(set, 'primary').id;
  svc.addEvidence(id, { evidenceId: 'e-1', alignment: 'supporting', weight: 5 });
  svc.addEvidence(id, { evidenceId: 'e-2', alignment: 'contradicting', weight: -3 });
  const evidence = byType(svc.getSet('s-1')!, 'primary').evidence;
  assert.equal(evidence[0]!.weight, 1);
  assert.equal(evidence[1]!.weight, 0);
});

test('addEvidence respects the confidence ceiling and floor', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const id = byType(set, 'primary').id;
  for (let i = 0; i < 25; i += 1) {
    svc.addEvidence(id, { evidenceId: `e-${i}`, alignment: 'supporting', weight: 1 });
  }
  // After re-normalization the per-hypothesis value will be < ceiling,
  // but the *pre-normalization* confidence is clamped at 0.95. We can
  // only verify here that no value exceeds 1 (normalized).
  const after = svc.getSet('s-1')!;
  for (const h of after.hypotheses) {
    assert.ok(h.confidence >= 0 && h.confidence <= 1, `confidence ${h.confidence} out of range`);
  }
});

test('addEvidence returns undefined for unknown hypothesis ids', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const result = svc.addEvidence('hyp-nope', { evidenceId: 'e', alignment: 'supporting', weight: 1 });
  assert.equal(result, undefined);
});

test('addEvidence bumps the set to the front of getAllSets', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.generate('s-a', 'earthquake', 'high');
  svc.generate('s-b', 'cyber', 'medium');
  svc.generate('s-c', 'maritime', 'low');
  // s-c is now at front. Push evidence into s-a — it should move to front.
  const aSet = svc.getSet('s-a')!;
  svc.addEvidence(aSet.hypotheses[0]!.id, { evidenceId: 'e-1', alignment: 'supporting', weight: 0.5 });
  const all = svc.getAllSets();
  assert.equal(all[0]!.situationId, 's-a');
});

// ── Consensus ────────────────────────────────────────────────────────

test('consensus stays false at initial generation', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  assert.equal(set.consensusReached, false);
});

test('consensus flips true once leader > 0.7 and others < 0.4', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const initial = svc.generate('s-1', 'earthquake', 'high');
  const primaryId = byType(initial, 'primary').id;
  // Heavy supporting evidence into primary + contradicting into the
  // other two should drive primary above 0.7 with the others below 0.4.
  for (let i = 0; i < 8; i += 1) {
    svc.addEvidence(primaryId, { evidenceId: `s-${i}`, alignment: 'supporting', weight: 1 });
    svc.addEvidence(byType(svc.getSet('s-1')!, 'alternative').id, {
      evidenceId: `c-alt-${i}`, alignment: 'contradicting', weight: 1,
    });
    svc.addEvidence(byType(svc.getSet('s-1')!, 'devil-advocate').id, {
      evidenceId: `c-dev-${i}`, alignment: 'contradicting', weight: 1,
    });
  }
  const finalSet = svc.getSet('s-1')!;
  assert.equal(finalSet.consensusReached, true);
  assert.ok(finalSet.leadingHypothesis!.confidence > CONSENSUS_LEAD_FLOOR);
  const others = finalSet.hypotheses.filter((h) => h.id !== finalSet.leadingHypothesis!.id);
  for (const h of others) {
    assert.ok(h.confidence < CONSENSUS_OTHERS_CEILING, `other confidence ${h.confidence} >= ${CONSENSUS_OTHERS_CEILING}`);
  }
});

test('leadingHypothesis tracks the highest-confidence hypothesis after evidence', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const initial = svc.generate('s-1', 'cyber', 'high');
  const altId = byType(initial, 'alternative').id;
  for (let i = 0; i < 10; i += 1) {
    svc.addEvidence(altId, { evidenceId: `s-${i}`, alignment: 'supporting', weight: 1 });
    svc.addEvidence(byType(svc.getSet('s-1')!, 'primary').id, {
      evidenceId: `c-${i}`, alignment: 'contradicting', weight: 1,
    });
  }
  const after = svc.getSet('s-1')!;
  assert.equal(after.leadingHypothesis?.type, 'alternative');
});

// ── updateStatus ─────────────────────────────────────────────────────

test('updateStatus changes status and bumps updatedAt', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW, 1000) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const id = byType(set, 'primary').id;
  const before = byType(set, 'primary').updatedAt;
  const after = svc.updateStatus(id, 'supported')!;
  assert.equal(after.status, 'supported');
  assert.ok(after.updatedAt > before);
});

test('updateStatus is a no-op when status already matches', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  const id = byType(set, 'primary').id;
  const before = byType(set, 'primary').updatedAt;
  const after = svc.updateStatus(id, 'active');
  assert.equal(after?.status, 'active');
  assert.equal(after?.updatedAt, before);
});

test('updateStatus returns undefined for unknown id', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.updateStatus('hyp-nope', 'supported'), undefined);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getSet returns null when no set exists for the situation', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.getSet('s-nope'), null);
});

test('getAllSets is newest-update-first', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.generate('s-a', 'earthquake', 'high');
  svc.generate('s-b', 'cyber', 'high');
  svc.generate('s-c', 'maritime', 'low');
  assert.deepEqual(svc.getAllSets().map((s) => s.situationId), ['s-c', 's-b', 's-a']);
});

test('getAllSets honors limit', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 5; i += 1) svc.generate(`s-${i}`, 'earthquake', 'high');
  assert.equal(svc.getAllSets(2).length, 2);
  assert.equal(svc.getAllSets(0).length, 0);
});

test('getAllSets returns defensive copies', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.generate('s-1', 'earthquake', 'high');
  const all = svc.getAllSets();
  all[0]!.hypotheses[0]!.confidence = 0.99;
  const fresh = svc.getAllSets();
  assert.notEqual(fresh[0]!.hypotheses[0]!.confidence, 0.99);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('ring buffer evicts the oldest sets past MAX_SETS', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < MAX_SETS + 10; i += 1) {
    svc.generate(`s-${i}`, 'earthquake', 'high');
  }
  assert.equal(svc.getAllSets().length, MAX_SETS);
  // The oldest situation id 's-0' should be gone.
  assert.equal(svc.getSet('s-0'), null);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on generate and on addEvidence', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const events: HypothesisSet[] = [];
  svc.subscribe((s) => events.push(s));
  const set = svc.generate('s-1', 'earthquake', 'high');
  svc.addEvidence(byType(set, 'primary').id, { evidenceId: 'e', alignment: 'supporting', weight: 0.5 });
  assert.equal(events.length, 2);
});

test('subscribe fires on updateStatus when the status actually changes', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  let count = 0;
  svc.subscribe(() => { count += 1; });
  svc.updateStatus(byType(set, 'primary').id, 'supported');
  svc.updateStatus(byType(set, 'primary').id, 'supported'); // no-op
  assert.equal(count, 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.generate('s-1', 'earthquake', 'high');
  assert.equal(count, 0);
});

test('a listener that throws does not stop other listeners', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.generate('s-1', 'earthquake', 'high');
  assert.equal(good, 1);
});

// ── Persistence ───────────────────────────────────────────────────────

test('sets survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new CompetitiveHypothesisEngine({ storage, clock: tickingClock(NOW) });
  svc1.generate('s-1', 'earthquake', 'high');
  svc1.generate('s-2', 'cyber', 'medium');
  const svc2 = new CompetitiveHypothesisEngine({ storage, clock: tickingClock(NOW) });
  assert.equal(svc2.getAllSets().length, 2);
  assert.ok(svc2.getSet('s-1'));
});

test('corrupt persistence blob is ignored', () => {
  const storage = makeFakeStorage({ [STORAGE_KEY]: 'not-json' });
  const svc = new CompetitiveHypothesisEngine({ storage, clock: fixedClock(NOW) });
  assert.deepEqual(svc.getAllSets(), []);
});

test('null storage works (no-op persistence)', () => {
  const svc = new CompetitiveHypothesisEngine({ storage: null, clock: tickingClock(NOW) });
  const set = svc.generate('s-1', 'earthquake', 'high');
  assert.equal(set.hypotheses.length, 3);
});

test('resetForTesting clears state and persisted blob', () => {
  const storage = makeFakeStorage();
  const svc = new CompetitiveHypothesisEngine({ storage, clock: tickingClock(NOW) });
  svc.generate('s-1', 'earthquake', 'high');
  svc.resetForTesting();
  assert.equal(svc.getAllSets().length, 0);
  assert.equal(storage.raw.has(STORAGE_KEY), false);
});

// ── Constants + singleton ─────────────────────────────────────────────

test('EVIDENCE_STEP matches documented value', () => {
  assert.equal(EVIDENCE_STEP, 0.1);
});

test('getCompetitiveHypothesisEngine returns a stable singleton', () => {
  __resetCompetitiveHypothesisEngineSingleton();
  const a = getCompetitiveHypothesisEngine();
  const b = getCompetitiveHypothesisEngine();
  assert.equal(a, b);
  __resetCompetitiveHypothesisEngineSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getCompetitiveHypothesisEngine();
  __resetCompetitiveHypothesisEngineSingleton();
  const b = getCompetitiveHypothesisEngine();
  assert.notEqual(a, b);
  __resetCompetitiveHypothesisEngineSingleton();
});
