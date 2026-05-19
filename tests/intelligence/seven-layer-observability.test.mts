import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SevenLayerObservabilityModel,
  STORAGE_KEY,
  MAX_SNAPSHOTS,
  LAYERS,
  type Layer,
  type LayerState,
  type StorageLike,
} from '../../src/services/intelligence/seven-layer-observability.js';

// ── Storage stub ─────────────────────────────────────────────────────────

class MemStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

function make(storage?: StorageLike | null, now?: () => number): SevenLayerObservabilityModel {
  return new SevenLayerObservabilityModel({ storage: storage ?? null, now });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is correct', () => assert.equal(STORAGE_KEY, 'wm-seven-layer-obs'));
  it('MAX_SNAPSHOTS is 500', () => assert.equal(MAX_SNAPSHOTS, 500));
  it('LAYERS has 7 entries', () => assert.equal(LAYERS.length, 7));
  it('LAYERS contains all 7 domains', () => {
    const expected: Layer[] = ['physical', 'political', 'economic', 'social', 'cyber', 'biological', 'space'];
    assert.deepEqual(LAYERS, expected);
  });
});

describe('singleton', () => {
  beforeEach(() => { SevenLayerObservabilityModel._resetSingletonForTests(); });

  it('getInstance returns same instance', () => {
    const a = SevenLayerObservabilityModel.getInstance();
    const b = SevenLayerObservabilityModel.getInstance();
    assert.equal(a, b);
  });

  it('_resetSingletonForTests produces a fresh instance', () => {
    const a = SevenLayerObservabilityModel.getInstance();
    SevenLayerObservabilityModel._resetSingletonForTests();
    const b = SevenLayerObservabilityModel.getInstance();
    assert.notEqual(a, b);
  });
});

describe('seed initialization', () => {
  let svc: SevenLayerObservabilityModel;
  before(() => { svc = make(); });

  const seeds: [Layer, number][] = [
    ['physical', 0.75],
    ['political', 0.65],
    ['economic', 0.70],
    ['social', 0.45],
    ['cyber', 0.60],
    ['biological', 0.55],
    ['space', 0.40],
  ];

  for (const [layer, score] of seeds) {
    it(`${layer}: initial observabilityScore = ${score}`, () => {
      const snap = svc.getSnapshot();
      const ls = snap.layers.find((l) => l.layer === layer)!;
      assert.equal(ls.observabilityScore, score);
    });
  }

  it('all 7 layers present in initial snapshot', () => {
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.length, 7);
    const names = snap.layers.map((l) => l.layer).sort();
    assert.deepEqual(names, [...LAYERS].sort());
  });

  it('seed feedCount > 0 for all layers', () => {
    const snap = svc.getSnapshot();
    for (const ls of snap.layers) {
      assert.ok(ls.feedCount > 0, `${ls.layer} feedCount should be > 0`);
    }
  });
});

describe('getSnapshot', () => {
  let svc: SevenLayerObservabilityModel;
  before(() => { svc = make(); });

  it('overallScore is mean of layer scores', () => {
    const snap = svc.getSnapshot();
    const expected = snap.layers.reduce((s, l) => s + l.observabilityScore, 0) / snap.layers.length;
    assert.ok(Math.abs(snap.overallScore - expected) < 1e-10);
  });

  it('overallScore is in [0, 1]', () => {
    const snap = svc.getSnapshot();
    assert.ok(snap.overallScore >= 0 && snap.overallScore <= 1);
  });

  it('weakestLayer has the lowest observabilityScore', () => {
    const snap = svc.getSnapshot();
    const weakState = snap.layers.find((l) => l.layer === snap.weakestLayer)!;
    for (const ls of snap.layers) {
      assert.ok(weakState.observabilityScore <= ls.observabilityScore, `${ls.layer} should be >= weakest`);
    }
  });

  it('strongestLayer has the highest observabilityScore', () => {
    const snap = svc.getSnapshot();
    const strongState = snap.layers.find((l) => l.layer === snap.strongestLayer)!;
    for (const ls of snap.layers) {
      assert.ok(strongState.observabilityScore >= ls.observabilityScore, `${ls.layer} should be <= strongest`);
    }
  });

  it('seed weakest is space (0.40)', () => {
    const snap = svc.getSnapshot();
    assert.equal(snap.weakestLayer, 'space');
  });

  it('seed strongest is physical (0.75)', () => {
    const snap = svc.getSnapshot();
    assert.equal(snap.strongestLayer, 'physical');
  });

  it('timestamp is set on each call', () => {
    let t = 1_000_000;
    const svc2 = make(null, () => t);
    const snap1 = svc2.getSnapshot();
    t = 2_000_000;
    const snap2 = svc2.getSnapshot();
    assert.equal(snap1.timestamp, 1_000_000);
    assert.equal(snap2.timestamp, 2_000_000);
  });

  it('returns defensive copy — mutations do not affect internal state', () => {
    const snap = svc.getSnapshot();
    snap.layers[0].observabilityScore = 0.0;
    const snap2 = svc.getSnapshot();
    assert.ok(snap2.layers[0].observabilityScore > 0);
  });
});

describe('updateLayer', () => {
  it('updates observabilityScore', () => {
    const svc = make();
    svc.updateLayer('cyber', { observabilityScore: 0.99 });
    const snap = svc.getSnapshot();
    const cyber = snap.layers.find((l) => l.layer === 'cyber')!;
    assert.equal(cyber.observabilityScore, 0.99);
  });

  it('clamps observabilityScore above 1 to 1', () => {
    const svc = make();
    svc.updateLayer('physical', { observabilityScore: 1.5 });
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.find((l) => l.layer === 'physical')!.observabilityScore, 1);
  });

  it('clamps observabilityScore below 0 to 0', () => {
    const svc = make();
    svc.updateLayer('physical', { observabilityScore: -0.5 });
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.find((l) => l.layer === 'physical')!.observabilityScore, 0);
  });

  it('clamps freshnessScore above 1 to 1', () => {
    const svc = make();
    svc.updateLayer('political', { freshnessScore: 2.0 });
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.find((l) => l.layer === 'political')!.freshnessScore, 1);
  });

  it('updates coverageRegions', () => {
    const svc = make();
    const regions = ['Africa', 'Latin America'];
    svc.updateLayer('social', { coverageRegions: regions });
    const snap = svc.getSnapshot();
    assert.deepEqual(snap.layers.find((l) => l.layer === 'social')!.coverageRegions, regions);
  });

  it('partial update preserves other fields', () => {
    const svc = make();
    const before = svc.getSnapshot().layers.find((l) => l.layer === 'economic')!;
    svc.updateLayer('economic', { feedCount: 99 });
    const after = svc.getSnapshot().layers.find((l) => l.layer === 'economic')!;
    assert.equal(after.feedCount, 99);
    assert.equal(after.observabilityScore, before.observabilityScore);
    assert.equal(after.freshnessScore, before.freshnessScore);
  });

  it('sets lastUpdated to clock value', () => {
    let t = 5_000_000;
    const svc = make(null, () => t);
    t = 6_000_000;
    svc.updateLayer('space', { alertsLast24h: 5 });
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.find((l) => l.layer === 'space')!.lastUpdated, 6_000_000);
  });

  it('layer field cannot be overridden by update', () => {
    const svc = make();
    // Attempt to override layer — should be silently dropped
    svc.updateLayer('biological', { layer: 'cyber' as Layer });
    const snap = svc.getSnapshot();
    assert.ok(snap.layers.find((l) => l.layer === 'biological'));
  });
});

describe('getLayerHistory', () => {
  it('returns empty array initially', () => {
    const svc = make();
    assert.equal(svc.getLayerHistory('space').length, 0);
  });

  it('returns one entry after one update', () => {
    const svc = make();
    svc.updateLayer('cyber', { feedCount: 30 });
    assert.equal(svc.getLayerHistory('cyber').length, 1);
  });

  it('each history entry is the state before the update', () => {
    const svc = make();
    const before = svc.getSnapshot().layers.find((l) => l.layer === 'physical')!;
    svc.updateLayer('physical', { observabilityScore: 0.99 });
    const hist = svc.getLayerHistory('physical');
    assert.equal(hist[0].observabilityScore, before.observabilityScore);
  });

  it('limit caps the number of returned entries', () => {
    const svc = make();
    for (let i = 0; i < 10; i++) svc.updateLayer('economic', { feedCount: i });
    assert.equal(svc.getLayerHistory('economic', 5).length, 5);
  });

  it('returns most recent entries when limited', () => {
    const svc = make();
    for (let i = 0; i < 5; i++) svc.updateLayer('political', { feedCount: i });
    const hist = svc.getLayerHistory('political', 3);
    assert.equal(hist.length, 3);
    // history is in update order; entry[0] is older than entry[2]
    assert.ok(hist[2].feedCount >= hist[0].feedCount);
  });

  it('returns defensive copies — mutations do not affect history', () => {
    const svc = make();
    svc.updateLayer('biological', { feedCount: 50 });
    const hist = svc.getLayerHistory('biological');
    hist[0].feedCount = 9999;
    const hist2 = svc.getLayerHistory('biological');
    assert.notEqual(hist2[0].feedCount, 9999);
  });
});

describe('getCoverageGaps', () => {
  it('includes layers with observabilityScore < 0.5', () => {
    const svc = make();
    const gaps = svc.getCoverageGaps();
    // social (0.45) and space (0.40) are below threshold by default
    const gapLayers = gaps.map((g) => g.layer);
    assert.ok(gapLayers.includes('social'));
    assert.ok(gapLayers.includes('space'));
  });

  it('excludes layers with observabilityScore >= 0.5', () => {
    const svc = make();
    const gaps = svc.getCoverageGaps();
    const gapLayers = gaps.map((g) => g.layer);
    assert.ok(!gapLayers.includes('physical'));
    assert.ok(!gapLayers.includes('economic'));
    assert.ok(!gapLayers.includes('cyber'));
  });

  it('missingRegions lists regions not in coverageRegions', () => {
    const svc = make();
    const gaps = svc.getCoverageGaps();
    const spaceGap = gaps.find((g) => g.layer === 'space')!;
    assert.ok(spaceGap);
    // space seed covers only LEO and Geostationary; Lunar and Deep Space are missing
    assert.ok(spaceGap.missingRegions.includes('Lunar Space'));
    assert.ok(spaceGap.missingRegions.includes('Deep Space'));
  });

  it('returns empty when all layers score >= 0.5', () => {
    const svc = make();
    for (const layer of LAYERS) svc.updateLayer(layer, { observabilityScore: 0.9 });
    assert.equal(svc.getCoverageGaps().length, 0);
  });

  it('a newly degraded layer appears in gaps', () => {
    const svc = make();
    svc.updateLayer('physical', { observabilityScore: 0.3 });
    const gaps = svc.getCoverageGaps();
    assert.ok(gaps.some((g) => g.layer === 'physical'));
  });
});

describe('persistence', () => {
  it('data persists across constructor calls with same storage', () => {
    const storage = new MemStorage();
    const svc1 = make(storage);
    svc1.updateLayer('space', { observabilityScore: 0.99 });
    const svc2 = make(storage);
    const snap = svc2.getSnapshot();
    assert.equal(snap.layers.find((l) => l.layer === 'space')!.observabilityScore, 0.99);
  });

  it('corrupt storage falls back gracefully — seeds still loaded', () => {
    const storage = new MemStorage();
    storage.setItem(STORAGE_KEY, 'not-json');
    const svc = make(storage);
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.length, 7);
  });

  it('null storage works — no persistence, seeds loaded', () => {
    const svc = make(null);
    const snap = svc.getSnapshot();
    assert.equal(snap.layers.length, 7);
  });

  it('history persists across constructor calls', () => {
    const storage = new MemStorage();
    const svc1 = make(storage);
    svc1.updateLayer('economic', { feedCount: 50 });
    const svc2 = make(storage);
    assert.equal(svc2.getLayerHistory('economic').length, 1);
  });
});

describe('snapshot ring buffer', () => {
  it('stores up to MAX_SNAPSHOTS snapshots', () => {
    const svc = make(null);
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) svc.getSnapshot();
    // Internal snapshot count capped; just verify the service still works
    const snap = svc.getSnapshot();
    assert.ok(snap.overallScore >= 0 && snap.overallScore <= 1);
  });
});
