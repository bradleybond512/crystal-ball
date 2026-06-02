import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDistressTier,
  estimateDefaultProbability,
  assessDebtRatios,
  analyzeRatingTrend,
  formatCreditorComposition,
  getDominantCreditor,
  buildCountryRenderData,
  buildPanelSummary,
  getDistressTierColor,
  getDistressTierLabel,
  getImfStatusLabel,
  getImfStatusColor,
  getRatingTrendLabel,
  getRatingTrendColor,
  getCreditorTypeLabel,
  formatDefaultProbability,
  computeSystemicRiskScore,
  getSystemicRiskLabel,
  getSystemicRiskColor,
  sortByDistressTierDesc,
  sortByDefaultProbabilityDesc,
  renderCountryCard,
  renderSummaryHeader,
  MOCK_COUNTRIES,
  type CountryDebtData,
  type CreditRating,
  type CreditorShare,
} from '../sovereign-debt-crisis-helpers.ts';

// ── classifyDistressTier ────────────────────────────────────────────────────

test('classifyDistressTier: in-default when debtServiceRatio >= 90', () => {
  assert.equal(classifyDistressTier(100, 90, false), 'in-default');
});

test('classifyDistressTier: in-default when debtToGdp >= 200 and hasDefaultHistory', () => {
  assert.equal(classifyDistressTier(250, 40, true), 'in-default');
});

test('classifyDistressTier: in-default at extreme debtService 95', () => {
  assert.equal(classifyDistressTier(50, 95, false), 'in-default');
});

test('classifyDistressTier: high-distress when debtToGdp >= 120 and hasDefaultHistory', () => {
  assert.equal(classifyDistressTier(130, 40, true), 'high-distress');
});

test('classifyDistressTier: high-distress when debtServiceRatio >= 75 (no default history)', () => {
  assert.equal(classifyDistressTier(50, 75, false), 'high-distress');
});

test('classifyDistressTier: high-distress when debtService >= 65 and hasDefaultHistory', () => {
  assert.equal(classifyDistressTier(80, 65, true), 'high-distress');
});

test('classifyDistressTier: elevated when debtToGdp >= 85', () => {
  assert.equal(classifyDistressTier(90, 30, false), 'elevated');
});

test('classifyDistressTier: elevated when debtServiceRatio >= 45', () => {
  assert.equal(classifyDistressTier(40, 45, false), 'elevated');
});

test('classifyDistressTier: elevated when debtToGdp >= 60 with default history', () => {
  assert.equal(classifyDistressTier(65, 20, true), 'elevated');
});

test('classifyDistressTier: moderate when debtToGdp >= 45', () => {
  assert.equal(classifyDistressTier(50, 15, false), 'moderate');
});

test('classifyDistressTier: moderate when debtServiceRatio >= 25', () => {
  assert.equal(classifyDistressTier(20, 25, false), 'moderate');
});

test('classifyDistressTier: low for small ratios', () => {
  assert.equal(classifyDistressTier(20, 10, false), 'low');
});

// ── estimateDefaultProbability ──────────────────────────────────────────────

test('estimateDefaultProbability returns value between 0 and 1', () => {
  for (const c of MOCK_COUNTRIES) {
    const p = estimateDefaultProbability(c);
    assert.ok(p >= 0 && p <= 1, `${c.code}: probability out of range: ${p}`);
  }
});

test('estimateDefaultProbability Lebanon scores very high (near 1)', () => {
  const lbn = MOCK_COUNTRIES.find((c) => c.code === 'LBN')!;
  const p = estimateDefaultProbability(lbn);
  assert.ok(p >= 0.7, `Lebanon probability should be >= 0.7, got ${p}`);
});

test('estimateDefaultProbability Brazil scores lower than Lebanon', () => {
  const lbn = MOCK_COUNTRIES.find((c) => c.code === 'LBN')!;
  const bra = MOCK_COUNTRIES.find((c) => c.code === 'BRA')!;
  assert.ok(estimateDefaultProbability(lbn) > estimateDefaultProbability(bra));
});

test('estimateDefaultProbability low-stress country scores below 0.3', () => {
  const lowCountry: CountryDebtData = {
    code: 'TST', name: 'Test', debtToGdpPct: 20, debtServiceToRevenuePct: 10,
    externalDebtToGdpPct: 10, hasDefaultHistory: false,
    imfProgramStatus: 'none', ratings: [], creditors: [],
    reservesCoverMonths: 15, currentAccountBalancePct: 2, notes: '',
  };
  assert.ok(estimateDefaultProbability(lowCountry) < 0.3);
});

// ── assessDebtRatios ────────────────────────────────────────────────────────

test('assessDebtRatios: critical when both ratios extreme', () => {
  const result = assessDebtRatios(150, 80);
  assert.equal(result.debtToGdpSeverity, 'critical');
  assert.equal(result.debtServiceSeverity, 'critical');
  assert.equal(result.overallSeverity, 'critical');
});

test('assessDebtRatios: high debtToGdp severity at 100', () => {
  const result = assessDebtRatios(100, 20);
  assert.equal(result.debtToGdpSeverity, 'high');
});

test('assessDebtRatios: low severity for low ratios', () => {
  const result = assessDebtRatios(20, 10);
  assert.equal(result.overallSeverity, 'low');
});

test('assessDebtRatios: moderate debtService at 30%', () => {
  const result = assessDebtRatios(30, 30);
  assert.equal(result.debtServiceSeverity, 'moderate');
});

test('assessDebtRatios: summary string is non-empty', () => {
  const result = assessDebtRatios(80, 50);
  assert.ok(result.summary.length > 0);
});

test('assessDebtRatios: overallSeverity driven by worst component', () => {
  // debtToGdp=30 (low), debtService=80 (critical) → overall critical
  const result = assessDebtRatios(30, 80);
  assert.equal(result.overallSeverity, 'critical');
});

// ── analyzeRatingTrend ──────────────────────────────────────────────────────

test('analyzeRatingTrend: no_data for empty array', () => {
  assert.equal(analyzeRatingTrend([]), 'no_data');
});

test('analyzeRatingTrend: downgrade when any agency has negative outlook', () => {
  const ratings: CreditRating[] = [
    { agency: 'moodys', rating: 'B3', outlook: 'negative', updatedAt: '2025-01-01' },
  ];
  assert.equal(analyzeRatingTrend(ratings), 'downgrade');
});

test('analyzeRatingTrend: downgrade when any agency has watch_negative', () => {
  const ratings: CreditRating[] = [
    { agency: 'sp', rating: 'CCC', outlook: 'watch_negative', updatedAt: '2025-01-01' },
  ];
  assert.equal(analyzeRatingTrend(ratings), 'downgrade');
});

test('analyzeRatingTrend: downgrade when any agency has default outlook', () => {
  const ratings: CreditRating[] = [
    { agency: 'fitch', rating: 'RD', outlook: 'default', updatedAt: '2025-01-01' },
  ];
  assert.equal(analyzeRatingTrend(ratings), 'downgrade');
});

test('analyzeRatingTrend: upgrade when all agencies positive', () => {
  const ratings: CreditRating[] = [
    { agency: 'moodys', rating: 'Ba1', outlook: 'positive', updatedAt: '2025-01-01' },
    { agency: 'sp', rating: 'BB', outlook: 'positive', updatedAt: '2025-01-01' },
  ];
  assert.equal(analyzeRatingTrend(ratings), 'upgrade');
});

test('analyzeRatingTrend: stable when all stable', () => {
  const ratings: CreditRating[] = [
    { agency: 'moodys', rating: 'Baa2', outlook: 'stable', updatedAt: '2025-01-01' },
  ];
  assert.equal(analyzeRatingTrend(ratings), 'stable');
});

// ── formatCreditorComposition ───────────────────────────────────────────────

test('formatCreditorComposition: returns No data for empty array', () => {
  assert.equal(formatCreditorComposition([]), 'No data');
});

test('formatCreditorComposition: sorts by sharePct descending', () => {
  const creditors: CreditorShare[] = [
    { type: 'paris_club', sharePct: 20 },
    { type: 'china', sharePct: 50 },
    { type: 'bondholders', sharePct: 30 },
  ];
  const result = formatCreditorComposition(creditors);
  assert.ok(result.startsWith('China 50%'));
});

test('formatCreditorComposition: includes all creditor types', () => {
  const creditors: CreditorShare[] = [
    { type: 'china', sharePct: 40 },
    { type: 'multilateral', sharePct: 30 },
    { type: 'bondholders', sharePct: 30 },
  ];
  const result = formatCreditorComposition(creditors);
  assert.match(result, /China/);
  assert.match(result, /Multilateral/);
  assert.match(result, /Bondholders/);
});

test('formatCreditorComposition: excludes zero-share creditors', () => {
  const creditors: CreditorShare[] = [
    { type: 'china', sharePct: 0 },
    { type: 'bondholders', sharePct: 100 },
  ];
  const result = formatCreditorComposition(creditors);
  assert.ok(!result.includes('China'));
});

// ── getDominantCreditor ─────────────────────────────────────────────────────

test('getDominantCreditor: returns null for empty array', () => {
  assert.equal(getDominantCreditor([]), null);
});

test('getDominantCreditor: returns highest share type', () => {
  const creditors: CreditorShare[] = [
    { type: 'paris_club', sharePct: 20 },
    { type: 'china', sharePct: 60 },
    { type: 'bondholders', sharePct: 20 },
  ];
  assert.equal(getDominantCreditor(creditors), 'china');
});

// ── buildCountryRenderData ──────────────────────────────────────────────────

test('buildCountryRenderData: Lebanon tier is in-default', () => {
  const lbn = MOCK_COUNTRIES.find((c) => c.code === 'LBN')!;
  const data = buildCountryRenderData(lbn);
  assert.equal(data.tier, 'in-default');
});

test('buildCountryRenderData: tierColor matches getDistressTierColor', () => {
  const arg = MOCK_COUNTRIES.find((c) => c.code === 'ARG')!;
  const data = buildCountryRenderData(arg);
  assert.equal(data.tierColor, getDistressTierColor(data.tier));
});

test('buildCountryRenderData: defaultProbability is 0-1', () => {
  for (const c of MOCK_COUNTRIES) {
    const data = buildCountryRenderData(c);
    assert.ok(data.defaultProbability >= 0 && data.defaultProbability <= 1);
  }
});

test('buildCountryRenderData: imfStatusLabel is non-empty', () => {
  for (const c of MOCK_COUNTRIES) {
    const data = buildCountryRenderData(c);
    assert.ok(data.imfStatusLabel.length > 0);
  }
});

// ── buildPanelSummary ────────────────────────────────────────────────────────

test('buildPanelSummary: totalCountries matches input', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  assert.equal(summary.totalCountries, MOCK_COUNTRIES.length);
});

test('buildPanelSummary: tier counts sum to totalCountries', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  const sum = summary.inDefault + summary.highDistress + summary.elevated + summary.moderate + summary.low;
  assert.equal(sum, summary.totalCountries);
});

test('buildPanelSummary: systemicRiskScore is 0-100', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  assert.ok(summary.systemicRiskScore >= 0 && summary.systemicRiskScore <= 100);
});

test('buildPanelSummary: empty array returns zero risk', () => {
  const summary = buildPanelSummary([]);
  assert.equal(summary.totalCountries, 0);
  assert.equal(summary.systemicRiskScore, 0);
});

test('buildPanelSummary: activeImfPrograms counts non-none non-completed', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  const expected = MOCK_COUNTRIES.filter(
    (c) => c.imfProgramStatus !== 'none' && c.imfProgramStatus !== 'completed',
  ).length;
  assert.equal(summary.activeImfPrograms, expected);
});

// ── getDistressTierColor ────────────────────────────────────────────────────

test('getDistressTierColor: in-default is red', () => {
  assert.match(getDistressTierColor('in-default'), /ef4444/);
});

test('getDistressTierColor: low is green', () => {
  assert.match(getDistressTierColor('low'), /22c55e/);
});

test('getDistressTierColor: all tiers return a color string', () => {
  const tiers = ['in-default', 'high-distress', 'elevated', 'moderate', 'low'] as const;
  for (const t of tiers) {
    const c = getDistressTierColor(t);
    assert.ok(c.startsWith('#'), `Expected hex color for ${t}, got ${c}`);
  }
});

// ── getImfStatusLabel ───────────────────────────────────────────────────────

test('getImfStatusLabel: active_ecf returns IMF ECF Active', () => {
  assert.equal(getImfStatusLabel('active_ecf'), 'IMF ECF Active');
});

test('getImfStatusLabel: none returns No IMF Program', () => {
  assert.equal(getImfStatusLabel('none'), 'No IMF Program');
});

test('getImfStatusLabel: all statuses return non-empty strings', () => {
  const statuses = ['active_ecf', 'active_eff', 'active_sba', 'precautionary', 'negotiations', 'completed', 'none'] as const;
  for (const s of statuses) {
    assert.ok(getImfStatusLabel(s).length > 0);
  }
});

// ── computeSystemicRiskScore ────────────────────────────────────────────────

test('computeSystemicRiskScore: returns 0 for empty array', () => {
  assert.equal(computeSystemicRiskScore([]), 0);
});

test('computeSystemicRiskScore: all-default countries produce high score', () => {
  const allDefault: CountryDebtData[] = Array.from({ length: 5 }, (_, i) => ({
    code: `D${i}`, name: `Default${i}`, debtToGdpPct: 250,
    debtServiceToRevenuePct: 95, externalDebtToGdpPct: 100,
    hasDefaultHistory: true, imfProgramStatus: 'none' as const,
    ratings: [], creditors: [], reservesCoverMonths: 0.5,
    currentAccountBalancePct: -10, notes: '',
  }));
  const score = computeSystemicRiskScore(allDefault);
  assert.ok(score >= 50, `Expected score >= 50 for all-default set, got ${score}`);
});

test('computeSystemicRiskScore: all-low countries produce low score', () => {
  const allLow: CountryDebtData[] = Array.from({ length: 5 }, (_, i) => ({
    code: `L${i}`, name: `Low${i}`, debtToGdpPct: 15,
    debtServiceToRevenuePct: 8, externalDebtToGdpPct: 5,
    hasDefaultHistory: false, imfProgramStatus: 'none' as const,
    ratings: [], creditors: [], reservesCoverMonths: 20,
    currentAccountBalancePct: 1, notes: '',
  }));
  const score = computeSystemicRiskScore(allLow);
  assert.ok(score < 20, `Expected score < 20 for all-low set, got ${score}`);
});

test('computeSystemicRiskScore: score <= 100', () => {
  const score = computeSystemicRiskScore(MOCK_COUNTRIES);
  assert.ok(score <= 100);
});

// ── getSystemicRiskLabel ────────────────────────────────────────────────────

test('getSystemicRiskLabel: 80+ returns Systemic Crisis', () => {
  assert.equal(getSystemicRiskLabel(80), 'Systemic Crisis');
});

test('getSystemicRiskLabel: below 20 returns Low Risk', () => {
  assert.equal(getSystemicRiskLabel(10), 'Low Risk');
});

// ── sortByDistressTierDesc ──────────────────────────────────────────────────

test('sortByDistressTierDesc: in-default before low', () => {
  const renderData = MOCK_COUNTRIES.map(buildCountryRenderData);
  const sorted = [...renderData].sort(sortByDistressTierDesc);
  assert.equal(sorted[0]!.tier, 'in-default');
});

test('sortByDefaultProbabilityDesc: higher probability first', () => {
  const renderData = MOCK_COUNTRIES.map(buildCountryRenderData);
  const sorted = [...renderData].sort(sortByDefaultProbabilityDesc);
  assert.ok(sorted[0]!.defaultProbability >= sorted[sorted.length - 1]!.defaultProbability);
});

// ── Label/color helpers ─────────────────────────────────────────────────────

test('getDistressTierLabel: all tiers return non-empty strings', () => {
  const tiers = ['in-default', 'high-distress', 'elevated', 'moderate', 'low'] as const;
  for (const t of tiers) {
    assert.ok(getDistressTierLabel(t).length > 0);
  }
});

test('getRatingTrendLabel: downgrade returns Downgrade Trend', () => {
  assert.equal(getRatingTrendLabel('downgrade'), 'Downgrade Trend');
});

test('getRatingTrendColor: downgrade is red', () => {
  assert.match(getRatingTrendColor('downgrade'), /ef4444/);
});

test('getRatingTrendColor: upgrade is green', () => {
  assert.match(getRatingTrendColor('upgrade'), /22c55e/);
});

test('getCreditorTypeLabel: china returns China', () => {
  assert.equal(getCreditorTypeLabel('china'), 'China');
});

test('getCreditorTypeLabel: paris_club returns Paris Club', () => {
  assert.equal(getCreditorTypeLabel('paris_club'), 'Paris Club');
});

test('formatDefaultProbability: 0.85 contains Very High', () => {
  assert.match(formatDefaultProbability(0.85), /Very High/);
});

test('formatDefaultProbability: 0.05 contains Very Low', () => {
  assert.match(formatDefaultProbability(0.05), /Very Low/);
});

test('getImfStatusColor: active_ecf is green', () => {
  assert.match(getImfStatusColor('active_ecf'), /22c55e/);
});

test('getImfStatusColor: negotiations is yellow', () => {
  assert.match(getImfStatusColor('negotiations'), /eab308/);
});

// ── renderCountryCard ───────────────────────────────────────────────────────

test('renderCountryCard: returns a div with data-country-card attribute', () => {
  const arg = MOCK_COUNTRIES.find((c) => c.code === 'ARG')!;
  const data = buildCountryRenderData(arg);
  const html = renderCountryCard(data);
  assert.match(html, /data-country-card="ARG"/);
});

test('renderCountryCard: escapes XSS in country name', () => {
  const xss: CountryDebtData = {
    code: 'XSS', name: '<script>alert(1)</script>',
    debtToGdpPct: 50, debtServiceToRevenuePct: 30,
    externalDebtToGdpPct: 20, hasDefaultHistory: false,
    imfProgramStatus: 'none', ratings: [], creditors: [],
    reservesCoverMonths: 5, currentAccountBalancePct: -1, notes: '',
  };
  const html = renderCountryCard(buildCountryRenderData(xss));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderCountryCard: shows debt-to-GDP percentage', () => {
  const lbn = MOCK_COUNTRIES.find((c) => c.code === 'LBN')!;
  const html = renderCountryCard(buildCountryRenderData(lbn));
  assert.match(html, /283%/);
});

// ── renderSummaryHeader ─────────────────────────────────────────────────────

test('renderSummaryHeader: contains data-section="debt-summary"', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  const html = renderSummaryHeader(summary);
  assert.match(html, /data-section="debt-summary"/);
});

test('renderSummaryHeader: shows systemic risk score', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  const html = renderSummaryHeader(summary);
  assert.match(html, /Systemic Risk:/);
});

test('renderSummaryHeader: shows active IMF programs count', () => {
  const summary = buildPanelSummary(MOCK_COUNTRIES);
  const html = renderSummaryHeader(summary);
  assert.match(html, /IMF programs active/);
});

// ── MOCK_COUNTRIES integrity ────────────────────────────────────────────────

test('MOCK_COUNTRIES has at least 8 entries', () => {
  assert.ok(MOCK_COUNTRIES.length >= 8);
});

test('MOCK_COUNTRIES every entry has unique code', () => {
  const codes = MOCK_COUNTRIES.map((c) => c.code);
  const unique = new Set(codes);
  assert.equal(unique.size, codes.length);
});

test('MOCK_COUNTRIES creditor shares sum to ~100 per country', () => {
  for (const c of MOCK_COUNTRIES) {
    if (c.creditors.length === 0) continue;
    const total = c.creditors.reduce((s, x) => s + x.sharePct, 0);
    assert.ok(
      Math.abs(total - 100) <= 2,
      `${c.code}: creditor shares sum to ${total}, expected ~100`,
    );
  }
});

test('MOCK_COUNTRIES includes Lebanon in in-default tier', () => {
  const lbn = MOCK_COUNTRIES.find((c) => c.code === 'LBN')!;
  assert.equal(classifyDistressTier(lbn.debtToGdpPct, lbn.debtServiceToRevenuePct, lbn.hasDefaultHistory), 'in-default');
});

test('MOCK_COUNTRIES Brazil has no IMF program', () => {
  const bra = MOCK_COUNTRIES.find((c) => c.code === 'BRA')!;
  assert.equal(bra.imfProgramStatus, 'none');
});
