import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AssumptionTracker,
  resetForTests,
  type Assumption,
} from '../../src/services/intelligence/assumption-tracker.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';
import type { EvidenceEdge, Situation } from '../../src/services/intelligence/situation-store-v2.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'ev', sourceId: 'usgs-earthquake', domain: 'earthquake',
    timestamp: NOW, severity: 'MEDIUM',
    title: 'M5.8 earthquake near Tokyo', raw: { properties: { mag: 5.8 } },
    entityIds: [], tags: [],
    location: { lat: 35.7, lon: 139.7 },
    ...overrides,
  };
}

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit', name: 'Test Situation', domain: 'earthquake',
    relatedDomains: [], severity: 'medium', status: 'active',
    summary: '', observations: [], edges: [], entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW), updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

// ── Annotate: complete observation produces 0 assumptions ─────────────

describe('AssumptionTracker.annotate — complete observation', () => {
  beforeEach(() => { resetForTests(); });

  it('observation with location + magnitude + fresh timestamp → 0 assumptions', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({ id: 'good', timestamp: NOW - 60_000 });
    const ann = t.annotate('out-1', 'score', { observations: [obs] });
    assert.equal(ann.assumptions.length, 0);
    assert.equal(ann.criticalAssumptionCount, 0);
    assert.equal(ann.overallConfidence, 1);
  });

  it('caveat is non-empty for healthy output too', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const ann = t.annotate('out-1', 'score', { observations: [makeEvent({ timestamp: NOW - 60_000 })] });
    assert.ok(ann.caveat.length > 0);
  });
});

// ── Detector: missing location ──────────────────────────────────────

describe('AssumptionTracker — missing location', () => {
  beforeEach(() => { resetForTests(); });

  it('earthquake obs without lat/lon → geospatial assumption (critical)', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({ id: 'noloc', location: undefined, timestamp: NOW - 60_000 });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    const geo = ann.assumptions.find((a) => a.category === 'geospatial');
    assert.ok(geo);
    assert.equal(geo?.isCritical, true, 'earthquake domain → geospatial assumption is critical');
  });

  it('cyber obs without lat/lon → geospatial assumption is NOT critical', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({
      id: 'noloc', domain: 'cyber', sourceId: 'cisa-cve',
      location: undefined, timestamp: NOW - 60_000,
    });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    const geo = ann.assumptions.find((a) => a.category === 'geospatial');
    assert.ok(geo);
    assert.equal(geo?.isCritical, false);
  });

  it('confidence on missing-location is 0.5', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const ann = t.annotate('out', 'score', {
      observations: [makeEvent({ location: undefined, timestamp: NOW - 60_000 })],
    });
    const geo = ann.assumptions.find((a) => a.category === 'geospatial');
    assert.equal(geo?.confidence, 0.5);
  });
});

// ── Detector: stale feed ────────────────────────────────────────────

describe('AssumptionTracker — stale feed', () => {
  beforeEach(() => { resetForTests(); });

  it('obs with timestamp > 2× refresh budget → data-quality assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    // Earthquake refresh budget defaults to 5min; 2× = 10min.
    const stale = makeEvent({ id: 'stale', timestamp: NOW - 30 * 60_000 });
    const ann = t.annotate('out', 'score', { observations: [stale] });
    const dq = ann.assumptions.find((a) => a.category === 'data-quality');
    assert.ok(dq);
  });

  it('confidence decreases with staleness', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const less = t.annotate('a', 'score', { observations: [makeEvent({ id: 'a', timestamp: NOW - 15 * 60_000 })] });
    const more = t.annotate('b', 'score', { observations: [makeEvent({ id: 'b', timestamp: NOW - 60 * 60_000 })] });
    const lessDq = less.assumptions.find((a) => a.category === 'data-quality');
    const moreDq = more.assumptions.find((a) => a.category === 'data-quality');
    assert.ok(lessDq && moreDq);
    assert.ok((moreDq?.confidence ?? 1) < (lessDq?.confidence ?? 0), 'further-stale → lower confidence');
  });

  it('fresh obs (within budget) → no data-quality assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const fresh = t.annotate('a', 'score', {
      observations: [makeEvent({ timestamp: NOW - 60_000 })],
    });
    assert.equal(fresh.assumptions.find((a) => a.category === 'data-quality'), undefined);
  });
});

// ── Detector: single-source situation ───────────────────────────────

describe('AssumptionTracker — single-source situation', () => {
  beforeEach(() => { resetForTests(); });

  it('situation with one observation → completeness assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const sit = makeSituation({ observations: [makeEvent({ id: 'one', timestamp: NOW - 60_000 })] });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    const c = ann.assumptions.find((a) => a.category === 'completeness');
    assert.ok(c, 'expected completeness assumption');
  });

  it('situation with 2+ observations from same source → completeness still flagged', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const sit = makeSituation({
      observations: [
        makeEvent({ id: 'a', sourceId: 'usgs-earthquake', timestamp: NOW - 60_000 }),
        makeEvent({ id: 'b', sourceId: 'usgs-earthquake', timestamp: NOW - 60_000 }),
      ],
    });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    assert.ok(ann.assumptions.find((a) => a.category === 'completeness'));
  });

  it('situation with 2+ observations from different sources → no completeness assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const sit = makeSituation({
      observations: [
        makeEvent({ id: 'a', sourceId: 'usgs-earthquake', timestamp: NOW - 60_000 }),
        makeEvent({ id: 'b', sourceId: 'gdacs-alerts', timestamp: NOW - 60_000 }),
      ],
    });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    assert.equal(ann.assumptions.find((a) => a.category === 'completeness'), undefined);
  });
});

// ── Detector: temporal-only correlation / low-confidence edge ──────

describe('AssumptionTracker — edges', () => {
  beforeEach(() => { resetForTests(); });

  it('low-confidence edge (<0.4) → model assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const edges: EvidenceEdge[] = [{
      type: 'caused_by', sourceEventId: 'a', targetEventId: 'b', confidence: 0.3,
    }];
    const sit = makeSituation({
      observations: [makeEvent({ id: 'a', timestamp: NOW - 60_000 }), makeEvent({ id: 'b', timestamp: NOW - 60_000 })],
      edges,
    });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    assert.ok(ann.assumptions.find((a) => a.category === 'model'));
  });

  it('high-confidence edge (>=0.4) → no model assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const sit = makeSituation({
      observations: [
        makeEvent({ id: 'a', sourceId: 'usgs-earthquake', timestamp: NOW - 60_000 }),
        makeEvent({ id: 'b', sourceId: 'gdacs-alerts',    timestamp: NOW - 60_000 }),
      ],
      edges: [{ type: 'caused_by', sourceEventId: 'a', targetEventId: 'b', confidence: 0.8 }],
    });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    assert.equal(ann.assumptions.find((a) => a.category === 'model'), undefined);
  });

  it('temporally-adjacent edge with no shared location → causality assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const a = makeEvent({ id: 'a', sourceId: 'usgs-earthquake', timestamp: NOW - 60_000 });
    const b = makeEvent({ id: 'b', sourceId: 'gdacs-alerts',    timestamp: NOW - 30_000, location: undefined });
    const sit = makeSituation({
      observations: [a, b],
      edges: [{
        type: 'temporally-adjacent', sourceEventId: 'a', targetEventId: 'b', confidence: 0.7,
      }],
    });
    const ann = t.annotate(sit.id, 'situation', { situation: sit, observations: sit.observations });
    assert.ok(ann.assumptions.find((a) => a.category === 'causality'));
  });
});

// ── Detector: missing magnitude/intensity ───────────────────────────

describe('AssumptionTracker — missing key field', () => {
  beforeEach(() => { resetForTests(); });

  it('earthquake obs without magnitude in raw → baseline assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({ id: 'no-mag', timestamp: NOW - 60_000, raw: {} });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    assert.ok(ann.assumptions.find((a) => a.category === 'baseline'));
  });

  it('weather obs without category in raw → baseline assumption', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({
      id: 'no-cat', domain: 'weather', sourceId: 'nws-alerts',
      raw: {}, timestamp: NOW - 60_000,
    });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    assert.ok(ann.assumptions.find((a) => a.category === 'baseline'));
  });
});

// ── overallConfidence + caveat ──────────────────────────────────────

describe('AssumptionTracker — overallConfidence + caveat', () => {
  beforeEach(() => { resetForTests(); });

  it('overallConfidence = min of CRITICAL assumption confidences', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    // Two assumptions: missing earthquake location (critical, 0.5) +
    // stale feed (data-quality, not critical) — overall should = 0.5.
    const obs = makeEvent({ id: 'x', location: undefined, timestamp: NOW - 60 * 60_000 });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    assert.ok(ann.criticalAssumptionCount >= 1);
    assert.equal(ann.overallConfidence, 0.5);
  });

  it('overallConfidence = 1 when no critical assumptions exist', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({
      id: 'cyber', domain: 'cyber', sourceId: 'cisa-cve',
      location: undefined, timestamp: NOW - 60_000,
    });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    assert.equal(ann.criticalAssumptionCount, 0);
    assert.equal(ann.overallConfidence, 1);
  });

  it('caveat enumerates assumption statements when assumptions present', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    const obs = makeEvent({ id: 'x', location: undefined, timestamp: NOW - 60_000 });
    const ann = t.annotate('out', 'score', { observations: [obs] });
    assert.ok(ann.caveat.length > 0);
    // Should mention something about location.
    assert.match(ann.caveat, /location|coordinate/i);
  });
});

// ── getAnnotation / persistence ─────────────────────────────────────

describe('AssumptionTracker — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getAnnotation returns the most recent annotation by outputId', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    t.annotate('out-1', 'score', { observations: [makeEvent({ id: 'a', timestamp: NOW - 60_000 })] });
    const back = t.getAnnotation('out-1');
    assert.ok(back);
    assert.equal(back?.outputId, 'out-1');
  });

  it('getAnnotation returns undefined for unknown outputId', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    assert.equal(t.getAnnotation('missing'), undefined);
  });

  it('re-annotating the same outputId replaces the prior annotation', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    t.annotate('out', 'score', { observations: [makeEvent({ id: 'a', location: undefined, timestamp: NOW - 60_000 })] });
    t.annotate('out', 'score', { observations: [makeEvent({ id: 'a', timestamp: NOW - 60_000 })] });
    assert.equal(t.getAnnotation('out')?.assumptions.length, 0);
  });
});

// ── Cross-output queries ────────────────────────────────────────────

describe('AssumptionTracker — cross-output queries', () => {
  beforeEach(() => { resetForTests(); });

  function setup(): AssumptionTracker {
    const t = new AssumptionTracker({ now: () => NOW });
    // out-1: critical geospatial (earthquake, no location)
    t.annotate('out-1', 'score', {
      observations: [makeEvent({ id: 'a', location: undefined, timestamp: NOW - 60_000 })],
    });
    // out-2: non-critical geospatial (cyber, no location)
    t.annotate('out-2', 'score', {
      observations: [makeEvent({
        id: 'b', domain: 'cyber', sourceId: 'cisa-cve',
        location: undefined, timestamp: NOW - 60_000,
      })],
    });
    // out-3: stale (data-quality, high violation risk if very old)
    t.annotate('out-3', 'score', {
      observations: [makeEvent({ id: 'c', timestamp: NOW - 6 * 60 * 60_000 })],
    });
    return t;
  }

  it('getByCategory("geospatial") returns assumptions of that category', () => {
    const t = setup();
    const list = t.getByCategory('geospatial');
    assert.ok(list.length >= 2);
    for (const a of list) assert.equal(a.category, 'geospatial');
  });

  it('getCritical returns only critical assumptions', () => {
    const t = setup();
    const list = t.getCritical();
    assert.ok(list.length >= 1);
    for (const a of list) assert.equal(a.isCritical, true);
  });

  it('getHighRisk returns only high violation-risk assumptions', () => {
    const t = setup();
    const list = t.getHighRisk();
    for (const a of list) assert.equal(a.violationRisk, 'high');
  });

  it('stats reports total / byCategory / criticalCount / avgConfidence', () => {
    const t = setup();
    const s = t.stats();
    assert.ok(s.totalAssumptions >= 3);
    assert.ok(s.criticalCount >= 1);
    assert.ok(s.byCategory.geospatial !== undefined);
    assert.ok(s.avgConfidence >= 0 && s.avgConfidence <= 1);
  });
});

// ── subscribe ───────────────────────────────────────────────────────

describe('AssumptionTracker.subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on annotate()', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    let calls = 0;
    let lastId: string | undefined;
    const off = t.subscribe((ann) => { calls++; lastId = ann.outputId; });
    t.annotate('out-1', 'score', { observations: [makeEvent({ id: 'a', timestamp: NOW - 60_000 })] });
    assert.equal(calls, 1);
    assert.equal(lastId, 'out-1');
    off();
    t.annotate('out-2', 'score', { observations: [makeEvent({ id: 'b', timestamp: NOW - 60_000 })] });
    assert.equal(calls, 1);
  });

  it('multiple subscribers all fire', () => {
    const t = new AssumptionTracker({ now: () => NOW });
    let a = 0; let b = 0;
    t.subscribe(() => a++);
    t.subscribe(() => b++);
    t.annotate('out-1', 'score', { observations: [makeEvent({ id: 'a', timestamp: NOW - 60_000 })] });
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});

// ── persistence ─────────────────────────────────────────────────────

describe('AssumptionTracker — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new AssumptionTracker({ storage, now: () => NOW });
    a.annotate('out-1', 'score', {
      observations: [makeEvent({ id: 'x', location: undefined, timestamp: NOW - 60_000 })],
    });
    const b = new AssumptionTracker({ storage, now: () => NOW });
    const restored = b.getAnnotation('out-1');
    assert.ok(restored);
    assert.ok(restored && restored.assumptions.length > 0);
    // detectedAt must round-trip as a Date.
    const a0: Assumption | undefined = restored?.assumptions[0];
    assert.ok(a0?.detectedAt instanceof Date);
  });

  it('respects 500-output cap (ring buffer)', () => {
    const t = new AssumptionTracker({ capacity: 4, now: () => NOW });
    for (let i = 0; i < 6; i++) {
      t.annotate(`o-${i}`, 'score', {
        observations: [makeEvent({ id: `e-${i}`, timestamp: NOW - 60_000 })],
      });
    }
    assert.equal(t.stats().totalOutputs, 4);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const t = new AssumptionTracker({ storage });
    assert.equal(t.stats().totalOutputs, 0);
  });
});
