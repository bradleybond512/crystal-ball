import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DriverScoringEngine,
  resetForTests,
  type ScoringDriver,
} from '../../src/services/intelligence/driver-scores.ts';
import {
  builtInDrivers,
  earthquakeMagnitudeDriver,
  spaceWeatherKpDriver,
} from '../../src/services/intelligence/built-in-drivers.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { EvidenceEdge, Situation } from '../../src/services/intelligence/situation-store-v2.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev', sourceId: 'test', domain: 'weather',
    timestamp: NOW, severity: 'MEDIUM',
    title: 'Test event', raw: null,
    entityIds: [], tags: [],
    ...overrides,
  };
}

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit', name: 'Test', domain: 'weather',
    relatedDomains: [], severity: 'medium', status: 'active',
    summary: '', observations: [], edges: [], entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW), updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

function fixedDriver(opts: Partial<ScoringDriver> & { id: string; rawValue?: number | null; normalizedScore?: number; weight?: number; domain?: string }): ScoringDriver {
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    domain: opts.domain ?? 'weather',
    weight: opts.weight ?? 1,
    description: opts.description ?? `${opts.id} driver`,
    // `rawValue: null` opts the driver into "value missing" behavior;
    // anything else (including unset) feeds the fixed normalizedScore.
    extractValue: () => opts.rawValue === null ? null : (opts.rawValue ?? 0),
    normalizeValue: () => opts.normalizedScore ?? 0,
  };
}

// ── Registry ──────────────────────────────────────────────────────────

describe('DriverScoringEngine registry', () => {
  beforeEach(() => { resetForTests(); });

  it('registerDriver / getDrivers round-trip', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'd1' }));
    assert.equal(eng.getDrivers().length, 1);
    assert.equal(eng.getDrivers()[0]?.id, 'd1');
  });

  it('registerDriver replaces existing on same id', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'd1', name: 'first' }));
    eng.registerDriver(fixedDriver({ id: 'd1', name: 'second' }));
    assert.equal(eng.getDrivers().length, 1);
    assert.equal(eng.getDrivers()[0]?.name, 'second');
  });

  it('unregisterDriver removes the driver', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'd1' }));
    eng.unregisterDriver('d1');
    assert.equal(eng.getDrivers().length, 0);
  });

  it('getDriversByDomain filters', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', domain: 'weather' }));
    eng.registerDriver(fixedDriver({ id: 'b', domain: 'cyber' }));
    assert.equal(eng.getDriversByDomain('weather').length, 1);
    assert.equal(eng.getDriversByDomain('cyber').length, 1);
    assert.equal(eng.getDriversByDomain('aviation').length, 0);
  });
});

// ── scoreObservation ─────────────────────────────────────────────────

describe('DriverScoringEngine.scoreObservation', () => {
  beforeEach(() => { resetForTests(); });

  it('returns one DriverScore per registered driver in the domain', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', domain: 'weather', rawValue: 10, normalizedScore: 0.5, weight: 0.6 }));
    eng.registerDriver(fixedDriver({ id: 'b', domain: 'weather', rawValue: 20, normalizedScore: 0.8, weight: 0.4 }));
    const result = eng.scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(result.driverScores.length, 2);
  });

  it('cross-domain drivers do not contribute to a different-domain observation', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'wx', domain: 'weather', normalizedScore: 0.9, weight: 1 }));
    const result = eng.scoreObservation(makeEvent({ domain: 'cyber' }));
    assert.equal(result.driverScores.length, 0);
    assert.equal(result.baseScore, 0);
  });

  it('baseScore is the weight-normalized weighted sum (re-normalized when weights sum != 1)', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.5, weight: 0.3 }));
    eng.registerDriver(fixedDriver({ id: 'b', normalizedScore: 1.0, weight: 0.3 }));
    // Weights sum to 0.6 → re-normalize to (0.5, 0.5).
    // baseScore = 0.5*0.5 + 1.0*0.5 = 0.75
    const result = eng.scoreObservation(makeEvent({ domain: 'weather' }));
    assert.ok(Math.abs(result.baseScore - 0.75) < 1e-6, `expected 0.75, got ${result.baseScore}`);
  });

  it('null extractValue contributes 0 (driver still appears in driverScores)', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'present', rawValue: 10, normalizedScore: 0.8, weight: 0.5 }));
    eng.registerDriver(fixedDriver({ id: 'missing', rawValue: null, normalizedScore: 0.0, weight: 0.5 }));
    const result = eng.scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(result.driverScores.length, 2);
    const missing = result.driverScores.find((d) => d.driverId === 'missing');
    assert.equal(missing?.normalizedScore, 0);
    assert.equal(missing?.rawValue, null);
  });

  it('weightedContribution = normalizedScore * normalizedWeight', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.6, weight: 1 }));
    const result = eng.scoreObservation(makeEvent({ domain: 'weather' }));
    assert.ok(Math.abs(result.driverScores[0]!.weightedContribution - 0.6) < 1e-6);
  });

  it('finalScore = baseScore + edgeBonus, capped at 1.0', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.9, weight: 1 }));
    const edges: EvidenceEdge[] = [
      { type: 'caused_by', sourceEventId: 'ev', targetEventId: 'other', confidence: 1.0 },
      { type: 'confirms',  sourceEventId: 'src', targetEventId: 'ev',   confidence: 1.0 },
    ];
    // baseScore = 0.9, edge bonus from incoming 'confirms' (1.0 * 0.05 = 0.05).
    // Outgoing 'caused_by' should NOT contribute because the rule says
    // 'incoming' edges only.
    const result = eng.scoreObservation(makeEvent({ id: 'ev', domain: 'weather' }), edges);
    assert.ok(result.edgeBonus > 0, 'expected an edge bonus from confirms');
    assert.ok(result.finalScore <= 1.0, `expected ≤1.0, got ${result.finalScore}`);
  });

  it('edgeBonus is capped at 0.2', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0, weight: 1 }));
    const edges: EvidenceEdge[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'confirms', sourceEventId: `s-${i}`, targetEventId: 'ev', confidence: 1.0,
    }));
    const result = eng.scoreObservation(makeEvent({ id: 'ev', domain: 'weather' }), edges);
    assert.ok(result.edgeBonus <= 0.2, `bonus ${result.edgeBonus} should be ≤0.2`);
  });

  it('non-causal edge types do not contribute to bonus', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0, weight: 1 }));
    const edges: EvidenceEdge[] = [
      { type: 'co-located', sourceEventId: 's', targetEventId: 'ev', confidence: 1.0 },
      { type: 'temporally-adjacent', sourceEventId: 's2', targetEventId: 'ev', confidence: 1.0 },
      { type: 'contradicts', sourceEventId: 's3', targetEventId: 'ev', confidence: 1.0 },
    ];
    const result = eng.scoreObservation(makeEvent({ id: 'ev', domain: 'weather' }), edges);
    assert.equal(result.edgeBonus, 0);
  });

  it('explanation is a non-empty human-readable string', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', name: 'Wind Speed', normalizedScore: 0.7, weight: 1 }));
    const result = eng.scoreObservation(makeEvent({ domain: 'weather' }));
    assert.ok(result.explanation.length > 0);
  });
});

// ── Severity bands ────────────────────────────────────────────────────

describe('DriverScoringEngine severity bands', () => {
  beforeEach(() => { resetForTests(); });

  function setupAt(score: number): DriverScoringEngine {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: score, weight: 1 }));
    return eng;
  }

  it('0.0 → low', () => {
    const r = setupAt(0).scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(r.derivedSeverity, 'low');
  });

  it('0.30 → low (bands: 0–0.35 = low)', () => {
    const r = setupAt(0.30).scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(r.derivedSeverity, 'low');
  });

  it('0.50 → medium', () => {
    const r = setupAt(0.50).scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(r.derivedSeverity, 'medium');
  });

  it('0.70 → high', () => {
    const r = setupAt(0.70).scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(r.derivedSeverity, 'high');
  });

  it('0.90 → critical', () => {
    const r = setupAt(0.90).scoreObservation(makeEvent({ domain: 'weather' }));
    assert.equal(r.derivedSeverity, 'critical');
  });
});

// ── scoreSituation ────────────────────────────────────────────────────

describe('DriverScoringEngine.scoreSituation', () => {
  beforeEach(() => { resetForTests(); });

  it('returns aggregate between 0 and 1 with derived severity', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.6, weight: 1 }));
    const sit = makeSituation({
      observations: [makeEvent({ id: 'o1' }), makeEvent({ id: 'o2' })],
    });
    const result = eng.scoreSituation(sit);
    assert.ok(result.aggregateScore >= 0 && result.aggregateScore <= 1);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(result.derivedSeverity));
  });

  it('topDrivers is at most 3 entries and sorted by weightedContribution desc', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.5, weight: 0.1 }));
    eng.registerDriver(fixedDriver({ id: 'b', normalizedScore: 0.8, weight: 0.4 }));
    eng.registerDriver(fixedDriver({ id: 'c', normalizedScore: 0.9, weight: 0.3 }));
    eng.registerDriver(fixedDriver({ id: 'd', normalizedScore: 0.6, weight: 0.2 }));
    const result = eng.scoreSituation(makeSituation({
      observations: [makeEvent({ id: 'o1' })],
    }));
    assert.ok(result.topDrivers.length <= 3);
    for (let i = 1; i < result.topDrivers.length; i++) {
      assert.ok(
        (result.topDrivers[i - 1]?.weightedContribution ?? 0) >= (result.topDrivers[i]?.weightedContribution ?? 0),
        'topDrivers must be sorted descending',
      );
    }
  });

  it('empty situation produces 0 aggregate + low severity', () => {
    const eng = new DriverScoringEngine();
    const result = eng.scoreSituation(makeSituation({ observations: [] }));
    assert.equal(result.aggregateScore, 0);
    assert.equal(result.derivedSeverity, 'low');
  });

  it('explanation is non-empty', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.7, weight: 1 }));
    const result = eng.scoreSituation(makeSituation({
      observations: [makeEvent({ id: 'o1' })],
    }));
    assert.ok(result.explanation.length > 0);
  });

  it('passes situation.edges through to per-observation scoring', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(fixedDriver({ id: 'a', normalizedScore: 0.5, weight: 1 }));
    const edges: EvidenceEdge[] = [
      { type: 'confirms', sourceEventId: 's', targetEventId: 'o1', confidence: 1 },
    ];
    const sit = makeSituation({
      observations: [makeEvent({ id: 'o1' })],
      edges,
    });
    const result = eng.scoreSituation(sit);
    const obsScore = result.observationScores[0];
    assert.ok(obsScore && obsScore.edgeBonus > 0, 'edge bonus should propagate');
  });
});

// ── Built-in drivers ──────────────────────────────────────────────────

describe('built-in drivers', () => {
  beforeEach(() => { resetForTests(); });

  it('builtInDrivers covers all 10 listed domains', () => {
    const domains = new Set(builtInDrivers.map((d) => d.domain));
    for (const expected of [
      'earthquake', 'weather', 'wildfire', 'maritime', 'aviation',
      'biosurveillance', 'space-weather', 'cyber', 'sanctions', 'intelligence',
    ]) {
      assert.ok(domains.has(expected), `missing built-in driver coverage for domain "${expected}"`);
    }
  });

  it('every domain has at least 2 drivers', () => {
    const counts: Record<string, number> = {};
    for (const d of builtInDrivers) {
      counts[d.domain] = (counts[d.domain] ?? 0) + 1;
    }
    for (const [domain, count] of Object.entries(counts)) {
      assert.ok(count >= 2, `domain "${domain}" has only ${count} drivers, need ≥2`);
    }
  });

  it('every built-in driver has a unique id', () => {
    const ids = new Set(builtInDrivers.map((d) => d.id));
    assert.equal(ids.size, builtInDrivers.length);
  });

  it('earthquake magnitude driver: M3.0 → low band, M7.5 → critical', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(earthquakeMagnitudeDriver);
    const lowSeismic = eng.scoreObservation(makeEvent({
      domain: 'earthquake', sourceId: 'usgs-earthquake',
      raw: { properties: { mag: 3.0 } },
    }));
    assert.equal(lowSeismic.derivedSeverity, 'low');
    const big = eng.scoreObservation(makeEvent({
      domain: 'earthquake', sourceId: 'usgs-earthquake',
      raw: { properties: { mag: 7.5 } },
    }));
    assert.equal(big.derivedSeverity, 'critical');
  });

  it('space-weather Kp driver: Kp=3 → low, Kp=9 → critical', () => {
    const eng = new DriverScoringEngine();
    eng.registerDriver(spaceWeatherKpDriver);
    const calm = eng.scoreObservation(makeEvent({
      domain: 'space-weather', sourceId: 'swpc-space-weather',
      raw: { kp: 3 },
    }));
    assert.equal(calm.derivedSeverity, 'low');
    const storm = eng.scoreObservation(makeEvent({
      domain: 'space-weather', sourceId: 'swpc-space-weather',
      raw: { kp: 9 },
    }));
    assert.equal(storm.derivedSeverity, 'critical');
  });

  it('extractValue defensively returns null on missing payload fields', () => {
    const result = earthquakeMagnitudeDriver.extractValue(makeEvent({
      domain: 'earthquake', raw: null,
    }));
    assert.equal(result, null);
  });

  it('normalizeValue clamps to [0,1]', () => {
    assert.ok(earthquakeMagnitudeDriver.normalizeValue(-5) >= 0);
    assert.ok(earthquakeMagnitudeDriver.normalizeValue(15) <= 1);
    assert.ok(spaceWeatherKpDriver.normalizeValue(-5) >= 0);
    assert.ok(spaceWeatherKpDriver.normalizeValue(15) <= 1);
  });
});
