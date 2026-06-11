// Integration coverage for the Temporal World Store wiring helpers that
// translate renderer observation/situation shapes into EventRecords. Drives the
// real node:sqlite EventStore on a temp DB.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventStore } from '../event-store.mjs';
import {
  appendObservationToEventStore,
  appendSituationToEventStore,
} from '../local-api-server.mjs';

function withStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'evt-wire-'));
  const store = new EventStore({ dbPath: path.join(dir, 'events.db') });
  try {
    return fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('appendObservationToEventStore maps domain, severity label, and entity ids', () => {
  withStore((store) => {
    appendObservationToEventStore(store, {
      id: 'obs-1',
      sourceId: 'usgs',
      domain: 'weather',
      timestamp: Date.parse('2026-06-10T00:00:00.000Z'),
      severity: 'HIGH',
      title: 'Severe storm',
      entityIds: ['place-1', 'place-2'],
    });
    const [row] = store.queryEvents({});
    assert.equal(row.event_type, 'observation');
    assert.equal(row.domain, 'weather');
    assert.equal(row.source_id, 'usgs');
    assert.equal(row.severity, 0.85);
    assert.equal(row.occurred_at, '2026-06-10T00:00:00.000Z');
    assert.deepEqual(JSON.parse(row.entity_ids), ['place-1', 'place-2']);
    assert.equal(JSON.parse(row.payload).title, 'Severe storm');
  });
});

test('appendObservationToEventStore tolerates a missing timestamp', () => {
  withStore((store) => {
    appendObservationToEventStore(store, { id: 'o', domain: 'cyber', severity: 'INFO' });
    const [row] = store.queryEvents({});
    assert.equal(row.event_type, 'observation');
    assert.ok(row.occurred_at.length > 0);
  });
});

test('appendSituationToEventStore emits situation_created for an active situation', () => {
  withStore((store) => {
    appendSituationToEventStore(store, {
      id: 'sit-1',
      status: 'active',
      severity: 'high',
      domain: 'natural',
      startedAt: Date.parse('2026-06-10T00:00:00.000Z'),
      updatedAt: Date.parse('2026-06-10T00:00:00.000Z'),
      observationIds: ['obs-1'],
      correlationIds: ['cor-1'],
    });
    const [row] = store.queryEvents({});
    assert.equal(row.event_type, 'situation_created');
    assert.equal(row.domain, 'natural');
    assert.equal(row.severity, 0.85);
    assert.deepEqual(JSON.parse(row.entity_ids), ['obs-1', 'cor-1']);
  });
});

test('appendSituationToEventStore emits situation_closed for a resolved situation', () => {
  withStore((store) => {
    appendSituationToEventStore(store, {
      id: 'sit-2',
      status: 'resolved',
      severity: 'medium',
      domain: 'cyber',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const [row] = store.queryEvents({});
    assert.equal(row.event_type, 'situation_closed');
  });
});

test('append helpers no-op (do not throw) when the store is null', () => {
  assert.doesNotThrow(() => appendObservationToEventStore(null, { id: 'x' }));
  assert.doesNotThrow(() => appendSituationToEventStore(null, { id: 'y', status: 'active' }));
});
