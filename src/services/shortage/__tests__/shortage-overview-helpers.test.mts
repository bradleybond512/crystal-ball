import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOverviewRows,
  countByRiskLevel,
  isUnwired,
} from '../shortage-overview-helpers.ts';
import type { ShortageSummaryEntry, FullSetCommodity, RiskLevel, Trend } from '../shortage-fullset.ts';

function entry(
  commodity: FullSetCommodity,
  riskScore: number,
  riskLevel: RiskLevel,
  drivers: string[] = [],
  trend: Trend = 'stable',
  dataGaps: string[] = [],
): ShortageSummaryEntry {
  return {
    commodity,
    riskScore,
    riskLevel,
    primaryDrivers: drivers,
    timeToImpact: '30d',
    trend,
    forecast: {
      commodity,
      domain: 'food',
      region: 'global',
      horizonDays: 60,
      riskScore,
      confidence: 'medium',
      drivers: [],
      confirmingIndicators: [],
      invalidatingIndicators: [],
      dataGaps,
      lastUpdated: '2026-05-12T00:00:00Z',
    },
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

// ── unwired (NO DATA) detection ───────────────────────────────────────────

test('isUnwired: score 0 + zero drivers + 3+ data gaps → true', () => {
  assert.equal(isUnwired(entry('wheat', 0, 'LOW', [], 'stable', ['a', 'b', 'c'])), true);
});

test('isUnwired: 0 drivers + 0 score but only 2 gaps → false (partial signal)', () => {
  assert.equal(isUnwired(entry('wheat', 0, 'LOW', [], 'stable', ['a', 'b'])), false);
});

test('isUnwired: nonzero riskScore → false even when many gaps', () => {
  assert.equal(isUnwired(entry('wheat', 10, 'LOW', [], 'stable', ['a', 'b', 'c', 'd'])), false);
});

test('isUnwired: drivers present → false', () => {
  assert.equal(isUnwired(entry('wheat', 0, 'LOW', ['some driver'], 'stable', ['a', 'b', 'c'])), false);
});

test('buildOverviewRows flags unwired entries', () => {
  const rows = buildOverviewRows([
    entry('wheat', 0, 'LOW', [], 'stable', ['rainfall', 'soil', 'price', 'corridor']),
    entry('corn', 60, 'HIGH', ['drought']),
  ]);
  const wheatRow = rows.find((r) => r.commodity === 'wheat');
  const cornRow  = rows.find((r) => r.commodity === 'corn');
  assert.equal(wheatRow?.unwired, true);
  assert.equal(cornRow?.unwired, false);
});
