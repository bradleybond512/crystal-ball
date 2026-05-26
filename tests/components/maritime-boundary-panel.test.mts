/**
 * Tests for MaritimeBoundaryPanel — pure helpers + derivations.
 *
 * Run with:
 *   npx tsx --test tests/components/maritime-boundary-panel.test.mts
 *
 * No DOM required — helpers exported from `maritime-boundary-helpers.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bandColor,
  bandForScore,
  bandLabel,
  BOUNDARY_DISPUTE_EVENTS,
  casePhaseLabel,
  computeMaritimeBoundaryScore,
  confrontationIntensityColor,
  confrontationIntensityLabel,
  countActiveArbitrations,
  countEscalatingDisputes,
  countHighIntensityMilitarization,
  countRecentEnforcementIncidents,
  countRecentIncursionEvents,
  countUnsafeConfrontations,
  disputeKindLabel,
  disputeStatusColor,
  disputeStatusLabel,
  enforcementKindLabel,
  ENFORCEMENT_INCIDENTS,
  FISHERIES_INCURSIONS,
  heatColor,
  incursionKindLabel,
  militarizationKindLabel,
  MILITARIZATION_SIGNALS,
  NAVAL_CONFRONTATIONS,
  summarizeHeatByRegion,
  summarizeIncursionsByRegion,
  timeAgo,
  UNCLOS_CASE_DOCKET,
  venueLabel,
  type ArbitrationVenue,
  type BoundaryDisputeEvent,
  type CasePhase,
  type ConfrontationIntensity,
  type DisputeKind,
  type DisputeStatus,
  type EnforcementKind,
  type FisheriesIncursionEvent,
  type IncursionKind,
  type MaritimeEnforcementIncident,
  type MaritimeRegion,
  type MilitarizationKind,
  type MilitarizationSignal,
  type NavalConfrontationEvent,
  type RiskBand,
  type UnclosCaseRow,
} from '../../src/components/maritime-boundary-helpers.ts';

const NOW = 1_745_000_000_000;

// ── Color / label helpers ────────────────────────────────────────

test('bandColor: critical returns red, low returns green', () => {
  assert.ok(bandColor('critical').includes('#ef4444'));
  assert.ok(bandColor('low').includes('#4caf50'));
});

test('bandLabel: covers all four bands with distinct strings', () => {
  const bands: RiskBand[] = ['low', 'moderate', 'high', 'critical'];
  const labels = new Set(bands.map((b) => bandLabel(b)));
  assert.equal(labels.size, 4);
});

test('disputeKindLabel: covers all six dispute kinds', () => {
  const kinds: DisputeKind[] = [
    'eez-overlap', 'territorial-sea', 'continental-shelf',
    'island-sovereignty', 'baseline-claim', 'transit-passage',
  ];
  const labels = new Set(kinds.map((k) => disputeKindLabel(k)));
  assert.equal(labels.size, 6);
});

test('disputeStatusLabel: hyphenated arbitration-pending reads as "Arbitration pending"', () => {
  assert.equal(disputeStatusLabel('arbitration-pending'), 'Arbitration pending');
});

test('disputeStatusLabel: covers all four statuses distinctly', () => {
  const statuses: DisputeStatus[] = ['dormant', 'active', 'escalating', 'arbitration-pending'];
  const labels = new Set(statuses.map((s) => disputeStatusLabel(s)));
  assert.equal(labels.size, 4);
});

test('disputeStatusColor: escalating critical-red, dormant grey', () => {
  assert.ok(disputeStatusColor('escalating').includes('#ef4444'));
  assert.ok(disputeStatusColor('dormant').includes('#9e9e9e'));
});

test('venueLabel: covers all five UNCLOS venues distinctly', () => {
  const venues: ArbitrationVenue[] = ['ICJ', 'ITLOS', 'PCA', 'Annex-VII-Tribunal', 'Conciliation-Commission'];
  const labels = new Set(venues.map((v) => venueLabel(v)));
  assert.equal(labels.size, 5);
});

test('casePhaseLabel: covers all six phases with distinct strings', () => {
  const phases: CasePhase[] = ['filed', 'pleadings', 'hearings', 'deliberation', 'award-issued', 'compliance-monitoring'];
  const labels = new Set(phases.map((p) => casePhaseLabel(p)));
  assert.equal(labels.size, 6);
});

test('militarizationKindLabel: covers all six militarization kinds', () => {
  const kinds: MilitarizationKind[] = [
    'runway-construction', 'radar-emplacement', 'missile-deployment',
    'garrison-rotation', 'port-expansion', 'reclamation-fill',
  ];
  const labels = new Set(kinds.map((k) => militarizationKindLabel(k)));
  assert.equal(labels.size, 6);
});

test('incursionKindLabel: covers all four incursion kinds distinctly', () => {
  const kinds: IncursionKind[] = ['unlicensed-fishing', 'flag-state-violation', 'IUU-fleet-presence', 'gear-incident'];
  const labels = new Set(kinds.map((k) => incursionKindLabel(k)));
  assert.equal(labels.size, 4);
});

test('enforcementKindLabel: covers all six enforcement kinds', () => {
  const kinds: EnforcementKind[] = [
    'vessel-boarding', 'detention', 'vessel-seizure',
    'fine-issued', 'release', 'diplomatic-protest',
  ];
  const labels = new Set(kinds.map((k) => enforcementKindLabel(k)));
  assert.equal(labels.size, 6);
});

test('confrontationIntensityLabel: covers all four intensities', () => {
  const intensities: ConfrontationIntensity[] = ['observed', 'shadowing', 'unsafe-maneuver', 'live-fire-warning'];
  const labels = new Set(intensities.map((c) => confrontationIntensityLabel(c)));
  assert.equal(labels.size, 4);
});

test('confrontationIntensityColor: live-fire critical-red, observed grey', () => {
  assert.ok(confrontationIntensityColor('live-fire-warning').includes('#ef4444'));
  assert.ok(confrontationIntensityColor('observed').includes('#9e9e9e'));
});

test('heatColor: 90 maps to critical-red, 10 maps to low-green', () => {
  assert.ok(heatColor(90).includes('#ef4444'));
  assert.ok(heatColor(10).includes('#4caf50'));
});

// ── timeAgo ──────────────────────────────────────────────────────

test('timeAgo: <60s returns "now"', () => {
  assert.equal(timeAgo(NOW - 30_000, NOW), 'now');
});

test('timeAgo: minutes returns "Xm ago"', () => {
  assert.equal(timeAgo(NOW - 8 * 60_000, NOW), '8m ago');
});

test('timeAgo: hours returns "Xh ago"', () => {
  assert.equal(timeAgo(NOW - 3 * 60 * 60_000, NOW), '3h ago');
});

test('timeAgo: days returns "Xd ago"', () => {
  assert.equal(timeAgo(NOW - 6 * 24 * 60 * 60_000, NOW), '6d ago');
});

test('timeAgo: future timestamp returns "future"', () => {
  assert.equal(timeAgo(NOW + 5_000, NOW), 'future');
});

// ── bandForScore + computeMaritimeBoundaryScore ──────────────────

test('bandForScore: thresholds align with spec', () => {
  assert.equal(bandForScore(0), 'low');
  assert.equal(bandForScore(24), 'low');
  assert.equal(bandForScore(25), 'moderate');
  assert.equal(bandForScore(49), 'moderate');
  assert.equal(bandForScore(50), 'high');
  assert.equal(bandForScore(74), 'high');
  assert.equal(bandForScore(75), 'critical');
  assert.equal(bandForScore(100), 'critical');
});

test('computeMaritimeBoundaryScore: empty input → 0 / low band', () => {
  const s = computeMaritimeBoundaryScore({
    escalatingDisputes: 0, activeArbitrations: 0,
    highIntensityMilitarization: 0, recentIncursionEvents: 0,
    recentEnforcementIncidents: 0, unsafeConfrontations: 0,
  });
  assert.equal(s.total, 0);
  assert.equal(s.band, 'low');
});

test('computeMaritimeBoundaryScore: saturated input → 100 / critical, weights sum to 100', () => {
  const s = computeMaritimeBoundaryScore({
    escalatingDisputes: 999, activeArbitrations: 999,
    highIntensityMilitarization: 999, recentIncursionEvents: 999,
    recentEnforcementIncidents: 999, unsafeConfrontations: 999,
  });
  assert.equal(s.total, 100);
  assert.equal(s.band, 'critical');
  assert.equal(s.contributions.boundaryDisputes, 20);
  assert.equal(s.contributions.arbitrationLoad, 15);
  assert.equal(s.contributions.militarization, 20);
  assert.equal(s.contributions.fisheriesIncursions, 15);
  assert.equal(s.contributions.enforcementIncidents, 15);
  assert.equal(s.contributions.navalConfrontations, 15);
  const sum = Object.values(s.contributions).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('computeMaritimeBoundaryScore: contributions never negative on negative input', () => {
  const s = computeMaritimeBoundaryScore({
    escalatingDisputes: -1, activeArbitrations: -1,
    highIntensityMilitarization: -1, recentIncursionEvents: -1,
    recentEnforcementIncidents: -1, unsafeConfrontations: -1,
  });
  for (const v of Object.values(s.contributions)) assert.ok(v >= 0);
  assert.equal(s.total, 0);
});

test('computeMaritimeBoundaryScore: dispute-axis alone can hit 20-weight cap', () => {
  const s = computeMaritimeBoundaryScore({
    escalatingDisputes: 4, activeArbitrations: 0,
    highIntensityMilitarization: 0, recentIncursionEvents: 0,
    recentEnforcementIncidents: 0, unsafeConfrontations: 0,
  });
  assert.equal(s.contributions.boundaryDisputes, 20);
  assert.equal(s.total, 20);
});

test('computeMaritimeBoundaryScore: half-axis loadout lands in moderate band', () => {
  const s = computeMaritimeBoundaryScore({
    escalatingDisputes: 2,                       // 50% × 20 = 10
    activeArbitrations: 2,                       // 40% × 15 = 6
    highIntensityMilitarization: 2,              // 50% × 20 = 10
    recentIncursionEvents: 3,                    // 50% × 15 = 7.5
    recentEnforcementIncidents: 3,               // 50% × 15 = 7.5
    unsafeConfrontations: 1,                     // ~33% × 15 = 5
  });
  assert.ok(s.total >= 40 && s.total < 50, `expected moderate band, got ${s.total}`);
  assert.equal(s.band, 'moderate');
});

// ── countEscalatingDisputes ──────────────────────────────────────

test('countEscalatingDisputes: counts only escalating status', () => {
  const rows: BoundaryDisputeEvent[] = [
    { region: 'South China Sea',       partyA: 'A', partyB: 'B', kind: 'eez-overlap',       status: 'escalating',         heatIndex: 80, reportedAt: NOW, summary: '' },
    { region: 'Eastern Mediterranean', partyA: 'A', partyB: 'B', kind: 'eez-overlap',       status: 'active',             heatIndex: 50, reportedAt: NOW, summary: '' },
    { region: 'Arctic',                partyA: 'A', partyB: 'B', kind: 'continental-shelf', status: 'arbitration-pending',heatIndex: 40, reportedAt: NOW, summary: '' },
    { region: 'Black Sea',             partyA: 'A', partyB: 'B', kind: 'eez-overlap',       status: 'escalating',         heatIndex: 70, reportedAt: NOW, summary: '' },
  ];
  assert.equal(countEscalatingDisputes(rows), 2);
});

// ── countActiveArbitrations ──────────────────────────────────────

test('countActiveArbitrations: excludes award-issued and compliance-monitoring', () => {
  const rows: UnclosCaseRow[] = [
    { caseName: 'A', venue: 'ICJ', applicant: 'X', respondent: 'Y', phase: 'pleadings',              filedAt: NOW, region: 'Arctic',          note: '' },
    { caseName: 'B', venue: 'ITLOS', applicant: 'X', respondent: 'Y', phase: 'hearings',             filedAt: NOW, region: 'Caribbean',       note: '' },
    { caseName: 'C', venue: 'PCA', applicant: 'X', respondent: 'Y', phase: 'award-issued',           filedAt: NOW, region: 'Sea of Japan',    note: '' },
    { caseName: 'D', venue: 'Annex-VII-Tribunal', applicant: 'X', respondent: 'Y', phase: 'compliance-monitoring', filedAt: NOW, region: 'Black Sea', note: '' },
    { caseName: 'E', venue: 'ICJ', applicant: 'X', respondent: 'Y', phase: 'deliberation',           filedAt: NOW, region: 'Aegean',          note: '' },
  ];
  assert.equal(countActiveArbitrations(rows), 3);
});

// ── countHighIntensityMilitarization ─────────────────────────────

test('countHighIntensityMilitarization: requires intensity ≥ 70', () => {
  const rows: MilitarizationSignal[] = [
    { feature: 'F1', region: 'South China Sea', controllingClaimant: 'X', kind: 'runway-construction', intensity: 80, observedAt: NOW, rationale: '' },
    { feature: 'F2', region: 'South China Sea', controllingClaimant: 'X', kind: 'radar-emplacement',   intensity: 69, observedAt: NOW, rationale: '' },
    { feature: 'F3', region: 'South China Sea', controllingClaimant: 'X', kind: 'missile-deployment',  intensity: 70, observedAt: NOW, rationale: '' },
  ];
  assert.equal(countHighIntensityMilitarization(rows), 2);
});

// ── countRecentIncursionEvents ───────────────────────────────────

test('countRecentIncursionEvents: excludes events older than 30 days', () => {
  const rows: FisheriesIncursionEvent[] = [
    { region: 'South China Sea', flagState: 'F', hostState: 'H', kind: 'IUU-fleet-presence', vesselCount: 5, reportedAt: NOW -  2 * 24 * 60 * 60_000, notable: '' },
    { region: 'Gulf of Guinea',  flagState: 'F', hostState: 'H', kind: 'unlicensed-fishing', vesselCount: 3, reportedAt: NOW - 31 * 24 * 60 * 60_000, notable: '' },
  ];
  assert.equal(countRecentIncursionEvents(rows, NOW), 1);
});

// ── countRecentEnforcementIncidents ──────────────────────────────

test('countRecentEnforcementIncidents: excludes incidents older than 30 days', () => {
  const rows: MaritimeEnforcementIncident[] = [
    { region: 'South China Sea', hostState: 'H', flagState: 'F', kind: 'vessel-boarding', vesselCount: 1, reportedAt: NOW -  5 * 24 * 60 * 60_000, outcome: '' },
    { region: 'Persian Gulf',    hostState: 'H', flagState: 'F', kind: 'detention',       vesselCount: 1, reportedAt: NOW - 45 * 24 * 60 * 60_000, outcome: '' },
    { region: 'Caribbean',       hostState: 'H', flagState: 'F', kind: 'fine-issued',     vesselCount: 0, reportedAt: NOW - 20 * 24 * 60 * 60_000, outcome: '' },
  ];
  assert.equal(countRecentEnforcementIncidents(rows, NOW), 2);
});

// ── countUnsafeConfrontations ────────────────────────────────────

test('countUnsafeConfrontations: requires unsafe/live-fire AND 14-day freshness', () => {
  const rows: NavalConfrontationEvent[] = [
    { region: 'South China Sea', partyA: 'A', partyB: 'B', intensity: 'unsafe-maneuver',   observedAt: NOW -  1 * 24 * 60 * 60_000, summary: '' },
    { region: 'Black Sea',       partyA: 'A', partyB: 'B', intensity: 'live-fire-warning', observedAt: NOW -  3 * 24 * 60 * 60_000, summary: '' },
    { region: 'Persian Gulf',    partyA: 'A', partyB: 'B', intensity: 'shadowing',         observedAt: NOW -  1 * 24 * 60 * 60_000, summary: '' }, // wrong intensity
    { region: 'Aegean',          partyA: 'A', partyB: 'B', intensity: 'unsafe-maneuver',   observedAt: NOW - 20 * 24 * 60 * 60_000, summary: '' }, // too old
  ];
  assert.equal(countUnsafeConfrontations(rows, NOW), 2);
});

// ── summarizeHeatByRegion ────────────────────────────────────────

test('summarizeHeatByRegion: groups by region, averages heat, sorts by heat desc', () => {
  const rows: BoundaryDisputeEvent[] = [
    { region: 'South China Sea', partyA: 'A', partyB: 'B', kind: 'eez-overlap', status: 'escalating', heatIndex: 80, reportedAt: NOW, summary: '' },
    { region: 'South China Sea', partyA: 'C', partyB: 'D', kind: 'eez-overlap', status: 'active',     heatIndex: 60, reportedAt: NOW, summary: '' },
    { region: 'Arctic',          partyA: 'E', partyB: 'F', kind: 'continental-shelf', status: 'active', heatIndex: 40, reportedAt: NOW, summary: '' },
  ];
  const out = summarizeHeatByRegion(rows);
  assert.equal(out[0]?.region, 'South China Sea');
  assert.equal(out[0]?.heat, 70);
  assert.equal(out[0]?.contributingClaims, 2);
  assert.equal(out[1]?.region, 'Arctic');
  assert.equal(out[1]?.heat, 40);
});

test('summarizeHeatByRegion: empty input returns empty array', () => {
  assert.equal(summarizeHeatByRegion([]).length, 0);
});

test('summarizeHeatByRegion: single-row input returns single row with original heat', () => {
  const rows: BoundaryDisputeEvent[] = [
    { region: 'Aegean', partyA: 'A', partyB: 'B', kind: 'territorial-sea', status: 'active', heatIndex: 55, reportedAt: NOW, summary: '' },
  ];
  const out = summarizeHeatByRegion(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.heat, 55);
  assert.equal(out[0]?.band, 'high');
});

// ── summarizeIncursionsByRegion ──────────────────────────────────

test('summarizeIncursionsByRegion: groups by region and sorts by vesselCount desc', () => {
  const rows: FisheriesIncursionEvent[] = [
    { region: 'South China Sea', flagState: 'F', hostState: 'H', kind: 'IUU-fleet-presence',   vesselCount: 100, reportedAt: NOW -  1 * 24 * 60 * 60_000, notable: '' },
    { region: 'South China Sea', flagState: 'F', hostState: 'H', kind: 'unlicensed-fishing',   vesselCount:  40, reportedAt: NOW -  2 * 24 * 60 * 60_000, notable: '' },
    { region: 'Gulf of Guinea',  flagState: 'F', hostState: 'H', kind: 'unlicensed-fishing',   vesselCount:  18, reportedAt: NOW -  3 * 24 * 60 * 60_000, notable: '' },
  ];
  const out = summarizeIncursionsByRegion(rows, NOW);
  assert.equal(out[0]?.region, 'South China Sea');
  assert.equal(out[0]?.vesselCount, 140);
  assert.equal(out[0]?.eventCount, 2);
  assert.equal(out[1]?.region, 'Gulf of Guinea');
  assert.equal(out[1]?.vesselCount, 18);
});

test('summarizeIncursionsByRegion: excludes events older than 30 days', () => {
  const rows: FisheriesIncursionEvent[] = [
    { region: 'Sea of Japan', flagState: 'F', hostState: 'H', kind: 'IUU-fleet-presence', vesselCount: 50, reportedAt: NOW - 40 * 24 * 60 * 60_000, notable: '' },
  ];
  assert.equal(summarizeIncursionsByRegion(rows, NOW).length, 0);
});

// ── Reference catalogues ─────────────────────────────────────────

test('BOUNDARY_DISPUTE_EVENTS: covers at least six distinct regions', () => {
  const regions = new Set(BOUNDARY_DISPUTE_EVENTS.map((r) => r.region));
  assert.ok(regions.size >= 6, `got ${regions.size}`);
});

test('BOUNDARY_DISPUTE_EVENTS: every dispute status is represented at least once', () => {
  const statuses = new Set(BOUNDARY_DISPUTE_EVENTS.map((r) => r.status));
  for (const s of ['dormant', 'active', 'escalating', 'arbitration-pending']) {
    assert.ok(statuses.has(s as DisputeStatus), `missing status ${s}`);
  }
});

test('BOUNDARY_DISPUTE_EVENTS: every heatIndex stays inside 0..100', () => {
  for (const r of BOUNDARY_DISPUTE_EVENTS) {
    assert.ok(r.heatIndex >= 0 && r.heatIndex <= 100, `out-of-range heat ${r.heatIndex}`);
  }
});

test('UNCLOS_CASE_DOCKET: contains at least one ICJ + one ITLOS + one PCA + one Annex VII case', () => {
  const venues = new Set(UNCLOS_CASE_DOCKET.map((r) => r.venue));
  assert.ok(venues.has('ICJ'));
  assert.ok(venues.has('ITLOS'));
  assert.ok(venues.has('PCA'));
  assert.ok(venues.has('Annex-VII-Tribunal'));
});

test('UNCLOS_CASE_DOCKET: at least one case is in an active phase', () => {
  const active = UNCLOS_CASE_DOCKET.filter((r) =>
    r.phase !== 'award-issued' && r.phase !== 'compliance-monitoring',
  );
  assert.ok(active.length >= 1);
});

test('MILITARIZATION_SIGNALS: covers all six militarization kinds at least once', () => {
  const kinds = new Set(MILITARIZATION_SIGNALS.map((m) => m.kind));
  for (const k of ['runway-construction', 'radar-emplacement', 'missile-deployment', 'garrison-rotation', 'port-expansion', 'reclamation-fill']) {
    assert.ok(kinds.has(k as MilitarizationKind), `missing kind ${k}`);
  }
});

test('MILITARIZATION_SIGNALS: includes at least one high-intensity (≥ 70) signal', () => {
  assert.ok(MILITARIZATION_SIGNALS.some((m) => m.intensity >= 70));
});

test('FISHERIES_INCURSIONS: covers all four incursion kinds at least once', () => {
  const kinds = new Set(FISHERIES_INCURSIONS.map((r) => r.kind));
  for (const k of ['unlicensed-fishing', 'flag-state-violation', 'IUU-fleet-presence', 'gear-incident']) {
    assert.ok(kinds.has(k as IncursionKind), `missing kind ${k}`);
  }
});

test('ENFORCEMENT_INCIDENTS: covers at least four distinct enforcement kinds', () => {
  const kinds = new Set(ENFORCEMENT_INCIDENTS.map((r) => r.kind));
  assert.ok(kinds.size >= 4, `got ${kinds.size}`);
});

test('NAVAL_CONFRONTATIONS: every intensity tier is represented at least once', () => {
  const intensities = new Set(NAVAL_CONFRONTATIONS.map((r) => r.intensity));
  for (const i of ['observed', 'shadowing', 'unsafe-maneuver', 'live-fire-warning']) {
    assert.ok(intensities.has(i as ConfrontationIntensity), `missing intensity ${i}`);
  }
});

test('NAVAL_CONFRONTATIONS: framing summaries do not contain operational verbs', () => {
  const banned = ['target', 'targeting', 'engage', 'engagement', 'destroy', 'kill', 'eliminate'];
  for (const r of NAVAL_CONFRONTATIONS) {
    const txt = r.summary.toLowerCase();
    for (const b of banned) {
      assert.ok(!txt.includes(b), `confrontation summary leaks operational verb "${b}": ${r.summary}`);
    }
  }
});

test('summarizeHeatByRegion: composite-band classification is consistent with bandForScore', () => {
  for (const row of summarizeHeatByRegion(BOUNDARY_DISPUTE_EVENTS)) {
    assert.equal(row.band, bandForScore(row.heat));
  }
});

test('regions referenced across catalogues are inside the MaritimeRegion union', () => {
  const allowed: MaritimeRegion[] = [
    'South China Sea', 'East China Sea', 'Arctic', 'Eastern Mediterranean',
    'Persian Gulf', 'Gulf of Guinea', 'Sea of Japan', 'Black Sea', 'Caribbean', 'Aegean',
  ];
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<string>();
  for (const r of BOUNDARY_DISPUTE_EVENTS)  seen.add(r.region);
  for (const r of MILITARIZATION_SIGNALS)   seen.add(r.region);
  for (const r of FISHERIES_INCURSIONS)     seen.add(r.region);
  for (const r of ENFORCEMENT_INCIDENTS)    seen.add(r.region);
  for (const r of NAVAL_CONFRONTATIONS)     seen.add(r.region);
  for (const r of UNCLOS_CASE_DOCKET)       seen.add(r.region);
  for (const r of seen) assert.ok(allowedSet.has(r), `unexpected region "${r}"`);
});
