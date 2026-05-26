/**
 * Tests for StateFragilityPanel — pure helper functions, tier ladder,
 * pillar aggregation, hot-driver lookup, format helpers, and headline
 * count. Pure-logic only; no DOM.
 *
 * Run: npx tsx --test tests/components/state-fragility-panel.test.mts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fsiTier,
  fsiTierLabel,
  fsiTierColor,
  pillarTotal,
  hottestIndicator,
  legitimacyScoreSeverity,
  severityColor,
  severityLabel,
  formatDelta,
  deltaColor,
  formatCount,
  formatTimeAgo,
  governanceLabel,
  securityLabel,
  economicLabel,
  displacementLabel,
  fractureLabel,
  legitimacyLabel,
  fragilityHeadlineCount,
  INDICATOR_PILLAR,
  INDICATOR_LABEL,
  FRAGILE_STATES,
  GOVERNANCE_SIGNALS,
  SECURITY_SIGNALS,
  ECONOMIC_MARKERS,
  DISPLACEMENT_PRESSURES,
  ELITE_FRACTURES,
  LEGITIMACY_PROXIES,
  type FragileState,
  type FsiIndicator,
  type FsiIndicatorCode,
  type EliteFractureEvent,
  type EconomicMarker,
} from '../../src/components/state-fragility-helpers.ts';

// ── fsiTier ────────────────────────────────────────────────────────────

test('fsiTier: 115 → very_high_alert', () => {
  assert.equal(fsiTier(115), 'very_high_alert');
});

test('fsiTier: 110 (boundary) → very_high_alert', () => {
  assert.equal(fsiTier(110), 'very_high_alert');
});

test('fsiTier: 109.9 → high_alert', () => {
  assert.equal(fsiTier(109.9), 'high_alert');
});

test('fsiTier: 100 (boundary) → high_alert', () => {
  assert.equal(fsiTier(100), 'high_alert');
});

test('fsiTier: 95 → alert', () => {
  assert.equal(fsiTier(95), 'alert');
});

test('fsiTier: 80 (boundary) → high_warning', () => {
  assert.equal(fsiTier(80), 'high_warning');
});

test('fsiTier: 70 (boundary) → elevated_warning', () => {
  assert.equal(fsiTier(70), 'elevated_warning');
});

test('fsiTier: 60 (boundary) → warning', () => {
  assert.equal(fsiTier(60), 'warning');
});

test('fsiTier: 45 → stable', () => {
  assert.equal(fsiTier(45), 'stable');
});

test('fsiTier: 25 → sustainable', () => {
  assert.equal(fsiTier(25), 'sustainable');
});

test('fsiTier: 0 → sustainable', () => {
  assert.equal(fsiTier(0), 'sustainable');
});

// ── fsiTierLabel + fsiTierColor coverage ──────────────────────────────

test('fsiTierLabel covers all eight tiers', () => {
  assert.equal(fsiTierLabel('very_high_alert'), 'Very high alert');
  assert.equal(fsiTierLabel('high_alert'),      'High alert');
  assert.equal(fsiTierLabel('alert'),           'Alert');
  assert.equal(fsiTierLabel('high_warning'),    'High warning');
  assert.equal(fsiTierLabel('elevated_warning'),'Elevated warning');
  assert.equal(fsiTierLabel('warning'),         'Warning');
  assert.equal(fsiTierLabel('stable'),          'Stable');
  assert.equal(fsiTierLabel('sustainable'),     'Sustainable');
});

test('fsiTierColor escalates red as tier worsens', () => {
  // very_high_alert is darker than alert which is darker than sustainable.
  assert.equal(fsiTierColor('very_high_alert'), '#b71c1c');
  assert.equal(fsiTierColor('sustainable'),     '#4caf50');
  assert.notEqual(fsiTierColor('alert'), fsiTierColor('warning'));
});

// ── pillarTotal ───────────────────────────────────────────────────────

test('pillarTotal: sums only matching pillar indicators', () => {
  const indicators: FsiIndicator[] = [
    { code: 'C1', label: 'x', pillar: 'cohesion',  score: 9 },
    { code: 'C2', label: 'x', pillar: 'cohesion',  score: 8 },
    { code: 'E1', label: 'x', pillar: 'economic',  score: 7 },
    { code: 'P1', label: 'x', pillar: 'political', score: 6 },
  ];
  const state: FragileState = {
    country: 'X', countryCode: 'XX', fsiScore: 30, rank: 99, yearDelta: 0,
    indicators,
  };
  assert.equal(pillarTotal(state, 'cohesion'), 17);
  assert.equal(pillarTotal(state, 'economic'), 7);
  assert.equal(pillarTotal(state, 'political'), 6);
  assert.equal(pillarTotal(state, 'social'), 0);
});

test('pillarTotal: empty indicator list → 0', () => {
  const state: FragileState = {
    country: 'X', countryCode: 'XX', fsiScore: 0, rank: 99, yearDelta: 0, indicators: [],
  };
  assert.equal(pillarTotal(state, 'cohesion'), 0);
});

// ── hottestIndicator ──────────────────────────────────────────────────

test('hottestIndicator: returns max-score indicator', () => {
  const state: FragileState = {
    country: 'X', countryCode: 'XX', fsiScore: 30, rank: 99, yearDelta: 0,
    indicators: [
      { code: 'C1', label: 'x', pillar: 'cohesion', score: 5 },
      { code: 'E1', label: 'x', pillar: 'economic', score: 9.8 },
      { code: 'S2', label: 'x', pillar: 'social',   score: 7 },
    ],
  };
  const hot = hottestIndicator(state);
  assert.equal(hot?.code, 'E1');
  assert.equal(hot?.score, 9.8);
});

test('hottestIndicator: undefined when no indicators', () => {
  const state: FragileState = {
    country: 'X', countryCode: 'XX', fsiScore: 0, rank: 99, yearDelta: 0, indicators: [],
  };
  assert.equal(hottestIndicator(state), undefined);
});

// ── severityColor / severityLabel coverage ───────────────────────────

test('severityColor: ladder distinct', () => {
  const a = severityColor(1), b = severityColor(2), c = severityColor(3), d = severityColor(4);
  assert.equal(new Set([a, b, c, d]).size, 4);
});

test('legitimacyScoreSeverity: ladder 1-4 by score', () => {
  assert.equal(legitimacyScoreSeverity(80), 4);
  assert.equal(legitimacyScoreSeverity(75), 4);
  assert.equal(legitimacyScoreSeverity(70), 3);
  assert.equal(legitimacyScoreSeverity(65), 3);
  assert.equal(legitimacyScoreSeverity(60), 2);
  assert.equal(legitimacyScoreSeverity(50), 2);
  assert.equal(legitimacyScoreSeverity(40), 1);
  assert.equal(legitimacyScoreSeverity(0), 1);
});

test('severityLabel: critical at 4, watch at 1', () => {
  assert.equal(severityLabel(1), 'Watch');
  assert.equal(severityLabel(2), 'Elevated');
  assert.equal(severityLabel(3), 'Alert');
  assert.equal(severityLabel(4), 'Critical');
});

// ── formatDelta + deltaColor ──────────────────────────────────────────

test('formatDelta: positive number gets +', () => {
  assert.equal(formatDelta(1.5), '+1.5');
});

test('formatDelta: negative number gets minus-sign', () => {
  assert.equal(formatDelta(-2.3), '−2.3');
});

test('formatDelta: zero → ±0.0', () => {
  assert.equal(formatDelta(0), '±0.0');
});

test('deltaColor: big positive (>=2) → red', () => {
  assert.equal(deltaColor(2.5), '#f44336');
});

test('deltaColor: small positive (>=0.5) → orange', () => {
  assert.equal(deltaColor(0.6), '#ff9800');
});

test('deltaColor: between -0.5 and +0.5 → grey', () => {
  assert.equal(deltaColor(0.1), '#9e9e9e');
  assert.equal(deltaColor(-0.1), '#9e9e9e');
});

test('deltaColor: strong improvement (<=-2) → green', () => {
  assert.equal(deltaColor(-2.5), '#4caf50');
});

// ── formatCount ───────────────────────────────────────────────────────

test('formatCount: <1k stays as raw integer', () => {
  assert.equal(formatCount(420), '420');
});

test('formatCount: 1k → k', () => {
  assert.equal(formatCount(8500), '9k');
});

test('formatCount: 1M → M', () => {
  assert.equal(formatCount(2_400_000), '2.4M');
});

// ── formatTimeAgo ─────────────────────────────────────────────────────

test('formatTimeAgo: seconds', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 10_000, now), '10s ago');
});

test('formatTimeAgo: minutes', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 3 * 60_000, now), '3m ago');
});

test('formatTimeAgo: hours', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 5 * 3_600_000, now), '5h ago');
});

test('formatTimeAgo: days', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 4 * 86_400_000, now), '4d ago');
});

test('formatTimeAgo: months', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatTimeAgo(now - 90 * 86_400_000, now), '3mo ago');
});

// ── Label helpers ────────────────────────────────────────────────────

test('governanceLabel covers all kinds', () => {
  assert.equal(governanceLabel('corruption_spike'),         'Corruption spike');
  assert.equal(governanceLabel('judicial_capture'),         'Judicial capture');
  assert.equal(governanceLabel('press_freedom_decline'),    'Press freedom decline');
  assert.equal(governanceLabel('public_services_collapse'), 'Public services collapse');
  assert.equal(governanceLabel('elections_postponed'),      'Elections postponed');
});

test('securityLabel covers all kinds', () => {
  assert.equal(securityLabel('military_fracture'),   'Military fracture');
  assert.equal(securityLabel('paramilitary_rise'),   'Paramilitary rise');
  assert.equal(securityLabel('security_defection'),  'Security force defection');
  assert.equal(securityLabel('territory_loss'),      'Territory loss');
  assert.equal(securityLabel('armed_proliferation'), 'Armed group proliferation');
});

test('economicLabel covers all kinds', () => {
  assert.equal(economicLabel('hyperinflation'),       'Hyperinflation');
  assert.equal(economicLabel('capital_flight'),       'Capital flight');
  assert.equal(economicLabel('debt_distress'),        'Debt distress');
  assert.equal(economicLabel('currency_collapse'),    'Currency collapse');
  assert.equal(economicLabel('sovereign_default'),    'Sovereign default');
  assert.equal(economicLabel('fx_reserves_depleted'), 'FX reserves depleted');
});

test('displacementLabel covers all kinds', () => {
  assert.equal(displacementLabel('idp'),             'Internally displaced');
  assert.equal(displacementLabel('refugee_outflow'), 'Refugee outflow');
  assert.equal(displacementLabel('refugee_inflow'),  'Refugee inflow');
  assert.equal(displacementLabel('returnee_strain'), 'Returnee strain');
});

test('fractureLabel covers all kinds', () => {
  assert.equal(fractureLabel('coup'),                   'Coup');
  assert.equal(fractureLabel('coup_attempt'),           'Coup attempt');
  assert.equal(fractureLabel('purge'),                  'Purge');
  assert.equal(fractureLabel('defection'),              'High-level defection');
  assert.equal(fractureLabel('ruling_coalition_split'), 'Coalition split');
  assert.equal(fractureLabel('succession_crisis'),      'Succession crisis');
});

test('legitimacyLabel covers all kinds', () => {
  assert.equal(legitimacyLabel('protest_momentum'),       'Protest momentum');
  assert.equal(legitimacyLabel('contested_election'),     'Contested election');
  assert.equal(legitimacyLabel('media_freedom_decline'),  'Media freedom decline');
  assert.equal(legitimacyLabel('civil_society_crackdown'),'Civil society crackdown');
  assert.equal(legitimacyLabel('opposition_arrests'),     'Opposition arrests');
});

// ── Indicator pillar / label maps ────────────────────────────────────

test('INDICATOR_PILLAR groups by pillar correctly', () => {
  const cohesion: FsiIndicatorCode[] = ['C1', 'C2', 'C3'];
  const economic: FsiIndicatorCode[] = ['E1', 'E2', 'E3'];
  const political: FsiIndicatorCode[] = ['P1', 'P2', 'P3'];
  const social: FsiIndicatorCode[] = ['S1', 'S2', 'X1'];
  for (const c of cohesion)  assert.equal(INDICATOR_PILLAR[c], 'cohesion');
  for (const c of economic)  assert.equal(INDICATOR_PILLAR[c], 'economic');
  for (const c of political) assert.equal(INDICATOR_PILLAR[c], 'political');
  for (const c of social)    assert.equal(INDICATOR_PILLAR[c], 'social');
});

test('INDICATOR_LABEL: every code has a non-empty label', () => {
  const codes: FsiIndicatorCode[] =
    ['C1','C2','C3','E1','E2','E3','P1','P2','P3','S1','S2','X1'];
  for (const c of codes) {
    assert.ok(INDICATOR_LABEL[c].length > 0, `missing label for ${c}`);
  }
});

// ── Fixture invariants ───────────────────────────────────────────────

test('FRAGILE_STATES: ranks are unique', () => {
  const ranks = FRAGILE_STATES.map((s) => s.rank);
  assert.equal(new Set(ranks).size, ranks.length);
});

test('FRAGILE_STATES: every entry has 12 indicators', () => {
  for (const s of FRAGILE_STATES) {
    assert.equal(s.indicators.length, 12, `${s.country} has ${s.indicators.length} indicators`);
  }
});

test('FRAGILE_STATES: indicator score sum is plausibly close to composite', () => {
  // FSI is a weighted composite, not a simple sum, so values drift a few
  // points. ±5 keeps the fixture honest without overconstraining methodology.
  for (const s of FRAGILE_STATES) {
    const sum = s.indicators.reduce((a, i) => a + i.score, 0);
    assert.ok(Math.abs(sum - s.fsiScore) < 5.0,
      `${s.country}: sum=${sum.toFixed(2)} score=${s.fsiScore}`);
  }
});

test('FRAGILE_STATES: every indicator score is within 0–10', () => {
  for (const s of FRAGILE_STATES) {
    for (const i of s.indicators) {
      assert.ok(i.score >= 0 && i.score <= 10, `${s.country}/${i.code} = ${i.score}`);
    }
  }
});

test('FRAGILE_STATES: top of list is in high_alert or very_high_alert', () => {
  const sorted = [...FRAGILE_STATES].sort((a, b) => b.fsiScore - a.fsiScore);
  const tier = fsiTier(sorted[0].fsiScore);
  assert.ok(tier === 'high_alert' || tier === 'very_high_alert', `got ${tier}`);
});

test('GOVERNANCE_SIGNALS: severities are all 1–4', () => {
  for (const g of GOVERNANCE_SIGNALS) assert.ok(g.severity >= 1 && g.severity <= 4);
});

test('SECURITY_SIGNALS: at least one critical entry', () => {
  assert.ok(SECURITY_SIGNALS.some((s) => s.severity === 4));
});

test('ECONOMIC_MARKERS: every entry has non-empty country + detail', () => {
  for (const e of ECONOMIC_MARKERS) {
    assert.ok(e.country.length > 0);
    assert.ok(e.detail.length > 0);
  }
});

test('DISPLACEMENT_PRESSURES: counts are non-negative', () => {
  for (const d of DISPLACEMENT_PRESSURES) assert.ok(d.count >= 0);
});

test('ELITE_FRACTURES: timestamps are in the past', () => {
  const now = Date.now();
  for (const f of ELITE_FRACTURES) assert.ok(f.timestamp <= now);
});

test('LEGITIMACY_PROXIES: scores are 0–100', () => {
  for (const l of LEGITIMACY_PROXIES) {
    assert.ok(l.score >= 0 && l.score <= 100);
  }
});

// ── fragilityHeadlineCount ───────────────────────────────────────────

test('fragilityHeadlineCount: counts states ≥100, fractures sev≥3, econ sev≥3', () => {
  const states: FragileState[] = [
    { country: 'A', countryCode: 'AA', fsiScore: 105, rank: 1, yearDelta: 0, indicators: [] },
    { country: 'B', countryCode: 'BB', fsiScore: 90,  rank: 2, yearDelta: 0, indicators: [] },
  ];
  const fractures: EliteFractureEvent[] = [
    { country: 'X', kind: 'coup',         timestamp: 1, severity: 4, detail: '' },
    { country: 'Y', kind: 'coup_attempt', timestamp: 1, severity: 2, detail: '' },
  ];
  const econ: EconomicMarker[] = [
    { country: 'Z', kind: 'sovereign_default', value: 1, unit: 'B', severity: 4, detail: '' },
    { country: 'W', kind: 'capital_flight',    value: 1, unit: 'B', severity: 2, detail: '' },
  ];
  // 1 (state) + 1 (fracture sev 4) + 1 (econ sev 4) = 3
  assert.equal(fragilityHeadlineCount(states, fractures, econ), 3);
});

test('fragilityHeadlineCount: empty inputs → 0', () => {
  assert.equal(fragilityHeadlineCount([], [], []), 0);
});

test('fragilityHeadlineCount: real fixture data returns positive count', () => {
  const c = fragilityHeadlineCount(FRAGILE_STATES, ELITE_FRACTURES, ECONOMIC_MARKERS);
  assert.ok(c > 0);
});
