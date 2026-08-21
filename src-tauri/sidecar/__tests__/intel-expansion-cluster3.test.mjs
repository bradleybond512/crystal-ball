/**
 * Intel Expansion Cluster 3 — parser parity tests.
 *
 * All assertions run against committed fixture files (no live fetch).
 * Parsers are exported from local-api-server.mjs and tested here.
 *
 * Sources covered:
 *   - IODA internet outage alerts (parseIodaAlerts)
 *   - openFDA drug shortages (parseFdaShortages)
 *   - openFDA enforcement recalls (parseFdaRecalls)
 *   - ORNL ODIN power outages (parseOdinOutages)
 *   - Copernicus EMS activations (parseCopernicusActivations)
 *   - GLEIF LEI entity lookup (parseGleifLeiRecords)
 *   - Cloudflare Radar outage annotations (parseCloudflareRadarOutages)
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { join, dirname } = path;
import {
  parseIodaAlerts,
  parseFdaShortages,
  parseFdaRecalls,
  parseOdinOutages,
  parseOdinOutagesDetailed,
  validateOdinQuery,
  odinPageIsCompleteSidecar,
  odinRequestCanStart,
  pruneOdinCache,
  parseUsgsWaterNumber,
  normalizeUsgsMonitoringLocationsSidecar,
  normalizeUsgsLatestContinuousSidecar,
  normalizeInfrastructureBgpPayload,
  infrastructureBgpPageIsComplete,
  infraRiskCisaKevEnvelopeIsUsable,
  infraRiskRipeEnvelopeIsUsable,
  normalizeInfrastructureRadiationPayload,
  parseCopernicusActivations,
  parseGleifLeiRecords,
  parseCloudflareRadarOutages,
} from '../local-api-server.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dir, 'fixtures');
const sidecarSource = readFileSync(join(__dir, '..', 'local-api-server.mjs'), 'utf8');

function cloudflareBgpEvent(index = 1, overrides = {}) {
  return {
    id: 1000 + index,
    confidence_score: 9,
    event_type: 0,
    hijacker_asn: 64_512 + index,
    is_stale: false,
    min_hijack_ts: '2026-08-14T13:00:00.000',
    max_hijack_ts: '2026-08-14T13:05:00.000',
    on_going_count: 1,
    prefixes: [`203.0.${index}.0/24`],
    victim_asns: [64_496],
    ...overrides,
  };
}

// ── Infrastructure BGP / radiation truth envelopes ──────────────────────────

function canonicalKevRow(index = 1, overrides = {}) {
  return {
    cveID: `CVE-2026-${String(index).padStart(4, '0')}`,
    vendorProject: 'Example Vendor',
    product: 'Example Product',
    vulnerabilityName: 'Example vulnerability',
    dateAdded: '2026-08-13',
    shortDescription: 'A bounded description of the exploited vulnerability.',
    requiredAction: 'Apply mitigations according to vendor instructions.',
    dueDate: '2026-09-01',
    knownRansomwareCampaignUse: 'Unknown',
    notes: '',
    cwes: ['CWE-78'],
    ...overrides,
  };
}

function canonicalKevCatalog(rows = [canonicalKevRow()], overrides = {}) {
  return {
    catalogVersion: '2026.08.14',
    dateReleased: '2026-08-14T13:30:00Z',
    count: rows.length,
    vulnerabilities: rows,
    ...overrides,
  };
}

test('InfraRisk CISA KEV cache accepts only a canonical complete nonempty catalog', () => {
  const now = Date.parse('2026-08-14T14:00:00Z');
  const valid = canonicalKevCatalog();
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(valid, now), true);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable({ ...valid, count: 2 }, now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable({ ...valid, catalogVersion: '' }, now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable({ ...valid, dateReleased: 'not-a-date' }, now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable({ ...valid, dateReleased: '2026-08-14T14:06:00Z' }, now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1, { product: '' }),
  ]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1, { dateAdded: '2026-02-30' }),
  ]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1, { dateAdded: '2026-08-15' }),
  ]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1, { dueDate: 'not-a-date' }),
  ]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1, { cwes: [] }),
  ]), now), false);
  assert.equal(infraRiskCisaKevEnvelopeIsUsable(canonicalKevCatalog([
    canonicalKevRow(1), canonicalKevRow(1),
  ]), now), false);
});

test('InfraRisk CISA KEV route bounds the full catalog and validates before caching', () => {
  const kevStart = sidecarSource.indexOf("requestUrl.pathname === '/api/infrarisks/kev'");
  const bgpStart = sidecarSource.indexOf("requestUrl.pathname === '/api/infrarisks/bgp'", kevStart);
  const kevRoute = sidecarSource.slice(kevStart, bgpStart);
  assert.match(kevRoute, /maxResponseBytes: INFRA_RISK_CISA_KEV_MAX_RESPONSE_BYTES/);
  assert.ok(kevRoute.indexOf('infraRiskCisaKevEnvelopeIsUsable') < kevRoute.indexOf("setCached('infrarisks-kev'"));
  assert.match(kevRoute, /CISA KEV response failed validation[\s\S]+}, 502\)/);
});

test('InfraRisk RIPE cache accepts only native-success exact fresh resource envelopes', () => {
  const now = Date.parse('2026-08-14T14:00:00Z');
  const valid = {
    status: 'ok', status_code: 200,
    data: { resource: 'AS3356', query_time: '2026-08-14T13:50:00Z', inconsistencies: [] },
  };
  assert.equal(infraRiskRipeEnvelopeIsUsable(valid, 'AS3356', now), true);
  assert.equal(infraRiskRipeEnvelopeIsUsable({ ...valid, status: 'error' }, 'AS3356', now), false);
  assert.equal(infraRiskRipeEnvelopeIsUsable({
    ...valid, data: { ...valid.data, resource: 'AS9999' },
  }, 'AS3356', now), false);
  assert.equal(infraRiskRipeEnvelopeIsUsable({
    ...valid, data: { ...valid.data, query_time: '2026-08-14T12:00:00Z' },
  }, 'AS3356', now), false);
  assert.equal(infraRiskRipeEnvelopeIsUsable({
    ...valid, data: { ...valid.data, query_time: '2026-08-14T14:06:00Z' },
  }, 'AS3356', now), false);

  const bgpStart = sidecarSource.indexOf("requestUrl.pathname === '/api/infrarisks/bgp'");
  const acledStart = sidecarSource.indexOf("requestUrl.pathname === '/api/infrarisks/acled'", bgpStart);
  const stateStart = sidecarSource.indexOf("requestUrl.pathname === '/api/infrarisks/state'", acledStart);
  const bgpRoute = sidecarSource.slice(bgpStart, acledStart);
  const acledRoute = sidecarSource.slice(acledStart, stateStart);
  assert.match(bgpRoute, /maxResponseBytes: 512 \* 1024/);
  assert.ok(bgpRoute.indexOf('infraRiskRipeEnvelopeIsUsable') < bgpRoute.indexOf('setCached(cacheKey'));
  assert.match(acledRoute, /Current-window ACLED coverage is disabled/);
  assert.doesNotMatch(acledRoute, /api\.acleddata\.com|setCached\(/);
  assert.match(acledRoute, /}, 503\)/);
});

test('BGP sidecar missing-key path is unavailable, never HTTP-200 reported zero', () => {
  const start = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/bgp'");
  const end = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/radiation'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = sidecarSource.slice(start, end);
  assert.match(route, /infrastructureBgpUnknown\('missing_key',[\s\S]*?, true\), 503\)/);
});

test('BGP sidecar distinguishes reported empty from malformed and all-dropped responses', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const empty = normalizeInfrastructureBgpPayload({ success: true, result: { events: [] } }, fetchedAt);
  assert.equal(empty.coverage, 'reported');
  assert.equal(empty.acceptedRows, 0);
  assert.equal(empty.error, null);

  const malformed = normalizeInfrastructureBgpPayload({ success: true, result: {} }, fetchedAt);
  assert.equal(malformed.coverage, 'unknown');
  assert.equal(malformed.error, 'malformed_response');
  assert.equal(normalizeInfrastructureBgpPayload({ result: { events: [] } }, fetchedAt).coverage, 'unknown');

  const dropped = normalizeInfrastructureBgpPayload({
    success: true, result: { events: [{ id: 'no-evidence' }] },
  }, fetchedAt);
  assert.equal(dropped.coverage, 'unknown');
  assert.equal(dropped.error, 'no_valid_events');
  assert.equal(dropped.droppedRows, 1);
});

test('BGP sidecar emits a bounded allowlisted event envelope', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const result = normalizeInfrastructureBgpPayload({
    success: true,
    result: { events: [cloudflareBgpEvent(1, {
      id: 1234,
      prefixes: ['1.1.1.0/24'],
      hijacker_asn: 64_512,
      victim_asns: [13_335, 64_513],
      secret: 'must-not-pass',
    })] },
  }, fetchedAt);
  assert.equal(result.coverage, 'reported');
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.events[0].secret, undefined);
  assert.equal(result.events[0].started_at, '2026-08-14T13:00:00.000Z');
  assert.equal(result.events[0].ended_at, null);
  assert.deepEqual(result.events[0].detected_origins, ['64512']);
  assert.equal(result.events[0].expected_origin, '13335');
  assert.deepEqual(result.events[0].involved_asns, ['13335', '64513', '64512']);
  assert.equal(result.events[0].id, '1234');
});

test('BGP sidecar models explicit ongoing/resolved lifecycle and rejects ambiguous lifecycle evidence', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const payload = { success: true, result: { events: [
    cloudflareBgpEvent(1),
    cloudflareBgpEvent(2, { on_going_count: 0 }),
    cloudflareBgpEvent(3, { on_going_count: 0, is_stale: true }),
    cloudflareBgpEvent(4, { on_going_count: 1, is_stale: true }),
    cloudflareBgpEvent(5, { on_going_count: undefined }),
    cloudflareBgpEvent(6, { is_stale: undefined }),
    cloudflareBgpEvent(7, { max_hijack_ts: 'not-a-time' }),
  ] } };
  const result = normalizeInfrastructureBgpPayload(payload, fetchedAt);
  assert.equal(result.coverage, 'reported');
  assert.equal(result.acceptedRows, 3);
  assert.equal(result.droppedRows, 4);
  assert.equal(result.events[0].ended_at, null);
  assert.equal(result.events[1].ended_at, '2026-08-14T13:05:00.000Z');
  assert.equal(result.events[2].ended_at, '2026-08-14T13:05:00.000Z');
});

test('BGP sidecar fails unknown when every Cloudflare lifecycle row is ambiguous', () => {
  const result = normalizeInfrastructureBgpPayload({ success: true, result: { events: [
    cloudflareBgpEvent(1, { on_going_count: undefined }),
    cloudflareBgpEvent(2, { on_going_count: 2, is_stale: true }),
  ] } });
  assert.equal(result.coverage, 'unknown');
  assert.equal(result.error, 'no_valid_events');
  assert.equal(result.droppedRows, 2);
});

test('BGP sidecar fails unknown when pagination metadata proves the first page is incomplete', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const events = Array.from({ length: 20 }, (_, index) => cloudflareBgpEvent(index));
  const payload = {
    success: true,
    result: { events },
    result_info: { page: 1, per_page: 20, count: 20, total_count: 21 },
  };

  assert.equal(infrastructureBgpPageIsComplete(payload, events.length, 20), false);
  const result = normalizeInfrastructureBgpPayload(payload, fetchedAt);
  assert.equal(result.coverage, 'unknown');
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.error, 'incomplete_page');

  const start = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/bgp'");
  const end = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/radiation'", start);
  const route = sidecarSource.slice(start, end);
  assert.match(route, /if \(result\.coverage !== 'reported'\) return json\(result, 502\);\s*setCached/);
});

test('BGP sidecar requires completeness proof for a saturated page', () => {
  const events = Array.from({ length: 20 }, (_, index) => cloudflareBgpEvent(index, {
    prefixes: [`198.51.${index}.0/24`],
  }));
  assert.equal(infrastructureBgpPageIsComplete({ success: true, result: { events } }, 20, 20), false);
  assert.equal(normalizeInfrastructureBgpPayload({ success: true, result: { events } }).error, 'incomplete_page');

  const complete = {
    success: true,
    result: { events },
    result_info: { page: 1, per_page: 20, count: 20, total_count: 20, total_pages: 1 },
  };
  assert.equal(infrastructureBgpPageIsComplete(complete, 20, 20), true);
  assert.equal(normalizeInfrastructureBgpPayload(complete).coverage, 'reported');
});

test('radiation sidecar distinguishes reported empty, known zero, malformed, and zero-valid rows', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const empty = normalizeInfrastructureRadiationPayload([], fetchedAt);
  assert.equal(empty.coverage, 'reported');
  assert.equal(empty.acceptedRows, 0);

  const zero = normalizeInfrastructureRadiationPayload([{
    StationName: 'Zero, IN', GammaCpm: 0, Latitude: 41.6, Longitude: -86.7,
    SampleDateTime: '2026-08-14T13:00:00Z', secret: 'must-not-pass',
  }], fetchedAt);
  assert.equal(zero.coverage, 'reported');
  assert.equal(zero.stations[0].GammaCpm, 0);
  assert.equal(zero.stations[0].Longitude, -86.7);
  assert.equal(zero.stations[0].secret, undefined);

  const malformed = normalizeInfrastructureRadiationPayload({}, fetchedAt);
  assert.equal(malformed.coverage, 'unknown');
  assert.equal(malformed.error, 'malformed_response');

  const noValid = normalizeInfrastructureRadiationPayload([
    { StationName: 'missing' },
    { StationName: 'negative', GammaCpm: -1 },
    { StationName: 'junk', GammaCpm: '100 CPM' },
  ], fetchedAt);
  assert.equal(noValid.coverage, 'unknown');
  assert.equal(noValid.error, 'no_valid_stations');
  assert.equal(noValid.droppedRows, 3);
});

test('radiation sidecar requires strict, nonfuture sample times before reporting station evidence', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const result = normalizeInfrastructureRadiationPayload([
    { StationName: 'valid', GammaCpm: 100, SampleDateTime: '2026-08-14T13:00:00' },
    { StationName: 'missing-time', GammaCpm: 100 },
    { StationName: 'invalid-civil', GammaCpm: 100, SampleDateTime: '2026-02-30T13:00:00Z' },
    { StationName: 'future', GammaCpm: 100, SampleDateTime: '2026-08-14T14:05:00.001Z' },
  ], fetchedAt);
  assert.equal(result.coverage, 'reported');
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.droppedRows, 3);
  assert.equal(result.stations[0].SampleDateTime, '2026-08-14T13:00:00.000Z');
});

// ── IODA internet outages ─────────────────────────────────────────────────────

test('parseIodaAlerts: fixture produces 4 alerts', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  assert.equal(result.length, 4);
});

test('parseIodaAlerts: first alert has correct shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const first = result[0];
  assert.equal(first.entityType, 'region');
  assert.equal(first.entityCode, '639');
  assert.equal(first.entityName, 'Ningxia');
  assert.equal(first.level, 'critical');
  assert.equal(first.score, 344);
  assert.equal(first.historyValue, 431);
  assert.equal(first.datasource, 'ping-slash24');
  assert.equal(first.method, 'median');
  assert.equal(first.from, 1_782_828_000);
});

test('parseIodaAlerts: critical alerts present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const critical = result.filter(a => a.level === 'critical');
  assert.ok(critical.length >= 2, 'fixture should have at least 2 critical alerts');
});

test('parseIodaAlerts: ASN entity type is parsed correctly', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ioda-outages.sample.json'), 'utf8'));
  const result = parseIodaAlerts(raw);
  const asn = result.find(a => a.entityType === 'asn');
  assert.ok(asn, 'should have at least one ASN-type alert');
  assert.ok(asn.entityCode.length > 0, 'ASN code must be non-empty');
});

test('parseIodaAlerts: returns empty for missing data array', () => {
  assert.deepEqual(parseIodaAlerts(null), []);
  assert.deepEqual(parseIodaAlerts({}), []);
  assert.deepEqual(parseIodaAlerts({ data: null }), []);
  assert.deepEqual(parseIodaAlerts({ data: [] }), []);
});

// ── openFDA drug shortages ────────────────────────────────────────────────────

test('parseFdaShortages: fixture produces 3 shortages', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  assert.equal(result.length, 3);
});

test('parseFdaShortages: first entry has correct genericName and status', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  const first = result[0];
  assert.equal(first.genericName, 'Ropivacaine Hydrochloride Injection');
  assert.equal(first.status, 'Available');
  assert.equal(first.packageNdc, '63323-287-21');
  assert.equal(first.initialPostingDate, '03/23/2018');
});

test('parseFdaShortages: unavailable entry is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-shortages.sample.json'), 'utf8'));
  const result = parseFdaShortages(raw);
  const unavailable = result.find(r => r.status === 'Unavailable');
  assert.ok(unavailable, 'fixture should have at least one Unavailable entry');
  assert.equal(unavailable.genericName, 'Sodium Chloride 0.9% Injection');
});

test('parseFdaShortages: returns empty for missing results', () => {
  assert.deepEqual(parseFdaShortages(null), []);
  assert.deepEqual(parseFdaShortages({}), []);
  assert.deepEqual(parseFdaShortages({ results: [] }), []);
});

// ── openFDA enforcement recalls ───────────────────────────────────────────────

test('parseFdaRecalls: fixture produces 3 recalls', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  assert.equal(result.length, 3);
});

test('parseFdaRecalls: first recall has correct shape', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  const first = result[0];
  assert.ok(first.product.includes('Progesterone'), 'product should mention Progesterone');
  assert.equal(first.classification, 'Class II');
  assert.equal(first.state, 'IL');
  assert.equal(first.distributionPattern, 'Nationwide');
  assert.equal(first.status, 'Terminated');
  assert.equal(first.recallDate, '20150903');
  assert.ok(first.voluntaryMandated.includes('Voluntary'));
});

test('parseFdaRecalls: Class I recall is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'openfda-drug-recalls.sample.json'), 'utf8'));
  const result = parseFdaRecalls(raw);
  const classI = result.find(r => r.classification === 'Class I');
  assert.ok(classI, 'fixture should have at least one Class I recall');
});

test('parseFdaRecalls: returns empty for missing results', () => {
  assert.deepEqual(parseFdaRecalls(null), []);
  assert.deepEqual(parseFdaRecalls({}), []);
  assert.deepEqual(parseFdaRecalls({ results: [] }), []);
});

// ── ORNL ODIN power outages ───────────────────────────────────────────────────

test('parseOdinOutages: fixture produces 3 outage records', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  assert.equal(result.length, 3);
});

test('parseOdinOutages: first record has correct county and state', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  const first = result[0];
  assert.equal(first.county, 'Ashe');
  assert.equal(first.state, 'North Carolina');
  assert.equal(first.fips, '37009');
  assert.equal(first.customersOut, 3);
  assert.equal(first.utilityId, '1889');
  assert.ok(first.utilityName.includes('BLUE RIDGE'));
});

test('parseOdinOutages: large outage entry is present', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'ornl-odin-outages.sample.json'), 'utf8'));
  const result = parseOdinOutages(raw);
  const large = result.find(r => r.customersOut > 100);
  assert.ok(large, 'fixture should have at least one large outage');
  assert.equal(large.customersOut, 324);
  assert.equal(large.county, 'Beaver');
  assert.equal(large.state, 'Pennsylvania');
});

test('parseOdinOutages: returns empty for missing results', () => {
  assert.deepEqual(parseOdinOutages(null), []);
  assert.deepEqual(parseOdinOutages({}), []);
  assert.deepEqual(parseOdinOutages({ results: [] }), []);
});

test('parseOdinOutagesDetailed: accepts real zero, requires county/state, and filters FIPS exactly', () => {
  const parsed = parseOdinOutagesDetailed({ results: [
    { communitydescriptor: '18091', county: 'LaPorte', state: 'Indiana', metersaffected: 0, reportedstarttime: '2026-08-14T00:00:00Z' },
    { communitydescriptor: '18093', county: 'Other', state: 'Indiana', metersaffected: 4 },
    { communitydescriptor: '18091', state: 'Indiana', metersaffected: 9 },
  ] }, { fips: '18091', nowMs: 1_786_665_600_000 });
  assert.equal(parsed.acceptedRows, 1);
  assert.equal(parsed.droppedRows, 2);
  assert.equal(parsed.outages[0].customersOut, 0);
  assert.equal(parsed.outages[0].county, 'LaPorte');
  assert.equal(parsed.outages[0].retrievedAt, parsed.outages[0].observedAt);
  assert.equal(parsed.outages[0].sourceObservedAt, undefined,
    'reportedstarttime is the outage event start, not an observation timestamp');
  assert.match(parsed.outages[0].expiresAt, /Z$/);
});

test('validateOdinQuery: requires exact FIPS and permits only a bounded integer limit', () => {
  assert.deepEqual(validateOdinQuery(new URLSearchParams('fips=18091&limit=100')), { fips: '18091', limit: 100 });
  assert.equal(validateOdinQuery(new URLSearchParams()), null);
  for (const invalid of ['fips=1809', 'limit=0', 'limit=1.5', 'limit=101', 'extra=x', 'fips=18091&fips=18093']) {
    assert.equal(validateOdinQuery(new URLSearchParams(invalid)), null, invalid);
  }
});

test('ODIN sidecar page completeness rejects a partial count and a saturated page without proof', () => {
  assert.equal(odinPageIsCompleteSidecar({ total_count: 2, results: [{}] }, 10), false);
  assert.equal(odinPageIsCompleteSidecar({ results: [{}] }, 1), false);
  assert.equal(odinPageIsCompleteSidecar({ total_count: 1, results: [{}] }, 1), true);
  assert.equal(odinPageIsCompleteSidecar({ results: [] }, 50), true);
});

test('ODIN sidecar shares an existing request and caps distinct in-flight work', () => {
  const inFlight = new Map(Array.from({ length: 64 }, (_, index) => [`ornl-odin:key-${index}`, Promise.resolve()]));
  assert.equal(odinRequestCanStart(inFlight, 'ornl-odin:key-0'), true, 'same-key work remains single-flighted');
  assert.equal(odinRequestCanStart(inFlight, 'ornl-odin:new-key'), false, 'the 65th distinct key fails fast');
});

test('ODIN sidecar immediately evicts the oldest route cache key', () => {
  const cache = new Map([
    ['unrelated', {}],
    ['ornl-odin:oldest', {}],
    ['ornl-odin:middle', {}],
    ['ornl-odin:newest', {}],
  ]);
  assert.equal(pruneOdinCache(cache, 2), true);
  assert.equal(cache.has('unrelated'), true);
  assert.equal(cache.has('ornl-odin:oldest'), false);
  assert.deepEqual([...cache.keys()].filter((key) => key.startsWith('ornl-odin:')), [
    'ornl-odin:middle', 'ornl-odin:newest',
  ]);
});

// ── USGS bounded surface-water parity ───────────────────────────────────────

test('USGS sidecar rejects coercible coordinates and nonempty all-dropped pages', () => {
  const bbox = '-87.000000,41.000000,-86.000000,42.000000';
  assert.equal(parseUsgsWaterNumber(null), undefined);
  assert.equal(parseUsgsWaterNumber(''), undefined);
  assert.equal(parseUsgsWaterNumber([]), undefined);
  const locations = normalizeUsgsMonitoringLocationsSidecar({
    type: 'FeatureCollection',
    features: [{
      id: 'USGS-X', geometry: { type: 'Point', coordinates: [null, ''] },
      properties: { id: 'USGS-X', agency_code: 'USGS', site_type_code: 'ST' },
    }],
  }, bbox);
  assert.equal(locations, null);
});

test('USGS sidecar requires a recent source timestamp and emits only safe fields', () => {
  const bbox = '-87.000000,41.000000,-86.000000,42.000000';
  const now = Date.parse('2026-08-14T21:00:00Z');
  const locations = new Map([['USGS-X', 'Example stream']]);
  const row = (time) => ({
    type: 'Feature', id: 'secret-id', geometry: { type: 'Point', coordinates: [-86.5, 41.5] },
    properties: {
      monitoring_location_id: 'USGS-X', parameter_code: '00400', value: '7.2',
      unit_of_measure: 'std units', secret: 'drop', ...(time ? { time } : {}),
    },
  });
  for (const time of [undefined, 'bad', '2026-08-14T20:00:00', '2026-08-14', '2026-08-12T20:00:00Z', '2026-08-16T20:00:00Z']) {
    assert.equal(normalizeUsgsLatestContinuousSidecar({
      type: 'FeatureCollection', features: [row(time)],
    }, bbox, locations, now), null);
  }
  assert.equal(normalizeUsgsLatestContinuousSidecar({
    type: 'FeatureCollection', features: [row('2026-02-30T20:30:00Z')],
  }, bbox, locations, Date.parse('2026-03-02T21:00:00Z')), null,
  'calendar-invalid civil dates must fail closed before Date.parse normalizes them');
  const normalized = normalizeUsgsLatestContinuousSidecar({
    type: 'FeatureCollection', features: [row('2026-08-14T20:30:00Z')],
  }, bbox, locations, now);
  assert.deepEqual(normalized?.features[0]?.properties, {
    monitoring_location_id: 'USGS-X', monitoring_location_name: 'Example stream',
    parameter_code: '00400', value: 7.2, time: '2026-08-14T20:30:00.000Z',
    unit_of_measure: 'std units',
  });
});

// ── Copernicus EMS activations ────────────────────────────────────────────────

test('parseCopernicusActivations: fixture produces 3 activations', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  assert.equal(result.length, 3);
});

test('parseCopernicusActivations: first activation is the German wildfire', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const first = result[0];
  assert.equal(first.code, 'EMSR886');
  assert.equal(first.category, 'fire');
  assert.equal(first.categoryName, 'Wildfire');
  assert.equal(first.country, 'Germany');
  assert.equal(first.activationTime, '2026-06-27T15:51:00');
  assert.equal(first.closed, true);
  assert.equal(first.drmPhase, 'response');
  assert.ok(first.centroid.includes('POINT'));
});

test('parseCopernicusActivations: Venezuela earthquake is category earthquake', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const eq = result.find(a => a.code === 'EMSR884');
  assert.ok(eq, 'EMSR884 (Venezuela earthquake) must be present');
  assert.equal(eq.category, 'earthquake');
  assert.equal(eq.country, 'Venezuela');
  assert.equal(eq.closed, false);
});

test('parseCopernicusActivations: all codes distinct', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'copernicus-ems-activations.sample.json'), 'utf8'));
  const result = parseCopernicusActivations(raw);
  const codes = result.map(a => a.code);
  assert.equal(new Set(codes).size, 3, 'all EMSR codes must be distinct');
});

test('parseCopernicusActivations: returns empty for missing results', () => {
  assert.deepEqual(parseCopernicusActivations(null), []);
  assert.deepEqual(parseCopernicusActivations({}), []);
  assert.deepEqual(parseCopernicusActivations({ results: [] }), []);
});

// ── GLEIF LEI entity lookup ───────────────────────────────────────────────────

test('parseGleifLeiRecords: fixture produces 3 entity records', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  assert.equal(result.length, 3);
});

test('parseGleifLeiRecords: Apple Inc. is the primary result', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const apple = result[0];
  assert.equal(apple.lei, 'HWUPKR0MPOU8FGXBT394');
  assert.equal(apple.name, 'Apple Inc.');
  assert.equal(apple.country, 'US');
  assert.equal(apple.jurisdiction, 'US-CA');
  assert.equal(apple.status, 'ACTIVE');
  assert.equal(apple.legalForm, 'H1UM');
});

test('parseGleifLeiRecords: Panama entity has PA country', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const pa = result.find(r => r.jurisdiction === 'PA');
  assert.ok(pa, 'Panama-jurisdiction entity must be present');
  assert.equal(pa.country, 'PA');
  assert.equal(pa.lei, '254900TWD71M3MX9I453');
});

test('parseGleifLeiRecords: all LEIs are distinct strings', () => {
  const raw = JSON.parse(readFileSync(join(fixtureDir, 'gleif-lei-apple.sample.json'), 'utf8'));
  const result = parseGleifLeiRecords(raw);
  const leis = result.map(r => r.lei);
  assert.equal(new Set(leis).size, 3, 'all LEI codes must be distinct');
  for (const lei of leis) {
    assert.ok(typeof lei === 'string' && lei.length === 20, `LEI ${lei} must be a 20-char string`);
  }
});

test('parseGleifLeiRecords: returns empty for missing data array', () => {
  assert.deepEqual(parseGleifLeiRecords(null), []);
  assert.deepEqual(parseGleifLeiRecords({}), []);
  assert.deepEqual(parseGleifLeiRecords({ data: [] }), []);
});

// ── Cloudflare Radar outage annotations ───────────────────────────────────────

test('parseCloudflareRadarOutages: one row per (annotation, location) pair', () => {
  const rows = parseCloudflareRadarOutages({
    result: {
      annotations: [
        { startDate: '2026-07-30T04:15:00Z', locations: ['SD', 'ER'] },
        { startDate: '2026-07-30T09:00:00Z', locations: ['BF'] },
      ],
    },
  });
  assert.deepEqual(rows, [
    { country: 'SD', startedAt: Date.parse('2026-07-30T04:15:00Z') },
    { country: 'ER', startedAt: Date.parse('2026-07-30T04:15:00Z') },
    { country: 'BF', startedAt: Date.parse('2026-07-30T09:00:00Z') },
  ]);
});

test('parseCloudflareRadarOutages: startDate is Z-suffixed, so no local-time drift', () => {
  // Guards the timestamp-honesty rule from the other direction: Cloudflare
  // always sends UTC, so Date.parse is correct as-is and a defensive 'Z'
  // append would corrupt it. This assertion is only meaningful because the
  // suite also runs under TZ=America/Chicago.
  const [row] = parseCloudflareRadarOutages({
    result: { annotations: [{ startDate: '2026-07-30T04:15:00Z', locations: ['SD'] }] },
  });
  assert.equal(new Date(row.startedAt).toISOString(), '2026-07-30T04:15:00.000Z');
});

test('parseCloudflareRadarOutages: drops rows with an unusable date or location', () => {
  const rows = parseCloudflareRadarOutages({
    result: {
      annotations: [
        { startDate: 'not-a-date', locations: ['SD'] },
        { locations: ['SD'] },
        { startDate: '2026-07-30T04:15:00Z' },
        { startDate: '2026-07-30T04:15:00Z', locations: ['', '  ', 7] },
        { startDate: '2026-07-30T04:15:00Z', locations: ['bf'] },
      ],
    },
  });
  assert.deepEqual(rows, [{ country: 'BF', startedAt: Date.parse('2026-07-30T04:15:00Z') }]);
});

test('parseCloudflareRadarOutages: returns empty for a missing annotations array', () => {
  assert.deepEqual(parseCloudflareRadarOutages(null), []);
  assert.deepEqual(parseCloudflareRadarOutages({}), []);
  assert.deepEqual(parseCloudflareRadarOutages({ result: {} }), []);
  assert.deepEqual(parseCloudflareRadarOutages({ result: { annotations: [] } }), []);
});
