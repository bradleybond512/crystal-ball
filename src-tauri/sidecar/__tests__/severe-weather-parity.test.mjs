/**
 * Parity tests for severe-weather sidecar helpers.
 * These helpers transform SPC GeoJSON and NWS CAP features into
 * the canonical SevereWeatherStatus shape consumed by the panel.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  spcRiskLevelSidecar,
  spcRiskLabelSidecar,
  parseSpcOutlookFeatureSidecar,
  isActiveTornadoWarningSidecar,
  isSevereThunderstormWarningSidecar,
  classifyWarningTypeSidecar,
  warningPolygonColorSidecar,
  filterExpiredWarningsSidecar,
  countWarningsByTypeSidecar,
  buildSpcOutlookSummarySidecar,
} from '../local-api-server.mjs';

test('spcRiskLevelSidecar maps all six SPC risk codes correctly', () => {
  assert.equal(spcRiskLevelSidecar('TSTM'), 1);
  assert.equal(spcRiskLevelSidecar('MRGL'), 2);
  assert.equal(spcRiskLevelSidecar('SLGT'), 3);
  assert.equal(spcRiskLevelSidecar('ENH'), 4);
  assert.equal(spcRiskLevelSidecar('MDT'), 5);
  assert.equal(spcRiskLevelSidecar('HIGH'), 6);
});

test('spcRiskLevelSidecar returns 0 for unknown codes', () => {
  assert.equal(spcRiskLevelSidecar(''), 0);
  assert.equal(spcRiskLevelSidecar('UNKNOWN'), 0);
  assert.equal(spcRiskLevelSidecar(null), 0);
});

test('spcRiskLevelSidecar is case-insensitive', () => {
  assert.equal(spcRiskLevelSidecar('high'), 6);
  assert.equal(spcRiskLevelSidecar('mdt'), 5);
  assert.equal(spcRiskLevelSidecar('slgt'), 3);
});

test('spcRiskLabelSidecar returns human-readable labels', () => {
  assert.equal(spcRiskLabelSidecar('MRGL'), 'Marginal');
  assert.equal(spcRiskLabelSidecar('SLGT'), 'Slight');
  assert.equal(spcRiskLabelSidecar('ENH'), 'Enhanced');
  assert.equal(spcRiskLabelSidecar('MDT'), 'Moderate');
  assert.equal(spcRiskLabelSidecar('HIGH'), 'High');
});

test('parseSpcOutlookFeatureSidecar extracts DN and risk from GeoJSON feature', () => {
  const feature = { properties: { DN: 'MDT', VALID: '2026050712', EXPIRE: '2026050800' } };
  const result = parseSpcOutlookFeatureSidecar(feature);
  assert.equal(result.dn, 'MDT');
  assert.equal(result.risk, 5);
  assert.equal(result.label, 'Moderate');
  assert.equal(result.validTime, '2026050712');
});

test('isActiveTornadoWarningSidecar detects tornado warnings', () => {
  assert.equal(isActiveTornadoWarningSidecar('Tornado Warning'), true);
  assert.equal(isActiveTornadoWarningSidecar('tornado warning issued'), true);
  assert.equal(isActiveTornadoWarningSidecar('Severe Thunderstorm Warning'), false);
  assert.equal(isActiveTornadoWarningSidecar('Tornado Watch'), false);
});

test('isSevereThunderstormWarningSidecar detects thunderstorm warnings', () => {
  assert.equal(isSevereThunderstormWarningSidecar('Severe Thunderstorm Warning'), true);
  assert.equal(isSevereThunderstormWarningSidecar('Tornado Warning'), false);
  assert.equal(isSevereThunderstormWarningSidecar('Severe Thunderstorm Watch'), false);
});

test('classifyWarningTypeSidecar categorises all three types', () => {
  assert.equal(classifyWarningTypeSidecar('Tornado Warning'), 'tornado');
  assert.equal(classifyWarningTypeSidecar('Severe Thunderstorm Warning'), 'thunderstorm');
  assert.equal(classifyWarningTypeSidecar('Tornado Watch'), 'watch');
  assert.equal(classifyWarningTypeSidecar('Severe Thunderstorm Watch'), 'watch');
  assert.equal(classifyWarningTypeSidecar('Special Weather Statement'), 'other');
});

test('warningPolygonColorSidecar returns correct hex codes', () => {
  assert.equal(warningPolygonColorSidecar('tornado'), '#ef4444');
  assert.equal(warningPolygonColorSidecar('thunderstorm'), '#f97316');
  assert.equal(warningPolygonColorSidecar('watch'), '#eab308');
  assert.equal(warningPolygonColorSidecar('other'), '#6b7280');
});

test('filterExpiredWarningsSidecar removes expired features', () => {
  const now = '2026-05-11T12:00:00Z';
  const features = [
    { properties: { expires: '2026-05-11T10:00:00Z' }, event: 'Tornado Warning' },
    { properties: { expires: '2026-05-11T14:00:00Z' }, event: 'Tornado Warning' },
    { properties: { expires: '' }, event: 'Watch' },
  ];
  const result = filterExpiredWarningsSidecar(features, now);
  assert.equal(result.length, 2);
});

test('countWarningsByTypeSidecar counts correctly', () => {
  const warnings = [
    { warnType: 'tornado' },
    { warnType: 'tornado' },
    { warnType: 'thunderstorm' },
    { warnType: 'watch' },
  ];
  const counts = countWarningsByTypeSidecar(warnings);
  assert.equal(counts.tornado, 2);
  assert.equal(counts.thunderstorm, 1);
  assert.equal(counts.watch, 1);
});

test('buildSpcOutlookSummarySidecar returns null maxRisk for empty features', () => {
  const result = buildSpcOutlookSummarySidecar([]);
  assert.equal(result.maxRisk, null);
  assert.equal(result.outlookCount, 0);
});

test('buildSpcOutlookSummarySidecar picks highest risk from multiple features', () => {
  const features = [
    { properties: { DN: 'SLGT', VALID: '202605070000' } },
    { properties: { DN: 'MDT', VALID: '202605070600' } },
    { properties: { DN: 'ENH', VALID: '202605071200' } },
  ];
  const result = buildSpcOutlookSummarySidecar(features);
  assert.equal(result.maxRisk, 'MDT');
  assert.equal(result.outlookCount, 3);
});
