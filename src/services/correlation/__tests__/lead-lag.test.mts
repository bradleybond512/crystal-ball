import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WINDOWS_MS,
  mineLeadLag,
  significantEdges,
  type DomainEvent,
} from '../lead-lag';
import { learnedRulesFromEdges, learnedRuleId, syncLearnedRules, MAX_LEARNED_RULES } from '../learned-rules';
import { CorrelateEngine } from '../../intelligence/correlate-engine';
import type { LeadLagEdge } from '../lead-lag';

const HOUR = 3_600_000;
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

test('genuine lagged coupling is mined with high lift and significance', () => {
  const edges = mineLeadLag(coupledHistory());
  const edge = edges.find((e) => e.from === 'seismic' && e.to === 'infra');
  assert.ok(edge, 'seismic→infra edge expected');
  assert.equal(edge!.support, 6);
  assert.equal(edge!.followRate, 1);
  assert.ok(edge!.lift > 2, `lift should beat chance, got ${edge!.lift}`);
  assert.ok(edge!.zScore > 2, `z should be significant, got ${edge!.zScore}`);
  assert.ok(significantEdges([edge!]).length === 1);
});

test('REGRESSION (G3): a chatty consequent domain is NOT significant despite 100% follow rate', () => {
  const edges = mineLeadLag(chattyHistory());
  const edge = edges.find((e) => e.from === 'seismic' && e.to === 'newsy');
  // Everything is "followed" by the 2h-cadence domain — follow rate is
  // perfect but chance is too, so lift ≈ 1 and the edge must not pass.
  if (edge) {
    assert.ok(edge.lift < 2, `lift should be ~1 for chance-following, got ${edge.lift}`);
    assert.equal(significantEdges([edge]).length, 0);
  }
});

test('multi-scale: tight coupling wins at a narrow window even when the wide window is chance-saturated', () => {
  const edges = mineLeadLag(coupledHistory());
  const edge = edges.find((e) => e.from === 'seismic' && e.to === 'infra')!;
  assert.ok(edge.windowMs <= 24 * HOUR, `expected a narrow winning window, got ${edge.windowMs}`);
});

test('median and p90 lag reflect the actual lag distribution', () => {
  const edges = mineLeadLag(coupledHistory());
  const edge = edges.find((e) => e.from === 'seismic' && e.to === 'infra')!;
  assert.equal(edge.medianLagMs, 2 * HOUR);
  assert.equal(edge.lagP90Ms, 2 * HOUR);
});

test('minAntecedents gate: fewer than 3 A-events yields no edge', () => {
  const edges = mineLeadLag([
    ev('a', T0), ev('b', T0 + HOUR),
    ev('a', T0 + 10 * HOUR), ev('b', T0 + 11 * HOUR),
  ]);
  assert.equal(edges.length, 0);
});

test('degenerate inputs: empty history, single domain, zero span', () => {
  assert.deepEqual(mineLeadLag([]), []);
  assert.deepEqual(mineLeadLag([ev('a', T0), ev('a', T0), ev('a', T0)]), []);
  const sameInstant = [ev('a', T0), ev('a', T0), ev('a', T0), ev('b', T0)];
  assert.deepEqual(mineLeadLag(sameInstant), []);
});

test('non-finite timestamps and empty domains are filtered, not crashing', () => {
  const edges = mineLeadLag([
    ev('a', Number.NaN), ev('', T0),
    ...coupledHistory(),
  ]);
  assert.ok(edges.some((e) => e.from === 'seismic' && e.to === 'infra'));
});

test('every mined edge carries an explanation', () => {
  for (const e of mineLeadLag(coupledHistory())) {
    assert.ok(e.explanation.length > 0);
    assert.match(e.explanation, /lift|chance/);
  }
});

// ── learned rules ────────────────────────────────────────────────────────

function fakeEdge(from: string, to: string, strength: number): LeadLagEdge {
  return {
    from, to, windowMs: 6 * HOUR, support: 5, antecedents: 6,
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

test('learned rule window comes from lag p90, clamped to [1h, 7d]', () => {
  const [rule] = learnedRulesFromEdges([fakeEdge('x', 'y', 0.9)]);
  assert.equal(rule!.timeWindowMs, 3 * HOUR);
  const [tiny] = learnedRulesFromEdges([{ ...fakeEdge('x', 'y', 0.9), lagP90Ms: 1000 }]);
  assert.equal(tiny!.timeWindowMs, HOUR);
  const [huge] = learnedRulesFromEdges([{ ...fakeEdge('x', 'y', 0.9), lagP90Ms: 99 * 24 * HOUR }]);
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
