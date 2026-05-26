/**
 * Tests for NarcoticsTraffickingPanel — pure helpers + derivations.
 *
 * Run with:
 *   npx tsx --test tests/components/narcotics-trafficking-panel.test.mts
 *
 * No DOM required — helpers exported from `narcotics-trafficking-helpers.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bandColor,
  bandForScore,
  bandLabel,
  CARTEL_TERRITORIAL_EVENTS,
  computeNarcoticsScore,
  countActiveDisruptions,
  countCriticalNarcoStates,
  countHighConfidencePrecursorSignals,
  countOpenWarfareConflicts,
  countRisingVolumeSubstances,
  disruptionCauseLabel,
  formatSeizure,
  intensityColor,
  intensityLabel,
  INTERDICTION_EVENTS_BASE,
  methodLabel,
  NARCO_STATE_INDICES,
  precursorLabel,
  PRECURSOR_SIGNALS_BASE,
  ROUTE_DISRUPTIONS_BASE,
  substanceLabel,
  summarizeInterdictionsByRegion,
  timeAgo,
  volumeTrendArrow,
  volumeTrendColor,
  VOLUME_TRENDS_BASE,
  type CartelTerritorialEvent,
  type ConflictIntensity,
  type DisruptionCause,
  type InterdictionMethod,
  type NarcoStateIndex,
  type PrecursorChemical,
  type PrecursorSignal,
  type RiskBand,
  type RouteDisruption,
  type Substance,
  type VolumeTrend,
  type VolumeTrendRow,
} from '../../src/components/narcotics-trafficking-helpers.ts';

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

test('intensityColor: open-warfare red, dormant grey', () => {
  assert.ok(intensityColor('open-warfare').includes('#ef4444'));
  assert.ok(intensityColor('dormant').includes('#9e9e9e'));
});

test('intensityLabel: hyphenated open-warfare reads as "Open warfare"', () => {
  assert.equal(intensityLabel('open-warfare'), 'Open warfare');
});

test('intensityLabel: covers all four intensities distinctly', () => {
  const intensities: ConflictIntensity[] = ['dormant', 'skirmish', 'contested', 'open-warfare'];
  const labels = new Set(intensities.map((i) => intensityLabel(i)));
  assert.equal(labels.size, 4);
});

test('substanceLabel: handles hyphenated synthetic-opioid', () => {
  assert.equal(substanceLabel('synthetic-opioid'), 'Synthetic opioid');
});

test('substanceLabel: covers all six substances', () => {
  const subs: Substance[] = ['cocaine', 'heroin', 'methamphetamine', 'fentanyl', 'cannabis', 'synthetic-opioid'];
  const labels = new Set(subs.map((s) => substanceLabel(s)));
  assert.equal(labels.size, 6);
});

test('disruptionCauseLabel: covers all four causes', () => {
  const causes: DisruptionCause[] = ['interdiction', 'territorial-conflict', 'natural-event', 'sanctions'];
  for (const c of causes) assert.ok(disruptionCauseLabel(c).length > 0);
});

test('methodLabel: covers all four interdiction methods', () => {
  const methods: InterdictionMethod[] = ['maritime', 'aerial', 'land', 'postal'];
  const labels = new Set(methods.map((m) => methodLabel(m)));
  assert.equal(labels.size, 4);
});

test('precursorLabel: covers all six chemicals with distinct strings', () => {
  const chemicals: PrecursorChemical[] = ['ephedrine', 'pseudoephedrine', 'N-phenethyl-4-piperidone', 'acetic-anhydride', 'NPP', 'ANPP'];
  const labels = new Set(chemicals.map((p) => precursorLabel(p)));
  assert.equal(labels.size, 6);
});

test('volumeTrendArrow: rising/falling/flat distinct', () => {
  const set = new Set([
    volumeTrendArrow('rising'),
    volumeTrendArrow('falling'),
    volumeTrendArrow('flat'),
  ]);
  assert.equal(set.size, 3);
});

test('volumeTrendColor: rising red, falling green, flat grey', () => {
  assert.ok(volumeTrendColor('rising').includes('#ef4444'));
  assert.ok(volumeTrendColor('falling').includes('#4caf50'));
  assert.ok(volumeTrendColor('flat').includes('#9e9e9e'));
});

// ── timeAgo ──────────────────────────────────────────────────────

test('timeAgo: <60s returns "now"', () => {
  assert.equal(timeAgo(NOW - 30_000, NOW), 'now');
});

test('timeAgo: minutes returns "Xm ago"', () => {
  assert.equal(timeAgo(NOW - 7 * 60_000, NOW), '7m ago');
});

test('timeAgo: hours returns "Xh ago"', () => {
  assert.equal(timeAgo(NOW - 2 * 60 * 60_000, NOW), '2h ago');
});

test('timeAgo: days returns "Xd ago"', () => {
  assert.equal(timeAgo(NOW - 5 * 24 * 60 * 60_000, NOW), '5d ago');
});

test('timeAgo: future timestamp returns "future"', () => {
  assert.equal(timeAgo(NOW + 5_000, NOW), 'future');
});

// ── bandForScore + computeNarcoticsScore ─────────────────────────

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

test('computeNarcoticsScore: empty input → 0 / low band', () => {
  const s = computeNarcoticsScore({
    activeDisruptions: 0, openWarfareConflicts: 0,
    highConfidencePrecursorSignals: 0, criticalNarcoStates: 0, risingVolumeSubstances: 0,
  });
  assert.equal(s.total, 0);
  assert.equal(s.band, 'low');
});

test('computeNarcoticsScore: saturated input → 100 / critical, weights sum to 100', () => {
  const s = computeNarcoticsScore({
    activeDisruptions: 999, openWarfareConflicts: 999,
    highConfidencePrecursorSignals: 999, criticalNarcoStates: 999, risingVolumeSubstances: 999,
  });
  assert.equal(s.total, 100);
  assert.equal(s.band, 'critical');
  assert.equal(s.contributions.routeDisruption, 25);
  assert.equal(s.contributions.cartelConflict, 20);
  assert.equal(s.contributions.precursorDiversion, 20);
  assert.equal(s.contributions.narcoStateCorruption, 20);
  assert.equal(s.contributions.volumeAccel, 15);
  const sum = Object.values(s.contributions).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('computeNarcoticsScore: contributions never negative on negative input', () => {
  const s = computeNarcoticsScore({
    activeDisruptions: -1, openWarfareConflicts: -1,
    highConfidencePrecursorSignals: -1, criticalNarcoStates: -1, risingVolumeSubstances: -1,
  });
  for (const v of Object.values(s.contributions)) assert.ok(v >= 0);
});

test('computeNarcoticsScore: route-disruption alone can hit 25 weight cap', () => {
  const s = computeNarcoticsScore({
    activeDisruptions: 6, openWarfareConflicts: 0,
    highConfidencePrecursorSignals: 0, criticalNarcoStates: 0, risingVolumeSubstances: 0,
  });
  assert.equal(s.contributions.routeDisruption, 25);
  assert.equal(s.total, 25);
});

test('computeNarcoticsScore: half-axis loadout lands in moderate band', () => {
  const s = computeNarcoticsScore({
    activeDisruptions: 3,                       // 50% × 25 = 12.5
    openWarfareConflicts: 2,                    // 50% × 20 = 10
    highConfidencePrecursorSignals: 2,          // 50% × 20 = 10
    criticalNarcoStates: 2,                     // 40% × 20 = 8
    risingVolumeSubstances: 1,                  // ~33% × 15 = 5
  });
  assert.ok(s.total >= 40 && s.total < 50, `expected moderate band, got ${s.total}`);
  assert.equal(s.band, 'moderate');
});

// ── countActiveDisruptions ───────────────────────────────────────

test('countActiveDisruptions: filters by 7-day window AND ≥20% throughput impact', () => {
  const rows: RouteDisruption[] = [
    { routeRegion: 'Caribbean',    substance: 'cocaine', cause: 'interdiction', throughputImpactPct: 25, detectedAt: NOW - 1 * 24 * 60 * 60_000, summary: 'X' },
    { routeRegion: 'Balkans',      substance: 'heroin',  cause: 'interdiction', throughputImpactPct: 25, detectedAt: NOW - 9 * 24 * 60 * 60_000, summary: 'X' }, // too old
    { routeRegion: 'West Africa',  substance: 'cocaine', cause: 'sanctions',    throughputImpactPct: 10, detectedAt: NOW - 1 * 24 * 60 * 60_000, summary: 'X' }, // below threshold
  ];
  assert.equal(countActiveDisruptions(rows, NOW), 1);
});

// ── countOpenWarfareConflicts ────────────────────────────────────

test('countOpenWarfareConflicts: counts only open-warfare intensity', () => {
  const rows: CartelTerritorialEvent[] = [
    { region: 'A', primaryActor: 'X', rivalActor: 'Y', intensity: 'open-warfare', recentClashes30d: 5, notable: '' },
    { region: 'B', primaryActor: 'X', rivalActor: 'Y', intensity: 'contested',    recentClashes30d: 5, notable: '' },
    { region: 'C', primaryActor: 'X', rivalActor: 'Y', intensity: 'open-warfare', recentClashes30d: 5, notable: '' },
  ];
  assert.equal(countOpenWarfareConflicts(rows), 2);
});

// ── countHighConfidencePrecursorSignals ──────────────────────────

test('countHighConfidencePrecursorSignals: requires ≥0.7 confidence AND 30d freshness', () => {
  const rows: PrecursorSignal[] = [
    { chemical: 'NPP',  originRegion: 'X', destinationRegion: 'Y', diversionConfidence: 0.85, reportedAt: NOW - 1  * 24 * 60 * 60_000, rationale: '' },
    { chemical: 'ANPP', originRegion: 'X', destinationRegion: 'Y', diversionConfidence: 0.85, reportedAt: NOW - 40 * 24 * 60 * 60_000, rationale: '' }, // too old
    { chemical: 'NPP',  originRegion: 'X', destinationRegion: 'Y', diversionConfidence: 0.5,  reportedAt: NOW - 1  * 24 * 60 * 60_000, rationale: '' }, // below confidence
  ];
  assert.equal(countHighConfidencePrecursorSignals(rows, NOW), 1);
});

// ── countCriticalNarcoStates ─────────────────────────────────────

test('countCriticalNarcoStates: only counts critical band', () => {
  const rows: NarcoStateIndex[] = [
    { country: 'A', corruptionScore: 80, band: 'critical', driver: '' },
    { country: 'B', corruptionScore: 60, band: 'high',     driver: '' },
    { country: 'C', corruptionScore: 80, band: 'critical', driver: '' },
  ];
  assert.equal(countCriticalNarcoStates(rows), 2);
});

// ── countRisingVolumeSubstances ──────────────────────────────────

test('countRisingVolumeSubstances: counts trend=rising only', () => {
  const rows: VolumeTrendRow[] = [
    { substance: 'fentanyl', volume30dTonnes: 10, trend: 'rising',  relativeShift: 0.2 },
    { substance: 'cocaine',  volume30dTonnes: 10, trend: 'flat',    relativeShift: 0   },
    { substance: 'heroin',   volume30dTonnes: 10, trend: 'falling', relativeShift: -0.2 },
  ];
  assert.equal(countRisingVolumeSubstances(rows), 1);
});

// ── summarizeInterdictionsByRegion ───────────────────────────────

test('summarizeInterdictionsByRegion: groups by region and sorts by seizure desc', () => {
  const rows = [
    { region: 'Caribbean',       method: 'maritime' as InterdictionMethod, substance: 'cocaine' as Substance,         seizureKg: 500,  detectedAt: NOW - 1 * 24 * 60 * 60_000 },
    { region: 'Caribbean',       method: 'maritime' as InterdictionMethod, substance: 'cocaine' as Substance,         seizureKg: 500,  detectedAt: NOW - 2 * 24 * 60 * 60_000 },
    { region: 'Golden Triangle', method: 'land'     as InterdictionMethod, substance: 'methamphetamine' as Substance, seizureKg: 3000, detectedAt: NOW - 1 * 24 * 60 * 60_000 },
  ];
  const out = summarizeInterdictionsByRegion(rows, NOW);
  assert.equal(out[0]?.region, 'Golden Triangle');
  assert.equal(out[0]?.seizureKg, 3000);
  assert.equal(out[1]?.region, 'Caribbean');
  assert.equal(out[1]?.seizureKg, 1000);
  assert.equal(out[1]?.eventCount, 2);
});

test('summarizeInterdictionsByRegion: excludes events older than 30 days', () => {
  const rows = [
    { region: 'Caribbean' as const, method: 'maritime' as InterdictionMethod, substance: 'cocaine' as Substance, seizureKg: 1000, detectedAt: NOW - 40 * 24 * 60 * 60_000 },
  ];
  assert.equal(summarizeInterdictionsByRegion(rows, NOW).length, 0);
});

// ── formatSeizure ────────────────────────────────────────────────

test('formatSeizure: kg below 1000', () => {
  assert.equal(formatSeizure(640), '640 kg');
});

test('formatSeizure: tonnes at or above 1000 kg', () => {
  assert.equal(formatSeizure(2400), '2.4 t');
});

// ── Reference catalogues ─────────────────────────────────────────

test('ROUTE_DISRUPTIONS_BASE: covers at least four distinct route regions', () => {
  const regions = new Set(ROUTE_DISRUPTIONS_BASE.map((r) => r.routeRegion));
  assert.ok(regions.size >= 4);
});

test('CARTEL_TERRITORIAL_EVENTS: contains at least one open-warfare entry', () => {
  assert.ok(CARTEL_TERRITORIAL_EVENTS.some((e) => e.intensity === 'open-warfare'));
});

test('INTERDICTION_EVENTS_BASE: covers all four interdiction methods', () => {
  const methods = new Set(INTERDICTION_EVENTS_BASE.map((i) => i.method));
  for (const m of ['maritime', 'aerial', 'land']) {
    assert.ok(methods.has(m as InterdictionMethod), `missing method ${m}`);
  }
});

test('PRECURSOR_SIGNALS_BASE: includes high-confidence NPP / ANPP signals', () => {
  assert.ok(PRECURSOR_SIGNALS_BASE.some((p) => p.chemical === 'NPP'  && p.diversionConfidence >= 0.7));
  assert.ok(PRECURSOR_SIGNALS_BASE.some((p) => p.chemical === 'ANPP' && p.diversionConfidence >= 0.7));
});

test('NARCO_STATE_INDICES: every band is represented at least once', () => {
  const bands = new Set(NARCO_STATE_INDICES.map((n) => n.band));
  for (const b of ['low', 'moderate', 'high', 'critical']) {
    assert.ok(bands.has(b as RiskBand), `missing band ${b}`);
  }
});

test('VOLUME_TRENDS_BASE: covers all six substances', () => {
  const subs = new Set(VOLUME_TRENDS_BASE.map((v) => v.substance));
  for (const s of ['cocaine', 'heroin', 'methamphetamine', 'fentanyl', 'cannabis', 'synthetic-opioid']) {
    assert.ok(subs.has(s as Substance), `missing substance ${s}`);
  }
});

test('VOLUME_TRENDS_BASE: trend value matches sign of relativeShift', () => {
  for (const v of VOLUME_TRENDS_BASE) {
    if (v.trend === 'rising')  assert.ok(v.relativeShift >  0.05);
    if (v.trend === 'falling') assert.ok(v.relativeShift < -0.05);
    if (v.trend === 'flat')    assert.ok(Math.abs(v.relativeShift) <= 0.05);
  }
});

test('VOLUME_TRENDS_BASE: every trend type appears at least once', () => {
  const trends = new Set<VolumeTrend>(VOLUME_TRENDS_BASE.map((v) => v.trend));
  for (const t of ['rising', 'falling', 'flat'] as VolumeTrend[]) {
    assert.ok(trends.has(t));
  }
});
