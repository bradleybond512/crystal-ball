/**
 * Tests for MultiAgentReviewService — Phase 4 6-perspective consensus.
 *
 * Run with: npx tsx --test tests/intelligence/multi-agent-review.test.mts
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
  AGENT_PERSPECTIVES,
  MultiAgentReviewService,
  __resetMultiAgentReviewSingleton,
  getMultiAgentReviewService,
  __internals as serviceInternals,
  type AgentPerspective,
  type Hypothesis,
  type HypothesisSet,
} from '../../src/services/intelligence/multi-agent-review.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'src-a',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'sample observation',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  // Default: two observations from two sources, no contradictions,
  // earthquake domain, severity critical, low staleness. Designed so
  // the maximum number of perspectives can agree (skeptic always
  // disagrees, so the ceiling is 5/6).
  const observations: ObservationEvent[] = [
    obs({ id: 'o1', sourceId: 'src-a', timestamp: NOW - 60_000 }),
    obs({ id: 'o2', sourceId: 'src-b', timestamp: NOW - 90_000 }),
    obs({ id: 'o3', sourceId: 'src-c', timestamp: NOW - 120_000 }),
  ];
  return {
    id: 'sit-1',
    name: 'leading framing',
    domain: 'earthquake',
    relatedDomains: [],
    severity: 'critical',
    status: 'active',
    summary: 'sample situation',
    observations,
    edges: [],
    entityIds: [],
    confidence: 0.85,
    startedAt: new Date(NOW - 300_000),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

function hypothesisSet(leadingPosterior = 0.85, altPosterior = 0.1): HypothesisSet {
  const leading: Hypothesis = {
    id: 'h-leading',
    situationId: 'sit-1',
    label: 'main framing',
    description: 'leading hypothesis',
    supportingObservationIds: ['o1', 'o2'],
    contradictingObservationIds: [],
    priorProbability: 0.5,
    posteriorProbability: leadingPosterior,
    confidenceInterval: [leadingPosterior - 0.1, leadingPosterior + 0.05],
    status: 'leading',
    generatedAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
  const contender: Hypothesis = {
    id: 'h-alt',
    situationId: 'sit-1',
    label: 'alternative framing',
    description: 'low-likelihood alternative',
    supportingObservationIds: [],
    contradictingObservationIds: ['o1'],
    priorProbability: 0.3,
    posteriorProbability: altPosterior,
    confidenceInterval: [altPosterior - 0.05, altPosterior + 0.05],
    status: 'contending',
    generatedAt: new Date(NOW),
    updatedAt: new Date(NOW),
  };
  return {
    situationId: 'sit-1',
    hypotheses: [leading, contender],
    rivalryScore: 0.4,
    consensusReached: false,
    lastUpdated: new Date(NOW),
  };
}

function freshService(now = NOW): MultiAgentReviewService {
  __storage.clear();
  __resetMultiAgentReviewSingleton();
  return new MultiAgentReviewService({ clock: () => now });
}

function reviewByPerspective(
  service: MultiAgentReviewService,
  s: Situation,
  set?: HypothesisSet,
): Record<AgentPerspective, ReturnType<MultiAgentReviewService['reviewSituation']>['reviews'][number]> {
  const consensus = service.reviewSituation(s, set);
  const map = {} as Record<AgentPerspective, typeof consensus.reviews[number]>;
  for (const r of consensus.reviews) map[r.perspective] = r;
  return map;
}

// ── Shape & per-perspective ──────────────────────────────────────────

test('reviewSituation produces exactly one review per perspective (6 total)', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation(), hypothesisSet());
  assert.equal(consensus.reviews.length, 6);
  const seen = new Set(consensus.reviews.map((r) => r.perspective));
  assert.equal(seen.size, 6);
  for (const p of AGENT_PERSPECTIVES) assert.ok(seen.has(p), `missing ${p}`);
});

test('AGENT_PERSPECTIVES exposes the 6 perspectives', () => {
  assert.equal(AGENT_PERSPECTIVES.length, 6);
});

test('every review has assessment / keyInsight / generatedAt / id', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation(), hypothesisSet());
  for (const r of consensus.reviews) {
    assert.ok(r.id.length > 0);
    assert.ok(r.assessment.length > 0);
    assert.ok(r.keyInsight.length > 0);
    assert.ok(r.generatedAt instanceof Date);
    assert.ok(r.confidenceInAssessment >= 0 && r.confidenceInAssessment <= 1);
  }
});

test('skeptic always disagrees OR carries flaggedBiases', () => {
  const svc = freshService();
  // Run across several situation shapes so we know the rule holds regardless of inputs.
  const samples = [
    situation(),
    situation({ confidence: 0.4, severity: 'low' }),
    situation({ observations: [obs({ sourceId: 'only-src' })], confidence: 0.95 }),
    situation({ edges: [{ type: 'contradicts', sourceEventId: 'o1', targetEventId: 'o2', confidence: 0.6 }] }),
  ];
  for (const s of samples) {
    const map = reviewByPerspective(svc, s);
    const skeptic = map.skeptic;
    assert.ok(
      skeptic.agreedWithLeading === false || (skeptic.flaggedBiases?.length ?? 0) > 0,
      'skeptic must disagree or flag a bias',
    );
  }
});

test("devil-advocate alternativeLabel differs from the leading hypothesis", () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation(), hypothesisSet());
  const devil = map['devil-advocate'];
  assert.ok(devil.alternativeLabel);
  assert.notEqual(devil.alternativeLabel, 'main framing');
});

test('devil-advocate concedes when leading posterior is dominant (>=0.7)', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation(), hypothesisSet(0.85, 0.05));
  assert.equal(map['devil-advocate'].agreedWithLeading, true);
});

test('devil-advocate dissents when leading posterior is weak (<0.7)', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation(), hypothesisSet(0.5, 0.3));
  assert.equal(map['devil-advocate'].agreedWithLeading, false);
});

test('data-quality dissents when only one source feeds the situation', () => {
  const svc = freshService();
  const single = situation({
    observations: [obs({ id: 'o1', sourceId: 'only-src' })],
  });
  const map = reviewByPerspective(svc, single);
  assert.equal(map['data-quality'].agreedWithLeading, false);
});

test('data-quality dissents on stale observations', () => {
  const svc = freshService();
  const stale = situation({
    observations: [
      obs({ id: 'o1', sourceId: 'a', timestamp: NOW - 6 * 60 * 60 * 1000 }),
      obs({ id: 'o2', sourceId: 'b', timestamp: NOW - 7 * 60 * 60 * 1000 }),
      obs({ id: 'o3', sourceId: 'c', timestamp: NOW - 8 * 60 * 60 * 1000 }),
    ],
  });
  const map = reviewByPerspective(svc, stale);
  assert.equal(map['data-quality'].agreedWithLeading, false);
});

test('data-quality agrees when sources are diverse, fresh, and ≥3', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation());
  assert.equal(map['data-quality'].agreedWithLeading, true);
});

test('geopolitical dissents on a sensitive domain without political tags', () => {
  const svc = freshService();
  const sensitive = situation({ domain: 'cyber' });
  const map = reviewByPerspective(svc, sensitive);
  assert.equal(map.geopolitical.agreedWithLeading, false);
});

test('geopolitical agrees on a sensitive domain when a political tag is present', () => {
  const svc = freshService();
  const sensitive = situation({ domain: 'cyber', tags: ['state-actor'] });
  const map = reviewByPerspective(svc, sensitive);
  assert.equal(map.geopolitical.agreedWithLeading, true);
});

test('geopolitical agrees on a non-sensitive domain', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation({ domain: 'earthquake' }));
  assert.equal(map.geopolitical.agreedWithLeading, true);
});

test('historical agrees on a precedented domain (earthquake)', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation({ domain: 'earthquake' }));
  assert.equal(map.historical.agreedWithLeading, true);
});

test('historical dissents on an unprecedented domain', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation({ domain: 'unknown-novel-domain' }));
  assert.equal(map.historical.agreedWithLeading, false);
});

test('worst-case agrees when severity is already critical', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation({ severity: 'critical' }));
  assert.equal(map['worst-case'].agreedWithLeading, true);
});

test('worst-case dissents when severity is below critical', () => {
  const svc = freshService();
  const map = reviewByPerspective(svc, situation({ severity: 'medium' }));
  assert.equal(map['worst-case'].agreedWithLeading, false);
});

// ── Consensus aggregation ────────────────────────────────────────────

test('consensus: maximum-agreement situation produces 5/6 agreement (skeptic always disagrees)', () => {
  const svc = freshService();
  // Default situation: critical severity, earthquake (precedented),
  // 3 sources, fresh observations, no contradictions.
  const consensus = svc.reviewSituation(situation(), hypothesisSet(0.9, 0.05));
  assert.equal(consensus.reviews.length, 6);
  const agreeing = consensus.reviews.filter((r) => r.agreedWithLeading).length;
  assert.equal(agreeing, 5);
  assert.ok(Math.abs(consensus.agreementRate - 5 / 6) < 1e-9);
});

test('consensus: agreementRate 4/6 = 0.667 when 4 perspectives agree', () => {
  const svc = freshService();
  // Drop data-quality by forcing a single-source situation; skeptic still
  // disagrees by design — that gives 4 agreeing (devil concedes,
  // geopolitical agrees, historical agrees, worst-case agrees).
  const s = situation({
    observations: [obs({ id: 'o1', sourceId: 'only-src' })],
  });
  const consensus = svc.reviewSituation(s, hypothesisSet(0.9, 0.05));
  const agreeing = consensus.reviews.filter((r) => r.agreedWithLeading).length;
  assert.equal(agreeing, 4);
  assert.ok(Math.abs(consensus.agreementRate - 4 / 6) < 1e-9);
});

test('recommendedAction: >0.7 agreement → proceed', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation(), hypothesisSet(0.9, 0.05));
  assert.match(consensus.recommendedAction, /proceed/i);
});

test('recommendedAction: ≤0.7 agreement → review', () => {
  const svc = freshService();
  // Force 4 dissents → 2/6 agreement → review.
  const s = situation({
    domain: 'cyber', // sensitive, no political tag → geopolitical disagrees
    severity: 'medium', // worst-case disagrees
    observations: [obs({ id: 'o1', sourceId: 'one-source' })], // data-quality disagrees
  });
  const consensus = svc.reviewSituation(s, hypothesisSet(0.4, 0.3));
  // expected disagreers: skeptic, devil (weak leader), data-quality, geopolitical, worst-case = 5
  // historical still agrees (cyber is not precedented though — let's check)
  // cyber is NOT in PRECEDENTED_DOMAINS, so historical also disagrees → 6 disagreers
  assert.ok(consensus.agreementRate <= 0.7);
  assert.match(consensus.recommendedAction, /review/i);
});

test('divergentPerspectives lists everyone who disagreed', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation(), hypothesisSet(0.9, 0.05));
  const expected = consensus.reviews.filter((r) => !r.agreedWithLeading).map((r) => r.perspective);
  assert.deepEqual([...consensus.divergentPerspectives].sort(), [...expected].sort());
});

test('consensusSummary is non-empty and references the agreement count', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation(), hypothesisSet(0.9, 0.05));
  assert.ok(consensus.consensusSummary.length > 0);
  // Should contain "5/6" or similar count token.
  assert.match(consensus.consensusSummary, /\d+\/\d+/);
});

// ── Without a HypothesisSet ──────────────────────────────────────────

test('reviewSituation without a HypothesisSet synthesises a leading framing from the Situation', () => {
  const svc = freshService();
  const consensus = svc.reviewSituation(situation({ name: 'Synthesised leader' }));
  // Devil-advocate should still emit an alternative label distinct from
  // the synthesised name.
  const devil = consensus.reviews.find((r) => r.perspective === 'devil-advocate')!;
  assert.ok(devil.alternativeLabel);
  assert.notEqual(devil.alternativeLabel, 'Synthesised leader');
});

// ── Service: storage + replace-on-id + history ───────────────────────

test('getConsensus returns the most-recent consensus for the situation', () => {
  const svc = freshService();
  svc.reviewSituation(situation(), hypothesisSet());
  svc.reviewSituation(situation({ severity: 'low' }), hypothesisSet(0.4, 0.3));
  const c = svc.getConsensus('sit-1');
  assert.ok(c);
  // Second call should overwrite the first → only one entry on getAll.
  assert.equal(svc.getAll().length, 1);
  // Second call had a weak leader so devil dissents; the agreement
  // rate should be lower than the first run.
  assert.ok(c.reviews.find((r) => r.perspective === 'devil-advocate')!.agreedWithLeading === false);
});

test('getAll returns one consensus per situation id', () => {
  const svc = freshService();
  svc.reviewSituation(situation({ id: 'sit-1' }));
  svc.reviewSituation(situation({ id: 'sit-2' }));
  svc.reviewSituation(situation({ id: 'sit-3' }));
  assert.equal(svc.getAll().length, 3);
});

test('getDivergent returns only consensuses below the divergent threshold (<0.5)', () => {
  const svc = freshService();
  // First: high-agreement.
  svc.reviewSituation(situation({ id: 'high-agree' }), hypothesisSet(0.9, 0.05));
  // Second: deeply divergent (cyber, weak leader, single source, medium severity).
  svc.reviewSituation(
    situation({
      id: 'low-agree',
      domain: 'cyber',
      severity: 'medium',
      observations: [obs({ id: 'o1', sourceId: 'single' })],
    }),
    hypothesisSet(0.3, 0.25),
  );
  const divergent = svc.getDivergent();
  assert.equal(divergent.length, 1);
  assert.equal(divergent[0].situationId, 'low-agree');
});

test('persisted history survives a fresh instance hydrating from localStorage', () => {
  const a = freshService();
  a.reviewSituation(situation(), hypothesisSet());
  const b = new MultiAgentReviewService({ clock: () => NOW });
  assert.equal(b.getAll().length, 1);
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetMultiAgentReviewSingleton();
  __storage.set(serviceInternals.STORAGE_KEY, '{not valid');
  const svc = new MultiAgentReviewService({ clock: () => NOW });
  assert.deepEqual(svc.getAll(), []);
});

test('subscribe fires on each reviewSituation()', () => {
  const svc = freshService();
  let count = 0;
  svc.subscribe(() => { count += 1; });
  svc.reviewSituation(situation({ id: 'a' }));
  svc.reviewSituation(situation({ id: 'b' }));
  assert.equal(count, 2);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.reviewSituation(situation());
  assert.equal(secondCalled, true);
});

test('getMultiAgentReviewService() returns a stable singleton', () => {
  __storage.clear();
  __resetMultiAgentReviewSingleton();
  const a = getMultiAgentReviewService();
  const b = getMultiAgentReviewService();
  assert.strictEqual(a, b);
});

test('ring buffer at MAX_RECORDS + 1 drops the oldest record', () => {
  const svc = freshService();
  const max = serviceInternals.MAX_RECORDS;
  for (let i = 0; i < max + 1; i++) {
    svc.reviewSituation(situation({ id: `sit-${i}` }));
  }
  const all = svc.getAll();
  assert.equal(all.length, max);
  assert.equal(all[0].situationId, 'sit-1');
});
