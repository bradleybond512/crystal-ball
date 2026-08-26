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
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

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
  mergeInfrastructureBgpPages,
  fetchInfrastructureBgpCompletePayload,
  createLocalApiServer,
  _resetSidecarCacheForTests,
  _resetFeedTracker,
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
const DOCUMENTATION_TEST_PREFIX = `${[1, 1, 1, 0].join('.')}/24`;

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

function cloudflareBgpPage(pageNumber, events, totalCount, overrides = {}) {
  return {
    success: true,
    result: { events },
    result_info: {
      page: pageNumber,
      per_page: 100,
      count: events.length,
      total_count: totalCount,
      ...overrides,
    },
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
      prefixes: [DOCUMENTATION_TEST_PREFIX],
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
  assert.match(route, /if \(result\.coverage !== 'reported'\) \{[\s\S]+return \{ body: result, status: 502 \};[\s\S]+\}/);
  assert.ok(route.indexOf("result.coverage !== 'reported'") < route.indexOf('setCached(cacheKey'));
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

test('BGP sidecar merges and normalizes every complete bounded Cloudflare page', () => {
  const fetchedAt = Date.parse('2026-08-14T14:00:00Z');
  const firstEvents = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
  const secondEvents = [
    ...Array.from({ length: 52 }, (_, index) => cloudflareBgpEvent(index + 101)),
    cloudflareBgpEvent(153, { on_going_count: undefined }),
  ];
  const merged = mergeInfrastructureBgpPages([
    {
      success: true,
      result: { events: firstEvents },
      result_info: { page: 1, per_page: 100, count: 100, total_count: 153 },
    },
    {
      success: true,
      result: { events: secondEvents },
      result_info: { page: 2, per_page: 100, count: 53, total_count: 153 },
    },
  ]);

  assert.equal(merged.error, null);
  assert.equal(merged.payload.result.events.length, 153);
  assert.deepEqual(merged.payload.result_info, {
    page: 1, per_page: 500, count: 153, total_count: 153, total_pages: 1,
  });
  const normalized = normalizeInfrastructureBgpPayload(merged.payload, fetchedAt, 500);
  assert.equal(normalized.coverage, 'reported');
  assert.equal(normalized.acceptedRows, 152);
  assert.equal(normalized.droppedRows, 1, 'an invalid page-two row must count as dropped');
  assert.equal(normalized.events.length, 152);
  assert.equal(normalized.events.at(-1)?.id, '1152', 'a valid event from page two must reach the route envelope');
});

test('BGP sidecar rejects inconsistent pages, duplicate IDs, and results beyond the five-page bound', () => {
  const first = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
  const second = [cloudflareBgpEvent(101)];

  assert.equal(mergeInfrastructureBgpPages([
    cloudflareBgpPage(1, first, 101), cloudflareBgpPage(2, second, 102),
  ]).error, 'inconsistent_pagination');
  assert.equal(mergeInfrastructureBgpPages([
    cloudflareBgpPage(1, first, 101), cloudflareBgpPage(2, [cloudflareBgpEvent(1)], 101),
  ]).error, 'duplicate_event');
  assert.equal(mergeInfrastructureBgpPages([
    cloudflareBgpPage(1, first, 501),
  ]).error, 'result_too_large');
  assert.equal(mergeInfrastructureBgpPages([
    cloudflareBgpPage(1, first, 101), cloudflareBgpPage(2, second, 101, { count: 2 }),
  ]).error, 'inconsistent_pagination');
});

test('BGP sidecar fetches page one before at most four required pages within one decreasing budget', async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  let clock = 1000;
  const first = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
  const requestPage = async (page, timeoutMs) => {
    calls.push({ page, timeoutMs });
    clock += 100;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active -= 1;
    const totalCount = 500;
    const events = page === 1
      ? first
      : Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent((page - 1) * 100 + index + 1));
    return {
      success: true,
      result: { events },
      result_info: { page, per_page: 100, count: 100, total_count: totalCount },
    };
  };

  const result = await fetchInfrastructureBgpCompletePayload(requestPage, () => clock);
  assert.equal(result.error, null);
  assert.deepEqual(calls.map(({ page }) => page), [1, 2, 3, 4, 5]);
  assert.ok(calls.every(({ timeoutMs }) => timeoutMs > 0 && timeoutMs <= 15_000));
  assert.deepEqual(calls.map(({ timeoutMs }) => timeoutMs), [15_000, 14_900, 14_800, 14_700, 14_600]);
  assert.equal(maximumActive, 4);
  assert.equal(result.payload.result.events.length, 500);
});

test('BGP sidecar reports sanitized malformed, timeout, rate-limit, and partial-fetch failures', async () => {
  const malformed = await fetchInfrastructureBgpCompletePayload(async () => ({ success: true, result: {} }));
  assert.equal(malformed.error, 'malformed_response');

  const timeout = await fetchInfrastructureBgpCompletePayload(
    async () => { throw new Error('Request timed out'); },
  );
  assert.equal(timeout.error, 'timeout');

  const rateLimited = await fetchInfrastructureBgpCompletePayload(
    async () => { throw Object.assign(new Error('secret provider body'), { code: 'rate_limited' }); },
  );
  assert.equal(rateLimited.error, 'rate_limited');

  let calls = 0;
  const partial = await fetchInfrastructureBgpCompletePayload(async (page) => {
    calls += 1;
    if (page === 2) throw Object.assign(new Error('provider detail'), { code: 'http_error' });
    const events = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
    return {
      success: true,
      result: { events },
      result_info: { page: 1, per_page: 100, count: 100, total_count: 101 },
    };
  });
  assert.equal(calls, 2);
  assert.equal(partial.error, 'http_error');
  assert.equal(partial.payload, null);
});

test('BGP sidecar retries one transient page failure within the shared budget', async () => {
  let attempts = 0;
  let clock = 5000;
  const budgets = [];
  const result = await fetchInfrastructureBgpCompletePayload(async (page, timeoutMs) => {
    attempts += 1;
    budgets.push(timeoutMs);
    if (attempts === 1) {
      clock += 14_999;
      throw Object.assign(new Error('temporary upstream failure'), { code: 'transient_http' });
    }
    return {
      success: true,
      result: { events: [] },
      result_info: { page, per_page: 100, count: 0, total_count: 0 },
    };
  }, () => clock);
  assert.equal(attempts, 2);
  assert.deepEqual(budgets, [15_000, 1]);
  assert.equal(result.error, null);
  assert.equal(result.payload.result.events.length, 0);
});

test('BGP sidecar refuses a retry after the shared deadline is exhausted', async () => {
  let attempts = 0;
  let clock = 10_000;
  const result = await fetchInfrastructureBgpCompletePayload(async () => {
    attempts += 1;
    clock += 15_000;
    throw Object.assign(new Error('temporary upstream failure'), { code: 'transient_http' });
  }, () => clock);
  assert.equal(attempts, 1);
  assert.equal(result.error, 'timeout');
  assert.equal(result.payload, null);
});

test('BGP sidecar aborts and settles sibling page work after an early fanout failure', async () => {
  const first = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
  let active = 0;
  let settled = 0;
  let aborted = 0;
  const result = await fetchInfrastructureBgpCompletePayload(async (page, _timeoutMs, signal) => {
    if (page === 1) {
      return cloudflareBgpPage(1, first, 500);
    }
    active += 1;
    try {
      if (page === 2) throw Object.assign(new Error('upstream 400'), { code: 'http_error' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          aborted += 1;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      return cloudflareBgpPage(page, Array.from(
        { length: 100 },
        (_, index) => cloudflareBgpEvent((page - 1) * 100 + index + 1),
      ), 500);
    } finally {
      active -= 1;
      settled += 1;
    }
  });

  assert.equal(result.error, 'http_error');
  assert.equal(active, 0, 'the helper must not return while sibling requests remain active');
  assert.equal(settled, 4);
  assert.equal(aborted, 3);
});

test('BGP sidecar retries only allowlisted transient failures and never retries oversized bodies', async () => {
  for (const code of ['transient_http', 'rate_limited', 'ECONNRESET']) {
    let attempts = 0;
    const result = await fetchInfrastructureBgpCompletePayload(async (page) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('sanitized transient failure'), { code });
      return cloudflareBgpPage(page, [], 0);
    });
    assert.equal(result.error, null, `${code} should receive one bounded retry`);
    assert.equal(attempts, 2, `${code} should be attempted exactly twice`);
  }

  for (const code of ['result_too_large', 'http_error', 'malformed_response', 'EACCES']) {
    let attempts = 0;
    const result = await fetchInfrastructureBgpCompletePayload(async () => {
      attempts += 1;
      throw Object.assign(new Error('secret upstream detail'), { code });
    });
    assert.equal(attempts, 1, `${code} must never be retried`);
    assert.equal(result.error, code === 'EACCES' ? 'provider_unavailable' : code);
  }
});

test('BGP sidecar route uses bounded complete retrieval and preserves fail-closed cache ordering', () => {
  const start = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/bgp'");
  const end = sidecarSource.indexOf("requestUrl.pathname === '/api/infrastructure/radiation'", start);
  const route = sidecarSource.slice(start, end);
  assert.match(route, /fetchInfrastructureBgpCompletePayload/);
  assert.match(route, /per_page=\$\{INFRASTRUCTURE_BGP_PER_PAGE\}/);
  assert.match(route, /maxResponseBytes: INFRASTRUCTURE_BGP_MAX_RESPONSE_BYTES/);
  assert.match(route, /recordFeedFailure\('cloudflare-bgp', fetched\.error\)/);
  assert.match(route, /recordFeedFailure\('cloudflare-bgp', result\.error/);
  assert.match(route, /recordFeedSuccess\('cloudflare-bgp'/);
  assert.ok(route.indexOf("result.coverage !== 'reported'") < route.indexOf('setCached(cacheKey'));
  assert.ok(route.indexOf("result.coverage !== 'reported'") < route.indexOf("recordFeedSuccess('cloudflare-bgp'"));
  assert.ok(route.indexOf("recordFeedSuccess('cloudflare-bgp'") < route.indexOf('setCached(cacheKey'));
});

function mockCloudflareBgpHttps(pages) {
  const original = https.request;
  const requests = [];
  https.request = (options, onResponse) => {
    const requestedUrl = new URL(`https://${options.hostname}${options.path}`);
    const page = Number(requestedUrl.searchParams.get('page'));
    requests.push({ hostname: options.hostname, path: options.path, page });
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.end = () => {
      queueMicrotask(() => {
        const payload = pages.get(page);
        const body = JSON.stringify(payload ?? { success: false, errors: [{ code: 404 }] });
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = payload ? 200 : 404;
        response.statusMessage = '';
        response.headers = {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        };
        onResponse(response);
      });
    };
    return req;
  };
  return {
    requests,
    restore() { https.request = original; },
  };
}

function mockCloudflareBgpHttpsHandler(handler) {
  const original = https.request;
  const requests = [];
  let active = 0;
  let maximumActive = 0;
  https.request = (options, onResponse) => {
    const requestedUrl = new URL(`https://${options.hostname}${options.path}`);
    const page = Number(requestedUrl.searchParams.get('page'));
    const record = { hostname: options.hostname, path: options.path, page, headers: options.headers };
    requests.push(record);
    const req = new PassThrough();
    let destroyed = false;
    req.setTimeout = () => req;
    req.destroy = (error) => {
      if (destroyed) return req;
      destroyed = true;
      queueMicrotask(() => req.emit('error', error ?? new Error('request destroyed')));
      return req;
    };
    req.end = () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      Promise.resolve(handler(record)).then(({ status = 200, body, headers = {} }) => {
        if (destroyed) return;
        const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const response = Readable.from([bytes]);
        response.statusCode = status;
        response.statusMessage = '';
        response.headers = {
          'content-type': 'application/json',
          'content-length': String(bytes.length),
          ...headers,
        };
        onResponse(response);
      }).catch((error) => req.emit('error', error)).finally(() => { active -= 1; });
    };
    return req;
  };
  return {
    requests,
    get maximumActive() { return maximumActive; },
    restore() { https.request = original; },
  };
}

async function startBgpRouteServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'crystalball-bgp-route-'));
  const app = await createLocalApiServer({
    port: 0,
    apiDir: path.resolve('api'),
    dataDir,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return {
    port,
    async close() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test('BGP HTTP route enforces auth and reports a missing key through both health surfaces', async () => {
  const originalToken = process.env.LOCAL_API_TOKEN;
  const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'test-token-bgp-route';
  delete process.env.CLOUDFLARE_API_TOKEN;
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  const server = await startBgpRouteServer();
  const origin = 'https://crystalball.app';
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, {
      headers: { Origin: origin },
    });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: 'Unauthorized' });
    assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin);

    const missing = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, {
      headers: { Authorization: 'Bearer test-token-bgp-route', Origin: origin },
    });
    assert.equal(missing.status, 503);
    assert.equal(missing.headers.get('access-control-allow-origin'), origin);
    const missingBody = await missing.json();
    assert.deepEqual({ ...missingBody, fetchedAt: 0 }, {
      schemaVersion: 1,
      provider: 'cloudflare-radar',
      coverage: 'unknown',
      events: [],
      acceptedRows: 0,
      droppedRows: 0,
      error: 'missing_key',
      keyMissing: true,
      fetchedAt: 0,
    });
    assert.ok(Number.isSafeInteger(missingBody.fetchedAt) && missingBody.fetchedAt > 0);

    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.feeds.find((feed) => feed.key === 'cloudflare-bgp')?.lastError, 'missing_key');

    const feeds = await fetch(`http://127.0.0.1:${server.port}/api/feeds/health`, {
      headers: { Authorization: 'Bearer test-token-bgp-route' },
    });
    const feedsBody = await feeds.json();
    assert.equal(feedsBody.feeds.find((feed) => feed.feedId === 'cloudflare-bgp')?.status, 'down');
  } finally {
    await server.close();
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
  }
});

test('BGP HTTP route retrieves two complete pages once, caches only normalized success, and reports health', async () => {
  const originalToken = process.env.LOCAL_API_TOKEN;
  const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'test-token-bgp-route-success';
  process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-secret';
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  const first = Array.from({ length: 100 }, (_, index) => cloudflareBgpEvent(index + 1));
  const second = [cloudflareBgpEvent(101)];
  const mock = mockCloudflareBgpHttps(new Map([
    [1, { success: true, result: { events: first }, result_info: { page: 1, per_page: 100, count: 100, total_count: 101 } }],
    [2, { success: true, result: { events: second }, result_info: { page: 2, per_page: 100, count: 1, total_count: 101 } }],
  ]));
  const server = await startBgpRouteServer();
  const headers = { Authorization: 'Bearer test-token-bgp-route-success', Origin: 'https://crystalball.app' };
  try {
    const firstResponse = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    assert.equal(firstResponse.status, 200);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.coverage, 'reported');
    assert.equal(firstBody.acceptedRows, 101);
    assert.equal(firstBody.droppedRows, 0);
    assert.equal(firstBody.events.length, 101);
    assert.equal(firstBody.events.at(-1)?.id, '1101', 'the page-two event must survive HTTP normalization');
    assert.deepEqual(mock.requests.map(({ page }) => page), [1, 2]);
    assert.ok(mock.requests.every(({ hostname }) => hostname === 'api.cloudflare.com'));

    const cachedResponse = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    assert.equal(cachedResponse.status, 200);
    assert.deepEqual(await cachedResponse.json(), firstBody);
    assert.equal(mock.requests.length, 2, 'cached response must not refetch either upstream page');

    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    const healthBody = await health.json();
    const snapshot = healthBody.feeds.find((feed) => feed.key === 'cloudflare-bgp');
    assert.equal(snapshot.lastError, null);
    assert.equal(snapshot.lastSuccessAt, firstBody.fetchedAt);

    const feeds = await fetch(`http://127.0.0.1:${server.port}/api/feeds/health`, {
      headers: { Authorization: 'Bearer test-token-bgp-route-success' },
    });
    const feedsBody = await feeds.json();
    assert.equal(feedsBody.feeds.find((feed) => feed.feedId === 'cloudflare-bgp')?.status, 'up');
  } finally {
    mock.restore();
    await server.close();
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
  }
});

test('BGP HTTP route coalesces concurrent cold requests into one bounded page fanout', async () => {
  const originalToken = process.env.LOCAL_API_TOKEN;
  const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'test-token-bgp-coalescing';
  process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-coalescing-secret';
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  const mock = mockCloudflareBgpHttpsHandler(async ({ page }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      body: cloudflareBgpPage(page, Array.from(
        { length: 100 },
        (_, index) => cloudflareBgpEvent((page - 1) * 100 + index + 1),
      ), 500),
    };
  });
  const server = await startBgpRouteServer();
  const headers = { Authorization: 'Bearer test-token-bgp-coalescing' };
  try {
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers }),
      fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers }),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal(bodies[0].events.length, 500);
    assert.deepEqual(mock.requests.map(({ page }) => page).sort(), [1, 2, 3, 4, 5]);
    assert.ok(mock.maximumActive <= 4, `maximum active upstream requests was ${mock.maximumActive}`);
  } finally {
    mock.restore();
    await server.close();
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
  }
});

test('BGP HTTP route invalidates and aborts an old credential generation on rotation and deletion', async () => {
  const originalToken = process.env.LOCAL_API_TOKEN;
  const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'test-token-bgp-generation';
  process.env.CLOUDFLARE_API_TOKEN = 'old-cloudflare-generation-secret';
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  let releaseOld;
  const oldStarted = new Promise((resolve) => { releaseOld = resolve; });
  let releaseDeleting;
  const deletingStarted = new Promise((resolve) => { releaseDeleting = resolve; });
  let newGenerationRequests = 0;
  const mock = mockCloudflareBgpHttpsHandler(async ({ page, headers }) => {
    const authorization = headers.Authorization ?? headers.authorization;
    if (authorization === 'Bearer old-cloudflare-generation-secret') {
      releaseOld();
      await new Promise((resolve) => setTimeout(resolve, 60_000).unref());
    }
    if (authorization === 'Bearer new-cloudflare-generation-secret') {
      newGenerationRequests += 1;
      if (newGenerationRequests === 2) {
        releaseDeleting();
        await new Promise((resolve) => setTimeout(resolve, 60_000).unref());
      }
    }
    return { body: cloudflareBgpPage(page, [cloudflareBgpEvent(page)], 1, { count: 1 }) };
  });
  const server = await startBgpRouteServer();
  const headers = {
    Authorization: 'Bearer test-token-bgp-generation',
    'Content-Type': 'application/json',
  };
  try {
    const oldRequest = fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    await oldStarted;
    const rotated = await fetch(`http://127.0.0.1:${server.port}/api/local-env-update`, {
      method: 'POST', headers, body: JSON.stringify({ key: 'CLOUDFLARE_API_TOKEN', value: 'new-cloudflare-generation-secret' }),
    });
    assert.equal(rotated.status, 200);
    const oldResponse = await oldRequest;
    assert.equal(oldResponse.status, 503);

    const fresh = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    assert.equal(fresh.status, 200);
    const freshBody = await fresh.json();
    assert.equal(freshBody.coverage, 'reported');
    assert.equal(mock.requests.filter(({ headers: upstreamHeaders }) =>
      (upstreamHeaders.Authorization ?? upstreamHeaders.authorization) === 'Bearer new-cloudflare-generation-secret').length, 1);

    _resetSidecarCacheForTests();
    const deletingRequest = fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    await deletingStarted;
    await fetch(`http://127.0.0.1:${server.port}/api/local-env-update`, {
      method: 'POST', headers, body: JSON.stringify({ key: 'CLOUDFLARE_API_TOKEN', value: '' }),
    });
    const deletedResponse = await deletingRequest;
    assert.equal(deletedResponse.status, 503);
    const missing = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, { headers });
    assert.equal(missing.status, 503);
    const missingBody = await missing.json();
    assert.equal(missingBody.error, 'missing_key');
    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.feeds.find((feed) => feed.key === 'cloudflare-bgp')?.lastError, 'missing_key');
  } finally {
    mock.restore();
    await server.close();
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
  }
});

test('BGP HTTP route attempts an oversized upstream body once and returns result_too_large', async () => {
  const originalToken = process.env.LOCAL_API_TOKEN;
  const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'test-token-bgp-size';
  process.env.CLOUDFLARE_API_TOKEN = 'test-cloudflare-size-secret';
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  const mock = mockCloudflareBgpHttpsHandler(async () => ({
    body: '{}',
    headers: { 'content-length': String((2 * 1024 * 1024) + 1) },
  }));
  const server = await startBgpRouteServer();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/infrastructure/bgp`, {
      headers: { Authorization: 'Bearer test-token-bgp-size' },
    });
    assert.equal(response.status, 502);
    const responseBody = await response.json();
    assert.equal(responseBody.error, 'result_too_large');
    assert.equal(mock.requests.length, 1);
  } finally {
    mock.restore();
    await server.close();
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
  }
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

function usgsLatestRow(time) {
  return {
    type: 'Feature', id: 'secret-id', geometry: { type: 'Point', coordinates: [-86.5, 41.5] },
    properties: {
      monitoring_location_id: 'USGS-X', parameter_code: '00400', value: '7.2',
      unit_of_measure: 'std units', secret: 'drop', ...(time ? { time } : {}),
    },
  };
}

test('USGS sidecar requires a recent source timestamp and emits only safe fields', () => {
  const bbox = '-87.000000,41.000000,-86.000000,42.000000';
  const now = Date.parse('2026-08-14T21:00:00Z');
  const locations = new Map([['USGS-X', 'Example stream']]);
  for (const time of [undefined, 'bad', '2026-08-14T20:00:00', '2026-08-14', '2026-08-12T20:00:00Z', '2026-08-16T20:00:00Z']) {
    assert.equal(normalizeUsgsLatestContinuousSidecar({
      type: 'FeatureCollection', features: [usgsLatestRow(time)],
    }, bbox, locations, now), null);
  }
  assert.equal(normalizeUsgsLatestContinuousSidecar({
    type: 'FeatureCollection', features: [usgsLatestRow('2026-02-30T20:30:00Z')],
  }, bbox, locations, Date.parse('2026-03-02T21:00:00Z')), null,
  'calendar-invalid civil dates must fail closed before Date.parse normalizes them');
  const normalized = normalizeUsgsLatestContinuousSidecar({
    type: 'FeatureCollection', features: [usgsLatestRow('2026-08-14T20:30:00Z')],
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
