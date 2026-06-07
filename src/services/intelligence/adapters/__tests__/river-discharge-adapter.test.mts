import assert from 'node:assert/strict';
import test from 'node:test';
import { riverDischargeToObservations, type OpenMeteoFloodForecast } from '../river-discharge-adapter.ts';

const NOW = Date.now();
const TOMORROW = new Date(NOW + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function makeForecast(discharges: number[]): OpenMeteoFloodForecast {
  const days = discharges.map((_, i) => new Date(NOW + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  return { daily: { time: days, river_discharge: discharges } };
}

test('anomalous spike produces HIGH observation', () => {
  // mean = 200, spike = 450 (2.25x)
  const obs = riverDischargeToObservations(makeForecast([200, 200, 200, 450, 200, 200, 200]), 41.6, -86.7, 'Home');
  assert.ok(obs.length >= 1);
  const spike = obs.find((o) => o.severity === 'HIGH' || o.severity === 'CRITICAL');
  assert.ok(spike, 'spike should produce HIGH or CRITICAL');
  assert.equal(spike!.sourceId, 'open-meteo-flood');
  assert.ok(spike!.tags?.includes('glofas'));
});

test('uniform low discharge produces no observations', () => {
  const obs = riverDischargeToObservations(makeForecast([50, 50, 50, 50, 50, 50, 50]), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 0);
});

test('normally-large but uniform river produces no observation (no noise)', () => {
  // 300 m3/s is significant but if uniform for 7 days it's not anomalous.
  // Absolute fallback threshold is now 2000+, so this produces nothing.
  const obs = riverDischargeToObservations(makeForecast([300, 300, 300, 300, 300, 300, 300]), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 0);
});

test('genuinely extreme discharge still fires via absolute threshold', () => {
  // 15000 m3/s is major-river-in-flood range regardless of baseline
  const obs = riverDischargeToObservations(makeForecast([15_000, 15_000, 15_000, 15_000, 15_000, 15_000, 15_000]), 41.6, -86.7, 'Home');
  assert.ok(obs.length > 0);
  assert.equal(obs[0]?.severity, 'HIGH');
});

test('malformed/null forecast returns empty', () => {
  assert.deepEqual(riverDischargeToObservations({}, 41.6, -86.7, 'Home'), []);
  // @ts-expect-error testing null input
  assert.deepEqual(riverDischargeToObservations(null, 41.6, -86.7, 'Home'), []);
});
