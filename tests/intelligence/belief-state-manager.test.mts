import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BeliefStateManager,
  STORAGE_KEY,
} from '../../src/services/intelligence/belief-state-manager.ts';
import type {
  BeliefEvidence,
  StorageLike,
} from '../../src/services/intelligence/belief-state-manager.ts';

// ── Fixtures ─────────────────────────────────────────────────────────

const NOW = 1_748_100_000_000;

function makeManager(opts: { now?: () => number; storage?: StorageLike | null } = {}): BeliefStateManager {
  return new BeliefStateManager({
    now: opts.now ?? (() => NOW),
    storage: opts.storage === undefined ? null : opts.storage,
  });
}

function makeEvidence(o: Partial<BeliefEvidence> = {}): BeliefEvidence {
  return {
    observationId: o.observationId ?? 'obs-1',
    likelihood: o.likelihood ?? 0.8,
    weight: o.weight ?? 1,
    timestamp: o.timestamp ?? NOW,
  };
}

function makeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

// ── Singleton ────────────────────────────────────────────────────────

describe('BeliefStateManager — singleton', () => {
  beforeEach(() => { BeliefStateManager.resetForTests(); });

  it('getInstance returns the same instance on repeated calls', () => {
    const a = BeliefStateManager.getInstance();
    const b = BeliefStateManager.getInstance();
    assert.strictEqual(a, b);
  });

  it('resetForTests produces a fresh instance', () => {
    const a = BeliefStateManager.getInstance();
    BeliefStateManager.resetForTests();
    const b = BeliefStateManager.getInstance();
    assert.notStrictEqual(a, b);
  });
});

// ── assert() ─────────────────────────────────────────────────────────

describe('BeliefStateManager.assert — basic shape', () => {
  it('returns a BeliefState with the correct proposition and domain', () => {
    const m = makeManager();
    const bs = m.assert('quake > M6', 'seismic', 0.3);
    assert.equal(bs.proposition, 'quake > M6');
    assert.equal(bs.domain, 'seismic');
  });

  it('sets priorProbability to the given value', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.6);
    assert.equal(bs.priorProbability, 0.6);
  });

  it('initialises posteriorProbability equal to prior', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.4);
    assert.equal(bs.posteriorProbability, 0.4);
  });

  it('initialises evidence array as empty', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    assert.deepEqual(bs.evidence, []);
  });

  it('initialises confidence to 0', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    assert.equal(bs.confidence, 0);
  });

  it('sets lastUpdated to the clock value', () => {
    const m = makeManager({ now: () => NOW });
    const bs = m.assert('p', 'd', 0.5);
    assert.equal(bs.lastUpdated, NOW);
  });

  it('assigns a unique id per belief', () => {
    const m = makeManager();
    const a = m.assert('p1', 'd', 0.5);
    const b = m.assert('p2', 'd', 0.5);
    assert.notEqual(a.id, b.id);
  });

  it('stores optional region when provided', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5, 'midwest');
    assert.equal(bs.region, 'midwest');
  });

  it('region is undefined when omitted', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    assert.equal(bs.region, undefined);
  });

  it('clamps priorProbability above 1.0 to 1.0', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 1.5);
    assert.equal(bs.priorProbability, 1);
  });

  it('clamps priorProbability below 0.0 to 0.0', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', -0.2);
    assert.equal(bs.priorProbability, 0);
  });
});

// ── update() — Bayesian math ─────────────────────────────────────────

describe('BeliefStateManager.update — Bayesian update', () => {
  it('returns undefined for an unknown id', () => {
    const m = makeManager();
    const result = m.update('no-such-id', makeEvidence());
    assert.equal(result, undefined);
  });

  it('increases posterior when likelihood > 0.5', () => {
    const m = makeManager();
    const bs = m.assert('quake likely', 'seismic', 0.3);
    const updated = m.update(bs.id, makeEvidence({ likelihood: 0.9 }));
    assert.ok(updated!.posteriorProbability > 0.3, 'posterior should rise with strong evidence');
  });

  it('decreases posterior when likelihood < 0.5', () => {
    const m = makeManager();
    const bs = m.assert('quake likely', 'seismic', 0.7);
    const updated = m.update(bs.id, makeEvidence({ likelihood: 0.1 }));
    assert.ok(updated!.posteriorProbability < 0.7, 'posterior should fall with disconfirming evidence');
  });

  it('leaves posterior unchanged when likelihood = 0.5 (uninformative)', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.4);
    const updated = m.update(bs.id, makeEvidence({ likelihood: 0.5 }));
    // prior=0.4, likelihood=0.5 → numerator=0.2, normalizer=0.2+0.3=0.5 … wait
    // Actually 0.4*0.5 / (0.4*0.5 + 0.6*0.5) = 0.2 / (0.2+0.3) = 0.2/0.5 = 0.4
    assert.equal(Number(updated!.posteriorProbability.toFixed(6)), 0.4);
  });

  it('appends evidence to the belief evidence array', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    m.update(bs.id, makeEvidence({ observationId: 'obs-A' }));
    m.update(bs.id, makeEvidence({ observationId: 'obs-B' }));
    assert.equal(bs.evidence.length, 2);
    assert.equal(bs.evidence[0]!.observationId, 'obs-A');
    assert.equal(bs.evidence[1]!.observationId, 'obs-B');
  });

  it('updates lastUpdated on each call', () => {
    let t = NOW;
    const m = makeManager({ now: () => t });
    const bs = m.assert('p', 'd', 0.5);
    t = NOW + 5000;
    m.update(bs.id, makeEvidence());
    assert.equal(bs.lastUpdated, NOW + 5000);
  });

  it('computes posterior correctly for prior=0.5 likelihood=0.8', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    const updated = m.update(bs.id, makeEvidence({ likelihood: 0.8 }));
    // 0.5*0.8 / (0.5*0.8 + 0.5*0.2) = 0.4 / (0.4 + 0.1) = 0.4/0.5 = 0.8
    assert.equal(Number(updated!.posteriorProbability.toFixed(4)), 0.8);
  });

  it('computes posterior correctly for prior=0.2 likelihood=0.9', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.2);
    const updated = m.update(bs.id, makeEvidence({ likelihood: 0.9 }));
    // 0.2*0.9 / (0.2*0.9 + 0.8*0.1) = 0.18 / (0.18 + 0.08) = 0.18/0.26 ≈ 0.6923
    assert.ok(Math.abs(updated!.posteriorProbability - 0.6923) < 0.0005);
  });

  it('chains multiple updates correctly', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.3);
    m.update(bs.id, makeEvidence({ likelihood: 0.8 }));
    m.update(bs.id, makeEvidence({ likelihood: 0.8 }));
    // After 1st: 0.3*0.8/(0.3*0.8+0.7*0.2)=0.24/0.38≈0.6316
    // After 2nd: 0.6316*0.8/(0.6316*0.8+0.3684*0.2)≈0.5053/0.5790≈0.8729
    assert.ok(bs.posteriorProbability > 0.8, `expected >0.8, got ${bs.posteriorProbability}`);
  });

  it('clamps likelihood above 1.0 to 1.0', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    // likelihood clamped to 1.0 → posterior = 0.5*1/(0.5*1+0.5*0) = 1
    const updated = m.update(bs.id, makeEvidence({ likelihood: 1.5 }));
    assert.equal(updated!.posteriorProbability, 1);
  });

  it('clamps likelihood below 0.0 to 0.0', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    // likelihood clamped to 0 → posterior = 0/(0+0.5) = 0
    const updated = m.update(bs.id, makeEvidence({ likelihood: -0.3 }));
    assert.equal(updated!.posteriorProbability, 0);
  });
});

// ── update() — confidence ────────────────────────────────────────────

describe('BeliefStateManager.update — confidence', () => {
  it('confidence after 1 evidence piece is 0.1', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    m.update(bs.id, makeEvidence());
    assert.equal(bs.confidence, 0.1);
  });

  it('confidence after 5 evidence pieces is 0.5', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    for (let i = 0; i < 5; i++) m.update(bs.id, makeEvidence());
    assert.equal(bs.confidence, 0.5);
  });

  it('confidence caps at 1.0 after 10 or more evidence pieces', () => {
    const m = makeManager();
    const bs = m.assert('p', 'd', 0.5);
    for (let i = 0; i < 15; i++) m.update(bs.id, makeEvidence());
    assert.equal(bs.confidence, 1.0);
  });
});

// ── query() ─────────────────────────────────────────────────────────

describe('BeliefStateManager.query', () => {
  it('returns all beliefs when no filters given', () => {
    const m = makeManager();
    m.assert('p1', 'seismic', 0.3);
    m.assert('p2', 'cyber', 0.7);
    assert.equal(m.query().length, 2);
  });

  it('filters by domain', () => {
    const m = makeManager();
    m.assert('p1', 'seismic', 0.3);
    m.assert('p2', 'cyber', 0.7);
    const results = m.query('seismic');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.domain, 'seismic');
  });

  it('filters by minProbability', () => {
    const m = makeManager();
    m.assert('low', 'seismic', 0.2);
    m.assert('high', 'seismic', 0.8);
    const results = m.query(undefined, 0.5);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.proposition, 'high');
  });

  it('filters by both domain and minProbability', () => {
    const m = makeManager();
    m.assert('low-seismic', 'seismic', 0.1);
    m.assert('high-seismic', 'seismic', 0.9);
    m.assert('high-cyber', 'cyber', 0.9);
    const results = m.query('seismic', 0.5);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.proposition, 'high-seismic');
  });

  it('sorts results by posteriorProbability descending', () => {
    const m = makeManager();
    m.assert('low', 'd', 0.2);
    m.assert('mid', 'd', 0.5);
    m.assert('high', 'd', 0.9);
    const results = m.query();
    assert.equal(results[0]!.proposition, 'high');
    assert.equal(results[1]!.proposition, 'mid');
    assert.equal(results[2]!.proposition, 'low');
  });

  it('returns empty array when no beliefs match', () => {
    const m = makeManager();
    m.assert('p', 'seismic', 0.5);
    assert.deepEqual(m.query('nuclear'), []);
  });
});

// ── getMostLikely() ──────────────────────────────────────────────────

describe('BeliefStateManager.getMostLikely', () => {
  it('returns undefined for unknown domain', () => {
    const m = makeManager();
    assert.equal(m.getMostLikely('seismic'), undefined);
  });

  it('returns the belief with highest posteriorProbability in domain', () => {
    const m = makeManager();
    m.assert('low', 'seismic', 0.1);
    m.assert('high', 'seismic', 0.9);
    m.assert('other', 'cyber', 0.95);
    const result = m.getMostLikely('seismic');
    assert.equal(result!.proposition, 'high');
  });

  it('ignores beliefs from other domains', () => {
    const m = makeManager();
    m.assert('cyber-high', 'cyber', 0.99);
    m.assert('seismic-low', 'seismic', 0.1);
    const result = m.getMostLikely('seismic');
    assert.equal(result!.proposition, 'seismic-low');
  });

  it('reflects updated posteriors', () => {
    const m = makeManager();
    const bs = m.assert('initially-low', 'seismic', 0.1);
    m.assert('high', 'seismic', 0.8);
    // Update the low one with strong evidence
    for (let i = 0; i < 5; i++) m.update(bs.id, makeEvidence({ likelihood: 0.99 }));
    // After 5 updates from 0.1, it should surpass 0.8
    const result = m.getMostLikely('seismic');
    assert.equal(result!.id, bs.id);
  });
});

// ── getUncertain() ───────────────────────────────────────────────────

describe('BeliefStateManager.getUncertain', () => {
  it('returns beliefs near 0.5 with default threshold', () => {
    const m = makeManager();
    m.assert('certain-high', 'd', 0.95);   // |0.95-0.5|=0.45 ≥ 0.3 → excluded
    m.assert('uncertain', 'd', 0.6);        // |0.6-0.5|=0.1 < 0.3 → included
    m.assert('certain-low', 'd', 0.05);    // |0.05-0.5|=0.45 ≥ 0.3 → excluded
    const results = m.getUncertain();
    assert.equal(results.length, 1);
    assert.equal(results[0]!.proposition, 'uncertain');
  });

  it('uses custom threshold', () => {
    const m = makeManager();
    m.assert('p1', 'd', 0.5);   // |0-0|<0.1 ✓
    m.assert('p2', 'd', 0.62);  // |0.12|≥0.1 ✗
    const results = m.getUncertain(0.1);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.proposition, 'p1');
  });

  it('returns empty array when no beliefs are uncertain', () => {
    const m = makeManager();
    m.assert('certain', 'd', 0.95);
    assert.deepEqual(m.getUncertain(), []);
  });

  it('includes beliefs across all domains', () => {
    const m = makeManager();
    m.assert('s', 'seismic', 0.55);
    m.assert('c', 'cyber', 0.45);
    assert.equal(m.getUncertain().length, 2);
  });

  it('boundary: abs(0.5-0.5)=0 < 0.3 → included', () => {
    const m = makeManager();
    m.assert('exactly-half', 'd', 0.5);
    assert.equal(m.getUncertain().length, 1);
  });

  it('boundary: abs(0.8-0.5)=0.3 is NOT < 0.3 → excluded', () => {
    const m = makeManager();
    m.assert('boundary', 'd', 0.8);
    assert.equal(m.getUncertain().length, 0);
  });
});

// ── Ring buffer capacity ─────────────────────────────────────────────

describe('BeliefStateManager — ring buffer', () => {
  it('evicts oldest belief when over capacity', () => {
    const m = new BeliefStateManager({ capacity: 3, storage: null, now: () => NOW });
    const first = m.assert('p1', 'd', 0.5);
    m.assert('p2', 'd', 0.5);
    m.assert('p3', 'd', 0.5);
    m.assert('p4', 'd', 0.5);
    assert.equal(m.getAll().length, 3);
    assert.equal(m.query().find((b) => b.id === first.id), undefined);
  });

  it('capacity 1 always keeps only the latest belief', () => {
    const m = new BeliefStateManager({ capacity: 1, storage: null, now: () => NOW });
    m.assert('old', 'd', 0.5);
    const latest = m.assert('new', 'd', 0.9);
    assert.equal(m.getAll().length, 1);
    assert.equal(m.getAll()[0]!.id, latest.id);
  });
});

// ── Storage persistence ──────────────────────────────────────────────

describe('BeliefStateManager — storage persistence', () => {
  it('persists beliefs to storage on assert()', () => {
    const storage = makeStorage();
    const m = new BeliefStateManager({ storage, now: () => NOW });
    m.assert('p', 'seismic', 0.4);
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw!) as { beliefs: unknown[] };
    assert.equal(parsed.beliefs.length, 1);
  });

  it('rehydrates beliefs from storage on construction', () => {
    const storage = makeStorage();
    const m1 = new BeliefStateManager({ storage, now: () => NOW });
    m1.assert('quake', 'seismic', 0.4);

    const m2 = new BeliefStateManager({ storage, now: () => NOW });
    assert.equal(m2.getAll().length, 1);
    assert.equal(m2.getAll()[0]!.proposition, 'quake');
  });

  it('persists after update()', () => {
    const storage = makeStorage();
    const m1 = new BeliefStateManager({ storage, now: () => NOW });
    const bs = m1.assert('p', 'd', 0.3);
    m1.update(bs.id, makeEvidence({ likelihood: 0.9 }));

    const m2 = new BeliefStateManager({ storage, now: () => NOW });
    const rehydrated = m2.getAll()[0]!;
    assert.ok(rehydrated.posteriorProbability > 0.3);
    assert.equal(rehydrated.evidence.length, 1);
  });

  it('null storage skips persistence without error', () => {
    const m = new BeliefStateManager({ storage: null, now: () => NOW });
    assert.doesNotThrow(() => m.assert('p', 'd', 0.5));
  });

  it('corrupt storage is handled gracefully', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not-valid-json{{' });
    assert.doesNotThrow(() => new BeliefStateManager({ storage, now: () => NOW }));
  });

  it('storage with wrong shape is ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ beliefs: 'bad' }) });
    const m = new BeliefStateManager({ storage, now: () => NOW });
    assert.equal(m.getAll().length, 0);
  });
});
