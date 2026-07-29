import assert from 'node:assert/strict';
import test from 'node:test';

import {
  openMeteoAqToObservations, openaqToObservations,
  airnowToObservations, purpleairToObservations, pm25ToAqi, filterReadingsNearby,
} from '../airquality-fusion-observations.ts';
import type { AirQualityReading } from '@/services/air-quality';
import type { MonitorReading } from '@/services/airquality/openaq-service';
import type { AirnowReading, PurpleairReading } from '../airquality-fusion-observations.ts';

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

function anReading(o: Partial<AirnowReading> = {}): AirnowReading {
  return { lat: 41.6, lon: -87.06, aqi: 62, parameter: 'PM2.5', observedAt: NOW, ...o };
}

function paReading(o: Partial<PurpleairReading> = {}): PurpleairReading {
  return { lat: 41.6, lon: -87.06, pm25: 20, observedAt: NOW, ...o };
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

test('AirNow adapter maps AQI + location to a DomainObservation', () => {
  const obs = airnowToObservations([anReading({ aqi: 62 })]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.providerId, 'airnow');
  assert.equal(obs[0]!.value, 62);
  assert.equal(obs[0]!.lat, 41.6);
  assert.equal(obs[0]!.lon, -87.06);
  assert.equal(obs[0]!.occurredAt, NOW);
  assert.equal(obs[0]!.externalId, 'PM2.5');
});

test('AirNow adapter collapses multiple parameters at the same site to the worst AQI', () => {
  const obs = airnowToObservations([
    anReading({ aqi: 40, parameter: 'PM2.5' }),
    anReading({ aqi: 62, parameter: 'OZONE' }),
    anReading({ aqi: 55, parameter: 'PM10' }),
  ]);
  assert.equal(obs.length, 1, 'same site (lat/lon to 3dp) collapses to one observation');
  assert.equal(obs[0]!.value, 62, 'the worst (highest) AQI wins');
  assert.equal(obs[0]!.externalId, 'OZONE');
});

test('AirNow adapter keeps distinct sites separate', () => {
  const obs = airnowToObservations([
    anReading({ lat: 41.6, lon: -87.06, aqi: 40 }),
    anReading({ lat: 34.05, lon: -118.24, aqi: 90 }),
  ]);
  assert.equal(obs.length, 2);
});

test('AirNow adapter skips non-finite/negative AQI and missing coords/time', () => {
  assert.equal(airnowToObservations([anReading({ aqi: Number.NaN })]).length, 0);
  assert.equal(airnowToObservations([anReading({ aqi: -1 })]).length, 0);
  assert.equal(airnowToObservations([anReading({ lat: Number.NaN })]).length, 0);
  assert.equal(airnowToObservations([anReading({ observedAt: Number.NaN })]).length, 0);
});

test('pm25ToAqi follows the EPA breakpoint table', () => {
  assert.equal(pm25ToAqi(0), 0);
  assert.equal(pm25ToAqi(12), 50);
  assert.equal(pm25ToAqi(35.5), 101, 'first value in the unhealthy-for-sensitive-groups band');
  assert.equal(pm25ToAqi(500.4), 500);
  assert.equal(pm25ToAqi(600), undefined, 'above the top breakpoint is out of table');
  assert.equal(pm25ToAqi(-5), undefined, 'negative concentration is not a valid table lookup');
});

test('PurpleAir adapter converts PM2.5 to AQI via the breakpoint table', () => {
  const obs = purpleairToObservations([paReading({ pm25: 12 })]);
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.providerId, 'purpleair');
  assert.equal(obs[0]!.value, 50);
  assert.equal(obs[0]!.lat, 41.6);
  assert.equal(obs[0]!.lon, -87.06);
  assert.equal(obs[0]!.occurredAt, NOW);
});

test('PurpleAir adapter drops negative/out-of-range PM2.5 and missing coords/time', () => {
  assert.equal(purpleairToObservations([paReading({ pm25: -5 })]).length, 0, 'negative pm25 dropped by caller');
  assert.equal(purpleairToObservations([paReading({ pm25: 600 })]).length, 0, 'out-of-table pm25 (undefined AQI) dropped');
  assert.equal(purpleairToObservations([paReading({ lat: Number.NaN })]).length, 0);
  assert.equal(purpleairToObservations([paReading({ observedAt: Number.NaN })]).length, 0);
});

test('filterReadingsNearby keeps a sensor ~50km away, drops one ~500km away', () => {
  const near = paReading({ lat: 42.05, lon: -87.06 }); // haversine ≈ 50.04km from the ref point
  const far = paReading({ lat: 46.1, lon: -87.06 }); // haversine ≈ 500.38km from the ref point
  const kept = filterReadingsNearby([near, far], 41.6, -87.06, 100);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], near);
});

test('filterReadingsNearby respects the radius parameter', () => {
  const at50km = paReading({ lat: 42.05, lon: -87.06 });
  assert.equal(filterReadingsNearby([at50km], 41.6, -87.06, 100).length, 1, 'kept under a 100km radius');
  assert.equal(filterReadingsNearby([at50km], 41.6, -87.06, 10).length, 0, 'dropped under a tighter 10km radius');
});
