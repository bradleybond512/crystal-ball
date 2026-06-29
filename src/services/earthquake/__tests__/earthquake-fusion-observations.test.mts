import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usgsEarthquakesToObservations,
  emscEventsToObservations,
} from '../earthquake-fusion-observations.ts';
import type { Earthquake } from '@/generated/client/crystalball/seismology/v1/service_client';
import type { EmscEvent } from '@/services/emsc-seismic';

const NOW = 1_745_000_000_000;

function usgs(o: Partial<Earthquake> = {}): Earthquake {
  return {
    id: 'us1', place: 'near Tokyo', magnitude: 6.0, depthKm: 10,
    location: { latitude: 35.6, longitude: 139.7 }, occurredAt: NOW, sourceUrl: 'https://usgs',
    ...o,
  };
}

function emsc(o: Partial<EmscEvent> = {}): EmscEvent {
  return {
    id: 'em1', magnitude: 6.0, magnitudeType: 'mw', depth: 10, lat: 35.6, lon: 139.7,
    region: 'JAPAN', time: new Date(NOW).toISOString(), source: 'EMSC',
    suspectedNuclearTest: false, nearTestSite: null,
    ...o,
  };
}

test('USGS adapter maps magnitude + location to a DomainObservation', () => {
  const obs = usgsEarthquakesToObservations([usgs({ magnitude: 6.3 })]);
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0], {
    providerId: 'usgs-earthquakes', value: 6.3, lat: 35.6, lon: 139.7, occurredAt: NOW, externalId: 'us1',
  });
});

test('USGS adapter skips events with no location', () => {
  const obs = usgsEarthquakesToObservations([usgs({ location: undefined })]);
  assert.equal(obs.length, 0);
});

test('EMSC adapter parses ISO time to ms and maps magnitude', () => {
  const obs = emscEventsToObservations([emsc({ magnitude: 5.9 })]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.providerId, 'emsc-seismic');
  assert.equal(obs[0]!.value, 5.9);
  assert.equal(obs[0]!.occurredAt, NOW);
});

test('EMSC adapter skips null magnitude and unparseable time', () => {
  assert.equal(emscEventsToObservations([emsc({ magnitude: null })]).length, 0);
  assert.equal(emscEventsToObservations([emsc({ time: null })]).length, 0);
  assert.equal(emscEventsToObservations([emsc({ time: 'not-a-date' })]).length, 0);
});
