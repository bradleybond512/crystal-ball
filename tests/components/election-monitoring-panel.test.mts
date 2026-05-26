/**
 * Tests for ElectionMonitoringPanel — pure helper functions and static data.
 *
 * Run with: npx tsx --test tests/components/election-monitoring-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  electionTypeColor,
  electionTypeLabel,
  stakesColor,
  stakesLabel,
  integrityRiskColor,
  integrityRiskLabel,
  resultStatusColor,
  resultStatusLabel,
  turnoutAnomalyColor,
  turnoutAnomalyLabel,
  disinfoCampaignTypeColor,
  disinfoCampaignTypeLabel,
  disinfoIntensityColor,
  observerVerdictColor,
  observerVerdictLabel,
  countImminentElections,
  countHighIntegrityRisk,
  countDisputedResults,
  countHighIntensityDisinfo,
  countCriticalStakesElections,
  ELECTION_CALENDAR,
  INTEGRITY_INDICATORS,
  ELECTION_RESULTS,
  TURNOUT_ANOMALIES,
  DISINFO_SIGNALS,
  OBSERVER_REPORTS,
  type ElectionType,
  type Stakes,
  type ResultStatus,
  type DisinfoCampaignType,
  type DisinfoIntensity,
  type ObserverVerdict,
  type IntegrityRisk,
  type ElectionEvent,
  type IntegrityIndicator,
  type ElectionResult,
  type TurnoutAnomaly,
  type DisinfoSignal,
} from '../../src/components/election-monitoring-helpers.ts';

// ── electionTypeColor ─────────────────────────────────────────────────────

test('electionTypeColor: presidential returns red', () => {
  assert.ok(electionTypeColor('presidential').includes('#ef4444'));
});

test('electionTypeColor: parliamentary returns orange', () => {
  assert.ok(electionTypeColor('parliamentary').includes('#fb923c'));
});

test('electionTypeColor: referendum returns yellow', () => {
  assert.ok(electionTypeColor('referendum').includes('#facc15'));
});

test('electionTypeColor: regional returns green', () => {
  assert.ok(electionTypeColor('regional').includes('#4caf50'));
});

test('electionTypeColor: primary returns grey', () => {
  assert.ok(electionTypeColor('primary').includes('#9e9e9e'));
});

test('electionTypeColor: all types return non-empty strings', () => {
  const types: ElectionType[] = ['presidential', 'parliamentary', 'referendum', 'regional', 'primary'];
  for (const t of types) assert.ok(electionTypeColor(t).length > 0);
});

// ── electionTypeLabel ─────────────────────────────────────────────────────

test('electionTypeLabel: presidential returns "Presidential"', () => {
  assert.equal(electionTypeLabel('presidential'), 'Presidential');
});

test('electionTypeLabel: parliamentary returns "Parliamentary"', () => {
  assert.equal(electionTypeLabel('parliamentary'), 'Parliamentary');
});

test('electionTypeLabel: referendum returns "Referendum"', () => {
  assert.equal(electionTypeLabel('referendum'), 'Referendum');
});

test('electionTypeLabel: all types return non-empty strings', () => {
  const types: ElectionType[] = ['presidential', 'parliamentary', 'referendum', 'regional', 'primary'];
  for (const t of types) assert.ok(electionTypeLabel(t).length > 0);
});

// ── stakesColor ───────────────────────────────────────────────────────────

test('stakesColor: critical returns red', () => {
  assert.ok(stakesColor('critical').includes('#ef4444'));
});

test('stakesColor: high returns orange', () => {
  assert.ok(stakesColor('high').includes('#fb923c'));
});

test('stakesColor: medium returns yellow', () => {
  assert.ok(stakesColor('medium').includes('#facc15'));
});

test('stakesColor: low returns green', () => {
  assert.ok(stakesColor('low').includes('#4caf50'));
});

// ── stakesLabel ───────────────────────────────────────────────────────────

test('stakesLabel: critical returns "Critical"', () => {
  assert.equal(stakesLabel('critical'), 'Critical');
});

test('stakesLabel: all levels return non-empty strings', () => {
  const levels: Stakes[] = ['low', 'medium', 'high', 'critical'];
  for (const s of levels) assert.ok(stakesLabel(s).length > 0);
});

// ── integrityRiskColor ────────────────────────────────────────────────────

test('integrityRiskColor: 0 returns grey', () => {
  assert.ok(integrityRiskColor(0).includes('#9e9e9e'));
});

test('integrityRiskColor: 1 returns green', () => {
  assert.ok(integrityRiskColor(1).includes('#4caf50'));
});

test('integrityRiskColor: 2 returns yellow', () => {
  assert.ok(integrityRiskColor(2).includes('#facc15'));
});

test('integrityRiskColor: 3 returns orange', () => {
  assert.ok(integrityRiskColor(3).includes('#fb923c'));
});

test('integrityRiskColor: 4 returns red', () => {
  assert.ok(integrityRiskColor(4).includes('#ef4444'));
});

// ── integrityRiskLabel ────────────────────────────────────────────────────

test('integrityRiskLabel: 0 returns "Clean"', () => {
  assert.equal(integrityRiskLabel(0), 'Clean');
});

test('integrityRiskLabel: 4 returns "Compromised"', () => {
  assert.equal(integrityRiskLabel(4), 'Compromised');
});

test('integrityRiskLabel: all scores return non-empty strings', () => {
  const scores: IntegrityRisk[] = [0, 1, 2, 3, 4];
  for (const r of scores) assert.ok(integrityRiskLabel(r).length > 0);
});

// ── resultStatusColor ─────────────────────────────────────────────────────

test('resultStatusColor: called returns green', () => {
  assert.ok(resultStatusColor('called').includes('#4caf50'));
});

test('resultStatusColor: disputed returns orange', () => {
  assert.ok(resultStatusColor('disputed').includes('#fb923c'));
});

test('resultStatusColor: annulled returns red', () => {
  assert.ok(resultStatusColor('annulled').includes('#ef4444'));
});

test('resultStatusColor: pending returns grey', () => {
  assert.ok(resultStatusColor('pending').includes('#9e9e9e'));
});

test('resultStatusColor: all statuses return non-empty strings', () => {
  const statuses: ResultStatus[] = ['called', 'disputed', 'pending', 'runoff-required', 'annulled'];
  for (const s of statuses) assert.ok(resultStatusColor(s).length > 0);
});

// ── resultStatusLabel ─────────────────────────────────────────────────────

test('resultStatusLabel: called returns "Called"', () => {
  assert.equal(resultStatusLabel('called'), 'Called');
});

test('resultStatusLabel: disputed returns "Disputed"', () => {
  assert.equal(resultStatusLabel('disputed'), 'Disputed');
});

test('resultStatusLabel: runoff-required returns "Runoff Required"', () => {
  assert.equal(resultStatusLabel('runoff-required'), 'Runoff Required');
});

// ── turnoutAnomalyColor ───────────────────────────────────────────────────

test('turnoutAnomalyColor: score 4 returns red', () => {
  assert.ok(turnoutAnomalyColor(4).includes('#ef4444'));
});

test('turnoutAnomalyColor: score 3 returns orange', () => {
  assert.ok(turnoutAnomalyColor(3).includes('#fb923c'));
});

test('turnoutAnomalyColor: score 2 returns yellow', () => {
  assert.ok(turnoutAnomalyColor(2).includes('#facc15'));
});

test('turnoutAnomalyColor: score 1 returns green', () => {
  assert.ok(turnoutAnomalyColor(1).includes('#4caf50'));
});

test('turnoutAnomalyColor: score 0 returns green', () => {
  assert.ok(turnoutAnomalyColor(0).includes('#4caf50'));
});

// ── turnoutAnomalyLabel ───────────────────────────────────────────────────

test('turnoutAnomalyLabel: score 4 returns "Severe"', () => {
  assert.equal(turnoutAnomalyLabel(4), 'Severe');
});

test('turnoutAnomalyLabel: score 3 returns "High"', () => {
  assert.equal(turnoutAnomalyLabel(3), 'High');
});

test('turnoutAnomalyLabel: score 2 returns "Moderate"', () => {
  assert.equal(turnoutAnomalyLabel(2), 'Moderate');
});

test('turnoutAnomalyLabel: score 1 returns "Low"', () => {
  assert.equal(turnoutAnomalyLabel(1), 'Low');
});

// ── disinfoCampaignTypeColor ──────────────────────────────────────────────

test('disinfoCampaignTypeColor: deepfake returns red', () => {
  assert.ok(disinfoCampaignTypeColor('deepfake').includes('#ef4444'));
});

test('disinfoCampaignTypeColor: hack-and-leak returns red', () => {
  assert.ok(disinfoCampaignTypeColor('hack-and-leak').includes('#ef4444'));
});

test('disinfoCampaignTypeColor: bot-network returns orange', () => {
  assert.ok(disinfoCampaignTypeColor('bot-network').includes('#fb923c'));
});

test('disinfoCampaignTypeColor: foreign-amplification returns orange', () => {
  assert.ok(disinfoCampaignTypeColor('foreign-amplification').includes('#fb923c'));
});

test('disinfoCampaignTypeColor: narrative-flooding returns yellow', () => {
  assert.ok(disinfoCampaignTypeColor('narrative-flooding').includes('#facc15'));
});

// ── disinfoCampaignTypeLabel ──────────────────────────────────────────────

test('disinfoCampaignTypeLabel: deepfake returns "Deepfake"', () => {
  assert.equal(disinfoCampaignTypeLabel('deepfake'), 'Deepfake');
});

test('disinfoCampaignTypeLabel: hack-and-leak returns "Hack & Leak"', () => {
  assert.equal(disinfoCampaignTypeLabel('hack-and-leak'), 'Hack & Leak');
});

test('disinfoCampaignTypeLabel: all types return non-empty strings', () => {
  const types: DisinfoCampaignType[] = [
    'deepfake', 'bot-network', 'hack-and-leak', 'foreign-amplification', 'narrative-flooding',
  ];
  for (const t of types) assert.ok(disinfoCampaignTypeLabel(t).length > 0);
});

// ── disinfoIntensityColor ─────────────────────────────────────────────────

test('disinfoIntensityColor: critical returns red', () => {
  assert.ok(disinfoIntensityColor('critical').includes('#ef4444'));
});

test('disinfoIntensityColor: high returns orange', () => {
  assert.ok(disinfoIntensityColor('high').includes('#fb923c'));
});

test('disinfoIntensityColor: all intensities return non-empty strings', () => {
  const levels: DisinfoIntensity[] = ['low', 'medium', 'high', 'critical'];
  for (const i of levels) assert.ok(disinfoIntensityColor(i).length > 0);
});

// ── observerVerdictColor ──────────────────────────────────────────────────

test('observerVerdictColor: free-and-fair returns green', () => {
  assert.ok(observerVerdictColor('free-and-fair').includes('#4caf50'));
});

test('observerVerdictColor: generally-credible returns yellow', () => {
  assert.ok(observerVerdictColor('generally-credible').includes('#facc15'));
});

test('observerVerdictColor: concerns-noted returns orange', () => {
  assert.ok(observerVerdictColor('concerns-noted').includes('#fb923c'));
});

test('observerVerdictColor: significant-irregularities returns red', () => {
  assert.ok(observerVerdictColor('significant-irregularities').includes('#ef4444'));
});

test('observerVerdictColor: rejected returns red', () => {
  assert.ok(observerVerdictColor('rejected').includes('#ef4444'));
});

// ── observerVerdictLabel ──────────────────────────────────────────────────

test('observerVerdictLabel: free-and-fair returns "Free & Fair"', () => {
  assert.equal(observerVerdictLabel('free-and-fair'), 'Free & Fair');
});

test('observerVerdictLabel: rejected returns "Rejected"', () => {
  assert.equal(observerVerdictLabel('rejected'), 'Rejected');
});

test('observerVerdictLabel: all verdicts return non-empty strings', () => {
  const verdicts: ObserverVerdict[] = [
    'free-and-fair', 'generally-credible', 'concerns-noted', 'significant-irregularities', 'rejected',
  ];
  for (const v of verdicts) assert.ok(observerVerdictLabel(v).length > 0);
});

// ── countImminentElections ────────────────────────────────────────────────

test('countImminentElections: counts elections within 30 days', () => {
  const events: ElectionEvent[] = [
    { nation: 'A', date: '2026-06-01', daysUntil: 10, electionType: 'parliamentary', stakes: 'high', description: '' },
    { nation: 'B', date: '2026-06-15', daysUntil: 25, electionType: 'presidential', stakes: 'critical', description: '' },
    { nation: 'C', date: '2026-09-01', daysUntil: 90, electionType: 'regional', stakes: 'low', description: '' },
  ];
  assert.equal(countImminentElections(events), 2);
});

test('countImminentElections: custom threshold', () => {
  const events: ElectionEvent[] = [
    { nation: 'A', date: '2026-06-01', daysUntil: 5, electionType: 'parliamentary', stakes: 'high', description: '' },
    { nation: 'B', date: '2026-06-15', daysUntil: 25, electionType: 'presidential', stakes: 'critical', description: '' },
  ];
  assert.equal(countImminentElections(events, 10), 1);
});

test('countImminentElections: excludes past elections (negative daysUntil)', () => {
  const events: ElectionEvent[] = [
    { nation: 'A', date: '2026-05-01', daysUntil: -10, electionType: 'parliamentary', stakes: 'high', description: '' },
    { nation: 'B', date: '2026-06-01', daysUntil: 10, electionType: 'presidential', stakes: 'critical', description: '' },
  ];
  assert.equal(countImminentElections(events), 1);
});

test('countImminentElections: returns 0 for empty array', () => {
  assert.equal(countImminentElections([]), 0);
});

// ── countHighIntegrityRisk ────────────────────────────────────────────────

test('countHighIntegrityRisk: counts indicators with risk >= 3', () => {
  const indicators: IntegrityIndicator[] = [
    { nation: 'A', riskScore: 4, concerns: [], observerPresence: false },
    { nation: 'B', riskScore: 3, concerns: [], observerPresence: false },
    { nation: 'C', riskScore: 2, concerns: [], observerPresence: true },
    { nation: 'D', riskScore: 1, concerns: [], observerPresence: true },
  ];
  assert.equal(countHighIntegrityRisk(indicators), 2);
});

test('countHighIntegrityRisk: returns 0 when none qualify', () => {
  const indicators: IntegrityIndicator[] = [
    { nation: 'A', riskScore: 1, concerns: [], observerPresence: true },
    { nation: 'B', riskScore: 2, concerns: [], observerPresence: true },
  ];
  assert.equal(countHighIntegrityRisk(indicators), 0);
});

// ── countDisputedResults ──────────────────────────────────────────────────

test('countDisputedResults: counts disputed and annulled', () => {
  const results: ElectionResult[] = [
    { nation: 'A', date: '', winner: '', marginPct: 5, turnoutPct: 70, status: 'disputed', notes: '' },
    { nation: 'B', date: '', winner: '', marginPct: 3, turnoutPct: 65, status: 'annulled', notes: '' },
    { nation: 'C', date: '', winner: '', marginPct: 8, turnoutPct: 80, status: 'called', notes: '' },
  ];
  assert.equal(countDisputedResults(results), 2);
});

test('countDisputedResults: does not count runoff-required as disputed', () => {
  const results: ElectionResult[] = [
    { nation: 'A', date: '', winner: '', marginPct: 2, turnoutPct: 60, status: 'runoff-required', notes: '' },
  ];
  assert.equal(countDisputedResults(results), 0);
});

// ── countHighIntensityDisinfo ─────────────────────────────────────────────

test('countHighIntensityDisinfo: counts high and critical', () => {
  const signals: DisinfoSignal[] = [
    { platform: 'X', campaignType: 'bot-network', targetNation: 'A', intensity: 'critical', description: '' },
    { platform: 'FB', campaignType: 'deepfake', targetNation: 'B', intensity: 'high', description: '' },
    { platform: 'TG', campaignType: 'narrative-flooding', targetNation: 'C', intensity: 'medium', description: '' },
  ];
  assert.equal(countHighIntensityDisinfo(signals), 2);
});

test('countHighIntensityDisinfo: returns 0 when all low/medium', () => {
  const signals: DisinfoSignal[] = [
    { platform: 'X', campaignType: 'narrative-flooding', targetNation: 'A', intensity: 'low', description: '' },
    { platform: 'FB', campaignType: 'narrative-flooding', targetNation: 'B', intensity: 'medium', description: '' },
  ];
  assert.equal(countHighIntensityDisinfo(signals), 0);
});

// ── countCriticalStakesElections ──────────────────────────────────────────

test('countCriticalStakesElections: counts only critical-stakes events', () => {
  const events: ElectionEvent[] = [
    { nation: 'A', date: '', daysUntil: 10, electionType: 'parliamentary', stakes: 'critical', description: '' },
    { nation: 'B', date: '', daysUntil: 20, electionType: 'presidential', stakes: 'high', description: '' },
    { nation: 'C', date: '', daysUntil: 30, electionType: 'referendum', stakes: 'critical', description: '' },
  ];
  assert.equal(countCriticalStakesElections(events), 2);
});

// ── Static data integrity ─────────────────────────────────────────────────

test('ELECTION_CALENDAR has at least 6 entries', () => {
  assert.ok(ELECTION_CALENDAR.length >= 6);
});

test('ELECTION_CALENDAR: all nations are non-empty strings', () => {
  for (const e of ELECTION_CALENDAR) assert.ok(e.nation.length > 0);
});

test('ELECTION_CALENDAR: all descriptions are non-empty strings', () => {
  for (const e of ELECTION_CALENDAR) assert.ok(e.description.length > 0);
});

test('INTEGRITY_INDICATORS has at least 5 entries', () => {
  assert.ok(INTEGRITY_INDICATORS.length >= 5);
});

test('INTEGRITY_INDICATORS: all risk scores are in range 0–4', () => {
  for (const ind of INTEGRITY_INDICATORS) {
    assert.ok(ind.riskScore >= 0 && ind.riskScore <= 4);
  }
});

test('INTEGRITY_INDICATORS: all nations have at least one concern', () => {
  for (const ind of INTEGRITY_INDICATORS) assert.ok(ind.concerns.length > 0);
});

test('ELECTION_RESULTS has at least 5 entries', () => {
  assert.ok(ELECTION_RESULTS.length >= 5);
});

test('ELECTION_RESULTS: all margin percentages are non-negative', () => {
  for (const r of ELECTION_RESULTS) assert.ok(r.marginPct >= 0);
});

test('ELECTION_RESULTS: all turnout percentages are in range 0–100', () => {
  for (const r of ELECTION_RESULTS) {
    assert.ok(r.turnoutPct >= 0 && r.turnoutPct <= 100);
  }
});

test('TURNOUT_ANOMALIES has at least 4 entries', () => {
  assert.ok(TURNOUT_ANOMALIES.length >= 4);
});

test('TURNOUT_ANOMALIES: all anomaly scores are in range 0–4', () => {
  for (const a of TURNOUT_ANOMALIES) {
    assert.ok(a.anomalyScore >= 0 && a.anomalyScore <= 4);
  }
});

test('TURNOUT_ANOMALIES: all percentages are in range 0–100', () => {
  for (const a of TURNOUT_ANOMALIES) {
    assert.ok(a.expectedPct >= 0 && a.expectedPct <= 100);
    assert.ok(a.actualPct >= 0 && a.actualPct <= 100);
  }
});

test('DISINFO_SIGNALS has at least 5 entries', () => {
  assert.ok(DISINFO_SIGNALS.length >= 5);
});

test('DISINFO_SIGNALS: all descriptions are non-empty strings', () => {
  for (const s of DISINFO_SIGNALS) assert.ok(s.description.length > 0);
});

test('OBSERVER_REPORTS has at least 5 entries', () => {
  assert.ok(OBSERVER_REPORTS.length >= 5);
});

test('OBSERVER_REPORTS: all findings are non-empty strings', () => {
  for (const r of OBSERVER_REPORTS) assert.ok(r.findings.length > 0);
});

// ── Static data: count helpers on real data ───────────────────────────────

test('INTEGRITY_INDICATORS: high-risk count is at least 2', () => {
  assert.ok(countHighIntegrityRisk(INTEGRITY_INDICATORS) >= 2);
});

test('ELECTION_RESULTS: disputed count is at least 2', () => {
  assert.ok(countDisputedResults(ELECTION_RESULTS) >= 2);
});

test('DISINFO_SIGNALS: high-intensity count is at least 3', () => {
  assert.ok(countHighIntensityDisinfo(DISINFO_SIGNALS) >= 3);
});

test('ELECTION_CALENDAR: imminent elections exist within 30 days', () => {
  assert.ok(countImminentElections(ELECTION_CALENDAR) > 0);
});

test('ELECTION_CALENDAR: has at least one critical-stakes election', () => {
  assert.ok(countCriticalStakesElections(ELECTION_CALENDAR) >= 1);
});

// ── turnoutAnomaly: boundary conditions ──────────────────────────────────

test('turnoutAnomalyColor: score exactly 3 returns orange', () => {
  assert.ok(turnoutAnomalyColor(3).includes('#fb923c'));
});

test('turnoutAnomalyColor: score exactly 2 returns yellow', () => {
  assert.ok(turnoutAnomalyColor(2).includes('#facc15'));
});

test('turnoutAnomalyLabel: score exactly 4 returns "Severe"', () => {
  assert.equal(turnoutAnomalyLabel(4), 'Severe');
});

// ── observerVerdictLabel: all distinct values ─────────────────────────────

test('observerVerdictLabel: generally-credible returns "Generally Credible"', () => {
  assert.equal(observerVerdictLabel('generally-credible'), 'Generally Credible');
});

test('observerVerdictLabel: concerns-noted returns "Concerns Noted"', () => {
  assert.equal(observerVerdictLabel('concerns-noted'), 'Concerns Noted');
});

test('observerVerdictLabel: significant-irregularities returns non-empty', () => {
  assert.ok(observerVerdictLabel('significant-irregularities').length > 0);
});
