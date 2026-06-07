import assert from 'node:assert/strict';
import test from 'node:test';
import { marineForecastToObservations, type OpenMeteoMarineForecast } from '../marine-forecast-adapter.ts';

const NOW = Date.now();
const FUTURE = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();

function makeForecast(waveH: number, currentV: number): OpenMeteoMarineForecast {
  return {
    hourly: {
      time: [FUTURE],
      wave_height: [waveH],
      wave_direction: [180],
      swell_wave_height: [waveH * 0.8],
      ocean_current_velocity: [currentV],
    },
  };
}

test('rough seas produce HIGH observation', () => {
  const obs = marineForecastToObservations(makeForecast(7, 0), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
  assert.equal(obs[0]?.sourceId, 'open-meteo-marine');
  assert.ok(obs[0]?.tags?.includes('wave-height'));
});

test('very rough seas produce CRITICAL', () => {
  const obs = marineForecastToObservations(makeForecast(10, 0), 41.6, -86.7, 'Home');
  assert.equal(obs[0]?.severity, 'CRITICAL');
});

test('strong current without heavy seas produces MEDIUM', () => {
  const obs = marineForecastToObservations(makeForecast(1, 2), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 1);
  assert.ok(obs[0]?.tags?.includes('ocean-current'));
});

test('calm seas produce no observation', () => {
  const obs = marineForecastToObservations(makeForecast(1, 0), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 0);
});

test('malformed forecast returns empty', () => {
  assert.deepEqual(marineForecastToObservations({}, 41.6, -86.7, 'Home'), []);
});
