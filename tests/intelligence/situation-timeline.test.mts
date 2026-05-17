/**
 * Tests for SituationTimelineService — Phase 4 chronological view.
 *
 * Run with: npx tsx --test tests/intelligence/situation-timeline.test.mts
 *
 * Pure-service tests against a localStorage stub + injected situation
 * source so the SituationStoreV2 singleton stays untouched.
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
  SituationTimelineService,
  __internals as serviceInternals,
  __resetSituationTimelineSingleton,
  getSituationTimelineService,
} from '../../src/services/intelligence/situation-timeline.ts';
import type {
  EvidenceEdge,
  Situation,
  SituationSeverity,
} from '../../src/services/intelligence/situation-store-v2.ts';
import type { ObservationEvent } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;
const HOUR = 60 * 60 * 1000;

// ── Fixtures ─────────────────────────────────────────────────────────

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 6)}`,
    sourceId: 'src',
    domain: 'earthquake',
    timestamp: NOW,
    severity: 'MEDIUM',
    title: 'sample',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  const startedAt = overrides.startedAt ?? new Date(NOW - HOUR);
  return {
    id: 's-1',
    name: 'M6 quake — coast',
    domain: 'earthquake',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    summary: 's',
    observations: [obs()],
    edges: [],
    entityIds: [],
    confidence: 0.8,
    startedAt,
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

function freshService(situations: Situation[], now = NOW): SituationTimelineService {
  __storage.clear();
  __resetSituationTimelineSingleton();
  return new SituationTimelineService({
    clock: () => now,
    source: () => situations,
  });
}

function edge(extra: Partial<EvidenceEdge> = {}): EvidenceEdge {
  return {
    type: 'caused_by',
    sourceEventId: 'a',
    targetEventId: 'b',
    confidence: 0.6,
    ...extra,
  };
}

// ── buildTimeline shape ───────────────────────────────────────────────

test('buildTimeline returns one TimelineEntry per situation', () => {
  const svc = freshService([
    situation({ id: 's-1', startedAt: new Date(NOW - 2 * HOUR) }),
    situation({ id: 's-2', startedAt: new Date(NOW - HOUR) }),
  ]);
  assert.equal(svc.buildTimeline().length, 2);
});

test('buildTimeline sorts entries by startedAt DESC', () => {
  const svc = freshService([
    situation({ id: 'old', startedAt: new Date(NOW - 5 * HOUR) }),
    situation({ id: 'new', startedAt: new Date(NOW - 1 * HOUR) }),
    situation({ id: 'mid', startedAt: new Date(NOW - 3 * HOUR) }),
  ]);
  const entries = svc.buildTimeline();
  assert.deepEqual(entries.map((e) => e.situationId), ['new', 'mid', 'old']);
});

test('buildTimeline duration for active = now - startedAt', () => {
  const svc = freshService([
    situation({ id: 's-active', startedAt: new Date(NOW - 2 * HOUR), status: 'active' }),
  ]);
  const entry = svc.buildTimeline()[0]!;
  assert.equal(entry.duration, 2 * HOUR);
  assert.equal(entry.status, 'active');
});

test('buildTimeline duration for resolved = resolvedAt - startedAt', () => {
  const svc = freshService([
    situation({
      id: 's-resolved',
      startedAt: new Date(NOW - 5 * HOUR),
      resolvedAt: new Date(NOW - 1 * HOUR),
      status: 'resolved',
    }),
  ]);
  const entry = svc.buildTimeline()[0]!;
  assert.equal(entry.duration, 4 * HOUR);
  assert.equal(entry.status, 'resolved');
});

test('buildTimeline treats "watching" status as active', () => {
  const svc = freshService([
    situation({ id: 's-watch', status: 'watching' }),
  ]);
  assert.equal(svc.buildTimeline()[0]!.status, 'active');
});

test('buildTimeline correlationCount = edges.length', () => {
  const svc = freshService([
    situation({ id: 's', edges: [edge(), edge(), edge()] }),
  ]);
  assert.equal(svc.buildTimeline()[0]!.correlationCount, 3);
});

test('buildTimeline peakAt = timestamp of highest-severity observation', () => {
  const t1 = NOW - 5 * HOUR;
  const t2 = NOW - 3 * HOUR;
  const t3 = NOW - 1 * HOUR;
  const svc = freshService([
    situation({
      id: 's',
      observations: [
        obs({ id: 'a', timestamp: t1, severity: 'LOW' }),
        obs({ id: 'peak', timestamp: t2, severity: 'CRITICAL' }),
        obs({ id: 'c', timestamp: t3, severity: 'MEDIUM' }),
      ],
    }),
  ]);
  const entry = svc.buildTimeline()[0]!;
  assert.equal(entry.peakAt, t2);
  assert.equal(entry.peakSeverity, 'critical');
});

test('buildTimeline peakAt is null when situation has no observations', () => {
  const svc = freshService([
    situation({ id: 's', observations: [], severity: 'high' }),
  ]);
  const entry = svc.buildTimeline()[0]!;
  assert.equal(entry.peakAt, null);
  // Falls back to the situation's own severity.
  assert.equal(entry.peakSeverity, 'high');
});

test('buildTimeline currentSeverity mirrors situation.severity', () => {
  const svc = freshService([
    situation({ id: 's', severity: 'low' }),
  ]);
  assert.equal(svc.buildTimeline()[0]!.currentSeverity, 'low');
});

test('buildTimeline returns defensive copies', () => {
  const svc = freshService([situation()]);
  const first = svc.buildTimeline()[0]!;
  first.title = 'mutated';
  const second = svc.buildTimeline()[0]!;
  assert.notEqual(second.title, 'mutated');
});

// ── Filter ────────────────────────────────────────────────────────────

test('filter by domain matches only that domain', () => {
  const svc = freshService([
    situation({ id: 'a', domain: 'earthquake' }),
    situation({ id: 'b', domain: 'weather' }),
    situation({ id: 'c', domain: 'earthquake' }),
  ]);
  const filtered = svc.buildTimeline({ domain: 'earthquake' });
  assert.equal(filtered.length, 2);
  for (const e of filtered) assert.equal(e.domain, 'earthquake');
});

test('filter by status=active excludes resolved', () => {
  const svc = freshService([
    situation({ id: 'a', status: 'active' }),
    situation({ id: 'b', status: 'resolved', resolvedAt: new Date(NOW) }),
    situation({ id: 'c', status: 'watching' }),
  ]);
  const filtered = svc.buildTimeline({ status: 'active' });
  assert.equal(filtered.length, 2);
});

test('filter by status=resolved excludes active', () => {
  const svc = freshService([
    situation({ id: 'a', status: 'active' }),
    situation({ id: 'b', status: 'resolved', resolvedAt: new Date(NOW) }),
  ]);
  const filtered = svc.buildTimeline({ status: 'resolved' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].situationId, 'b');
});

test('filter by status=all returns everything', () => {
  const svc = freshService([
    situation({ id: 'a', status: 'active' }),
    situation({ id: 'b', status: 'resolved', resolvedAt: new Date(NOW) }),
  ]);
  assert.equal(svc.buildTimeline({ status: 'all' }).length, 2);
});

test('filter by fromDate excludes earlier entries', () => {
  const svc = freshService([
    situation({ id: 'old', startedAt: new Date(NOW - 10 * HOUR) }),
    situation({ id: 'new', startedAt: new Date(NOW - HOUR) }),
  ]);
  const filtered = svc.buildTimeline({ fromDate: NOW - 5 * HOUR });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].situationId, 'new');
});

test('filter by toDate excludes later entries', () => {
  const svc = freshService([
    situation({ id: 'old', startedAt: new Date(NOW - 10 * HOUR) }),
    situation({ id: 'new', startedAt: new Date(NOW - HOUR) }),
  ]);
  const filtered = svc.buildTimeline({ toDate: NOW - 5 * HOUR });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].situationId, 'old');
});

test('filter by minSeverity excludes lower-severity entries', () => {
  const svc = freshService([
    situation({ id: 'low', severity: 'low' }),
    situation({ id: 'med', severity: 'medium' }),
    situation({ id: 'crit', severity: 'critical' }),
  ]);
  const filtered = svc.buildTimeline({ minSeverity: 'medium' });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((e) => (e.currentSeverity === 'medium' || e.currentSeverity === 'critical')));
});

test('filters compose (domain + minSeverity)', () => {
  const svc = freshService([
    situation({ id: 'eq-low', domain: 'earthquake', severity: 'low' }),
    situation({ id: 'eq-crit', domain: 'earthquake', severity: 'critical' }),
    situation({ id: 'wx-crit', domain: 'weather', severity: 'critical' }),
  ]);
  const filtered = svc.buildTimeline({ domain: 'earthquake', minSeverity: 'high' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].situationId, 'eq-crit');
});

// ── Stats ────────────────────────────────────────────────────────────

test('getStats: empty timeline reports zeros', () => {
  const svc = freshService([]);
  svc.buildTimeline();
  const stats = svc.getStats();
  assert.equal(stats.totalSituations, 0);
  assert.equal(stats.activeCount, 0);
  assert.equal(stats.avgDurationHours, 0);
  assert.equal(stats.longestActiveSituation, null);
  assert.equal(stats.mostActiveDomain, null);
});

test('getStats: activeCount excludes resolved', () => {
  const svc = freshService([
    situation({ id: 'a', status: 'active' }),
    situation({ id: 'b', status: 'resolved', resolvedAt: new Date(NOW) }),
    situation({ id: 'c', status: 'watching' }),
  ]);
  svc.buildTimeline();
  assert.equal(svc.getStats().activeCount, 2);
});

test('getStats: avgDurationHours is the mean across all entries', () => {
  const svc = freshService([
    situation({ id: 'a', startedAt: new Date(NOW - 2 * HOUR) }),
    situation({ id: 'b', startedAt: new Date(NOW - 4 * HOUR) }),
  ]);
  svc.buildTimeline();
  // Both active → durations 2h + 4h → avg 3h.
  assert.equal(svc.getStats().avgDurationHours, 3);
});

test('getStats: longestActiveSituation picks the active entry with max duration', () => {
  const svc = freshService([
    situation({ id: 'short', status: 'active', startedAt: new Date(NOW - HOUR) }),
    situation({ id: 'long', status: 'active', startedAt: new Date(NOW - 10 * HOUR) }),
    situation({ id: 'longer-but-resolved', status: 'resolved',
      startedAt: new Date(NOW - 100 * HOUR), resolvedAt: new Date(NOW - HOUR) }),
  ]);
  svc.buildTimeline();
  assert.equal(svc.getStats().longestActiveSituation?.situationId, 'long');
});

test('getStats: mostActiveDomain picks the domain with the highest count', () => {
  const svc = freshService([
    situation({ id: 'eq-1', domain: 'earthquake' }),
    situation({ id: 'eq-2', domain: 'earthquake' }),
    situation({ id: 'wx', domain: 'weather' }),
  ]);
  svc.buildTimeline();
  assert.equal(svc.getStats().mostActiveDomain, 'earthquake');
});

// ── Domain breakdown ─────────────────────────────────────────────────

test('getDomainBreakdown groups by domain with count + mean severity', () => {
  const svc = freshService([
    situation({ id: 'eq-1', domain: 'earthquake', severity: 'high' }),
    situation({ id: 'eq-2', domain: 'earthquake', severity: 'critical' }),
    situation({ id: 'wx', domain: 'weather', severity: 'medium' }),
  ]);
  svc.buildTimeline();
  const breakdown = svc.getDomainBreakdown();
  const eq = breakdown.find((r) => r.domain === 'earthquake')!;
  const wx = breakdown.find((r) => r.domain === 'weather')!;
  assert.equal(eq.count, 2);
  // (high=2 + critical=3) / 2 = 2.5.
  assert.ok(Math.abs(eq.avgSeverity - 2.5) < 1e-9);
  assert.equal(wx.count, 1);
  assert.equal(wx.avgSeverity, 1);
});

test('getDomainBreakdown sorts by count DESC then domain ASC', () => {
  const svc = freshService([
    situation({ id: 'eq-1', domain: 'earthquake' }),
    situation({ id: 'eq-2', domain: 'earthquake' }),
    situation({ id: 'cy', domain: 'cyber' }),
    situation({ id: 'wx', domain: 'weather' }),
  ]);
  svc.buildTimeline();
  const breakdown = svc.getDomainBreakdown();
  assert.deepEqual(breakdown.map((r) => r.domain), ['earthquake', 'cyber', 'weather']);
});

test('getDomainBreakdown on empty cache returns empty', () => {
  const svc = freshService([]);
  svc.buildTimeline();
  assert.deepEqual(svc.getDomainBreakdown(), []);
});

// ── Subscribe + persistence ─────────────────────────────────────────

test('subscribe fires on each buildTimeline call', () => {
  const svc = freshService([situation()]);
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.buildTimeline();
  svc.buildTimeline({ status: 'active' });
  assert.equal(calls, 2);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService([situation()]);
  svc.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  svc.subscribe(() => { secondCalled = true; });
  svc.buildTimeline();
  assert.equal(secondCalled, true);
});

test('cache persists across instances via localStorage', () => {
  const sourceList = [situation({ id: 'p-1' })];
  const a = freshService(sourceList);
  a.buildTimeline();
  // Fresh instance with NO live source — should still see the cached
  // entry from localStorage on the first getCache call.
  const b = new SituationTimelineService({ clock: () => NOW, source: () => [] });
  assert.equal(b.getCache().length, 1);
  assert.equal(b.getCache()[0]!.situationId, 'p-1');
});

test('corrupt persisted blob does not crash hydrate', () => {
  __storage.clear();
  __resetSituationTimelineSingleton();
  __storage.set(serviceInternals.STORAGE_KEY, '{not valid');
  const svc = new SituationTimelineService({ clock: () => NOW, source: () => [] });
  assert.deepEqual(svc.getCache(), []);
});

test('cache is capped at MAX_ENTRIES', () => {
  const max = serviceInternals.MAX_ENTRIES;
  const many: Situation[] = [];
  for (let i = 0; i < max + 5; i++) {
    many.push(situation({ id: `s-${i}`, startedAt: new Date(NOW - (max + 5 - i) * HOUR) }));
  }
  const svc = freshService(many);
  svc.buildTimeline();
  assert.equal(svc.getCache().length, max);
});

test('getSituationTimelineService() returns a stable singleton', () => {
  __storage.clear();
  __resetSituationTimelineSingleton();
  const a = getSituationTimelineService();
  const b = getSituationTimelineService();
  assert.strictEqual(a, b);
});

// ── Internal helpers ──────────────────────────────────────────────────

test('severityRank monotonically increasing low→critical', () => {
  const ladder: SituationSeverity[] = ['low', 'medium', 'high', 'critical'];
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(serviceInternals.severityRank(ladder[i]!) > serviceInternals.severityRank(ladder[i - 1]!));
  }
});
