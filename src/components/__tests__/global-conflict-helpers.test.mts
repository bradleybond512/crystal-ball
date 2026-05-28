import assert from 'node:assert/strict';
import test from 'node:test';
import {
  intensityScore,
  trendIcon,
  formatDisplaced,
  formatDeaths,
  rankConflictsBySeverity,
  filterByRegion,
  filterByIntensity,
  computeRegionalSummary,
  totalGlobalDisplaced,
  totalActiveWars,
  recentHighSignificanceEvents,
  conflictDurationYears,
  escalatingConflicts,
  buildRenderData,
  type ActiveConflict,
  type ConflictEvent,
  type ConflictIntensity,
  type Region,
} from '../global-conflict-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeConflict(over: Partial<ActiveConflict> = {}): ActiveConflict {
  return {
    id: 'test',
    name: 'Test Conflict',
    country: 'Testland',
    region: 'europe',
    intensity: 'crisis',
    type: 'civil-war',
    startYear: 2020,
    estimatedDeaths: 1000,
    monthlyDeaths: 50,
    displaced: 100,
    trend: 'stable',
    parties: ['A', 'B'],
    lastUpdate: '2026-01-01',
    ...over,
  };
}

function makeEvent(over: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id: 'ev-test',
    date: '2026-01-01',
    conflictId: 'test',
    headline: 'Test event',
    significance: 'medium',
    deathToll: 0,
    ...over,
  };
}

// ── intensityScore ────────────────────────────────────────────────────────

test('intensityScore: war is highest', () => {
  assert.equal(intensityScore('war'), 5);
});

test('intensityScore: stable is lowest', () => {
  assert.equal(intensityScore('stable'), 1);
});

test('intensityScore: ordering is war > armed-conflict > crisis > tension > stable', () => {
  const levels: ConflictIntensity[] = ['war', 'armed-conflict', 'crisis', 'tension', 'stable'];
  for (let i = 0; i < levels.length - 1; i++) {
    assert.ok(intensityScore(levels[i]!) > intensityScore(levels[i + 1]!));
  }
});

test('intensityScore: all five levels have distinct scores', () => {
  const scores = (['war', 'armed-conflict', 'crisis', 'tension', 'stable'] as ConflictIntensity[]).map(intensityScore);
  const unique = new Set(scores);
  assert.equal(unique.size, 5);
});

// ── trendIcon ─────────────────────────────────────────────────────────────

test('trendIcon: escalating returns up', () => {
  assert.equal(trendIcon('escalating'), 'up');
});

test('trendIcon: de-escalating returns down', () => {
  assert.equal(trendIcon('de-escalating'), 'down');
});

test('trendIcon: stable returns flat', () => {
  assert.equal(trendIcon('stable'), 'flat');
});

// ── formatDisplaced ───────────────────────────────────────────────────────

test('formatDisplaced: below 1000 shows K suffix', () => {
  assert.equal(formatDisplaced(500), '500K');
});

test('formatDisplaced: 1000 and above shows M suffix', () => {
  assert.equal(formatDisplaced(1000), '1.0M');
});

test('formatDisplaced: fractional millions', () => {
  assert.equal(formatDisplaced(2500), '2.5M');
});

test('formatDisplaced: zero', () => {
  assert.equal(formatDisplaced(0), '0K');
});

// ── formatDeaths ──────────────────────────────────────────────────────────

test('formatDeaths: below 1000 is plain number', () => {
  assert.equal(formatDeaths(500), '500');
});

test('formatDeaths: thousands range', () => {
  assert.equal(formatDeaths(50000), '50K');
});

test('formatDeaths: millions range', () => {
  assert.equal(formatDeaths(1500000), '1.5M');
});

test('formatDeaths: exactly 1000', () => {
  assert.equal(formatDeaths(1000), '1K');
});

// ── rankConflictsBySeverity ───────────────────────────────────────────────

test('rankConflictsBySeverity: war sorts before crisis', () => {
  const c1 = makeConflict({ id: 'a', intensity: 'crisis' });
  const c2 = makeConflict({ id: 'b', intensity: 'war' });
  const ranked = rankConflictsBySeverity([c1, c2]);
  assert.equal(ranked[0]!.intensity, 'war');
});

test('rankConflictsBySeverity: same intensity, higher monthlyDeaths first', () => {
  const c1 = makeConflict({ id: 'a', intensity: 'war', monthlyDeaths: 100 });
  const c2 = makeConflict({ id: 'b', intensity: 'war', monthlyDeaths: 500 });
  const ranked = rankConflictsBySeverity([c1, c2]);
  assert.equal(ranked[0]!.id, 'b');
});

test('rankConflictsBySeverity: does not mutate input array', () => {
  const arr = [makeConflict({ id: 'a', intensity: 'stable' }), makeConflict({ id: 'b', intensity: 'war' })];
  const original = arr.map((c) => c.id);
  rankConflictsBySeverity(arr);
  assert.deepEqual(arr.map((c) => c.id), original);
});

test('rankConflictsBySeverity: empty array returns empty', () => {
  assert.deepEqual(rankConflictsBySeverity([]), []);
});

// ── filterByRegion ────────────────────────────────────────────────────────

test('filterByRegion: returns only matching region', () => {
  const c1 = makeConflict({ id: 'a', region: 'europe' });
  const c2 = makeConflict({ id: 'b', region: 'africa' });
  const result = filterByRegion([c1, c2], 'europe');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'a');
});

test('filterByRegion: returns empty for unmatched region', () => {
  const c1 = makeConflict({ region: 'europe' });
  assert.deepEqual(filterByRegion([c1], 'americas'), []);
});

// ── filterByIntensity ─────────────────────────────────────────────────────

test('filterByIntensity: war threshold excludes lower', () => {
  const conflicts = [
    makeConflict({ id: 'a', intensity: 'war' }),
    makeConflict({ id: 'b', intensity: 'crisis' }),
    makeConflict({ id: 'c', intensity: 'stable' }),
  ];
  const result = filterByIntensity(conflicts, 'war');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'a');
});

test('filterByIntensity: crisis threshold includes crisis and above', () => {
  const conflicts = [
    makeConflict({ id: 'a', intensity: 'war' }),
    makeConflict({ id: 'b', intensity: 'crisis' }),
    makeConflict({ id: 'c', intensity: 'tension' }),
  ];
  const result = filterByIntensity(conflicts, 'crisis');
  assert.equal(result.length, 2);
});

// ── computeRegionalSummary ────────────────────────────────────────────────

test('computeRegionalSummary: returns all six regions', () => {
  const summaries = computeRegionalSummary([]);
  assert.equal(summaries.length, 6);
});

test('computeRegionalSummary: empty region has zero conflicts', () => {
  const summaries = computeRegionalSummary([]);
  for (const s of summaries) {
    assert.equal(s.activeConflicts, 0);
    assert.equal(s.totalDisplaced, 0);
    assert.equal(s.dominantIntensity, 'stable');
  }
});

test('computeRegionalSummary: counts escalating correctly', () => {
  const conflicts = [
    makeConflict({ region: 'europe', trend: 'escalating' }),
    makeConflict({ region: 'europe', trend: 'stable' }),
  ];
  const summaries = computeRegionalSummary(conflicts);
  const europe = summaries.find((s) => s.region === 'europe')!;
  assert.equal(europe.escalatingCount, 1);
  assert.equal(europe.activeConflicts, 2);
});

test('computeRegionalSummary: sums displaced within region', () => {
  const conflicts = [
    makeConflict({ region: 'africa', displaced: 300 }),
    makeConflict({ region: 'africa', displaced: 700 }),
  ];
  const summaries = computeRegionalSummary(conflicts);
  const africa = summaries.find((s) => s.region === 'africa')!;
  assert.equal(africa.totalDisplaced, 1000);
});

// ── totalGlobalDisplaced ──────────────────────────────────────────────────

test('totalGlobalDisplaced: sums all displaced values', () => {
  const conflicts = [makeConflict({ displaced: 200 }), makeConflict({ displaced: 800 })];
  assert.equal(totalGlobalDisplaced(conflicts), 1000);
});

test('totalGlobalDisplaced: empty list returns 0', () => {
  assert.equal(totalGlobalDisplaced([]), 0);
});

// ── totalActiveWars ───────────────────────────────────────────────────────

test('totalActiveWars: counts only war intensity', () => {
  const conflicts = [
    makeConflict({ intensity: 'war' }),
    makeConflict({ intensity: 'war' }),
    makeConflict({ intensity: 'crisis' }),
  ];
  assert.equal(totalActiveWars(conflicts), 2);
});

test('totalActiveWars: returns 0 when no wars', () => {
  assert.equal(totalActiveWars([makeConflict({ intensity: 'tension' })]), 0);
});

// ── recentHighSignificanceEvents ──────────────────────────────────────────

test('recentHighSignificanceEvents: excludes medium and low', () => {
  const events = [
    makeEvent({ significance: 'high', date: '2026-05-01' }),
    makeEvent({ significance: 'medium', date: '2026-05-02' }),
    makeEvent({ significance: 'low', date: '2026-05-03' }),
  ];
  const result = recentHighSignificanceEvents(events);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.significance, 'high');
});

test('recentHighSignificanceEvents: sorts descending by date', () => {
  const events = [
    makeEvent({ id: 'a', significance: 'high', date: '2026-01-01' }),
    makeEvent({ id: 'b', significance: 'high', date: '2026-05-01' }),
  ];
  const result = recentHighSignificanceEvents(events);
  assert.equal(result[0]!.id, 'b');
});

test('recentHighSignificanceEvents: respects limit', () => {
  const events = Array.from({ length: 10 }, (_, i) =>
    makeEvent({ id: String(i), significance: 'high', date: `2026-01-${String(i + 1).padStart(2, '0')}` })
  );
  assert.equal(recentHighSignificanceEvents(events, 3).length, 3);
});

// ── conflictDurationYears ─────────────────────────────────────────────────

test('conflictDurationYears: 2022 start = 4 years in 2026', () => {
  assert.equal(conflictDurationYears(makeConflict({ startYear: 2022 }), 2026), 4);
});

test('conflictDurationYears: same year returns 0', () => {
  assert.equal(conflictDurationYears(makeConflict({ startYear: 2026 }), 2026), 0);
});

// ── escalatingConflicts ───────────────────────────────────────────────────

test('escalatingConflicts: filters correctly', () => {
  const conflicts = [
    makeConflict({ trend: 'escalating' }),
    makeConflict({ trend: 'stable' }),
    makeConflict({ trend: 'de-escalating' }),
  ];
  assert.equal(escalatingConflicts(conflicts).length, 1);
});

test('escalatingConflicts: returns empty for none escalating', () => {
  assert.equal(escalatingConflicts([makeConflict({ trend: 'stable' })]).length, 0);
});

// ── buildRenderData ───────────────────────────────────────────────────────

test('buildRenderData: returns non-empty conflicts list', () => {
  const data = buildRenderData();
  assert.ok(data.conflicts.length > 0);
});

test('buildRenderData: conflicts are sorted war-first', () => {
  const data = buildRenderData();
  assert.equal(data.conflicts[0]!.intensity, 'war');
});

test('buildRenderData: activeWars is a positive integer', () => {
  const data = buildRenderData();
  assert.ok(Number.isInteger(data.activeWars));
  assert.ok(data.activeWars > 0);
});

test('buildRenderData: totalDisplacedK is positive', () => {
  const data = buildRenderData();
  assert.ok(data.totalDisplacedK > 0);
});

test('buildRenderData: regionalSummaries has 6 entries', () => {
  const data = buildRenderData();
  assert.equal(data.regionalSummaries.length, 6);
});

test('buildRenderData: escalatingCount matches escalating conflicts', () => {
  const data = buildRenderData();
  const counted = data.conflicts.filter((c) => c.trend === 'escalating').length;
  assert.equal(data.escalatingCount, counted);
});

test('buildRenderData: recentEvents are all high significance', () => {
  const data = buildRenderData();
  for (const ev of data.recentEvents) {
    assert.equal(ev.significance, 'high');
  }
});
