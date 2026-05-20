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
  computeGaugeScore,
  gaugeTier,
  gaugeColor,
  drawdownTier,
  phaseLabel,
  phaseColor,
  trajectoryLabel,
  trajectoryColor,
  systemicColor,
  systemicIcon,
  SANCTIONS_TABLE,
  CURRENCY_WATCH,
  DRAWDOWN_SIGNALS,
  SYSTEMIC_INDICATORS,
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

// ── computeGaugeScore ─────────────────────────────────────────────────

test('computeGaugeScore returns 0 for empty channels', () => {
  assert.equal(computeGaugeScore([]), 0);
});

test('computeGaugeScore averages the three gauge channels', () => {
  const channels = [
    { channel: 'VIX Spike',              stressLevel: 60 },
    { channel: 'Credit Spread Widening', stressLevel: 40 },
    { channel: 'Currency Crisis',        stressLevel: 20 },
  ];
  assert.equal(computeGaugeScore(channels), 40);
});

test('computeGaugeScore is case-insensitive for channel names', () => {
  const channels = [
    { channel: 'vix spike',              stressLevel: 80 },
    { channel: 'credit spread widening', stressLevel: 80 },
    { channel: 'currency crisis',        stressLevel: 80 },
  ];
  assert.equal(computeGaugeScore(channels), 80);
});

test('computeGaugeScore falls back to overall average when gauge channels absent', () => {
  const channels = [
    { channel: 'bank stress',       stressLevel: 30 },
    { channel: 'commodity shock',   stressLevel: 70 },
  ];
  assert.equal(computeGaugeScore(channels), 50);
});

test('computeGaugeScore clamps to 100', () => {
  const channels = [
    { channel: 'vix spike',              stressLevel: 100 },
    { channel: 'credit spread widening', stressLevel: 100 },
    { channel: 'currency crisis',        stressLevel: 100 },
  ];
  assert.equal(computeGaugeScore(channels), 100);
});

test('computeGaugeScore ignores non-gauge channels when gauge channels present', () => {
  const channels = [
    { channel: 'vix spike',              stressLevel: 50 },
    { channel: 'credit spread widening', stressLevel: 50 },
    { channel: 'currency crisis',        stressLevel: 50 },
    { channel: 'bank stress',            stressLevel: 100 }, // should be ignored
  ];
  assert.equal(computeGaugeScore(channels), 50);
});

// ── gaugeTier ─────────────────────────────────────────────────────────

test('gaugeTier returns severe for score >= 75', () => {
  assert.equal(gaugeTier(75), 'severe');
  assert.equal(gaugeTier(100), 'severe');
});

test('gaugeTier returns elevated for score 50–74', () => {
  assert.equal(gaugeTier(50), 'elevated');
  assert.equal(gaugeTier(74), 'elevated');
});

test('gaugeTier returns normal for score 25–49', () => {
  assert.equal(gaugeTier(25), 'normal');
  assert.equal(gaugeTier(49), 'normal');
});

test('gaugeTier returns calm for score < 25', () => {
  assert.equal(gaugeTier(0), 'calm');
  assert.equal(gaugeTier(24), 'calm');
});

// ── gaugeColor ────────────────────────────────────────────────────────

test('gaugeColor returns green for calm', () => {
  assert.equal(gaugeColor('calm'), '#4caf50');
});

test('gaugeColor returns grey for normal', () => {
  assert.equal(gaugeColor('normal'), '#9e9e9e');
});

test('gaugeColor returns orange for elevated', () => {
  assert.equal(gaugeColor('elevated'), '#ff9800');
});

test('gaugeColor returns red for severe', () => {
  assert.equal(gaugeColor('severe'), '#d50000');
});

// ── drawdownTier ──────────────────────────────────────────────────────

test('drawdownTier returns critical for >= 20%', () => {
  assert.equal(drawdownTier(20), 'critical');
  assert.equal(drawdownTier(50), 'critical');
});

test('drawdownTier returns high for 10–19%', () => {
  assert.equal(drawdownTier(10), 'high');
  assert.equal(drawdownTier(19), 'high');
});

test('drawdownTier returns medium for 5–9%', () => {
  assert.equal(drawdownTier(5), 'medium');
  assert.equal(drawdownTier(9), 'medium');
});

test('drawdownTier returns low for < 5%', () => {
  assert.equal(drawdownTier(0), 'low');
  assert.equal(drawdownTier(4), 'low');
});

// ── phaseLabel ────────────────────────────────────────────────────────

test('phaseLabel returns deepening label', () => {
  assert.ok(phaseLabel('deepening').includes('Deepening'));
});

test('phaseLabel returns plateauing label', () => {
  assert.ok(phaseLabel('plateauing').includes('Plateauing'));
});

test('phaseLabel returns recovering label', () => {
  assert.ok(phaseLabel('recovering').includes('Recovering'));
});

// ── phaseColor ────────────────────────────────────────────────────────

test('phaseColor returns red for deepening', () => {
  assert.equal(phaseColor('deepening'), '#d50000');
});

test('phaseColor returns orange for plateauing', () => {
  assert.equal(phaseColor('plateauing'), '#ff9800');
});

test('phaseColor returns green for recovering', () => {
  assert.equal(phaseColor('recovering'), '#4caf50');
});

// ── trajectoryLabel ───────────────────────────────────────────────────

test('trajectoryLabel returns worsening label', () => {
  assert.ok(trajectoryLabel('worsening').includes('Worsening'));
});

test('trajectoryLabel returns stabilizing label', () => {
  assert.ok(trajectoryLabel('stabilizing').includes('Stabilizing'));
});

test('trajectoryLabel returns stable label', () => {
  assert.ok(trajectoryLabel('stable').includes('Stable'));
});

// ── trajectoryColor ───────────────────────────────────────────────────

test('trajectoryColor returns red for worsening', () => {
  assert.equal(trajectoryColor('worsening'), '#d50000');
});

test('trajectoryColor returns orange for stabilizing', () => {
  assert.equal(trajectoryColor('stabilizing'), '#ff9800');
});

test('trajectoryColor returns grey for stable', () => {
  assert.equal(trajectoryColor('stable'), '#9e9e9e');
});

// ── systemicColor ─────────────────────────────────────────────────────

test('systemicColor returns red for severe', () => {
  assert.equal(systemicColor('severe'), '#d50000');
});

test('systemicColor returns orange for elevated', () => {
  assert.equal(systemicColor('elevated'), '#ff9800');
});

test('systemicColor returns green for normal', () => {
  assert.equal(systemicColor('normal'), '#4caf50');
});

// ── systemicIcon ──────────────────────────────────────────────────────

test('systemicIcon returns ✖ for severe', () => {
  assert.equal(systemicIcon('severe'), '✖');
});

test('systemicIcon returns ⚠ for elevated', () => {
  assert.equal(systemicIcon('elevated'), '⚠');
});

test('systemicIcon returns ✔ for normal', () => {
  assert.equal(systemicIcon('normal'), '✔');
});

// ── DRAWDOWN_SIGNALS data integrity ───────────────────────────────────

test('DRAWDOWN_SIGNALS has at least 3 entries', () => {
  assert.ok(DRAWDOWN_SIGNALS.length >= 3);
});

test('DRAWDOWN_SIGNALS all entries have valid phase values', () => {
  const validPhases = new Set(['deepening', 'plateauing', 'recovering']);
  for (const d of DRAWDOWN_SIGNALS) {
    assert.ok(validPhases.has(d.phase), `${d.index} has invalid phase ${d.phase}`);
  }
});

test('DRAWDOWN_SIGNALS all entries have non-negative declinePct', () => {
  for (const d of DRAWDOWN_SIGNALS) {
    assert.ok(d.declinePct >= 0, `${d.index} declinePct should be non-negative`);
  }
});

test('DRAWDOWN_SIGNALS all entries have positive durationDays', () => {
  for (const d of DRAWDOWN_SIGNALS) {
    assert.ok(d.durationDays > 0, `${d.index} durationDays should be positive`);
  }
});

test('DRAWDOWN_SIGNALS entries include emerging market signals', () => {
  const regions = DRAWDOWN_SIGNALS.map((d) => d.region.toLowerCase());
  assert.ok(regions.some((r) => r.includes('emerging') || r.includes('china') || r.includes('japan')));
});

// ── SYSTEMIC_INDICATORS data integrity ────────────────────────────────

test('SYSTEMIC_INDICATORS has entries from all three categories', () => {
  const cats = new Set(SYSTEMIC_INDICATORS.map((i) => i.category));
  assert.ok(cats.has('interbank'));
  assert.ok(cats.has('central_bank'));
  assert.ok(cats.has('exchange'));
});

test('SYSTEMIC_INDICATORS all severity values are valid', () => {
  const valid = new Set(['normal', 'elevated', 'severe']);
  for (const ind of SYSTEMIC_INDICATORS) {
    assert.ok(valid.has(ind.severity), `${ind.name} has invalid severity ${ind.severity}`);
  }
});

test('SYSTEMIC_INDICATORS all entries have non-empty name and detail', () => {
  for (const ind of SYSTEMIC_INDICATORS) {
    assert.ok(ind.name.length > 0);
    assert.ok(ind.detail.length > 0);
  }
});

// ── CURRENCY_WATCH new fields ─────────────────────────────────────────

test('CURRENCY_WATCH all entries have valid trajectory', () => {
  const validTrajectories = new Set(['worsening', 'stabilizing', 'stable']);
  for (const c of CURRENCY_WATCH) {
    assert.ok(validTrajectories.has(c.trajectory), `${c.code} has invalid trajectory ${c.trajectory}`);
  }
});

test('CURRENCY_WATCH capitalControls field is boolean for all entries', () => {
  for (const c of CURRENCY_WATCH) {
    assert.equal(typeof c.capitalControls, 'boolean');
  }
});

test('CURRENCY_WATCH crisis-level currencies have capital controls in majority', () => {
  const crisis = CURRENCY_WATCH.filter((c) => c.depreciation30d >= 5);
  const withControls = crisis.filter((c) => c.capitalControls);
  assert.ok(withControls.length >= crisis.length / 2, 'Most crisis currencies should have capital controls');
});

test('CURRENCY_WATCH ETB trajectory is worsening', () => {
  const etb = CURRENCY_WATCH.find((c) => c.code === 'ETB');
  assert.ok(etb);
  assert.equal(etb.trajectory, 'worsening');
});

test('CURRENCY_WATCH pegged stable currencies have stable trajectory', () => {
  const stablePergs = CURRENCY_WATCH.filter((c) => c.pegged && c.depreciation30d === 0);
  for (const c of stablePergs) {
    assert.equal(c.trajectory, 'stable', `${c.code} should have stable trajectory`);
  }
});
