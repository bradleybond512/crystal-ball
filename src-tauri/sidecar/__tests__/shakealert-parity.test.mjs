/**
 * Parity tests for ShakeAlert sidecar helpers.
 * These helpers transform USGS FDSN GeoJSON into the canonical
 * ShakemapStatus shape consumed by the panel and globe overlay.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  parseShakemapMmiSidecar,
  classifyMmiIntensitySidecar,
  mmiHexColorSidecar,
  hasShakemapProductSidecar,
  filterRecentM45PlusSidecar,
  buildShakemapEventSidecar,
  mostSignificantEventSidecar,
  pagerAlertHexColorSidecar,
  shakemapAvailabilityLabelSidecar,
  recentEventsSidecar,
} from '../local-api-server.mjs';

const NOW_MS = Date.parse('2026-05-11T12:00:00Z');
const DAYS_AGO = (d) => NOW_MS - d * 24 * 60 * 60 * 1000;
const alertFromMag = (mag) => {
  if (mag >= 7) return 'red';
  if (mag >= 6) return 'orange';
  return 'green';
};

function makeFeature(id, mag, timeMsAgo, hasShakemap = true, maxMmi = 6.5) {
  const timeMs = NOW_MS - timeMsAgo * 60 * 1000;
  const products = hasShakemap
    ? { shakemap: [{ properties: { maxmmi: String(maxMmi) }, updateTime: timeMs }] }
    : {};
  return {
    id,
    geometry: { type: 'Point', coordinates: [-120.5, 37.2, 10] },
    properties: {
      mag,
      place: `${mag.toFixed(1)} km NE of Test City`,
      time: timeMs,
      alert: alertFromMag(mag),
      url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`,
      products,
    },
  };
}

test('parseShakemapMmiSidecar returns null when no shakemap product', () => {
  assert.equal(parseShakemapMmiSidecar({}), null);
  assert.equal(parseShakemapMmiSidecar({ shakemap: [] }), null);
  assert.equal(parseShakemapMmiSidecar(null), null);
});

test('parseShakemapMmiSidecar extracts numeric maxmmi from product properties', () => {
  const products = { shakemap: [{ properties: { maxmmi: '7.2' }, updateTime: 0 }] };
  assert.equal(parseShakemapMmiSidecar(products), 7.2);
});

test('parseShakemapMmiSidecar returns null for non-finite values', () => {
  const products = { shakemap: [{ properties: { maxmmi: 'NaN' }, updateTime: 0 }] };
  assert.equal(parseShakemapMmiSidecar(products), null);
});

test('classifyMmiIntensitySidecar covers all 9 intensity levels', () => {
  assert.equal(classifyMmiIntensitySidecar(null), 'Not Felt');
  assert.equal(classifyMmiIntensitySidecar(1.5), 'Not Felt');
  assert.equal(classifyMmiIntensitySidecar(2.5), 'Weak');
  assert.equal(classifyMmiIntensitySidecar(4.1), 'Light');
  assert.equal(classifyMmiIntensitySidecar(5.2), 'Moderate');
  assert.equal(classifyMmiIntensitySidecar(6.1), 'Strong');
  assert.equal(classifyMmiIntensitySidecar(7.3), 'Very Strong');
  assert.equal(classifyMmiIntensitySidecar(8.5), 'Severe');
  assert.equal(classifyMmiIntensitySidecar(9.1), 'Violent');
  assert.equal(classifyMmiIntensitySidecar(10), 'Extreme');
});

test('mmiHexColorSidecar maps MMI to expected color scheme', () => {
  assert.equal(mmiHexColorSidecar(null), '#aaaaaa');
  assert.equal(mmiHexColorSidecar(1), '#aaaaaa');
  assert.equal(mmiHexColorSidecar(2.5), '#7fff00');
  assert.equal(mmiHexColorSidecar(4.5), '#ffff00');
  assert.equal(mmiHexColorSidecar(5.5), '#ffcc00');
  assert.equal(mmiHexColorSidecar(6.5), '#ff8800');
  assert.equal(mmiHexColorSidecar(7.5), '#ff0000');
  assert.equal(mmiHexColorSidecar(8.5), '#dd0000');
  assert.equal(mmiHexColorSidecar(9.5), '#800000');
});

test('hasShakemapProductSidecar detects presence of shakemap', () => {
  assert.equal(hasShakemapProductSidecar({ shakemap: [{ properties: {} }] }), true);
  assert.equal(hasShakemapProductSidecar({ shakemap: [] }), false);
  assert.equal(hasShakemapProductSidecar({}), false);
  assert.equal(hasShakemapProductSidecar(null), false);
});

test('filterRecentM45PlusSidecar excludes M<4.5 and old events', () => {
  const features = [
    makeFeature('eq1', 5.1, 10),           // recent, M5.1 — keep
    makeFeature('eq2', 4.2, 20),           // recent, M4.2 — exclude
    { id: 'eq3', geometry: { type: 'Point', coordinates: [-120, 37, 8] }, properties: { mag: 6, time: DAYS_AGO(10), place: 'Old', products: {} } }, // 10 days ago — exclude
  ];
  const result = filterRecentM45PlusSidecar(features, NOW_MS, 7);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'eq1');
});

test('buildShakemapEventSidecar populates all required fields', () => {
  const feature = makeFeature('us7000test', 6.4, 30, true, 7.1);
  const event = buildShakemapEventSidecar(feature, 0);
  assert.equal(event.id, 'us7000test');
  assert.ok(event.magnitude >= 6.4);
  assert.equal(event.hasShakemap, true);
  assert.equal(event.maxMmi, 7.1);
  assert.equal(event.mmiLabel, 'Very Strong');
  assert.ok(typeof event.detailUrl === 'string');
  assert.ok(event.detailUrl.includes('us7000test'));
});

test('buildShakemapEventSidecar marks hasShakemap=false when product missing', () => {
  const feature = makeFeature('us7000nomap', 5, 30, false, 0);
  const event = buildShakemapEventSidecar(feature, 0);
  assert.equal(event.hasShakemap, false);
  assert.equal(event.maxMmi, null);
});

test('mostSignificantEventSidecar picks highest magnitude', () => {
  const events = [
    { id: 'a', magnitude: 5.5 },
    { id: 'b', magnitude: 7.2 },
    { id: 'c', magnitude: 6.1 },
  ];
  const top = mostSignificantEventSidecar(events);
  assert.equal(top.id, 'b');
});

test('mostSignificantEventSidecar returns null for empty array', () => {
  assert.equal(mostSignificantEventSidecar([]), null);
  assert.equal(mostSignificantEventSidecar(null), null);
});

test('pagerAlertHexColorSidecar maps all PAGER levels', () => {
  assert.equal(pagerAlertHexColorSidecar('green'), '#22c55e');
  assert.equal(pagerAlertHexColorSidecar('yellow'), '#eab308');
  assert.equal(pagerAlertHexColorSidecar('orange'), '#f97316');
  assert.equal(pagerAlertHexColorSidecar('red'), '#ef4444');
  assert.equal(pagerAlertHexColorSidecar(null), '#6b7280');
});

test('shakemapAvailabilityLabelSidecar returns correct label', () => {
  assert.equal(shakemapAvailabilityLabelSidecar(true), 'ShakeMap available');
  assert.equal(shakemapAvailabilityLabelSidecar(false), 'ShakeMap pending');
});

test('recentEventsSidecar delegates to filterRecentM45PlusSidecar', () => {
  const features = [makeFeature('eq1', 5.5, 5), makeFeature('eq2', 4, 5)];
  const result = recentEventsSidecar(features, NOW_MS, 7);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'eq1');
});
