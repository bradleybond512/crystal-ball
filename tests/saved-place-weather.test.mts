import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeHourlyForecastPeriods,
  buildSavedPlaceWeatherFingerprint,
  deserializeCachedSavedPlaceWeather,
  fetchSavedPlaceWeather,
  getCachedSavedPlaceWeather,
} from '../src/services/saved-place-weather.ts';
import type { SavedPlace } from '../src/services/saved-places.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const PLACE: SavedPlace = {
  id: 'home', name: 'Home', lat: 41.61, lon: -86.72, radiusKm: 25,
  tags: ['home'], priority: 0, notes: '', offlinePinned: true, primary: true,
  source: 'manual', sortIndex: 1, createdAt: NOW, updatedAt: NOW,
};

test('hourly forecast analysis flags strong thunderstorm risk from NWS point forecast data', () => {
  const hazards = analyzeHourlyForecastPeriods([
 {
 startTime: '2026-03-30T18:00:00-05:00',
 endTime: '2026-03-30T19:00:00-05:00',
 temperature: 78,
 temperatureUnit: 'F',
 windSpeed: '25 to 40 mph',
 shortForecast: 'Chance Showers And Thunderstorms',
 probabilityOfPrecipitation: { value: 80 },
 },
 {
 startTime: '2026-03-30T19:00:00-05:00',
 endTime: '2026-03-30T20:00:00-05:00',
 temperature: 74,
 temperatureUnit: 'F',
 windSpeed: '30 to 45 mph',
 shortForecast: 'Showers And Thunderstorms',
 probabilityOfPrecipitation: { value: 90 },
 },
  ]);

  assert.ok(hazards.length > 0, 'forecast hazards should be emitted when strong convective weather is in the next 12 hours');
  assert.equal(hazards[0]?.type, 'thunderstorm');
  assert.match(hazards[0]?.headline ?? '', /thunderstorm/i);
  assert.ok(
 hazards.some((hazard) => hazard.severity === 'high' || hazard.severity === 'critical'),
 'severe forecast periods should produce elevated hazard severity',
  );
});

test('hourly forecast analysis flags blizzard-style winter conditions from NWS point forecast data', () => {
  const hazards = analyzeHourlyForecastPeriods([
 {
 startTime: '2026-03-30T06:00:00-05:00',
 endTime: '2026-03-30T07:00:00-05:00',
 temperature: 18,
 temperatureUnit: 'F',
 windSpeed: '30 to 45 mph',
 shortForecast: 'Heavy Snow And Blowing Snow',
 probabilityOfPrecipitation: { value: 90 },
 },
  ]);

  assert.ok(hazards.length > 0, 'winter hazards should be emitted when blizzard conditions are in the next 12 hours');
  assert.equal(hazards[0]?.type, 'winter');
  assert.match(hazards[0]?.headline ?? '', /winter|snow|blizzard/i);
  assert.ok(
 hazards.some((hazard) => hazard.severity === 'high' || hazard.severity === 'critical'),
 'blizzard-style periods should produce elevated hazard severity',
  );
});

test('offline forecast cache rejects a same-ID moved place and expired evidence', () => {
  const cached = {
    schemaVersion: 2,
    placeId: PLACE.id,
    placeName: PLACE.name,
    placeFingerprint: buildSavedPlaceWeatherFingerprint(PLACE),
    forecastUrl: 'https://api.weather.gov/gridpoints/IWX/1,1/forecast/hourly',
    hazards: [{
      type: 'thunderstorm', headline: 'Thunderstorm window', detail: 'Damaging winds',
      severity: 'critical', startTime: '2026-08-14T14:00:00Z', leadHours: 0,
      source: 'NWS hourly forecast',
    }],
    fetchedAt: new Date(NOW).toISOString(),
  };
  assert.ok(deserializeCachedSavedPlaceWeather(cached, PLACE, NOW + 60_000));
  assert.equal(
    deserializeCachedSavedPlaceWeather(cached, { ...PLACE, lat: PLACE.lat + 0.5, updatedAt: NOW + 1 }, NOW + 60_000),
    null,
  );
  assert.equal(deserializeCachedSavedPlaceWeather(cached, PLACE, NOW + 24 * 60 * 60_000 + 1), null);
});

test('network weather for old coordinates cannot be read after a same-ID place move', async (t) => {
  const originalFetch = globalThis.fetch;
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return Response.json({
        properties: { forecastHourly: 'https://api.weather.gov/gridpoints/IWX/1,1/forecast/hourly' },
      });
    }
    return Response.json({
      properties: {
        updated: new Date().toISOString(),
        periods: [{
          startTime: new Date().toISOString(), temperature: 75, temperatureUnit: 'F',
          windSpeed: '50 mph', shortForecast: 'Severe Thunderstorms',
          probabilityOfPrecipitation: { value: 90 },
        }],
      },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const snapshot = await fetchSavedPlaceWeather(PLACE);
  assert.equal(snapshot?.placeFingerprint, buildSavedPlaceWeatherFingerprint(PLACE));
  assert.ok(getCachedSavedPlaceWeather(PLACE));
  assert.equal(getCachedSavedPlaceWeather({ ...PLACE, lat: PLACE.lat + 0.5, updatedAt: NOW + 1 }), null);
});
