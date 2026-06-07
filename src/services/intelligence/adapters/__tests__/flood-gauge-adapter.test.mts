import assert from 'node:assert/strict';
import test from 'node:test';
import { floodGaugesToObservations, type NOAACoopsResponse } from '../flood-gauge-adapter.ts';

function makeGaugeResponse(waterLevelFt: number | null): NOAACoopsResponse {
  return {
    gauges: [{
      stationId: '9087079',
      stationName: 'Michigan City IN',
      distanceKm: 12,
      lat: 41.73,
      lon: -86.91,
      waterLevelFt,
      timestamp: new Date().toISOString(),
      flags: null,
    }],
    fetchedAt: Date.now(),
  };
}

test('elevated water level produces a MEDIUM observation', () => {
  const obs = floodGaugesToObservations(makeGaugeResponse(3.5), 'Home');
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'MEDIUM');
  assert.equal(obs[0]?.sourceId, 'noaa-coops');
  assert.ok(obs[0]?.tags?.includes('flood'));
});

test('moderate flood level produces HIGH observation', () => {
  const obs = floodGaugesToObservations(makeGaugeResponse(6), 'Home');
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
});

test('normal/low water level produces no observation', () => {
  const obs = floodGaugesToObservations(makeGaugeResponse(0.5), 'Home');
  assert.equal(obs.length, 0);
});

test('null water level produces no observation', () => {
  const obs = floodGaugesToObservations(makeGaugeResponse(null), 'Home');
  assert.equal(obs.length, 0);
});

test('empty gauges array returns empty array', () => {
  const obs = floodGaugesToObservations({ gauges: [] }, 'Home');
  assert.deepEqual(obs, []);
});
