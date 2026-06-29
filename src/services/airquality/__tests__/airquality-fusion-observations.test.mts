import assert from 'node:assert/strict';
import test from 'node:test';

import { openMeteoAqToObservations, openaqToObservations } from '../airquality-fusion-observations.ts';
import type { AirQualityReading } from '@/services/air-quality';
import type { MonitorReading } from '@/services/airquality/openaq-service';

const NOW = 1_745_000_000_000;

function omReading(o: Partial<AirQualityReading> = {}): AirQualityReading {
  return {
    city: 'Delhi', country: 'IN', lat: 28.6, lon: 77.2, aqi: 180, aqiLevel: 'unhealthy',
    pm25: 110, pm10: 160, ozone: 40, no2: 30, updatedAt: new Date(NOW),
    ...o,
  };
}

function oaqReading(o: Partial<MonitorReading> = {}): MonitorReading {
  return {
    id: 'loc1:pm25', locationId: 1, station: 'Delhi US Embassy', city: 'Delhi', country: 'IN',
    lat: 28.63, lon: 77.22, parameter: 'pm25', value: 112, unit: 'µg/m³',
    observedAt: NOW, aqi: 185, category: 'unhealthy',
    ...o,
  };
}

test('Open-Meteo adapter maps AQI + location to a DomainObservation', () => {
  const obs = openMeteoAqToObservations([omReading({ aqi: 175 })]);
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0], {
    providerId: 'open-meteo-aqi', value: 175, lat: 28.6, lon: 77.2, occurredAt: NOW, externalId: 'Delhi',
  });
});

test('OpenAQ adapter maps the EPA AQI (PM2.5 stations only)', () => {
  const obs = openaqToObservations([oaqReading({ aqi: 185 })]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.providerId, 'openaq-v3');
  assert.equal(obs[0]!.value, 185);
  assert.equal(obs[0]!.lat, 28.63);
  assert.equal(obs[0]!.occurredAt, NOW);
});

test('OpenAQ adapter skips non-PM2.5 readings (aqi null) and missing coords/time', () => {
  assert.equal(openaqToObservations([oaqReading({ aqi: null })]).length, 0);
  assert.equal(openaqToObservations([oaqReading({ lat: null })]).length, 0);
  assert.equal(openaqToObservations([oaqReading({ observedAt: null })]).length, 0);
});

test('Open-Meteo adapter skips non-finite AQI/coords', () => {
  assert.equal(openMeteoAqToObservations([omReading({ aqi: Number.NaN })]).length, 0);
});
