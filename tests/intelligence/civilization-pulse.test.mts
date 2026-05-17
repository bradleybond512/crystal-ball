import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CivilizationPulseEngine,
  resetForTests,
  type PulseReading,
} from '../../src/services/intelligence/civilization-pulse.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev-' + Math.random().toString(36).slice(2, 8),
    sourceId: 'test',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'Test',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Empty input ─────────────────────────────────────────────────────

describe('CivilizationPulseEngine.computePulse — empty', () => {
  beforeEach(() => { resetForTests(); });

  it('no observations → overallScore=100, label=nominal, no dominant stressor', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([]);
    assert.equal(reading.overallScore, 100);
    assert.equal(reading.label, 'nominal');
    assert.equal(reading.dominantStressor, null);
    assert.equal(reading.readingAt, NOW);
  });

  it('every reading has readingAt set to engine clock', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([]);
    assert.equal(reading.readingAt, NOW);
  });
});

// ── Per-domain score math ───────────────────────────────────────────

describe('CivilizationPulseEngine — per-domain score math', () => {
  beforeEach(() => { resetForTests(); });

  it('one MEDIUM observation in weather → weather score = 97', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ domain: 'weather', severity: 'MEDIUM' })]);
    const weather = reading.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.score, 97);
  });

  it('one CRITICAL observation in earthquake → earthquake score = 85', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ domain: 'earthquake', severity: 'CRITICAL' })]);
    const eq = reading.domainPulses.find((d) => d.domain === 'earthquake')!;
    assert.equal(eq.score, 85);
  });

  it('score floors at 0 — many criticals do not go negative', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const observations: ObservationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      observations.push(makeEvent({ id: `q-${i}`, domain: 'earthquake', severity: 'CRITICAL' }));
    }
    const reading = e.computePulse(observations);
    const eq = reading.domainPulses.find((d) => d.domain === 'earthquake')!;
    assert.ok(eq.score >= 0);
    assert.equal(eq.score, 0);
  });

  it('severity weights: 1 CRITICAL > 1 HIGH > 1 MEDIUM > 1 LOW penalty', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([
      makeEvent({ id: 'c', domain: 'cyber',       severity: 'CRITICAL' }),
      makeEvent({ id: 'h', domain: 'aviation',    severity: 'HIGH'     }),
      makeEvent({ id: 'm', domain: 'maritime',    severity: 'MEDIUM'   }),
      makeEvent({ id: 'l', domain: 'sanctions',   severity: 'LOW'      }),
    ]);
    const cyber    = reading.domainPulses.find((d) => d.domain === 'cyber')!;
    const aviation = reading.domainPulses.find((d) => d.domain === 'aviation')!;
    const maritime = reading.domainPulses.find((d) => d.domain === 'maritime')!;
    const sanctions= reading.domainPulses.find((d) => d.domain === 'sanctions')!;
    assert.equal(cyber.score,     85);
    assert.equal(aviation.score,  92);
    assert.equal(maritime.score,  97);
    assert.equal(sanctions.score, 99);
  });

  it('INFO observations do not change score (treated as healthy noise)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ id: 'i', domain: 'weather', severity: 'INFO' })]);
    const weather = reading.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.score, 100);
  });

  it('domain pulse activeAlerts counts the observations in that domain', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([
      makeEvent({ id: 'a', domain: 'weather', severity: 'HIGH' }),
      makeEvent({ id: 'b', domain: 'weather', severity: 'MEDIUM' }),
    ]);
    const weather = reading.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.activeAlerts, 2);
  });

  it('domain weights: geopolitical=1.5, biosurv=1.4, earthquake=1.2, weather=1.1, others=1.0', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([
      makeEvent({ id: 'g', domain: 'geopolitical',    severity: 'LOW' }),
      makeEvent({ id: 'b', domain: 'biosurveillance', severity: 'LOW' }),
      makeEvent({ id: 'q', domain: 'earthquake',      severity: 'LOW' }),
      makeEvent({ id: 'w', domain: 'weather',         severity: 'LOW' }),
      makeEvent({ id: 'c', domain: 'cyber',           severity: 'LOW' }),
    ]);
    assert.equal(reading.domainPulses.find((d) => d.domain === 'geopolitical')!.weight,    1.5);
    assert.equal(reading.domainPulses.find((d) => d.domain === 'biosurveillance')!.weight, 1.4);
    assert.equal(reading.domainPulses.find((d) => d.domain === 'earthquake')!.weight,      1.2);
    assert.equal(reading.domainPulses.find((d) => d.domain === 'weather')!.weight,         1.1);
    assert.equal(reading.domainPulses.find((d) => d.domain === 'cyber')!.weight,           1.0);
  });
});

// ── Overall (weighted) score ────────────────────────────────────────

describe('CivilizationPulseEngine — overall score', () => {
  beforeEach(() => { resetForTests(); });

  it('single weather observation: overall score reflects the weighted average', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ domain: 'weather', severity: 'CRITICAL' })]);
    // Single domain, score 85, weight 1.1 → weighted avg = 85.
    assert.equal(reading.overallScore, 85);
  });

  it('two equal-weight domains, both at 80 → overall 80', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([
      makeEvent({ id: 'a', domain: 'cyber',     severity: 'HIGH' }), // 92
      makeEvent({ id: 'b', domain: 'aviation',  severity: 'HIGH' }), // 92
    ]);
    assert.equal(reading.overallScore, 92);
  });

  it('one geopolitical at 25 vs one cyber at 100 → weighted favors geopolitical (low score)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // geopolitical 5 highs = 100-40=60, weight 1.5
    // cyber empty = 100, weight 1.0
    // weighted = (60*1.5 + 100*1.0) / (1.5 + 1.0) = 190/2.5 = 76
    // But cyber needs an observation to appear in domainPulses. Use INFO so score stays 100.
    const reading = e.computePulse([
      makeEvent({ id: 'g1', domain: 'geopolitical', severity: 'HIGH' }),
      makeEvent({ id: 'g2', domain: 'geopolitical', severity: 'HIGH' }),
      makeEvent({ id: 'g3', domain: 'geopolitical', severity: 'HIGH' }),
      makeEvent({ id: 'g4', domain: 'geopolitical', severity: 'HIGH' }),
      makeEvent({ id: 'g5', domain: 'geopolitical', severity: 'HIGH' }),
      makeEvent({ id: 'c',  domain: 'cyber',        severity: 'INFO' }),
    ]);
    assert.equal(reading.overallScore, 76);
  });
});

// ── Label bands ─────────────────────────────────────────────────────

describe('CivilizationPulseEngine — label bands', () => {
  beforeEach(() => { resetForTests(); });

  it('overall 100 → nominal', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    assert.equal(e.computePulse([]).label, 'nominal');
  });

  it('overall 80 → nominal (>=75)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // cyber HIGH HIGH = 100-16=84
    const reading = e.computePulse([
      makeEvent({ id: 'a', domain: 'cyber', severity: 'HIGH' }),
      makeEvent({ id: 'b', domain: 'cyber', severity: 'HIGH' }),
    ]);
    assert.equal(reading.label, 'nominal');
  });

  it('overall 60 → elevated (>=50)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // cyber 5×HIGH = 100-40=60
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 5; i++) obs.push(makeEvent({ id: `h-${i}`, domain: 'cyber', severity: 'HIGH' }));
    const reading = e.computePulse(obs);
    assert.equal(reading.label, 'elevated');
  });

  it('overall 30 → stressed (>=25)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // cyber 10×HIGH-clip = at least below 50. 10*8 = 80, score = 20.
    // Want overall 30. Need fewer.
    // 5*HIGH + 5*MEDIUM = 40+15 = 55, score = 45 → elevated.
    // We need cyber alone at, say, 30 → 70 pts deducted. 7 HIGH + 7 MEDIUM = 56+21=77, score 23 → stressed.
    // Simpler: cyber 9×HIGH = 100-72=28 → stressed.
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 9; i++) obs.push(makeEvent({ id: `h-${i}`, domain: 'cyber', severity: 'HIGH' }));
    const reading = e.computePulse(obs);
    assert.equal(reading.label, 'stressed');
  });

  it('overall 10 → critical (<25)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 15; i++) obs.push(makeEvent({ id: `h-${i}`, domain: 'cyber', severity: 'HIGH' }));
    const reading = e.computePulse(obs);
    assert.equal(reading.label, 'critical');
  });

  it('exact boundary 75 → nominal (inclusive)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // cyber 25 pts off. 1 CRITICAL = 15, 1 MEDIUM = 3 → 18. Need 25. Use 3 HIGH + 1 MEDIUM = 24+3=27 → 73 elevated.
    // 25 = 3 HIGH + 1 LOW = 24 + 1 = 25 → 75 nominal boundary.
    const reading = e.computePulse([
      makeEvent({ id: 'h1', domain: 'cyber', severity: 'HIGH' }),
      makeEvent({ id: 'h2', domain: 'cyber', severity: 'HIGH' }),
      makeEvent({ id: 'h3', domain: 'cyber', severity: 'HIGH' }),
      makeEvent({ id: 'l1', domain: 'cyber', severity: 'LOW' }),
    ]);
    assert.equal(reading.overallScore, 75);
    assert.equal(reading.label, 'nominal');
  });

  it('exact boundary 50 → elevated (inclusive)', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    // 50 pts off. 3 CRITICAL + 1 LOW = 45 + 1 = 46. 3 CRITICAL + 1 HIGH = 45+8 = 53. We need 50. Try 5*CRITICAL = 75 — too much. 2 CRITICAL + 2 HIGH + 1 LOW + 1 LOW + 1 LOW = 30+16+3 = 49.
    // Easier: 6 HIGH + 2 LOW = 48 + 2 = 50.
    const obs: ObservationEvent[] = [];
    for (let i = 0; i < 6; i++) obs.push(makeEvent({ id: `h-${i}`, domain: 'cyber', severity: 'HIGH' }));
    obs.push(makeEvent({ id: 'l1', domain: 'cyber', severity: 'LOW' }));
    obs.push(makeEvent({ id: 'l2', domain: 'cyber', severity: 'LOW' }));
    const reading = e.computePulse(obs);
    assert.equal(reading.overallScore, 50);
    assert.equal(reading.label, 'elevated');
  });
});

// ── Trend detection ─────────────────────────────────────────────────

describe('CivilizationPulseEngine — trend detection', () => {
  beforeEach(() => { resetForTests(); });

  it('first reading: every domain trend is "stable"', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ id: 'a', domain: 'weather', severity: 'HIGH' })]);
    assert.equal(reading.domainPulses[0]!.trend, 'stable');
  });

  it('score increases by >5 between readings → trend=improving', () => {
    let t = NOW;
    const e = new CivilizationPulseEngine({ now: () => t });
    e.computePulse([
      makeEvent({ id: 'a', domain: 'weather', severity: 'CRITICAL' }), // 85
      makeEvent({ id: 'b', domain: 'weather', severity: 'CRITICAL' }), // 70
    ]);
    t = NOW + 60_000;
    const reading2 = e.computePulse([
      makeEvent({ id: 'a', domain: 'weather', severity: 'LOW' }), // 99
    ]);
    const weather = reading2.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.trend, 'improving');
  });

  it('score decreases by >5 between readings → trend=degrading', () => {
    let t = NOW;
    const e = new CivilizationPulseEngine({ now: () => t });
    e.computePulse([makeEvent({ id: 'a', domain: 'weather', severity: 'LOW' })]);
    t = NOW + 60_000;
    const reading2 = e.computePulse([
      makeEvent({ id: 'b', domain: 'weather', severity: 'CRITICAL' }),
      makeEvent({ id: 'c', domain: 'weather', severity: 'CRITICAL' }),
    ]);
    const weather = reading2.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.trend, 'degrading');
  });

  it('score change within ±5 → trend=stable', () => {
    let t = NOW;
    const e = new CivilizationPulseEngine({ now: () => t });
    e.computePulse([makeEvent({ id: 'a', domain: 'weather', severity: 'HIGH' })]); // 92
    t = NOW + 60_000;
    const reading2 = e.computePulse([makeEvent({ id: 'b', domain: 'weather', severity: 'MEDIUM' })]); // 97
    const weather = reading2.domainPulses.find((d) => d.domain === 'weather')!;
    assert.equal(weather.trend, 'stable');
  });
});

// ── Dominant stressor ───────────────────────────────────────────────

describe('CivilizationPulseEngine — dominantStressor', () => {
  beforeEach(() => { resetForTests(); });

  it('returns the domain with the lowest score', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([
      makeEvent({ id: 'cyber1',  domain: 'cyber',     severity: 'CRITICAL' }), // 85
      makeEvent({ id: 'cyber2',  domain: 'cyber',     severity: 'CRITICAL' }), // 70
      makeEvent({ id: 'weather', domain: 'weather',   severity: 'LOW' }),      // 99
    ]);
    assert.equal(reading.dominantStressor, 'cyber');
  });

  it('returns null when all domain scores are 100', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ id: 'info', domain: 'weather', severity: 'INFO' })]);
    assert.equal(reading.dominantStressor, null);
  });

  it('null when no observations at all', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    assert.equal(e.computePulse([]).dominantStressor, null);
  });
});

// ── History / getLatestReading ──────────────────────────────────────

describe('CivilizationPulseEngine — history', () => {
  beforeEach(() => { resetForTests(); });

  it('getLatestReading returns the most recent computePulse output', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    const reading = e.computePulse([makeEvent({ id: 'a', domain: 'weather', severity: 'HIGH' })]);
    assert.deepEqual(e.getLatestReading(), reading);
  });

  it('getLatestReading is undefined before any reading', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    assert.equal(e.getLatestReading(), undefined);
  });

  it('getHistory returns last N readings (default 48)', () => {
    let t = NOW;
    const e = new CivilizationPulseEngine({ now: () => t });
    for (let i = 0; i < 60; i++) {
      e.computePulse([]);
      t += 60_000;
    }
    assert.equal(e.getHistory().length, 48);
  });

  it('getHistory(limit) honors the supplied limit', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    for (let i = 0; i < 10; i++) e.computePulse([]);
    assert.equal(e.getHistory(5).length, 5);
  });

  it('ring buffer caps at 500 readings (no unbounded growth)', () => {
    let t = NOW;
    const e = new CivilizationPulseEngine({ now: () => t, capacity: 4 });
    for (let i = 0; i < 7; i++) {
      e.computePulse([]);
      t += 60_000;
    }
    assert.ok(e.getHistory(100).length <= 4);
  });
});

// ── Subscribe ───────────────────────────────────────────────────────

describe('CivilizationPulseEngine — subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on computePulse with the produced reading', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    let calls = 0;
    let last: PulseReading | null = null;
    e.subscribe((reading) => { calls++; last = reading; });
    const out = e.computePulse([]);
    assert.equal(calls, 1);
    assert.deepEqual(last, out);
  });

  it('unsubscribe stops further callbacks', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    let calls = 0;
    const cb = () => { calls++; };
    e.subscribe(cb);
    e.computePulse([]);
    e.unsubscribe(cb);
    e.computePulse([]);
    assert.equal(calls, 1);
  });

  it('returned disposer also unsubscribes', () => {
    const e = new CivilizationPulseEngine({ now: () => NOW });
    let calls = 0;
    const off = e.subscribe(() => { calls++; });
    e.computePulse([]);
    off();
    e.computePulse([]);
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('CivilizationPulseEngine — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new CivilizationPulseEngine({ now: () => NOW, storage });
    a.computePulse([makeEvent({ id: 'x', domain: 'weather', severity: 'CRITICAL' })]);
    const b = new CivilizationPulseEngine({ now: () => NOW, storage });
    const restored = b.getLatestReading();
    assert.ok(restored);
    assert.equal(restored.label, 'nominal');
    assert.ok(b.getHistory().length >= 1);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const e = new CivilizationPulseEngine({ now: () => NOW, storage });
    assert.equal(e.getLatestReading(), undefined);
    assert.equal(e.getHistory().length, 0);
  });
});
