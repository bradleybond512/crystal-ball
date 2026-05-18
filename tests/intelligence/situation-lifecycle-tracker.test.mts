import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SituationLifecycleTrackerService,
  resetForTests,
  LIFECYCLES_STORAGE_KEY,
  TRANSITIONS_STORAGE_KEY,
  MAX_LIFECYCLES,
  MAX_TRANSITIONS,
  type LifecyclePhase,
  type SituationLifecycle,
} from '../../src/services/intelligence/situation-lifecycle-tracker.ts';

const T0 = 1_780_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(k: string): string | null { return data.get(k) ?? null; },
    setItem(k: string, v: string): void { data.set(k, v); },
  };
}

describe('SituationLifecycleTrackerService — recordTransition basics', () => {
  beforeEach(() => { resetForTests(); });

  it('first recordTransition creates a new lifecycle with detectedAt', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    const t = svc.recordTransition('sit-1', 'weather', 'detected');
    assert.equal(t.situationId, 'sit-1');
    assert.equal(t.domain, 'weather');
    assert.equal(t.fromPhase, null);
    assert.equal(t.toPhase, 'detected');
    assert.equal(t.transitionedAt, T0);
    assert.equal(t.durationInPriorPhase, null);

    const lc = svc.getLifecycle('sit-1');
    assert.ok(lc);
    assert.equal(lc?.currentPhase, 'detected');
    assert.equal(lc?.detectedAt, T0);
    assert.equal(lc?.transitions.length, 1);
  });

  it('recordTransition on unknown situation auto-creates lifecycle', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('sit-x', 'cyber', 'escalated');
    const lc = svc.getLifecycle('sit-x');
    assert.ok(lc);
    assert.equal(lc?.currentPhase, 'escalated');
    assert.equal(lc?.detectedAt, T0);
    assert.equal(lc?.transitions.length, 1);
  });

  it('duplicate transition to same phase is no-op (no new transition recorded)', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += MIN;
    svc.recordTransition('sit-1', 'weather', 'detected');
    const lc = svc.getLifecycle('sit-1');
    assert.equal(lc?.transitions.length, 1);
    assert.equal(lc?.currentPhase, 'detected');
  });
});

describe('SituationLifecycleTrackerService — phase transition times', () => {
  beforeEach(() => { resetForTests(); });

  it('detected → escalated sets timeToEscalateMs', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += 5 * MIN;
    svc.recordTransition('sit-1', 'weather', 'escalated');
    const lc = svc.getLifecycle('sit-1');
    assert.equal(lc?.timeToEscalateMs, 5 * MIN);
    assert.equal(lc?.timeToResolveMs, null);
    assert.equal(lc?.totalDurationMs, null);
  });

  it('detected → escalated → resolved sets both times + totalDurationMs', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += 5 * MIN;
    svc.recordTransition('sit-1', 'weather', 'escalated'); t += 2 * HOUR;
    svc.recordTransition('sit-1', 'weather', 'resolved');
    const lc = svc.getLifecycle('sit-1');
    assert.equal(lc?.timeToEscalateMs, 5 * MIN);
    assert.equal(lc?.timeToResolveMs, 5 * MIN + 2 * HOUR);
    assert.equal(lc?.totalDurationMs, 5 * MIN + 2 * HOUR);
    assert.equal(lc?.resolvedAt, T0 + 5 * MIN + 2 * HOUR);
  });

  it('detected → resolved (skipping escalated) leaves timeToEscalate null', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += 30 * MIN;
    svc.recordTransition('sit-1', 'weather', 'resolved');
    const lc = svc.getLifecycle('sit-1');
    assert.equal(lc?.timeToEscalateMs, null);
    assert.equal(lc?.timeToResolveMs, 30 * MIN);
  });

  it('closed phase sets closedAt', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += MIN;
    svc.recordTransition('sit-1', 'weather', 'resolved'); t += HOUR;
    svc.recordTransition('sit-1', 'weather', 'closed');
    const lc = svc.getLifecycle('sit-1');
    assert.equal(lc?.currentPhase, 'closed');
    assert.equal(lc?.closedAt, T0 + MIN + HOUR);
  });
});

describe('SituationLifecycleTrackerService — durationInPriorPhase math', () => {
  beforeEach(() => { resetForTests(); });

  it('first transition has null durationInPriorPhase', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    const t = svc.recordTransition('sit-1', 'weather', 'detected');
    assert.equal(t.durationInPriorPhase, null);
  });

  it('subsequent transitions record duration spent in prior phase', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += 7 * MIN;
    const trans = svc.recordTransition('sit-1', 'weather', 'escalated');
    assert.equal(trans.durationInPriorPhase, 7 * MIN);
    assert.equal(trans.fromPhase, 'detected');
  });

  it('durations compound across multiple transitions', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('sit-1', 'weather', 'detected'); t += 2 * MIN;
    svc.recordTransition('sit-1', 'weather', 'escalated'); t += 13 * MIN;
    svc.recordTransition('sit-1', 'weather', 'investigated'); t += 45 * MIN;
    const trans = svc.recordTransition('sit-1', 'weather', 'mitigated');
    assert.equal(trans.durationInPriorPhase, 45 * MIN);
    assert.equal(trans.fromPhase, 'investigated');
  });
});

describe('SituationLifecycleTrackerService — getStats', () => {
  beforeEach(() => { resetForTests(); });

  it('returns empty array when no lifecycles', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    assert.deepEqual(svc.getStats(), []);
  });

  it('groups stats by domain', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('w1', 'weather', 'detected');
    svc.recordTransition('c1', 'cyber', 'detected');
    svc.recordTransition('w2', 'weather', 'detected');
    const stats = svc.getStats();
    const byDomain = Object.fromEntries(stats.map((s) => [s.domain, s]));
    assert.equal(byDomain['weather']?.sampleCount, 2);
    assert.equal(byDomain['cyber']?.sampleCount, 1);
  });

  it('avgTimeToResolveMs averages across resolved lifecycles', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('w1', 'weather', 'detected'); t += 10 * MIN;
    svc.recordTransition('w1', 'weather', 'resolved'); t += MIN;
    svc.recordTransition('w2', 'weather', 'detected'); t += 30 * MIN;
    svc.recordTransition('w2', 'weather', 'resolved');
    const stats = svc.getStats('weather');
    assert.equal(stats.length, 1);
    assert.equal(stats[0]?.avgTimeToResolveMs, 20 * MIN);
  });

  it('avgTimeToEscalateMs only averages escalated lifecycles', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('w1', 'weather', 'detected'); t += 4 * MIN;
    svc.recordTransition('w1', 'weather', 'escalated'); t += MIN;
    svc.recordTransition('w2', 'weather', 'detected'); t += MIN; // never escalated
    svc.recordTransition('w3', 'weather', 'detected'); t += 6 * MIN;
    svc.recordTransition('w3', 'weather', 'escalated');
    const stats = svc.getStats('weather');
    assert.equal(stats[0]?.avgTimeToEscalateMs, 5 * MIN);
  });

  it('phaseDistribution counts situations per phase', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('b', 'weather', 'detected');
    svc.recordTransition('b', 'weather', 'escalated');
    svc.recordTransition('c', 'weather', 'detected');
    svc.recordTransition('c', 'weather', 'resolved');
    const stats = svc.getStats('weather');
    assert.equal(stats[0]?.phaseDistribution.detected, 1);
    assert.equal(stats[0]?.phaseDistribution.escalated, 1);
    assert.equal(stats[0]?.phaseDistribution.resolved, 1);
  });

  it('domain filter returns only matching stats', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('b', 'cyber', 'detected');
    const filtered = svc.getStats('cyber');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.domain, 'cyber');
  });

  it('returns null avg when no resolved/escalated lifecycles exist', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    const stats = svc.getStats('weather');
    assert.equal(stats[0]?.avgTimeToResolveMs, null);
    assert.equal(stats[0]?.avgTimeToEscalateMs, null);
  });
});

describe('SituationLifecycleTrackerService — getAll', () => {
  beforeEach(() => { resetForTests(); });

  it('returns lifecycles LIFO by detectedAt', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    svc.recordTransition('a', 'weather', 'detected'); t += MIN;
    svc.recordTransition('b', 'cyber', 'detected'); t += MIN;
    svc.recordTransition('c', 'aviation', 'detected');
    const all = svc.getAll();
    assert.equal(all[0]?.situationId, 'c');
    assert.equal(all[1]?.situationId, 'b');
    assert.equal(all[2]?.situationId, 'a');
  });

  it('domain filter narrows results', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('b', 'cyber', 'detected');
    const all = svc.getAll({ domain: 'cyber' });
    assert.equal(all.length, 1);
    assert.equal(all[0]?.situationId, 'b');
  });

  it('currentPhase filter narrows results', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('b', 'weather', 'detected');
    svc.recordTransition('b', 'weather', 'resolved');
    const all = svc.getAll({ currentPhase: 'resolved' });
    assert.equal(all.length, 1);
    assert.equal(all[0]?.situationId, 'b');
  });

  it('limit caps the number of returned lifecycles', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null });
    for (let i = 0; i < 10; i++) { svc.recordTransition(`s${i}`, 'weather', 'detected'); t += MIN; }
    assert.equal(svc.getAll(undefined, 3).length, 3);
  });
});

describe('SituationLifecycleTrackerService — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribers receive each transition', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    const seen: string[] = [];
    svc.subscribe((t) => seen.push(t.toPhase));
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('a', 'weather', 'escalated');
    assert.deepEqual(seen, ['detected', 'escalated']);
  });

  it('disposer stops notifications', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    const seen: string[] = [];
    const off = svc.subscribe((t) => seen.push(t.toPhase));
    svc.recordTransition('a', 'weather', 'detected');
    off();
    svc.recordTransition('a', 'weather', 'escalated');
    assert.deepEqual(seen, ['detected']);
  });

  it('unsubscribe also removes listener', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    const seen: string[] = [];
    const cb = (t: { toPhase: LifecyclePhase }) => seen.push(t.toPhase);
    svc.subscribe(cb);
    svc.recordTransition('a', 'weather', 'detected');
    svc.unsubscribe(cb);
    svc.recordTransition('a', 'weather', 'escalated');
    assert.deepEqual(seen, ['detected']);
  });
});

describe('SituationLifecycleTrackerService — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('lifecycles persist + hydrate', () => {
    const storage = memoryStorage();
    let t = T0;
    const svc1 = new SituationLifecycleTrackerService({ now: () => t, storage });
    svc1.recordTransition('a', 'weather', 'detected'); t += MIN;
    svc1.recordTransition('a', 'weather', 'escalated');

    const svc2 = new SituationLifecycleTrackerService({ now: () => t, storage });
    const lc = svc2.getLifecycle('a');
    assert.ok(lc);
    assert.equal(lc?.currentPhase, 'escalated');
    assert.equal(lc?.transitions.length, 2);
  });

  it('storage keys are the expected ones', () => {
    assert.equal(LIFECYCLES_STORAGE_KEY, 'wm-situation-lifecycles');
    assert.equal(TRANSITIONS_STORAGE_KEY, 'wm-lifecycle-transitions');
  });

  it('malformed persisted state is recovered gracefully', () => {
    const storage = memoryStorage();
    storage.setItem(LIFECYCLES_STORAGE_KEY, '{not json');
    storage.setItem(TRANSITIONS_STORAGE_KEY, '{not json');
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage });
    assert.equal(svc.getAll().length, 0);
    // still works after malformed hydrate
    svc.recordTransition('a', 'weather', 'detected');
    assert.ok(svc.getLifecycle('a'));
  });

  it('null storage means no persistence', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    assert.ok(svc.getLifecycle('a'));
  });
});

describe('SituationLifecycleTrackerService — ring-buffer eviction', () => {
  beforeEach(() => { resetForTests(); });

  it('transitions ring buffer caps at MAX_TRANSITIONS', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null, maxTransitions: 5 });
    for (let i = 0; i < 10; i++) {
      svc.recordTransition(`s${i}`, 'weather', 'detected');
      t += MIN;
    }
    assert.equal(svc.getAllTransitions().length, 5);
  });

  it('lifecycles ring buffer caps at maxLifecycles', () => {
    let t = T0;
    const svc = new SituationLifecycleTrackerService({ now: () => t, storage: null, maxLifecycles: 3 });
    for (let i = 0; i < 7; i++) {
      svc.recordTransition(`s${i}`, 'weather', 'detected');
      t += MIN;
    }
    assert.equal(svc.getAll().length, 3);
  });

  it('default max constants are exposed', () => {
    assert.equal(MAX_LIFECYCLES, 1000);
    assert.equal(MAX_TRANSITIONS, 5000);
  });
});

describe('SituationLifecycleTrackerService — clear', () => {
  beforeEach(() => { resetForTests(); });

  it('clear empties lifecycles + transitions and persists', () => {
    const storage = memoryStorage();
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage });
    svc.recordTransition('a', 'weather', 'detected');
    svc.recordTransition('b', 'cyber', 'detected');
    svc.clear();
    assert.equal(svc.getAll().length, 0);
    assert.equal(svc.getAllTransitions().length, 0);
    // confirm hydration sees the cleared state
    const svc2 = new SituationLifecycleTrackerService({ now: () => T0, storage });
    assert.equal(svc2.getAll().length, 0);
  });
});

describe('SituationLifecycleTrackerService — defensive copies', () => {
  beforeEach(() => { resetForTests(); });

  it('getLifecycle returns a defensive copy', () => {
    const svc = new SituationLifecycleTrackerService({ now: () => T0, storage: null });
    svc.recordTransition('a', 'weather', 'detected');
    const lc = svc.getLifecycle('a') as SituationLifecycle;
    lc.transitions.push({ id: 'fake', situationId: 'a', domain: 'weather', fromPhase: null, toPhase: 'escalated', transitionedAt: T0, durationInPriorPhase: null });
    const lc2 = svc.getLifecycle('a');
    assert.equal(lc2?.transitions.length, 1);
  });
});
