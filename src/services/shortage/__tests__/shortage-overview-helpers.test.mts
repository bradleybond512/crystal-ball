import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOverviewRows,
  countByRiskLevel,
} from '../shortage-overview-helpers.ts';
import type { ShortageSummaryEntry, FullSetCommodity, RiskLevel, Trend } from '../shortage-fullset.ts';

function entry(
  commodity: FullSetCommodity,
  riskScore: number,
  riskLevel: RiskLevel,
  drivers: string[] = [],
  trend: Trend = 'stable',
): ShortageSummaryEntry {
  return {
    commodity,
    riskScore,
    riskLevel,
    primaryDrivers: drivers,
    timeToImpact: '30d',
    trend,
    // The full forecast isn't read by the helpers; cast through unknown.
    forecast: {} as unknown as ShortageSummaryEntry['forecast'],
  };
}

test('buildOverviewRows sorts by risk level first (CRITICAL → LOW)', () => {
  const rows = buildOverviewRows([
    entry('wheat', 10, 'LOW'),
    entry('corn', 95, 'CRITICAL'),
    entry('diesel', 55, 'HIGH'),
    entry('rice', 30, 'MODERATE'),
  ]);
  assert.deepEqual(rows.map((r) => r.commodity), ['corn', 'diesel', 'rice', 'wheat']);
});

test('buildOverviewRows breaks level ties by riskScore desc', () => {
  const rows = buildOverviewRows([
    entry('wheat', 78, 'CRITICAL'),
    entry('corn', 92, 'CRITICAL'),
  ]);
  assert.deepEqual(rows.map((r) => r.commodity), ['corn', 'wheat']);
});

test('buildOverviewRows breaks score+level ties alphabetically by display name', () => {
  const rows = buildOverviewRows([
    entry('soybeans', 50, 'HIGH'),
    entry('diesel', 50, 'HIGH'),
    entry('corn', 50, 'HIGH'),
  ]);
  assert.deepEqual(rows.map((r) => r.commodity), ['corn', 'diesel', 'soybeans']);
});

test('buildOverviewRows maps trend to ↑/↓/→ glyphs', () => {
  const rows = buildOverviewRows([
    entry('wheat', 50, 'HIGH', ['drought'], 'deteriorating'),
    entry('corn', 40, 'MODERATE', ['rain'], 'improving'),
    entry('rice', 30, 'MODERATE', ['steady'], 'stable'),
  ]);
  const m = new Map(rows.map((r) => [r.commodity, r.trendArrow]));
  assert.equal(m.get('wheat'), '↑');
  assert.equal(m.get('corn'), '↓');
  assert.equal(m.get('rice'), '→');
});

test('buildOverviewRows uses "—" for topDriver when drivers list is empty', () => {
  const rows = buildOverviewRows([entry('wheat', 10, 'LOW', [])]);
  assert.equal(rows[0]?.topDriver, '—');
});

test('buildOverviewRows rounds the displayed risk score', () => {
  const rows = buildOverviewRows([entry('wheat', 73.6, 'CRITICAL')]);
  assert.equal(rows[0]?.riskScore, 74);
});

test('countByRiskLevel tallies all four bands', () => {
  const rows = buildOverviewRows([
    entry('wheat', 95, 'CRITICAL'),
    entry('corn', 92, 'CRITICAL'),
    entry('diesel', 60, 'HIGH'),
    entry('rice', 30, 'MODERATE'),
    entry('gasoline', 10, 'LOW'),
  ]);
  const counts = countByRiskLevel(rows);
  assert.equal(counts.CRITICAL, 2);
  assert.equal(counts.HIGH, 1);
  assert.equal(counts.MODERATE, 1);
  assert.equal(counts.LOW, 1);
});

test('buildOverviewRows produces a fresh array (does not mutate input order)', () => {
  const input = [
    entry('wheat', 10, 'LOW'),
    entry('corn', 95, 'CRITICAL'),
  ];
  buildOverviewRows(input);
  assert.equal(input[0]?.commodity, 'wheat'); // original order preserved
});
