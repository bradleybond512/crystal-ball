import assert from 'node:assert/strict';
import test from 'node:test';

import { createPipelineTraceRegistry } from '../pipeline-trace.ts';

// ── Record/get round-trip ───────────────────────────────────────────────

test('record and get: creates entry on first call', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('trace-1', 'weather', { stage: 'ingested', at: 1000 });
  const entry = reg.get('trace-1');
  assert.ok(entry, 'entry must exist');
  assert.equal(entry.traceId, 'trace-1');
  assert.equal(entry.domain, 'weather');
  assert.equal(entry.createdAt, 1000);
  assert.equal(entry.events.length, 1);
  assert.equal(entry.events[0]?.stage, 'ingested');
});

test('record: appends events to existing entry', () => {
  const reg = createPipelineTraceRegistry({ now: () => 2000 });
  reg.record('trace-2', 'shortage', { stage: 'ingested', at: 2000 });
  reg.record('trace-2', 'shortage', { stage: 'scored', at: 2100 });
  const entry = reg.get('trace-2');
  assert.equal(entry?.events.length, 2);
  assert.equal(entry?.events[1]?.stage, 'scored');
});

test('record: defaults at to registry now when omitted', () => {
  const reg = createPipelineTraceRegistry({ now: () => 5000 });
  reg.record('trace-n', 'weather', { stage: 'ingested' });
  const entry = reg.get('trace-n');
  assert.equal(entry?.events[0]?.at, 5000);
});

test('record: a repeated ingestion starts a fresh lifecycle for a stable trace id', () => {
  const reg = createPipelineTraceRegistry();
  reg.record('stable-alert', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('stable-alert', 'weather', { stage: 'routed', at: 1010 });

  reg.record('stable-alert', 'weather', { stage: 'ingested', at: 2000 });

  assert.deepEqual(reg.get('stable-alert'), {
    traceId: 'stable-alert',
    domain: 'weather',
    createdAt: 2000,
    events: [{ stage: 'ingested', at: 2000 }],
  });
});

test('record: consecutive nonterminal ingestions preserve the failure-streak start', () => {
  const reg = createPipelineTraceRegistry();
  reg.record('failing-alert', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('failing-alert', 'weather', { stage: 'evaluated', at: 1010 });

  reg.record('failing-alert', 'weather', { stage: 'ingested', at: 5000 });

  assert.deepEqual(reg.get('failing-alert'), {
    traceId: 'failing-alert',
    domain: 'weather',
    createdAt: 1000,
    events: [{ stage: 'ingested', at: 5000 }],
  });
  assert.deepEqual(reg.stalled(7000, 5000).map((entry) => entry.traceId), ['failing-alert']);
});

test('get: returns undefined for unknown traceId', () => {
  const reg = createPipelineTraceRegistry();
  assert.equal(reg.get('nonexistent'), undefined);
});

// ── FIFO eviction ───────────────────────────────────────────────────────

test('FIFO eviction at cap: oldest entry is dropped first', () => {
  const reg = createPipelineTraceRegistry({ cap: 3, now: () => 100 });
  reg.record('t1', 'w', { stage: 'ingested', at: 100 });
  reg.record('t2', 'w', { stage: 'ingested', at: 101 });
  reg.record('t3', 'w', { stage: 'ingested', at: 102 });
  // Add 4th entry — t1 should be evicted
  reg.record('t4', 'w', { stage: 'ingested', at: 103 });
  assert.equal(reg.get('t1'), undefined, 't1 must be evicted');
  assert.ok(reg.get('t2'), 't2 must still be present');
  assert.ok(reg.get('t4'), 't4 must be present');
});

// ── Stalled entries ─────────────────────────────────────────────────────

test('stalled: returns entries older than staleMs without routed/dropped', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('stale-1', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('ok-1', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('ok-1', 'weather', { stage: 'routed', at: 1010 });

  const stalled = reg.stalled(60_000, 5000); // now=60000, staleMs=5000 → entries created before 55000
  assert.ok(stalled.some(e => e.traceId === 'stale-1'), 'stale-1 must be stalled');
  assert.ok(!stalled.some(e => e.traceId === 'ok-1'), 'ok-1 must not be stalled (has routed event)');
});

test('stalled: dropped entries are not stalled', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('dropped-1', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('dropped-1', 'weather', { stage: 'dropped', at: 1001, reason: 'low priority' });
  const stalled = reg.stalled(60_000, 5000);
  assert.ok(!stalled.some(e => e.traceId === 'dropped-1'), 'dropped entry must not be stalled');
});

test('stalled: a routing failure after an earlier successful lifecycle is visible', () => {
  const reg = createPipelineTraceRegistry();
  reg.record('stable-alert', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('stable-alert', 'weather', { stage: 'routed', at: 1010 });
  reg.record('stable-alert', 'weather', { stage: 'ingested', at: 2000 });

  const stalled = reg.stalled(10_000, 5000);
  assert.deepEqual(stalled.map((entry) => entry.traceId), ['stable-alert']);
});

test('stalled: fresh entries are not stalled', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('fresh-1', 'weather', { stage: 'ingested', at: 1000 });
  // now=5000, staleMs=5000 → cutoff 0; entry at 1000 is after 0
  const stalled = reg.stalled(5000, 5000);
  assert.ok(!stalled.some(e => e.traceId === 'fresh-1'), 'fresh entry must not be stalled');
});

// ── Snapshot ─────────────────────────────────────────────────────────────

test('snapshot: JSON round-trip produces equal values', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('snap-1', 'weather', { stage: 'ingested', at: 1000 });
  reg.record('snap-1', 'weather', { stage: 'scored', at: 1001, detail: { score: 85 } });
  const snap = reg.snapshot();
  const roundTripped = JSON.parse(JSON.stringify(snap)) as typeof snap;
  assert.deepEqual(snap.total, roundTripped.total);
  assert.deepEqual(snap.entries[0]?.events, roundTripped.entries[0]?.events);
});

test('snapshot: total reflects current count', () => {
  const reg = createPipelineTraceRegistry({ now: () => 1000 });
  reg.record('a', 'x', { stage: 'ingested', at: 1000 });
  reg.record('b', 'x', { stage: 'ingested', at: 1001 });
  assert.equal(reg.snapshot().total, 2);
});
