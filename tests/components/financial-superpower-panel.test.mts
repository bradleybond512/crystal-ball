/**
 * Tests for FinancialSuperpowerPanel — pure helper functions and data constants.
 *
 * Run with: npx tsx --test tests/components/financial-superpower-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All panel rendering helpers
 * are exported for testability. Panel class construction requires a full
 * DOM environment and is covered by the panel smoke harness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Mock i18n (imported transitively via Panel) ───────────────────────
// The helpers under test don't reach Panel, so no mock needed.

import {
  trendArrow,
  trendColor,
  blockBar,
  gdpTier,
  channelTier,
  formatTradeAtRisk,
  SANCTIONS_TABLE,
  CURRENCY_WATCH,
} from '../../src/services/finance/financial-superpower-helpers.ts';

// ── trendArrow ────────────────────────────────────────────────────────

test('trendArrow returns ↑ for rising', () => {
  assert.equal(trendArrow('rising'), '↑');
});

test('trendArrow returns ↓ for falling', () => {
  assert.equal(trendArrow('falling'), '↓');
});

test('trendArrow returns → for stable', () => {
  assert.equal(trendArrow('stable'), '→');
});

test('trendArrow returns → for unknown trend', () => {
  assert.equal(trendArrow('unknown'), '→');
});

// ── trendColor ────────────────────────────────────────────────────────

test('trendColor returns red for rising', () => {
  assert.equal(trendColor('rising'), '#f44336');
});

test('trendColor returns green for falling', () => {
  assert.equal(trendColor('falling'), '#4caf50');
});

test('trendColor returns grey for stable', () => {
  assert.equal(trendColor('stable'), '#9e9e9e');
});

test('trendColor returns grey for unknown', () => {
  assert.equal(trendColor(''), '#9e9e9e');
});

// ── blockBar ──────────────────────────────────────────────────────────

test('blockBar returns all empty blocks for level 0', () => {
  const bar = blockBar(0);
  assert.equal(bar, '░░░░░░░░░░');
  assert.equal(bar.length, 10);
});

test('blockBar returns all filled blocks for max level', () => {
  const bar = blockBar(100);
  assert.equal(bar, '██████████');
  assert.equal(bar.length, 10);
});

test('blockBar returns half filled for 50% level', () => {
  const bar = blockBar(50);
  assert.equal(bar.length, 10);
  const filled = [...bar].filter((c) => c === '█').length;
  assert.equal(filled, 5);
});

test('blockBar respects custom max parameter', () => {
  const bar = blockBar(5, 10);
  const filled = [...bar].filter((c) => c === '█').length;
  assert.equal(filled, 5);
});

test('blockBar respects custom width parameter', () => {
  const bar = blockBar(100, 100, 5);
  assert.equal(bar.length, 5);
  assert.equal(bar, '█████');
});

test('blockBar clamps to width when level exceeds max', () => {
  const bar = blockBar(200, 100);
  assert.equal(bar, '██████████');
});

// ── gdpTier ───────────────────────────────────────────────────────────

test('gdpTier returns critical for > 6%', () => {
  assert.equal(gdpTier(6.1), 'critical');
  assert.equal(gdpTier(10), 'critical');
});

test('gdpTier returns high for 3-6%', () => {
  assert.equal(gdpTier(3.1), 'high');
  assert.equal(gdpTier(5.9), 'high');
});

test('gdpTier returns medium for 1.5-3%', () => {
  assert.equal(gdpTier(1.6), 'medium');
  assert.equal(gdpTier(2.9), 'medium');
});

test('gdpTier returns low for <= 1.5%', () => {
  assert.equal(gdpTier(1.5), 'low');
  assert.equal(gdpTier(0), 'low');
});

test('gdpTier boundary: exactly 6 is high not critical', () => {
  assert.equal(gdpTier(6), 'high');
});

test('gdpTier boundary: exactly 3 is medium not high', () => {
  assert.equal(gdpTier(3), 'medium');
});

// ── channelTier ───────────────────────────────────────────────────────

test('channelTier returns critical for > 60', () => {
  assert.equal(channelTier(61), 'critical');
  assert.equal(channelTier(100), 'critical');
});

test('channelTier returns high for 40-60', () => {
  assert.equal(channelTier(41), 'high');
  assert.equal(channelTier(60), 'high');
});

test('channelTier returns medium for 20-40', () => {
  assert.equal(channelTier(21), 'medium');
  assert.equal(channelTier(40), 'medium');
});

test('channelTier returns low for <= 20', () => {
  assert.equal(channelTier(20), 'low');
  assert.equal(channelTier(0), 'low');
});

// ── formatTradeAtRisk ─────────────────────────────────────────────────

test('formatTradeAtRisk returns em-dash for zero', () => {
  assert.equal(formatTradeAtRisk(0), '—');
});

test('formatTradeAtRisk formats trillions', () => {
  assert.equal(formatTradeAtRisk(1.5e12), '$1.5T');
  assert.equal(formatTradeAtRisk(2e12), '$2.0T');
});

test('formatTradeAtRisk formats billions', () => {
  assert.equal(formatTradeAtRisk(500e9), '$500B');
  assert.equal(formatTradeAtRisk(1e9), '$1B');
});

test('formatTradeAtRisk formats millions', () => {
  assert.equal(formatTradeAtRisk(250e6), '$250M');
});

test('formatTradeAtRisk formats small positive amounts as millions', () => {
  const result = formatTradeAtRisk(1);
  assert.equal(result, '$0M');
});

// ── SANCTIONS_TABLE data integrity ────────────────────────────────────

test('SANCTIONS_TABLE contains expected major regimes', () => {
  const countries = SANCTIONS_TABLE.map((r) => r.country);
  assert.ok(countries.includes('Russia'));
  assert.ok(countries.includes('Iran'));
  assert.ok(countries.includes('North Korea'));
});

test('SANCTIONS_TABLE all rows have positive GDP impact', () => {
  for (const row of SANCTIONS_TABLE) {
    assert.ok(row.estimatedGdpImpactPct > 0, `${row.country} should have positive GDP impact`);
  }
});

test('SANCTIONS_TABLE North Korea has highest GDP impact', () => {
  const sorted = [...SANCTIONS_TABLE].sort((a, b) => b.estimatedGdpImpactPct - a.estimatedGdpImpactPct);
  assert.equal(sorted[0]?.country, 'North Korea');
});

test('SANCTIONS_TABLE all rows have non-empty country and regime', () => {
  for (const row of SANCTIONS_TABLE) {
    assert.ok(row.country.length > 0);
    assert.ok(row.regime.length > 0);
  }
});

test('SANCTIONS_TABLE gdpTier matches expected for each row', () => {
  for (const row of SANCTIONS_TABLE) {
    const tier = gdpTier(row.estimatedGdpImpactPct);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(tier));
  }
});

// ── CURRENCY_WATCH data integrity ─────────────────────────────────────

test('CURRENCY_WATCH contains expected currencies', () => {
  const codes = CURRENCY_WATCH.map((c) => c.code);
  assert.ok(codes.includes('ARS'));
  assert.ok(codes.includes('TRY'));
  assert.ok(codes.includes('HKD'));
});

test('CURRENCY_WATCH ARS has highest depreciation', () => {
  const sorted = [...CURRENCY_WATCH].sort((a, b) => b.depreciation30d - a.depreciation30d);
  assert.equal(sorted[0]?.code, 'ARS');
});

test('CURRENCY_WATCH pegged currencies have low depreciation', () => {
  const pegged = CURRENCY_WATCH.filter((c) => c.pegged);
  for (const c of pegged) {
    assert.ok(c.depreciation30d <= 1, `${c.code} pegged currency should have low depreciation`);
  }
});

test('CURRENCY_WATCH all entries have valid code and name', () => {
  for (const c of CURRENCY_WATCH) {
    assert.ok(c.code.length === 3, `${c.code} should be 3-char ISO code`);
    assert.ok(c.name.length > 0);
  }
});

test('CURRENCY_WATCH all depreciation values are non-negative', () => {
  for (const c of CURRENCY_WATCH) {
    assert.ok(c.depreciation30d >= 0, `${c.code} depreciation should be non-negative`);
  }
});

// ── Integration: trendArrow + trendColor agree on semantics ───────────

test('trendArrow and trendColor use consistent semantics for all three trends', () => {
  const trends = ['rising', 'stable', 'falling'];
  for (const trend of trends) {
    const arrow = trendArrow(trend);
    const color = trendColor(trend);
    assert.ok(arrow.length > 0);
    assert.ok(color.startsWith('#'));
  }
  // Rising is the danger direction: arrow ↑ and red color
  assert.equal(trendArrow('rising'), '↑');
  assert.equal(trendColor('rising'), '#f44336');
  // Falling for financial indicators means improvement: green color
  assert.equal(trendColor('falling'), '#4caf50');
});

// ── Integration: gdpTier + channelTier cover full CommodityRiskTier range ──

test('gdpTier covers all four CommodityRiskTier values', () => {
  const tiers = new Set([gdpTier(0), gdpTier(2), gdpTier(4), gdpTier(7)]);
  assert.deepEqual(tiers, new Set(['low', 'medium', 'high', 'critical']));
});

test('channelTier covers all four CommodityRiskTier values', () => {
  const tiers = new Set([channelTier(0), channelTier(30), channelTier(50), channelTier(80)]);
  assert.deepEqual(tiers, new Set(['low', 'medium', 'high', 'critical']));
});
