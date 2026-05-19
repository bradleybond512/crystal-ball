import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CivilizationPhysicsEngine,
  STORAGE_KEY,
  MAX_EVENTS,
  HOUR_MS,
  type PressureSystem,
  type PressureEvent,
  type StorageLike,
} from '../../src/services/intelligence/civilization-physics-engine.ts';

// ── Test helpers ─────────────────────────────────────────────────────────

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

const BASE_NOW = new Date('2026-05-19T12:00:00Z').getTime();

function makeEngine(nowMs = BASE_NOW, storage?: StorageLike) {
  CivilizationPhysicsEngine._resetSingletonForTests();
  return new CivilizationPhysicsEngine({
    storage: storage ?? createMemoryStorage(),
    now: () => nowMs,
  });
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-civilization-physics"', () => {
  assert.equal(STORAGE_KEY, 'wm-civilization-physics');
});

test('MAX_EVENTS is 500', () => {
  assert.equal(MAX_EVENTS, 500);
});

test('HOUR_MS is 3600000', () => {
  assert.equal(HOUR_MS, 60 * 60 * 1000);
});

// ── Singleton ─────────────────────────────────────────────────────────────

test('getInstance returns the same instance on repeated calls', () => {
  CivilizationPhysicsEngine._resetSingletonForTests();
  const a = CivilizationPhysicsEngine.getInstance();
  const b = CivilizationPhysicsEngine.getInstance();
  assert.strictEqual(a, b);
  CivilizationPhysicsEngine._resetSingletonForTests();
});

// ── Seeded systems ────────────────────────────────────────────────────────

test('getSystems: returns exactly 8 seeded systems', () => {
  const eng = makeEngine();
  assert.equal(eng.getSystems().length, 8);
});

test('getSystems: all systems have pressure in 0–100 range', () => {
  const eng = makeEngine();
  for (const sys of eng.getSystems()) {
    assert.ok(sys.pressure >= 0 && sys.pressure <= 100, `${sys.id} pressure out of range: ${sys.pressure}`);
  }
});

test('getSystems: all systems have valid status', () => {
  const eng = makeEngine();
  const valid = new Set(['stable', 'building', 'critical', 'releasing']);
  for (const sys of eng.getSystems()) {
    assert.ok(valid.has(sys.status), `${sys.id} invalid status: ${sys.status}`);
  }
});

test('getSystems: sorted by pressure descending', () => {
  const eng = makeEngine();
  const systems = eng.getSystems();
  for (let i = 1; i < systems.length; i++) {
    assert.ok(
      systems[i]!.pressure <= systems[i - 1]!.pressure,
      `not sorted: [${i - 1}]=${systems[i - 1]!.pressure} < [${i}]=${systems[i]!.pressure}`,
    );
  }
});

test('getSystems: includes US-China trade tension system', () => {
  const eng = makeEngine();
  const found = eng.getSystems().some(s => s.id.includes('us-china') || s.domain.toLowerCase().includes('trade'));
  assert.ok(found, 'expected a US-China trade tension system');
});

test('getSystems: includes nuclear proliferation system', () => {
  const eng = makeEngine();
  const found = eng.getSystems().some(s => s.id.includes('nuclear') || s.domain.toLowerCase().includes('nuclear'));
  assert.ok(found, 'expected a nuclear proliferation system');
});

test('getSystems: all systems have required fields', () => {
  const eng = makeEngine();
  for (const sys of eng.getSystems()) {
    assert.equal(typeof sys.id, 'string');
    assert.equal(typeof sys.domain, 'string');
    assert.equal(typeof sys.region, 'string');
    assert.equal(typeof sys.pressure, 'number');
    assert.equal(typeof sys.releaseThreshold, 'number');
    assert.equal(typeof sys.accumulationRate, 'number');
    assert.equal(typeof sys.status, 'string');
  }
});

test('getSystems: returns copies — mutations do not affect internal state', () => {
  const eng = makeEngine();
  const [first] = eng.getSystems();
  const originalPressure = first!.pressure;
  first!.pressure = 999;
  assert.equal(eng.getSystems()[0]!.pressure, originalPressure);
});

// ── accumulatePressure ────────────────────────────────────────────────────

test('accumulatePressure: increases pressure by delta', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  const before = sys.pressure;
  eng.accumulatePressure(sys.id, 10, 'test-trigger');
  const after = eng.getSystems().find(s => s.id === sys.id)!.pressure;
  assert.equal(after, Math.min(100, before + 10));
});

test('accumulatePressure: caps pressure at 100', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 200, 'overflow-test');
  const updated = eng.getSystems().find(s => s.id === sys.id)!;
  assert.ok(updated.pressure <= 100, `pressure ${updated.pressure} exceeded 100`);
});

test('accumulatePressure: status is "stable" when pressure < 30', () => {
  const eng = makeEngine();
  const sys = eng.getSystems().find(s => s.pressure < 20)!;
  if (!sys) return; // skip if all systems start >= 20
  const delta = 5;
  eng.accumulatePressure(sys.id, delta, 'low-add');
  const updated = eng.getSystems().find(s => s.id === sys.id)!;
  if (updated.pressure < 30) {
    assert.equal(updated.status, 'stable');
  }
});

test('accumulatePressure: status is "building" when 30 <= pressure < 60', () => {
  const eng = makeEngine();
  // Force a known system to a controlled pressure by using a fresh engine
  // with a low-pressure system — we drive it to [30, 60)
  const eng2 = makeEngine();
  const sys = eng2.getSystems().find(s => s.pressure < 30)
    ?? eng2.getSystems()[eng2.getSystems().length - 1]!;
  // Reset via large negatives is not supported; instead find a system with
  // initial pressure that we can push into [30, 60) with one accumulation.
  const target = 40;
  const needed = target - sys.pressure;
  if (needed > 0 && needed < 70) {
    eng2.accumulatePressure(sys.id, needed, 'building-test');
    const updated = eng2.getSystems().find(s => s.id === sys.id)!;
    if (updated.pressure >= 30 && updated.pressure < 60) {
      assert.equal(updated.status, 'building');
    }
  }
});

test('accumulatePressure: status is "critical" when 60 <= pressure < releaseThreshold', () => {
  const eng = makeEngine();
  // Find a system with releaseThreshold > 60 so we can push it into critical range
  const sys = eng.getSystems().find(s => s.releaseThreshold > 65 && s.pressure < 60);
  if (!sys) return;
  const needed = 65 - sys.pressure;
  if (needed > 0) {
    eng.accumulatePressure(sys.id, needed, 'critical-test');
    const updated = eng.getSystems().find(s => s.id === sys.id)!;
    if (updated.pressure >= 60 && updated.pressure < updated.releaseThreshold) {
      assert.equal(updated.status, 'critical');
    }
  }
});

test('accumulatePressure: auto-triggers release when pressure reaches releaseThreshold', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  const overshoot = sys.releaseThreshold - sys.pressure + 5;
  const before = sys.pressure;
  eng.accumulatePressure(sys.id, overshoot, 'threshold-breach');
  const updated = eng.getSystems().find(s => s.id === sys.id)!;
  // After auto-release, pressure should be lower than the threshold
  assert.ok(
    updated.pressure < sys.releaseThreshold,
    `pressure ${updated.pressure} should be < threshold ${sys.releaseThreshold} after release`,
  );
  // And lower than before + overshoot (net reduction from release)
  assert.ok(
    updated.pressure < before + overshoot,
    'release should have reduced pressure below raw accumulation total',
  );
});

test('accumulatePressure: records an accumulation PressureEvent', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 5, 'event-test');
  const events = eng.getEvents();
  const found = events.find(e => e.systemId === sys.id && e.eventType === 'accumulation');
  assert.ok(found, 'expected an accumulation event');
  assert.equal(found.trigger, 'event-test');
  assert.equal(found.deltaPressure, 5);
});

test('accumulatePressure: no-op for unknown systemId', () => {
  const eng = makeEngine();
  const before = eng.getSystems().map(s => s.pressure);
  assert.doesNotThrow(() => eng.accumulatePressure('nonexistent-id', 10, 'x'));
  const after = eng.getSystems().map(s => s.pressure);
  assert.deepEqual(before, after);
});

// ── triggerRelease ────────────────────────────────────────────────────────

test('triggerRelease: reduces pressure by releaseThreshold * 0.8', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  // Push pressure up enough that it won't auto-release during accumulatePressure
  // but is high enough to see a meaningful release
  eng.accumulatePressure(sys.id, 30, 'pre-release');
  const before = eng.getSystems().find(s => s.id === sys.id)!.pressure;
  eng.triggerRelease(sys.id);
  const after = eng.getSystems().find(s => s.id === sys.id)!.pressure;
  const expectedRelease = sys.releaseThreshold * 0.8;
  assert.equal(after, Math.max(0, before - expectedRelease));
});

test('triggerRelease: pressure never drops below 0', () => {
  const eng = makeEngine();
  // Find a system with low pressure
  const sys = eng.getSystems()[eng.getSystems().length - 1]!;
  // Force its pressure low by creating a fresh engine with controlled state
  const eng2 = makeEngine();
  const lowSys = eng2.getSystems().find(s => s.pressure < 10)
    ?? eng2.getSystems()[eng2.getSystems().length - 1]!;
  eng2.triggerRelease(lowSys.id);
  const updated = eng2.getSystems().find(s => s.id === lowSys.id)!;
  assert.ok(updated.pressure >= 0, `pressure ${updated.pressure} should not go negative`);
});

test('triggerRelease: records a release PressureEvent', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  eng.triggerRelease(sys.id);
  const events = eng.getEvents();
  const found = events.find(e => e.systemId === sys.id && e.eventType === 'release');
  assert.ok(found, 'expected a release event');
  assert.equal(found.systemId, sys.id);
});

test('triggerRelease: sets lastReleaseAt to current time', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  eng.triggerRelease(sys.id);
  const updated = eng.getSystems().find(s => s.id === sys.id)!;
  assert.equal(updated.lastReleaseAt, BASE_NOW);
});

test('triggerRelease: fires subscriber callbacks', () => {
  const eng = makeEngine();
  const events: PressureEvent[] = [];
  eng.subscribe(e => events.push(e));
  const sys = eng.getSystems()[0]!;
  eng.triggerRelease(sys.id);
  assert.ok(events.some(e => e.eventType === 'release' && e.systemId === sys.id));
});

test('triggerRelease: no-op for unknown systemId', () => {
  const eng = makeEngine();
  const before = eng.getSystems().map(s => ({ id: s.id, p: s.pressure }));
  assert.doesNotThrow(() => eng.triggerRelease('nonexistent'));
  const after = eng.getSystems().map(s => ({ id: s.id, p: s.pressure }));
  assert.deepEqual(before, after);
});

// ── subscribe ─────────────────────────────────────────────────────────────

test('subscribe: fires callback on accumulatePressure event', () => {
  const eng = makeEngine();
  const received: PressureEvent[] = [];
  eng.subscribe(e => received.push(e));
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 5, 'sub-test');
  assert.ok(received.some(e => e.eventType === 'accumulation'));
});

test('subscribe: multiple subscribers all receive the same event', () => {
  const eng = makeEngine();
  const aEvents: PressureEvent[] = [];
  const bEvents: PressureEvent[] = [];
  eng.subscribe(e => aEvents.push(e));
  eng.subscribe(e => bEvents.push(e));
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 5, 'multi-sub');
  assert.ok(aEvents.length > 0);
  assert.ok(bEvents.length > 0);
  assert.equal(aEvents[0]!.systemId, bEvents[0]!.systemId);
});

test('subscribe: callback receives correct event shape', () => {
  const eng = makeEngine();
  let received: PressureEvent | undefined;
  eng.subscribe(e => { received = e; });
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 7, 'shape-test');
  assert.ok(received);
  assert.equal(received.systemId, sys.id);
  assert.equal(typeof received.timestamp, 'number');
  assert.equal(received.deltaPressure, 7);
  assert.equal(received.trigger, 'shape-test');
  assert.ok(['accumulation', 'release', 'spike'].includes(received.eventType));
});

// ── tick ──────────────────────────────────────────────────────────────────

test('tick: accumulates each system by accumulationRate per hour', () => {
  const eng = makeEngine(BASE_NOW);
  const before = eng.getSystems().map(s => ({ id: s.id, pressure: s.pressure }));
  // Advance 1 hour
  eng.tick(BASE_NOW + HOUR_MS);
  const after = eng.getSystems();
  for (const sys of after) {
    const prev = before.find(b => b.id === sys.id)!;
    const sysDefinition = eng.getSystems().find(s => s.id === sys.id)!;
    // Some systems may have released, so only check non-released ones
    if (sys.status !== 'releasing' && prev.pressure + sysDefinition.accumulationRate <= 100) {
      assert.ok(
        sys.pressure >= prev.pressure,
        `${sys.id}: pressure should have increased after tick`,
      );
    }
  }
});

test('tick: no accumulation when elapsed time is zero', () => {
  const eng = makeEngine(BASE_NOW);
  const before = eng.getSystems().map(s => s.pressure);
  eng.tick(BASE_NOW); // same time
  const after = eng.getSystems().map(s => s.pressure);
  assert.deepEqual(before, after);
});

test('tick: accumulation is proportional to elapsed time', () => {
  const eng = makeEngine(BASE_NOW);
  const sys = eng.getSystems().find(s =>
    s.pressure + s.accumulationRate * 0.5 < s.releaseThreshold &&
    s.pressure + s.accumulationRate * 0.5 < 100,
  );
  if (!sys) return;
  const before = sys.pressure;
  eng.tick(BASE_NOW + HOUR_MS / 2); // half hour
  const after = eng.getSystems().find(s => s.id === sys.id)!.pressure;
  const expected = before + sys.accumulationRate * 0.5;
  assert.ok(
    Math.abs(after - expected) < 0.1,
    `expected ~${expected} got ${after}`,
  );
});

test('tick: fires subscriber when accumulation triggers a release', () => {
  const eng = makeEngine(BASE_NOW);
  const released: PressureEvent[] = [];
  eng.subscribe(e => { if (e.eventType === 'release') released.push(e); });
  // Find a system close to its threshold and advance time enough to cross it
  const systems = eng.getSystems();
  const critical = systems.find(s => {
    const hoursToThreshold = (s.releaseThreshold - s.pressure) / s.accumulationRate;
    return hoursToThreshold > 0 && hoursToThreshold < 100;
  });
  if (!critical) return;
  const hoursNeeded = (critical.releaseThreshold - critical.pressure) / critical.accumulationRate + 0.1;
  eng.tick(BASE_NOW + hoursNeeded * HOUR_MS);
  assert.ok(released.length > 0, 'expected at least one release during tick');
});

// ── getEvents ─────────────────────────────────────────────────────────────

test('getEvents: returns all recorded events', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 3, 'ev1');
  eng.accumulatePressure(sys.id, 2, 'ev2');
  const events = eng.getEvents();
  assert.ok(events.length >= 2);
});

test('getEvents: events have correct timestamp', () => {
  const eng = makeEngine(BASE_NOW);
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 3, 'ts-test');
  const ev = eng.getEvents().find(e => e.trigger === 'ts-test')!;
  assert.equal(ev.timestamp, BASE_NOW);
});

// ── Persistence ───────────────────────────────────────────────────────────

test('persistence: events are written to storage', () => {
  const storage = createMemoryStorage();
  const eng = makeEngine(BASE_NOW, storage);
  const sys = eng.getSystems()[0]!;
  eng.accumulatePressure(sys.id, 5, 'persist-test');
  assert.ok(storage.getItem(STORAGE_KEY) !== null);
});

test('persistence: events rehydrated from storage on construction', () => {
  const storage = createMemoryStorage();
  const eng1 = makeEngine(BASE_NOW, storage);
  const sys = eng1.getSystems()[0]!;
  eng1.accumulatePressure(sys.id, 5, 'round-trip');

  CivilizationPhysicsEngine._resetSingletonForTests();
  const eng2 = new CivilizationPhysicsEngine({ storage, now: () => BASE_NOW });
  const found = eng2.getEvents().find(e => e.trigger === 'round-trip');
  assert.ok(found, 'event should survive storage round-trip');
});

test('persistence: corrupted storage yields empty event log (systems still seeded)', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-json{{{{');
  CivilizationPhysicsEngine._resetSingletonForTests();
  const eng = new CivilizationPhysicsEngine({ storage, now: () => BASE_NOW });
  assert.equal(eng.getEvents().length, 0);
  assert.equal(eng.getSystems().length, 8);
});

// ── Ring buffer ───────────────────────────────────────────────────────────

test('ring buffer: event log capped at MAX_EVENTS=500', () => {
  const eng = makeEngine();
  const sys = eng.getSystems()[0]!;
  for (let i = 0; i < 520; i++) {
    eng.accumulatePressure(sys.id, 0.01, `bulk-${i}`);
  }
  assert.ok(eng.getEvents().length <= MAX_EVENTS, `events ${eng.getEvents().length} exceeded ${MAX_EVENTS}`);
});
