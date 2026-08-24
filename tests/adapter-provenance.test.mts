import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getEarthquakeSuccessfulUpdate,
  getFredSuccessfulUpdate,
  getOldestValidTimestamp,
  getRssSuccessfulUpdate,
  getSidecarDataState,
  summarizeRssFeedStates,
} from '../src/services/adapter-provenance.ts';
import { parseGDACSResponse } from '../src/services/gdacs.ts';
import { parseEarthquakeResponse } from '../src/services/earthquakes.ts';

const LIVE_AT = 1_756_000_000_000;
const CACHED_AT = LIVE_AT - 60_000;

test('USGS freshness requires both a live outer fetch and live breaker provenance', () => {
  const earthquakes = [{ id: 'eq-1' }];
  assert.equal(getEarthquakeSuccessfulUpdate({
    earthquakes,
    dataState: { mode: 'cached', timestamp: CACHED_AT, offline: false },
  }, true), null);
  assert.equal(getEarthquakeSuccessfulUpdate({
    earthquakes,
    dataState: { mode: 'live', timestamp: LIVE_AT, offline: false },
  }, false), null);
  assert.deepEqual(getEarthquakeSuccessfulUpdate({
    earthquakes,
    dataState: { mode: 'live', timestamp: LIVE_AT, offline: false },
  }, true), { itemCount: 1, updatedAt: LIVE_AT });
});

test('USGS rejects a successful response without an earthquakes array', () => {
  assert.throws(() => parseEarthquakeResponse({ ok: true }), /earthquakes/i);
  assert.deepEqual(parseEarthquakeResponse({ earthquakes: [] }), { earthquakes: [] });
});

test('RSS aggregate provenance is live only when every requested feed was live', () => {
  assert.deepEqual(summarizeRssFeedStates([
    { mode: 'live', timestamp: LIVE_AT, offline: false },
    { mode: 'live', timestamp: LIVE_AT + 1, offline: false },
  ]), { mode: 'live', timestamp: LIVE_AT, offline: false });
  assert.deepEqual(summarizeRssFeedStates([
    { mode: 'live', timestamp: LIVE_AT, offline: false },
    { mode: 'cached', timestamp: CACHED_AT, offline: false },
  ]), { mode: 'cached', timestamp: CACHED_AT, offline: false });
  assert.deepEqual(summarizeRssFeedStates([
    { mode: 'live', timestamp: LIVE_AT, offline: false },
    { mode: 'unavailable', timestamp: null, offline: false },
  ]), { mode: 'unavailable', timestamp: LIVE_AT, offline: false });
});

test('RSS freshness cannot be restored by a later live category after any fallback', () => {
  assert.equal(getRssSuccessfulUpdate([
    { itemCount: 4, dataState: { mode: 'cached', timestamp: CACHED_AT, offline: false } },
    { itemCount: 7, dataState: { mode: 'live', timestamp: LIVE_AT, offline: false } },
  ]), null);
  assert.deepEqual(getRssSuccessfulUpdate([
    { itemCount: 4, dataState: { mode: 'live', timestamp: LIVE_AT, offline: false } },
    { itemCount: 7, dataState: { mode: 'live', timestamp: LIVE_AT + 1, offline: false } },
  ]), { itemCount: 11, updatedAt: LIVE_AT });
});

test('FRED freshness rejects cached breaker output even when the outer request resolved', () => {
  const data = [{
    id: 'FEDFUNDS', name: 'Fed Funds Rate', value: 5, previousValue: 5,
    change: 0, changePercent: 0, date: '2026-08-01', unit: '%',
  }];
  assert.equal(getFredSuccessfulUpdate({
    data,
    dataState: { mode: 'cached', timestamp: CACHED_AT, offline: false },
  }, true), null);
  assert.deepEqual(getFredSuccessfulUpdate({
    data,
    dataState: { mode: 'live', timestamp: LIVE_AT, offline: false },
  }, true), { itemCount: 1, updatedAt: LIVE_AT });
});

test('FRED fallback display uses the oldest valid provider or outer-cache timestamp', () => {
  assert.equal(getOldestValidTimestamp(LIVE_AT, CACHED_AT), CACHED_AT);
  assert.equal(getOldestValidTimestamp(null, CACHED_AT), CACHED_AT);
  assert.equal(getOldestValidTimestamp(null, null), null);
});

test('FRED sidecar provenance is explicit and missing metadata fails closed', () => {
  assert.deepEqual(getSidecarDataState({ provenance: 'live', fetchedAt: LIVE_AT }), {
    mode: 'live', timestamp: LIVE_AT, offline: false,
  });
  assert.deepEqual(getSidecarDataState({ provenance: 'cache', fetchedAt: CACHED_AT }), {
    mode: 'cached', timestamp: CACHED_AT, offline: false,
  });
  assert.deepEqual(getSidecarDataState({ series: [] }), {
    mode: 'unavailable', timestamp: null, offline: false,
  });
});

test('GDACS rejects a successful HTTP envelope without a features array', () => {
  assert.throws(() => parseGDACSResponse({ ok: true, items: [], data: [] }), /features/i);
  assert.deepEqual(parseGDACSResponse({ features: [] }), []);
});

test('GDACS rejects unsupported enums and invalid provider-boundary fields', () => {
  const valid = {
    geometry: { type: 'Point', coordinates: [12.5, 41.9] },
    properties: {
      eventtype: 'EQ', eventid: 123, name: 'Test earthquake', description: 'Test',
      alertlevel: 'Orange', country: 'Italy', fromdate: '2026-08-24T10:00:00Z',
      severitydata: { severitytext: 'Magnitude 6.0' }, url: { report: 'https://www.gdacs.org/' },
    },
  };
  assert.equal(parseGDACSResponse({ features: [valid] })[0]?.eventType, 'EQ');
  assert.equal(parseGDACSResponse({ features: [{
    ...valid, properties: { ...valid.properties, description: '' },
  }] })[0]?.description, 'Earthquake');
  assert.throws(() => parseGDACSResponse({ features: [{
    ...valid, properties: { ...valid.properties, eventtype: 'XX' },
  }] }), /event type/i);
  assert.throws(() => parseGDACSResponse({ features: [{
    ...valid, properties: { ...valid.properties, alertlevel: 'Purple' },
  }] }), /alert level/i);
  assert.throws(() => parseGDACSResponse({ features: [{
    ...valid, geometry: { type: 'Point', coordinates: [181, 41.9] },
  }] }), /coordinates/i);
  assert.throws(() => parseGDACSResponse({ features: [{
    ...valid, properties: { ...valid.properties, fromdate: 'not-a-date' },
  }] }), /date/i);
});
