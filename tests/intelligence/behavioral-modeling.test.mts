import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BehavioralModelingService,
  MAX_OBSERVATIONS,
  STORAGE_KEY,
  STRESS_MAX,
  THRESHOLD_NUDGE,
  interpolate,
  nearestAnchor,
  nudgeDirection,
  type BehavioralArchetype,
  type StorageLike,
  type StressPoint,
} from '../../src/services/intelligence/behavioral-modeling.ts';

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

function freshService(now: number = NOW) {
  return BehavioralModelingService.createForTesting({
    storage: memoryStorage(),
    now: () => now,
  });
}

const SEED_IDS = [
  'democratic-population',
  'authoritarian-population',
  'democratic-government',
  'authoritarian-government',
  'international-institution',
  'market-actor',
] as const;

// ── Singleton + lifecycle ───────────────────────────────────────────────

describe('BehavioralModelingService — singleton', () => {
  beforeEach(() => {
    BehavioralModelingService.resetForTesting();
  });

  it('getInstance returns the same instance', () => {
    const a = BehavioralModelingService.getInstance();
    const b = BehavioralModelingService.getInstance();
    assert.equal(a, b);
  });

  it('createForTesting returns an independent instance', () => {
    const a = BehavioralModelingService.getInstance();
    const b = BehavioralModelingService.createForTesting({ storage: memoryStorage() });
    assert.notEqual(a, b);
  });

  it('resetForTesting clears the singleton', () => {
    const a = BehavioralModelingService.getInstance();
    BehavioralModelingService.resetForTesting();
    const b = BehavioralModelingService.getInstance();
    assert.notEqual(a, b);
  });
});

// ── Seed archetypes ──────────────────────────────────────────────────────

describe('BehavioralModelingService — seeding', () => {
  it('seeds exactly 6 archetypes on first run', () => {
    const svc = freshService();
    assert.equal(svc.getArchetypes().length, 6);
  });

  it('seeds the 6 canonical archetype ids', () => {
    const svc = freshService();
    const ids = new Set(svc.getArchetypes().map((a) => a.id));
    for (const id of SEED_IDS) assert.ok(ids.has(id), `missing ${id}`);
  });

  it('each seed has a name, description, curve, reactions, threshold', () => {
    const svc = freshService();
    for (const a of svc.getArchetypes()) {
      assert.ok(a.name.length > 0, `${a.id} missing name`);
      assert.ok(a.description.length > 0, `${a.id} missing description`);
      assert.ok(a.stressResponseCurve.length >= 2, `${a.id} curve too short`);
      assert.ok(a.typicalReactions.length > 0, `${a.id} no reactions`);
      assert.ok(
        a.escalationThreshold >= 0 && a.escalationThreshold <= STRESS_MAX,
        `${a.id} threshold out of range`,
      );
    }
  });

  it('every seed curve has monotonically non-decreasing intensity', () => {
    const svc = freshService();
    for (const a of svc.getArchetypes()) {
      const sorted = [...a.stressResponseCurve].sort((x, y) => x.stressLevel - y.stressLevel);
      for (let i = 1; i < sorted.length; i += 1) {
        assert.ok(
          sorted[i]!.responseIntensity >= sorted[i - 1]!.responseIntensity - 1e-9,
          `${a.id} intensity drops at index ${i}`,
        );
      }
    }
  });

  it('persists seed archetypes to storage on first run', () => {
    const storage = memoryStorage();
    BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    const raw = storage.dump();
    assert.ok(raw, 'storage should be written');
    const parsed = JSON.parse(raw!);
    assert.equal(parsed.archetypes.length, 6);
  });

  it('does not re-seed when storage already has archetypes', () => {
    const storage = memoryStorage();
    const svc1 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    svc1.recordObservedBehavior('market-actor', 4, 'collapse');
    const before = svc1.getObservations().length;
    const svc2 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    assert.equal(svc2.getObservations().length, before, 'observations should rehydrate');
  });
});

// ── Read helpers ─────────────────────────────────────────────────────────

describe('BehavioralModelingService — read', () => {
  it('getArchetypes returns a deep clone (mutation does not leak)', () => {
    const svc = freshService();
    const a = svc.getArchetypes()[0]!;
    a.escalationThreshold = -999;
    a.stressResponseCurve[0]!.responseIntensity = -999;
    const fresh = svc.getArchetypes()[0]!;
    assert.notEqual(fresh.escalationThreshold, -999);
    assert.notEqual(fresh.stressResponseCurve[0]!.responseIntensity, -999);
  });

  it('getArchetype returns undefined for unknown id', () => {
    const svc = freshService();
    assert.equal(svc.getArchetype('does-not-exist'), undefined);
  });

  it('getArchetype returns the canonical record by id', () => {
    const svc = freshService();
    const got = svc.getArchetype('democratic-population');
    assert.equal(got?.id, 'democratic-population');
  });
});

// ── predictResponse ──────────────────────────────────────────────────────

describe('BehavioralModelingService — predictResponse', () => {
  it('throws on unknown archetype', () => {
    const svc = freshService();
    assert.throws(() => svc.predictResponse('nope', 2));
  });

  it('throws on non-finite stress level', () => {
    const svc = freshService();
    assert.throws(() => svc.predictResponse('democratic-population', Number.NaN));
  });

  it('clamps stress below 0 to 0', () => {
    const svc = freshService();
    const p = svc.predictResponse('democratic-population', -1);
    assert.equal(p.stressLevel, 0);
  });

  it('clamps stress above 4 to 4', () => {
    const svc = freshService();
    const p = svc.predictResponse('democratic-population', 99);
    assert.equal(p.stressLevel, STRESS_MAX);
  });

  it('returns the anchor intensity for an on-anchor query', () => {
    const svc = freshService();
    const p = svc.predictResponse('market-actor', 4);
    const anchor = svc.getArchetype('market-actor')!
      .stressResponseCurve.find((c) => c.stressLevel === 4)!;
    assert.equal(p.responseIntensity, anchor.responseIntensity);
  });

  it('linearly interpolates intensity between two anchors', () => {
    const svc = freshService();
    const arch = svc.getArchetype('democratic-population')!;
    const a1 = arch.stressResponseCurve.find((p) => p.stressLevel === 1)!;
    const a2 = arch.stressResponseCurve.find((p) => p.stressLevel === 2)!;
    const mid = svc.predictResponse('democratic-population', 1.5);
    const expected = (a1.responseIntensity + a2.responseIntensity) / 2;
    assert.ok(
      Math.abs(mid.responseIntensity - expected) < 1e-9,
      `expected ~${expected}, got ${mid.responseIntensity}`,
    );
  });

  it('confidence is 1 when querying exactly on an anchor', () => {
    const svc = freshService();
    const p = svc.predictResponse('democratic-population', 2);
    assert.equal(p.confidence, 1);
  });

  it('confidence drops with distance from nearest anchor', () => {
    const svc = freshService();
    const onAnchor = svc.predictResponse('democratic-population', 2);
    const offAnchor = svc.predictResponse('democratic-population', 2.5);
    assert.ok(offAnchor.confidence < onAnchor.confidence);
  });

  it('confidence stays within [0, 1]', () => {
    const svc = freshService();
    for (let s = 0; s <= 4; s += 0.25) {
      const p = svc.predictResponse('democratic-population', s);
      assert.ok(p.confidence >= 0 && p.confidence <= 1, `s=${s} → ${p.confidence}`);
    }
  });

  it('predictedBehavior includes archetype name and behavior summary', () => {
    const svc = freshService();
    const p = svc.predictResponse('authoritarian-government', 3);
    assert.match(p.predictedBehavior, /Authoritarian Government/);
    assert.match(p.predictedBehavior, /intensity/);
  });

  it('defaults region to "global" and honors override', () => {
    const svc = freshService();
    assert.equal(svc.predictResponse('market-actor', 2).region, 'global');
    assert.equal(svc.predictResponse('market-actor', 2, 'EU').region, 'EU');
  });

  it('behaviorType escalates with stress for archetypes that flip', () => {
    const svc = freshService();
    const low = svc.predictResponse('authoritarian-population', 0);
    const high = svc.predictResponse('authoritarian-population', 4);
    assert.equal(low.behaviorType, 'compliance');
    assert.equal(high.behaviorType, 'collapse');
  });
});

// ── recordObservedBehavior ───────────────────────────────────────────────

describe('BehavioralModelingService — recordObservedBehavior', () => {
  it('throws on unknown archetype', () => {
    const svc = freshService();
    assert.throws(() => svc.recordObservedBehavior('nope', 2, 'compliance'));
  });

  it('throws on non-finite stress level', () => {
    const svc = freshService();
    assert.throws(() =>
      svc.recordObservedBehavior('democratic-population', Number.POSITIVE_INFINITY, 'compliance'),
    );
  });

  it('appends an observation with timestamp from the injected clock', () => {
    let t = NOW;
    const svc = BehavioralModelingService.createForTesting({
      storage: memoryStorage(),
      now: () => t,
    });
    t = NOW + 42;
    const obs = svc.recordObservedBehavior('market-actor', 2, 'adaptation');
    assert.equal(obs.observedAt, NOW + 42);
    assert.equal(svc.getObservations().length, 1);
  });

  it('observations ring-buffer caps at MAX_OBSERVATIONS', () => {
    const svc = freshService();
    for (let i = 0; i < MAX_OBSERVATIONS + 25; i += 1) {
      svc.recordObservedBehavior('market-actor', 2, 'adaptation');
    }
    assert.equal(svc.getObservations().length, MAX_OBSERVATIONS);
  });

  it('does not nudge threshold when prediction matches observation', () => {
    const svc = freshService();
    const before = svc.getArchetype('democratic-population')!.escalationThreshold;
    // At stress 1 the prediction is 'compliance' for democratic-population.
    svc.recordObservedBehavior('democratic-population', 1, 'compliance');
    const after = svc.getArchetype('democratic-population')!.escalationThreshold;
    assert.equal(before, after);
  });

  it('lowers threshold when observed is MORE intense than predicted', () => {
    const svc = freshService();
    const before = svc.getArchetype('democratic-population')!.escalationThreshold;
    // At stress 1 the prediction is 'compliance' — observe resistance instead.
    svc.recordObservedBehavior('democratic-population', 1, 'resistance');
    const after = svc.getArchetype('democratic-population')!.escalationThreshold;
    assert.ok(after < before, `expected drop, got ${before} → ${after}`);
    assert.ok(Math.abs((before - after) - THRESHOLD_NUDGE) < 1e-9);
  });

  it('raises threshold when observed is LESS intense than predicted', () => {
    const svc = freshService();
    const before = svc.getArchetype('market-actor')!.escalationThreshold;
    // At stress 4 the prediction is 'collapse' — observe compliance instead.
    svc.recordObservedBehavior('market-actor', 4, 'compliance');
    const after = svc.getArchetype('market-actor')!.escalationThreshold;
    assert.ok(after > before, `expected rise, got ${before} → ${after}`);
    assert.ok(Math.abs((after - before) - THRESHOLD_NUDGE) < 1e-9);
  });

  it('threshold stays clamped within [0, 4] after many nudges', () => {
    const svc = freshService();
    for (let i = 0; i < 200; i += 1) {
      svc.recordObservedBehavior('democratic-population', 0, 'collapse');
    }
    const t = svc.getArchetype('democratic-population')!.escalationThreshold;
    assert.ok(t >= 0 && t <= 4, `out of bounds: ${t}`);
  });

  it('persists observations across rehydration', () => {
    const storage = memoryStorage();
    const svc1 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    svc1.recordObservedBehavior('market-actor', 2.5, 'adaptation');
    const svc2 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    assert.equal(svc2.getObservations().length, 1);
    assert.equal(svc2.getObservations()[0]!.archetypeId, 'market-actor');
  });

  it('persists threshold updates across rehydration', () => {
    const storage = memoryStorage();
    const svc1 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    svc1.recordObservedBehavior('democratic-population', 1, 'resistance');
    const updated = svc1.getArchetype('democratic-population')!.escalationThreshold;
    const svc2 = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    assert.equal(svc2.getArchetype('democratic-population')!.escalationThreshold, updated);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe('interpolate — pure helper', () => {
  const curve: StressPoint[] = [
    { stressLevel: 0, responseIntensity: 0,   behaviorType: 'compliance' },
    { stressLevel: 2, responseIntensity: 0.5, behaviorType: 'adaptation' },
    { stressLevel: 4, responseIntensity: 1,   behaviorType: 'collapse' },
  ];

  it('returns the first anchor below the lowest stress level', () => {
    const r = interpolate(curve, -5);
    assert.equal(r.responseIntensity, 0);
    assert.equal(r.behaviorType, 'compliance');
  });

  it('returns the last anchor above the highest stress level', () => {
    const r = interpolate(curve, 99);
    assert.equal(r.responseIntensity, 1);
    assert.equal(r.behaviorType, 'collapse');
  });

  it('interpolates linearly between two anchors', () => {
    const r = interpolate(curve, 1);
    assert.ok(Math.abs(r.responseIntensity - 0.25) < 1e-9);
  });

  it('picks the closer anchor for behaviorType on a segment', () => {
    assert.equal(interpolate(curve, 0.5).behaviorType, 'compliance');
    assert.equal(interpolate(curve, 1.5).behaviorType, 'adaptation');
  });

  it('handles an empty curve safely', () => {
    const r = interpolate([], 2);
    assert.equal(r.responseIntensity, 0);
    assert.equal(r.behaviorType, 'compliance');
  });

  it('handles a single-point curve', () => {
    const single: StressPoint[] = [{ stressLevel: 2, responseIntensity: 0.7, behaviorType: 'adaptation' }];
    const r = interpolate(single, 3);
    assert.equal(r.responseIntensity, 0.7);
    assert.equal(r.behaviorType, 'adaptation');
  });
});

describe('nearestAnchor — pure helper', () => {
  const curve: StressPoint[] = [
    { stressLevel: 0, responseIntensity: 0,   behaviorType: 'compliance' },
    { stressLevel: 2, responseIntensity: 0.5, behaviorType: 'adaptation' },
    { stressLevel: 4, responseIntensity: 1,   behaviorType: 'collapse' },
  ];

  it('returns the closest anchor by stress distance', () => {
    assert.equal(nearestAnchor(curve, 2.4).stressLevel, 2);
    assert.equal(nearestAnchor(curve, 3.1).stressLevel, 4);
  });

  it('returns a default anchor for an empty curve', () => {
    const a = nearestAnchor([], 1);
    assert.equal(a.stressLevel, 0);
    assert.equal(a.behaviorType, 'compliance');
  });
});

describe('nudgeDirection — pure helper', () => {
  it('returns -1 when observed is more intense than predicted', () => {
    assert.equal(nudgeDirection('compliance', 'resistance'), -1);
  });

  it('returns +1 when observed is less intense than predicted', () => {
    assert.equal(nudgeDirection('collapse', 'compliance'), 1);
  });

  it('returns 0 when observed matches predicted', () => {
    assert.equal(nudgeDirection('adaptation', 'adaptation'), 0);
  });
});

// ── Storage robustness ──────────────────────────────────────────────────

describe('BehavioralModelingService — storage robustness', () => {
  it('survives a corrupt persisted payload', () => {
    const storage: StorageLike = {
      getItem: () => '{not-json',
      setItem: () => {},
    };
    const svc = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    assert.equal(svc.getArchetypes().length, 6);
  });

  it('ignores setItem errors from a throwing storage', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
    };
    assert.doesNotThrow(() => {
      const svc = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
      svc.recordObservedBehavior('market-actor', 2, 'adaptation');
    });
  });

  it('rehydrates only valid archetypes and observations', () => {
    const garbage = JSON.stringify({
      archetypes: [
        { id: 'good', name: 'Good', description: 'd',
          stressResponseCurve: [], typicalReactions: [], escalationThreshold: 1 },
        { id: 42 }, // not a valid archetype
      ],
      observations: [
        { archetypeId: 'good', region: 'r', stressLevel: 1,
          actualBehaviorType: 'compliance', observedAt: NOW },
        { nope: true },
      ],
    });
    const storage: StorageLike = {
      getItem: (k) => k === STORAGE_KEY ? garbage : null,
      setItem: () => {},
    };
    const svc = BehavioralModelingService.createForTesting({ storage, now: () => NOW });
    // 1 hydrated + 6 not re-seeded because archetypes was non-empty: only 'good' survives.
    const ids = svc.getArchetypes().map((a: BehavioralArchetype) => a.id);
    assert.ok(ids.includes('good'));
    assert.equal(svc.getObservations().length, 1);
  });
});
