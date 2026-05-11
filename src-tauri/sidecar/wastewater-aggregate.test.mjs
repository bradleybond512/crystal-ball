// src-tauri/sidecar/wastewater-aggregate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateWastewaterRows,
  detectSurgeWatches,
  classifyLevel,
  classifyTrend,
} from './wastewater-aggregate.mjs';

const sampleRow = (overrides) => ({
  wwtp_jurisdiction: 'Maryland',
  wwtp_id: '2952',
  reporting_jurisdiction: 'Maryland',
  date_start: '2025-02-04',
  date_end: '2025-02-18',
  ptc_15d: '50',
  detect_prop_15d: '100',
  percentile: '85.0',
  ...overrides,
});

test('classifyLevel maps percentile to bucket', () => {
  assert.equal(classifyLevel(95), 'high');
  assert.equal(classifyLevel(80), 'high');
  assert.equal(classifyLevel(75), 'elevated');
  assert.equal(classifyLevel(60), 'elevated');
  assert.equal(classifyLevel(55), 'moderate');
  assert.equal(classifyLevel(40), 'moderate');
  assert.equal(classifyLevel(10), 'low');
  assert.equal(classifyLevel(0), 'low');
});

test('classifyTrend maps ptc_15d to direction', () => {
  assert.equal(classifyTrend(50), 'increasing');
  assert.equal(classifyTrend(26), 'increasing');
  assert.equal(classifyTrend(25), 'stable');
  assert.equal(classifyTrend(0), 'stable');
  assert.equal(classifyTrend(-25), 'stable');
  assert.equal(classifyTrend(-26), 'decreasing');
  assert.equal(classifyTrend(-90), 'decreasing');
});

test('aggregateWastewaterRows: empty input returns empty signals', () => {
  const result = aggregateWastewaterRows([]);
  assert.deepEqual(result.signals, []);
  assert.equal(result.lastUpdated, null);
});

test('aggregateWastewaterRows: groups WWTPs by state and picks latest window', () => {
  const rows = [
    sampleRow({ wwtp_id: 'A', date_end: '2025-02-10', percentile: '60', ptc_15d: '10' }),
    sampleRow({ wwtp_id: 'B', date_end: '2025-02-18', percentile: '85', ptc_15d: '50' }),
    sampleRow({ wwtp_id: 'C', date_end: '2025-02-18', percentile: '75', ptc_15d: '40' }),
  ];
  const { signals, lastUpdated } = aggregateWastewaterRows(rows);
  assert.equal(signals.length, 1);
  const md = signals[0];
  assert.equal(md.pathogen, 'COVID-19');
  assert.equal(md.jurisdiction, 'Maryland');
  // Median of percentile 85,75 from latest window 2025-02-18 → 80 → high
  assert.equal(md.level, 'high');
  // Median of ptc_15d 50,40 → 45 → increasing
  assert.equal(md.trend, 'increasing');
  assert.equal(md.lastUpdated, '2025-02-18');
  assert.equal(lastUpdated, '2025-02-18');
});

test('aggregateWastewaterRows: tolerates missing/malformed values', () => {
  const rows = [
    sampleRow({ percentile: 'nan', ptc_15d: 'oops' }),
    sampleRow({ percentile: null, ptc_15d: undefined }),
    sampleRow({ percentile: '70', ptc_15d: '40' }),
  ];
  const { signals } = aggregateWastewaterRows(rows);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].percentile15d, 70);
});

test('aggregateWastewaterRows: skips rows missing jurisdiction or date_end', () => {
  const rows = [
    sampleRow({ wwtp_jurisdiction: '', date_end: '2025-02-18' }),
    sampleRow({ wwtp_jurisdiction: 'Ohio', date_end: '' }),
    sampleRow({ wwtp_jurisdiction: 'Texas', date_end: '2025-02-18', percentile: '70', ptc_15d: '30' }),
  ];
  const { signals } = aggregateWastewaterRows(rows);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].jurisdiction, 'Texas');
});

test('aggregateWastewaterRows: produces one signal per state', () => {
  const rows = [
    sampleRow({ wwtp_jurisdiction: 'California', date_end: '2025-02-18', percentile: '90', ptc_15d: '60' }),
    sampleRow({ wwtp_jurisdiction: 'California', date_end: '2025-02-18', percentile: '80', ptc_15d: '40' }),
    sampleRow({ wwtp_jurisdiction: 'Texas', date_end: '2025-02-18', percentile: '50', ptc_15d: '-30' }),
    sampleRow({ wwtp_jurisdiction: 'Florida', date_end: '2025-02-18', percentile: '30', ptc_15d: '5' }),
  ];
  const { signals } = aggregateWastewaterRows(rows);
  assert.equal(signals.length, 3);
  const byState = Object.fromEntries(signals.map(s => [s.jurisdiction, s]));
  assert.equal(byState.California.level, 'high');
  assert.equal(byState.California.trend, 'increasing');
  assert.equal(byState.Texas.level, 'moderate');
  assert.equal(byState.Texas.trend, 'decreasing');
  assert.equal(byState.Florida.level, 'low');
  assert.equal(byState.Florida.trend, 'stable');
});

test('detectSurgeWatches: triggers when ≥3 jurisdictions show increasing trend for one pathogen', () => {
  const signals = [
    { pathogen: 'COVID-19', jurisdiction: 'CA', trend: 'increasing', level: 'high', percentile15d: 90, ptc15d: 50, lastUpdated: '2025-02-18' },
    { pathogen: 'COVID-19', jurisdiction: 'TX', trend: 'increasing', level: 'elevated', percentile15d: 70, ptc15d: 35, lastUpdated: '2025-02-18' },
    { pathogen: 'COVID-19', jurisdiction: 'NY', trend: 'increasing', level: 'high', percentile15d: 85, ptc15d: 60, lastUpdated: '2025-02-18' },
    { pathogen: 'COVID-19', jurisdiction: 'FL', trend: 'stable', level: 'low', percentile15d: 30, ptc15d: 5, lastUpdated: '2025-02-18' },
  ];
  const watches = detectSurgeWatches(signals);
  assert.equal(watches.length, 1);
  assert.match(watches[0], /COVID-19.*3 states/i);
});

test('detectSurgeWatches: returns empty when fewer than 3 jurisdictions are increasing', () => {
  const signals = [
    { pathogen: 'COVID-19', jurisdiction: 'CA', trend: 'increasing', level: 'high', percentile15d: 90, ptc15d: 50, lastUpdated: '2025-02-18' },
    { pathogen: 'COVID-19', jurisdiction: 'TX', trend: 'increasing', level: 'elevated', percentile15d: 70, ptc15d: 35, lastUpdated: '2025-02-18' },
  ];
  assert.deepEqual(detectSurgeWatches(signals), []);
});

test('detectSurgeWatches: counts jurisdictions per-pathogen independently', () => {
  const signals = [
    { pathogen: 'COVID-19', jurisdiction: 'CA', trend: 'increasing', level: 'high', percentile15d: 90, ptc15d: 50, lastUpdated: '2025-02-18' },
    { pathogen: 'COVID-19', jurisdiction: 'TX', trend: 'increasing', level: 'elevated', percentile15d: 70, ptc15d: 35, lastUpdated: '2025-02-18' },
    { pathogen: 'flu_a', jurisdiction: 'CA', trend: 'increasing', level: 'high', percentile15d: 85, ptc15d: 40, lastUpdated: '2025-02-18' },
    { pathogen: 'flu_a', jurisdiction: 'TX', trend: 'increasing', level: 'high', percentile15d: 85, ptc15d: 40, lastUpdated: '2025-02-18' },
    { pathogen: 'flu_a', jurisdiction: 'NY', trend: 'increasing', level: 'high', percentile15d: 85, ptc15d: 40, lastUpdated: '2025-02-18' },
  ];
  const watches = detectSurgeWatches(signals);
  assert.equal(watches.length, 1);
  assert.match(watches[0], /flu_a/);
});
