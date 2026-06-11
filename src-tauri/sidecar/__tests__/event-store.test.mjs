// Direct unit coverage for the node:sqlite EventStore — the behaviors a
// cross-agent (Codex) review flagged as blocking: append-only enforcement,
// LIKE-wildcard escaping in the entityId filter, and a source_id index.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventStore } from '../event-store.mjs';

function withStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'evt-store-'));
  const store = new EventStore({ dbPath: path.join(dir, 'events.db') });
  try {
    return fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseEvent(overrides = {}) {
  return {
    id: 'evt-1',
    event_type: 'observation',
    occurred_at: '2026-06-10T00:00:00.000Z',
    domain: 'weather',
    entity_ids: JSON.stringify(['abc']),
    source_id: 'nws',
    severity: 0.7,
    payload: JSON.stringify({ title: 'original' }),
    ...overrides,
  };
}

test('append-only: a duplicate event id throws and preserves the original row', () => {
  withStore((store) => {
    store.appendEvent(baseEvent());
    assert.throws(
      () => store.appendEvent(baseEvent({ payload: JSON.stringify({ title: 'overwrite' }) })),
      /id/i,
      'appending an existing id must fail closed, not silently replace',
    );
    const [row] = store.queryEvents({});
    assert.equal(JSON.parse(row.payload).title, 'original', 'original row must be untouched');
    assert.equal(store.getEventCount({}), 1);
  });
});

test('entityIds filter treats a LIKE underscore as a literal, not a wildcard', () => {
  withStore((store) => {
    // entity_ids stores ["abc"]; an unescaped LIKE pattern "a_c" matches "abc".
    store.appendEvent(baseEvent({ entity_ids: JSON.stringify(['abc']) }));
    const rows = store.queryEvents({ entityIds: ['a_c'] });
    assert.equal(rows.length, 0, 'underscore must not act as a single-char wildcard');
  });
});

test('entityIds filter treats a LIKE percent as a literal, not a wildcard', () => {
  withStore((store) => {
    store.appendEvent(baseEvent({ entity_ids: JSON.stringify(['alpha-beta']) }));
    const rows = store.queryEvents({ entityIds: ['alpha%'] });
    assert.equal(rows.length, 0, 'percent must not act as a multi-char wildcard');
  });
});

test('entityIds filter still matches an exact id containing no metachars', () => {
  withStore((store) => {
    store.appendEvent(baseEvent({ entity_ids: JSON.stringify(['place-1', 'place-2']) }));
    assert.equal(store.queryEvents({ entityIds: ['place-2'] }).length, 1);
    assert.equal(store.queryEvents({ entityIds: ['place-9'] }).length, 0);
  });
});

test('schema declares an index on source_id so sourceId queries are not table scans', () => {
  withStore((store) => {
    const indexes = store.db.prepare('PRAGMA index_list(events)').all().map((r) => String(r.name));
    assert.ok(
      indexes.some((n) => n.includes('source')),
      `expected a source_id index, got: ${indexes.join(', ')}`,
    );
    // and it still returns correct rows
    store.appendEvent(baseEvent({ id: 'e-a', source_id: 'nws' }));
    store.appendEvent(baseEvent({ id: 'e-b', source_id: 'usgs' }));
    assert.equal(store.queryEvents({ sourceId: 'usgs' }).length, 1);
  });
});

test('pruneOlderThan deletes only events older than the cutoff', () => {
  withStore((store) => {
    store.appendEvent(baseEvent({ id: 'old', occurred_at: '2026-01-01T00:00:00.000Z' }));
    store.appendEvent(baseEvent({ id: 'new', occurred_at: '2026-06-01T00:00:00.000Z' }));
    const removed = store.pruneOlderThan(3, '2026-06-10T00:00:00.000Z');
    assert.equal(removed, 1);
    const ids = store.queryEvents({}).map((r) => r.id);
    assert.deepEqual(ids, ['new']);
  });
});
