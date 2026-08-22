import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWaterQualitySnapshot,
  normalizeEpaComplianceResponse,
  normalizeUsgsSurfaceWaterResponse,
  selectWaterQualityLocation,
} from '../src/services/water-quality.ts';

const RETRIEVED_AT = new Date('2026-08-14T13:00:00.000Z');

test('water panel location selection uses one primary place and bounds its radius', () => {
  assert.deepEqual(selectWaterQualityLocation([
    { lat: 41, lon: -87, radiusKm: 10 },
    { lat: 42, lon: -86, radiusKm: 500, primary: true },
  ]), { lat: 42, lon: -86, radiusKm: 50 });
  assert.equal(selectWaterQualityLocation([]), undefined);
  assert.equal(selectWaterQualityLocation([{ lat: 91, lon: -86 }]), undefined);
});

test('USGS surface-water readings remain measurements and never become potable-water advisories', () => {
  const measurements = normalizeUsgsSurfaceWaterResponse({
    value: {
      timeSeries: [
        {
          sourceInfo: {
            siteName: 'LITTLE CALUMET RIVER',
            siteCode: [{ value: '04094000' }],
            geoLocation: { geogLocation: { latitude: 41.6, longitude: -86.72 } },
          },
          variable: {
            variableName: 'pH, water, unfiltered, field, standard units',
            variableCode: [{ value: '00400' }],
            unit: { unitCode: 'std units' },
          },
          values: [{ value: [{ value: '3.2', dateTime: '2026-08-14T12:45:00.000Z' }] }],
        },
      ],
    },
  }, RETRIEVED_AT);

  assert.equal(measurements.length, 1);
  assert.equal(measurements[0]?.source, 'usgs-surface-water');
  assert.equal(measurements[0]?.value, 3.2);
  assert.equal(measurements[0]?.sourceObservedAt?.toISOString(), '2026-08-14T12:45:00.000Z');
  assert.equal(measurements[0]?.retrievedAt.toISOString(), RETRIEVED_AT.toISOString());
  assert.equal('severity' in (measurements[0] ?? {}), false);
  assert.equal('potableStatus' in (measurements[0] ?? {}), false);
  assert.deepEqual(normalizeUsgsSurfaceWaterResponse({
    value: { timeSeries: [{
      sourceInfo: { siteName: 'UNTIMED SITE' },
      variable: { variableCode: [{ value: '00010' }] },
      values: [{ value: [{ value: '20.1' }] }],
    }] },
  }, RETRIEVED_AT), []);
});

test('USGS latest-continuous rows require a recent, non-future source timestamp', () => {
  const feature = (time: string | undefined) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [-86.72, 41.6] },
    properties: {
      monitoring_location_id: 'USGS-04095300', monitoring_location_name: 'Trail Creek',
      parameter_code: '00010', value: '20.1', unit_of_measure: 'degC', ...(time ? { time } : {}),
    },
  });
  const normalized = normalizeUsgsSurfaceWaterResponse({ type: 'FeatureCollection', features: [
    feature('2026-08-14T12:45:00Z'),
    feature('2026-08-12T12:45:00Z'),
    feature('2026-08-15T12:45:00Z'),
    feature('2026-08-14T12:45:00'),
    feature('2026-08-14'),
    feature(undefined),
  ] }, RETRIEVED_AT);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.siteName, 'Trail Creek');
  assert.equal(normalized[0]?.sourceObservedAt?.toISOString(), '2026-08-14T12:45:00.000Z');
  assert.deepEqual(normalizeUsgsSurfaceWaterResponse({
    type: 'FeatureCollection', features: [feature(undefined)],
  }, RETRIEVED_AT), []);
  assert.deepEqual(normalizeUsgsSurfaceWaterResponse({
    type: 'FeatureCollection', features: [feature('2026-02-30T12:45:00Z')],
  }, new Date('2026-03-02T13:00:00.000Z')), [], 'calendar-invalid civil time must fail closed');
});

test('EPA SDWIS rows are compliance history with unknown live potable status', () => {
  const result = normalizeEpaComplianceResponse({
    violations: [{
      pwsid: 'IN5246003',
      pws_name: 'Example Water Utility',
      state_code: 'IN',
      violation_name: 'Revised Total Coliform Rule',
      contaminant_name: 'Coliform',
      population_served_count: 22000,
      is_health_based_ind: 'Y',
      compliance_begin_date: '2026-01-01',
    }],
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.evidenceKind, 'epa-compliance-history');
  assert.equal(result.records[0]?.severity, 'unknown');
  assert.equal(result.records[0]?.type, 'general');
  assert.doesNotMatch(result.records[0]?.title ?? '', /boil|do.not.use/i);
  assert.match(result.records[0]?.description ?? '', /not a live boil-water or do-not-use notice/i);
  assert.equal(result.systems[0]?.status, 'unknown');
  assert.equal(result.systems[0]?.lastInspection, null);
});

test('absence of potable evidence remains unknown and never defaults systems to safe', () => {
  const snapshot = buildWaterQualitySnapshot({
    retrievedAt: RETRIEVED_AT,
    epa: { ok: true, records: [], systems: [] },
    usgs: { ok: true, measurements: [] },
  });

  assert.equal(snapshot.potableStatus, 'unknown');
  assert.deepEqual(snapshot.alerts, []);
  assert.deepEqual(snapshot.potableAdvisories, []);
  assert.equal(snapshot.summary.safeSystems, 0);
  assert.equal(snapshot.summary.doNotUseSystems, 0);
  assert.equal(snapshot.summary.unknownSystems, 0);
  assert.match(snapshot.limitations.join(' '), /do(?:es)? not establish that tap water is safe/i);
});
