/**
 * Tests for PoliticalRiskSuperpowerPanel — pure helper functions and data constants.
 *
 * Run with: npx tsx --test tests/components/political-risk-superpower-panel.test.mts
 *
 * Pure-logic tests only; no DOM required. All rendering helpers are exported
 * from the helpers module for testability. Panel class construction requires a
 * full DOM environment and is covered by the panel smoke harness.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  politicalSeverityColor,
  eventTypeLabel,
  riskScoreTier,
  riskScoreColor,
  responseLabel,
  responseColor,
  crisisTypeLabel,
  governanceColor,
  governanceTier,
  formatTimeAgo,
  instabilityCount,
  COUP_WATCH,
  ELECTION_RISKS,
  PROTEST_EVENTS,
  DIPLOMATIC_CRISES,
  GOVERNANCE_INDEX,
  type PoliticalSeverity,
  type CoupEventType,
  type GovernmentResponse,
  type DiplomaticCrisisType,
  type CoupWatchEvent,
} from '../../src/components/political-risk-superpower-helpers.ts';

// ── politicalSeverityColor ────────────────────────────────────────────

test('politicalSeverityColor returns green for low', () => {
  assert.equal(politicalSeverityColor('low'), '#4caf50');
});

test('politicalSeverityColor returns orange for medium', () => {
  assert.equal(politicalSeverityColor('medium'), '#ff9800');
});

test('politicalSeverityColor returns red for high', () => {
  assert.equal(politicalSeverityColor('high'), '#f44336');
});

test('politicalSeverityColor returns dark red for critical', () => {
  assert.equal(politicalSeverityColor('critical'), '#b71c1c');
});

// ── eventTypeLabel ────────────────────────────────────────────────────

test('eventTypeLabel returns coup label with emoji', () => {
  assert.ok(eventTypeLabel('coup').includes('Coup'));
});

test('eventTypeLabel returns uprising label', () => {
  assert.ok(eventTypeLabel('uprising').includes('Uprising'));
});

test('eventTypeLabel returns contested election label', () => {
  assert.ok(eventTypeLabel('contested_election').includes('Contested'));
});

test('eventTypeLabel returns power vacuum label', () => {
  assert.ok(eventTypeLabel('power_vacuum').includes('Power'));
});

test('eventTypeLabel falls back to raw type for unknown', () => {
  const unknown = 'unknown_type' as CoupEventType;
  assert.equal(eventTypeLabel(unknown), 'unknown_type');
});

// ── riskScoreTier ─────────────────────────────────────────────────────

test('riskScoreTier returns critical at 75', () => {
  assert.equal(riskScoreTier(75), 'critical');
});

test('riskScoreTier returns critical at 100', () => {
  assert.equal(riskScoreTier(100), 'critical');
});

test('riskScoreTier returns high at 74', () => {
  assert.equal(riskScoreTier(74), 'high');
});

test('riskScoreTier returns high at 50', () => {
  assert.equal(riskScoreTier(50), 'high');
});

test('riskScoreTier returns medium at 49', () => {
  assert.equal(riskScoreTier(49), 'medium');
});

test('riskScoreTier returns medium at 25', () => {
  assert.equal(riskScoreTier(25), 'medium');
});

test('riskScoreTier returns low at 24', () => {
  assert.equal(riskScoreTier(24), 'low');
});

test('riskScoreTier returns low at 0', () => {
  assert.equal(riskScoreTier(0), 'low');
});

// ── riskScoreColor ────────────────────────────────────────────────────

test('riskScoreColor returns dark red for score 88', () => {
  assert.equal(riskScoreColor(88), '#b71c1c');
});

test('riskScoreColor returns red for score 65', () => {
  assert.equal(riskScoreColor(65), '#f44336');
});

test('riskScoreColor returns orange for score 30', () => {
  assert.equal(riskScoreColor(30), '#ff9800');
});

test('riskScoreColor returns green for score 10', () => {
  assert.equal(riskScoreColor(10), '#4caf50');
});

// ── responseLabel ─────────────────────────────────────────────────────

test('responseLabel returns Peaceful for peaceful', () => {
  assert.equal(responseLabel('peaceful'), 'Peaceful');
});

test('responseLabel returns Dispersal for dispersal', () => {
  assert.equal(responseLabel('dispersal'), 'Dispersal');
});

test('responseLabel returns Crackdown for crackdown', () => {
  assert.equal(responseLabel('crackdown'), 'Crackdown');
});

test('responseLabel returns Lethal Force for lethal_force', () => {
  assert.equal(responseLabel('lethal_force'), 'Lethal Force');
});

test('responseLabel falls back to raw value for unknown', () => {
  const unknown = 'unknown' as GovernmentResponse;
  assert.equal(responseLabel(unknown), 'unknown');
});

// ── responseColor ─────────────────────────────────────────────────────

test('responseColor returns green for peaceful', () => {
  assert.equal(responseColor('peaceful'), '#4caf50');
});

test('responseColor returns orange for dispersal', () => {
  assert.equal(responseColor('dispersal'), '#ff9800');
});

test('responseColor returns red for crackdown', () => {
  assert.equal(responseColor('crackdown'), '#f44336');
});

test('responseColor returns dark red for lethal_force', () => {
  assert.equal(responseColor('lethal_force'), '#b71c1c');
});

// ── crisisTypeLabel ───────────────────────────────────────────────────

test('crisisTypeLabel returns Embassy Closure', () => {
  assert.equal(crisisTypeLabel('embassy_closure'), 'Embassy Closure');
});

test('crisisTypeLabel returns Diplomatic Expulsion', () => {
  assert.equal(crisisTypeLabel('expulsion'), 'Diplomatic Expulsion');
});

test('crisisTypeLabel returns Travel Ban', () => {
  assert.equal(crisisTypeLabel('travel_ban'), 'Travel Ban');
});

test('crisisTypeLabel returns Alliance Breakdown', () => {
  assert.equal(crisisTypeLabel('alliance_breakdown'), 'Alliance Breakdown');
});

test('crisisTypeLabel returns Sanctions Regime', () => {
  assert.equal(crisisTypeLabel('sanctions'), 'Sanctions Regime');
});

test('crisisTypeLabel falls back to raw type for unknown', () => {
  const unknown = 'unknown' as DiplomaticCrisisType;
  assert.equal(crisisTypeLabel(unknown), 'unknown');
});

// ── governanceColor ───────────────────────────────────────────────────

test('governanceColor score 0 returns ok var', () => {
  assert.ok(governanceColor(0).includes('severity-ok'));
});

test('governanceColor score 1 returns info var', () => {
  assert.ok(governanceColor(1).includes('severity-info'));
});

test('governanceColor score 2 returns medium var', () => {
  assert.ok(governanceColor(2).includes('severity-medium'));
});

test('governanceColor score 3 returns high var', () => {
  assert.ok(governanceColor(3).includes('severity-high'));
});

test('governanceColor score 4 returns critical var', () => {
  assert.ok(governanceColor(4).includes('severity-critical'));
});

test('governanceColor clamps score above 4 to critical', () => {
  assert.ok(governanceColor(10).includes('severity-critical'));
});

test('governanceColor clamps negative score to ok', () => {
  assert.ok(governanceColor(-1).includes('severity-ok'));
});

// ── governanceTier ────────────────────────────────────────────────────

test('governanceTier score 0 returns Stable', () => {
  assert.equal(governanceTier(0), 'Stable');
});

test('governanceTier score 1 returns Watch', () => {
  assert.equal(governanceTier(1), 'Watch');
});

test('governanceTier score 2 returns Elevated', () => {
  assert.equal(governanceTier(2), 'Elevated');
});

test('governanceTier score 3 returns High', () => {
  assert.equal(governanceTier(3), 'High');
});

test('governanceTier score 4 returns Critical', () => {
  assert.equal(governanceTier(4), 'Critical');
});

// ── formatTimeAgo ─────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000;

test('formatTimeAgo returns just now when diff < 1 min', () => {
  assert.equal(formatTimeAgo(NOW_MS - 30_000, NOW_MS), 'just now');
});

test('formatTimeAgo returns minutes ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 5 * 60_000, NOW_MS), '5m ago');
});

test('formatTimeAgo returns hours ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 6 * 3_600_000, NOW_MS), '6h ago');
});

test('formatTimeAgo returns days ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 3 * 86_400_000, NOW_MS), '3d ago');
});

test('formatTimeAgo returns just now for future timestamp', () => {
  assert.equal(formatTimeAgo(NOW_MS + 1000, NOW_MS), 'just now');
});

test('formatTimeAgo 1 minute exactly returns 1m ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 60_000, NOW_MS), '1m ago');
});

test('formatTimeAgo 1 hour exactly returns 1h ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 3_600_000, NOW_MS), '1h ago');
});

test('formatTimeAgo 1 day exactly returns 1d ago', () => {
  assert.equal(formatTimeAgo(NOW_MS - 86_400_000, NOW_MS), '1d ago');
});

// ── instabilityCount ──────────────────────────────────────────────────

test('instabilityCount counts high and critical events', () => {
  const events: CoupWatchEvent[] = [
    { country: 'A', countryCode: 'AA', eventType: 'coup', severity: 'critical', timestamp: 0, detail: '' },
    { country: 'B', countryCode: 'BB', eventType: 'uprising', severity: 'high', timestamp: 0, detail: '' },
    { country: 'C', countryCode: 'CC', eventType: 'uprising', severity: 'medium', timestamp: 0, detail: '' },
    { country: 'D', countryCode: 'DD', eventType: 'coup', severity: 'low', timestamp: 0, detail: '' },
  ];
  assert.equal(instabilityCount(events), 2);
});

test('instabilityCount returns 0 for empty array', () => {
  assert.equal(instabilityCount([]), 0);
});

test('instabilityCount excludes medium and low', () => {
  const events: CoupWatchEvent[] = [
    { country: 'A', countryCode: 'AA', eventType: 'coup', severity: 'medium', timestamp: 0, detail: '' },
    { country: 'B', countryCode: 'BB', eventType: 'uprising', severity: 'low', timestamp: 0, detail: '' },
  ];
  assert.equal(instabilityCount(events), 0);
});

// ── Static data shape ─────────────────────────────────────────────────

test('COUP_WATCH has at least 5 entries', () => {
  assert.ok(COUP_WATCH.length >= 5);
});

test('COUP_WATCH entries have required fields', () => {
  for (const e of COUP_WATCH) {
    assert.ok(typeof e.country === 'string' && e.country.length > 0, `country missing on ${e.countryCode}`);
    assert.ok(typeof e.countryCode === 'string', `countryCode missing`);
    assert.ok(['coup', 'uprising', 'contested_election', 'power_vacuum'].includes(e.eventType), `bad eventType: ${e.eventType}`);
    assert.ok(['low', 'medium', 'high', 'critical'].includes(e.severity), `bad severity: ${e.severity}`);
    assert.ok(typeof e.timestamp === 'number', `timestamp missing`);
    assert.ok(typeof e.detail === 'string', `detail missing`);
  }
});

test('ELECTION_RISKS has at least 5 entries', () => {
  assert.ok(ELECTION_RISKS.length >= 5);
});

test('ELECTION_RISKS entries have valid riskScore 0-100', () => {
  for (const el of ELECTION_RISKS) {
    assert.ok(el.riskScore >= 0 && el.riskScore <= 100, `riskScore out of range: ${el.riskScore}`);
    assert.ok(Array.isArray(el.riskFactors) && el.riskFactors.length > 0, `riskFactors missing for ${el.country}`);
  }
});

test('PROTEST_EVENTS has at least 5 entries', () => {
  assert.ok(PROTEST_EVENTS.length >= 5);
});

test('PROTEST_EVENTS entries have valid governmentResponse', () => {
  const valid = new Set(['peaceful', 'dispersal', 'crackdown', 'lethal_force']);
  for (const p of PROTEST_EVENTS) {
    assert.ok(valid.has(p.governmentResponse), `bad governmentResponse: ${p.governmentResponse}`);
  }
});

test('DIPLOMATIC_CRISES has at least 5 entries', () => {
  assert.ok(DIPLOMATIC_CRISES.length >= 5);
});

test('DIPLOMATIC_CRISES entries have valid crisisType', () => {
  const valid = new Set(['embassy_closure', 'expulsion', 'travel_ban', 'alliance_breakdown', 'sanctions']);
  for (const d of DIPLOMATIC_CRISES) {
    assert.ok(valid.has(d.crisisType), `bad crisisType: ${d.crisisType}`);
  }
});

test('GOVERNANCE_INDEX has at least 5 entries', () => {
  assert.ok(GOVERNANCE_INDEX.length >= 5);
});

test('GOVERNANCE_INDEX scores are 0-4', () => {
  for (const r of GOVERNANCE_INDEX) {
    assert.ok(r.score >= 0 && r.score <= 4, `score out of range: ${r.score} for ${r.region}`);
  }
});

// ── COUP_WATCH data quality ───────────────────────────────────────────

test('COUP_WATCH timestamps are in the past', () => {
  const now = Date.now();
  for (const e of COUP_WATCH) {
    assert.ok(e.timestamp <= now, `timestamp ${e.timestamp} is in the future for ${e.country}`);
  }
});

test('COUP_WATCH has at least one critical event', () => {
  assert.ok(COUP_WATCH.some((e) => e.severity === 'critical'));
});

// ── ELECTION_RISKS data quality ───────────────────────────────────────

test('ELECTION_RISKS highest riskScore is first or close to first', () => {
  const scores = ELECTION_RISKS.map((e) => e.riskScore);
  assert.equal(Math.max(...scores), scores[0]);
});

// ── instabilityCount with real COUP_WATCH ────────────────────────────

test('instabilityCount on real COUP_WATCH returns >= 2', () => {
  assert.ok(instabilityCount(COUP_WATCH) >= 2);
});
