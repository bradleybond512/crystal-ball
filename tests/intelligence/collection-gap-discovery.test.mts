/**
 * CollectionGapDiscoveryService — deterministic unit tests (spec-aligned).
 *
 * Tests the auditDomain() / getGaps() / resolveGap() / getStats() API,
 * severity mapping, deduplication, ring-buffer eviction, storage
 * persist/rehydrate, initial 8-domain seed, and singleton lifecycle.
 *
 * No DOM, no live localStorage — injectable storage throughout.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  CollectionGapDiscoveryService,
  getCollectionGapDiscoveryService,
  __internals,
  STORAGE_KEY,
  MAX_GAPS,
  STALE_THRESHOLD_MS,
  MIN_FEEDS,
  MIN_REGIONS,
} from '../../src/services/intelligence/collection-gap-discovery.ts';
import type { StorageLike, CollectionGap } from '../../src/services/intelligence/collection-gap-discovery.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

/** Fresh service with no seed and frozen clock — clean slate for most tests. */
function makeService(storage: StorageLike | null = null): CollectionGapDiscoveryService {
  return new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
}

// ── Constants ─────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is wm-collection-gaps', () => {
    assert.equal(STORAGE_KEY, 'wm-collection-gaps');
  });

  it('MAX_GAPS is 500', () => {
    assert.equal(MAX_GAPS, 500);
  });

  it('STALE_THRESHOLD_MS is 3_600_000 (1 hour)', () => {
    assert.equal(STALE_THRESHOLD_MS, 3_600_000);
  });
});

// ── auditDomain — individual conditions ───────────────────────────────────

describe('auditDomain — individual conditions', () => {
  it('feedCount < 2 → single-source gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 5);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.gapType, 'single-source');
  });

  it('lastObservationAge > STALE_THRESHOLD_MS → stale-data gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], STALE_THRESHOLD_MS + 1, 5);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.gapType, 'stale-data');
  });

  it('regionsCovered.length < 3 → low-coverage gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU'], 0, 5);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.gapType, 'low-coverage');
  });

  it('alertCount === 0 → no-alerts gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], 0, 0);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.gapType, 'no-alerts');
  });

  it('all conditions met → no gaps', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', MIN_FEEDS, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(gaps.length, 0);
  });

  it('all conditions violated → 4 gaps returned', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('health', 1, ['NA'], STALE_THRESHOLD_MS + 1, 0);
    assert.equal(gaps.length, 4);
    const types = gaps.map((g) => g.gapType).sort();
    assert.deepEqual(types, ['low-coverage', 'no-alerts', 'single-source', 'stale-data']);
  });
});

// ── auditDomain — threshold boundaries ───────────────────────────────────

describe('auditDomain — threshold boundaries', () => {
  it('feedCount === MIN_FEEDS (2) → no single-source gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', MIN_FEEDS, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(gaps.filter((g) => g.gapType === 'single-source').length, 0);
  });

  it('feedCount === 1 (< MIN_FEEDS) → single-source gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(gaps.filter((g) => g.gapType === 'single-source').length, 1);
  });

  it('lastObservationAge === STALE_THRESHOLD_MS (not strictly greater) → no stale-data gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], STALE_THRESHOLD_MS, 3);
    assert.equal(gaps.filter((g) => g.gapType === 'stale-data').length, 0);
  });

  it('regionsCovered.length === MIN_REGIONS (3) → no low-coverage gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(gaps.filter((g) => g.gapType === 'low-coverage').length, 0);
  });

  it('regionsCovered.length === 2 (< MIN_REGIONS) → low-coverage gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU'], 0, 3);
    assert.equal(gaps.filter((g) => g.gapType === 'low-coverage').length, 1);
  });

  it('alertCount === 1 (not zero) → no no-alerts gap', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], 0, 1);
    assert.equal(gaps.filter((g) => g.gapType === 'no-alerts').length, 0);
  });
});

// ── auditDomain — deduplication ───────────────────────────────────────────

describe('auditDomain — deduplication', () => {
  it('re-auditing with same failing condition does not create duplicate open gap', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    const second = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(second.length, 0);
    assert.equal(svc.getGaps('cyber').length, 1);
  });

  it('re-auditing after resolving gap creates a fresh gap', () => {
    const svc = makeService();
    const first = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.resolveGap(first[0]!.id);
    const second = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(second.length, 1);
    assert.notEqual(second[0]!.id, first[0]!.id);
  });

  it('same gap type on different domains each creates a gap', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.auditDomain('maritime', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(svc.getGaps().filter((g) => g.gapType === 'single-source').length, 2);
  });
});

// ── Severity mapping ──────────────────────────────────────────────────────

describe('severity mapping', () => {
  it('single-source → medium', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(gaps.find((g) => g.gapType === 'single-source')?.severity, 'medium');
  });

  it('stale-data → high', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], STALE_THRESHOLD_MS + 1, 3);
    assert.equal(gaps.find((g) => g.gapType === 'stale-data')?.severity, 'high');
  });

  it('low-coverage → low', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US'], 0, 3);
    assert.equal(gaps.find((g) => g.gapType === 'low-coverage')?.severity, 'low');
  });

  it('no-alerts → high', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 3, ['US', 'EU', 'AS'], 0, 0);
    assert.equal(gaps.find((g) => g.gapType === 'no-alerts')?.severity, 'high');
  });
});

// ── getGaps ───────────────────────────────────────────────────────────────

describe('getGaps', () => {
  it('returns only open gaps (resolved excluded)', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US'], STALE_THRESHOLD_MS + 1, 0);
    svc.resolveGap(gaps[0]!.id);
    const open = svc.getGaps();
    assert.ok(open.every((g) => g.resolvedAt === undefined));
    assert.ok(open.length < gaps.length);
  });

  it('returns empty array when no open gaps', () => {
    const svc = makeService();
    assert.deepEqual(svc.getGaps(), []);
  });

  it('sorted by severity descending: high → medium → low', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US'], STALE_THRESHOLD_MS + 1, 0);
    const gaps = svc.getGaps();
    const severities = gaps.map((g) => g.severity);
    for (let i = 1; i < severities.length; i += 1) {
      const prev = severities[i - 1]!;
      const curr = severities[i]!;
      const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
      assert.ok(order[prev]! >= order[curr]!, `${prev} < ${curr} at index ${i}`);
    }
  });

  it('domain filter returns only that domain', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.auditDomain('maritime', 1, ['Atlantic'], 0, 3);
    const cyberGaps = svc.getGaps('cyber');
    assert.ok(cyberGaps.every((g) => g.domain === 'cyber'));
    assert.equal(cyberGaps.length, 1);
  });

  it('returns clones — mutating result does not affect service state', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    const gaps = svc.getGaps();
    gaps[0]!.severity = 'low'; // mutation
    const gaps2 = svc.getGaps();
    assert.equal(gaps2[0]!.severity, 'medium'); // unchanged
  });
});

// ── resolveGap ────────────────────────────────────────────────────────────

describe('resolveGap', () => {
  it('returns true and sets resolvedAt', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    const ok = svc.resolveGap(gaps[0]!.id);
    assert.equal(ok, true);
    assert.equal(svc.getGaps('cyber').length, 0);
  });

  it('returns false for unknown id', () => {
    const svc = makeService();
    assert.equal(svc.resolveGap('does-not-exist'), false);
  });

  it('returns false when gap is already resolved', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.resolveGap(gaps[0]!.id);
    assert.equal(svc.resolveGap(gaps[0]!.id), false);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('zeros for empty service (seed: false)', () => {
    const svc = makeService();
    const stats = svc.getStats();
    assert.equal(stats.totalGaps, 0);
    assert.equal(stats.bySeverity.high, 0);
    assert.equal(stats.bySeverity.medium, 0);
    assert.equal(stats.bySeverity.low, 0);
    assert.equal(stats.resolutionRate, 0);
  });

  it('totalGaps counts all gaps including resolved', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US'], STALE_THRESHOLD_MS + 1, 0);
    svc.resolveGap(gaps[0]!.id);
    const stats = svc.getStats();
    assert.equal(stats.totalGaps, gaps.length); // all, not just open
  });

  it('byDomain counts only open gaps', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);           // 1 gap: single-source
    svc.auditDomain('maritime', 1, ['Atlantic', 'Pacific', 'Indian'], 0, 3);       // 1 gap: single-source
    svc.resolveGap(gaps[0]!.id);                                                   // resolve cyber
    const stats = svc.getStats();
    assert.equal(stats.byDomain['cyber'], undefined);    // resolved → not counted
    assert.equal(stats.byDomain['maritime'], 1);
  });

  it('bySeverity counts open gaps by level', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US'], STALE_THRESHOLD_MS + 1, 0); // medium + high + high + low
    const stats = svc.getStats();
    assert.equal(stats.bySeverity.high, 2);    // stale-data + no-alerts
    assert.equal(stats.bySeverity.medium, 1);  // single-source
    assert.equal(stats.bySeverity.low, 1);     // low-coverage
  });

  it('resolutionRate = resolved / total (4dp)', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3); // 1 gap
    svc.auditDomain('maritime', 1, ['Atlantic', 'Pacific', 'Indian'], 0, 3); // 1 gap
    svc.resolveGap(gaps[0]!.id);
    const stats = svc.getStats();
    assert.equal(stats.resolutionRate, Number((1 / 2).toFixed(4)));
  });

  it('resolutionRate is 0 when no gaps at all', () => {
    const svc = makeService();
    assert.equal(svc.getStats().resolutionRate, 0);
  });
});

// ── Initial seed ──────────────────────────────────────────────────────────

describe('initial seed', () => {
  it('seeded service (default) has open gaps from 8 domains', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    const allDomains = new Set(svc.getGaps().map((g) => g.domain));
    // weather and aviation are well-covered in seed params, others have gaps
    assert.ok(allDomains.size >= 4, `expected ≥ 4 domains with gaps, got ${allDomains.size}`);
  });

  it('health domain gets 4 gaps (all 4 conditions triggered)', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    const health = svc.getGaps('health');
    assert.equal(health.length, 4, `expected 4 health gaps, got ${health.length}`);
    const types = health.map((g) => g.gapType).sort();
    assert.deepEqual(types, ['low-coverage', 'no-alerts', 'single-source', 'stale-data']);
  });

  it('weather domain gets 0 gaps (all conditions satisfied)', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    assert.equal(svc.getGaps('weather').length, 0);
  });

  it('cyber domain gets single-source + low-coverage (feedCount=1, regions=1)', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    const cyber = svc.getGaps('cyber');
    const types = cyber.map((g) => g.gapType).sort();
    assert.deepEqual(types, ['low-coverage', 'single-source']);
  });

  it('maritime domain gets stale-data + low-coverage (age > 1h, 2 regions)', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    const maritime = svc.getGaps('maritime');
    const types = maritime.map((g) => g.gapType).sort();
    assert.deepEqual(types, ['low-coverage', 'stale-data']);
  });

  it('aviation domain gets no gaps (3 feeds, 3 regions, fresh, alerts > 0)', () => {
    CollectionGapDiscoveryService._resetForTests();
    const svc = new CollectionGapDiscoveryService({ storage: null, clock: () => NOW });
    assert.equal(svc.getGaps('aviation').length, 0);
  });

  it('seed: false skips initial audit — service starts empty', () => {
    const svc = makeService(); // already uses seed: false
    assert.equal(svc.getGaps().length, 0);
  });
});

// ── Storage persist / rehydrate ───────────────────────────────────────────

describe('storage persist / rehydrate', () => {
  it('gaps are written to storage on auditDomain', () => {
    const storage = makeStorage();
    const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.ok(storage.store.has(STORAGE_KEY));
    const parsed = JSON.parse(storage.store.get(STORAGE_KEY)!) as CollectionGap[];
    assert.equal(parsed.length, 1);
  });

  it('new instance rehydrates gaps from storage', () => {
    const storage = makeStorage();
    const svc1 = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    svc1.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);

    const svc2 = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    assert.equal(svc2.getGaps('cyber').length, 1);
  });

  it('rehydrated gaps prevent duplicates when re-auditing', () => {
    const storage = makeStorage();
    const svc1 = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    svc1.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);

    const svc2 = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    const result = svc2.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    assert.equal(result.length, 0); // dedup against rehydrated gap
  });

  it('corrupt JSON in storage is silently ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: 'not-json{{{' });
    assert.doesNotThrow(() => {
      const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
      svc.getGaps();
    });
  });

  it('non-array JSON in storage is silently ignored', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ id: 'oops' }) });
    const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    assert.equal(svc.getGaps().length, 0);
  });

  it('entries without id/domain are skipped during rehydration', () => {
    const bad: unknown[] = [
      { id: 'valid', domain: 'cyber', gapType: 'single-source', severity: 'medium', description: 'x', discoveredAt: NOW },
      { domain: 'no-id' },
      null,
      42,
    ];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(bad) });
    const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    assert.equal(svc.getGaps().length, 1);
  });

  it('resolveGap persists to storage', () => {
    const storage = makeStorage();
    const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.resolveGap(gaps[0]!.id);
    const parsed = JSON.parse(storage.store.get(STORAGE_KEY)!) as CollectionGap[];
    assert.ok(parsed[0]!.resolvedAt !== undefined);
  });
});

// ── Ring-buffer capacity ──────────────────────────────────────────────────

describe('ring-buffer capacity', () => {
  it('gap list never exceeds MAX_GAPS', () => {
    const svc = makeService();
    for (let i = 0; i < MAX_GAPS + 10; i += 1) {
      // Each unique domain creates a fresh gap without dedup
      svc.auditDomain(`domain-${i}`, 1, ['US', 'EU', 'AS'], 0, 3);
    }
    // Only open gaps returned, but internal total is capped
    const stats = svc.getStats();
    assert.ok(stats.totalGaps <= MAX_GAPS, `totalGaps ${stats.totalGaps} > MAX_GAPS ${MAX_GAPS}`);
  });
});

// ── resetForTesting() instance method ────────────────────────────────────

describe('resetForTesting()', () => {
  it('clears all gaps', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.resetForTesting();
    assert.equal(svc.getGaps().length, 0);
    assert.equal(svc.getStats().totalGaps, 0);
  });

  it('clears storage key', () => {
    const storage = makeStorage();
    const svc = new CollectionGapDiscoveryService({ storage, clock: () => NOW, seed: false });
    svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    svc.resetForTesting();
    assert.equal(storage.store.has(STORAGE_KEY), false);
  });
});

// ── Singleton lifecycle ───────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => {
    CollectionGapDiscoveryService._resetForTests();
  });

  it('getInstance() returns the same instance on repeated calls', () => {
    const a = CollectionGapDiscoveryService.getInstance();
    const b = CollectionGapDiscoveryService.getInstance();
    assert.strictEqual(a, b);
  });

  it('_resetForTests() creates a fresh instance on next call', () => {
    const a = CollectionGapDiscoveryService.getInstance();
    CollectionGapDiscoveryService._resetForTests();
    const b = CollectionGapDiscoveryService.getInstance();
    assert.notStrictEqual(a, b);
  });

  it('getCollectionGapDiscoveryService() returns singleton', () => {
    const inst = CollectionGapDiscoveryService.getInstance();
    assert.strictEqual(getCollectionGapDiscoveryService(), inst);
  });
});

// ── Gap fields ────────────────────────────────────────────────────────────

describe('gap fields', () => {
  it('gap has id, domain, gapType, severity, description, discoveredAt', () => {
    const svc = makeService();
    const gaps = svc.auditDomain('cyber', 1, ['US', 'EU', 'AS'], 0, 3);
    const g = gaps[0]!;
    assert.ok(typeof g.id === 'string' && g.id.length > 0);
    assert.equal(g.domain, 'cyber');
    assert.equal(g.gapType, 'single-source');
    assert.equal(g.severity, 'medium');
    assert.ok(typeof g.description === 'string' && g.description.includes('cyber'));
    assert.equal(g.discoveredAt, NOW);
    assert.equal(g.resolvedAt, undefined);
  });

  it('ids are unique across consecutive auditDomain calls', () => {
    const svc = makeService();
    svc.auditDomain('cyber', 1, ['US'], STALE_THRESHOLD_MS + 1, 0);
    const gaps = svc.getGaps();
    const ids = gaps.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
