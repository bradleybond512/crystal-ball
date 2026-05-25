/**
 * Tests for HistoricalPlaybackPanel pure helpers (the panel's render
 * pipeline). Targets `historical-playback-panel-helpers.ts` so the test
 * doesn't drag Panel/i18n via Vite's `import.meta.glob`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arrowFor,
  buildScrubberMarks,
  colorFor,
  computeDomainComparison,
  computeRiskScore,
  computeSnapshotStats,
  formatDelta,
  formatDuration,
  formatTimestamp,
  pickActiveSnapshotId,
  riskBandFor,
  safe,
  type DomainComparisonRow,
} from '../../src/components/historical-playback-panel-helpers.ts';
import type {
  DomainState,
  TimelineEntry,
  WorldSnapshot,
} from '../../src/services/intelligence/historical-playback.ts';

const NOW_MS = Date.UTC(2026, 4, 18, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

function ds(domain: string, severity: number, eventCount = 0): DomainState {
  return { domain, severity, eventCount };
}

function snap(overrides: Partial<WorldSnapshot> & { id: string; capturedAt: number }): WorldSnapshot {
  return {
    domainStates: [],
    situationCount: 0,
    activeAlerts: 0,
    ...overrides,
  };
}

// ── computeRiskScore ──────────────────────────────────────────────────

test('computeRiskScore: null snapshot → 0', () => {
  assert.equal(computeRiskScore(null), 0);
});

test('computeRiskScore: empty snapshot → 0', () => {
  assert.equal(computeRiskScore(snap({ id: 'a', capturedAt: NOW_MS })), 0);
});

test('computeRiskScore: critical domain dominates the weight', () => {
  const s = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('w', 4)] });
  assert.ok(computeRiskScore(s) >= 25);
});

test('computeRiskScore: caps at 100 with extreme inputs', () => {
  const s = snap({
    id: 'a', capturedAt: NOW_MS,
    domainStates: Array.from({ length: 10 }, (_, i) => ds(`d${i}`, 4)),
    activeAlerts: 1000,
    situationCount: 50,
  });
  assert.equal(computeRiskScore(s), 100);
});

test('computeRiskScore: medium-only domains stay low', () => {
  const s = snap({
    id: 'a', capturedAt: NOW_MS,
    domainStates: [ds('a', 2), ds('b', 2), ds('c', 2)],
  });
  // 3 medium × 4 = 12 → below the high band cutoff (25)
  assert.ok(computeRiskScore(s) < 25);
});

// ── computeSnapshotStats ──────────────────────────────────────────────

test('computeSnapshotStats: null snapshot → all nulls + zeroed counts', () => {
  const stats = computeSnapshotStats(null);
  assert.equal(stats.activeAlerts, null);
  assert.equal(stats.situationCount, null);
  assert.equal(stats.highSeverityDomainCount, 0);
  assert.equal(stats.riskScore, 0);
  assert.equal(stats.capturedAt, null);
});

test('computeSnapshotStats: counts sev≥3 domains', () => {
  const stats = computeSnapshotStats(snap({
    id: 'a', capturedAt: NOW_MS, activeAlerts: 5, situationCount: 2,
    domainStates: [ds('w', 1), ds('c', 3), ds('m', 4), ds('o', 2)],
  }));
  assert.equal(stats.highSeverityDomainCount, 2);
  assert.equal(stats.activeAlerts, 5);
  assert.equal(stats.situationCount, 2);
  assert.equal(stats.capturedAt, NOW_MS);
});

// ── computeDomainComparison ───────────────────────────────────────────

test('computeDomainComparison: empty / null inputs → []', () => {
  assert.deepEqual(computeDomainComparison(null, null), []);
});

test('computeDomainComparison: shared domain produces numeric delta', () => {
  const selected = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('w', 1, 5)] });
  const now_     = snap({ id: 'b', capturedAt: NOW_MS + HOUR_MS, domainStates: [ds('w', 4, 12)] });
  const rows = computeDomainComparison(selected, now_);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.delta, 3);
  assert.equal(rows[0]?.direction, 'up');
});

test('computeDomainComparison: down direction when now < selected', () => {
  const selected = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('c', 5)] });
  const now_     = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('c', 1)] });
  assert.equal(computeDomainComparison(selected, now_)[0]?.direction, 'down');
});

test('computeDomainComparison: domain only-on-selected has null nowSeverity', () => {
  const selected = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('lonely', 3)] });
  const rows = computeDomainComparison(selected, snap({ id: 'b', capturedAt: NOW_MS }));
  assert.equal(rows[0]?.selectedSeverity, 3);
  assert.equal(rows[0]?.nowSeverity, null);
  assert.equal(rows[0]?.delta, null);
});

test('computeDomainComparison: union sorted by |Δ| desc, ties domain asc', () => {
  const selected = snap({
    id: 'a', capturedAt: NOW_MS,
    domainStates: [ds('zeta', 1), ds('alpha', 1), ds('mu', 5)],
  });
  const now_ = snap({
    id: 'b', capturedAt: NOW_MS,
    domainStates: [ds('zeta', 4), ds('alpha', 4), ds('mu', 2)],
  });
  const rows: DomainComparisonRow[] = computeDomainComparison(selected, now_);
  // mu changed by 3, alpha+zeta changed by 3 too → mu first because
  // ties broken by domain ascending, then alpha then zeta
  assert.deepEqual(rows.map((r) => r.domain), ['alpha', 'mu', 'zeta']);
});

// ── pickActiveSnapshotId ──────────────────────────────────────────────

test('pickActiveSnapshotId: empty timeline → null', () => {
  assert.equal(pickActiveSnapshotId([], null), null);
  assert.equal(pickActiveSnapshotId([], 'anything'), null);
});

test('pickActiveSnapshotId: null selection defaults to newest', () => {
  const tl: TimelineEntry[] = [
    { id: 'a', timestamp: NOW_MS,            severity: 1 },
    { id: 'b', timestamp: NOW_MS + HOUR_MS,  severity: 2 },
  ];
  assert.equal(pickActiveSnapshotId(tl, null), 'b');
});

test('pickActiveSnapshotId: existing selection is preserved', () => {
  const tl: TimelineEntry[] = [
    { id: 'a', timestamp: NOW_MS,            severity: 1 },
    { id: 'b', timestamp: NOW_MS + HOUR_MS,  severity: 2 },
  ];
  assert.equal(pickActiveSnapshotId(tl, 'a'), 'a');
});

test('pickActiveSnapshotId: evicted selection falls back to newest', () => {
  const tl: TimelineEntry[] = [
    { id: 'a', timestamp: NOW_MS, severity: 1 },
  ];
  assert.equal(pickActiveSnapshotId(tl, 'b-no-longer-here'), 'a');
});

// ── buildScrubberMarks ────────────────────────────────────────────────

const timeline: TimelineEntry[] = [
  { id: 'a', timestamp: NOW_MS,                severity: 1 },
  { id: 'b', timestamp: NOW_MS + HOUR_MS,      severity: 3 },
  { id: 'c', timestamp: NOW_MS + 4 * HOUR_MS,  severity: 5 },
];

test('buildScrubberMarks: maps fractions across timeline span', () => {
  const marks = buildScrubberMarks(timeline, 'b');
  assert.equal(marks.length, 3);
  assert.equal(marks[0]!.fraction, 0);
  assert.equal(marks[2]!.fraction, 1);
});

test('buildScrubberMarks: marks the selected + the live entries', () => {
  const marks = buildScrubberMarks(timeline, 'b');
  assert.equal(marks.find((m) => m.id === 'b')!.isSelected, true);
  assert.equal(marks.find((m) => m.id === 'c')!.isLive, true);
  assert.equal(marks.find((m) => m.id === 'a')!.isSelected, false);
});

test('buildScrubberMarks: empty timeline → empty marks', () => {
  assert.deepEqual(buildScrubberMarks([], null), []);
});

test('buildScrubberMarks: single-snapshot pins at 0.5 and is both selected and live', () => {
  const marks = buildScrubberMarks([{ id: 'only', timestamp: NOW_MS, severity: 4 }], 'only');
  assert.equal(marks.length, 1);
  assert.equal(marks[0]!.fraction, 0.5);
  assert.equal(marks[0]!.isLive, true);
  assert.equal(marks[0]!.isSelected, true);
});

test('buildScrubberMarks: identical-timestamp entries still pin at 0.5', () => {
  const marks = buildScrubberMarks([
    { id: 'a', timestamp: NOW_MS, severity: 1 },
    { id: 'b', timestamp: NOW_MS, severity: 2 },
  ], 'a');
  assert.equal(marks.length, 2);
  for (const m of marks) assert.equal(m.fraction, 0.5);
});

// ── Formatting + direction helpers ───────────────────────────────────

test('arrowFor: up/down/flat glyphs', () => {
  assert.equal(arrowFor('up'), '▲');
  assert.equal(arrowFor('down'), '▼');
  assert.equal(arrowFor('flat'), '◆');
});

test('colorFor: up uses severity-high, down uses severity-ok, flat severity-info', () => {
  assert.match(colorFor('up'), /severity-high/);
  assert.match(colorFor('down'), /severity-ok/);
  assert.match(colorFor('flat'), /severity-info/);
});

test('formatDelta: signs positive, zero, null', () => {
  assert.equal(formatDelta(2), '+2');
  assert.equal(formatDelta(-1), '-1');
  assert.equal(formatDelta(0), '0');
  assert.equal(formatDelta(null), '—');
});

test('formatTimestamp: ISO UTC; null + non-finite → "—"', () => {
  assert.equal(formatTimestamp(NOW_MS), '2026-05-18 12:00:00 UTC');
  assert.equal(formatTimestamp(null), '—');
  assert.equal(formatTimestamp(Number.NaN), '—');
});

test('formatDuration: scales by largest unit and honours sign', () => {
  assert.equal(formatDuration(800), '800ms');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(10 * 60_000), '10m');
  assert.equal(formatDuration(5 * 3_600_000), '5h');
  assert.equal(formatDuration(2 * 86_400_000), '2d');
  assert.equal(formatDuration(-10_000), '-10s');
  assert.equal(formatDuration(null), '—');
});

test('riskBandFor: thresholds at 25, 50, 75', () => {
  assert.equal(riskBandFor(0), 'low');
  assert.equal(riskBandFor(24), 'low');
  assert.equal(riskBandFor(25), 'medium');
  assert.equal(riskBandFor(49), 'medium');
  assert.equal(riskBandFor(50), 'high');
  assert.equal(riskBandFor(74), 'high');
  assert.equal(riskBandFor(75), 'critical');
  assert.equal(riskBandFor(100), 'critical');
});

// ── safe ──────────────────────────────────────────────────────────────

test('safe: returns value when fn succeeds', () => {
  assert.equal(safe(() => 42), 42);
});

test('safe: catches throw, returns null', () => {
  assert.equal(safe(() => { throw new Error('boom'); }), null);
});

test('safe: coerces undefined to null', () => {
  assert.equal(safe(() => undefined), null);
});
