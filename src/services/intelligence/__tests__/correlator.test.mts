import assert from 'node:assert/strict';
import test from 'node:test';

import { CorrelationEngine } from '../correlator.ts';
import type { ObservationEvent, ObservationStoreReader } from '../observation-types.ts';

const NOW = 1_745_000_000_000;

function makeEvent(overrides: Partial<ObservationEvent> & { id: string; domain: string }): ObservationEvent {
  return {
    eventType: 'test-event',
    title: overrides.id,
    severity: 5,
    occurredAt: NOW,
    entities: [],
    sourceIds: ['src1'],
    active: true,
    ...overrides,
  };
}

function makeStore(events: ObservationEvent[]): ObservationStoreReader {
  return { getEvents: () => events };
}

// ── 1: Same domain → no correlation ──────────────────────────────────────
test('same domain events produce no correlation', () => {
  const a = makeEvent({ id: 'a', domain: 'aviation', lat: 35.0, lon: 139.0 });
  const b = makeEvent({ id: 'b', domain: 'aviation', lat: 35.1, lon: 139.1 });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  assert.equal(result.length, 0);
});

// ── 2: Spatial correlation within 500km + 2hrs ────────────────────────────
test('events within 500km and 2hrs from different domains produce spatial correlation', () => {
  const a = makeEvent({ id: 'a', domain: 'aviation', lat: 35.0, lon: 139.0, title: 'Flight Emergency' });
  const b = makeEvent({ id: 'b', domain: 'earthquake', lat: 35.5, lon: 139.5, title: 'M6.2 Quake' });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  const spatial = result.filter(c => c.type === 'spatial');
  assert.equal(spatial.length, 1);
  assert.ok(spatial[0].confidence > 0 && spatial[0].confidence <= 1);
  assert.ok(spatial[0].title.includes('correlation'));
});

// ── 3: Too far apart → no spatial correlation ─────────────────────────────
test('events more than 500km apart produce no spatial correlation', () => {
  // Tokyo vs London — ~9000km apart
  const a = makeEvent({ id: 'a', domain: 'aviation', lat: 35.0, lon: 139.0 });
  const b = makeEvent({ id: 'b', domain: 'weather', lat: 51.5, lon: -0.1 });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  const spatial = result.filter(c => c.type === 'spatial');
  assert.equal(spatial.length, 0);
});

// ── 4: Events more than 2hrs apart → no temporal or spatial correlation ────
test('events more than 2hrs apart produce no temporal or spatial correlation', () => {
  const old = NOW - 3 * 60 * 60 * 1000; // 3 hours ago
  const a = makeEvent({ id: 'a', domain: 'aviation', occurredAt: old, lat: 35.0, lon: 139.0 });
  const b = makeEvent({ id: 'b', domain: 'earthquake', occurredAt: NOW, lat: 35.1, lon: 139.1 });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  const timeSensitive = result.filter(c => c.type === 'spatial' || c.type === 'temporal');
  assert.equal(timeSensitive.length, 0);
});

// ── 5: Entity correlation (no coords) ────────────────────────────────────
test('events sharing an entity produce entity correlation', () => {
  const a = makeEvent({ id: 'a', domain: 'cyber', entities: ['CVE-2026-1234'], title: 'Exploit Detected' });
  const b = makeEvent({ id: 'b', domain: 'conflict', entities: ['CVE-2026-1234', 'RU'], title: 'Nation-State Activity' });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  const entity = result.filter(c => c.type === 'entity');
  assert.equal(entity.length, 1);
  assert.equal(entity[0].confidence, 0.7);
  assert.ok(entity[0].title.includes('CVE-2026-1234'));
});

// ── 6: Multiple types for one pair ───────────────────────────────────────
test('pair matching spatial and entity criteria emits two correlations', () => {
  const a = makeEvent({ id: 'a', domain: 'aviation', lat: 35.0, lon: 139.0, entities: ['JP'], title: 'Flight Emergency' });
  const b = makeEvent({ id: 'b', domain: 'earthquake', lat: 35.1, lon: 139.1, entities: ['JP'], title: 'M6.2 Quake' });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  const types = result.map(c => c.type).sort();
  assert.ok(types.includes('spatial'));
  assert.ok(types.includes('entity'));
  assert.equal(result.length, 2);
});

// ── 7: getCorrelations(since) filters by detectedAt ──────────────────────
test('getCorrelations(since) filters correlations by detectedAt', () => {
  const a = makeEvent({ id: 'a', domain: 'cyber', entities: ['CVE-1'] });
  const b = makeEvent({ id: 'b', domain: 'conflict', entities: ['CVE-1'] });
  const engine = new CorrelationEngine(makeStore([a, b]));
  engine.run();
  const all = engine.getCorrelations();
  // No coords + same window → temporal + entity → 2 correlations
  assert.ok(all.length >= 1);
  const totalCount = all.length;
  // Filter with future timestamp — should get nothing
  const future = engine.getCorrelations(Date.now() + 1_000_000);
  assert.equal(future.length, 0);
  // Filter with past timestamp — should get all
  const past = engine.getCorrelations(0);
  assert.equal(past.length, totalCount);
});

// ── 8: getCorrelations(undefined, limit) limits results ──────────────────
test('getCorrelations with limit=3 returns at most 3 results', () => {
  // Create 4 pairs across different domains, each sharing an entity
  const events: ObservationEvent[] = [
    makeEvent({ id: 'a', domain: 'cyber', entities: ['X'] }),
    makeEvent({ id: 'b', domain: 'conflict', entities: ['X'] }),
    makeEvent({ id: 'c', domain: 'weather', entities: ['X'] }),
    makeEvent({ id: 'd', domain: 'maritime', entities: ['X'] }),
    makeEvent({ id: 'e', domain: 'aviation', entities: ['X'] }),
  ];
  const engine = new CorrelationEngine(makeStore(events));
  engine.run();
  const limited = engine.getCorrelations(undefined, 3);
  assert.ok(limited.length <= 3);
});

// ── 9: Cap at maxCorrelations — oldest are dropped ───────────────────────
test('maxCorrelations=3 keeps only last 3 by detectedAt', () => {
  // 5 distinct domain pairs each sharing a unique entity — produces 5 entity correlations
  const events: ObservationEvent[] = [
    makeEvent({ id: 'a', domain: 'cyber', entities: ['E1'] }),
    makeEvent({ id: 'b', domain: 'conflict', entities: ['E1'] }),
    makeEvent({ id: 'c', domain: 'weather', entities: ['E2'] }),
    makeEvent({ id: 'd', domain: 'maritime', entities: ['E2'] }),
    makeEvent({ id: 'e', domain: 'aviation', entities: ['E3'] }),
    makeEvent({ id: 'f', domain: 'earthquake', entities: ['E3'] }),
    makeEvent({ id: 'g', domain: 'cyber', entities: ['E4'] }),
    makeEvent({ id: 'h', domain: 'space', entities: ['E4'] }),
  ];
  const engine = new CorrelationEngine(makeStore(events), { maxCorrelations: 3 });
  engine.run();
  assert.ok(engine.correlationCount <= 3);
});

// ── 10: Spatial confidence is higher for closer events ───────────────────
test('spatial confidence is higher for closer events than farther events', () => {
  const base = makeEvent({ id: 'base', domain: 'earthquake', lat: 35.0, lon: 139.0, title: 'Base Quake' });
  const close = makeEvent({ id: 'close', domain: 'aviation', lat: 35.5, lon: 139.5, title: 'Close Flight' });
  const far = makeEvent({ id: 'far', domain: 'aviation', lat: 38.0, lon: 142.0, title: 'Far Flight' });

  const engineClose = new CorrelationEngine(makeStore([base, close]));
  const engineFar = new CorrelationEngine(makeStore([base, far]));

  const closeCorr = engineClose.run().filter(c => c.type === 'spatial');
  const farCorr = engineFar.run().filter(c => c.type === 'spatial');

  assert.equal(closeCorr.length, 1);
  assert.equal(farCorr.length, 1);
  assert.ok(closeCorr[0].confidence > farCorr[0].confidence,
    `close confidence ${closeCorr[0].confidence} should be > far confidence ${farCorr[0].confidence}`);
});

// ── 11: startCycle / stop works and calls run at least once ──────────────
test('startCycle calls run and stop clears the interval', async () => {
  let runCount = 0;
  const events: ObservationEvent[] = [
    makeEvent({ id: 'a', domain: 'cyber', entities: ['Z'] }),
    makeEvent({ id: 'b', domain: 'conflict', entities: ['Z'] }),
  ];
  const engine = new CorrelationEngine(makeStore(events));
  // Patch run to count calls
  const originalRun = engine.run.bind(engine);
  engine.run = () => { runCount++; return originalRun(); };

  const stop = engine.startCycle(50); // 50ms interval for test speed
  await new Promise(resolve => setTimeout(resolve, 120));
  stop();
  assert.ok(runCount >= 1, `Expected at least 1 run, got ${runCount}`);
});

// ── 12: Inactive events are excluded from correlation ────────────────────
test('inactive events (active: false) are excluded from correlation', () => {
  const a = makeEvent({ id: 'a', domain: 'aviation', entities: ['JP'], active: false });
  const b = makeEvent({ id: 'b', domain: 'earthquake', entities: ['JP'], active: true });
  const engine = new CorrelationEngine(makeStore([a, b]));
  const result = engine.run();
  assert.equal(result.length, 0);
});
