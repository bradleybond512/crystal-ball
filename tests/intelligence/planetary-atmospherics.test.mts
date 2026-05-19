import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlanetaryAtmosphericsService,
  STORAGE_KEY,
  MAX_EVENTS,
  REGIONAL_STRESS_CAP,
  EVENT_TYPES,
  type AtmosphericEvent,
  type AtmosphericEventType,
  type StorageLike,
} from '../../src/services/intelligence/planetary-atmospherics.js';

// ── Storage stub ─────────────────────────────────────────────────────────

class MemStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

let idSeq = 0;
function makeEvent(overrides: Partial<AtmosphericEvent> = {}): AtmosphericEvent {
  idSeq += 1;
  return {
    id: `evt-${idSeq}`,
    type: 'heat-dome',
    region: 'Test Region',
    severity: 2,
    startedAt: 1_000_000,
    correlatedDomains: ['health'],
    ...overrides,
  };
}

function make(storage?: StorageLike | null, now?: () => number): PlanetaryAtmosphericsService {
  return new PlanetaryAtmosphericsService({ storage: storage ?? null, now });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STORAGE_KEY is correct', () => assert.equal(STORAGE_KEY, 'wm-planetary-atmospherics'));
  it('MAX_EVENTS is 500', () => assert.equal(MAX_EVENTS, 500));
  it('REGIONAL_STRESS_CAP is 10', () => assert.equal(REGIONAL_STRESS_CAP, 10));
  it('EVENT_TYPES has 6 entries', () => assert.equal(EVENT_TYPES.length, 6));
  it('EVENT_TYPES contains all 6 types', () => {
    const expected: AtmosphericEventType[] = [
      'heat-dome', 'polar-vortex', 'atmospheric-river',
      'drought', 'flood-pattern', 'hurricane-cluster',
    ];
    assert.deepEqual(EVENT_TYPES, expected);
  });
});

describe('singleton', () => {
  beforeEach(() => { PlanetaryAtmosphericsService._resetSingletonForTests(); });

  it('getInstance returns same instance', () => {
    const a = PlanetaryAtmosphericsService.getInstance();
    const b = PlanetaryAtmosphericsService.getInstance();
    assert.equal(a, b);
  });

  it('_resetSingletonForTests produces a fresh instance', () => {
    const a = PlanetaryAtmosphericsService.getInstance();
    PlanetaryAtmosphericsService._resetSingletonForTests();
    const b = PlanetaryAtmosphericsService.getInstance();
    assert.notEqual(a, b);
  });
});

describe('seed archetypes', () => {
  let svc: PlanetaryAtmosphericsService;
  before(() => {
    // Use a clock before all seed projectedEndAt values so every seeded event
    // is still "active" regardless of its individual time window.
    svc = make(null, () => new Date('2020-01-01T00:00:00Z').getTime());
  });

  it('seeds 4 built-in archetypes (all active at a pre-seed clock)', () => {
    const all = svc.getActive();
    assert.ok(all.length >= 4, `expected >= 4 active, got ${all.length}`);
  });

  it('heat-dome seed is present', () => {
    const active = svc.getActive();
    assert.ok(active.some((e) => e.type === 'heat-dome'));
  });

  it('drought seed is present (no projectedEndAt → always active)', () => {
    const active = svc.getActive();
    assert.ok(active.some((e) => e.type === 'drought'));
  });

  it('seed events have correlatedDomains', () => {
    const active = svc.getActive();
    for (const e of active) {
      assert.ok(e.correlatedDomains.length > 0, `${e.type} should have correlatedDomains`);
    }
  });

  it('seed event ids start with "seed:"', () => {
    const active = svc.getActive();
    for (const e of active) {
      assert.ok(e.id.startsWith('seed:'), `expected seed: prefix, got ${e.id}`);
    }
  });
});

describe('recordEvent', () => {
  it('adds a new event', () => {
    const svc = make();
    const evt = makeEvent({ region: 'Arctic' });
    const before = svc.getActive().length;
    svc.recordEvent(evt);
    assert.equal(svc.getActive().length, before + 1);
  });

  it('replaces an existing event with same id', () => {
    const svc = make();
    const id = 'test-update';
    svc.recordEvent(makeEvent({ id, severity: 1 }));
    svc.recordEvent(makeEvent({ id, severity: 3 }));
    const updated = svc.getActive().find((e) => e.id === id);
    assert.equal(updated?.severity, 3);
  });

  it('clamps severity above 4 to 4', () => {
    const svc = make();
    const evt = makeEvent({ severity: 10 });
    svc.recordEvent(evt);
    const stored = svc.getActive().find((e) => e.id === evt.id);
    assert.equal(stored?.severity, 4);
  });

  it('clamps severity below 0 to 0', () => {
    const svc = make();
    const evt = makeEvent({ severity: -2 });
    svc.recordEvent(evt);
    const stored = svc.getActive().find((e) => e.id === evt.id);
    assert.equal(stored?.severity, 0);
  });

  it('stores defensive copy of correlatedDomains', () => {
    const svc = make();
    const domains = ['health', 'energy'];
    const evt = makeEvent({ correlatedDomains: domains });
    svc.recordEvent(evt);
    domains.push('mutation');
    const stored = svc.getActive().find((e) => e.id === evt.id);
    assert.equal(stored?.correlatedDomains.length, 2);
  });
});

describe('getActive', () => {
  it('returns events without projectedEndAt', () => {
    const svc = make(null, () => 5_000_000);
    const evt = makeEvent({ projectedEndAt: undefined });
    svc.recordEvent(evt);
    assert.ok(svc.getActive().some((e) => e.id === evt.id));
  });

  it('excludes events whose projectedEndAt has passed', () => {
    let t = 2_000_000;
    const svc = make(null, () => t);
    const evt = makeEvent({ projectedEndAt: 1_500_000 });
    svc.recordEvent(evt);
    assert.ok(!svc.getActive().some((e) => e.id === evt.id));
  });

  it('includes events whose projectedEndAt is in the future', () => {
    let t = 1_000_000;
    const svc = make(null, () => t);
    const evt = makeEvent({ projectedEndAt: 2_000_000 });
    svc.recordEvent(evt);
    assert.ok(svc.getActive().some((e) => e.id === evt.id));
  });

  it('returns defensive copies — mutations do not affect stored state', () => {
    const svc = make();
    const evt = makeEvent({ severity: 2 });
    svc.recordEvent(evt);
    const active = svc.getActive();
    const found = active.find((e) => e.id === evt.id)!;
    found.severity = 99;
    const active2 = svc.getActive();
    assert.equal(active2.find((e) => e.id === evt.id)?.severity, 2);
  });
});

describe('getThreatMultipliers', () => {
  it('returns multipliers for heat-dome in the same region', () => {
    const svc = make();
    const evt = makeEvent({ type: 'heat-dome', region: 'Sahel', severity: 4 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Sahel');
    assert.ok(mults.some((m) => m.domain === 'health'));
    assert.ok(mults.some((m) => m.domain === 'energy'));
  });

  it('heat-dome health multiplier is 2.0 at severity 4', () => {
    const svc = make();
    const evt = makeEvent({ type: 'heat-dome', region: 'Sahel-Exact', severity: 4 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Sahel-Exact');
    const health = mults.find((m) => m.domain === 'health');
    assert.ok(health, 'health multiplier should exist');
    assert.equal(health.multiplier, 2.0);
  });

  it('heat-dome energy multiplier is 1.8 at severity 4', () => {
    const svc = make();
    const evt = makeEvent({ type: 'heat-dome', region: 'Desert-SW', severity: 4 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Desert-SW');
    const energy = mults.find((m) => m.domain === 'energy');
    assert.ok(energy);
    assert.equal(energy.multiplier, 1.8);
  });

  it('drought food multiplier is 2.5 at severity 4', () => {
    const svc = make();
    const evt = makeEvent({ type: 'drought', region: 'Horn of Africa', severity: 4 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Horn of Africa');
    const food = mults.find((m) => m.domain === 'food');
    assert.ok(food);
    assert.equal(food.multiplier, 2.5);
  });

  it('drought migration multiplier is 2.0 at severity 4', () => {
    const svc = make();
    const evt = makeEvent({ type: 'drought', region: 'Drought Region', severity: 4 });
    svc.recordEvent(evt);
    const food = svc.getThreatMultipliers('Drought Region').find((m) => m.domain === 'migration');
    assert.ok(food);
    assert.equal(food.multiplier, 2.0);
  });

  it('multiplier scales below 1.0 base when severity is low', () => {
    const svc = make();
    const evt = makeEvent({ type: 'heat-dome', region: 'Low-Sev', severity: 1 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Low-Sev');
    const health = mults.find((m) => m.domain === 'health');
    assert.ok(health);
    assert.ok(health.multiplier < 2.0, 'severity-1 should have lower multiplier than severity-4');
    assert.ok(health.multiplier >= 1.0, 'multiplier must be at least 1.0');
  });

  it('returns empty array for region with no active events', () => {
    const svc = make();
    const mults = svc.getThreatMultipliers('Totally Empty Region XYZ');
    // Only seed events could match — seeds use specific regions
    const nonSeed = mults.filter((m) => !m.reason.startsWith('['));
    // seed events for unknown regions should not match
    assert.ok(mults.length === 0 || mults.every((m) => m.region === 'Totally Empty Region XYZ'));
  });

  it('excludes expired events from multipliers', () => {
    let t = 3_000_000;
    const svc = make(null, () => t);
    const evt = makeEvent({ type: 'drought', region: 'Expired Zone', severity: 4, projectedEndAt: 2_000_000 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Expired Zone');
    assert.ok(!mults.some((m) => m.domain === 'food'));
  });

  it('region match is case-insensitive substring', () => {
    const svc = make();
    const evt = makeEvent({ type: 'flood-pattern', region: 'Southeast Asia', severity: 3 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('southeast asia');
    assert.ok(mults.some((m) => m.domain === 'infrastructure'));
  });

  it('reason string includes event type', () => {
    const svc = make();
    const evt = makeEvent({ type: 'hurricane-cluster', region: 'Caribbean', severity: 3 });
    svc.recordEvent(evt);
    const mults = svc.getThreatMultipliers('Caribbean');
    assert.ok(mults.every((m) => m.reason.includes('hurricane-cluster')));
  });

  it('hurricane-cluster infrastructure multiplier is 2.8 at severity 4', () => {
    const svc = make();
    const evt = makeEvent({ type: 'hurricane-cluster', region: 'Gulf Coast', severity: 4 });
    svc.recordEvent(evt);
    const infra = svc.getThreatMultipliers('Gulf Coast').find((m) => m.domain === 'infrastructure');
    assert.ok(infra);
    assert.equal(infra.multiplier, 2.8);
  });
});

describe('getRegionalStress', () => {
  it('returns sum of active event severities', () => {
    const svc = make();
    const region = 'Stress Test Zone';
    svc.recordEvent(makeEvent({ region, severity: 2 }));
    svc.recordEvent(makeEvent({ region, severity: 3 }));
    const stress = svc.getRegionalStress(region);
    assert.equal(stress, 5);
  });

  it('caps at REGIONAL_STRESS_CAP (10)', () => {
    const svc = make();
    const region = 'Overloaded Zone';
    for (let i = 0; i < 5; i++) {
      svc.recordEvent(makeEvent({ region, severity: 4 }));
    }
    assert.equal(svc.getRegionalStress(region), REGIONAL_STRESS_CAP);
  });

  it('returns 0 for region with no active events', () => {
    const svc = make();
    assert.equal(svc.getRegionalStress('Quiet Region No Events'), 0);
  });

  it('excludes expired events from stress', () => {
    let t = 3_000_000;
    const svc = make(null, () => t);
    const region = 'Past Zone';
    svc.recordEvent(makeEvent({ region, severity: 4, projectedEndAt: 1_000_000 }));
    assert.equal(svc.getRegionalStress(region), 0);
  });

  it('includes ongoing events (no projectedEndAt) in stress', () => {
    const svc = make();
    const region = 'Ongoing Zone';
    svc.recordEvent(makeEvent({ region, severity: 3, projectedEndAt: undefined }));
    assert.equal(svc.getRegionalStress(region), 3);
  });
});

describe('persistence', () => {
  it('data persists across constructor calls with same storage', () => {
    const storage = new MemStorage();
    const svc1 = make(storage, () => 1_000_000);
    const evt = makeEvent({ region: 'Persist Zone' });
    svc1.recordEvent(evt);
    const svc2 = make(storage, () => 1_000_000);
    assert.ok(svc2.getActive().some((e) => e.id === evt.id));
  });

  it('corrupt storage falls back gracefully — seeds still loaded', () => {
    const storage = new MemStorage();
    storage.setItem(STORAGE_KEY, 'not-json');
    const svc = make(storage, () => new Date('2026-06-20T00:00:00Z').getTime());
    const active = svc.getActive();
    assert.ok(active.length >= 1);
  });

  it('null storage works — no persistence, seeds loaded', () => {
    const svc = make(null);
    assert.ok(svc.getActive().length >= 1);
  });
});

describe('ring buffer', () => {
  it('caps events at MAX_EVENTS', () => {
    const svc = make(null, () => 9_999_999_999);
    for (let i = 0; i < MAX_EVENTS + 10; i++) {
      svc.recordEvent(makeEvent({ id: `buf-${i}` }));
    }
    // Service still works; getActive should not throw
    const active = svc.getActive();
    assert.ok(active.length <= MAX_EVENTS);
  });
});
