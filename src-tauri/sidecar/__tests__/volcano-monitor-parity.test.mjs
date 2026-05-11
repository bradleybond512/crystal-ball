/**
 * Parity tests for volcano-monitor sidecar helpers.
 * These helpers transform USGS VHP + Smithsonian GVP data into
 * the canonical VolcanoMonitorStatus shape consumed by the panel.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  parseVolcanoHazardLevelSidecar,
  alertColorFromHazardLevelSidecar,
  aviationCodeFromAlertLevelSidecar,
  volcanoMarkerHexColorSidecar,
  filterNonNormalVolcanoesSidecar,
  sortVolcanoesByAlertSeveritySidecar,
  groupVolcanoesByAlertSidecar,
  parseGvpRssSidecar,
  mergeGvpBulletinSidecar,
  buildVolcanoMonitorStatusSidecar,
} from '../local-api-server.mjs';

const SAMPLE_VHP_RECORD = {
  volcanoName: 'Kilauea',
  vnum: '332010',
  alertLevel: 'watch',
  latitude: '19.421',
  longitude: '-155.287',
  state: 'Hawaii',
  country: 'US',
  observatoryName: 'HVO',
  activityChangedDate: '2026-05-01',
};

test('parseVolcanoHazardLevelSidecar normalises alertLevel to Watch', () => {
  const result = parseVolcanoHazardLevelSidecar(SAMPLE_VHP_RECORD, 0);
  assert.equal(result.alertLevel, 'Watch');
  assert.equal(result.name, 'Kilauea');
  assert.equal(result.observatory, 'HVO');
});

test('parseVolcanoHazardLevelSidecar sets lat/lon from string fields', () => {
  const result = parseVolcanoHazardLevelSidecar(SAMPLE_VHP_RECORD, 0);
  assert.ok(Math.abs(result.lat - 19.421) < 0.001);
  assert.ok(Math.abs(result.lon - (-155.287)) < 0.001);
});

test('parseVolcanoHazardLevelSidecar falls back to Normal for unknown level', () => {
  const result = parseVolcanoHazardLevelSidecar({ volcanoName: 'Unknown', alertLevel: 'UNASSIGNED' }, 5);
  assert.equal(result.alertLevel, 'Normal');
});

test('alertColorFromHazardLevelSidecar returns correct hex colors', () => {
  assert.equal(alertColorFromHazardLevelSidecar('Warning'), '#ef4444');
  assert.equal(alertColorFromHazardLevelSidecar('Watch'), '#f97316');
  assert.equal(alertColorFromHazardLevelSidecar('Advisory'), '#eab308');
  assert.equal(alertColorFromHazardLevelSidecar('Normal'), '#22c55e');
});

test('aviationCodeFromAlertLevelSidecar maps all alert levels', () => {
  assert.equal(aviationCodeFromAlertLevelSidecar('Normal'), 'Green');
  assert.equal(aviationCodeFromAlertLevelSidecar('Advisory'), 'Yellow');
  assert.equal(aviationCodeFromAlertLevelSidecar('Watch'), 'Orange');
  assert.equal(aviationCodeFromAlertLevelSidecar('Warning'), 'Red');
});

test('volcanoMarkerHexColorSidecar delegates to alertColorFromHazardLevelSidecar', () => {
  assert.equal(volcanoMarkerHexColorSidecar('Warning'), alertColorFromHazardLevelSidecar('Warning'));
  assert.equal(volcanoMarkerHexColorSidecar('Normal'), alertColorFromHazardLevelSidecar('Normal'));
});

test('filterNonNormalVolcanoesSidecar removes Normal entries', () => {
  const volcanoes = [
    { alertLevel: 'Normal', name: 'A' },
    { alertLevel: 'Watch', name: 'B' },
    { alertLevel: 'Warning', name: 'C' },
    { alertLevel: 'Normal', name: 'D' },
  ];
  const result = filterNonNormalVolcanoesSidecar(volcanoes);
  assert.equal(result.length, 2);
  assert.ok(result.every(v => v.alertLevel !== 'Normal'));
});

test('sortVolcanoesByAlertSeveritySidecar puts Warning first', () => {
  const volcanoes = [
    { alertLevel: 'Advisory', name: 'A' },
    { alertLevel: 'Warning', name: 'B' },
    { alertLevel: 'Watch', name: 'C' },
  ];
  const sorted = sortVolcanoesByAlertSeveritySidecar(volcanoes);
  assert.equal(sorted[0].name, 'B');
  assert.equal(sorted[1].name, 'C');
  assert.equal(sorted[2].name, 'A');
});

test('groupVolcanoesByAlertSidecar correctly buckets into Warning/Watch/Advisory/Normal', () => {
  const volcanoes = [
    { alertLevel: 'Warning' },
    { alertLevel: 'Watch' },
    { alertLevel: 'Watch' },
    { alertLevel: 'Advisory' },
    { alertLevel: 'Normal' },
  ];
  const groups = groupVolcanoesByAlertSidecar(volcanoes);
  assert.equal(groups.Warning.length, 1);
  assert.equal(groups.Watch.length, 2);
  assert.equal(groups.Advisory.length, 1);
  assert.equal(groups.Normal.length, 1);
});

test('parseGvpRssSidecar returns empty array for empty/non-XML input', () => {
  assert.deepEqual(parseGvpRssSidecar(''), []);
  assert.deepEqual(parseGvpRssSidecar(null), []);
  assert.deepEqual(parseGvpRssSidecar('<rss><channel></channel></rss>'), []);
});

test('parseGvpRssSidecar extracts title and description from RSS items', () => {
  const xml = `<rss><channel>
    <item><title>Kilauea (Hawaii)</title><description>Activity elevated at summit.</description></item>
    <item><title>Etna (Italy)</title><description>Strombolian eruption.</description></item>
  </channel></rss>`;
  const items = parseGvpRssSidecar(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Kilauea (Hawaii)');
  assert.ok(items[0].description.includes('Activity elevated'));
});

test('mergeGvpBulletinSidecar attaches bulletin text to matching volcano', () => {
  const volcanoes = [
    { name: 'Kilauea', alertLevel: 'Watch' },
    { name: 'Mauna Loa', alertLevel: 'Advisory' },
  ];
  const gvpItems = [
    { title: 'Kilauea (Hawaii)', description: 'Lava flows observed.' },
  ];
  const merged = mergeGvpBulletinSidecar(volcanoes, gvpItems);
  assert.ok(merged[0].gvpBulletin?.includes('Lava flows'));
  assert.equal(merged[1].gvpBulletin, undefined);
});

test('buildVolcanoMonitorStatusSidecar computes activeCount correctly', () => {
  const volcanoes = [
    { alertLevel: 'Warning', name: 'A' },
    { alertLevel: 'Normal', name: 'B' },
    { alertLevel: 'Watch', name: 'C' },
  ];
  const status = buildVolcanoMonitorStatusSidecar(volcanoes);
  assert.equal(status.activeCount, 2);
  assert.ok(typeof status.fetchedAt === 'string');
  assert.equal(status.volcanoes.length, 3);
  assert.equal(status.volcanoes[0].alertLevel, 'Warning');
});
