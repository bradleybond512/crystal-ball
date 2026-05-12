import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreEvent, scoreEvents } from '../driver-scorer.ts';
import type { ObservationEvent } from '@/types/intelligence';

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> & { id: string }): ObservationEvent {
  return {
    sourceId: 'test',
    domain: 'seismic',
    timestamp: NOW - 3 * 60 * 60_000,
    severity: 'MEDIUM',
    title: overrides.id,
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Return shape ───────────────────────────────────────────────────────────

test('scoreEvent returns ScoredEvent with driverScore, drivers, scoreReason', () => {
  const ev = makeEvent({ id: 'ev1' });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(typeof result.driverScore === 'number');
  assert.ok(Array.isArray(result.drivers));
  assert.ok(typeof result.scoreReason === 'string');
  assert.ok(result.scoreReason.length > 0);
});

test('driverScore is clamped to [0, 100]', () => {
  const ev = makeEvent({ id: 'ev-crit', severity: 'CRITICAL', domain: 'generic' });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.driverScore >= 0);
  assert.ok(result.driverScore <= 100);
});

test('ScoredEvent preserves all original ObservationEvent fields', () => {
  const ev = makeEvent({ id: 'preserve-me', tags: ['x'], entityIds: ['Y'] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.equal(result.id, ev.id);
  assert.deepEqual(result.tags, ev.tags);
  assert.deepEqual(result.entityIds, ev.entityIds);
});

// ── Earthquake domain ──────────────────────────────────────────────────────

test('earthquake domain detected by domain=seismic', () => {
  const ev = makeEvent({ id: 'quake-1', domain: 'seismic', tags: [] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.drivers.some((d) => d.name === 'magnitude'));
  assert.ok(result.drivers.some((d) => d.name === 'shallow_depth'));
});

test('earthquake domain detected by earthquake tag', () => {
  const ev = makeEvent({ id: 'quake-tag', domain: 'other', tags: ['earthquake'] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.drivers.some((d) => d.name === 'magnitude'));
});

test('high magnitude earthquake scores higher than low magnitude', () => {
  const high = makeEvent({ id: 'high-mag', domain: 'seismic', raw: { mag: 7.5 } });
  const low  = makeEvent({ id: 'low-mag',  domain: 'seismic', raw: { mag: 2.5 } });
  const rHigh = scoreEvent(high, { now: () => NOW });
  const rLow  = scoreEvent(low, { now: () => NOW });
  assert.ok(rHigh.driverScore > rLow.driverScore,
    `expected high(${rHigh.driverScore}) > low(${rLow.driverScore})`);
});

test('aftershock tag is mitigating direction', () => {
  const ev = makeEvent({ id: 'aftershock', domain: 'seismic', tags: ['aftershock'] });
  const result = scoreEvent(ev, { now: () => NOW });
  const aftershockDriver = result.drivers.find((d) => d.name === 'aftershock_pattern');
  assert.equal(aftershockDriver?.direction, 'mitigating');
});

test('earthquake driver weights sum to 1.0', () => {
  const ev = makeEvent({ id: 'sum-check', domain: 'seismic' });
  const { drivers } = scoreEvent(ev, { now: () => NOW });
  const total = drivers.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(total - 1.0) < 0.001, `weights summed to ${total}`);
});

// ── Wildfire domain ────────────────────────────────────────────────────────

test('wildfire domain detected by domain=wildfire', () => {
  const ev = makeEvent({ id: 'fire-1', domain: 'wildfire', tags: [] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.drivers.some((d) => d.name === 'fire_acres'));
  assert.ok(result.drivers.some((d) => d.name === 'containment_pct'));
});

test('wildfire with 0% containment scores higher than 100% containment', () => {
  const uncontained = makeEvent({ id: 'fire-out', domain: 'wildfire', raw: { containment: 0, acres: 5000 } });
  const contained   = makeEvent({ id: 'fire-in',  domain: 'wildfire', raw: { containment: 100, acres: 5000 } });
  const rOut = scoreEvent(uncontained, { now: () => NOW });
  const rIn  = scoreEvent(contained,   { now: () => NOW });
  assert.ok(rOut.driverScore > rIn.driverScore,
    `expected uncontained(${rOut.driverScore}) > contained(${rIn.driverScore})`);
});

test('wildfire driver weights sum to 1.0', () => {
  const ev = makeEvent({ id: 'fire-sum', domain: 'wildfire' });
  const { drivers } = scoreEvent(ev, { now: () => NOW });
  const total = drivers.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(total - 1.0) < 0.001, `weights summed to ${total}`);
});

// ── Aviation domain ────────────────────────────────────────────────────────

test('aviation domain detected by domain=aviation', () => {
  const ev = makeEvent({ id: 'av-1', domain: 'aviation', tags: [] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.drivers.some((d) => d.name === 'squawk_severity'));
  assert.ok(result.drivers.some((d) => d.name === 'aircraft_type'));
});

test('squawk 7700 (emergency) scores higher than 7000 (VFR default)', () => {
  const emergency = makeEvent({ id: 'sq7700', domain: 'aviation', raw: { squawk: '7700' } });
  const normal    = makeEvent({ id: 'sq7000', domain: 'aviation', raw: { squawk: '7000' } });
  const rEmerg = scoreEvent(emergency, { now: () => NOW });
  const rNorm  = scoreEvent(normal,    { now: () => NOW });
  assert.ok(rEmerg.driverScore > rNorm.driverScore,
    `expected emergency(${rEmerg.driverScore}) > normal(${rNorm.driverScore})`);
});

test('aviation driver weights sum to 1.0', () => {
  const ev = makeEvent({ id: 'av-sum', domain: 'aviation' });
  const { drivers } = scoreEvent(ev, { now: () => NOW });
  const total = drivers.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(total - 1.0) < 0.001, `weights summed to ${total}`);
});

// ── Generic / fallback ─────────────────────────────────────────────────────

test('unknown domain falls back to generic scorer', () => {
  const ev = makeEvent({ id: 'generic', domain: 'unknown-domain', tags: [] });
  const result = scoreEvent(ev, { now: () => NOW });
  assert.ok(result.drivers.some((d) => d.name === 'raw_severity'));
  assert.ok(result.drivers.some((d) => d.name === 'recency'));
});

test('generic: CRITICAL severity scores higher than INFO', () => {
  const crit = makeEvent({ id: 'crit', domain: 'generic', severity: 'CRITICAL' });
  const info = makeEvent({ id: 'info', domain: 'generic', severity: 'INFO' });
  const rCrit = scoreEvent(crit, { now: () => NOW });
  const rInfo = scoreEvent(info, { now: () => NOW });
  assert.ok(rCrit.driverScore > rInfo.driverScore,
    `expected crit(${rCrit.driverScore}) > info(${rInfo.driverScore})`);
});

test('generic: evidence connections boost the score', () => {
  const ev = makeEvent({ id: 'ev-connected', domain: 'generic', severity: 'INFO' });
  const noGraph = scoreEvent(ev, { now: () => NOW });
  // Stub graph returning 10 edges for ev-connected
  const stubGraph = {
    getEdges: (id: string) => id === 'ev-connected'
      ? Array.from({ length: 10 }, (_, i) => ({
          from: 'ev-connected', to: `other-${i}`, type: 'correlated' as const,
          confidence: 0.5, created: NOW,
        }))
      : [],
    addEdge: () => undefined,
    getNeighbors: () => [],
    findPath: () => null,
    populate: () => undefined,
    edgeCount: () => 10,
    _reset: () => undefined,
  };
  const withGraph = scoreEvent(ev, { now: () => NOW, graph: stubGraph });
  assert.ok(withGraph.driverScore > noGraph.driverScore,
    `expected connected(${withGraph.driverScore}) > isolated(${noGraph.driverScore})`);
});

// ── scoreEvents batch ──────────────────────────────────────────────────────

test('scoreEvents returns same number of events as input', () => {
  const events = [
    makeEvent({ id: 'b1' }),
    makeEvent({ id: 'b2', domain: 'wildfire' }),
    makeEvent({ id: 'b3', domain: 'aviation' }),
  ];
  const results = scoreEvents(events, { now: () => NOW });
  assert.equal(results.length, 3);
});

test('scoreEvents preserves input order', () => {
  const events = [
    makeEvent({ id: 'first' }),
    makeEvent({ id: 'second' }),
  ];
  const results = scoreEvents(events, { now: () => NOW });
  assert.equal(results[0]!.id, 'first');
  assert.equal(results[1]!.id, 'second');
});
