import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  unknownPowerRisk,
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
  ageInfraRiskState,
  getInfraState,
  _resetInfraStateForTests,
  maxSeverity,
  severityToScore,
  INFRA_RISK_STATE_MAX_AGE_MS,
  RIPE_BGP_SCOPE_LABEL,
} from '../infra-risk-service.ts';

const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Unsupported national power coverage ──────────────────────────────

test('power: unsupported national coverage is explicit unknown with no alerts', () => {
  const power = unknownPowerRisk();
  assert.equal(power.coverage, 'unknown');
  assert.equal(power.score, null);
  assert.match(power.coverageReason ?? '', /unknown.+not included/i);
  assert.deepEqual(power.alerts, []);
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
  const records = parseBgpAnomalies({ data: {
    resource: 'AS3356', inconsistencies: ['a','b','c','d','e','f'],
  }});
  const alerts = bgpAlertsFor(records, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.title, 'AS3356 / Lumen routing anomaly');
});

test('bgp evidence: every score and alert claim names the exact AS3356 / Lumen scope', () => {
  const records = parseBgpAnomalies({ data: {
    resource: 'AS3356',
    inconsistencies: ['a', 'b', 'c', 'd', 'e'],
    query_time: new Date(NOW).toISOString(),
  } });
  assert.match(scoreBgpAnomalies(records).headline, /AS3356 \/ Lumen/);
  assert.match(bgpAlertsFor(records, NOW)[0]!.title, /AS3356 \/ Lumen/);
  assert.match(bgpAlertsFor(records, NOW)[0]!.body, /AS3356 \/ Lumen/);
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

test('compose: unknown power and scoped AS3356 evidence are excluded from broad-domain scoring', () => {
  const state = composeInfraRiskState({
    power: unknownPowerRisk(),
    kev: { coverage: 'reported', coverageReason: null, entries: [], score: { score: 75, severity: 'HIGH', headline: '' }, alerts: [] },
    bgp: { coverage: 'reported', coverageReason: null, records: [], scopeLabel: RIPE_BGP_SCOPE_LABEL, compositeEligible: false, score: { score: 50, severity: 'MEDIUM', headline: '' }, alerts: [] },
    acled: { coverage: 'reported', coverageReason: null, events: [], score: { score: 0, severity: 'INFO', headline: '' }, alerts: [] },
    fetchedAt: NOW,
  });
  // AS3356 is scoped evidence. Only broad KEV + ACLED vote: (75 + 0) / 2 = 38.
  assert.equal(state.compositeScore, 38);
  assert.equal(state.compositeSeverity, 'MEDIUM');
  assert.equal(state.compositeCoverage, 'reported');
  assert.equal(state.observedDomainCount, 2);
  assert.equal(state.expectedDomainCount, 2);
  assert.equal(state.power.coverage, 'unknown');
});

test('compose: all-zero domains → INFO composite', () => {
  const zero = { score: 0, severity: 'INFO' as const, headline: '' };
  const state = composeInfraRiskState({
    power: unknownPowerRisk(),
    kev: { coverage: 'reported', coverageReason: null, entries: [], score: zero, alerts: [] },
    bgp: { coverage: 'reported', coverageReason: null, records: [], scopeLabel: RIPE_BGP_SCOPE_LABEL, compositeEligible: false, score: zero, alerts: [] },
    acled: { coverage: 'reported', coverageReason: null, events: [], score: zero, alerts: [] },
    fetchedAt: NOW,
  });
  assert.equal(state.compositeScore, 0);
  assert.equal(state.compositeSeverity, 'INFO');
});

test('compose: result is JSON-serializable', () => {
  const zero = { score: 0, severity: 'INFO' as const, headline: '' };
  const state = composeInfraRiskState({
    power: unknownPowerRisk(),
    kev: { coverage: 'reported', coverageReason: null, entries: [], score: zero, alerts: [] },
    bgp: { coverage: 'reported', coverageReason: null, records: [], scopeLabel: RIPE_BGP_SCOPE_LABEL, compositeEligible: false, score: zero, alerts: [] },
    acled: { coverage: 'reported', coverageReason: null, events: [], score: zero, alerts: [] },
    fetchedAt: NOW,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('compose: scoped AS3356 / Lumen evidence is explicitly excluded from the broad composite', () => {
  const state = composeInfraRiskState({
    power: unknownPowerRisk(),
    kev: { coverage: 'reported', coverageReason: null, entries: [], score: { score: 25, severity: 'LOW', headline: '' }, alerts: [] },
    bgp: { coverage: 'reported', coverageReason: null, records: [], scopeLabel: RIPE_BGP_SCOPE_LABEL, compositeEligible: false, score: { score: 100, severity: 'CRITICAL', headline: '' }, alerts: [] },
    acled: { coverage: 'unknown', coverageReason: 'Unavailable.', events: [], score: null, alerts: [] },
    fetchedAt: NOW,
  });
  assert.equal(state.bgp.scopeLabel, RIPE_BGP_SCOPE_LABEL);
  assert.equal(state.bgp.compositeEligible, false);
  assert.equal(state.compositeScore, 25);
  assert.equal(state.observedDomainCount, 1);
  assert.equal(state.expectedDomainCount, 2);
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

function canonicalKevRow(index = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cveID: `CVE-2026-${String(1000 + index)}`,
    vendorProject: 'Example Vendor',
    product: 'Example Product',
    vulnerabilityName: 'Example vulnerability',
    dateAdded: '2026-05-01',
    shortDescription: 'A bounded description of the exploited vulnerability.',
    requiredAction: 'Apply mitigations according to vendor instructions.',
    dueDate: '2026-06-01',
    knownRansomwareCampaignUse: 'Unknown',
    notes: '',
    cwes: ['CWE-78'],
    ...overrides,
  };
}

function canonicalKevCatalog(
  rows: Record<string, unknown>[] = [canonicalKevRow()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    catalogVersion: '2026.05.12',
    dateReleased: new Date(NOW).toISOString(),
    count: rows.length,
    vulnerabilities: rows,
    ...overrides,
  };
}

test('orchestrator: pulls two supported live feeds and leaves unsupported domains unknown', async () => {
  _resetInfraStateForTests();
  const requested: string[] = [];
  const delegate = mockFetch({
    '/kev': canonicalKevCatalog([canonicalKevRow(1, { dateAdded: '2026-05-12' })]),
    '/bgp': { status: 'ok', status_code: 200,
      data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(),
        inconsistencies: ['x','y','z','a','b','c'] } },
  });
  const state = await fetchInfraRisks({
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input));
      return delegate(input, init);
    }) as typeof fetch,
    now: NOW,
  });
  assert.equal(state.power.coverage, 'unknown');
  assert.equal(requested.some((url) => url.endsWith('/power')), false);
  assert.equal(requested.some((url) => url.endsWith('/acled')), false);
  assert.equal(state.kev.entries.length, 1);
  assert.equal(state.bgp.records.length, 1);
  assert.equal(state.acled.events.length, 0);
  assert.equal(state.kev.coverage, 'reported');
  assert.equal(state.bgp.coverage, 'reported');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.compositeCoverage, 'partial');
  assert.equal(state.observedDomainCount, 1);
  assert.equal(state.expectedDomainCount, 2);
  assert.equal(state.bgp.scopeLabel, RIPE_BGP_SCOPE_LABEL);
  assert.equal(state.bgp.compositeEligible, false);
  assert.ok(state.compositeScore > 0);
  assert.equal(getInfraState(), state);
});

test('orchestrator: total HTTP failure is unknown, not a 0/100 INFO all-clear', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({}),
    now: NOW,
  });
  assert.equal(state.power.coverage, 'unknown');
  assert.equal(state.kev.entries.length, 0);
  assert.equal(state.bgp.records.length, 0);
  assert.equal(state.acled.events.length, 0);
  assert.equal(state.kev.coverage, 'unknown');
  assert.equal(state.bgp.coverage, 'unknown');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.kev.score, null);
  assert.equal(state.bgp.score, null);
  assert.equal(state.acled.score, null);
  assert.equal(state.compositeScore, null);
  assert.equal(state.compositeSeverity, null);
  assert.equal(state.compositeCoverage, 'unknown');
  assert.equal(state.observedDomainCount, 0);
});

test('orchestrator: network exception is swallowed into explicit unknown coverage', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: (() => { throw new Error('network down'); }) as unknown as typeof fetch,
    now: NOW,
  });
  assert.equal(state.compositeScore, null);
  assert.equal(state.compositeSeverity, null);
  assert.equal(state.compositeCoverage, 'unknown');
});

test('orchestrator: a fetch implementation that never settles is bounded, aborted, and becomes unknown', async () => {
  _resetInfraStateForTests();
  const upstreamSignals: AbortSignal[] = [];
  const neverSettles = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) upstreamSignals.push(init.signal);
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([
      fetchInfraRisks({ fetchImpl: neverSettles, now: NOW, timeoutMs: 10 }),
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => reject(new Error('refresh exceeded its bounded deadline')), 250);
      }),
    ]);
    assert.equal(state.kev.coverage, 'unknown');
    assert.equal(state.bgp.coverage, 'unknown');
    assert.match(state.kev.coverageReason ?? '', /timed out/i);
    assert.match(state.bgp.coverageReason ?? '', /timed out/i);
    assert.equal(state.compositeScore, null);
    assert.equal(upstreamSignals.length, 2);
    assert.equal(upstreamSignals.every((signal) => signal.aborted), true);
  } finally {
    if (guard) clearTimeout(guard);
  }
});

test('orchestrator: partial failure excludes the unknown domain and renormalizes observed weights', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog([canonicalKevRow(1, { dateAdded: '2026-05-12' })]),
    }),
    now: NOW,
  });
  assert.equal(state.kev.coverage, 'reported');
  assert.equal(state.bgp.coverage, 'unknown');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.compositeCoverage, 'partial');
  assert.equal(state.observedDomainCount, 1);
  assert.equal(state.compositeScore, 50);
  assert.equal(state.compositeSeverity, 'HIGH');
});

test('orchestrator: degraded HTTP-200 envelopes remain unknown', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': { vulnerabilities: [], degraded: true },
      '/bgp': { data: { resource: 'AS1', inconsistencies: [] }, degraded: true },
      '/acled': { data: [], degraded: true },
    }),
    now: NOW,
  });
  assert.equal(state.kev.coverage, 'unknown');
  assert.equal(state.bgp.coverage, 'unknown');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.compositeScore, null);
});

test('orchestrator: malformed HTTP-200 envelopes and all-dropped rows remain unknown', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': { vulnerabilities: [{}] },
      '/bgp': { data: { resource: 'AS1', inconsistencies: 'not-an-array' } },
      '/acled': { data: [{ fatalities: 0 }] },
    }),
    now: NOW,
  });
  assert.equal(state.kev.coverage, 'unknown');
  assert.equal(state.bgp.coverage, 'unknown');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.compositeScore, null);
});

test('orchestrator: RIPE provider errors and wrong-resource envelopes remain unknown', async () => {
  _resetInfraStateForTests();
  const providerError = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog(),
      '/bgp': { status: 'error', status_code: 500,
        data: { resource: 'AS3356', inconsistencies: [] } },
    }),
    now: NOW,
  });
  assert.equal(providerError.bgp.coverage, 'unknown');
  assert.equal(providerError.bgp.score, null);

  const wrongResource = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog(),
      '/bgp': { status: 'ok', status_code: 200,
        data: { resource: 'AS9999', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
    }),
    now: NOW,
  });
  assert.equal(wrongResource.bgp.coverage, 'unknown');
  assert.equal(wrongResource.bgp.score, null);
});

test('orchestrator: unscoped ACLED history is never fetched or scored as current risk', async () => {
  _resetInfraStateForTests();
  const requested: string[] = [];
  const delegate = mockFetch({
    '/kev': canonicalKevCatalog(),
    '/bgp': { status: 'ok', status_code: 200,
      data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
    '/acled': { success: true, data: [{ event_id_cnty: 'OLD', fatalities: 100,
      event_date: '2020-01-01', country: 'X' }] },
  });
  const state = await fetchInfraRisks({
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input));
      return delegate(input, init);
    }) as typeof fetch,
    now: NOW,
  });
  assert.equal(requested.some((url) => url.endsWith('/acled')), false);
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.acled.score, null);
  assert.deepEqual(state.acled.events, []);
  assert.equal(state.acled.alerts.length, 0);
});

test('orchestrator: empty, inconsistent, invalid, and future-dated KEV catalogs remain unknown', async () => {
  const invalidCatalogs = [
    canonicalKevCatalog([]),
    canonicalKevCatalog([canonicalKevRow()], { count: 2 }),
    canonicalKevCatalog([canonicalKevRow()], { catalogVersion: '' }),
    canonicalKevCatalog([canonicalKevRow(1, { product: '' })]),
    canonicalKevCatalog([canonicalKevRow(1, { dateAdded: '2026-05-13' })]),
    canonicalKevCatalog([canonicalKevRow(1, { cwes: [] })]),
    canonicalKevCatalog([canonicalKevRow()], { dateReleased: 'not-a-date' }),
    canonicalKevCatalog([canonicalKevRow()], { dateReleased: '2026-05-12T12:06:00Z' }),
  ];
  for (const payload of invalidCatalogs) {
    _resetInfraStateForTests();
    const state = await fetchInfraRisks({
      fetchImpl: mockFetch({
        '/kev': payload,
        '/bgp': { status: 'ok', status_code: 200,
          data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
      }),
      now: NOW,
    });
    assert.equal(state.kev.coverage, 'unknown');
    assert.equal(state.kev.score, null);
    assert.equal(state.compositeScore, null);
  }
});

test('orchestrator: a validated nonempty full KEV catalog with no 7-day additions reports zero', async () => {
  _resetInfraStateForTests();
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog(),
      '/bgp': { status: 'ok', status_code: 200,
        data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
    }),
    now: NOW,
  });
  assert.equal(state.kev.coverage, 'reported');
  assert.equal(state.bgp.coverage, 'reported');
  assert.equal(state.acled.coverage, 'unknown');
  assert.equal(state.compositeScore, 0);
  assert.equal(state.compositeSeverity, 'INFO');
  assert.equal(state.compositeCoverage, 'partial');
});

test('orchestrator: aborted late refresh cannot overwrite the last module state', async () => {
  _resetInfraStateForTests();
  const initial = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog(),
      '/bgp': { status: 'ok', status_code: 200,
        data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
    }),
    now: NOW,
  });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const lateFetch = (async (input: RequestInfo | URL) => {
    await gate;
    const url = String(input);
    const payload = url.endsWith('/kev')
      ? canonicalKevCatalog([canonicalKevRow(2, { dateAdded: '2026-05-12' })])
      : url.endsWith('/bgp')
        ? { status: 'ok', status_code: 200,
          data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: ['late'] } }
        : { data: [{ event_id_cnty: 'LATE', event_date: '2026-05-12', fatalities: 50 }] };
    return { ok: true, json: async () => payload } as Response;
  }) as typeof fetch;
  const controller = new AbortController();
  const pending = fetchInfraRisks({ fetchImpl: lateFetch, signal: controller.signal, now: NOW + 1 });
  controller.abort();
  release();

  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.equal(getInfraState(), initial);
});

test('getInfraState: starts null + reflects last fetch', async () => {
  _resetInfraStateForTests();
  assert.equal(getInfraState(), null);
  await fetchInfraRisks({ fetchImpl: mockFetch({}), now: NOW });
  assert.ok(getInfraState() !== null);
});

test('display freshness: a formerly reported snapshot ages to unknown without a new fetch event', async () => {
  const state = await fetchInfraRisks({
    fetchImpl: mockFetch({
      '/kev': canonicalKevCatalog(),
      '/bgp': { status: 'ok', status_code: 200,
        data: { resource: 'AS3356', query_time: new Date(NOW).toISOString(), inconsistencies: [] } },
    }),
    now: NOW,
  });
  assert.equal(ageInfraRiskState(state, NOW + INFRA_RISK_STATE_MAX_AGE_MS), state);

  const aged = ageInfraRiskState(state, NOW + INFRA_RISK_STATE_MAX_AGE_MS + 1);
  assert.notEqual(aged, state);
  assert.equal(aged.kev.coverage, 'unknown');
  assert.equal(aged.bgp.coverage, 'unknown');
  assert.equal(aged.bgp.scopeLabel, RIPE_BGP_SCOPE_LABEL);
  assert.equal(aged.bgp.compositeEligible, false);
  assert.equal(aged.compositeScore, null);
  assert.equal(aged.compositeSeverity, null);
  assert.equal(aged.compositeCoverage, 'unknown');
  assert.equal(aged.observedDomainCount, 0);
  assert.match(aged.kev.coverageReason ?? '', /stale/i);
  assert.match(aged.bgp.coverageReason ?? '', /stale/i);
});

test('panel: renders explicit total/partial unknown coverage instead of a fixed observed count', () => {
  const panelSource = readFileSync(new URL('../../../components/InfraRiskMatrixPanel.ts', import.meta.url), 'utf8');
  assert.match(panelSource, /this\.loadAbort\?\.abort\(\);[\s\S]+super\.destroy\(\);/);
  assert.match(panelSource, /signal: controller\.signal/);
  assert.match(panelSource, /this\.stopped \|\| controller\.signal\.aborted \|\| generation !== this\.loadGeneration/);
  assert.match(panelSource, /if \(this\.state\.compositeScore === null \|\| this\.state\.compositeSeverity === null\)/);
  assert.match(panelSource, /Composite Risk[\s\S]+Unavailable/);
  assert.match(panelSource, /0 of \$\{this\.state\.expectedDomainCount\} scored source domains reporting/);
  assert.match(panelSource, /compositeCoverage === 'partial'/);
  assert.match(panelSource, /Missing coverage is not an all-clear/);
  assert.match(panelSource, /AS3356 \/ Lumen/);
  assert.match(panelSource, /this\.state = ageInfraRiskState\(this\.state, Date\.now\(\)\)/);
  assert.match(panelSource, /this\.scheduleFreshnessTransition\(\);/);
  assert.match(panelSource, /this\.freshnessTimer = setTimeout\([\s\S]+this\.render\(\);/);
  assert.match(panelSource, /clearTimeout\(this\.freshnessTimer\)/);
  assert.doesNotMatch(panelSource, />3 observed domains/);
});
