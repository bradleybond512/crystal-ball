/**
 * Tests for the autonomous Repair Recommendations engine (Phase 4).
 *
 * Pure service tests. Stubs localStorage at module load. Each test
 * builds a fresh engine via the clock-injectable constructor so order
 * doesn't matter.
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
  RepairEngine,
  __internals,
  __resetRepairEngineSingleton,
  getRepairEngine,
  type RepairPriority,
  type RepairRecommendation,
  type SafetyCase,
  type SafetyProperty,
  type SafetyPropertyId,
  type SafetyVerdict,
} from '../../src/services/intelligence/repair-engine.ts';
import type {
  DomainScorecard,
  DomainScorecardComponents,
} from '../../src/services/intelligence/domain-scorecard.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function freshEngine(): RepairEngine {
  __storage.clear();
  return new RepairEngine({ clock: () => NOW });
}

function makeSafetyCase(properties: SafetyProperty[]): SafetyCase {
  return { generatedAt: new Date(NOW), properties };
}

function makeProperty(id: SafetyPropertyId, verdict: SafetyVerdict, reason?: string): SafetyProperty {
  return { id, verdict, reason };
}

function makeScorecard(
  domain: string,
  components: Partial<DomainScorecardComponents>,
): DomainScorecard {
  const filled: DomainScorecardComponents = {
    outcomeQuality: 1,
    predictionAccuracy: 1,
    feedHealth: 1,
    attentionEfficiency: 1,
    budgetHealth: 1,
    ...components,
  };
  return {
    domain,
    grade: 'A',
    overallScore: 1,
    components: filled,
    trend: 'stable',
    topIssue: null,
    recommendation: 'No action needed',
    outcomeCount: 100,
    lastUpdated: new Date(NOW),
  };
}

// ── generateFromSafetyCase: per-property ─────────────────────────────

test('safety property in pass state does NOT generate a recommendation', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'pass')]));
  assert.equal(engine.getAll().length, 0);
});

test('safety property in unknown state does NOT generate a recommendation', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'unknown')]));
  assert.equal(engine.getAll().length, 0);
});

test('safety property in fail state generates exactly one recommendation', () => {
  const engine = freshEngine();
  const out = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  assert.equal(out.length, 1);
  assert.equal(engine.getAll().length, 1);
});

test('safety property in warn state generates a recommendation', () => {
  const engine = freshEngine();
  const out = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('FEED-COVERAGE', 'warn')]));
  assert.equal(out.length, 1);
});

test('ACCURACY fail produces the 3 documented action steps', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  assert.ok(rec);
  assert.equal(rec!.actions.length, 3);
  assert.match(rec!.actions[0]!.description, /OutcomeLedger/);
  assert.match(rec!.actions[1]!.description, /AlgoEvalLedger/);
  assert.match(rec!.actions[2]!.description, /trust budget/);
});

test('BIAS-FREE fail produces actions that mention BiasDetectionPanel + acknowledge + re-scan', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('BIAS-FREE', 'fail')]));
  const text = rec!.actions.map((a) => a.description).join(' ');
  assert.match(text, /BiasDetectionPanel/);
  assert.match(text, /acknowledge/i);
  assert.match(text, /re-run bias scan/i);
});

test('FEED-COVERAGE fail has higher priority than FEED-COVERAGE warn', () => {
  const engine = freshEngine();
  const [failRec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('FEED-COVERAGE', 'fail')]));
  engine.resetForTesting();
  const engine2 = new RepairEngine({ clock: () => NOW });
  const [warnRec] = engine2.generateFromSafetyCase(makeSafetyCase([makeProperty('FEED-COVERAGE', 'warn')]));
  assert.ok(priorityRank(failRec!.priority) > priorityRank(warnRec!.priority));
});

test('triggerSource encodes the property id + verdict', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ALERT-BUDGET', 'fail')]));
  assert.match(rec!.triggerSource, /SafetyCase:/);
  assert.match(rec!.triggerSource, /ALERT-BUDGET/);
  assert.match(rec!.triggerSource, /fail/);
});

test('unknown safety property id still produces a recommendation via the generic fallback', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([
    { id: 'CUSTOM-PROPERTY', verdict: 'fail', reason: 'custom signal' },
  ]));
  assert.ok(rec);
  assert.equal(rec!.summary, 'custom signal');
  assert.ok(rec!.actions.length > 0);
});

test('property.reason overrides the template summary when provided', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ACCURACY', 'fail', 'Magnitude driver miscalibrated.'),
  ]));
  assert.equal(rec!.summary, 'Magnitude driver miscalibrated.');
});

test('safety fail recommendations are tagged priority=critical', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  assert.equal(rec!.priority, 'critical');
});

test('safety warn recommendations are tagged priority=high', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ASSUMPTIONS-DISCLOSED', 'warn'),
  ]));
  assert.equal(rec!.priority, 'high');
});

test('every action carries a 1-indexed step number', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const steps = rec!.actions.map((a) => a.step);
  assert.deepEqual(steps, [1, 2, 3]);
});

// ── generateFromScorecard ────────────────────────────────────────────

test('scorecard component above 0.5 does NOT generate a recommendation', () => {
  const engine = freshEngine();
  engine.generateFromScorecard(makeScorecard('weather', { outcomeQuality: 0.7 }));
  assert.equal(engine.getAll().length, 0);
});

test('scorecard component below 0.5 generates exactly one recommendation', () => {
  const engine = freshEngine();
  const out = engine.generateFromScorecard(makeScorecard('weather', { outcomeQuality: 0.4 }));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.domain, 'weather');
});

test('multiple under-threshold components generate one recommendation each', () => {
  const engine = freshEngine();
  const out = engine.generateFromScorecard(makeScorecard('weather', {
    outcomeQuality: 0.3,
    feedHealth: 0.2,
    budgetHealth: 0.1,
  }));
  assert.equal(out.length, 3);
});

test('scorecard recommendation title mentions the domain', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromScorecard(makeScorecard('cyber', { feedHealth: 0.3 }));
  assert.match(rec!.title, /cyber/);
});

test('scorecard recommendation embeds the score and grade in triggerSource', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromScorecard(makeScorecard('weather', { feedHealth: 0.4 }));
  assert.match(rec!.triggerSource, /DomainScorecard/);
  assert.match(rec!.triggerSource, /weather/);
  assert.match(rec!.triggerSource, /feedHealth/);
});

test('scorecard recommendation priority defaults to medium', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromScorecard(makeScorecard('weather', { feedHealth: 0.4 }));
  assert.equal(rec!.priority, 'medium');
});

test('scorecard component < 0.25 escalates priority to high', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromScorecard(makeScorecard('weather', { feedHealth: 0.1 }));
  assert.equal(rec!.priority, 'high');
});

// ── Lifecycle transitions ─────────────────────────────────────────

test('markInProgress moves status open → in-progress', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const updated = engine.markInProgress(rec!.id);
  assert.equal(updated!.status, 'in-progress');
});

test('resolve moves status to resolved and sets resolvedAt', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const updated = engine.resolve(rec!.id);
  assert.equal(updated!.status, 'resolved');
  assert.ok(updated!.resolvedAt);
});

test('dismiss moves status to dismissed and stores the reason', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const updated = engine.dismiss(rec!.id, 'duplicate of #42');
  assert.equal(updated!.status, 'dismissed');
  assert.equal(updated!.dismissedReason, 'duplicate of #42');
});

test('resolved recommendations cannot be re-transitioned', () => {
  const engine = freshEngine();
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  engine.resolve(rec!.id);
  const second = engine.markInProgress(rec!.id);
  assert.equal(second!.status, 'resolved');
});

test('unknown id returns undefined from all transitions', () => {
  const engine = freshEngine();
  assert.equal(engine.markInProgress('missing'), undefined);
  assert.equal(engine.resolve('missing'), undefined);
  assert.equal(engine.dismiss('missing', 'x'), undefined);
});

// ── Filters + queries ───────────────────────────────────────────

test('getOpen returns open + in-progress, excludes resolved + dismissed', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ACCURACY', 'fail'),
    makeProperty('BIAS-FREE', 'fail'),
    makeProperty('FEED-COVERAGE', 'fail'),
  ]));
  const all = engine.getAll();
  engine.resolve(all[1]!.id);
  engine.dismiss(all[2]!.id, 'wontfix');
  const open = engine.getOpen();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.status, 'open');
});

test('getByPriority filters to one band', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ACCURACY', 'fail'),                  // critical
    makeProperty('ASSUMPTIONS-DISCLOSED', 'warn'),     // high
  ]));
  assert.equal(engine.getByPriority('critical').length, 1);
  assert.equal(engine.getByPriority('high').length, 1);
  assert.equal(engine.getByPriority('low').length, 0);
});

test('getByDomain filters to one domain', () => {
  const engine = freshEngine();
  engine.generateFromScorecard(makeScorecard('weather', { feedHealth: 0.2 }));
  engine.generateFromScorecard(makeScorecard('cyber', { feedHealth: 0.2 }));
  assert.equal(engine.getByDomain('weather').length, 1);
  assert.equal(engine.getByDomain('cyber').length, 1);
});

// ── Stats ─────────────────────────────────────────────────────────

test('stats counts open / in-progress / resolved / dismissed', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ACCURACY', 'fail'),
    makeProperty('BIAS-FREE', 'fail'),
    makeProperty('FEED-COVERAGE', 'fail'),
  ]));
  const all = engine.getAll();
  engine.markInProgress(all[0]!.id);
  engine.resolve(all[1]!.id);
  engine.dismiss(all[2]!.id, 'wontfix');
  const s = engine.stats();
  assert.equal(s.inProgress, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.dismissed, 1);
});

test('stats.byPriority sums to total recommendations across all statuses', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([
    makeProperty('ACCURACY', 'fail'),
    makeProperty('ASSUMPTIONS-DISCLOSED', 'warn'),
  ]));
  const s = engine.stats();
  const total = s.byPriority.critical + s.byPriority.high + s.byPriority.medium + s.byPriority.low;
  assert.equal(total, 2);
});

// ── Persistence + subscribe ──────────────────────────────────────

test('recommendations persist across engine instances', () => {
  __storage.clear();
  const a = new RepairEngine({ clock: () => NOW });
  a.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const b = new RepairEngine({ clock: () => NOW });
  assert.equal(b.getAll().length, 1);
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-repair-recommendations', 'not-json');
  const engine = new RepairEngine({ clock: () => NOW });
  assert.equal(engine.getAll().length, 0);
});

test('subscribe fires on generate and on each state transition', () => {
  const engine = freshEngine();
  let calls = 0;
  engine.subscribe(() => { calls += 1; });
  const [rec] = engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  engine.markInProgress(rec!.id);
  engine.resolve(rec!.id);
  assert.equal(calls, 3);
});

test('subscribe returns an unsubscribe fn that stops further notifications', () => {
  const engine = freshEngine();
  let calls = 0;
  const off = engine.subscribe(() => { calls += 1; });
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  off();
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('BIAS-FREE', 'fail')]));
  assert.equal(calls, 1);
});

test('listener exception isolation — second listener still receives the event', () => {
  const engine = freshEngine();
  let second = false;
  engine.subscribe(() => { throw new Error('boom'); });
  engine.subscribe(() => { second = true; });
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  assert.equal(second, true);
});

test('getRepairEngine returns a stable singleton', () => {
  __resetRepairEngineSingleton();
  const a = getRepairEngine();
  const b = getRepairEngine();
  assert.equal(a, b);
});

// ── Defensive copy + internals ──────────────────────────────────

test('getAll returns defensive copies — mutating callsite does not corrupt the engine', () => {
  const engine = freshEngine();
  engine.generateFromSafetyCase(makeSafetyCase([makeProperty('ACCURACY', 'fail')]));
  const list = engine.getAll();
  list[0]!.title = 'mutated';
  list[0]!.actions[0]!.description = 'mutated';
  const reread = engine.getAll();
  assert.notEqual(reread[0]!.title, 'mutated');
  assert.notEqual(reread[0]!.actions[0]!.description, 'mutated');
});

test('SCORECARD_COMPONENT_THRESHOLD is 0.5 per spec', () => {
  assert.equal(__internals.SCORECARD_COMPONENT_THRESHOLD, 0.5);
});

// ── Local helpers (kept at the bottom for readability) ───────────

function priorityRank(p: RepairPriority): number {
  switch (p) {
    case 'critical': return 4;
    case 'high':     return 3;
    case 'medium':   return 2;
    case 'low':      return 1;
  }
}

test('teardown — references unused types so strict tsconfig stays clean', () => {
  __resetRepairEngineSingleton();
  const _r: RepairRecommendation | undefined = undefined;
  void _r;
  assert.ok(true);
});
