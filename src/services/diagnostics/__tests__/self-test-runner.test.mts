import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBuiltinSmokeTests,
  buildDomainSmokeTest,
  classifyFeedSnapshot,
  DOMAIN_TO_FEED_IDS,
  FRESH_MULT,
  STALE_MULT,
  TOP_PRIORITY_DOMAINS,
  probeDomain,
  runAllTests,
  runDomainTest,
  type DomainSmokeTest,
  type FeedFreshnessSnapshot,
  type SmokeTestOracle,
  type SmokeTestResult,
} from '../self-test-runner.ts';
import { FEED_CATALOG } from '../feed-catalog.ts';

import {
  DEFAULT_DEGRADED_FAIL_THRESHOLD,
  DEFAULT_REDUCED_WARN_THRESHOLD,
  getMissionState,
  MISSION_STATE_COLOR,
  MISSION_STATE_LABEL,
  MISSION_STATE_ORDER,
} from '../feed-health-mission-state.ts';

const NOW = 1_745_000_000_000;
const MIN = 60_000;

function makeOracle(
  snapshots: Record<string, FeedFreshnessSnapshot | null>,
  now: number = NOW,
): SmokeTestOracle {
  return {
    now: () => now,
    getFeedSnapshot: (feedId) => snapshots[feedId] ?? null,
  };
}

// ── classifyFeedSnapshot ─────────────────────────────────────────────────

test('classifyFeedSnapshot — null snap is fail', () => {
  const r = classifyFeedSnapshot('feed-x', null, NOW);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /not registered/);
});

test('classifyFeedSnapshot — hadError is fail', () => {
  const r = classifyFeedSnapshot('feed-x', {
    lastUpdateMs: NOW - 1000,
    pollIntervalMs: MIN,
    hadError: true,
    hasCachedPayload: false,
  }, NOW);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /upstream error/);
});

test('classifyFeedSnapshot — never loaded with no cache is fail', () => {
  const r = classifyFeedSnapshot('feed-x', {
    lastUpdateMs: null,
    pollIntervalMs: MIN,
    hadError: false,
    hasCachedPayload: false,
  }, NOW);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /never loaded/);
});

test('classifyFeedSnapshot — never loaded but has cache is warn', () => {
  const r = classifyFeedSnapshot('feed-x', {
    lastUpdateMs: null,
    pollIntervalMs: MIN,
    hadError: false,
    hasCachedPayload: true,
  }, NOW);
  assert.equal(r.verdict, 'warn');
  assert.match(r.reason, /cached payload/);
});

test('classifyFeedSnapshot — within FRESH_MULT is pass', () => {
  const snap: FeedFreshnessSnapshot = {
    lastUpdateMs: NOW - MIN * FRESH_MULT + 1,
    pollIntervalMs: MIN,
    hadError: false,
    hasCachedPayload: true,
  };
  const r = classifyFeedSnapshot('feed-x', snap, NOW);
  assert.equal(r.verdict, 'pass');
});

test('classifyFeedSnapshot — between FRESH_MULT and STALE_MULT is warn', () => {
  const snap: FeedFreshnessSnapshot = {
    lastUpdateMs: NOW - MIN * (FRESH_MULT + 1),
    pollIntervalMs: MIN,
    hadError: false,
    hasCachedPayload: true,
  };
  const r = classifyFeedSnapshot('feed-x', snap, NOW);
  assert.equal(r.verdict, 'warn');
  assert.match(r.reason, /stale/);
});

test('classifyFeedSnapshot — beyond STALE_MULT is fail', () => {
  const snap: FeedFreshnessSnapshot = {
    lastUpdateMs: NOW - MIN * (STALE_MULT + 1),
    pollIntervalMs: MIN,
    hadError: false,
    hasCachedPayload: true,
  };
  const r = classifyFeedSnapshot('feed-x', snap, NOW);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /very stale/);
});

// ── probeDomain ──────────────────────────────────────────────────────────

test('probeDomain — empty feedIds returns warn', () => {
  const oracle = makeOracle({});
  const r = probeDomain('unknown-domain', [], oracle);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /No backing feed configured/);
});

test('probeDomain — all-fresh feeds returns pass', () => {
  const oracle = makeOracle({
    'feed-a': { lastUpdateMs: NOW, pollIntervalMs: MIN, hadError: false, hasCachedPayload: true },
    'feed-b': { lastUpdateMs: NOW - MIN, pollIntervalMs: MIN, hadError: false, hasCachedPayload: true },
  });
  const r = probeDomain('test', ['feed-a', 'feed-b'], oracle);
  assert.equal(r.status, 'pass');
});

test('probeDomain — one failing feed wins over passing', () => {
  const oracle = makeOracle({
    'feed-a': { lastUpdateMs: NOW, pollIntervalMs: MIN, hadError: false, hasCachedPayload: true },
    'feed-b': { lastUpdateMs: null, pollIntervalMs: MIN, hadError: false, hasCachedPayload: false },
  });
  const r = probeDomain('test', ['feed-a', 'feed-b'], oracle);
  assert.equal(r.status, 'fail');
});

test('probeDomain — exposes per-feed details', () => {
  const oracle = makeOracle({
    'feed-a': { lastUpdateMs: NOW, pollIntervalMs: MIN, hadError: false, hasCachedPayload: true },
  });
  const r = probeDomain('test', ['feed-a'], oracle);
  const details = r.details as { feeds: Array<{ id: string; verdict: string }> };
  assert.equal(details.feeds.length, 1);
  assert.equal(details.feeds[0].id, 'feed-a');
  assert.equal(details.feeds[0].verdict, 'pass');
});

// ── runAllTests ──────────────────────────────────────────────────────────

test('runAllTests — produces SelfTestReport keyed by domain', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'a', name: 'A', test: () => Promise.resolve({ status: 'pass', message: 'ok', latencyMs: 10 }) },
    { domain: 'b', name: 'B', test: () => Promise.resolve({ status: 'fail', message: 'nope', latencyMs: 20 }) },
  ];
  const report = await runAllTests(tests);
  assert.equal(report.passed, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.warned, 0);
  assert.equal(report.results.a.status, 'pass');
  assert.equal(report.results.b.status, 'fail');
});

test('runAllTests — same-domain probes merge to worst outcome', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'x', name: 'X-1', test: () => Promise.resolve({ status: 'pass', message: 'ok', latencyMs: 5 }) },
    { domain: 'x', name: 'X-2', test: () => Promise.resolve({ status: 'warn', message: 'iffy', latencyMs: 5 }) },
    { domain: 'x', name: 'X-3', test: () => Promise.resolve({ status: 'pass', message: 'ok', latencyMs: 5 }) },
  ];
  const report = await runAllTests(tests);
  assert.equal(Object.keys(report.results).length, 1);
  assert.equal(report.results.x.status, 'warn');
});

test('runAllTests — thrown error becomes a fail SmokeTestResult', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'boom', name: 'Boom', test: () => Promise.reject(new Error('kaboom')) },
  ];
  const report = await runAllTests(tests);
  assert.equal(report.results.boom.status, 'fail');
  assert.match(report.results.boom.message, /kaboom/);
});

test('runAllTests — timeout becomes a fail SmokeTestResult', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'slow', name: 'Slow', test: () => new Promise<SmokeTestResult>(() => {}) },
  ];
  const report = await runAllTests(tests, { timeoutMs: 20 });
  assert.equal(report.results.slow.status, 'fail');
  assert.match(report.results.slow.message, /timed out/);
});

test('runAllTests — empty tests array produces empty report', async () => {
  const report = await runAllTests([]);
  assert.equal(report.passed, 0);
  assert.equal(report.warned, 0);
  assert.equal(report.failed, 0);
  assert.deepEqual(report.results, {});
});

test('runAllTests — duration is sane (>= 0)', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'a', name: 'A', test: () => Promise.resolve({ status: 'pass', message: 'ok', latencyMs: 1 }) },
  ];
  const report = await runAllTests(tests);
  assert.ok(report.duration >= 0);
});

// ── runDomainTest ────────────────────────────────────────────────────────

test('runDomainTest — runs only the named domain', async () => {
  const tests: DomainSmokeTest[] = [
    { domain: 'a', name: 'A', test: () => Promise.resolve({ status: 'pass', message: 'ok', latencyMs: 1 }) },
    { domain: 'b', name: 'B', test: () => Promise.reject(new Error('should not run')) },
  ];
  const result = await runDomainTest('a', tests);
  assert.equal(result.status, 'pass');
});

test('runDomainTest — unknown domain returns synthetic fail', async () => {
  const result = await runDomainTest('nope', []);
  assert.equal(result.status, 'fail');
  assert.match(result.message, /No smoke tests registered/);
});

// ── buildDomainSmokeTest / buildBuiltinSmokeTests ────────────────────────

test('buildDomainSmokeTest — wires oracle through to probeDomain', async () => {
  const oracle = makeOracle({
    'usgs-earthquakes': {
      lastUpdateMs: NOW,
      pollIntervalMs: MIN,
      hadError: false,
      hasCachedPayload: true,
    },
  });
  const def = buildDomainSmokeTest('earthquakes', oracle);
  const result = await def.test();
  assert.equal(result.status, 'pass');
});

test('DOMAIN_TO_FEED_IDS — every feed id resolves to FEED_CATALOG (no drift)', () => {
  // createLiveOracle resolves snapshots only for FEED_CATALOG ids, so a feed id
  // here that is NOT in the catalog makes that domain's smoke test fail
  // "not registered" forever — a false alarm, not a real outage. Catch drift.
  const catalogIds = new Set(FEED_CATALOG.map((f) => f.id));
  const drift: string[] = [];
  for (const [domain, ids] of Object.entries(DOMAIN_TO_FEED_IDS)) {
    for (const id of ids) if (!catalogIds.has(id)) drift.push(`${domain} → ${id}`);
  }
  assert.deepEqual(drift, [], `Drifted feed ids (not in FEED_CATALOG): ${drift.join(', ')}`);
});

test('buildBuiltinSmokeTests — covers every domain in DOMAIN_TO_FEED_IDS', () => {
  const tests = buildBuiltinSmokeTests(makeOracle({}));
  const domains = new Set(tests.map((t) => t.domain));
  for (const d of Object.keys(DOMAIN_TO_FEED_IDS)) assert.ok(domains.has(d), `domain ${d} missing`);
  assert.equal(tests.length, Object.keys(DOMAIN_TO_FEED_IDS).length);
});

test('buildBuiltinSmokeTests — includes the top-priority domains', () => {
  const tests = buildBuiltinSmokeTests(makeOracle({}));
  const domains = new Set(tests.map((t) => t.domain));
  for (const d of TOP_PRIORITY_DOMAINS) assert.ok(domains.has(d), `top-priority domain ${d} missing`);
});

// ── getMissionState ──────────────────────────────────────────────────────

test('getMissionState — empty report is nominal', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 0, warned: 0, failed: 0, results: {},
  });
  assert.equal(state, 'nominal');
});

test('getMissionState — all pass is nominal', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 3, warned: 0, failed: 0,
    results: {
      a: { status: 'pass', message: '', latencyMs: 1 },
      b: { status: 'pass', message: '', latencyMs: 1 },
      c: { status: 'pass', message: '', latencyMs: 1 },
    },
  });
  assert.equal(state, 'nominal');
});

test('getMissionState — top-priority fail forces critical', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 9, warned: 0, failed: 1,
    results: {
      earthquakes: { status: 'fail', message: 'down', latencyMs: 1 },
      weather: { status: 'pass', message: '', latencyMs: 1 },
      nuclear: { status: 'pass', message: '', latencyMs: 1 },
      a: { status: 'pass', message: '', latencyMs: 1 },
      b: { status: 'pass', message: '', latencyMs: 1 },
      c: { status: 'pass', message: '', latencyMs: 1 },
      d: { status: 'pass', message: '', latencyMs: 1 },
      e: { status: 'pass', message: '', latencyMs: 1 },
      f: { status: 'pass', message: '', latencyMs: 1 },
      g: { status: 'pass', message: '', latencyMs: 1 },
    },
  });
  assert.equal(state, 'critical');
});

test('getMissionState — top-priority warn does not force critical', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 2, warned: 1, failed: 0,
    results: {
      earthquakes: { status: 'warn', message: 'stale', latencyMs: 1 },
      weather: { status: 'pass', message: '', latencyMs: 1 },
      nuclear: { status: 'pass', message: '', latencyMs: 1 },
    },
  });
  assert.notEqual(state, 'critical');
});

test('getMissionState — >50% failed flips to degraded', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 1, warned: 0, failed: 3,
    results: {
      a: { status: 'pass', message: '', latencyMs: 1 },
      b: { status: 'fail', message: '', latencyMs: 1 },
      c: { status: 'fail', message: '', latencyMs: 1 },
      d: { status: 'fail', message: '', latencyMs: 1 },
    },
  });
  assert.equal(state, 'degraded');
});

test('getMissionState — >25% warned flips to reduced', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 2, warned: 2, failed: 0,
    results: {
      a: { status: 'pass', message: '', latencyMs: 1 },
      b: { status: 'pass', message: '', latencyMs: 1 },
      c: { status: 'warn', message: '', latencyMs: 1 },
      d: { status: 'warn', message: '', latencyMs: 1 },
    },
  });
  assert.equal(state, 'reduced');
});

test('getMissionState — single fail (sub-threshold) still flips to reduced', () => {
  const state = getMissionState({
    runAt: NOW, duration: 0, passed: 4, warned: 0, failed: 1,
    results: {
      a: { status: 'pass', message: '', latencyMs: 1 },
      b: { status: 'pass', message: '', latencyMs: 1 },
      c: { status: 'pass', message: '', latencyMs: 1 },
      d: { status: 'pass', message: '', latencyMs: 1 },
      e: { status: 'fail', message: '', latencyMs: 1 },
    },
  });
  assert.equal(state, 'reduced');
});

test('getMissionState — custom thresholds honored', () => {
  const state = getMissionState(
    {
      runAt: NOW, duration: 0, passed: 1, warned: 0, failed: 2,
      results: {
        a: { status: 'pass', message: '', latencyMs: 1 },
        b: { status: 'fail', message: '', latencyMs: 1 },
        c: { status: 'fail', message: '', latencyMs: 1 },
      },
    },
    { degradedFailThreshold: 0.9 },
  );
  assert.equal(state, 'reduced');
});

test('getMissionState — custom top-priority list honored', () => {
  const state = getMissionState(
    {
      runAt: NOW, duration: 0, passed: 2, warned: 0, failed: 1,
      results: {
        sanctions: { status: 'fail', message: '', latencyMs: 1 },
        earthquakes: { status: 'pass', message: '', latencyMs: 1 },
        weather: { status: 'pass', message: '', latencyMs: 1 },
      },
    },
    { topPriorityDomains: ['sanctions'] },
  );
  assert.equal(state, 'critical');
});

// ── Mission state constants ──────────────────────────────────────────────

test('MISSION_STATE_LABEL has all 4 states', () => {
  assert.equal(MISSION_STATE_LABEL.nominal, 'Nominal');
  assert.equal(MISSION_STATE_LABEL.reduced, 'Reduced Capability');
  assert.equal(MISSION_STATE_LABEL.degraded, 'Degraded');
  assert.equal(MISSION_STATE_LABEL.critical, 'Critical');
});

test('MISSION_STATE_COLOR has all 4 states + valid hex', () => {
  for (const k of MISSION_STATE_ORDER) {
    assert.match(MISSION_STATE_COLOR[k], /^#[0-9a-f]{6}$/i);
  }
});

test('MISSION_STATE_ORDER is healthiest → worst', () => {
  assert.deepEqual(MISSION_STATE_ORDER, ['nominal', 'reduced', 'degraded', 'critical']);
});

test('thresholds defaults match documented values', () => {
  assert.equal(DEFAULT_DEGRADED_FAIL_THRESHOLD, 0.5);
  assert.equal(DEFAULT_REDUCED_WARN_THRESHOLD, 0.25);
});
