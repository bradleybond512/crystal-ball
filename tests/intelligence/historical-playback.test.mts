/**
 * HistoricalPlaybackService — deterministic unit tests.
 *
 * Verifies snapshot capture (with/without notes, defensive clones),
 * id lookup, range queries (inclusive bounds, empty result, ordering),
 * binary-search getNearest() across edge positions, lightweight timeline
 * shape + ordering, exportRange parity, ring-buffer eviction at
 * MAX_SNAPSHOTS, storage persist/rehydrate (including malformed input),
 * and singleton lifecycle.
 *
 * Injectable storage + clock throughout — no live localStorage, no Date.now.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import {
  HistoricalPlaybackService,
  getHistoricalPlaybackService,
  __internals,
  STORAGE_KEY,
  MAX_SNAPSHOTS,
} from '../../src/services/intelligence/historical-playback.ts';
import type {
  StorageLike,
  WorldSnapshot,
  DomainState,
} from '../../src/services/intelligence/historical-playback.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;

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

function makeService(
  storage: StorageLike | null = null,
  clock: () => number = () => T0,
): HistoricalPlaybackService {
  return new HistoricalPlaybackService({ storage, clock });
}

const SAMPLE_DOMAINS: DomainState[] = [
  { domain: 'cyber', severity: 0.4, eventCount: 12 },
  { domain: 'weather', severity: 0.8, eventCount: 30 },
  { domain: 'maritime', severity: 0.2, eventCount: 5 },
];

// ── Constants ─────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is wm-historical-playback', () => {
    assert.equal(STORAGE_KEY, 'wm-historical-playback');
  });

  it('MAX_SNAPSHOTS is 2000', () => {
    assert.equal(MAX_SNAPSHOTS, 2000);
  });

  it('__internals re-exports the constants', () => {
    assert.equal(__internals.STORAGE_KEY, STORAGE_KEY);
    assert.equal(__internals.MAX_SNAPSHOTS, MAX_SNAPSHOTS);
  });
});

// ── Singleton lifecycle ──────────────────────────────────────────────────

describe('singleton', () => {
  beforeEach(() => { HistoricalPlaybackService._resetForTests(); });

  it('getInstance() returns the same instance across calls', () => {
    const a = HistoricalPlaybackService.getInstance();
    const b = HistoricalPlaybackService.getInstance();
    assert.equal(a, b);
  });

  it('getHistoricalPlaybackService() delegates to getInstance()', () => {
    const a = HistoricalPlaybackService.getInstance();
    const b = getHistoricalPlaybackService();
    assert.equal(a, b);
  });

  it('_resetForTests() clears the cached singleton', () => {
    const a = HistoricalPlaybackService.getInstance();
    HistoricalPlaybackService._resetForTests();
    const b = HistoricalPlaybackService.getInstance();
    assert.notEqual(a, b);
  });
});

// ── captureSnapshot ───────────────────────────────────────────────────────

describe('captureSnapshot', () => {
  it('stamps capturedAt from the injected clock', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    t = T0 + 1234;
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 3, 7);
    assert.equal(snap.capturedAt, T0 + 1234);
  });

  it('records situationCount, activeAlerts, and domain states verbatim', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 4, 9);
    assert.equal(snap.situationCount, 4);
    assert.equal(snap.activeAlerts, 9);
    assert.equal(snap.domainStates.length, 3);
    assert.equal(snap.domainStates[1].domain, 'weather');
    assert.equal(snap.domainStates[1].severity, 0.8);
  });

  it('attaches notes when provided', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0, 'manual checkpoint');
    assert.equal(snap.notes, 'manual checkpoint');
  });

  it('omits notes when not provided (does not store undefined)', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(snap, 'notes'), false);
  });

  it('generates unique ids across captures at the same instant', () => {
    const svc = makeService();
    const a = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const b = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const c = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  });

  it('clones domainStates so caller mutations after capture do not leak in', () => {
    const svc = makeService();
    const states: DomainState[] = [{ domain: 'cyber', severity: 0.5, eventCount: 1 }];
    svc.captureSnapshot(states, 0, 0);
    states[0].severity = 0.99;
    const stored = svc.getTimeline()[0];
    assert.equal(stored.severity, 0.5);
  });

  it('return value is a defensive copy (mutating it does not affect the store)', () => {
    const svc = makeService();
    const returned = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    returned.domainStates[0].severity = 0.01;
    const reread = svc.getSnapshot(returned.id);
    assert.equal(reread?.domainStates[0].severity, 0.4);
  });
});

// ── getSnapshot ───────────────────────────────────────────────────────────

describe('getSnapshot', () => {
  it('returns the snapshot for a known id', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const fetched = svc.getSnapshot(snap.id);
    assert.ok(fetched);
    assert.equal(fetched!.id, snap.id);
  });

  it('returns undefined for an unknown id', () => {
    const svc = makeService();
    assert.equal(svc.getSnapshot('ghost'), undefined);
  });

  it('returns a defensive copy (mutating it does not affect the store)', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const a = svc.getSnapshot(snap.id)!;
    a.domainStates[0].severity = 0.01;
    const b = svc.getSnapshot(snap.id)!;
    assert.equal(b.domainStates[0].severity, 0.4);
  });
});

// ── getSnapshotsInRange ───────────────────────────────────────────────────

describe('getSnapshotsInRange', () => {
  function withCaptures(): HistoricalPlaybackService {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < 5; i += 1) {
      t = T0 + i * 1000;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    return svc;
  }

  it('returns snapshots whose capturedAt is inside [start, end] inclusive', () => {
    const svc = withCaptures();
    const out = svc.getSnapshotsInRange(T0 + 1000, T0 + 3000);
    assert.equal(out.length, 3);
    assert.equal(out[0].capturedAt, T0 + 1000);
    assert.equal(out[2].capturedAt, T0 + 3000);
  });

  it('is inclusive on the start boundary', () => {
    const svc = withCaptures();
    const out = svc.getSnapshotsInRange(T0, T0);
    assert.equal(out.length, 1);
    assert.equal(out[0].capturedAt, T0);
  });

  it('is inclusive on the end boundary', () => {
    const svc = withCaptures();
    const out = svc.getSnapshotsInRange(T0 + 4000, T0 + 4000);
    assert.equal(out.length, 1);
    assert.equal(out[0].capturedAt, T0 + 4000);
  });

  it('returns an empty array when no snapshot falls inside the window', () => {
    const svc = withCaptures();
    const out = svc.getSnapshotsInRange(T0 + 10_000, T0 + 20_000);
    assert.deepEqual(out, []);
  });

  it('returns an empty array when end < start', () => {
    const svc = withCaptures();
    assert.deepEqual(svc.getSnapshotsInRange(T0 + 3000, T0 + 1000), []);
  });

  it('returns ascending by capturedAt', () => {
    const svc = withCaptures();
    const out = svc.getSnapshotsInRange(T0, T0 + 5000);
    for (let i = 1; i < out.length; i += 1) {
      assert.ok(out[i].capturedAt >= out[i - 1].capturedAt);
    }
  });
});

// ── getNearest (binary search) ────────────────────────────────────────────

describe('getNearest', () => {
  function withCaptures(stamps: number[]): HistoricalPlaybackService {
    let t = T0;
    const svc = makeService(null, () => t);
    for (const offset of stamps) {
      t = T0 + offset;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    return svc;
  }

  it('returns undefined when the timeline is empty', () => {
    const svc = makeService();
    assert.equal(svc.getNearest(T0), undefined);
  });

  it('returns the first snapshot when target is before all', () => {
    const svc = withCaptures([0, 1000, 2000]);
    const got = svc.getNearest(T0 - 50_000);
    assert.equal(got?.capturedAt, T0);
  });

  it('returns the last snapshot when target is after all', () => {
    const svc = withCaptures([0, 1000, 2000]);
    const got = svc.getNearest(T0 + 1_000_000);
    assert.equal(got?.capturedAt, T0 + 2000);
  });

  it('returns the exact match when one exists', () => {
    const svc = withCaptures([0, 1000, 2000, 3000]);
    const got = svc.getNearest(T0 + 2000);
    assert.equal(got?.capturedAt, T0 + 2000);
  });

  it('picks the closer of two surrounding snapshots', () => {
    const svc = withCaptures([0, 1000, 2000]);
    // T0 + 1200 is 200 from 1000 and 800 from 2000 → expect 1000
    const got = svc.getNearest(T0 + 1200);
    assert.equal(got?.capturedAt, T0 + 1000);
  });

  it('ties resolve to the earlier snapshot for deterministic scrub', () => {
    const svc = withCaptures([0, 1000, 2000]);
    // T0 + 1500 is exactly halfway between 1000 and 2000
    const got = svc.getNearest(T0 + 1500);
    assert.equal(got?.capturedAt, T0 + 1000);
  });

  it('finds the right snapshot across a large timeline (regression for binary search)', () => {
    const stamps: number[] = [];
    for (let i = 0; i < 500; i += 1) stamps.push(i * 1000);
    const svc = withCaptures(stamps);
    const got = svc.getNearest(T0 + 234_400);
    // Closest is 234_000 (400 away) vs 235_000 (600 away)
    assert.equal(got?.capturedAt, T0 + 234_000);
  });
});

// ── getTimeline ───────────────────────────────────────────────────────────

describe('getTimeline', () => {
  it('returns one entry per snapshot with {timestamp, id, severity}', () => {
    const svc = makeService();
    const snap = svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const tl = svc.getTimeline();
    assert.equal(tl.length, 1);
    assert.deepEqual(Object.keys(tl[0]).sort(), ['id', 'severity', 'timestamp']);
    assert.equal(tl[0].id, snap.id);
    assert.equal(tl[0].timestamp, snap.capturedAt);
  });

  it('severity is the max across domainStates', () => {
    const svc = makeService();
    svc.captureSnapshot(
      [
        { domain: 'a', severity: 0.2, eventCount: 1 },
        { domain: 'b', severity: 0.9, eventCount: 1 },
        { domain: 'c', severity: 0.5, eventCount: 1 },
      ],
      0, 0,
    );
    assert.equal(svc.getTimeline()[0].severity, 0.9);
  });

  it('is ascending by timestamp', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    t = T0 + 5000; svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    t = T0 + 1000; svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    t = T0 + 3000; svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const tl = svc.getTimeline();
    assert.deepEqual(tl.map((e) => e.timestamp), [T0 + 1000, T0 + 3000, T0 + 5000]);
  });

  it('returns empty when there are no snapshots', () => {
    assert.deepEqual(makeService().getTimeline(), []);
  });

  it('handles snapshots with empty domainStates (severity = 0)', () => {
    const svc = makeService();
    svc.captureSnapshot([], 0, 0);
    assert.equal(svc.getTimeline()[0].severity, 0);
  });
});

// ── exportRange ───────────────────────────────────────────────────────────

describe('exportRange', () => {
  it('returns the same snapshots as getSnapshotsInRange', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < 5; i += 1) {
      t = T0 + i * 1000;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    const a = svc.getSnapshotsInRange(T0 + 1000, T0 + 3000);
    const b = svc.exportRange(T0 + 1000, T0 + 3000);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) {
      assert.equal(a[i].id, b[i].id);
    }
  });

  it('returned snapshots are defensive copies', () => {
    const svc = makeService();
    svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const out = svc.exportRange(T0, T0);
    out[0].domainStates[0].severity = 0;
    const fresh = svc.exportRange(T0, T0);
    assert.equal(fresh[0].domainStates[0].severity, 0.4);
  });
});

// ── Ring buffer eviction ─────────────────────────────────────────────────

describe('ring buffer', () => {
  it('caps at MAX_SNAPSHOTS, evicting the oldest first', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < MAX_SNAPSHOTS + 10; i += 1) {
      t = T0 + i;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    const tl = svc.getTimeline();
    assert.equal(tl.length, MAX_SNAPSHOTS);
    // The first 10 captures (T0..T0+9) should have been evicted.
    assert.equal(tl[0].timestamp, T0 + 10);
    assert.equal(tl[tl.length - 1].timestamp, T0 + MAX_SNAPSHOTS + 9);
  });

  it('eviction does not break getNearest', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i += 1) {
      t = T0 + i;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    // Target near the new bottom — must NOT return an evicted snapshot.
    const got = svc.getNearest(T0 + 5);
    assert.ok(got);
    assert.equal(got!.capturedAt, T0 + 5);
  });
});

// ── Storage persist + rehydrate ──────────────────────────────────────────

describe('storage', () => {
  it('persists captures to the injected store', () => {
    const storage = makeStorage();
    const svc = makeService(storage);
    svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    const raw = storage.getItem(STORAGE_KEY);
    assert.ok(raw, 'expected storage to be written');
    const parsed = JSON.parse(raw!) as WorldSnapshot[];
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].domainStates.length, 3);
  });

  it('hydrates pre-existing snapshots on construction', () => {
    const existing: WorldSnapshot[] = [{
      id: 'hps-old-1',
      capturedAt: T0 - 60_000,
      domainStates: [{ domain: 'cyber', severity: 0.5, eventCount: 1 }],
      situationCount: 1,
      activeAlerts: 2,
    }];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(existing) });
    const svc = makeService(storage);
    const tl = svc.getTimeline();
    assert.equal(tl.length, 1);
    assert.equal(tl[0].id, 'hps-old-1');
  });

  it('round-trips identical state across two instances sharing a store', () => {
    const storage = makeStorage();
    const a = makeService(storage);
    a.captureSnapshot(SAMPLE_DOMAINS, 1, 2);
    a.captureSnapshot(SAMPLE_DOMAINS, 3, 4);
    const b = makeService(storage);
    assert.equal(b.getTimeline().length, 2);
  });

  it('skips hydration when stored JSON is malformed', () => {
    const storage = makeStorage({ [STORAGE_KEY]: '{not json' });
    const svc = makeService(storage);
    assert.deepEqual(svc.getTimeline(), []);
  });

  it('skips hydration when stored JSON is not an array', () => {
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ id: 'x' }) });
    const svc = makeService(storage);
    assert.deepEqual(svc.getTimeline(), []);
  });

  it('discards stored entries that fail shape validation', () => {
    const bogus = [
      { id: 'hps-1' },                                                   // missing capturedAt
      null,
      { id: 'hps-2', capturedAt: 'not-a-number', domainStates: [] },      // wrong type
      { id: 'hps-3', capturedAt: T0, domainStates: 'not-an-array' },      // wrong type
      { id: 'hps-4', capturedAt: T0, domainStates: [] },                  // valid
    ];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(bogus) });
    const svc = makeService(storage);
    const tl = svc.getTimeline();
    assert.equal(tl.length, 1);
    assert.equal(tl[0].id, 'hps-4');
  });

  it('resetForTesting() clears state and removes the storage entry', () => {
    const storage = makeStorage();
    const svc = makeService(storage);
    svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    svc.resetForTesting();
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.deepEqual(svc.getTimeline(), []);
  });
});

// ── Integration / end-to-end ─────────────────────────────────────────────

describe('integration', () => {
  it('captures, exports a window, scrubs to nearest — full scrub workflow', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < 10; i += 1) {
      t = T0 + i * 60_000;
      svc.captureSnapshot(SAMPLE_DOMAINS, i, i * 2, `tick ${i}`);
    }
    const window = svc.exportRange(T0 + 2 * 60_000, T0 + 5 * 60_000);
    assert.equal(window.length, 4);
    assert.equal(window[0].notes, 'tick 2');

    const scrubTo = T0 + 3 * 60_000 + 5_000;
    const nearest = svc.getNearest(scrubTo);
    assert.equal(nearest?.capturedAt, T0 + 3 * 60_000);
  });

  it('timeline + snapshot lookup agree on ids', () => {
    let t = T0;
    const svc = makeService(null, () => t);
    for (let i = 0; i < 3; i += 1) {
      t = T0 + i * 1000;
      svc.captureSnapshot(SAMPLE_DOMAINS, 0, 0);
    }
    for (const entry of svc.getTimeline()) {
      const snap = svc.getSnapshot(entry.id);
      assert.ok(snap, `expected snapshot for ${entry.id}`);
      assert.equal(snap!.capturedAt, entry.timestamp);
    }
  });
});
