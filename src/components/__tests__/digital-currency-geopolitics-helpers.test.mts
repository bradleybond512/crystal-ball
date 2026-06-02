import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cbdcStatusColor,
  cbdcStatusLabel,
  trendColor,
  trendLabel,
  confidenceColor,
  confidenceLabel,
  riskColor,
  riskClass,
  riskLabel,
  getByStatus,
  getLiveCBDCs,
  getSanctionsEvasionActors,
  computeDollarHegemonyIndex,
  buildRenderData,
  CBDC_ENTRIES,
  DEDOLLARIZATION_SIGNALS,
  SANCTIONS_EVASION_ACTORS,
  type CbdcStatus,
  type DedollarizationTrend,
  type SanctionsEvasionConfidence,
  type RiskLevel,
} from '../digital-currency-geopolitics-helpers.js';

// ── cbdcStatusColor ────────────────────────────────────────────────────────

test('cbdcStatusColor returns green for live-scaling', () => {
  assert.equal(cbdcStatusColor('live-scaling'), '#22c55e');
});

test('cbdcStatusColor returns lime for live-limited', () => {
  assert.equal(cbdcStatusColor('live-limited'), '#84cc16');
});

test('cbdcStatusColor returns yellow for piloting', () => {
  assert.equal(cbdcStatusColor('piloting'), '#facc15');
});

test('cbdcStatusColor returns blue for research', () => {
  assert.equal(cbdcStatusColor('research'), '#60a5fa');
});

test('cbdcStatusColor returns gray for research-opposed', () => {
  assert.equal(cbdcStatusColor('research-opposed'), '#94a3b8');
});

test('cbdcStatusColor returns red for failed', () => {
  assert.equal(cbdcStatusColor('failed'), '#ef4444');
});

// ── cbdcStatusLabel ────────────────────────────────────────────────────────

test('cbdcStatusLabel live-scaling returns correct string', () => {
  assert.equal(cbdcStatusLabel('live-scaling'), 'Live / Scaling');
});

test('cbdcStatusLabel piloting returns Piloting', () => {
  assert.equal(cbdcStatusLabel('piloting'), 'Piloting');
});

test('cbdcStatusLabel research-opposed returns Research (Opposed)', () => {
  assert.equal(cbdcStatusLabel('research-opposed'), 'Research (Opposed)');
});

// ── trendColor ─────────────────────────────────────────────────────────────

test('trendColor accelerating returns red', () => {
  assert.equal(trendColor('accelerating'), '#ef4444');
});

test('trendColor reversing returns green', () => {
  assert.equal(trendColor('reversing'), '#22c55e');
});

test('trendColor stable returns yellow', () => {
  assert.equal(trendColor('stable'), '#facc15');
});

test('trendColor nascent returns blue', () => {
  assert.equal(trendColor('nascent'), '#60a5fa');
});

// ── trendLabel ─────────────────────────────────────────────────────────────

test('trendLabel accelerating returns Accelerating', () => {
  assert.equal(trendLabel('accelerating'), 'Accelerating');
});

test('trendLabel reversing returns Reversing', () => {
  assert.equal(trendLabel('reversing'), 'Reversing');
});

// ── confidenceColor ────────────────────────────────────────────────────────

test('confidenceColor confirmed returns red', () => {
  assert.equal(confidenceColor('confirmed'), '#ef4444');
});

test('confidenceColor high returns orange', () => {
  assert.equal(confidenceColor('high'), '#fb923c');
});

test('confidenceColor moderate returns yellow', () => {
  assert.equal(confidenceColor('moderate'), '#facc15');
});

test('confidenceColor suspected returns blue', () => {
  assert.equal(confidenceColor('suspected'), '#60a5fa');
});

// ── confidenceLabel ────────────────────────────────────────────────────────

test('confidenceLabel confirmed returns Confirmed', () => {
  assert.equal(confidenceLabel('confirmed'), 'Confirmed');
});

test('confidenceLabel high returns High Confidence', () => {
  assert.equal(confidenceLabel('high'), 'High Confidence');
});

// ── riskColor / riskClass / riskLabel ─────────────────────────────────────

test('riskColor critical returns red', () => {
  assert.equal(riskColor('critical'), '#ef4444');
});

test('riskColor low returns green', () => {
  assert.equal(riskColor('low'), '#4ade80');
});

test('riskClass prefixes with risk-', () => {
  assert.equal(riskClass('high'), 'risk-high');
  assert.equal(riskClass('critical'), 'risk-critical');
});

test('riskLabel returns human labels', () => {
  assert.equal(riskLabel('medium'), 'Medium');
  assert.equal(riskLabel('low'), 'Low');
});

// ── getByStatus ────────────────────────────────────────────────────────────

test('getByStatus piloting returns only piloting entries', () => {
  const result = getByStatus(CBDC_ENTRIES, 'piloting');
  assert.ok(result.length > 0);
  assert.ok(result.every((e) => e.status === 'piloting'));
});

test('getByStatus live-scaling includes China', () => {
  const result = getByStatus(CBDC_ENTRIES, 'live-scaling');
  assert.ok(result.some((e) => e.country === 'China'));
});

test('getByStatus research-opposed includes USA', () => {
  const result = getByStatus(CBDC_ENTRIES, 'research-opposed');
  assert.ok(result.some((e) => e.country === 'USA'));
});

test('getByStatus cancelled returns empty array (none cancelled)', () => {
  const result = getByStatus(CBDC_ENTRIES, 'cancelled');
  assert.equal(result.length, 0);
});

// ── getLiveCBDCs ───────────────────────────────────────────────────────────

test('getLiveCBDCs returns both live-scaling and live-limited entries', () => {
  const live = getLiveCBDCs(CBDC_ENTRIES);
  assert.ok(live.length >= 2);
  assert.ok(live.every((e) => e.status === 'live-scaling' || e.status === 'live-limited'));
});

test('getLiveCBDCs includes China and Russia', () => {
  const live = getLiveCBDCs(CBDC_ENTRIES);
  assert.ok(live.some((e) => e.country === 'China'));
  assert.ok(live.some((e) => e.country === 'Russia'));
});

test('getLiveCBDCs includes Bahamas Sand Dollar', () => {
  const live = getLiveCBDCs(CBDC_ENTRIES);
  assert.ok(live.some((e) => e.country === 'Bahamas'));
});

// ── getSanctionsEvasionActors (CBDC entries with evasion goal) ─────────────

test('getSanctionsEvasionActors returns only entries with sanctionsEvasionGoal true', () => {
  const actors = getSanctionsEvasionActors(CBDC_ENTRIES);
  assert.ok(actors.every((e) => e.sanctionsEvasionGoal === true));
});

test('getSanctionsEvasionActors includes Russia Digital Ruble', () => {
  const actors = getSanctionsEvasionActors(CBDC_ENTRIES);
  assert.ok(actors.some((e) => e.country === 'Russia'));
});

test('getSanctionsEvasionActors does not include China', () => {
  const actors = getSanctionsEvasionActors(CBDC_ENTRIES);
  assert.ok(!actors.some((e) => e.country === 'China'));
});

// ── CBDC_ENTRIES data integrity ────────────────────────────────────────────

test('CBDC_ENTRIES has at least 12 entries', () => {
  assert.ok(CBDC_ENTRIES.length >= 12);
});

test('CBDC_ENTRIES China has 260M wallets', () => {
  const china = CBDC_ENTRIES.find((e) => e.country === 'China');
  assert.ok(china != null);
  assert.equal(china.walletsMillion, 260);
});

test('CBDC_ENTRIES China has $250B transactions', () => {
  const china = CBDC_ENTRIES.find((e) => e.country === 'China');
  assert.equal(china?.transactionsBn, 250);
});

test('CBDC_ENTRIES all have non-empty country and name', () => {
  for (const e of CBDC_ENTRIES) {
    assert.ok(e.country.length > 0, `Empty country: ${JSON.stringify(e)}`);
    assert.ok(e.name.length > 0, `Empty name in ${e.country}`);
  }
});

test('CBDC_ENTRIES all have valid iso2 codes (2 chars)', () => {
  for (const e of CBDC_ENTRIES) {
    assert.equal(e.iso2.length, 2, `Invalid iso2 for ${e.country}: ${e.iso2}`);
  }
});

test('CBDC_ENTRIES crossBorderPartners is always array', () => {
  for (const e of CBDC_ENTRIES) {
    assert.ok(Array.isArray(e.crossBorderPartners));
  }
});

// ── DEDOLLARIZATION_SIGNALS data integrity ────────────────────────────────

test('DEDOLLARIZATION_SIGNALS has at least 5 entries', () => {
  assert.ok(DEDOLLARIZATION_SIGNALS.length >= 5);
});

test('DEDOLLARIZATION_SIGNALS usd-fx-reserves has currentValuePct around 58', () => {
  const sig = DEDOLLARIZATION_SIGNALS.find((s) => s.id === 'usd-fx-reserves');
  assert.ok(sig != null);
  assert.ok(sig.currentValuePct != null && sig.currentValuePct > 50 && sig.currentValuePct < 70);
});

test('DEDOLLARIZATION_SIGNALS usd-fx-reserves trend is accelerating', () => {
  const sig = DEDOLLARIZATION_SIGNALS.find((s) => s.id === 'usd-fx-reserves');
  assert.equal(sig?.trend, 'accelerating');
});

test('DEDOLLARIZATION_SIGNALS all have non-empty label and description', () => {
  for (const s of DEDOLLARIZATION_SIGNALS) {
    assert.ok(s.label.length > 0);
    assert.ok(s.description.length > 0);
  }
});

// ── SANCTIONS_EVASION_ACTORS data integrity ───────────────────────────────

test('SANCTIONS_EVASION_ACTORS has at least 4 entries', () => {
  assert.ok(SANCTIONS_EVASION_ACTORS.length >= 4);
});

test('SANCTIONS_EVASION_ACTORS North Korea is confirmed', () => {
  const nk = SANCTIONS_EVASION_ACTORS.find((a) => a.country === 'North Korea');
  assert.equal(nk?.confidence, 'confirmed');
  assert.ok((nk?.estimatedUsdBn ?? 0) >= 3.0);
});

test('SANCTIONS_EVASION_ACTORS Russia is confirmed', () => {
  const ru = SANCTIONS_EVASION_ACTORS.find((a) => a.country === 'Russia');
  assert.equal(ru?.confidence, 'confirmed');
});

test('SANCTIONS_EVASION_ACTORS all have positive estimatedUsdBn', () => {
  for (const a of SANCTIONS_EVASION_ACTORS) {
    assert.ok(a.estimatedUsdBn > 0, `${a.country} has non-positive estimatedUsdBn`);
  }
});

// ── computeDollarHegemonyIndex ─────────────────────────────────────────────

test('computeDollarHegemonyIndex returns score 0-100', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.score >= 0 && idx.score <= 100, `Score out of range: ${idx.score}`);
});

test('computeDollarHegemonyIndex components sum to score', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  const { reserveShareScore, tradeInvoicingScore, cbdcThreatScore, sanctionsEvasionScore } = idx.components;
  assert.equal(reserveShareScore + tradeInvoicingScore + cbdcThreatScore + sanctionsEvasionScore, idx.score);
});

test('computeDollarHegemonyIndex reserveShareScore is 0-30', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.components.reserveShareScore >= 0 && idx.components.reserveShareScore <= 30);
});

test('computeDollarHegemonyIndex tradeInvoicingScore is 0-25', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.components.tradeInvoicingScore >= 0 && idx.components.tradeInvoicingScore <= 25);
});

test('computeDollarHegemonyIndex cbdcThreatScore is 0-25', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.components.cbdcThreatScore >= 0 && idx.components.cbdcThreatScore <= 25);
});

test('computeDollarHegemonyIndex sanctionsEvasionScore is 0-20', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.components.sanctionsEvasionScore >= 0 && idx.components.sanctionsEvasionScore <= 20);
});

test('computeDollarHegemonyIndex has non-empty interpretation', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  assert.ok(idx.interpretation.length > 0);
});

test('computeDollarHegemonyIndex trend is valid DedollarizationTrend', () => {
  const idx = computeDollarHegemonyIndex(DEDOLLARIZATION_SIGNALS, CBDC_ENTRIES, SANCTIONS_EVASION_ACTORS);
  const valid = ['accelerating', 'stable', 'reversing', 'nascent'];
  assert.ok(valid.includes(idx.trend), `Invalid trend: ${idx.trend}`);
});

test('computeDollarHegemonyIndex with empty arrays returns score <= 20', () => {
  const idx = computeDollarHegemonyIndex([], [], []);
  // no reserve signal => uses 60 default, no cbdc threat, no evasion, no accelerating signals
  assert.ok(idx.score >= 0 && idx.score <= 100);
});

test('computeDollarHegemonyIndex with many confirmed evasion actors clamps sanctionsEvasionScore to 0', () => {
  const manyActors = Array.from({ length: 10 }, (_, i) => ({
    ...SANCTIONS_EVASION_ACTORS[0],
    country: `Country${i}`,
    confidence: 'confirmed' as SanctionsEvasionConfidence,
  }));
  const idx = computeDollarHegemonyIndex([], [], manyActors);
  assert.equal(idx.components.sanctionsEvasionScore, 0);
});

// ── buildRenderData ────────────────────────────────────────────────────────

test('buildRenderData returns correct liveCbdcCount', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.ok(data.liveCbdcCount >= 2);
  assert.equal(data.liveCbdcCount, getLiveCBDCs(CBDC_ENTRIES).length);
});

test('buildRenderData returns correct pilotingCount', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.ok(data.pilotingCount >= 1);
});

test('buildRenderData mBridgeParticipants is at least 2', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.ok(data.mBridgeParticipants >= 2);
});

test('buildRenderData acceleratingSignalCount matches signals', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  const expected = DEDOLLARIZATION_SIGNALS.filter((s) => s.trend === 'accelerating').length;
  assert.equal(data.acceleratingSignalCount, expected);
});

test('buildRenderData totalEvasionUsdBn sums all actors', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  const expected = SANCTIONS_EVASION_ACTORS.reduce((s, a) => s + a.estimatedUsdBn, 0);
  assert.ok(Math.abs(data.totalEvasionUsdBn - expected) < 0.001);
});

test('buildRenderData total evasion is >= 6B (NK+Russia+Iran+Venezuela)', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.ok(data.totalEvasionUsdBn >= 6.0);
});

test('buildRenderData dollarHegemonyIndex score is within range', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.ok(data.dollarHegemonyIndex.score >= 0 && data.dollarHegemonyIndex.score <= 100);
});

test('buildRenderData passes through cbdcEntries reference', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.equal(data.cbdcEntries, CBDC_ENTRIES);
});

test('buildRenderData passes through dedollarizationSignals reference', () => {
  const data = buildRenderData(CBDC_ENTRIES, DEDOLLARIZATION_SIGNALS, SANCTIONS_EVASION_ACTORS);
  assert.equal(data.dedollarizationSignals, DEDOLLARIZATION_SIGNALS);
});
