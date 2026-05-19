import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EarthquakeMissionBridge,
  MAX_PERSISTED_BRIDGES,
  MissionBridgeBase,
  MissionBridgeRegistry,
  STORAGE_KEY,
  magnitudeToSeverity,
  type MissionBridgeConfig,
  type MissionBridgeOptions,
  type RawEarthquake,
  type StorageLike,
} from '../../src/services/intelligence/mission-bridge-core.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

const NOW = 1_700_000_000_000;

function memoryStorage(): StorageLike & { dump(): string | null } {
  const store: Record<string, string> = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    dump: () => store[STORAGE_KEY] ?? null,
  };
}

class FakeBridge extends MissionBridgeBase {
  public raws: unknown[] = [];
  public skipPredicate: (raw: unknown) => boolean = () => false;
  public fetchError: Error | null = null;

  constructor(
    config: Partial<MissionBridgeConfig> = {},
    options: MissionBridgeOptions = {},
  ) {
    super(
      {
        domain: 'test',
        feedId: 'fake-feed',
        refreshIntervalMs: 1000,
        maxObservationsPerCycle: 10,
        enabled: true,
        ...config,
      },
      options,
    );
  }

  override fetchRaw(): Promise<unknown[]> {
    if (this.fetchError) return Promise.reject(this.fetchError);
    return Promise.resolve(this.raws);
  }

  override normalize(raw: unknown): ObservationEvent | null {
    if (this.skipPredicate(raw)) return null;
    if (typeof raw !== 'object' || !raw) return null;
    const r = raw as { id?: string; timestamp?: number };
    if (typeof r.id !== 'string' || typeof r.timestamp !== 'number') return null;
    return {
      id: r.id,
      sourceId: 'fake-feed',
      domain: 'test',
      timestamp: r.timestamp,
      severity: 'INFO',
      title: `synthetic ${r.id}`,
      raw,
      entityIds: [],
      tags: [],
    };
  }
}

function makeRawQuake(overrides: Partial<RawEarthquake> = {}): RawEarthquake {
  return {
    id: 'usgs-' + Math.random().toString(36).slice(2, 8),
    mag: 4.2,
    time: NOW,
    place: '50 km W of Test City',
    coordinates: [-122.4, 37.7, 10],
    ...overrides,
  };
}

// ── Config validation ────────────────────────────────────────────────────

describe('MissionBridgeBase — construction', () => {
  it('rejects missing domain', () => {
    assert.throws(() => new FakeBridge({ domain: '' }, { storage: memoryStorage() }));
  });

  it('rejects missing feedId', () => {
    assert.throws(() => new FakeBridge({ feedId: '' }, { storage: memoryStorage() }));
  });

  it('rejects non-positive maxObservationsPerCycle', () => {
    assert.throws(() => new FakeBridge({ maxObservationsPerCycle: 0 }, { storage: memoryStorage() }));
    assert.throws(() => new FakeBridge({ maxObservationsPerCycle: -3 }, { storage: memoryStorage() }));
  });

  it('rejects non-positive refreshIntervalMs', () => {
    assert.throws(() => new FakeBridge({ refreshIntervalMs: 0 }, { storage: memoryStorage() }));
    assert.throws(() => new FakeBridge({ refreshIntervalMs: -5 }, { storage: memoryStorage() }));
  });

  it('getConfig returns a defensive clone', () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    const c = b.getConfig();
    c.domain = 'mutated';
    assert.equal(b.getConfig().domain, 'test');
  });
});

// ── getStats / processCycle accounting ───────────────────────────────────

describe('MissionBridgeBase — processCycle', () => {
  it('initial stats are zeroed', () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    const s = b.getStats();
    assert.equal(s.cyclesRun, 0);
    assert.equal(s.totalObservations, 0);
    assert.equal(s.nullSkipped, 0);
    assert.equal(s.lastCycleAt, 0);
    assert.equal(s.errorCount, 0);
    assert.equal(s.lastError, null);
  });

  it('returns [] and does not bump cycles when disabled', async () => {
    const b = new FakeBridge({ enabled: false }, { storage: memoryStorage() });
    b.raws = [{ id: 'a', timestamp: NOW }];
    const out = await b.processCycle();
    assert.deepEqual(out, []);
    assert.equal(b.getStats().cyclesRun, 0);
  });

  it('normalizes every raw → observation pass-through', async () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    b.raws = [
      { id: 'a', timestamp: NOW },
      { id: 'b', timestamp: NOW + 1 },
    ];
    const out = await b.processCycle();
    assert.equal(out.length, 2);
    const stats = b.getStats();
    assert.equal(stats.totalObservations, 2);
    assert.equal(stats.nullSkipped, 0);
    assert.equal(stats.cyclesRun, 1);
  });

  it('counts skipped (normalize → null) into nullSkipped, not the result', async () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    b.raws = [{ id: 'a', timestamp: NOW }, { skip: true }, { id: 'c', timestamp: NOW }];
    b.skipPredicate = (r) => typeof r === 'object' && r !== null && 'skip' in r;
    const out = await b.processCycle();
    assert.equal(out.length, 2);
    assert.equal(b.getStats().nullSkipped, 1);
  });

  it('caps observations at maxObservationsPerCycle', async () => {
    const b = new FakeBridge({ maxObservationsPerCycle: 3 }, { storage: memoryStorage() });
    b.raws = Array.from({ length: 10 }, (_, i) => ({ id: `r-${i}`, timestamp: NOW + i }));
    const out = await b.processCycle();
    assert.equal(out.length, 3);
    assert.equal(b.getStats().totalObservations, 3);
  });

  it('records lastCycleAt from the injected clock', async () => {
    const b = new FakeBridge({}, { storage: memoryStorage(), now: () => NOW + 999 });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await b.processCycle();
    assert.equal(b.getStats().lastCycleAt, NOW + 999);
  });

  it('accumulates cyclesRun + totalObservations across multiple runs', async () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await b.processCycle();
    b.raws = [{ id: 'b', timestamp: NOW + 1 }, { id: 'c', timestamp: NOW + 2 }];
    await b.processCycle();
    const s = b.getStats();
    assert.equal(s.cyclesRun, 2);
    assert.equal(s.totalObservations, 3);
  });

  it('bubbles fetchRaw error and records it', async () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    b.fetchError = new Error('upstream down');
    await assert.rejects(() => b.processCycle(), /upstream down/);
    const s = b.getStats();
    assert.equal(s.errorCount, 1);
    assert.equal(s.lastError, 'upstream down');
    assert.equal(s.cyclesRun, 0);
  });
});

// ── recordError ──────────────────────────────────────────────────────────

describe('MissionBridgeBase — recordError', () => {
  it('increments errorCount each call', () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    b.recordError('boom 1');
    b.recordError('boom 2');
    assert.equal(b.getStats().errorCount, 2);
    assert.equal(b.getStats().lastError, 'boom 2');
  });

  it('truncates very long error messages with an ellipsis', () => {
    const b = new FakeBridge({}, { storage: memoryStorage() });
    const long = 'x'.repeat(500);
    b.recordError(long);
    const msg = b.getStats().lastError!;
    assert.ok(msg.length <= 280, `message too long: ${msg.length}`);
    assert.ok(msg.endsWith('…'));
  });
});

// ── Persistence ──────────────────────────────────────────────────────────

describe('MissionBridgeBase — persistence', () => {
  it('persists stats under STORAGE_KEY keyed by feedId', async () => {
    const storage = memoryStorage();
    const b = new FakeBridge({}, { storage, now: () => NOW });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await b.processCycle();
    const dump = storage.dump();
    assert.ok(dump, 'expected stats payload');
    const parsed = JSON.parse(dump!);
    assert.equal(parsed['fake-feed'].cyclesRun, 1);
    assert.equal(parsed['fake-feed'].totalObservations, 1);
  });

  it('rehydrates stats on construction', async () => {
    const storage = memoryStorage();
    const b1 = new FakeBridge({}, { storage, now: () => NOW });
    b1.raws = [{ id: 'a', timestamp: NOW }];
    await b1.processCycle();
    const b2 = new FakeBridge({}, { storage, now: () => NOW });
    assert.equal(b2.getStats().cyclesRun, 1);
    assert.equal(b2.getStats().totalObservations, 1);
  });

  it('keeps per-bridge stats isolated when many bridges share storage', async () => {
    const storage = memoryStorage();
    const a = new FakeBridge({ feedId: 'a' }, { storage });
    const b = new FakeBridge({ feedId: 'b' }, { storage });
    a.raws = [{ id: 'x', timestamp: NOW }];
    b.raws = [{ id: 'y', timestamp: NOW }, { id: 'z', timestamp: NOW + 1 }];
    await a.processCycle();
    await b.processCycle();
    const parsed = JSON.parse(storage.dump()!);
    assert.equal(parsed.a.totalObservations, 1);
    assert.equal(parsed.b.totalObservations, 2);
  });

  it('survives a corrupt persisted payload', async () => {
    const storage: StorageLike = {
      getItem: () => '{not-json',
      setItem: () => undefined,
    };
    const b = new FakeBridge({}, { storage });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await assert.doesNotReject(() => b.processCycle());
    assert.equal(b.getStats().cyclesRun, 1);
  });

  it('caps persisted entries at MAX_PERSISTED_BRIDGES (drops least-recent)', async () => {
    const storage = memoryStorage();
    // Pre-seed with MAX_PERSISTED_BRIDGES bridges, all with lastCycleAt = 0.
    const blob: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PERSISTED_BRIDGES; i += 1) {
      blob[`old-${i}`] = {
        cyclesRun: 1, totalObservations: 1, nullSkipped: 0,
        lastCycleAt: 0, errorCount: 0, lastError: null,
      };
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(blob));

    const b = new FakeBridge({ feedId: 'new-feed' }, { storage, now: () => NOW });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await b.processCycle();
    const parsed = JSON.parse(storage.dump()!);
    assert.equal(Object.keys(parsed).length, MAX_PERSISTED_BRIDGES);
    assert.ok('new-feed' in parsed);
  });

  it('resetStatsForTesting wipes stats and persists the reset', async () => {
    const storage = memoryStorage();
    const b = new FakeBridge({}, { storage });
    b.raws = [{ id: 'a', timestamp: NOW }];
    await b.processCycle();
    assert.equal(b.getStats().cyclesRun, 1);
    b.resetStatsForTesting();
    assert.equal(b.getStats().cyclesRun, 0);
    const parsed = JSON.parse(storage.dump()!);
    assert.equal(parsed['fake-feed'].cyclesRun, 0);
  });
});

// ── Registry ─────────────────────────────────────────────────────────────

describe('MissionBridgeRegistry', () => {
  beforeEach(() => {
    MissionBridgeRegistry.resetForTesting();
  });

  it('getInstance returns the same singleton', () => {
    const a = MissionBridgeRegistry.getInstance();
    const b = MissionBridgeRegistry.getInstance();
    assert.equal(a, b);
  });

  it('register + getAll round-trips', () => {
    const reg = MissionBridgeRegistry.getInstance();
    const bridge = new FakeBridge({ feedId: 'r1' }, { storage: memoryStorage() });
    reg.register(bridge);
    assert.equal(reg.getAll().length, 1);
    assert.equal(reg.getByFeedId('r1'), bridge);
  });

  it('register is idempotent on feedId (last write wins)', () => {
    const reg = MissionBridgeRegistry.getInstance();
    const a = new FakeBridge({ feedId: 'same' }, { storage: memoryStorage() });
    const b = new FakeBridge({ feedId: 'same' }, { storage: memoryStorage() });
    reg.register(a);
    reg.register(b);
    assert.equal(reg.getAll().length, 1);
    assert.equal(reg.getByFeedId('same'), b);
  });

  it('unregister removes the bridge and returns true', () => {
    const reg = MissionBridgeRegistry.getInstance();
    reg.register(new FakeBridge({ feedId: 'gone' }, { storage: memoryStorage() }));
    assert.equal(reg.unregister('gone'), true);
    assert.equal(reg.getByFeedId('gone'), undefined);
    assert.equal(reg.unregister('gone'), false);
  });

  it('getByDomain filters to bridges in that domain', () => {
    const reg = MissionBridgeRegistry.getInstance();
    reg.register(new FakeBridge({ feedId: 'd-1', domain: 'alpha' }, { storage: memoryStorage() }));
    reg.register(new FakeBridge({ feedId: 'd-2', domain: 'alpha' }, { storage: memoryStorage() }));
    reg.register(new FakeBridge({ feedId: 'd-3', domain: 'beta' }, { storage: memoryStorage() }));
    assert.equal(reg.getByDomain('alpha').length, 2);
    assert.equal(reg.getByDomain('beta').length, 1);
    assert.equal(reg.getByDomain('unknown').length, 0);
  });

  it('runAll concatenates observations from every registered bridge', async () => {
    const reg = MissionBridgeRegistry.getInstance();
    const a = new FakeBridge({ feedId: 'fa' }, { storage: memoryStorage() });
    a.raws = [{ id: 'a1', timestamp: NOW }];
    const b = new FakeBridge({ feedId: 'fb' }, { storage: memoryStorage() });
    b.raws = [{ id: 'b1', timestamp: NOW }, { id: 'b2', timestamp: NOW + 1 }];
    reg.register(a);
    reg.register(b);
    const out = await reg.runAll();
    assert.equal(out.length, 3);
  });

  it('runAll: a bridge that throws does not abort the others', async () => {
    const reg = MissionBridgeRegistry.getInstance();
    const ok = new FakeBridge({ feedId: 'ok' }, { storage: memoryStorage() });
    ok.raws = [{ id: 'good', timestamp: NOW }];
    const bad = new FakeBridge({ feedId: 'bad' }, { storage: memoryStorage() });
    bad.fetchError = new Error('upstream gone');
    reg.register(bad);
    reg.register(ok);
    const out = await reg.runAll();
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, 'good');
    assert.equal(bad.getStats().errorCount, 1);
  });

  it('runAll skips disabled bridges silently', async () => {
    const reg = MissionBridgeRegistry.getInstance();
    const off = new FakeBridge({ feedId: 'off', enabled: false }, { storage: memoryStorage() });
    off.raws = [{ id: 'no', timestamp: NOW }];
    reg.register(off);
    const out = await reg.runAll();
    assert.equal(out.length, 0);
    assert.equal(off.getStats().cyclesRun, 0);
  });
});

// ── Built-in Earthquake bridge ───────────────────────────────────────────

describe('magnitudeToSeverity', () => {
  it('M<3 → INFO', () => assert.equal(magnitudeToSeverity(2.9), 'INFO'));
  it('M<4 → LOW', () => assert.equal(magnitudeToSeverity(3.5), 'LOW'));
  it('M<5 → MEDIUM', () => assert.equal(magnitudeToSeverity(4.7), 'MEDIUM'));
  it('M<6 → HIGH', () => assert.equal(magnitudeToSeverity(5.9), 'HIGH'));
  it('M>=6 → CRITICAL', () => assert.equal(magnitudeToSeverity(6.0), 'CRITICAL'));
  it('non-finite → INFO', () => assert.equal(magnitudeToSeverity(Number.NaN), 'INFO'));
});

describe('EarthquakeMissionBridge', () => {
  it('uses the seismic / usgs-earthquake defaults', () => {
    const b = new EarthquakeMissionBridge({ storage: memoryStorage() });
    assert.equal(b.getConfig().domain, 'seismic');
    assert.equal(b.getConfig().feedId, 'usgs-earthquake');
  });

  it('normalize skips items missing magnitude', () => {
    const b = new EarthquakeMissionBridge({ storage: memoryStorage() });
    assert.equal(b.normalize(makeRawQuake({ mag: null })), null);
  });

  it('normalize emits a valid ObservationEvent with severity from magnitude', () => {
    const b = new EarthquakeMissionBridge({ storage: memoryStorage() });
    const ev = b.normalize(makeRawQuake({ mag: 5.5, id: 'q-1', place: 'X' }));
    assert.ok(ev);
    assert.equal(ev!.severity, 'HIGH');
    assert.equal(ev!.sourceId, 'usgs-earthquake');
    assert.equal(ev!.domain, 'seismic');
    assert.equal(ev!.location?.lat, 37.7);
    assert.equal(ev!.location?.lon, -122.4);
    assert.match(ev!.title, /M5\.5/);
    assert.match(ev!.title, /X/);
  });

  it('normalize stamps tags with severity classification', () => {
    const b = new EarthquakeMissionBridge({ storage: memoryStorage() });
    const ev = b.normalize(makeRawQuake({ mag: 6.4 }));
    assert.ok(ev?.tags.includes('earthquake'));
    assert.ok(ev?.tags.includes('severity-critical'));
  });

  it('normalize rejects malformed raw payloads', () => {
    const b = new EarthquakeMissionBridge({ storage: memoryStorage() });
    assert.equal(b.normalize(null), null);
    assert.equal(b.normalize({}), null);
    assert.equal(b.normalize({ id: 'x', time: 0, place: 'P', coordinates: [] }), null);
  });

  it('processCycle integrates fetcher + normalize end-to-end', async () => {
    const quakes: RawEarthquake[] = [
      makeRawQuake({ id: 'a', mag: 2.0 }),
      makeRawQuake({ id: 'b', mag: 5.5 }),
      makeRawQuake({ id: 'c', mag: null }),  // skipped
    ];
    const b = new EarthquakeMissionBridge({
      storage: memoryStorage(),
      fetcher: () => Promise.resolve(quakes),
    });
    const out = await b.processCycle();
    assert.equal(out.length, 2);
    assert.equal(b.getStats().nullSkipped, 1);
    assert.equal(out[0]!.severity, 'INFO');
    assert.equal(out[1]!.severity, 'HIGH');
  });

  it('config overrides merge with defaults', () => {
    const b = new EarthquakeMissionBridge({
      storage: memoryStorage(),
      config: { maxObservationsPerCycle: 5, refreshIntervalMs: 30_000 },
    });
    assert.equal(b.getConfig().domain, 'seismic');
    assert.equal(b.getConfig().feedId, 'usgs-earthquake');
    assert.equal(b.getConfig().maxObservationsPerCycle, 5);
    assert.equal(b.getConfig().refreshIntervalMs, 30_000);
  });
});
