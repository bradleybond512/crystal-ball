import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseNwssRow,
  parseNwssRows,
  rollupByState,
  computeWeeklySparklines,
  computeNational,
  pickTopSites,
  buildWastewaterSurveillance,
  classifyLevel,
  classifyTrend,
  normalizeStateCode,
  WW_LEVEL_COLOR,
} from '../wastewater-service.ts';

// 2026-05-05 — fixed reference date for deterministic bucketing.
const NOW = Date.parse('2026-05-05T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function row(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    key_plot_id: partial.key_plot_id ?? 'site-x',
    wwtp_jurisdiction: partial.wwtp_jurisdiction ?? 'California',
    wwtp_name: partial.wwtp_name ?? 'WWTP X',
    county_names: partial.county_names ?? 'Los Angeles',
    population_served: partial.population_served ?? 100_000,
    date_end: partial.date_end ?? '2026-05-04',
    percentile: partial.percentile ?? 65,
    ptc_15d: partial.ptc_15d ?? 30,
    ...partial,
  };
}

// ── Classification ────────────────────────────────────────────────────

test('classifyLevel: percentile thresholds', () => {
  assert.equal(classifyLevel(85), 'high');
  assert.equal(classifyLevel(70), 'elevated');
  assert.equal(classifyLevel(50), 'moderate');
  assert.equal(classifyLevel(20), 'low');
  assert.equal(classifyLevel(null), 'low');
});

test('classifyTrend: percent-change thresholds', () => {
  assert.equal(classifyTrend(40), 'rising');
  assert.equal(classifyTrend(-40), 'falling');
  assert.equal(classifyTrend(10), 'stable');
  assert.equal(classifyTrend(null), 'stable');
});

test('normalizeStateCode: name + code + unknown', () => {
  assert.equal(normalizeStateCode('California'), 'CA');
  assert.equal(normalizeStateCode('ca'), 'CA');
  assert.equal(normalizeStateCode('CA'), 'CA');
  assert.equal(normalizeStateCode('Atlantis'), 'Atlantis');
});

// ── Row parsing ───────────────────────────────────────────────────────

test('parseNwssRow: typical row → snapshot', () => {
  const snap = parseNwssRow(row({ percentile: 75, ptc_15d: 28 }));
  assert.ok(snap);
  assert.equal(snap!.stateCode, 'CA');
  assert.equal(snap!.level, 'elevated');
  assert.equal(snap!.trend, 'rising');
  assert.equal(snap!.populationServed, 100_000);
});

test('parseNwssRow: missing date_end → null', () => {
  assert.equal(parseNwssRow(row({ date_end: '' })), null);
});

test('parseNwssRow: rows with no metric at all → null', () => {
  assert.equal(parseNwssRow(row({ percentile: null, ptc_15d: null })), null);
});

test('parseNwssRows: dedupes by site, keeping latest date_end', () => {
  const rows = [
    row({ key_plot_id: 's1', date_end: '2026-04-01', percentile: 30 }),
    row({ key_plot_id: 's1', date_end: '2026-05-01', percentile: 80 }),
    row({ key_plot_id: 's2', date_end: '2026-05-01', percentile: 50 }),
  ];
  const out = parseNwssRows(rows);
  assert.equal(out.length, 2);
  const s1 = out.find((s) => s.siteId === 's1')!;
  assert.equal(s1.lastReport, '2026-05-01');
  assert.equal(s1.percentile15d, 80);
});

// ── State rollups ─────────────────────────────────────────────────────

test('rollupByState: groups by state, computes median percentile + ptc', () => {
  const sites = parseNwssRows([
    row({ key_plot_id: 'ca-1', wwtp_jurisdiction: 'California', percentile: 60, ptc_15d: 20 }),
    row({ key_plot_id: 'ca-2', wwtp_jurisdiction: 'California', percentile: 80, ptc_15d: 40 }),
    row({ key_plot_id: 'ny-1', wwtp_jurisdiction: 'New York', percentile: 30, ptc_15d: -50 }),
  ]);
  const rollups = rollupByState(sites);
  assert.equal(rollups.length, 2);
  const ca = rollups.find((r) => r.stateCode === 'CA')!;
  assert.equal(ca.siteCount, 2);
  assert.equal(ca.medianPercentile15d, 70);
  assert.equal(ca.medianPtc15d, 30);
  assert.equal(ca.trend, 'rising');
  const ny = rollups.find((r) => r.stateCode === 'NY')!;
  assert.equal(ny.trend, 'falling');
});

test('rollupByState: sorts highest-percentile state first', () => {
  const sites = parseNwssRows([
    row({ key_plot_id: 'a', wwtp_jurisdiction: 'Texas', percentile: 30 }),
    row({ key_plot_id: 'b', wwtp_jurisdiction: 'Florida', percentile: 90 }),
    row({ key_plot_id: 'c', wwtp_jurisdiction: 'Ohio', percentile: 60 }),
  ]);
  const rollups = rollupByState(sites);
  assert.deepEqual(rollups.map((r) => r.stateCode), ['FL', 'OH', 'TX']);
});

// ── Sparklines ────────────────────────────────────────────────────────

test('computeWeeklySparklines: 4-bucket array per state, oldest first', () => {
  // Place one row in each weekly bucket relative to NOW.
  const isoFor = (offsetDays: number): string =>
    new Date(NOW - offsetDays * DAY).toISOString().slice(0, 10);
  const rows = [
    row({ key_plot_id: 'a', wwtp_jurisdiction: 'California', date_end: isoFor(2), percentile: 80 }),
    row({ key_plot_id: 'b', wwtp_jurisdiction: 'California', date_end: isoFor(9), percentile: 70 }),
    row({ key_plot_id: 'c', wwtp_jurisdiction: 'California', date_end: isoFor(16), percentile: 60 }),
    row({ key_plot_id: 'd', wwtp_jurisdiction: 'California', date_end: isoFor(23), percentile: 50 }),
  ];
  const out = computeWeeklySparklines(rows, NOW);
  const ca = out.get('CA');
  assert.ok(ca, 'CA series present');
  assert.equal(ca!.length, 4);
  // Oldest week first → values should be 50, 60, 70, 80.
  assert.deepEqual(ca, [50, 60, 70, 80]);
});

test('computeWeeklySparklines: empty input → empty map', () => {
  assert.equal(computeWeeklySparklines([], NOW).size, 0);
});

// ── National summary ─────────────────────────────────────────────────

test('computeNational: rising when ≥40% of states are rising AND > falling', () => {
  const rollups = [
    { state: 'A', stateCode: 'AL', siteCount: 1, medianPercentile15d: 70, medianPtc15d: 40, trend: 'rising' as const, level: 'elevated' as const, sparkline4w: [], populationCovered: 0 },
    { state: 'B', stateCode: 'AK', siteCount: 1, medianPercentile15d: 80, medianPtc15d: 35, trend: 'rising' as const, level: 'high' as const, sparkline4w: [], populationCovered: 0 },
    { state: 'C', stateCode: 'AZ', siteCount: 1, medianPercentile15d: 50, medianPtc15d: 0, trend: 'stable' as const, level: 'moderate' as const, sparkline4w: [], populationCovered: 0 },
  ];
  const nat = computeNational(rollups);
  assert.equal(nat.trend, 'rising');
  assert.equal(nat.activeStates, 3);
  assert.equal(nat.risingStates, 2);
});

test('computeNational: empty rollups → stable + null median', () => {
  const nat = computeNational([]);
  assert.equal(nat.trend, 'stable');
  assert.equal(nat.medianPercentile15d, null);
  assert.equal(nat.activeStates, 0);
});

// ── Top sites ─────────────────────────────────────────────────────────

test('pickTopSites: highest percentile first, then ptc tiebreaker', () => {
  const sites = parseNwssRows([
    row({ key_plot_id: 'a', percentile: 50, ptc_15d: 5 }),
    row({ key_plot_id: 'b', percentile: 90, ptc_15d: 5 }),
    row({ key_plot_id: 'c', percentile: 90, ptc_15d: 60 }),
  ]);
  const top = pickTopSites(sites, 2);
  assert.equal(top[0]!.siteId, 'c');
  assert.equal(top[1]!.siteId, 'b');
});

// ── Pipeline ──────────────────────────────────────────────────────────

test('buildWastewaterSurveillance: produces national + states + topSites + asOfDate', () => {
  const rows = [
    row({ key_plot_id: 'ca-1', wwtp_jurisdiction: 'California', date_end: '2026-05-04', percentile: 85, ptc_15d: 35 }),
    row({ key_plot_id: 'ca-2', wwtp_jurisdiction: 'California', date_end: '2026-05-04', percentile: 70, ptc_15d: 30 }),
    row({ key_plot_id: 'ny-1', wwtp_jurisdiction: 'New York', date_end: '2026-05-03', percentile: 30, ptc_15d: -40 }),
  ];
  const out = buildWastewaterSurveillance(rows, NOW);
  assert.equal(out.states.length, 2);
  assert.equal(out.asOfDate, '2026-05-04');
  assert.ok(out.topSites.length >= 2);
  assert.equal(out.states[0]!.stateCode, 'CA');
  assert.equal(out.states[0]!.sparkline4w.length, 4);
});

// ── Color ramp ───────────────────────────────────────────────────────

test('WW_LEVEL_COLOR: every level mapped to a hex color', () => {
  for (const level of ['low', 'moderate', 'elevated', 'high'] as const) {
    assert.match(WW_LEVEL_COLOR[level], /^#[0-9a-f]{6}$/i);
  }
});
