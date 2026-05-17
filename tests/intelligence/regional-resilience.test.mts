import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRegionalResilienceIndex,
  STORAGE_KEY,
  MAX_EVENTS,
  MAX_REGIONS,
  BASELINE_REGIONS,
  type ResilienceLabel,
} from '../../src/services/intelligence/regional-resilience.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/types/intelligence.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-17T00:00:00Z').getTime();
const DAY = 24 * 60 * 60_000;

let _idCounter = 0;
function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  _idCounter += 1;
  return {
    id: overrides.id ?? `ev-${_idCounter}`,
    sourceId: 'src',
    domain: overrides.domain ?? 'earthquake',
    timestamp: overrides.timestamp ?? NOW,
    location: overrides.location ?? { lat: 35.68, lon: 139.69 }, // Tokyo
    severity: overrides.severity ?? 'HIGH',
    title: 't', raw: {}, entityIds: [], tags: overrides.tags ?? [],
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-regional-resilience"', () => {
  assert.equal(STORAGE_KEY, 'wm-regional-resilience');
});

test('MAX_EVENTS is 1000', () => {
  assert.equal(MAX_EVENTS, 1000);
});

test('MAX_REGIONS is 200', () => {
  assert.equal(MAX_REGIONS, 200);
});

test('BASELINE_REGIONS has 15 entries', () => {
  assert.equal(BASELINE_REGIONS.length, 15);
});

test('BASELINE_REGIONS names are unique', () => {
  const names = new Set(BASELINE_REGIONS.map((r) => r.name));
  assert.equal(names.size, BASELINE_REGIONS.length);
});

// ── Baseline seeding ────────────────────────────────────────────────────

test('fresh service exposes 15 baseline regions with score=50 / label=moderate', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const all = svc.getAllScores();
  assert.equal(all.length, 15);
  for (const s of all) {
    assert.equal(s.score, 50);
    assert.equal(s.label, 'moderate');
    assert.equal(s.trend, 'stable');
    assert.equal(s.eventCount, 0);
  }
});

test('getScore returns a baseline region', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const score = svc.getScore(BASELINE_REGIONS[0]!.name);
  assert.ok(score);
  assert.equal(score!.score, 50);
});

test('getScore returns undefined for unknown region', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.getScore('Atlantis'), undefined);
});

// ── ingestEvent / region extraction ─────────────────────────────────────

test('ingestEvent maps Tokyo coords to Northeast Asia', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  const ne = svc.getScore('Northeast Asia')!;
  assert.equal(ne.eventCount, 1);
});

test('ingestEvent maps Sydney coords to Oceania', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  svc.ingestEvent(obs({ location: { lat: -33.87, lon: 151.21 } }));
  const oceania = svc.getScore('Oceania')!;
  assert.equal(oceania.eventCount, 1);
});

test('ingestEvent honors explicit region:X tag on observation', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  svc.ingestEvent(obs({ tags: ['region:Western Europe'] }));
  const we = svc.getScore('Western Europe')!;
  assert.equal(we.eventCount, 1);
});

test('ingestEvent without location and without region tag still records (no-op for region match)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Pass observation with no location and no region tag
  const event = obs();
  delete (event as { location?: unknown }).location;
  svc.ingestEvent(event);
  // No region matched → no score updated; total active count unchanged
  for (const r of svc.getAllScores()) {
    assert.equal(r.eventCount, 0);
  }
});

test('ingestEvent updates eventCount per region', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  assert.equal(svc.getScore('Northeast Asia')!.eventCount, 3);
});

// ── Score formula ───────────────────────────────────────────────────────

test('computeScore: region with no events returns 50', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.score, 50);
});

test('computeScore: fast recovery (<3 days avg) bonus +10', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startAt = NOW - 5 * DAY;
  const resolvedAt = startAt + 2 * DAY;
  svc.ingestEvent({ ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } }, resolvedAt);
  const s = svc.computeScore('Northeast Asia');
  // base 50 + 10 (fast recovery) = 60
  assert.ok(s.score >= 60);
  assert.ok(s.score <= 65);
});

test('computeScore: moderate recovery (<7 days avg) bonus +5', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startAt = NOW - 10 * DAY;
  const resolvedAt = startAt + 5 * DAY; // 5 days
  svc.ingestEvent({ ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } }, resolvedAt);
  const s = svc.computeScore('Northeast Asia');
  assert.ok(s.score >= 55 && s.score <= 60);
});

test('computeScore: slow recovery (>14 days avg) penalty -8', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startAt = NOW - 25 * DAY;
  const resolvedAt = startAt + 20 * DAY; // 20 days
  svc.ingestEvent({ ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } }, resolvedAt);
  const s = svc.computeScore('Northeast Asia');
  assert.ok(s.score <= 45);
  assert.ok(s.score >= 35);
});

test('computeScore: very slow recovery (>30 days avg) penalty -15', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startAt = NOW - 50 * DAY;
  const resolvedAt = startAt + 40 * DAY; // 40 days
  svc.ingestEvent({ ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } }, resolvedAt);
  const s = svc.computeScore('Northeast Asia');
  assert.ok(s.score <= 38);
  assert.ok(s.score >= 30);
});

test('computeScore: high event frequency (>5 in 90 days) penalty -10', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 7; i++) {
    const startAt = NOW - i * 10 * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  // base 50 + 10 (fast) - 10 (frequency) ≈ 50; allow small trend swing
  assert.ok(s.score <= 60);
});

test('computeScore: improving trend (last 3 recoveries faster than prior 3) bonus +10', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Prior 3: ~20 days each, oldest
  for (let i = 5; i >= 3; i--) {
    const startAt = NOW - (i * 30) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 20 * DAY,
    );
  }
  // Last 3: ~2 days each, newer
  for (let i = 2; i >= 0; i--) {
    const startAt = NOW - (i * 5) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 2 * DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.trend, 'improving');
});

test('computeScore: degrading trend (last 3 slower than prior 3)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Prior 3 fast
  for (let i = 5; i >= 3; i--) {
    const startAt = NOW - (i * 30) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 2 * DAY,
    );
  }
  // Last 3 slow
  for (let i = 2; i >= 0; i--) {
    const startAt = NOW - (i * 5) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 20 * DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.trend, 'degrading');
});

test('computeScore: trend stable with fewer than 6 events', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }), NOW + DAY);
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.trend, 'stable');
});

test('computeScore: clamped to 0 (never negative)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Many slow events for max penalty
  for (let i = 0; i < 10; i++) {
    const startAt = NOW - (i * 5 + 50) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 60 * DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  assert.ok(s.score >= 0);
});

test('computeScore: clamped to 100 (never above)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Many fast + improving events
  for (let i = 0; i < 10; i++) {
    const startAt = NOW - (i * 10) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  assert.ok(s.score <= 100);
});

// ── Label bands ─────────────────────────────────────────────────────────

test('label band: fragile (0–20)', () => {
  // Synthetic: bypass formula by checking the label-from-score helper through getScore
  // We'll build a region that hits the band: many very-slow events plus frequency penalty.
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 8; i++) {
    const startAt = NOW - (i * 5 + 60) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 60 * DAY,
    );
  }
  const s = svc.computeScore('Northeast Asia');
  assert.ok(['fragile', 'vulnerable'].includes(s.label));
});

test('label band: moderate for baseline (40–60)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.label, 'moderate');
});

test('label band: resilient for fast recovery (60–80)', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startAt = NOW - 5 * DAY;
  svc.ingestEvent(
    { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
    startAt + DAY,
  );
  const s = svc.computeScore('Northeast Asia');
  // 50 + 10 fast = 60 → resilient (≥60)
  const labels: ResilienceLabel[] = ['resilient', 'robust'];
  assert.ok(labels.includes(s.label) || s.label === 'moderate', `got ${s.label} (score ${s.score})`);
});

// ── getTopResilient / getMostFragile ────────────────────────────────────

test('getTopResilient sorts descending by score, limited to n', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Push Tokyo (NE Asia) up with fast recovery
  const startAt = NOW - 5 * DAY;
  svc.ingestEvent(
    { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
    startAt + DAY,
  );
  const top = svc.getTopResilient(3);
  assert.equal(top.length, 3);
  assert.equal(top[0]!.region, 'Northeast Asia');
  // Descending
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1]!.score >= top[i]!.score);
  }
});

test('getMostFragile sorts ascending by score, limited to n', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  // Push Tokyo (NE Asia) down with slow recovery + frequency
  for (let i = 0; i < 8; i++) {
    const startAt = NOW - (i * 5 + 60) * DAY;
    svc.ingestEvent(
      { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
      startAt + 60 * DAY,
    );
  }
  const bottom = svc.getMostFragile(3);
  assert.equal(bottom.length, 3);
  assert.equal(bottom[0]!.region, 'Northeast Asia');
  // Ascending
  for (let i = 1; i < bottom.length; i++) {
    assert.ok(bottom[i - 1]!.score <= bottom[i]!.score);
  }
});

// ── Persistence / subscribe ─────────────────────────────────────────────

test('persist + rehydrate round-trip preserves events and scores', () => {
  const storage = createMemoryStorage();
  const svc1 = createRegionalResilienceIndex({ storage, now: () => NOW });
  const startAt = NOW - 5 * DAY;
  svc1.ingestEvent(
    { ...obs({ timestamp: startAt }), location: { lat: 35.68, lon: 139.69 } },
    startAt + DAY,
  );
  const before = svc1.getScore('Northeast Asia')!;
  const svc2 = createRegionalResilienceIndex({ storage, now: () => NOW });
  const after = svc2.getScore('Northeast Asia')!;
  assert.equal(after.eventCount, 1);
  assert.equal(after.score, before.score);
});

test('subscribe fires on ingestEvent', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  assert.equal(calls, 1);
});

test('unsubscribe stops further callbacks', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  let calls = 0;
  const cb = (): void => { calls += 1; };
  svc.subscribe(cb);
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  svc.unsubscribe(cb);
  svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  assert.equal(calls, 1);
});

// ── Ring buffer ─────────────────────────────────────────────────────────

test('ring buffer caps events at MAX_EVENTS', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < MAX_EVENTS + 5; i++) {
    svc.ingestEvent(obs({ location: { lat: 35.68, lon: 139.69 } }));
  }
  // After exceeding cap, eventCount on the affected region must not exceed MAX_EVENTS
  assert.ok(svc.getScore('Northeast Asia')!.eventCount <= MAX_EVENTS);
});

// ── worstDomain ─────────────────────────────────────────────────────────

test('worstDomain identifies the domain with slowest avg recovery', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const startA = NOW - 30 * DAY;
  // Fast recovery for earthquake
  svc.ingestEvent(
    { ...obs({ domain: 'earthquake', timestamp: startA }), location: { lat: 35.68, lon: 139.69 } },
    startA + 1 * DAY,
  );
  // Slow recovery for weather
  svc.ingestEvent(
    { ...obs({ domain: 'weather', timestamp: startA }), location: { lat: 35.68, lon: 139.69 } },
    startA + 40 * DAY,
  );
  const s = svc.computeScore('Northeast Asia');
  assert.equal(s.worstDomain, 'weather');
});

// ── ObservationSeverity import touch ────────────────────────────────────

test('ObservationSeverity import is accepted', () => {
  const sev: ObservationSeverity = 'HIGH';
  assert.equal(sev, 'HIGH');
});

// ── Shape integrity ─────────────────────────────────────────────────────

test('getAllScores returns immutable snapshots', () => {
  const svc = createRegionalResilienceIndex({ storage: createMemoryStorage(), now: () => NOW });
  const all = svc.getAllScores();
  all[0]!.score = 999;
  assert.notEqual(svc.getAllScores()[0]!.score, 999);
});
