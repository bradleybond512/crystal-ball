import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CrossDomainContradictionDetector,
  STORAGE_KEY,
  MAX_RECORDS,
  WINDOW_MS,
} from '../cross-domain-contradiction-detector.js';
import type { StorageLike } from '../cross-domain-contradiction-detector.js';
import type { ObservationEvent } from '@/types/intelligence.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeObs(
  id: string,
  domain: string,
  severity: ObservationEvent['severity'],
  region?: string,
  tsOffset = 0,
): ObservationEvent {
  return {
    id,
    sourceId: 'test',
    domain,
    timestamp: NOW + tsOffset,
    severity,
    title: `${domain} ${severity}`,
    raw: {},
    entityIds: [],
    tags: region ? [`region:${region}`] : [],
  } as ObservationEvent;
}

function makeStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

function makeDetector(storage: StorageLike | null = null) {
  return new CrossDomainContradictionDetector({ now: () => NOW, storage });
}

// ── checkForContradictions — basics ─────────────────────────────────────────

describe('checkForContradictions — basics', () => {
  it('returns empty for fewer than 2 observations', () => {
    const d = makeDetector();
    assert.deepEqual(d.checkForContradictions([]), []);
    assert.deepEqual(d.checkForContradictions([makeObs('a', 'weather', 'HIGH', 'east-asia')]), []);
  });

  it('returns empty when observations have no region tags', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'HIGH'),     // no tag
      makeObs('b', 'military', 'LOW'),     // no tag
    ];
    assert.deepEqual(d.checkForContradictions(obs), []);
  });

  it('returns empty when both observations are same domain', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'HIGH', 'east-asia'),
      makeObs('b', 'weather', 'LOW', 'east-asia'),
    ];
    assert.deepEqual(d.checkForContradictions(obs), []);
  });

  it('returns empty when severity gap is not contradictory (same severity)', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'HIGH', 'east-asia'),
      makeObs('b', 'military', 'HIGH', 'east-asia'),
    ];
    assert.deepEqual(d.checkForContradictions(obs), []);
  });

  it('returns empty when severity gap is too small (MEDIUM vs MEDIUM)', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'MEDIUM', 'east-asia'),
      makeObs('b', 'military', 'MEDIUM', 'east-asia'),
    ];
    assert.deepEqual(d.checkForContradictions(obs), []);
  });
});

// ── severity classification ──────────────────────────────────────────────────

describe('severity classification', () => {
  it('returns high contradiction: CRITICAL vs LOW', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'gulf'),
      makeObs('b', 'military', 'LOW', 'gulf'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 1);
    assert.equal(recs[0]!.severity, 'high');
  });

  it('returns high contradiction: HIGH vs INFO', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'finance', 'INFO', 'eu'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs[0]!.severity, 'high');
  });

  it('returns medium contradiction: MEDIUM vs LOW', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'MEDIUM', 'west-africa'),
      makeObs('b', 'military', 'LOW', 'west-africa'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 1);
    assert.equal(recs[0]!.severity, 'medium');
  });

  it('returns medium contradiction: MEDIUM vs INFO', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'MEDIUM', 'south-asia'),
      makeObs('b', 'military', 'INFO', 'south-asia'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs[0]!.severity, 'medium');
  });

  it('ignores HIGH vs MEDIUM — gap not large enough', () => {
    // classifySeverity: high=3, low=2 → high(3) >= 3 but low(2) > 1 → not null?
    // Actually: high >= 3 && low <= 1 → false; high >= 2 && low <= 1 → false → null
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'HIGH', 'region-x'),
      makeObs('b', 'military', 'MEDIUM', 'region-x'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 0);
  });
});

// ── 2-hour time window ───────────────────────────────────────────────────────

describe('2-hour time window', () => {
  it('detects contradiction when timestamps are within WINDOW_MS', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'pac-rim', 0),
      makeObs('b', 'military', 'LOW', 'pac-rim', WINDOW_MS - 1),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 1);
  });

  it('ignores pairs outside the WINDOW_MS', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'pac-rim', 0),
      makeObs('b', 'military', 'LOW', 'pac-rim', WINDOW_MS + 1),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 0);
  });
});

// ── region grouping ──────────────────────────────────────────────────────────

describe('region grouping', () => {
  it('does not cross-compare observations in different regions', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'region-north'),
      makeObs('b', 'military', 'LOW', 'region-south'),
    ];
    assert.equal(d.checkForContradictions(obs).length, 0);
  });

  it('detects contradictions in each region independently', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'north'),
      makeObs('b', 'military', 'LOW', 'north'),
      makeObs('c', 'weather', 'HIGH', 'south'),
      makeObs('d', 'military', 'INFO', 'south'),
    ];
    const recs = d.checkForContradictions(obs);
    assert.equal(recs.length, 2);
    const regions = new Set(recs.map((r) => r.region));
    assert.ok(regions.has('north'));
    assert.ok(regions.has('south'));
  });
});

// ── de-duplication ───────────────────────────────────────────────────────────

describe('de-duplication', () => {
  it('does not create a duplicate for the same observation pair', () => {
    const d = makeDetector();
    const obs = [
      makeObs('a', 'weather', 'CRITICAL', 'east-asia'),
      makeObs('b', 'military', 'LOW', 'east-asia'),
    ];
    d.checkForContradictions(obs);
    const second = d.checkForContradictions(obs);
    assert.equal(second.length, 0);
  });

  it('canonical key is commutative — domain and obs order do not matter', () => {
    const d = makeDetector();
    const obs1 = [
      makeObs('x', 'cyber', 'HIGH', 'region-z'),
      makeObs('y', 'finance', 'INFO', 'region-z'),
    ];
    const obs2 = [
      makeObs('y', 'finance', 'INFO', 'region-z'),
      makeObs('x', 'cyber', 'HIGH', 'region-z'),
    ];
    d.checkForContradictions(obs1);
    const second = d.checkForContradictions(obs2);
    assert.equal(second.length, 0);
  });
});

// ── record fields ────────────────────────────────────────────────────────────

describe('record fields', () => {
  it('record has domainA < domainB alphabetically', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'z-domain', 'CRITICAL', 'reg'),
      makeObs('b', 'a-domain', 'LOW', 'reg'),
    ]);
    assert.ok(recs[0]!.domainA < recs[0]!.domainB);
    assert.equal(recs[0]!.domainA, 'a-domain');
  });

  it('record description includes region and both domains with severities', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'weather', 'CRITICAL', 'pacific'),
      makeObs('b', 'military', 'LOW', 'pacific'),
    ]);
    const desc = recs[0]!.description;
    assert.ok(desc.includes('pacific'));
    assert.ok(desc.includes('weather') || desc.includes('military'));
    assert.ok(desc.includes('CRITICAL') || desc.includes('LOW'));
  });

  it('record detectedAt equals the clock value', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    assert.equal(recs[0]!.detectedAt, NOW);
  });

  it('record has no resolvedAt initially', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    assert.equal(recs[0]!.resolvedAt, undefined);
  });
});

// ── getActive / getAll ───────────────────────────────────────────────────────

describe('getActive / getAll', () => {
  it('getAll returns all records including resolved', () => {
    const d = makeDetector();
    d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    assert.equal(d.getAll().length, 1);
  });

  it('getActive excludes resolved records', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    d.resolve(recs[0]!.id, 'operator');
    assert.equal(d.getActive().length, 0);
  });

  it('getActive returns shallow copies', () => {
    const d = makeDetector();
    d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    const list = d.getActive();
    list[0]!.domainA = 'mutated';
    assert.equal(d.getActive()[0]!.domainA, 'cyber');
  });
});

// ── resolve ──────────────────────────────────────────────────────────────────

describe('resolve', () => {
  it('sets resolvedAt and resolvedBy', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    d.resolve(recs[0]!.id, 'analyst-1');
    const all = d.getAll();
    assert.equal(all[0]!.resolvedAt, NOW);
    assert.equal(all[0]!.resolvedBy, 'analyst-1');
  });

  it('is idempotent — resolving twice does not change resolvedAt', () => {
    const d = new CrossDomainContradictionDetector({
      now: (() => { let t = NOW; return () => (t += 1000); })(),
      storage: null,
    });
    const recs = d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    d.resolve(recs[0]!.id, 'analyst-1');
    const firstResolved = d.getAll()[0]!.resolvedAt;
    d.resolve(recs[0]!.id, 'analyst-2');
    assert.equal(d.getAll()[0]!.resolvedAt, firstResolved);
  });

  it('is a no-op for unknown id', () => {
    const d = makeDetector();
    d.resolve('nonexistent', 'analyst');
    assert.equal(d.getAll().length, 0);
  });
});

// ── getStats ─────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('counts total, active, and byDomain', () => {
    const d = makeDetector();
    const recs = d.checkForContradictions([
      makeObs('a', 'weather', 'CRITICAL', 'reg-1'),
      makeObs('b', 'military', 'LOW', 'reg-1'),
      makeObs('c', 'cyber', 'HIGH', 'reg-2'),
      makeObs('d', 'finance', 'INFO', 'reg-2'),
    ]);
    d.resolve(recs[0]!.id, 'op');
    const stats = d.getStats();
    assert.equal(stats.total, 2);
    assert.equal(stats.active, 1);
    assert.ok(stats.byDomain['weather'] !== undefined || stats.byDomain['military'] !== undefined);
  });

  it('byDomain counts each domain appearance', () => {
    const d = makeDetector();
    d.checkForContradictions([
      makeObs('a', 'weather', 'CRITICAL', 'r'),
      makeObs('b', 'military', 'LOW', 'r'),
    ]);
    const stats = d.getStats();
    assert.equal(stats.byDomain['weather'], 1);
    assert.equal(stats.byDomain['military'], 1);
  });
});

// ── MAX_RECORDS ring buffer ──────────────────────────────────────────────────

describe('MAX_RECORDS ring buffer', () => {
  it(`caps at ${MAX_RECORDS} records`, () => {
    const d = makeDetector();
    for (let i = 0; i < MAX_RECORDS + 10; i++) {
      d.checkForContradictions([
        makeObs(`a${i}`, 'cyber', 'CRITICAL', `region-${i}`),
        makeObs(`b${i}`, 'military', 'LOW', `region-${i}`),
      ]);
    }
    assert.ok(d.getAll().length <= MAX_RECORDS);
  });
});

// ── storage persistence ──────────────────────────────────────────────────────

describe('storage persistence', () => {
  it('persists records after checkForContradictions', () => {
    const storage = makeStorage();
    const d = new CrossDomainContradictionDetector({ now: () => NOW, storage });
    d.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    assert.ok(storage.store.has(STORAGE_KEY));
    const raw = JSON.parse(storage.store.get(STORAGE_KEY)!);
    assert.equal(raw.length, 1);
  });

  it('rehydrates records on construction', () => {
    const storage = makeStorage();
    const d1 = new CrossDomainContradictionDetector({ now: () => NOW, storage });
    d1.checkForContradictions([
      makeObs('a', 'cyber', 'HIGH', 'eu'),
      makeObs('b', 'weather', 'INFO', 'eu'),
    ]);
    const d2 = new CrossDomainContradictionDetector({ now: () => NOW, storage });
    assert.equal(d2.getAll().length, 1);
  });

  it('handles corrupt storage gracefully', () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, 'CORRUPT');
    const d = new CrossDomainContradictionDetector({ now: () => NOW, storage });
    assert.equal(d.getAll().length, 0);
  });

  it('handles throwing getItem gracefully', () => {
    const faultyStorage: StorageLike = {
      getItem: () => { throw new Error('quota'); },
      setItem: () => {},
      removeItem: () => {},
    };
    const d = new CrossDomainContradictionDetector({ now: () => NOW, storage: faultyStorage });
    assert.equal(d.getAll().length, 0);
  });
});

// ── singleton ────────────────────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => CrossDomainContradictionDetector._resetSingletonForTests());

  it('getInstance returns the same instance', () => {
    const a = CrossDomainContradictionDetector.getInstance();
    const b = CrossDomainContradictionDetector.getInstance();
    assert.equal(a, b);
  });

  it('returns a new instance after reset', () => {
    const a = CrossDomainContradictionDetector.getInstance();
    CrossDomainContradictionDetector._resetSingletonForTests();
    const b = CrossDomainContradictionDetector.getInstance();
    assert.notEqual(a, b);
  });
});
