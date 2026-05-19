import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CausalAttributionService,
  STORAGE_KEY,
} from '../../src/services/intelligence/causal-attribution.ts';
import type {
  AttributedCause,
  StorageLike,
} from '../../src/services/intelligence/causal-attribution.ts';

// ── Fixtures ─────────────────────────────────────────────────────────

const NOW = 1_748_000_000_000;

type CandidateInput = Omit<AttributedCause, 'causalType'>;

function makeCandidate(o: Partial<CandidateInput> = {}): CandidateInput {
  return {
    domain: o.domain ?? 'seismic',
    description: o.description ?? 'Ground motion detected',
    weight: o.weight ?? 0.5,
    observationId: o.observationId,
  };
}

function makeService(opts: { now?: () => number; storage?: StorageLike | null } = {}): CausalAttributionService {
  return new CausalAttributionService({
    now: opts.now ?? (() => NOW),
    storage: opts.storage === undefined ? null : opts.storage,
  });
}

function makeStorage(initial: Record<string, string> = {}): StorageLike {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

// ── Singleton ────────────────────────────────────────────────────────

describe('CausalAttributionService — singleton', () => {
  beforeEach(() => { CausalAttributionService.resetForTests(); });

  it('getInstance returns same instance on repeated calls', () => {
    const a = CausalAttributionService.getInstance();
    const b = CausalAttributionService.getInstance();
    assert.strictEqual(a, b);
  });

  it('resetForTests produces a fresh instance', () => {
    const a = CausalAttributionService.getInstance();
    CausalAttributionService.resetForTests();
    const b = CausalAttributionService.getInstance();
    assert.notStrictEqual(a, b);
  });
});

// ── attribute() — basic structure ────────────────────────────────────

describe('CausalAttributionService.attribute — return shape', () => {
  it('returns an Attribution with the correct targetId and targetType', () => {
    const s = makeService();
    const result = s.attribute('alert-1', 'alert', [makeCandidate()]);
    assert.equal(result.targetId, 'alert-1');
    assert.equal(result.targetType, 'alert');
  });

  it('works for targetType situation', () => {
    const s = makeService();
    const result = s.attribute('sit-1', 'situation', [makeCandidate()]);
    assert.equal(result.targetType, 'situation');
  });

  it('sets computedAt to the clock value', () => {
    const s = makeService({ now: () => NOW });
    const result = s.attribute('a', 'alert', [makeCandidate()]);
    assert.equal(result.computedAt, NOW);
  });

  it('assigns a unique id', () => {
    const s = makeService();
    const r1 = s.attribute('a', 'alert', [makeCandidate()]);
    const r2 = s.attribute('b', 'alert', [makeCandidate()]);
    assert.notEqual(r1.id, r2.id);
  });

  it('returns empty causes array when no candidates given', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', []);
    assert.deepEqual(result.causes, []);
    assert.equal(result.totalWeight, 0);
  });
});

// ── Weight normalization ─────────────────────────────────────────────

describe('CausalAttributionService.attribute — weight normalization', () => {
  it('single candidate gets weight 1.0', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [makeCandidate({ weight: 0.7 })]);
    assert.equal(result.causes[0]!.weight, 1);
  });

  it('two equal candidates each get weight 0.5', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ weight: 1 }),
      makeCandidate({ domain: 'cyber', weight: 1 }),
    ]);
    assert.equal(result.causes[0]!.weight, 0.5);
    assert.equal(result.causes[1]!.weight, 0.5);
  });

  it('weights sum to 1.0 for three unequal candidates', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'a', weight: 2 }),
      makeCandidate({ domain: 'b', weight: 3 }),
      makeCandidate({ domain: 'c', weight: 5 }),
    ]);
    const sum = result.causes.reduce((acc, c) => acc + c.weight, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-4, `expected sum≈1, got ${sum}`);
  });

  it('all-zero weights produce zero-weight causes', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ weight: 0 }),
      makeCandidate({ domain: 'cyber', weight: 0 }),
    ]);
    assert.equal(result.causes[0]!.weight, 0);
    assert.equal(result.causes[1]!.weight, 0);
    assert.equal(result.totalWeight, 0);
  });

  it('negative weights are clamped to zero before normalizing', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'seismic', weight: -1 }),
      makeCandidate({ domain: 'cyber', weight: 4 }),
    ]);
    // negative clamped → 0; cyber gets 4/4 = 1.0
    assert.equal(result.causes[1]!.weight, 1);
    assert.equal(result.causes[0]!.weight, 0);
  });

  it('totalWeight reflects sum of normalized weights', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'a', weight: 3 }),
      makeCandidate({ domain: 'b', weight: 7 }),
    ]);
    const expected = result.causes.reduce((acc, c) => acc + c.weight, 0);
    assert.ok(Math.abs(result.totalWeight - expected) < 1e-6);
  });
});

// ── causalType classification ────────────────────────────────────────

describe('CausalAttributionService.attribute — causalType classification', () => {
  it('single cause classifies as direct (weight 1.0 > 0.4)', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [makeCandidate({ weight: 1 })]);
    assert.equal(result.causes[0]!.causalType, 'direct');
  });

  it('weight exactly 0.5 → direct', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'a', weight: 1 }),
      makeCandidate({ domain: 'b', weight: 1 }),
    ]);
    // both 0.5 > 0.4 → direct
    assert.equal(result.causes[0]!.causalType, 'direct');
    assert.equal(result.causes[1]!.causalType, 'direct');
  });

  it('weight in 0.15–0.4 range → contributing', () => {
    const s = makeService();
    // 4 equal candidates → each gets 0.25 (in contributing range)
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'a', weight: 1 }),
      makeCandidate({ domain: 'b', weight: 1 }),
      makeCandidate({ domain: 'c', weight: 1 }),
      makeCandidate({ domain: 'd', weight: 1 }),
    ]);
    for (const cause of result.causes) {
      assert.equal(cause.causalType, 'contributing');
    }
  });

  it('weight below 0.15 → contextual', () => {
    const s = makeService();
    // 10 equal candidates → each gets 0.1 < 0.15 → contextual
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ domain: `d${i}`, weight: 1 }),
    );
    const result = s.attribute('a', 'alert', candidates);
    for (const cause of result.causes) {
      assert.equal(cause.causalType, 'contextual');
    }
  });

  it('mixed classification across three causes', () => {
    const s = makeService();
    // weights 6, 2, 2 → normalized 0.6, 0.2, 0.2
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'primary', weight: 6 }),
      makeCandidate({ domain: 'contrib1', weight: 2 }),
      makeCandidate({ domain: 'contrib2', weight: 2 }),
    ]);
    const [primary, c1, c2] = result.causes;
    assert.equal(primary!.causalType, 'direct');
    assert.equal(c1!.causalType, 'contributing');
    assert.equal(c2!.causalType, 'contributing');
  });

  it('contextual threshold: weight 0.14 → contextual', () => {
    const s = makeService();
    // weights: 86, 14 → 0.86 direct, 0.14 contextual
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'big', weight: 86 }),
      makeCandidate({ domain: 'small', weight: 14 }),
    ]);
    assert.equal(result.causes[0]!.causalType, 'direct');
    assert.equal(result.causes[1]!.causalType, 'contextual');
  });
});

// ── getAttribution ───────────────────────────────────────────────────

describe('CausalAttributionService.getAttribution', () => {
  it('returns undefined for unknown targetId', () => {
    const s = makeService();
    assert.equal(s.getAttribution('no-such'), undefined);
  });

  it('returns the stored attribution by targetId', () => {
    const s = makeService();
    const a = s.attribute('alert-42', 'alert', [makeCandidate()]);
    const retrieved = s.getAttribution('alert-42');
    assert.equal(retrieved?.id, a.id);
  });

  it('re-attributing the same targetId replaces the previous record', () => {
    const s = makeService();
    s.attribute('alert-42', 'alert', [makeCandidate({ domain: 'seismic' })]);
    const second = s.attribute('alert-42', 'alert', [makeCandidate({ domain: 'cyber' })]);
    const retrieved = s.getAttribution('alert-42');
    assert.equal(retrieved?.id, second.id);
    assert.equal(retrieved?.causes[0]!.domain, 'cyber');
  });

  it('separate targetIds do not collide', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);
    s.attribute('a2', 'alert', [makeCandidate({ domain: 'cyber' })]);
    assert.equal(s.getAttribution('a1')?.causes[0]!.domain, 'seismic');
    assert.equal(s.getAttribution('a2')?.causes[0]!.domain, 'cyber');
  });
});

// ── getByDomain ──────────────────────────────────────────────────────

describe('CausalAttributionService.getByDomain', () => {
  it('returns empty array when no attributions exist', () => {
    const s = makeService();
    assert.deepEqual(s.getByDomain('seismic'), []);
  });

  it('returns attributions that include the given domain', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' }), makeCandidate({ domain: 'nuclear' })]);
    s.attribute('a2', 'alert', [makeCandidate({ domain: 'cyber' })]);
    const results = s.getByDomain('seismic');
    assert.equal(results.length, 1);
    assert.equal(results[0]!.targetId, 'a1');
  });

  it('returns multiple attributions sharing the same domain', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);
    s.attribute('a2', 'alert', [makeCandidate({ domain: 'seismic' })]);
    s.attribute('a3', 'alert', [makeCandidate({ domain: 'cyber' })]);
    assert.equal(s.getByDomain('seismic').length, 2);
    assert.equal(s.getByDomain('cyber').length, 1);
  });

  it('returns empty for domain not present in any cause', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);
    assert.deepEqual(s.getByDomain('volcano'), []);
  });
});

// ── getStats ─────────────────────────────────────────────────────────

describe('CausalAttributionService.getStats', () => {
  it('returns zero stats when empty', () => {
    const s = makeService();
    const stats = s.getStats();
    assert.equal(stats.total, 0);
    assert.equal(stats.avgCausesPerAttribution, 0);
    assert.deepEqual(stats.topDomains, []);
  });

  it('counts total attributions', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate()]);
    s.attribute('a2', 'alert', [makeCandidate()]);
    assert.equal(s.getStats().total, 2);
  });

  it('computes average causes per attribution', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'a' }), makeCandidate({ domain: 'b' })]);
    s.attribute('a2', 'alert', [makeCandidate({ domain: 'c' })]);
    // (2 + 1) / 2 = 1.5
    assert.equal(s.getStats().avgCausesPerAttribution, 1.5);
  });

  it('topDomains sorted by count descending', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' }), makeCandidate({ domain: 'cyber' })]);
    s.attribute('a2', 'alert', [makeCandidate({ domain: 'seismic' })]);
    const { topDomains } = s.getStats();
    assert.equal(topDomains[0]!.domain, 'seismic');
    assert.equal(topDomains[0]!.count, 2);
    assert.equal(topDomains[1]!.domain, 'cyber');
    assert.equal(topDomains[1]!.count, 1);
  });

  it('topDomains ties broken alphabetically', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'z-domain' }), makeCandidate({ domain: 'a-domain' })]);
    const { topDomains } = s.getStats();
    assert.equal(topDomains[0]!.domain, 'a-domain');
    assert.equal(topDomains[1]!.domain, 'z-domain');
  });

  it('re-attribution of same targetId does not double-count', () => {
    const s = makeService();
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'cyber' })]);
    const stats = s.getStats();
    assert.equal(stats.total, 1);
    // only cyber remains
    assert.equal(stats.topDomains.find((d) => d.domain === 'cyber')?.count, 1);
    assert.equal(stats.topDomains.find((d) => d.domain === 'seismic'), undefined);
  });
});

// ── observationId passthrough ────────────────────────────────────────

describe('CausalAttributionService — observationId', () => {
  it('preserves observationId when provided', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [
      makeCandidate({ domain: 'seismic', observationId: 'obs-99' }),
    ]);
    assert.equal(result.causes[0]!.observationId, 'obs-99');
  });

  it('observationId is undefined when not provided', () => {
    const s = makeService();
    const result = s.attribute('a', 'alert', [makeCandidate()]);
    assert.equal(result.causes[0]!.observationId, undefined);
  });
});

// ── Ring buffer capacity ─────────────────────────────────────────────

describe('CausalAttributionService — ring buffer', () => {
  it('evicts oldest when over capacity', () => {
    const s = new CausalAttributionService({ capacity: 3, storage: null, now: () => NOW });
    s.attribute('t1', 'alert', [makeCandidate()]);
    s.attribute('t2', 'alert', [makeCandidate()]);
    s.attribute('t3', 'alert', [makeCandidate()]);
    s.attribute('t4', 'alert', [makeCandidate()]);
    assert.equal(s.getAll().length, 3);
    assert.equal(s.getAttribution('t1'), undefined);
    assert.ok(s.getAttribution('t4') !== undefined);
  });

  it('capacity 1 always keeps only the latest', () => {
    const s = new CausalAttributionService({ capacity: 1, storage: null, now: () => NOW });
    s.attribute('t1', 'alert', [makeCandidate()]);
    s.attribute('t2', 'alert', [makeCandidate()]);
    assert.equal(s.getAll().length, 1);
    assert.equal(s.getAll()[0]!.targetId, 't2');
  });
});

// ── Storage persistence ──────────────────────────────────────────────

describe('CausalAttributionService — storage persistence', () => {
  it('persists attributions to storage on attribute()', () => {
    const storage = makeStorage();
    const s = new CausalAttributionService({ storage, now: () => NOW });
    s.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw !== null, 'expected storage to have data');
    const parsed = JSON.parse(raw!) as { attributions: unknown[] };
    assert.equal(parsed.attributions.length, 1);
  });

  it('rehydrates attributions from storage on construction', () => {
    const storage = makeStorage();
    const s1 = new CausalAttributionService({ storage, now: () => NOW });
    s1.attribute('a1', 'alert', [makeCandidate({ domain: 'seismic' })]);

    const s2 = new CausalAttributionService({ storage, now: () => NOW });
    const retrieved = s2.getAttribution('a1');
    assert.ok(retrieved !== undefined);
    assert.equal(retrieved!.causes[0]!.domain, 'seismic');
  });

  it('null storage skips persistence without error', () => {
    const s = new CausalAttributionService({ storage: null, now: () => NOW });
    assert.doesNotThrow(() => s.attribute('a1', 'alert', [makeCandidate()]));
  });

  it('corrupt storage data is handled gracefully', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not-valid-json{{' });
    assert.doesNotThrow(() => new CausalAttributionService({ storage, now: () => NOW }));
  });

  it('storage with wrong shape is ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ attributions: 'bad' }) });
    const s = new CausalAttributionService({ storage, now: () => NOW });
    assert.equal(s.getAll().length, 0);
  });
});
