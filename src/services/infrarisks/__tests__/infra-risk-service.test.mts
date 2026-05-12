import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePowerOutages,
  scorePowerOutages,
  powerAlertsFor,
  parseCisaKev,
  scoreCisaKev,
  kevAlertsFor,
  parseBgpAnomalies,
  scoreBgpAnomalies,
  bgpAlertsFor,
  parseAcledEvents,
  scoreAcled,
  acledAlertsFor,
  composeInfraRiskState,
  fetchInfraRisks,
  getInfraState,
  _resetInfraStateForTests,
  maxSeverity,
  severityToScore,
} from '../infra-risk-service.ts';

const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

// ── parsePowerOutages ─────────────────────────────────────────────────

test('power: parses CountyOutages array shape', () => {
  const raw = {
    CountyOutages: [
      { CountyName: 'Harris', StateName: 'TX', CustomersOut: 600_000, CustomersTracked: 1_500_000, RecordDateTime: '2026-05-12T10:00:00Z' },
      { CountyName: 'Dallas', StateName: 'TX', CustomersOut: 250_000, CustomersTracked: 1_000_000 },
      { CountyName: 'Travis', StateName: 'TX', CustomersOut: 12_000, CustomersTracked: 700_000 },
      { CountyName: 'Bexar', StateName: 'TX', CustomersOut: 1_000, CustomersTracked: 800_000 },
    ],
  };
  const out = parsePowerOutages(raw);
  assert.equal(out.length, 4);
  assert.equal(out[0]!.severity, 'CRITICAL');
  assert.equal(out[1]!.severity, 'HIGH');
  assert.equal(out[2]!.severity, 'MEDIUM');
  assert.equal(out[3]!.severity, 'LOW');
});

test('power: accepts bare array payload', () => {
  const raw = [{ CountyName: 'X', StateName: 'CA', CustomersOut: 11_000 }];
  const out = parsePowerOutages(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, 'MEDIUM');
});

test('power: sorts by customers-out descending', () => {
  const raw = {
    CountyOutages: [
      { CountyName: 'A', StateName: 'TX', CustomersOut: 5_000 },
      { CountyName: 'B', StateName: 'TX', CustomersOut: 50_000 },
      { CountyName: 'C', StateName: 'TX', CustomersOut: 600_000 },
    ],
  };
  const out = parsePowerOutages(raw);
  assert.deepEqual(out.map((r) => r.county), ['C', 'B', 'A']);
});

test('power: drops zero-out + missing-county rows', () => {
  const raw = {
    CountyOutages: [
      { CountyName: 'A', StateName: 'TX', CustomersOut: 0 },
      { CountyName: '', StateName: 'TX', CustomersOut: 1_000 },
      { CountyName: 'B', StateName: 'TX', CustomersOut: 1_000 },
    ],
  };
  assert.equal(parsePowerOutages(raw).length, 1);
});

test('power: outageRatio computed from tracked count', () => {
  const out = parsePowerOutages({ CountyOutages: [
    { CountyName: 'A', StateName: 'TX', CustomersOut: 250, CustomersTracked: 1_000 },
    { CountyName: 'B', StateName: 'TX', CustomersOut: 100 }, // no tracked → ratio 0
  ]});
  assert.equal(out[0]!.outageRatio, 0.25);
  assert.equal(out[1]!.outageRatio, 0);
});

test('power: thresholds match spec (>500k CRITICAL, >100k HIGH, >10k MEDIUM)', () => {
  const at = (n: number) => parsePowerOutages({ CountyOutages: [{ CountyName: 'X', StateName: 'Y', CustomersOut: n }] })[0]!.severity;
  assert.equal(at(500_001), 'CRITICAL');
  assert.equal(at(500_000), 'HIGH'); // strictly >500k → CRITICAL
  assert.equal(at(100_001), 'HIGH');
  assert.equal(at(100_000), 'MEDIUM');
  assert.equal(at(10_001), 'MEDIUM');
  assert.equal(at(10_000), 'LOW');
  assert.equal(at(1), 'LOW');
});

test('power score: empty input → INFO', () => {
  assert.equal(scorePowerOutages([]).severity, 'INFO');
});

test('power score: takes max severity across records', () => {
  const records = parsePowerOutages({ CountyOutages: [
    { CountyName: 'A', StateName: 'TX', CustomersOut: 600_000 },
    { CountyName: 'B', StateName: 'TX', CustomersOut: 1_000 },
  ]});
  assert.equal(scorePowerOutages(records).severity, 'CRITICAL');
});

test('power alerts: only HIGH+ records emit alerts', () => {
  const records = parsePowerOutages({ CountyOutages: [
    { CountyName: 'A', StateName: 'TX', CustomersOut: 250_000 },
    { CountyName: 'B', StateName: 'TX', CustomersOut: 5_000 },
  ]});
  const alerts = powerAlertsFor(records, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.severity, 'high');
  assert.equal(alerts[0]!.source, 'power-grid');
});

// ── parseCisaKev ──────────────────────────────────────────────────────

test('kev: drops entries older than the 7-day window', () => {
  const raw = {
    vulnerabilities: [
      { cveID: 'CVE-2026-1', vendorProject: 'Acme', dateAdded: '2026-05-11', shortDescription: 'recent' },
      { cveID: 'CVE-2020-9', vendorProject: 'Old', dateAdded: '2020-01-01', shortDescription: 'old' },
    ],
  };
  const out = parseCisaKev(raw, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.cveId, 'CVE-2026-1');
});

test('kev: flags known-ransomware string variants', () => {
  const out = parseCisaKev({ vulnerabilities: [
    { cveID: 'A', dateAdded: '2026-05-11', knownRansomwareCampaignUse: 'Known' },
    { cveID: 'B', dateAdded: '2026-05-11', knownRansomwareCampaignUse: 'Unknown' },
  ]}, NOW);
  assert.equal(out.find((e) => e.cveId === 'A')!.knownRansomware, true);
  assert.equal(out.find((e) => e.cveId === 'B')!.knownRansomware, false);
});

test('kev: sorts newest dateAdded first', () => {
  const out = parseCisaKev({ vulnerabilities: [
    { cveID: 'A', dateAdded: '2026-05-09' },
    { cveID: 'B', dateAdded: '2026-05-11' },
    { cveID: 'C', dateAdded: '2026-05-10' },
  ]}, NOW);
  assert.deepEqual(out.map((e) => e.cveId), ['B', 'C', 'A']);
});

test('kev score: HIGH when >3 new today', () => {
  const entries = parseCisaKev({ vulnerabilities: Array.from({ length: 4 }, (_, i) => ({
    cveID: `C${i}`, dateAdded: new Date(NOW - 60_000).toISOString(),
  }))}, NOW);
  const score = scoreCisaKev(entries, NOW);
  assert.equal(score.severity, 'HIGH');
});

test('kev score: MEDIUM when 1-3 today', () => {
  const entries = parseCisaKev({ vulnerabilities: [
    { cveID: 'C0', dateAdded: new Date(NOW - 60_000).toISOString() },
  ]}, NOW);
  assert.equal(scoreCisaKev(entries, NOW).severity, 'MEDIUM');
});

test('kev score: LOW when in 7-day window but nothing today', () => {
  const entries = parseCisaKev({ vulnerabilities: [
    { cveID: 'C0', dateAdded: new Date(NOW - 3 * DAY_MS).toISOString() },
  ]}, NOW);
  assert.equal(scoreCisaKev(entries, NOW).severity, 'LOW');
});

test('kev alerts: ransomware count surfaced in body', () => {
  const entries = parseCisaKev({ vulnerabilities: [
    { cveID: 'C0', dateAdded: new Date(NOW - 60_000).toISOString(), knownRansomwareCampaignUse: 'Known' },
  ]}, NOW);
  const alerts = kevAlertsFor(entries, NOW);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!.body, /ransomware-linked/);
});

// ── parseBgpAnomalies ─────────────────────────────────────────────────

test('bgp: parses single-resource RIPE Stat envelope', () => {
  const raw = { data: { resource: 'AS65000', inconsistencies: ['route-1', 'route-2'], query_time: '2026-05-12T11:30:00Z' } };
  const out = parseBgpAnomalies(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.resource, 'AS65000');
  assert.equal(out[0]!.inconsistencyCount, 2);
});

test('bgp: parses array of resources', () => {
  const raw = { data: [
    { resource: 'AS1', inconsistencies: ['a'] },
    { resource: 'AS2', inconsistencies: ['b', 'c', 'd', 'e', 'f'] },
  ]};
  const out = parseBgpAnomalies(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.resource, 'AS2'); // sorted by count
  assert.equal(out[0]!.severity, 'HIGH');
  assert.equal(out[1]!.severity, 'MEDIUM');
});

test('bgp: no inconsistencies → INFO score', () => {
  const out = parseBgpAnomalies({ data: { resource: 'AS1', inconsistencies: [] } });
  assert.equal(out.length, 0);
  assert.equal(scoreBgpAnomalies(out).severity, 'INFO');
});

test('bgp alerts: only HIGH (>=5 inconsistencies) emit alerts', () => {
  const records = parseBgpAnomalies({ data: [
    { resource: 'AS1', inconsistencies: ['a','b','c','d','e','f'] },
    { resource: 'AS2', inconsistencies: ['x'] },
  ]});
  const alerts = bgpAlertsFor(records, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.title, 'BGP anomaly: AS1');
});

// ── parseAcledEvents ──────────────────────────────────────────────────

test('acled: fatality-based severity ladder', () => {
  const out = parseAcledEvents({ data: [
    { event_id_cnty: 'A', fatalities: 0, event_date: '2026-05-12', country: 'X', location: 'town' },
    { event_id_cnty: 'B', fatalities: 1, event_date: '2026-05-12', country: 'X' },
    { event_id_cnty: 'C', fatalities: 5, event_date: '2026-05-12', country: 'X' },
    { event_id_cnty: 'D', fatalities: 15, event_date: '2026-05-12', country: 'X' },
    { event_id_cnty: 'E', fatalities: 100, event_date: '2026-05-12', country: 'X' },
  ]});
  const byId = Object.fromEntries(out.map((e) => [e.eventId, e]));
  assert.equal(byId.A!.severity, 'INFO');
  assert.equal(byId.B!.severity, 'LOW');
  assert.equal(byId.C!.severity, 'MEDIUM');
  assert.equal(byId.D!.severity, 'HIGH');
  assert.equal(byId.E!.severity, 'CRITICAL');
});

test('acled: sorts by fatalities desc, then event date desc', () => {
  const out = parseAcledEvents({ data: [
    { event_id_cnty: 'A', fatalities: 1, event_date: '2026-05-11', country: 'X' },
    { event_id_cnty: 'B', fatalities: 1, event_date: '2026-05-12', country: 'X' },
    { event_id_cnty: 'C', fatalities: 10, event_date: '2026-05-01', country: 'X' },
  ]});
  assert.deepEqual(out.map((e) => e.eventId), ['C', 'B', 'A']);
});

test('acled: empty raw → empty events + INFO score', () => {
  assert.deepEqual(parseAcledEvents(null), []);
  assert.deepEqual(parseAcledEvents({ data: [] }), []);
  assert.equal(scoreAcled([]).severity, 'INFO');
});

test('acled alerts: caps at 5 + only HIGH+ severity', () => {
  const out = parseAcledEvents({ data: Array.from({ length: 10 }, (_, i) => ({
    event_id_cnty: `E${i}`, fatalities: 50, event_date: '2026-05-12', country: 'X',
  }))});
  const alerts = acledAlertsFor(out, NOW);
  assert.equal(alerts.length, 5);
  for (const a of alerts) assert.equal(a.severity, 'critical');
});

// ── Severity helpers ──────────────────────────────────────────────────

test('maxSeverity: picks the strongest level', () => {
  assert.equal(maxSeverity(['INFO', 'HIGH', 'LOW', 'MEDIUM']), 'HIGH');
  assert.equal(maxSeverity([]), 'INFO');
  assert.equal(maxSeverity(['CRITICAL']), 'CRITICAL');
});

test('severityToScore: 0 / 25 / 50 / 75 / 100 ladder', () => {
  assert.equal(severityToScore('INFO'), 0);
  assert.equal(severityToScore('LOW'), 25);
  assert.equal(severityToScore('MEDIUM'), 50);
  assert.equal(severityToScore('HIGH'), 75);
  assert.equal(severityToScore('CRITICAL'), 100);
});

// ── composeInfraRiskState ─────────────────────────────────────────────

test('compose: weighted composite score reflects all four domains', () => {
  const state = composeInfraRiskState({
    power: { records: [], score: { score: 100, severity: 'CRITICAL', headline: '' }, alerts: [] },
    kev: { entries: [], score: { score: 75, severity: 'HIGH', headline: '' }, alerts: [] },
    bgp: { records: [], score: { score: 50, severity: 'MEDIUM', headline: '' }, alerts: [] },
    acled: { events: [], score: { score: 0, severity: 'INFO', headline: '' }, alerts: [] },
    fetchedAt: NOW,
  });
  // 100*0.3 + 75*0.25 + 50*0.2 + 0*0.25 = 30 + 18.75 + 10 = 58.75 → 59
  assert.equal(state.compositeScore, 59);
  assert.equal(state.compositeSeverity, 'HIGH');
});

test('compose: all-zero domains → INFO composite', () => {
  const zero = { score: 0, severity: 'INFO' as const, headline: '' };
  const state = composeInfraRiskState({
    power: { records: [], score: zero, alerts: [] },
    kev: { entries: [], score: zero, alerts: [] },
    bgp: { records: [], score: zero, alerts: [] },
    acled: { events: [], score: zero, alerts: [] },
    fetchedAt: NOW,
  });
  assert.equal(state.compositeScore, 0);
  assert.equal(state.compositeSeverity, 'INFO');
});

test('compose: result is JSON-serializable', () => {
  const zero = { score: 0, severity: 'INFO' as const, headline: '' };
  const state = composeInfraRiskState({
    power: { records: [], score: zero, alerts: [] },
    kev: { entries: [], score: zero, alerts: [] },
    bgp: { records: [], score: zero, alerts: [] },
    acled: { events: [], score: zero, alerts: [] },
    fetchedAt: NOW,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

// ── fetchInfraRisks orchestrator ──────────────────────────────────────

function mockFetch(routeMap: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    for (const [route, payload] of Object.entries(routeMap)) {
      if (url.endsWith(route)) {
        return { ok: true, json: async () => payload } as Response;
      }
    }
    return { ok: false, json: async () => null } as Response;
  }) as unknown as typeof fetch;
}

test('orchestrator: pulls all four feeds and composes a state', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/power': { CountyOutages: [{ CountyName: 'A', StateName: 'TX', CustomersOut: 600_000 }] },
      '/kev': { vulnerabilities: [{ cveID: 'C', dateAdded: '2026-05-12' }] },
      '/bgp': { data: { resource: 'AS1', inconsistencies: ['x','y','z','a','b','c'] } },
      '/acled': { data: [{ event_id_cnty: 'E1', fatalities: 50, event_date: '2026-05-12', country: 'X' }] },
    }),
    now: NOW,
  });
  assert.equal(state.power.records.length, 1);
  assert.equal(state.kev.entries.length, 1);
  assert.equal(state.bgp.records.length, 1);
  assert.equal(state.acled.events.length, 1);
  assert.ok(state.compositeScore > 0);
  assert.equal(getInfraState(), state);
});

test('orchestrator: failed fetches return null payloads and emit empty domains', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({}),
    now: NOW,
  });
  assert.equal(state.power.records.length, 0);
  assert.equal(state.kev.entries.length, 0);
  assert.equal(state.bgp.records.length, 0);
  assert.equal(state.acled.events.length, 0);
  assert.equal(state.compositeScore, 0);
});

test('orchestrator: exception in fetch is swallowed (graceful)', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: (() => { throw new Error('network down'); }) as unknown as typeof fetch,
    now: NOW,
  });
  assert.equal(state.compositeScore, 0);
  assert.equal(state.compositeSeverity, 'INFO');
});

test('getInfraState: starts null + reflects last fetch', async () => {
  _resetInfraStateForTests();
  assert.equal(getInfraState(), null);
  await fetchInfraRisks({ fetchImpl: mockFetch({}), now: NOW });
  assert.ok(getInfraState() !== null);
});
