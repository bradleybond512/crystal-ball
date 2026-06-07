import assert from 'node:assert/strict';
import test from 'node:test';
import { forecastToObservations, type OpenMeteoHourlyForecast } from '../weather-forecast-adapter.ts';

const NOW = Date.now();
const FUTURE = NOW + 2 * 60 * 60 * 1000; // 2 hours ahead

function makeHourlyForecast(precipitation: number, windGusts: number, weatherCode: number): OpenMeteoHourlyForecast {
  return {
    hourly: {
      time: [new Date(FUTURE).toISOString()],
      precipitation: [precipitation],
      wind_gusts_10m: [windGusts],
      weather_code: [weatherCode],
    },
  };
}

test('high precipitation produces a HIGH observation', () => {
  const obs = forecastToObservations(makeHourlyForecast(12, 0, 0), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'HIGH');
  assert.equal(obs[0]?.sourceId, 'open-meteo-forecast');
  assert.ok(obs[0]?.tags?.includes('precipitation'));
});

test('below-threshold precipitation produces no observation', () => {
  const obs = forecastToObservations(makeHourlyForecast(1, 0, 0), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 0);
});

test('strong wind gust produces a wind observation when no precipitation', () => {
  const obs = forecastToObservations(makeHourlyForecast(0, 20, 0), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 1);
  assert.ok(obs[0]?.tags?.includes('wind'));
});

test('thunderstorm code produces an observation when no precip or wind', () => {
  const obs = forecastToObservations(makeHourlyForecast(0, 0, 95), 41.6, -86.7, 'Home');
  assert.equal(obs.length, 1);
  assert.equal(obs[0]?.severity, 'MEDIUM');
});

test('past hours are skipped', () => {
  const past = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
  const obs = forecastToObservations({
    hourly: { time: [past], precipitation: [50], wind_gusts_10m: [40], weather_code: [99] },
  }, 41.6, -86.7, 'Home');
  assert.equal(obs.length, 0);
});

test('empty forecast returns empty array', () => {
  assert.deepEqual(forecastToObservations({}, 41.6, -86.7, 'Home'), []);
});
