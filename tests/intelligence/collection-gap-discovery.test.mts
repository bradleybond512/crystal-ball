/**
 * Tests for CollectionGapDiscoveryService — the six-detector
 * observability audit.
 *
 * Pure service tests. Stubs localStorage at module load and uses
 * the injectable clock so detector thresholds (stale 30m/2h/6h,
 * sparse 24h, blind-spot 12h, temporal 4h) stay deterministic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  CollectionGapDiscoveryService,
  __internals,
  __resetCollectionGapDiscoverySingleton,
  getCollectionGapDiscoveryService,
  type GapType,
  type ObservabilityGap,
} from '../../src/services/intelligence/collection-gap-discovery.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60 * 1000;

function makeObs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    sourceId: 'src-a',
    domain: 'weather',
    timestamp: NOW,
    severity: 'MEDIUM' as ObservationSeverity,
    title: 'fixture',
    raw: null,
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function freshService(
  opts: ConstructorParameters<typeof CollectionGapDiscoveryService>[0] = {},
): CollectionGapDiscoveryService {
  __storage.clear();
  return new CollectionGapDiscoveryService({ clock: () => NOW, ...opts });
}

function gapsOfType(gaps: readonly ObservabilityGap[], type: GapType): ObservabilityGap[] {
  return gaps.filter((g) => g.gapType === type);
}

// Fully-covered cluster: 5 sources, recent timestamps, every domain,
// every high-risk region. Used as a "no gaps expected" baseline.
function buildFullCoverage(): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const domains = __internals.TRACKED_DOMAINS;
  const sources = ['s1', 's2', 's3', 's4', 's5'];
  const regions = [
    { lat: 30, lon: 100, name: 'Asia-Pacific' },
    { lat: 50, lon: 10, name: 'Europe' },
    { lat: 0, lon: -60, name: 'Americas' },
    { lat: 0, lon: 20, name: 'Africa' },
    { lat: 30, lon: 40, name: 'Middle-East' },
  ];
  // 5 observations per domain, recent + within multi-source threshold
  for (const domain of domains) {
    for (let i = 0; i < 5; i += 1) {
      events.push(makeObs({
        id: `${domain}-${i}`,
        domain,
        sourceId: sources[i]!,
        severity: 'HIGH' as ObservationSeverity,
        timestamp: NOW - i * 5 * 60 * 1000,
        location: regions[i % regions.length]!,
      }));
    }
  }
  return events;
}

// ── Stale-feed detector ──────────────────────────────────────────────

test('stale-feed: critical when last observation is > 6h old', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const stale = gapsOfType(report.gaps, 'stale-feed').find((g) => g.domain === 'weather');
  assert.ok(stale);
  assert.equal(stale!.severity, 'critical');
});

test('stale-feed: moderate when last observation is between 2h and 6h', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'cyber', timestamp: NOW - 4 * HOUR })]);
  const stale = gapsOfType(report.gaps, 'stale-feed').find((g) => g.domain === 'cyber');
  assert.ok(stale);
  assert.equal(stale!.severity, 'moderate');
});

test('stale-feed: minor when last observation is between 30m and 2h', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'finance', timestamp: NOW - 60 * 60 * 1000 })]);
  const stale = gapsOfType(report.gaps, 'stale-feed').find((g) => g.domain === 'finance');
  assert.ok(stale);
  assert.equal(stale!.severity, 'minor');
});

test('stale-feed: no gap when last observation is fresher than 30m', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 5 * 60 * 1000 })]);
  assert.equal(gapsOfType(report.gaps, 'stale-feed').length, 0);
});

// ── Sparse-coverage detector ─────────────────────────────────────────

test('sparse-coverage: critical when a tracked domain has zero observations in the last 24h', () => {
  const svc = freshService();
  // Only weather present; the other 9 domains should each be flagged sparse.
  const report = svc.scan([makeObs({ id: 'w', domain: 'weather' })]);
  const sparse = gapsOfType(report.gaps, 'sparse-coverage');
  assert.ok(sparse.some((g) => g.domain === 'cyber' && g.severity === 'critical'));
});

test('sparse-coverage: moderate when a tracked domain has 1 or 2 observations in 24h', () => {
  const svc = freshService();
  // 2 cyber obs satisfies sparse-moderate but stays below the 3-obs floor.
  const report = svc.scan([
    makeObs({ id: 'c1', domain: 'cyber' }),
    makeObs({ id: 'c2', domain: 'cyber' }),
  ]);
  const cyber = gapsOfType(report.gaps, 'sparse-coverage').find((g) => g.domain === 'cyber');
  assert.ok(cyber);
  assert.equal(cyber!.severity, 'moderate');
});

test('sparse-coverage: no gap when a domain has ≥ 3 observations', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 60_000 }),
    makeObs({ id: 'b', domain: 'weather', timestamp: NOW - 120_000 }),
    makeObs({ id: 'c', domain: 'weather', timestamp: NOW - 180_000 }),
  ];
  const report = svc.scan(obs);
  const weatherSparse = gapsOfType(report.gaps, 'sparse-coverage').find((g) => g.domain === 'weather');
  assert.equal(weatherSparse, undefined);
});

// ── Low-confidence detector ──────────────────────────────────────────

test('low-confidence: critical when domain average severity-confidence is < 0.4', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'cyber', severity: 'INFO' as ObservationSeverity }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'INFO' as ObservationSeverity }),
  ];
  const report = svc.scan(obs);
  const low = gapsOfType(report.gaps, 'low-confidence').find((g) => g.domain === 'cyber');
  assert.ok(low);
  assert.equal(low!.severity, 'critical');
});

test('low-confidence: moderate when average lands in [0.4, 0.6)', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'cyber', severity: 'LOW' as ObservationSeverity }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'LOW' as ObservationSeverity }),
  ];
  const report = svc.scan(obs);
  const low = gapsOfType(report.gaps, 'low-confidence').find((g) => g.domain === 'cyber');
  assert.ok(low);
  assert.equal(low!.severity, 'moderate');
});

test('low-confidence: no gap when average is ≥ 0.6', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'cyber', severity: 'HIGH' as ObservationSeverity }),
    makeObs({ id: 'b', domain: 'cyber', severity: 'HIGH' as ObservationSeverity }),
  ];
  const report = svc.scan(obs);
  assert.equal(gapsOfType(report.gaps, 'low-confidence').filter((g) => g.domain === 'cyber').length, 0);
});

// ── Geographic-blind-spot detector ───────────────────────────────────

test('geographic-blind-spot: every uncovered region produces a critical gap', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'weather', location: { lat: 30, lon: 100 } }),
  ];
  const report = svc.scan(obs);
  const blind = gapsOfType(report.gaps, 'geographic-blind-spot');
  // Asia-Pacific is covered; the remaining 4 regions should be flagged.
  assert.equal(blind.length, 4);
  for (const gap of blind) {
    assert.equal(gap.severity, 'critical');
    assert.equal(gap.affectedRegions.length, 1);
  }
});

test('geographic-blind-spot: high-risk-only — non-risk domains are ignored', () => {
  const svc = freshService();
  // 'travel' is not a high-risk domain — should NOT cover Europe.
  const report = svc.scan([
    makeObs({ id: 'a', domain: 'travel', location: { lat: 50, lon: 10 } }),
  ]);
  const blind = gapsOfType(report.gaps, 'geographic-blind-spot').map((g) => g.affectedRegions[0]);
  assert.ok(blind.includes('Europe'));
});

test('geographic-blind-spot: stale (> 12h) observations do not count as coverage', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 13 * HOUR, location: { lat: 50, lon: 10 } }),
  ];
  const report = svc.scan(obs);
  const blind = gapsOfType(report.gaps, 'geographic-blind-spot').map((g) => g.affectedRegions[0]);
  assert.ok(blind.includes('Europe'));
});

test('inRegion: handles Asia-Pacific antimeridian split (lon=170 + lon=-150)', () => {
  const region = __internals.MAJOR_REGIONS.find((r) => r.name === 'Asia-Pacific')!;
  assert.equal(__internals.inRegion(20, 170, region), true);
  assert.equal(__internals.inRegion(20, -150, region), true);
});

// ── Temporal-gap detector ───────────────────────────────────────────

test('temporal-gap: only applies to continuous-coverage domains', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'finance', timestamp: NOW - 10 * HOUR }),
    makeObs({ id: 'b', domain: 'finance', timestamp: NOW }),
  ];
  const report = svc.scan(obs);
  // Finance isn't in CONTINUOUS_COVERAGE_DOMAINS — no temporal gap.
  assert.equal(gapsOfType(report.gaps, 'temporal-gap').length, 0);
});

test('temporal-gap: 5h gap in a continuous-coverage domain flags moderate', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 6 * HOUR }),
    makeObs({ id: 'b', domain: 'weather', timestamp: NOW - 60_000 }),
  ];
  const report = svc.scan(obs);
  const tg = gapsOfType(report.gaps, 'temporal-gap').find((g) => g.domain === 'weather');
  assert.ok(tg);
  assert.equal(tg!.severity, 'moderate');
});

test('temporal-gap: < 4h gap produces nothing', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 3 * HOUR }),
    makeObs({ id: 'b', domain: 'weather', timestamp: NOW - 60_000 }),
  ];
  const report = svc.scan(obs);
  assert.equal(gapsOfType(report.gaps, 'temporal-gap').length, 0);
});

// ── Missing-source detector ──────────────────────────────────────────

test('missing-source: domain with a single source flagged moderate', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'cyber', sourceId: 'only-one' }),
    makeObs({ id: 'b', domain: 'cyber', sourceId: 'only-one' }),
  ];
  const report = svc.scan(obs);
  const single = gapsOfType(report.gaps, 'missing-source').find((g) => g.domain === 'cyber');
  assert.ok(single);
  assert.equal(single!.severity, 'moderate');
  assert.match(single!.description, /only-one/);
});

test('missing-source: not flagged when the domain has ≥ 2 sources', () => {
  const svc = freshService();
  const obs = [
    makeObs({ id: 'a', domain: 'cyber', sourceId: 's1' }),
    makeObs({ id: 'b', domain: 'cyber', sourceId: 's2' }),
  ];
  const report = svc.scan(obs);
  assert.equal(gapsOfType(report.gaps, 'missing-source').filter((g) => g.domain === 'cyber').length, 0);
});

// ── Report shape + overall coverage ─────────────────────────────────

test('report: totalGaps equals gaps.length', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  assert.equal(report.totalGaps, report.gaps.length);
});

test('report: criticalCount counts only critical-severity gaps', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const critical = report.gaps.filter((g) => g.severity === 'critical').length;
  assert.equal(report.criticalCount, critical);
});

test('report: byDomain count matches per-domain occurrence', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  // weather should appear at least once in byDomain
  assert.ok(report.byDomain.weather && report.byDomain.weather >= 1);
});

test('report: overallCoverage = 100 when full coverage and no critical gaps', () => {
  const svc = freshService();
  const report = svc.scan(buildFullCoverage());
  assert.equal(report.overallCoverage, 100);
});

test('report: overallCoverage drops when domains have critical gaps', () => {
  const svc = freshService();
  // Empty input → every tracked domain has critical sparse-coverage
  // → coverage should fall to 0.
  const report = svc.scan([makeObs({ id: 'a', domain: 'unrelated' })]);
  assert.equal(report.overallCoverage, 0);
});

test('report: worstDomain points at the domain with the most gaps', () => {
  const svc = freshService();
  // Cover all 5 regions with high-risk observations so blind-spot
  // gaps don't dominate the byDomain tally with the synthetic
  // 'global' domain; then push cyber into stale + low-conf +
  // single-source so it wins.
  const regions = [
    { lat: 30, lon: 100, name: 'Asia-Pacific' },
    { lat: 50, lon: 10, name: 'Europe' },
    { lat: 0, lon: -60, name: 'Americas' },
    { lat: 0, lon: 20, name: 'Africa' },
    { lat: 30, lon: 40, name: 'Middle-East' },
  ];
  const obs: ObservationEvent[] = regions.map((r, i) => makeObs({
    id: `cover-${i}`, domain: 'weather', timestamp: NOW - 60_000,
    severity: 'HIGH' as ObservationSeverity, sourceId: `wx-${i}`,
    location: { lat: r.lat, lon: r.lon },
  }));
  obs.push(makeObs({
    id: 'cy', domain: 'cyber', timestamp: NOW - 7 * HOUR,
    severity: 'INFO' as ObservationSeverity, sourceId: 'only-cyber',
  }));
  const report = svc.scan(obs);
  // cyber hits stale + low-confidence + missing-source + sparse → worst
  assert.equal(report.worstDomain, 'cyber');
});

test('report: empty observation list yields no temporal-gap or missing-source noise', () => {
  const svc = freshService();
  const report = svc.scan([]);
  assert.equal(gapsOfType(report.gaps, 'temporal-gap').length, 0);
  assert.equal(gapsOfType(report.gaps, 'missing-source').length, 0);
});

// ── Lifecycle: acknowledge + resolve ────────────────────────────────

test('acknowledge: moves status to acknowledged', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const id = report.gaps[0]!.id;
  const updated = svc.acknowledge(id);
  assert.equal(updated!.status, 'acknowledged');
});

test('resolve: moves status to resolved and excludes from getOpen', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const id = report.gaps[0]!.id;
  svc.resolve(id);
  assert.equal(svc.getOpen().find((g) => g.id === id), undefined);
});

test('acknowledge / resolve on unknown id returns undefined', () => {
  const svc = freshService();
  assert.equal(svc.acknowledge('does-not-exist'), undefined);
  assert.equal(svc.resolve('does-not-exist'), undefined);
});

test('cannot acknowledge a resolved gap (terminal state)', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const id = report.gaps[0]!.id;
  svc.resolve(id);
  const ack = svc.acknowledge(id);
  assert.equal(ack!.status, 'resolved');
});

// ── Reads + persistence ────────────────────────────────────────────

test('getOpen returns acknowledged + open, excludes resolved', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  assert.ok(report.gaps.length > 0);
  const first = report.gaps[0]!.id;
  svc.acknowledge(first);
  assert.ok(svc.getOpen().some((g) => g.id === first));
});

test('getLatestReport returns the most-recent scan output', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const latest = svc.getLatestReport()!;
  assert.equal(latest.scannedAt, report.scannedAt);
});

test('persistence: gaps + latestReport survive across instances', () => {
  __storage.clear();
  const a = new CollectionGapDiscoveryService({ clock: () => NOW });
  a.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  const b = new CollectionGapDiscoveryService({ clock: () => NOW });
  assert.ok(b.getOpen().length > 0);
  assert.ok(b.getLatestReport());
});

test('corrupt persisted payload is ignored without throwing', () => {
  __storage.clear();
  __storage.set('wm-collection-gaps', 'not-json');
  const svc = new CollectionGapDiscoveryService({ clock: () => NOW });
  assert.doesNotThrow(() => svc.getOpen());
  assert.equal(svc.getOpen().length, 0);
});

test('gap ring buffer caps at MAX_GAPS', () => {
  const svc = freshService();
  const cap = __internals.MAX_GAPS;
  // Each scan produces 4 blind-spot gaps + sparse-coverage gaps for
  // every tracked domain (~14 per scan); over-fill the buffer.
  const scansNeeded = Math.ceil((cap + 30) / 14);
  for (let i = 0; i < scansNeeded; i += 1) {
    svc.scan([makeObs({ id: `obs-${i}`, domain: 'weather' })]);
  }
  assert.ok(svc.getAll().length <= cap);
});

// ── Subscribe ───────────────────────────────────────────────────────

test('subscribe fires on every scan', () => {
  const svc = freshService();
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.scan([makeObs({ id: 'a', domain: 'weather' })]);
  svc.scan([makeObs({ id: 'b', domain: 'cyber' })]);
  assert.equal(calls, 2);
});

test('subscribe also fires on lifecycle transitions (acknowledge/resolve)', () => {
  const svc = freshService();
  const report = svc.scan([makeObs({ id: 'a', domain: 'weather', timestamp: NOW - 7 * HOUR })]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.acknowledge(report.gaps[0]!.id);
  svc.resolve(report.gaps[0]!.id);
  assert.ok(calls >= 1);
});

test('subscribe returns an unsubscribe fn', () => {
  const svc = freshService();
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.scan([]);
  off();
  svc.scan([]);
  assert.equal(calls, 1);
});

test('listener exception isolation', () => {
  const svc = freshService();
  let second = false;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { second = true; });
  svc.scan([]);
  assert.equal(second, true);
});

// ── Singleton + helpers ─────────────────────────────────────────────

test('getCollectionGapDiscoveryService returns a stable singleton', () => {
  __resetCollectionGapDiscoverySingleton();
  const a = getCollectionGapDiscoveryService();
  const b = getCollectionGapDiscoveryService();
  assert.equal(a, b);
});

test('severityToConfidence maps every severity tier', () => {
  assert.equal(__internals.severityToConfidence('CRITICAL'), 1);
  assert.equal(__internals.severityToConfidence('HIGH'), 0.8);
  assert.equal(__internals.severityToConfidence('MEDIUM'), 0.6);
  assert.equal(__internals.severityToConfidence('LOW'), 0.4);
  assert.equal(__internals.severityToConfidence('INFO'), 0.2);
});

test('teardown', () => {
  __resetCollectionGapDiscoverySingleton();
  __storage.clear();
  assert.ok(true);
});
