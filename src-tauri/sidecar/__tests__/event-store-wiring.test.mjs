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
    // title is free-text and intentionally omitted from the stored payload.
    const payload = JSON.parse(row.payload);
    assert.equal(payload.title, undefined);
    assert.equal(payload.domain, 'weather');
    assert.equal(payload.severity, 'HIGH');
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

test('appendObservationToEventStore redacts title and entityName from payload', () => {
  withStore((store) => {
    appendObservationToEventStore(store, {
      id: 'obs-pii',
      sourceId: 'watchlist',
      domain: 'cyber',
      timestamp: Date.now(),
      severity: 'HIGH',
      title: 'Alert for John Doe near home',
      entityName: 'John Doe',
      watchlistMatch: 'home-address',
    });
    const [row] = store.queryEvents({});
    const payload = JSON.parse(row.payload);
    assert.equal(payload.title, undefined, 'title must be omitted');
    assert.equal(payload.entityName, undefined, 'entityName must be omitted');
    assert.equal(payload.watchlistMatch, undefined, 'watchlistMatch must be omitted');
    assert.equal(payload.domain, 'cyber');
  });
});

test('appendObservationToEventStore blurs location coordinates to ~10 km', () => {
  withStore((store) => {
    appendObservationToEventStore(store, {
      id: 'obs-loc',
      domain: 'weather',
      timestamp: Date.now(),
      severity: 'LOW',
      location: { lat: 41.8827, lng: -87.6233, label: 'Chicago' },
    });
    const [row] = store.queryEvents({});
    const { location } = JSON.parse(row.payload);
    assert.ok(location !== null, 'location must be present');
    assert.equal(location.lat, 41.9, 'lat blurred to 1 decimal');
    assert.equal(location.lng, -87.6, 'lng blurred to 1 decimal');
    assert.equal(location.label, 'Chicago', 'non-coord fields pass through');
  });
});

test('appendSituationToEventStore omits summary and description from payload', () => {
  withStore((store) => {
    appendSituationToEventStore(store, {
      id: 'sit-pii',
      status: 'active',
      severity: 'high',
      domain: 'natural',
      summary: 'Flooding near user home at 123 Main St',
      description: 'Personal details here',
      startedAt: Date.now(),
      observationIds: ['obs-1'],
    });
    const [row] = store.queryEvents({});
    const payload = JSON.parse(row.payload);
    assert.equal(payload.summary, undefined, 'summary must be omitted');
    assert.equal(payload.description, undefined, 'description must be omitted');
    assert.equal(payload.domain, 'natural');
    assert.equal(payload.status, 'active');
  });
});

test('append helpers no-op (do not throw) when the store is null', () => {
  assert.doesNotThrow(() => appendObservationToEventStore(null, { id: 'x' }));
  assert.doesNotThrow(() => appendSituationToEventStore(null, { id: 'y', status: 'active' }));
});
