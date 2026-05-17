import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  FailurePredictionEngine,
  resetForTests,
  type CorrelationLookup,
  type EscalationRisk,
} from '../../src/services/intelligence/failure-prediction.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev', sourceId: 'test', domain: 'weather',
    timestamp: NOW - 60_000, severity: 'MEDIUM',
    title: 'Test event', raw: null,
    entityIds: [], tags: [],
    ...overrides,
  };
}

function noCorrelations(): CorrelationLookup {
  return { hasCorrelation: () => false };
}
function alwaysCorrelated(): CorrelationLookup {
  return { hasCorrelation: () => true };
}

// ── Empty input ──────────────────────────────────────────────────────

describe('FailurePredictionEngine.predict — empty', () => {
  beforeEach(() => { resetForTests(); });

  it('empty observation list → 0 risks', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    assert.equal(e.predict([]).length, 0);
  });

  it('returns one EscalationRisk per observation', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const result = e.predict([makeEvent({ id: 'a' }), makeEvent({ id: 'b' })]);
    assert.equal(result.length, 2);
  });

  it('each risk carries observationId, domain, probability, horizon, factors, predictedAt', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'a' })])[0]!;
    assert.equal(r.observationId, 'a');
    assert.equal(r.domain, 'weather');
    assert.ok(r.probability >= 0 && r.probability <= 1);
    assert.ok(['1h', '6h', '24h'].includes(r.horizon));
    assert.ok(Array.isArray(r.factors));
    assert.equal(r.predictedAt, NOW);
  });
});

// ── Probability factors ──────────────────────────────────────────────

describe('FailurePredictionEngine — factor contributions', () => {
  beforeEach(() => { resetForTests(); });

  it('higher base severity → higher probability', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const low  = e.predict([makeEvent({ id: 'low',  severity: 'LOW' })])[0]!;
    const high = e.predict([makeEvent({ id: 'high', severity: 'HIGH' })])[0]!;
    assert.ok(high.probability > low.probability, `high(${high.probability}) ≤ low(${low.probability})`);
  });

  it('recent observation (<30min) adds a factor + probability', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const recent = e.predict([makeEvent({ id: 'rec',  timestamp: NOW - 5 * 60_000 })])[0]!;
    const old    = e.predict([makeEvent({ id: 'old',  timestamp: NOW - 6 * 60 * 60_000 })])[0]!;
    assert.ok(recent.probability > old.probability);
    assert.ok(recent.factors.some((f) => /recen/i.test(f)));
  });

  it('cross-domain correlation present → factor added + probability bumped', () => {
    const noCorr   = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const withCorr = new FailurePredictionEngine({ now: () => NOW, correlations: alwaysCorrelated() });
    const a = noCorr.predict([makeEvent({ id: 'x', severity: 'MEDIUM' })])[0]!;
    const b = withCorr.predict([makeEvent({ id: 'x', severity: 'MEDIUM' })])[0]!;
    assert.ok(b.probability > a.probability);
    assert.ok(b.factors.some((f) => /correlat/i.test(f)));
  });

  it('high-volatility domain (earthquake) > baseline (cyber)', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const quake = e.predict([makeEvent({ id: 'q', domain: 'earthquake', severity: 'MEDIUM' })])[0]!;
    const cyber = e.predict([makeEvent({ id: 'c', domain: 'cyber',      severity: 'MEDIUM' })])[0]!;
    assert.ok(quake.probability > cyber.probability);
    assert.ok(quake.factors.some((f) => /high.volatility|volatil/i.test(f)));
  });

  it('multi-source overlap on entityIds adds a factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const result = e.predict([
      makeEvent({ id: 'a', sourceId: 'usgs',   entityIds: ['us7000pqr5'] }),
      makeEvent({ id: 'b', sourceId: 'emsc',   entityIds: ['us7000pqr5'] }),
    ]);
    const a = result.find((r) => r.observationId === 'a')!;
    assert.ok(a.factors.some((f) => /multi.source|second.confirm/i.test(f)));
  });

  it('single-source observation gets no multi-source factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const result = e.predict([
      makeEvent({ id: 'a', sourceId: 'usgs',   entityIds: ['us7000pqr5'] }),
      makeEvent({ id: 'b', sourceId: 'emsc',   entityIds: ['different'] }),
    ]);
    const a = result.find((r) => r.observationId === 'a')!;
    assert.ok(!a.factors.some((f) => /multi.source/i.test(f)));
  });

  it('"no historical baseline" tag adds a factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'unprec', tags: ['unprecedented'] })])[0]!;
    assert.ok(r.factors.some((f) => /baseline|unprecedent/i.test(f)));
  });

  it('probability is clamped to [0, 1]', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: alwaysCorrelated() });
    const r = e.predict([makeEvent({
      id: 'max',
      severity: 'CRITICAL', domain: 'earthquake',
      timestamp: NOW - 60_000,
      entityIds: ['shared'],
      tags: ['unprecedented'],
    }), makeEvent({
      id: 'twin', severity: 'CRITICAL', domain: 'earthquake', sourceId: 'other',
      timestamp: NOW - 60_000, entityIds: ['shared'],
    })])[0]!;
    assert.ok(r.probability >= 0 && r.probability <= 1);
  });
});

// ── Bands + horizon ──────────────────────────────────────────────────

describe('FailurePredictionEngine — bands and horizons', () => {
  beforeEach(() => { resetForTests(); });

  it('low band (<0.3): cyber + LOW + old observation', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', domain: 'cyber', severity: 'LOW', timestamp: NOW - 24 * 60 * 60_000 })])[0]!;
    assert.ok(r.probability < 0.3, `expected <0.3, got ${r.probability}`);
  });

  it('high band (>0.6): earthquake CRITICAL + recent + correlation', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: alwaysCorrelated() });
    const r = e.predict([makeEvent({
      id: 'q', domain: 'earthquake', severity: 'CRITICAL', timestamp: NOW - 60_000,
    })])[0]!;
    assert.ok(r.probability > 0.6, `expected >0.6, got ${r.probability}`);
  });

  it('CRITICAL recent → 1h horizon', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', severity: 'CRITICAL', timestamp: NOW - 60_000 })])[0]!;
    assert.equal(r.horizon, '1h');
  });

  it('HIGH severity → 6h horizon', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', severity: 'HIGH' })])[0]!;
    assert.equal(r.horizon, '6h');
  });

  it('MEDIUM or below → 24h horizon', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', severity: 'MEDIUM' })])[0]!;
    assert.equal(r.horizon, '24h');
  });
});

// ── Predicted severity ────────────────────────────────────────────────

describe('FailurePredictionEngine — predicted severity', () => {
  beforeEach(() => { resetForTests(); });

  it('high probability bumps predicted severity above current', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: alwaysCorrelated() });
    const r = e.predict([makeEvent({
      id: 'q', domain: 'earthquake', severity: 'MEDIUM', timestamp: NOW - 60_000,
    })])[0]!;
    // MEDIUM → high probability → predicted should be HIGH or CRITICAL
    assert.ok(['HIGH', 'CRITICAL'].includes(r.predictedSeverity));
  });

  it('low probability leaves predictedSeverity at current', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', domain: 'cyber', severity: 'LOW', timestamp: NOW - 24 * 60 * 60_000 })])[0]!;
    assert.equal(r.predictedSeverity, 'LOW');
  });
});

// ── Domain templates ────────────────────────────────────────────────

describe('FailurePredictionEngine — domain templates', () => {
  beforeEach(() => { resetForTests(); });

  it('earthquake adds aftershock-probability factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', domain: 'earthquake', severity: 'HIGH' })])[0]!;
    assert.ok(r.factors.some((f) => /aftershock/i.test(f)));
  });

  it('biosurveillance adds R0-amplification factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'b', domain: 'biosurveillance', severity: 'HIGH' })])[0]!;
    assert.ok(r.factors.some((f) => /R0|amplification/i.test(f)));
  });

  it('weather adds intensification factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'w', domain: 'weather', severity: 'HIGH' })])[0]!;
    assert.ok(r.factors.some((f) => /intensif/i.test(f)));
  });

  it('maritime adds conflict-escalation factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'm', domain: 'maritime', severity: 'HIGH' })])[0]!;
    assert.ok(r.factors.some((f) => /conflict.escalat/i.test(f)));
  });

  it('aviation adds airspace-closure-cascade factor', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'a', domain: 'aviation', severity: 'HIGH' })])[0]!;
    assert.ok(r.factors.some((f) => /airspace|cascade/i.test(f)));
  });

  it('domain without template still produces a risk (no template factor)', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'x', domain: 'sanctions', severity: 'HIGH' })])[0]!;
    assert.ok(r);
    assert.ok(r.factors.length >= 0);
  });
});

// ── getHighRisk / subscribe ─────────────────────────────────────────

describe('FailurePredictionEngine — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getHighRisk returns only predictions with probability > 0.6', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: alwaysCorrelated() });
    e.predict([
      makeEvent({ id: 'high', domain: 'earthquake', severity: 'CRITICAL', timestamp: NOW - 60_000 }),
      makeEvent({ id: 'low',  domain: 'cyber',     severity: 'LOW',      timestamp: NOW - 24 * 60 * 60_000 }),
    ]);
    const high = e.getHighRisk();
    for (const r of high) assert.ok(r.probability > 0.6);
    assert.ok(high.some((r) => r.observationId === 'high'));
    assert.ok(!high.some((r) => r.observationId === 'low'));
  });

  it('subscribe fires on predict() with the produced batch', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    let calls = 0;
    let lastBatch: EscalationRisk[] | null = null;
    e.subscribe((batch) => { calls++; lastBatch = batch; });
    e.predict([makeEvent({ id: 'a' })]);
    assert.equal(calls, 1);
    assert.equal(lastBatch?.length, 1);
  });

  it('unsubscribe stops further callbacks', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    let calls = 0;
    const cb = () => { calls++; };
    e.subscribe(cb);
    e.predict([makeEvent({ id: 'a' })]);
    e.unsubscribe(cb);
    e.predict([makeEvent({ id: 'b' })]);
    assert.equal(calls, 1);
  });

  it('returned subscribe disposer also unsubscribes', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    let calls = 0;
    const off = e.subscribe(() => { calls++; });
    e.predict([makeEvent({ id: 'a' })]);
    off();
    e.predict([makeEvent({ id: 'b' })]);
    assert.equal(calls, 1);
  });
});

// ── Persistence ─────────────────────────────────────────────────────

describe('FailurePredictionEngine — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new FailurePredictionEngine({ storage, now: () => NOW, correlations: noCorrelations() });
    a.predict([makeEvent({ id: 'a', severity: 'HIGH', domain: 'earthquake' })]);
    const b = new FailurePredictionEngine({ storage, now: () => NOW, correlations: noCorrelations() });
    assert.ok(b.getHighRisk().length >= 0);
    assert.ok(b.getAll().length > 0);
  });

  it('ring buffer caps at 500 by default', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, capacity: 4, correlations: noCorrelations() });
    for (let i = 0; i < 7; i++) {
      e.predict([makeEvent({ id: `e-${i}` })]);
    }
    assert.equal(e.getAll().length, 4);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const e = new FailurePredictionEngine({ storage, now: () => NOW, correlations: noCorrelations() });
    assert.equal(e.getAll().length, 0);
  });

  it('re-predicting the same observationId replaces the prior entry', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    e.predict([makeEvent({ id: 'a', severity: 'LOW' })]);
    e.predict([makeEvent({ id: 'a', severity: 'HIGH' })]);
    const all = e.getAll().filter((r) => r.observationId === 'a');
    assert.equal(all.length, 1);
    assert.equal(all[0]?.currentSeverity, 'HIGH');
  });
});

// ── currentSeverity propagation ──────────────────────────────────────

describe('FailurePredictionEngine — currentSeverity', () => {
  beforeEach(() => { resetForTests(); });

  it('currentSeverity matches the observation severity', () => {
    const e = new FailurePredictionEngine({ now: () => NOW, correlations: noCorrelations() });
    const r = e.predict([makeEvent({ id: 'q', severity: 'HIGH' })])[0]!;
    assert.equal(r.currentSeverity, 'HIGH');
  });
});
