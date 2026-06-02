/**
 * Tests for GlobalHealthSecurityPanel — pure helper functions, static data,
 * and HTML-string render outputs.
 *
 * Run with: npx tsx --test tests/components/global-health-security-panel.test.mts
 *
 * Pure-logic tests only; no DOM required.  The tests import strictly from the
 * helpers module — never from the panel class — because Panel.ts transitively
 * pulls in a Vite-only `?worker` import that fails under `tsx --test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pheicStatusColor,
  pheicStatusLabel,
  transmissionLabel,
  outbreakTrendColor,
  outbreakTrendLabel,
  amrSeverityColor,
  amrSeverityLabel,
  capacityColor,
  capacityLabel,
  coverageColor,
  coverageLabel,
  networkStatusColor,
  networkStatusLabel,
  preparednessTierColor,
  preparednessTierLabel,
  countActivePheics,
  countActiveOutbreaks,
  countAmrFlaggedCountries,
  countCapacityStressed,
  countCoverageGapCountries,
  countDegradedNetworks,
  countLowPreparednessCountries,
  sortOutbreaksBySeverity,
  sortPreparednessAscending,
  renderPheicSection,
  renderOutbreakSection,
  renderAmrSection,
  renderCapacitySection,
  renderCoverageSection,
  renderNetworkSection,
  renderPreparednessSection,
  PHEIC_EVENTS,
  OUTBREAK_EVENTS,
  AMR_HOTSPOTS,
  CAPACITY_STRESS,
  COVERAGE_GAPS,
  BIOSURVEILLANCE_NETWORKS,
  PREPAREDNESS_SCORES,
  type PheicStatus,
  type TransmissionMode,
  type OutbreakTrend,
  type AmrSeverity,
  type CapacityStatus,
  type CoverageStatus,
  type NetworkStatus,
  type PreparednessTier,
  type PheicEvent,
  type OutbreakEvent,
  type AmrHotspot,
  type CapacityStress,
  type CoverageGap,
  type BiosurveillanceNetwork,
  type PreparednessScore,
} from '../../src/components/global-health-security-helpers.ts';

// ── pheicStatusColor / pheicStatusLabel ───────────────────────────────────

test('pheicStatusColor: active returns red', () => {
  assert.equal(pheicStatusColor('active'), '#ef4444');
});

test('pheicStatusColor: monitoring returns amber', () => {
  assert.equal(pheicStatusColor('monitoring'), '#f59e0b');
});

test('pheicStatusColor: expired returns grey', () => {
  assert.equal(pheicStatusColor('expired'), '#9e9e9e');
});

test('pheicStatusColor: all statuses return non-empty strings', () => {
  const statuses: PheicStatus[] = ['active', 'monitoring', 'expired'];
  for (const s of statuses) assert.ok(pheicStatusColor(s).length > 0);
});

test('pheicStatusLabel: active returns "Active"', () => {
  assert.equal(pheicStatusLabel('active'), 'Active');
});

test('pheicStatusLabel: expired returns "Expired"', () => {
  assert.equal(pheicStatusLabel('expired'), 'Expired');
});

// ── transmissionLabel ─────────────────────────────────────────────────────

test('transmissionLabel: human-to-human renders arrow', () => {
  assert.equal(transmissionLabel('human-to-human'), 'Human → Human');
});

test('transmissionLabel: animal-to-human renders arrow', () => {
  assert.equal(transmissionLabel('animal-to-human'), 'Animal → Human');
});

test('transmissionLabel: vector-borne returns "Vector-borne"', () => {
  assert.equal(transmissionLabel('vector-borne'), 'Vector-borne');
});

test('transmissionLabel: all modes return non-empty strings', () => {
  const modes: TransmissionMode[] = [
    'human-to-human', 'animal-to-human', 'vector-borne', 'foodborne', 'unknown',
  ];
  for (const m of modes) assert.ok(transmissionLabel(m).length > 0);
});

// ── outbreakTrendColor / outbreakTrendLabel ───────────────────────────────

test('outbreakTrendColor: rising returns red', () => {
  assert.equal(outbreakTrendColor('rising'), '#ef4444');
});

test('outbreakTrendColor: plateau returns amber', () => {
  assert.equal(outbreakTrendColor('plateau'), '#f59e0b');
});

test('outbreakTrendColor: declining returns blue', () => {
  assert.equal(outbreakTrendColor('declining'), '#3b82f6');
});

test('outbreakTrendColor: contained returns green', () => {
  assert.equal(outbreakTrendColor('contained'), '#22c55e');
});

test('outbreakTrendLabel: all trends return non-empty strings', () => {
  const trends: OutbreakTrend[] = ['rising', 'plateau', 'declining', 'contained'];
  for (const t of trends) assert.ok(outbreakTrendLabel(t).length > 0);
});

// ── amrSeverityColor / amrSeverityLabel ───────────────────────────────────

test('amrSeverityColor: urgent returns red', () => {
  assert.equal(amrSeverityColor('urgent'), '#ef4444');
});

test('amrSeverityColor: serious returns orange', () => {
  assert.equal(amrSeverityColor('serious'), '#fb923c');
});

test('amrSeverityColor: concerning returns amber', () => {
  assert.equal(amrSeverityColor('concerning'), '#f59e0b');
});

test('amrSeverityColor: watch returns green', () => {
  assert.equal(amrSeverityColor('watch'), '#22c55e');
});

test('amrSeverityLabel: urgent returns "Urgent"', () => {
  assert.equal(amrSeverityLabel('urgent'), 'Urgent');
});

test('amrSeverityLabel: all severities return non-empty strings', () => {
  const severities: AmrSeverity[] = ['watch', 'concerning', 'serious', 'urgent'];
  for (const s of severities) assert.ok(amrSeverityLabel(s).length > 0);
});

// ── capacityColor / capacityLabel ─────────────────────────────────────────

test('capacityColor: overwhelmed returns red', () => {
  assert.equal(capacityColor('overwhelmed'), '#ef4444');
});

test('capacityColor: critical returns orange', () => {
  assert.equal(capacityColor('critical'), '#fb923c');
});

test('capacityColor: strained returns amber', () => {
  assert.equal(capacityColor('strained'), '#f59e0b');
});

test('capacityColor: nominal returns green', () => {
  assert.equal(capacityColor('nominal'), '#22c55e');
});

test('capacityLabel: overwhelmed returns "Overwhelmed"', () => {
  assert.equal(capacityLabel('overwhelmed'), 'Overwhelmed');
});

test('capacityLabel: all statuses return non-empty strings', () => {
  const statuses: CapacityStatus[] = ['nominal', 'strained', 'critical', 'overwhelmed'];
  for (const s of statuses) assert.ok(capacityLabel(s).length > 0);
});

// ── coverageColor / coverageLabel ─────────────────────────────────────────

test('coverageColor: severe-gap returns red', () => {
  assert.equal(coverageColor('severe-gap'), '#ef4444');
});

test('coverageColor: on-track returns green', () => {
  assert.equal(coverageColor('on-track'), '#22c55e');
});

test('coverageLabel: severe-gap renders "Severe Gap"', () => {
  assert.equal(coverageLabel('severe-gap'), 'Severe Gap');
});

test('coverageLabel: all statuses return non-empty strings', () => {
  const statuses: CoverageStatus[] = ['on-track', 'at-risk', 'gap', 'severe-gap'];
  for (const s of statuses) assert.ok(coverageLabel(s).length > 0);
});

// ── networkStatusColor / networkStatusLabel ───────────────────────────────

test('networkStatusColor: offline returns red', () => {
  assert.equal(networkStatusColor('offline'), '#ef4444');
});

test('networkStatusColor: operational returns green', () => {
  assert.equal(networkStatusColor('operational'), '#22c55e');
});

test('networkStatusLabel: partial-outage renders "Partial Outage"', () => {
  assert.equal(networkStatusLabel('partial-outage'), 'Partial Outage');
});

test('networkStatusLabel: all statuses return non-empty strings', () => {
  const statuses: NetworkStatus[] = ['operational', 'degraded', 'partial-outage', 'offline'];
  for (const s of statuses) assert.ok(networkStatusLabel(s).length > 0);
});

// ── preparednessTierColor / preparednessTierLabel ─────────────────────────

test('preparednessTierColor: leader returns green', () => {
  assert.equal(preparednessTierColor('leader'), '#22c55e');
});

test('preparednessTierColor: least-prepared returns red', () => {
  assert.equal(preparednessTierColor('least-prepared'), '#ef4444');
});

test('preparednessTierLabel: least-prepared renders "Least Prepared"', () => {
  assert.equal(preparednessTierLabel('least-prepared'), 'Least Prepared');
});

test('preparednessTierLabel: all tiers return non-empty strings', () => {
  const tiers: PreparednessTier[] = [
    'leader', 'capable', 'developing', 'limited', 'least-prepared',
  ];
  for (const t of tiers) assert.ok(preparednessTierLabel(t).length > 0);
});

// ── Count aggregators ─────────────────────────────────────────────────────

test('countActivePheics: empty array returns 0', () => {
  assert.equal(countActivePheics([]), 0);
});

test('countActivePheics: counts only active status', () => {
  const events: PheicEvent[] = [
    { name: 'A', declarationDate: '2024-01-01', status: 'active',     regions: 'X', notes: '' },
    { name: 'B', declarationDate: '2024-02-01', status: 'monitoring', regions: 'Y', notes: '' },
    { name: 'C', declarationDate: '2024-03-01', status: 'expired',    regions: 'Z', notes: '' },
    { name: 'D', declarationDate: '2024-04-01', status: 'active',     regions: 'W', notes: '' },
  ];
  assert.equal(countActivePheics(events), 2);
});

test('countActivePheics: static PHEIC_EVENTS has at least one active', () => {
  assert.ok(countActivePheics(PHEIC_EVENTS) >= 1);
});

test('countActiveOutbreaks: empty array returns 0', () => {
  assert.equal(countActiveOutbreaks([]), 0);
});

test('countActiveOutbreaks: counts rising + plateau trends only', () => {
  const events: OutbreakEvent[] = [
    { pathogen: 'A', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'rising',    notes: '' },
    { pathogen: 'B', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'plateau',   notes: '' },
    { pathogen: 'C', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'declining', notes: '' },
    { pathogen: 'D', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'contained', notes: '' },
  ];
  assert.equal(countActiveOutbreaks(events), 2);
});

test('countAmrFlaggedCountries: counts only urgent + serious', () => {
  const rows: AmrHotspot[] = [
    { country: 'A', pathogen: 'p', drugClass: 'd', resistancePct: 90, severity: 'urgent'      },
    { country: 'B', pathogen: 'p', drugClass: 'd', resistancePct: 60, severity: 'serious'     },
    { country: 'C', pathogen: 'p', drugClass: 'd', resistancePct: 30, severity: 'concerning'  },
    { country: 'D', pathogen: 'p', drugClass: 'd', resistancePct: 10, severity: 'watch'       },
  ];
  assert.equal(countAmrFlaggedCountries(rows), 2);
});

test('countAmrFlaggedCountries: empty array returns 0', () => {
  assert.equal(countAmrFlaggedCountries([]), 0);
});

test('countCapacityStressed: counts critical + overwhelmed', () => {
  const rows: CapacityStress[] = [
    { region: 'A', icuOccupancyPct: 90, hcwShortagePct: 80, supplyStatus: '', status: 'overwhelmed' },
    { region: 'B', icuOccupancyPct: 85, hcwShortagePct: 50, supplyStatus: '', status: 'critical'    },
    { region: 'C', icuOccupancyPct: 70, hcwShortagePct: 30, supplyStatus: '', status: 'strained'    },
    { region: 'D', icuOccupancyPct: 50, hcwShortagePct: 10, supplyStatus: '', status: 'nominal'     },
  ];
  assert.equal(countCapacityStressed(rows), 2);
});

test('countCoverageGapCountries: counts gap + severe-gap only', () => {
  const rows: CoverageGap[] = [
    { country: 'A', antigen: 'DTP3', coveragePct: 50, zeroDoseClusters: 30, status: 'severe-gap' },
    { country: 'B', antigen: 'MCV1', coveragePct: 70, zeroDoseClusters: 15, status: 'gap'         },
    { country: 'C', antigen: 'OPV3', coveragePct: 85, zeroDoseClusters:  5, status: 'at-risk'     },
    { country: 'D', antigen: 'DTP3', coveragePct: 95, zeroDoseClusters:  1, status: 'on-track'    },
  ];
  assert.equal(countCoverageGapCountries(rows), 2);
});

test('countDegradedNetworks: counts degraded + partial-outage + offline', () => {
  const rows: BiosurveillanceNetwork[] = [
    { name: 'A', scope: 's', lastUpdateHours:  1, geographicGap: '', status: 'operational'      },
    { name: 'B', scope: 's', lastUpdateHours:  5, geographicGap: '', status: 'degraded'         },
    { name: 'C', scope: 's', lastUpdateHours: 24, geographicGap: '', status: 'partial-outage'   },
    { name: 'D', scope: 's', lastUpdateHours: 48, geographicGap: '', status: 'offline'          },
  ];
  assert.equal(countDegradedNetworks(rows), 3);
});

test('countLowPreparednessCountries: counts limited + least-prepared', () => {
  const rows: PreparednessScore[] = [
    { country: 'A', overall: 80, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'leader'           },
    { country: 'B', overall: 60, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'developing'       },
    { country: 'C', overall: 35, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'limited'          },
    { country: 'D', overall: 15, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'least-prepared'   },
  ];
  assert.equal(countLowPreparednessCountries(rows), 2);
});

// ── Sort comparators ──────────────────────────────────────────────────────

test('sortOutbreaksBySeverity: rising comes before contained', () => {
  const rows: OutbreakEvent[] = [
    { pathogen: 'Q', region: 'r', cases: 100, deaths: 0, transmission: 'unknown', trend: 'contained', notes: '' },
    { pathogen: 'R', region: 'r', cases: 1,   deaths: 0, transmission: 'unknown', trend: 'rising',    notes: '' },
  ];
  const sorted = sortOutbreaksBySeverity(rows);
  assert.equal(sorted[0]?.pathogen, 'R');
});

test('sortOutbreaksBySeverity: ties on trend break by cases desc', () => {
  const rows: OutbreakEvent[] = [
    { pathogen: 'Low',  region: 'r', cases: 10,   deaths: 0, transmission: 'unknown', trend: 'rising', notes: '' },
    { pathogen: 'High', region: 'r', cases: 1000, deaths: 0, transmission: 'unknown', trend: 'rising', notes: '' },
  ];
  const sorted = sortOutbreaksBySeverity(rows);
  assert.equal(sorted[0]?.pathogen, 'High');
});

test('sortOutbreaksBySeverity: does not mutate input', () => {
  const rows: OutbreakEvent[] = [
    { pathogen: 'A', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'contained', notes: '' },
    { pathogen: 'B', region: 'r', cases: 1, deaths: 0, transmission: 'unknown', trend: 'rising',    notes: '' },
  ];
  const snapshot = [...rows];
  sortOutbreaksBySeverity(rows);
  assert.deepEqual(rows, snapshot);
});

test('sortPreparednessAscending: lowest overall first', () => {
  const rows: PreparednessScore[] = [
    { country: 'High', overall: 80, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'leader'         },
    { country: 'Low',  overall: 20, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'least-prepared' },
  ];
  const sorted = sortPreparednessAscending(rows);
  assert.equal(sorted[0]?.country, 'Low');
});

// ── Render: PHEIC section ─────────────────────────────────────────────────

test('renderPheicSection: empty list shows "No active PHEICs"', () => {
  const html = renderPheicSection([]);
  assert.ok(html.includes('No active PHEICs reported'));
});

test('renderPheicSection: includes section header marker', () => {
  const html = renderPheicSection(PHEIC_EVENTS);
  assert.ok(html.includes('WHO PHEIC Tracker'));
});

test('renderPheicSection: escapes HTML in name', () => {
  const events: PheicEvent[] = [
    { name: '<script>alert(1)</script>', declarationDate: '2024-01-01', status: 'active', regions: 'X', notes: '' },
  ];
  const html = renderPheicSection(events);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderPheicSection: shows active badge when active count > 0', () => {
  const events: PheicEvent[] = [
    { name: 'A', declarationDate: '2024-01-01', status: 'active', regions: 'X', notes: '' },
  ];
  const html = renderPheicSection(events);
  assert.ok(html.includes('1 active'));
});

// ── Render: outbreak section ──────────────────────────────────────────────

test('renderOutbreakSection: empty list shows "No outbreak events"', () => {
  const html = renderOutbreakSection([]);
  assert.ok(html.includes('No outbreak events reported'));
});

test('renderOutbreakSection: includes CFR calculation', () => {
  const events: OutbreakEvent[] = [
    { pathogen: 'TestPath', region: 'r', cases: 100, deaths: 25, transmission: 'human-to-human', trend: 'rising', notes: '' },
  ];
  const html = renderOutbreakSection(events);
  assert.ok(html.includes('25.0% CFR'));
});

test('renderOutbreakSection: shows "No fatalities" when cases > 0 deaths = 0', () => {
  const events: OutbreakEvent[] = [
    { pathogen: 'TestPath', region: 'r', cases: 0, deaths: 0, transmission: 'unknown', trend: 'plateau', notes: '' },
  ];
  const html = renderOutbreakSection(events);
  assert.ok(html.includes('No fatalities'));
});

test('renderOutbreakSection: includes trend label badge', () => {
  const events: OutbreakEvent[] = [
    { pathogen: 'TestPath', region: 'r', cases: 5, deaths: 0, transmission: 'unknown', trend: 'rising', notes: '' },
  ];
  const html = renderOutbreakSection(events);
  assert.ok(html.includes('Rising'));
});

// ── Render: AMR section ───────────────────────────────────────────────────

test('renderAmrSection: empty list shows empty-state message', () => {
  const html = renderAmrSection([]);
  assert.ok(html.includes('No AMR hotspots reported'));
});

test('renderAmrSection: includes resistance % suffix', () => {
  const rows: AmrHotspot[] = [
    { country: 'X', pathogen: 'p', drugClass: 'd', resistancePct: 77, severity: 'urgent' },
  ];
  const html = renderAmrSection(rows);
  assert.ok(html.includes('77%'));
});

test('renderAmrSection: shows urgent badge in badge count', () => {
  const rows: AmrHotspot[] = [
    { country: 'X', pathogen: 'p', drugClass: 'd', resistancePct: 95, severity: 'urgent' },
    { country: 'Y', pathogen: 'p', drugClass: 'd', resistancePct: 60, severity: 'serious' },
  ];
  const html = renderAmrSection(rows);
  assert.ok(html.includes('2 urgent/serious'));
});

// ── Render: capacity section ──────────────────────────────────────────────

test('renderCapacitySection: empty list shows empty-state message', () => {
  const html = renderCapacitySection([]);
  assert.ok(html.includes('No capacity data available'));
});

test('renderCapacitySection: includes ICU % when nonzero', () => {
  const rows: CapacityStress[] = [
    { region: 'R', icuOccupancyPct: 88, hcwShortagePct: 30, supplyStatus: 'OK', status: 'critical' },
  ];
  const html = renderCapacitySection(rows);
  assert.ok(html.includes('88% ICU'));
});

test('renderCapacitySection: shows "ICU n/a" when icuOccupancy = 0', () => {
  const rows: CapacityStress[] = [
    { region: 'R', icuOccupancyPct: 0, hcwShortagePct: 70, supplyStatus: 'X', status: 'overwhelmed' },
  ];
  const html = renderCapacitySection(rows);
  assert.ok(html.includes('ICU n/a'));
});

// ── Render: coverage section ──────────────────────────────────────────────

test('renderCoverageSection: empty list shows empty-state message', () => {
  const html = renderCoverageSection([]);
  assert.ok(html.includes('No coverage data available'));
});

test('renderCoverageSection: includes zero-dose clusters text', () => {
  const rows: CoverageGap[] = [
    { country: 'A', antigen: 'DTP3', coveragePct: 50, zeroDoseClusters: 17, status: 'severe-gap' },
  ];
  const html = renderCoverageSection(rows);
  assert.ok(html.includes('17 zero-dose clusters'));
});

// ── Render: network section ───────────────────────────────────────────────

test('renderNetworkSection: empty list shows empty-state message', () => {
  const html = renderNetworkSection([]);
  assert.ok(html.includes('No network data available'));
});

test('renderNetworkSection: includes hours-ago freshness indicator', () => {
  const rows: BiosurveillanceNetwork[] = [
    { name: 'TestNet', scope: 'global', lastUpdateHours: 5, geographicGap: 'X', status: 'operational' },
  ];
  const html = renderNetworkSection(rows);
  assert.ok(html.includes('5h ago'));
});

// ── Render: preparedness section ──────────────────────────────────────────

test('renderPreparednessSection: empty list shows empty-state message', () => {
  const html = renderPreparednessSection([]);
  assert.ok(html.includes('No preparedness data available'));
});

test('renderPreparednessSection: includes sub-dimension scores', () => {
  const rows: PreparednessScore[] = [
    { country: 'X', overall: 50, prevention: 40, detection: 60, response: 55, healthSystem: 45, tier: 'developing' },
  ];
  const html = renderPreparednessSection(rows);
  assert.ok(html.includes('P 40'));
  assert.ok(html.includes('D 60'));
  assert.ok(html.includes('R 55'));
  assert.ok(html.includes('H 45'));
});

test('renderPreparednessSection: sorts lowest-prepared first', () => {
  const rows: PreparednessScore[] = [
    { country: 'HighCountry', overall: 80, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'leader'         },
    { country: 'LowCountry',  overall: 15, prevention: 1, detection: 1, response: 1, healthSystem: 1, tier: 'least-prepared' },
  ];
  const html = renderPreparednessSection(rows);
  const idxLow  = html.indexOf('LowCountry');
  const idxHigh = html.indexOf('HighCountry');
  assert.ok(idxLow > 0 && idxHigh > 0);
  assert.ok(idxLow < idxHigh);
});

// ── Static data integrity ────────────────────────────────────────────────

test('PHEIC_EVENTS: is a non-empty array', () => {
  assert.ok(Array.isArray(PHEIC_EVENTS));
  assert.ok(PHEIC_EVENTS.length > 0);
});

test('PHEIC_EVENTS: every entry has valid status', () => {
  const allowed: PheicStatus[] = ['active', 'monitoring', 'expired'];
  for (const e of PHEIC_EVENTS) {
    assert.ok(allowed.includes(e.status), `bad status: ${e.status}`);
    assert.ok(e.name.length > 0);
    assert.ok(e.declarationDate.length > 0);
    assert.ok(e.regions.length > 0);
  }
});

test('PHEIC_EVENTS: contains mpox entry', () => {
  assert.ok(PHEIC_EVENTS.some((e) => e.name.toLowerCase().includes('mpox')));
});

test('OUTBREAK_EVENTS: is a non-empty array', () => {
  assert.ok(Array.isArray(OUTBREAK_EVENTS));
  assert.ok(OUTBREAK_EVENTS.length > 0);
});

test('OUTBREAK_EVENTS: every entry has nonnegative cases + deaths', () => {
  for (const e of OUTBREAK_EVENTS) {
    assert.ok(e.cases >= 0);
    assert.ok(e.deaths >= 0);
    assert.ok(e.deaths <= e.cases, `${e.pathogen}: deaths > cases`);
  }
});

test('OUTBREAK_EVENTS: contains H5N1 entry', () => {
  assert.ok(OUTBREAK_EVENTS.some((e) => e.pathogen.includes('H5N1')));
});

test('AMR_HOTSPOTS: is a non-empty array', () => {
  assert.ok(Array.isArray(AMR_HOTSPOTS));
  assert.ok(AMR_HOTSPOTS.length > 0);
});

test('AMR_HOTSPOTS: resistance percentages are within 0-100', () => {
  for (const r of AMR_HOTSPOTS) {
    assert.ok(r.resistancePct >= 0 && r.resistancePct <= 100);
  }
});

test('CAPACITY_STRESS: is a non-empty array', () => {
  assert.ok(Array.isArray(CAPACITY_STRESS));
  assert.ok(CAPACITY_STRESS.length > 0);
});

test('COVERAGE_GAPS: is a non-empty array', () => {
  assert.ok(Array.isArray(COVERAGE_GAPS));
  assert.ok(COVERAGE_GAPS.length > 0);
});

test('COVERAGE_GAPS: contains at least one severe-gap entry', () => {
  assert.ok(COVERAGE_GAPS.some((r) => r.status === 'severe-gap'));
});

test('BIOSURVEILLANCE_NETWORKS: contains GOARN entry', () => {
  assert.ok(BIOSURVEILLANCE_NETWORKS.some((n) => n.name.startsWith('GOARN')));
});

test('BIOSURVEILLANCE_NETWORKS: every entry has nonnegative lastUpdateHours', () => {
  for (const n of BIOSURVEILLANCE_NETWORKS) {
    assert.ok(n.lastUpdateHours >= 0);
  }
});

test('PREPAREDNESS_SCORES: overall is within 0-100', () => {
  for (const p of PREPAREDNESS_SCORES) {
    assert.ok(p.overall >= 0 && p.overall <= 100);
  }
});

test('PREPAREDNESS_SCORES: contains both a leader and a least-prepared tier', () => {
  assert.ok(PREPAREDNESS_SCORES.some((p) => p.tier === 'leader'));
  assert.ok(PREPAREDNESS_SCORES.some((p) => p.tier === 'least-prepared'));
});
