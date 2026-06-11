import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EVENT_TYPES,
  isValidEventType,
  partitionKeyForTimestamp,
  retentionCutoffISO,
  severityLabelToScore,
  normalizeEventInput,
  parseEntityIds,
  parsePayloadSafe,
  filterEventsInMemory,
  countEventsInMemory,
  formatBytes,
  buildDomainBars,
  summarizeHealth,
  type EventRecord,
} from '../event-store-helpers.ts';

// The real SQLite store ships in the sidecar; the .mts test drives it directly
// so WAL / prune / partitioning are proven against an actual node:sqlite DB.
import { EventStore } from '../../../src-tauri/sidecar/event-store.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────

describe('EVENT_TYPES + isValidEventType', () => {
  it('exposes the six canonical event types', () => {
    assert.deepEqual([...EVENT_TYPES].sort(), [
      'alert_fired',
      'observation',
      'score_updated',
      'situation_closed',
      'situation_created',
      'situation_updated',
    ]);
  });

  it('accepts each canonical type', () => {
    for (const t of EVENT_TYPES) assert.equal(isValidEventType(t), true);
  });

  it('rejects unknown / non-string types', () => {
    assert.equal(isValidEventType('nope'), false);
    assert.equal(isValidEventType(''), false);
    assert.equal(isValidEventType(null), false);
    assert.equal(isValidEventType(42), false);
  });
});

describe('partitionKeyForTimestamp', () => {
  it('derives YYYY-MM from an ISO timestamp', () => {
    assert.equal(partitionKeyForTimestamp('2026-06-10T14:00:00.000Z'), '2026-06');
  });

  it('uses UTC month boundaries', () => {
    assert.equal(partitionKeyForTimestamp('2026-01-31T23:59:59Z'), '2026-01');
    assert.equal(partitionKeyForTimestamp('2026-02-01T00:00:00Z'), '2026-02');
  });

  it('pads single-digit months', () => {
    assert.equal(partitionKeyForTimestamp('2026-03-05T00:00:00Z'), '2026-03');
  });

  it('throws on an unparseable timestamp', () => {
    assert.throws(() => partitionKeyForTimestamp('not-a-date'));
  });
});

describe('retentionCutoffISO', () => {
  it('subtracts the given months from now', () => {
    const cutoff = retentionCutoffISO(3, '2026-06-10T00:00:00.000Z');
    assert.equal(cutoff, '2026-03-10T00:00:00.000Z');
  });

  it('handles year rollover', () => {
    const cutoff = retentionCutoffISO(6, '2026-02-15T00:00:00.000Z');
    assert.equal(cutoff.slice(0, 7), '2025-08');
  });

  it('accepts a Date instance', () => {
    const cutoff = retentionCutoffISO(1, new Date('2026-06-10T00:00:00.000Z'));
    assert.equal(cutoff.slice(0, 7), '2026-05');
  });
});

describe('severityLabelToScore', () => {
  it('maps the NWS-style ladder to 0-1 scores', () => {
    assert.equal(severityLabelToScore('CRITICAL'), 0.95);
    assert.equal(severityLabelToScore('HIGH'), 0.85);
    assert.equal(severityLabelToScore('MEDIUM'), 0.7);
    assert.equal(severityLabelToScore('LOW'), 0.55);
    assert.equal(severityLabelToScore('INFO'), 0.4);
  });

  it('is case-insensitive', () => {
    assert.equal(severityLabelToScore('critical'), 0.95);
  });

  it('returns null for unknown labels', () => {
    assert.equal(severityLabelToScore('whatever'), null);
    assert.equal(severityLabelToScore(''), null);
  });
});

describe('normalizeEventInput', () => {
  const now = '2026-06-10T12:00:00.000Z';

  it('fills id, occurred_at, partition_key, and stringifies entity_ids', () => {
    const rec = normalizeEventInput(
      { event_type: 'observation', domain: 'cyber', entityIds: ['cve-1', 'cve-2'], payload: { x: 1 } },
      { id: 'fixed-id', now },
    );
    assert.equal(rec.id, 'fixed-id');
    assert.equal(rec.event_type, 'observation');
    assert.equal(rec.occurred_at, now);
    assert.equal(rec.domain, 'cyber');
    assert.equal(rec.entity_ids, JSON.stringify(['cve-1', 'cve-2']));
    assert.equal(rec.partition_key, '2026-06');
    assert.equal(rec.payload, JSON.stringify({ x: 1 }));
  });

  it('prefers an explicit occurred_at over now', () => {
    const rec = normalizeEventInput(
      { event_type: 'alert_fired', occurred_at: '2025-12-01T00:00:00Z', payload: {} },
      { id: 'a', now },
    );
    assert.equal(rec.occurred_at, '2025-12-01T00:00:00Z');
    assert.equal(rec.partition_key, '2025-12');
  });

  it('accepts an already-stringified payload as-is', () => {
    const rec = normalizeEventInput(
      { event_type: 'observation', payload: '{"already":"json"}' },
      { id: 'a', now },
    );
    assert.equal(rec.payload, '{"already":"json"}');
  });

  it('defaults domain, source_id, severity, entity_ids', () => {
    const rec = normalizeEventInput({ event_type: 'observation', payload: {} }, { id: 'a', now });
    assert.equal(rec.domain, null);
    assert.equal(rec.source_id, null);
    assert.equal(rec.severity, null);
    assert.equal(rec.entity_ids, '[]');
  });

  it('maps a string severity label to a score', () => {
    const rec = normalizeEventInput(
      { event_type: 'observation', severity: 'HIGH', payload: {} },
      { id: 'a', now },
    );
    assert.equal(rec.severity, 0.85);
  });

  it('clamps a numeric severity into 0-1', () => {
    assert.equal(
      normalizeEventInput({ event_type: 'observation', severity: 1.7, payload: {} }, { id: 'a', now }).severity,
      1,
    );
    assert.equal(
      normalizeEventInput({ event_type: 'observation', severity: -3, payload: {} }, { id: 'a', now }).severity,
      0,
    );
  });

  it('reads sourceId or source_id', () => {
    assert.equal(
      normalizeEventInput({ event_type: 'observation', sourceId: 'feed-a', payload: {} }, { id: 'a', now }).source_id,
      'feed-a',
    );
    assert.equal(
      normalizeEventInput({ event_type: 'observation', source_id: 'feed-b', payload: {} }, { id: 'a', now }).source_id,
      'feed-b',
    );
  });

  it('throws on an invalid event_type', () => {
    assert.throws(() => normalizeEventInput({ event_type: 'bogus', payload: {} }, { id: 'a', now }));
  });

  it('throws when payload is missing', () => {
    assert.throws(() => normalizeEventInput({ event_type: 'observation' }, { id: 'a', now }));
  });
});

describe('parseEntityIds', () => {
  it('parses a JSON array string', () => {
    assert.deepEqual(parseEntityIds('["a","b"]'), ['a', 'b']);
  });

  it('returns [] for malformed or empty input', () => {
    assert.deepEqual(parseEntityIds('not json'), []);
    assert.deepEqual(parseEntityIds(''), []);
    assert.deepEqual(parseEntityIds('{"not":"array"}'), []);
  });
});

describe('parsePayloadSafe', () => {
  it('parses valid JSON', () => {
    assert.deepEqual(parsePayloadSafe('{"a":1}'), { ok: true, value: { a: 1 } });
  });

  it('handles malformed JSON without throwing', () => {
    const res = parsePayloadSafe('{bad json');
    assert.equal(res.ok, false);
  });

  it('handles non-string input without throwing', () => {
    const res = parsePayloadSafe(undefined as unknown as string);
    assert.equal(res.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// In-memory filter mirror (documents the SQL query semantics)
// ─────────────────────────────────────────────────────────────────────────

function rec(over: Partial<EventRecord>): EventRecord {
  return {
    id: over.id ?? 'id',
    event_type: over.event_type ?? 'observation',
    occurred_at: over.occurred_at ?? '2026-06-10T00:00:00.000Z',
    domain: over.domain ?? 'cyber',
    entity_ids: over.entity_ids ?? '[]',
    source_id: over.source_id ?? 'src',
    severity: over.severity ?? null,
    payload: over.payload ?? '{}',
    partition_key: over.partition_key ?? '2026-06',
  };
}

describe('filterEventsInMemory', () => {
  const events: EventRecord[] = [
    rec({ id: '1', occurred_at: '2026-06-01T00:00:00Z', domain: 'cyber', event_type: 'observation', source_id: 'a', entity_ids: '["x"]' }),
    rec({ id: '2', occurred_at: '2026-06-05T00:00:00Z', domain: 'weather', event_type: 'alert_fired', source_id: 'b', entity_ids: '["y"]' }),
    rec({ id: '3', occurred_at: '2026-06-10T00:00:00Z', domain: 'cyber', event_type: 'situation_created', source_id: 'a', entity_ids: '["x","z"]' }),
  ];

  it('returns all events (newest first) for empty opts', () => {
    const out = filterEventsInMemory(events, {});
    assert.deepEqual(out.map((e) => e.id), ['3', '2', '1']);
  });

  it('filters by from (inclusive)', () => {
    const out = filterEventsInMemory(events, { from: '2026-06-05T00:00:00Z' });
    assert.deepEqual(out.map((e) => e.id), ['3', '2']);
  });

  it('filters by to (inclusive)', () => {
    const out = filterEventsInMemory(events, { to: '2026-06-05T00:00:00Z' });
    assert.deepEqual(out.map((e) => e.id), ['2', '1']);
  });

  it('filters by from + to range', () => {
    const out = filterEventsInMemory(events, { from: '2026-06-02T00:00:00Z', to: '2026-06-09T00:00:00Z' });
    assert.deepEqual(out.map((e) => e.id), ['2']);
  });

  it('filters by domain', () => {
    const out = filterEventsInMemory(events, { domain: 'cyber' });
    assert.deepEqual(out.map((e) => e.id), ['3', '1']);
  });

  it('filters by eventTypes', () => {
    const out = filterEventsInMemory(events, { eventTypes: ['alert_fired', 'situation_created'] });
    assert.deepEqual(out.map((e) => e.id), ['3', '2']);
  });

  it('filters by entityIds overlap', () => {
    const out = filterEventsInMemory(events, { entityIds: ['x'] });
    assert.deepEqual(out.map((e) => e.id), ['3', '1']);
  });

  it('filters by sourceId', () => {
    const out = filterEventsInMemory(events, { sourceId: 'b' });
    assert.deepEqual(out.map((e) => e.id), ['2']);
  });

  it('applies limit', () => {
    assert.equal(filterEventsInMemory(events, { limit: 2 }).length, 2);
  });

  it('applies offset', () => {
    const out = filterEventsInMemory(events, { offset: 1 });
    assert.deepEqual(out.map((e) => e.id), ['2', '1']);
  });

  it('combines filters', () => {
    const out = filterEventsInMemory(events, { domain: 'cyber', entityIds: ['z'] });
    assert.deepEqual(out.map((e) => e.id), ['3']);
  });
});

describe('countEventsInMemory', () => {
  const events: EventRecord[] = [
    rec({ id: '1', domain: 'cyber', occurred_at: '2026-06-01T00:00:00Z' }),
    rec({ id: '2', domain: 'weather', occurred_at: '2026-06-05T00:00:00Z' }),
  ];
  it('counts all with no opts', () => assert.equal(countEventsInMemory(events), 2));
  it('counts by domain', () => assert.equal(countEventsInMemory(events, { domain: 'cyber' }), 1));
  it('ignores limit/offset (count is total matched)', () =>
    assert.equal(countEventsInMemory(events, { limit: 1 }), 2));
});

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers (panel)
// ─────────────────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats common magnitudes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(1048576), '1.0 MB');
  });
});

describe('buildDomainBars', () => {
  it('sorts descending and computes percentages', () => {
    const bars = buildDomainBars({ cyber: 3, weather: 1 });
    assert.deepEqual(bars.map((b) => b.domain), ['cyber', 'weather']);
    assert.equal(bars[0].pct, 75);
    assert.equal(bars[1].pct, 25);
  });
  it('handles an empty map', () => assert.deepEqual(buildDomainBars({}), []));
});

describe('summarizeHealth', () => {
  it('passes through with safe defaults', () => {
    const s = summarizeHealth({ totalEvents: 5, oldestEvent: 'a', latestEvent: 'b', dbSizeBytes: 1024, partitions: ['2026-06'] });
    assert.equal(s.totalEvents, 5);
    assert.equal(s.dbSizeLabel, '1.0 KB');
    assert.deepEqual(s.partitions, ['2026-06']);
  });
  it('tolerates a null/empty health object', () => {
    const s = summarizeHealth(null);
    assert.equal(s.totalEvents, 0);
    assert.deepEqual(s.partitions, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Real EventStore (node:sqlite, temp DB)
// ─────────────────────────────────────────────────────────────────────────

describe('EventStore (node:sqlite)', () => {
  let dir: string;
  let store: InstanceType<typeof EventStore>;

  function mk(over: Record<string, unknown> = {}): EventRecord {
    return normalizeEventInput(
      {
        event_type: 'observation',
        domain: 'cyber',
        payload: { hello: 'world' },
        ...over,
      },
      { id: (over.id as string) ?? `id-${Math.random().toString(36).slice(2)}`, now: '2026-06-10T00:00:00.000Z' },
    );
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'evt-store-'));
  });
  after(() => {
    try { store?.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    try { store?.close(); } catch { /* ignore */ }
    store = new EventStore({ dbPath: join(dir, `db-${Math.random().toString(36).slice(2)}.db`) });
  });

  it('creates the db file and enables WAL', () => {
    assert.equal(store.journalMode(), 'wal');
  });

  it('appends and retrieves a single event', () => {
    const e = mk({ id: 'solo' });
    store.appendEvent(e);
    const out = store.queryEvents({});
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'solo');
    assert.equal(out[0].payload, JSON.stringify({ hello: 'world' }));
  });

  it('persists partition_key correctly', () => {
    store.appendEvent(mk({ id: 'p1', occurred_at: '2026-04-15T00:00:00Z' }));
    const [row] = store.queryEvents({});
    assert.equal(row.partition_key, '2026-04');
  });

  it('returns events newest-first up to the default limit', () => {
    store.appendEvent(mk({ id: 'old', occurred_at: '2026-06-01T00:00:00Z' }));
    store.appendEvent(mk({ id: 'new', occurred_at: '2026-06-09T00:00:00Z' }));
    const out = store.queryEvents({});
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['new', 'old']);
  });

  it('filters by date range', () => {
    store.appendEvent(mk({ id: 'a', occurred_at: '2026-06-01T00:00:00Z' }));
    store.appendEvent(mk({ id: 'b', occurred_at: '2026-06-05T00:00:00Z' }));
    store.appendEvent(mk({ id: 'c', occurred_at: '2026-06-10T00:00:00Z' }));
    const out = store.queryEvents({ from: '2026-06-03T00:00:00Z', to: '2026-06-07T00:00:00Z' });
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['b']);
  });

  it('filters by domain', () => {
    store.appendEvent(mk({ id: 'a', domain: 'cyber' }));
    store.appendEvent(mk({ id: 'b', domain: 'weather' }));
    const out = store.queryEvents({ domain: 'weather' });
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['b']);
  });

  it('filters by eventTypes', () => {
    store.appendEvent(mk({ id: 'a', event_type: 'observation' }));
    store.appendEvent(mk({ id: 'b', event_type: 'alert_fired' }));
    const out = store.queryEvents({ eventTypes: ['alert_fired'] });
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['b']);
  });

  it('filters by entityIds overlap', () => {
    store.appendEvent(mk({ id: 'a', entityIds: ['x', 'y'] }));
    store.appendEvent(mk({ id: 'b', entityIds: ['z'] }));
    const out = store.queryEvents({ entityIds: ['y'] });
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['a']);
  });

  it('filters by sourceId', () => {
    store.appendEvent(mk({ id: 'a', sourceId: 'feed-1' }));
    store.appendEvent(mk({ id: 'b', sourceId: 'feed-2' }));
    const out = store.queryEvents({ sourceId: 'feed-1' });
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['a']);
  });

  it('applies limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.appendEvent(mk({ id: `e${i}`, occurred_at: `2026-06-0${i + 1}T00:00:00Z` }));
    }
    const page = store.queryEvents({ limit: 2, offset: 1 });
    assert.equal(page.length, 2);
    // newest-first: e4, e3, e2, e1, e0 → offset 1 → e3, e2
    assert.deepEqual(page.map((e: EventRecord) => e.id), ['e3', 'e2']);
  });

  it('counts all events with no filter', () => {
    store.appendEvent(mk());
    store.appendEvent(mk());
    assert.equal(store.getEventCount(), 2);
  });

  it('counts with a domain filter', () => {
    store.appendEvent(mk({ domain: 'cyber' }));
    store.appendEvent(mk({ domain: 'weather' }));
    store.appendEvent(mk({ domain: 'cyber' }));
    assert.equal(store.getEventCount({ domain: 'cyber' }), 2);
  });

  it('counts with a date filter', () => {
    store.appendEvent(mk({ occurred_at: '2026-05-01T00:00:00Z' }));
    store.appendEvent(mk({ occurred_at: '2026-06-01T00:00:00Z' }));
    assert.equal(store.getEventCount({ from: '2026-05-15T00:00:00Z' }), 1);
  });

  it('pruneOlderThan removes old rows and returns the deleted count', () => {
    store.appendEvent(mk({ id: 'old', occurred_at: '2026-01-01T00:00:00Z' }));
    store.appendEvent(mk({ id: 'recent', occurred_at: '2026-06-09T00:00:00Z' }));
    const deleted = store.pruneOlderThan(3, '2026-06-10T00:00:00.000Z');
    assert.equal(deleted, 1);
    const out = store.queryEvents({});
    assert.deepEqual(out.map((e: EventRecord) => e.id), ['recent']);
  });

  it('pruneOlderThan keeps everything when nothing is stale', () => {
    store.appendEvent(mk({ id: 'recent', occurred_at: '2026-06-09T00:00:00Z' }));
    assert.equal(store.pruneOlderThan(3, '2026-06-10T00:00:00.000Z'), 0);
    assert.equal(store.getEventCount(), 1);
  });

  it('preserves all rows across a rapid append burst (WAL)', () => {
    for (let i = 0; i < 200; i++) {
      store.appendEvent(mk({ id: `burst-${i}`, occurred_at: `2026-06-10T00:00:${String(i % 60).padStart(2, '0')}.000Z` }));
    }
    assert.equal(store.getEventCount(), 200);
  });

  it('stores and returns a malformed JSON payload without crashing', () => {
    const e = mk({ id: 'bad', payload: '{not valid json' });
    store.appendEvent(e);
    const [row] = store.queryEvents({});
    assert.equal(row.payload, '{not valid json');
    assert.equal(parsePayloadSafe(row.payload).ok, false);
  });

  it('reports health: totals, oldest/latest, size, partitions', () => {
    store.appendEvent(mk({ id: 'a', occurred_at: '2026-04-01T00:00:00.000Z' }));
    store.appendEvent(mk({ id: 'b', occurred_at: '2026-06-01T00:00:00.000Z' }));
    const h = store.health();
    assert.equal(h.totalEvents, 2);
    assert.equal(h.oldestEvent, '2026-04-01T00:00:00.000Z');
    assert.equal(h.latestEvent, '2026-06-01T00:00:00.000Z');
    assert.ok(h.dbSizeBytes >= 0);
    assert.deepEqual([...h.partitions].sort(), ['2026-04', '2026-06']);
  });

  it('breaks down counts by domain in health', () => {
    store.appendEvent(mk({ id: 'c1', domain: 'cyber' }));
    store.appendEvent(mk({ id: 'c2', domain: 'cyber' }));
    store.appendEvent(mk({ id: 'w1', domain: 'weather' }));
    const h = store.health();
    assert.equal(h.byDomain.cyber, 2);
    assert.equal(h.byDomain.weather, 1);
  });

  it('reports empty health for a fresh store', () => {
    const h = store.health();
    assert.equal(h.totalEvents, 0);
    assert.equal(h.oldestEvent, null);
    assert.equal(h.latestEvent, null);
    assert.deepEqual(h.partitions, []);
    assert.deepEqual(h.byDomain, {});
  });

  it('rejects an event with an invalid type at append time', () => {
    assert.throws(() => store.appendEvent({ ...mk(), event_type: 'bogus' } as EventRecord));
  });

  it('persists across reopen of the same db file', () => {
    const p = join(dir, 'persist.db');
    const s1 = new EventStore({ dbPath: p });
    s1.appendEvent(mk({ id: 'persisted' }));
    s1.close();
    const s2 = new EventStore({ dbPath: p });
    assert.equal(s2.getEventCount(), 1);
    s2.close();
  });
});
