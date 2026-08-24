import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  benjaminiHochberg,
  declusterDomainEvents,
  DEFAULT_WINDOWS_MS,
  exactBinomialTail,
  holmAdjust,
  mineLeadLag,
  posteriorEvidence,
  type DomainEvent,
  type PromotingLeadLagEdge,
} from '../lead-lag';
import { learnedRulesFromEdges, learnedRuleId, syncLearnedRules, MAX_LEARNED_RULES } from '../learned-rules';
import { CorrelateEngine } from '../../intelligence/correlate-engine';
import {
  allGoldenObservations,
  CORPUS_SPAN_DAYS,
  CORPUS_T0,
} from '../__bench__/golden-streams.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = 1_000_000_000;

function ev(domain: string, at: number): DomainEvent {
  return { domain, at };
}

/** Tight coupling: every quake is followed by an outage 2h later, over a
 *  long span with plenty of quiet time. */
function coupledHistory(): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let i = 0; i < 6; i++) {
    events.push(ev('seismic', T0 + i * 100 * HOUR));
    events.push(ev('infra', T0 + i * 100 * HOUR + 2 * HOUR));
  }
  return events;
}

/** A chatty consequent that fires every 2h regardless of the antecedent. */
function chattyHistory(): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let i = 0; i < 300; i++) events.push(ev('newsy', T0 + i * 2 * HOUR));
  for (let i = 0; i < 6; i++) events.push(ev('seismic', T0 + i * 90 * HOUR + HOUR / 2));
  return events;
}

test('records the exact two-tailed multiple-testing family across eligible ordered pairs and windows', () => {
  const events = [
    ev('a', T0), ev('a', T0 + 10 * HOUR), ev('a', T0 + 20 * HOUR),
    ev('b', T0 + HOUR), ev('b', T0 + 11 * HOUR), ev('b', T0 + 21 * HOUR),
    ev('c', T0 + 2 * HOUR), ev('c', T0 + 12 * HOUR),
  ];
  const result = mineLeadLag(events, { windowsMs: [HOUR, 6 * HOUR] });
  const family = result.family;

  assert.deepEqual(family, {
    alpha: 0.05,
    eligibleOrderedPairs: 4,
    windowCount: 2,
    pairWindowTests: 8,
    tails: 2,
    criticalAbsZ: Math.sqrt(2 * Math.log((2 * 8) / 0.05)),
    method: 'exact-binomial-holm',
  });
  const oneWindow = mineLeadLag(events, { windowsMs: [HOUR] }).family!;
  assert.equal(family && family.pairWindowTests, 2 * oneWindow.pairWindowTests);
  assert.ok((family?.criticalAbsZ ?? 0) > oneWindow.criticalAbsZ);
  assert.notEqual(
    family?.criticalAbsZ,
    Math.sqrt(2 * Math.log((family?.pairWindowTests ?? 0) / 0.05)),
    'the two-tail multiplier must not be omitted',
  );
});

test('fails closed when alpha or configured windows are invalid', () => {
  const invalidOptions = [
    { alpha: 0 },
    { alpha: 1 },
    { alpha: Number.NaN },
    { windowsMs: [] },
    { windowsMs: [0] },
    { windowsMs: [Number.POSITIVE_INFINITY] },
    { windowsMs: [HOUR, HOUR] },
    { observationEndMs: Number.NaN },
    { observationEndMs: Number.POSITIVE_INFINITY },
  ] as const;

  for (const options of invalidOptions) {
    assert.deepEqual(mineLeadLag(coupledHistory(), options), {
      family: null,
      candidates: [],
      promoting: [],
      inhibitory: [],
    });
  }
});

test('retains zero-support trials for inhibitory discovery without adding them to candidates', () => {
  const events: DomainEvent[] = [];
  for (let i = 0; i < 20; i++) {
    const day = T0 + i * 24 * HOUR;
    events.push(ev('a', day), ev('b', day + 8 * HOUR), ev('b', day + 16 * HOUR));
  }

  const result = mineLeadLag(events, {
    windowsMs: [6 * HOUR],
    observationEndMs: T0 + 20 * 24 * HOUR,
  });
  const inhibitory = result.inhibitory.find((edge) => edge.from === 'a' && edge.to === 'b');

  assert.equal(result.family?.pairWindowTests, 2);
  assert.ok(!result.candidates.some((edge) => edge.from === 'a' && edge.to === 'b'));
  assert.ok(inhibitory);
  assert.equal(inhibitory.effect, 'inhibitory');
  assert.equal(inhibitory.support, 0);
  assert.equal('medianLagMs' in inhibitory, false);
});

test('right-censors antecedents whose follow window extends beyond explicit observation coverage', () => {
  const coverageEnd = T0 + 20 * 24 * HOUR;
  const events = absentFollowHistory(20, [8, 16]);
  events.push(
    ev('a', coverageEnd - 5 * HOUR),
    ev('a', coverageEnd - 4 * HOUR),
    ev('a', coverageEnd - 3 * HOUR),
  );

  const result = mineLeadLag(events, {
    windowsMs: [6 * HOUR],
    observationEndMs: coverageEnd,
  });
  const inhibitory = result.inhibitory.find((edge) => edge.from === 'a' && edge.to === 'b');

  assert.ok(inhibitory);
  assert.equal(inhibitory.antecedents, 20, 'pending antecedents must not become negative trials');
});

test('omitted observation coverage fails closed for inhibition without hiding promoting evidence', () => {
  const absent = mineLeadLag(absentFollowHistory(20, [8, 16]), { windowsMs: [6 * HOUR] });
  const coupled = mineLeadLag(coupledHistory());

  assert.ok(!absent.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'));
  assert.ok(coupled.promoting.some((edge) => edge.from === 'seismic' && edge.to === 'infra'));
});

test('explicit observation coverage excludes later events from every mining result', () => {
  const coverageEnd = T0 + 20 * 24 * HOUR;
  const covered = absentFollowHistory(20, [8, 16]);
  const baseline = mineLeadLag(covered, {
    windowsMs: [6 * HOUR],
    observationEndMs: coverageEnd,
  });
  const contaminated = mineLeadLag([
    ...covered,
    ev('a', coverageEnd + HOUR),
    ev('b', coverageEnd + 2 * HOUR),
    ev('b', coverageEnd + 3 * HOUR),
  ], {
    windowsMs: [6 * HOUR],
    observationEndMs: coverageEnd,
  });

  assert.deepEqual(contaminated, baseline);
});

test('inhibitory base rate includes silent coverage through the explicit observation end', () => {
  const coverageEnd = T0 + 20 * 24 * HOUR;
  const events = absentFollowHistory(20, [8, 16]);
  const result = mineLeadLag(events, {
    windowsMs: [6 * HOUR],
    observationEndMs: coverageEnd,
  });
  const inhibitory = result.inhibitory.find((edge) => edge.from === 'a' && edge.to === 'b');
  const expectedRate = 1 - Math.exp(-(40 / (coverageEnd - T0)) * 6 * HOUR);

  assert.ok(inhibitory);
  assert.equal(inhibitory.expectedRate, expectedRate);
});

test('silent explicit coverage does not change promoting statistics', () => {
  const events = coupledHistory();
  const omittedCoverage = mineLeadLag(events);
  const explicitCoverage = mineLeadLag(events, {
    observationEndMs: T0 + 1_000 * HOUR,
  });

  assert.deepEqual(explicitCoverage.candidates, omittedCoverage.candidates);
  assert.deepEqual(explicitCoverage.promoting, omittedCoverage.promoting);
});

test('selects promoting and inhibitory windows independently and explains suppression', () => {
  const events: DomainEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const day = T0 + i * 24 * HOUR;
    events.push(
      ev('a', day),
      ev('b', day + 8 * HOUR),
      ev('b', day + 16 * HOUR),
      ev('c', day + 2 * HOUR),
      ev('d', day + 2.5 * HOUR),
    );
  }

  const result = mineLeadLag(events, {
    windowsMs: [HOUR, 6 * HOUR],
    observationEndMs: T0 + 40 * 24 * HOUR,
  });
  const promoting = result.promoting.find((edge) => edge.from === 'c' && edge.to === 'd');
  const inhibitory = result.inhibitory.find((edge) => edge.from === 'a' && edge.to === 'b');

  assert.equal(promoting?.windowMs, HOUR);
  assert.equal(inhibitory?.windowMs, 6 * HOUR);
  assert.match(inhibitory?.explanation ?? '', /suppresses/);
});

function absentFollowHistory(antecedentCount: number, bOffsetsHours: readonly number[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let i = 0; i < antecedentCount; i++) {
    const day = T0 + i * 24 * HOUR;
    events.push(ev('a', day));
    for (const offset of bOffsetsHours) events.push(ev('b', day + offset * HOUR));
  }
  return events;
}

test('rejects inhibitory claims with low n, low base rate, or weak corrected z', () => {
  const lowN = mineLeadLag(
    absentFollowHistory(4, [7, 9, 11, 13, 15, 17, 19, 21, 23]),
    {
      windowsMs: [6 * HOUR],
      minAntecedents: 3,
      observationEndMs: T0 + 4 * 24 * HOUR,
    },
  );
  assert.ok(!lowN.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'));

  const lowBaseEvents: DomainEvent[] = [];
  for (let i = 0; i < 400; i++) {
    const day = T0 + i * 24 * HOUR;
    lowBaseEvents.push(ev('a', day));
    if (i % 10 === 0) lowBaseEvents.push(ev('b', day + 12 * HOUR));
  }
  const lowBase = mineLeadLag(lowBaseEvents, {
    windowsMs: [6 * HOUR],
    observationEndMs: T0 + 400 * 24 * HOUR,
  });
  assert.ok(!lowBase.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'));

  const weakZ = mineLeadLag(
    absentFollowHistory(10, [8, 16]),
    { windowsMs: [6 * HOUR], observationEndMs: T0 + 10 * 24 * HOUR },
  );
  assert.ok(!weakZ.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'));
});

test('positive admission applies support and configurable z gates at full precision', () => {
  const supportTwo: DomainEvent[] = [];
  for (let i = 0; i < 6; i++) supportTwo.push(ev('a', T0 + i * 100 * HOUR));
  supportTwo.push(ev('b', T0 + HOUR), ev('b', T0 + 101 * HOUR));
  const supportResult = mineLeadLag(supportTwo, { windowsMs: [6 * HOUR] });
  const supportCandidate = supportResult.candidates.find(
    (edge) => edge.from === 'a' && edge.to === 'b',
  );
  assert.equal(supportCandidate?.support, 2);
  assert.ok((supportCandidate?.lift ?? 0) >= 2);
  assert.ok(!supportResult.promoting.some((edge) => edge.from === 'a' && edge.to === 'b'));

  const initial = mineLeadLag(coupledHistory());
  const exactZ = initial.candidates.find(
    (edge) => edge.from === 'seismic' && edge.to === 'infra',
  )!.zScore;
  assert.notEqual(exactZ, Math.round(exactZ * 100) / 100);
  assert.ok(mineLeadLag(coupledHistory(), { minZ: exactZ - 1e-10 }).promoting.some(
    (edge) => edge.from === 'seismic' && edge.to === 'infra',
  ));
  assert.ok(!mineLeadLag(coupledHistory(), { minZ: exactZ + 1e-10 }).promoting.some(
    (edge) => edge.from === 'seismic' && edge.to === 'infra',
  ));
});

test('mining output is deterministic, uncapped, and keeps mediated evidence out of promotion', () => {
  const events = [
    ...coupledHistory(),
    ...absentFollowHistory(20, [8, 16]).map((event) => ({
      ...event,
      domain: event.domain === 'a' ? 'suppressor' : 'suppressed',
    })),
  ];
  const forward = mineLeadLag(events, { windowsMs: [HOUR, 6 * HOUR] });
  const reversed = mineLeadLag([...events].reverse(), { windowsMs: [HOUR, 6 * HOUR] });

  assert.deepEqual(reversed, forward);

  const manyEdges: DomainEvent[] = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    for (let domain = 0; domain < 6; domain++) {
      manyEdges.push(ev(`d${domain}`, T0 + cycle * 100 * HOUR + domain * 0.1 * HOUR));
    }
  }
  const uncapped = mineLeadLag(manyEdges, { windowsMs: [HOUR] });
  assert.equal(uncapped.candidates.length, 15);
  assert.equal(uncapped.promoting.length, 5);
  assert.equal(uncapped.candidates.filter((edge) => edge.redundancy?.kind === 'chain').length, 10);
});

test('genuine lagged coupling is mined with high lift and significance', () => {
  const result = mineLeadLag(coupledHistory());
  const edge = result.candidates.find((e) => e.from === 'seismic' && e.to === 'infra');
  assert.ok(edge, 'seismic→infra edge expected');
  assert.equal(edge!.support, 6);
  assert.equal(edge!.followRate, 1);
  assert.ok(edge!.lift > 2, `lift should beat chance, got ${edge!.lift}`);
  assert.ok(edge!.zScore > 2, `z should be significant, got ${edge!.zScore}`);
  assert.ok(result.promoting.some((e) => e.from === 'seismic' && e.to === 'infra'));
});

test('REGRESSION (G3): a chatty consequent domain is NOT significant despite 100% follow rate', () => {
  const result = mineLeadLag(chattyHistory());
  const edge = result.candidates.find((e) => e.from === 'seismic' && e.to === 'newsy');
  // Everything is "followed" by the 2h-cadence domain — follow rate is
  // perfect but chance is too, so lift ≈ 1 and the edge must not pass.
  if (edge) {
    assert.ok(edge.lift < 2, `lift should be ~1 for chance-following, got ${edge.lift}`);
    assert.ok(!result.promoting.some((e) => e.from === 'seismic' && e.to === 'newsy'));
  }
});

test('multi-scale: tight coupling wins at a narrow window even when the wide window is chance-saturated', () => {
  const edge = mineLeadLag(coupledHistory()).candidates.find(
    (e) => e.from === 'seismic' && e.to === 'infra',
  )!;
  assert.ok(edge.windowMs <= 24 * HOUR, `expected a narrow winning window, got ${edge.windowMs}`);
});

test('median and p90 lag reflect the actual lag distribution', () => {
  const edge = mineLeadLag(coupledHistory()).candidates.find(
    (e) => e.from === 'seismic' && e.to === 'infra',
  )!;
  assert.equal(edge.medianLagMs, 2 * HOUR);
  assert.equal(edge.lagP90Ms, 2 * HOUR);
});

test('minAntecedents gate: fewer than 3 A-events yields no edge', () => {
  const edges = mineLeadLag([
    ev('a', T0), ev('b', T0 + HOUR),
    ev('a', T0 + 10 * HOUR), ev('b', T0 + 11 * HOUR),
  ]);
  assert.equal(edges.candidates.length, 0);
});

test('degenerate inputs: empty history, single domain, zero span', () => {
  assert.deepEqual(mineLeadLag([]).candidates, []);
  assert.deepEqual(mineLeadLag([ev('a', T0), ev('a', T0), ev('a', T0)]).candidates, []);
  const sameInstant = [ev('a', T0), ev('a', T0), ev('a', T0), ev('b', T0)];
  assert.deepEqual(mineLeadLag(sameInstant).candidates, []);
});

test('invalid events cannot alter the eligible family or valid edge statistics', () => {
  const valid = mineLeadLag(coupledHistory());
  const contaminated = mineLeadLag([
    ...coupledHistory(),
    ev('a', Number.NaN),
    ev('', T0 + 1_000_000 * HOUR),
  ]);

  assert.deepEqual(contaminated, valid);
});

test('every mined edge carries an explanation', () => {
  for (const e of mineLeadLag(coupledHistory()).candidates) {
    assert.ok(e.explanation.length > 0);
    assert.match(e.explanation, /lift|chance/);
  }
});

// ── learned rules ────────────────────────────────────────────────────────

function fakeEdge(from: string, to: string, strength: number): PromotingLeadLagEdge {
  return {
    effect: 'promoting', from, to, windowMs: 6 * HOUR, support: 5, antecedents: 6,
    followRate: 0.8, expectedRate: 0.2, lift: 4, zScore: 3,
    medianLagMs: 2 * HOUR, lagP90Ms: 3 * HOUR, strength,
    explanation: `${from}→${to} test edge`,
  };
}

test('learnedRulesFromEdges caps at MAX_LEARNED_RULES by strength', () => {
  const edges = Array.from({ length: 20 }, (_, i) =>
    fakeEdge(`d${i}`, `e${i}`, i / 20));
  const rules = learnedRulesFromEdges(edges);
  assert.equal(rules.length, MAX_LEARNED_RULES);
  // Strongest edges made the cut.
  assert.ok(rules.some((r) => r.id === learnedRuleId({ from: 'd19', to: 'e19' })));
  assert.ok(!rules.some((r) => r.id === learnedRuleId({ from: 'd0', to: 'e0' })));
});

test('learned rule window comes from the tested window, clamped to [1h, 7d]', () => {
  const [rule] = learnedRulesFromEdges([fakeEdge('x', 'y', 0.9)]);
  assert.equal(rule!.timeWindowMs, 6 * HOUR);
  const [tiny] = learnedRulesFromEdges([{ ...fakeEdge('x', 'y', 0.9), windowMs: 1000 }]);
  assert.equal(tiny!.timeWindowMs, HOUR);
  const [huge] = learnedRulesFromEdges([{ ...fakeEdge('x', 'y', 0.9), windowMs: 99 * 24 * HOUR }]);
  assert.equal(huge!.timeWindowMs, 7 * 24 * HOUR);
});

test('learned rule matchFn is directional: consequent after antecedent only', () => {
  const [rule] = learnedRulesFromEdges([fakeEdge('seismic', 'infra', 0.9)]);
  const a = { domain: 'seismic', timestamp: T0 } as never;
  const b = { domain: 'infra', timestamp: T0 + HOUR } as never;
  assert.equal(rule!.matchFn(a, b), true);
  assert.equal(rule!.matchFn(b, a), false);
  const wrongDomain = { domain: 'markets', timestamp: T0 + HOUR } as never;
  assert.equal(rule!.matchFn(a, wrongDomain), false);
});

test('learned rules carry no baseConfidence (full kernel + reliability applies)', () => {
  const [rule] = learnedRulesFromEdges([fakeEdge('x', 'y', 0.9)]);
  assert.equal(rule!.baseConfidence, undefined);
});

test('syncLearnedRules adds new, removes stale, never touches built-ins', () => {
  const engine = new CorrelateEngine();
  engine.registerRule({
    id: 'builtin-rule', name: 'b', description: 'b', domains: [],
    timeWindowMs: HOUR, matchFn: () => true, edgeType: 'co-located',
  });
  const first = syncLearnedRules(engine, learnedRulesFromEdges([fakeEdge('a', 'b', 0.9)]));
  assert.deepEqual(first, { added: 1, removed: 0 });
  const second = syncLearnedRules(engine, learnedRulesFromEdges([fakeEdge('c', 'd', 0.9)]));
  assert.deepEqual(second, { added: 1, removed: 1 });
  const ids = engine.getRules().map((r) => r.id).sort();
  assert.deepEqual(ids, ['builtin-rule', 'learned:c->d']);
});

test('syncLearnedRules is idempotent for an unchanged set', () => {
  const engine = new CorrelateEngine();
  const rules = learnedRulesFromEdges([fakeEdge('a', 'b', 0.9)]);
  syncLearnedRules(engine, rules);
  const again = syncLearnedRules(engine, rules);
  assert.deepEqual(again, { added: 0, removed: 0 });
  assert.equal(engine.getRules().length, 1);
});

test('DEFAULT_WINDOWS_MS spans hours to days', () => {
  assert.ok(DEFAULT_WINDOWS_MS.includes(HOUR));
  assert.ok(DEFAULT_WINDOWS_MS.includes(72 * HOUR));
});

test('exact binomial tails stay accurate for sparse support', () => {
  assert.ok(Math.abs(exactBinomialTail(5, 3, 0.1, 'upper') - 0.00856) < 1e-12);
  assert.ok(Math.abs(exactBinomialTail(5, 1, 0.1, 'lower') - 0.91854) < 1e-12);
});

test('Holm and Benjamini-Hochberg adjustments preserve original order', () => {
  const p = [0.04, 0.001, 0.03, 0.2];
  assert.deepEqual(
    holmAdjust(p).map((value) => Number(value.toFixed(3))),
    [0.09, 0.004, 0.09, 0.2],
  );
  assert.deepEqual(
    benjaminiHochberg(p).map((value) => Number(value.toFixed(3))),
    [0.053, 0.004, 0.053, 0.2],
  );
});

test('automatic declustering collapses tight repeated bursts without merging quiet episodes', () => {
  const events: DomainEvent[] = [];
  for (const day of [0, 6, 12, 18, 24]) {
    const anchor = T0 + day * 24 * HOUR;
    events.push(ev('bursty', anchor), ev('bursty', anchor + 20 * 60_000), ev('bursty', anchor + 40 * 60_000));
  }
  events.push(ev('steady', T0), ev('steady', T0 + 6 * 24 * HOUR), ev('steady', T0 + 12 * 24 * HOUR));

  const clustered = declusterDomainEvents(events);

  assert.equal(clustered.filter((event) => event.domain === 'bursty').length, 5);
  assert.equal(clustered.filter((event) => event.domain === 'steady').length, 3);
});

test('Bayesian evidence exposes non-saturating posterior log odds and decision utility', () => {
  const moderate = posteriorEvidence({ support: 4, antecedentCount: 10, expectedRate: 0.1 });
  const strong = posteriorEvidence({ support: 8, antecedentCount: 10, expectedRate: 0.1 });

  assert.ok(Number.isFinite(moderate.posteriorLogOdds));
  assert.ok(Number.isFinite(strong.posteriorLogOdds));
  assert.ok(strong.posteriorLogOdds > moderate.posteriorLogOdds);
  assert.ok(strong.expectedUtility > moderate.expectedUtility);
});

test('a mediated shortcut is retained as evidence but excluded from promoting rules', () => {
  const events: DomainEvent[] = [];
  for (let index = 0; index < 12; index++) {
    const anchor = T0 + index * 4 * 24 * HOUR;
    events.push(ev('x', anchor), ev('m', anchor + 45 * 60_000), ev('z', anchor + 2 * HOUR));
  }

  const result = mineLeadLag(events, { windowsMs: [HOUR, 6 * HOUR] });
  const shortcut = result.candidates.find((edge) => edge.from === 'x' && edge.to === 'z');

  assert.equal(shortcut?.redundancy?.kind, 'chain');
  assert.ok(result.promoting.some((edge) => edge.from === 'x' && edge.to === 'm'));
  assert.ok(result.promoting.some((edge) => edge.from === 'm' && edge.to === 'z'));
  assert.ok(!result.promoting.some((edge) => edge.from === 'x' && edge.to === 'z'));
});

test('reciprocal within-burst evidence is demoted as directionally ambiguous', () => {
  const events: DomainEvent[] = [];
  for (let burst = 0; burst < 8; burst++) {
    const anchor = T0 + burst * 5 * 24 * HOUR;
    for (let item = 0; item < 3; item++) {
      events.push(ev('a', anchor + item * 40 * 60_000));
      events.push(ev('b', anchor + item * 40 * 60_000 + 20 * 60_000));
    }
  }

  const result = mineLeadLag(events, { windowsMs: [HOUR, 6 * HOUR] });
  const ambiguous = result.candidates.filter((edge) =>
    (edge.from === 'a' && edge.to === 'b') || (edge.from === 'b' && edge.to === 'a'));

  assert.ok(ambiguous.some((edge) => edge.redundancy?.kind === 'reciprocal'));
  assert.ok(!result.promoting.some((edge) =>
    (edge.from === 'a' && edge.to === 'b') || (edge.from === 'b' && edge.to === 'a')));
});

test('a promoting edge cannot contradict its significant inhibitory reverse', () => {
  const events = allGoldenObservations().map((observation) => ({
    domain: observation.domain,
    at: observation.timestamp,
  }));
  const result = mineLeadLag(events, {
    observationEndMs: CORPUS_T0 + CORPUS_SPAN_DAYS * DAY,
  });
  const reverse = result.candidates.find((edge) =>
    edge.from === 'escalation' && edge.to === 'calm-signal');

  assert.ok(result.inhibitory.some((edge) =>
    edge.from === 'calm-signal' && edge.to === 'escalation'));
  assert.equal(reverse?.redundancy?.kind as string | undefined, 'inhibitory-reverse');
  assert.ok(!result.promoting.some((edge) =>
    edge.from === 'escalation' && edge.to === 'calm-signal'));
});

test('learned rules use the tested window and rank by non-saturating evidence', () => {
  const weaker = {
    ...fakeEdge('weak', 'effect', 1),
    windowMs: HOUR,
    lagP90Ms: 6 * HOUR,
    rankingScore: 4,
  };
  const stronger = {
    ...fakeEdge('strong', 'effect', 1),
    windowMs: 6 * HOUR,
    lagP90Ms: HOUR,
    rankingScore: 9,
  };

  const rules = learnedRulesFromEdges([weaker, stronger]);

  assert.equal(rules[0]?.id, learnedRuleId(stronger));
  assert.equal(rules[0]?.timeWindowMs, 6 * HOUR);
});
