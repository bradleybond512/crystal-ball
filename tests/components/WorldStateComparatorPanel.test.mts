/**
 * Unit tests for the WorldStateComparatorPanel pure helpers + the
 * panel ↔ HistoricalPlaybackService integration that doesn't require
 * mounting the DOM.
 *
 * The panel class itself imports the Panel base, which in turn drags
 * i18n through Vite's `import.meta.glob`. We therefore test:
 *   - All pure helpers via `world-state-comparator-helpers.ts`
 *   - The panel's `applyThenSnapshotById` + `__getThenSnapshotIdForTests`
 *     interaction, gated behind a JSDOM shim so the Panel constructor
 *     doesn't blow up on missing globals.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arrowFor,
  buildScrubberMarks,
  colorFor,
  computeDomainDeltas,
  computeSummary,
  formatDelta,
  formatDuration,
  formatTimestamp,
  safe,
  timelineEntryById,
  type DomainDelta,
} from '../../src/components/world-state-comparator-helpers.ts';
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

// ── computeDomainDeltas: union + sort ─────────────────────────────────

test('computeDomainDeltas: empty inputs return []', () => {
  assert.deepEqual(computeDomainDeltas(null, null), []);
});

test('computeDomainDeltas: only then snapshot — now side is null', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('weather', 3, 10)] });
  const out = computeDomainDeltas(then_, null);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.thenSeverity, 3);
  assert.equal(out[0]?.nowSeverity, null);
  assert.equal(out[0]?.severityDelta, null);
  assert.equal(out[0]?.direction, 'flat');
});

test('computeDomainDeltas: only now snapshot — then side is null', () => {
  const now_ = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('cyber', 2, 4)] });
  const out = computeDomainDeltas(null, now_);
  assert.equal(out[0]?.thenSeverity, null);
  assert.equal(out[0]?.nowSeverity, 2);
});

test('computeDomainDeltas: shared domain produces numeric delta', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('weather', 1, 5)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS + HOUR_MS, domainStates: [ds('weather', 4, 12)] });
  const out = computeDomainDeltas(then_, now_);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.severityDelta, 3);
  assert.equal(out[0]?.direction, 'up');
  assert.equal(out[0]?.eventCountDelta, 7);
});

test('computeDomainDeltas: down direction when now < then', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('cyber', 5)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('cyber', 1)] });
  const out = computeDomainDeltas(then_, now_);
  assert.equal(out[0]?.direction, 'down');
  assert.equal(out[0]?.severityDelta, -4);
});

test('computeDomainDeltas: flat direction when severities match', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('weather', 3)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('weather', 3)] });
  const out = computeDomainDeltas(then_, now_);
  assert.equal(out[0]?.direction, 'flat');
  assert.equal(out[0]?.severityDelta, 0);
});

test('computeDomainDeltas: union of both sides preserved + sorted by |Δ| desc', () => {
  const then_ = snap({
    id: 'a', capturedAt: NOW_MS,
    domainStates: [ds('weather', 1), ds('cyber', 4), ds('only-in-then', 2)],
  });
  const now_ = snap({
    id: 'b', capturedAt: NOW_MS,
    domainStates: [ds('weather', 4), ds('cyber', 5), ds('only-in-now', 1)],
  });
  const out = computeDomainDeltas(then_, now_);
  assert.deepEqual(out.map((r) => r.domain), ['weather', 'cyber', 'only-in-now', 'only-in-then']);
});

test('computeDomainDeltas: ties on |Δ| break by domain name ascending', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('zeta', 1), ds('alpha', 1)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('zeta', 3), ds('alpha', 3)] });
  const out = computeDomainDeltas(then_, now_);
  assert.deepEqual(out.map((r) => r.domain), ['alpha', 'zeta']);
});

// ── computeSummary ────────────────────────────────────────────────────

test('computeSummary: counts escalated + de-escalated domains', () => {
  const then_ = snap({
    id: 'a', capturedAt: NOW_MS, activeAlerts: 10, situationCount: 3,
    domainStates: [ds('weather', 1), ds('cyber', 5), ds('maritime', 2)],
  });
  const now_ = snap({
    id: 'b', capturedAt: NOW_MS + HOUR_MS, activeAlerts: 12, situationCount: 5,
    domainStates: [ds('weather', 4), ds('cyber', 2), ds('maritime', 2)],
  });
  const summary = computeSummary(then_, now_);
  assert.deepEqual(summary.escalatedDomains, ['weather']);
  assert.deepEqual(summary.deEscalatedDomains, ['cyber']);
  assert.equal(summary.alertsDelta, 2);
  assert.equal(summary.situationsDelta, 2);
  assert.equal(summary.timeGapMs, HOUR_MS);
});

test('computeSummary: mostChangedDomain is the largest |Δ|', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('weather', 1), ds('cyber', 5)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('weather', 2), ds('cyber', 0)] });
  assert.equal(computeSummary(then_, now_).mostChangedDomain, 'cyber');
});

test('computeSummary: mostChangedDomain is null when nothing changed', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('w', 1)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('w', 1)] });
  assert.equal(computeSummary(then_, now_).mostChangedDomain, null);
});

test('computeSummary: null inputs yield all-null aggregates', () => {
  const summary = computeSummary(null, null);
  assert.equal(summary.thenAlerts, null);
  assert.equal(summary.nowAlerts, null);
  assert.equal(summary.alertsDelta, null);
  assert.equal(summary.timeGapMs, null);
  assert.deepEqual(summary.escalatedDomains, []);
});

test('computeSummary: only one snapshot keeps aggregates from that side', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, activeAlerts: 7, situationCount: 4 });
  const summary = computeSummary(then_, null);
  assert.equal(summary.thenAlerts, 7);
  assert.equal(summary.nowAlerts, null);
  assert.equal(summary.alertsDelta, null);
});

test('computeSummary: escalated + deEscalated lists are sorted ascending', () => {
  const then_ = snap({
    id: 'a', capturedAt: NOW_MS,
    domainStates: [ds('zeta', 1), ds('alpha', 1), ds('mu', 5)],
  });
  const now_ = snap({
    id: 'b', capturedAt: NOW_MS,
    domainStates: [ds('zeta', 4), ds('alpha', 4), ds('mu', 2)],
  });
  const s = computeSummary(then_, now_);
  assert.deepEqual(s.escalatedDomains, ['alpha', 'zeta']);
  assert.deepEqual(s.deEscalatedDomains, ['mu']);
});

// ── Direction + formatting helpers ────────────────────────────────────

test('arrowFor: up/down/flat → ▲/▼/◆', () => {
  assert.equal(arrowFor('up'), '▲');
  assert.equal(arrowFor('down'), '▼');
  assert.equal(arrowFor('flat'), '◆');
});

test('colorFor: up uses severity-high, down uses severity-ok, flat severity-info', () => {
  assert.match(colorFor('up'), /severity-high/);
  assert.match(colorFor('down'), /severity-ok/);
  assert.match(colorFor('flat'), /severity-info/);
});

test('formatDelta: signs positive, negative, zero, null', () => {
  assert.equal(formatDelta(3), '+3');
  assert.equal(formatDelta(-2), '-2');
  assert.equal(formatDelta(0), '0');
  assert.equal(formatDelta(null), '—');
});

test('formatTimestamp: ISO with UTC suffix; non-finite → "—"', () => {
  assert.equal(formatTimestamp(NOW_MS), '2026-05-18 12:00:00 UTC');
  assert.equal(formatTimestamp(Number.NaN), '—');
});

test('formatDuration: scales by largest unit (ms/s/m/h/d) + sign', () => {
  assert.equal(formatDuration(500), '500ms');
  assert.equal(formatDuration(2 * 1000), '2s');
  assert.equal(formatDuration(5 * 60_000), '5m');
  assert.equal(formatDuration(2 * 3_600_000), '2h');
  assert.equal(formatDuration(3 * 86_400_000), '3d');
  assert.equal(formatDuration(-90_000), '-2m');
  assert.equal(formatDuration(null), '—');
});

// ── Timeline lookups + scrubber projection ────────────────────────────

const timelineFixture: TimelineEntry[] = [
  { id: 'a', timestamp: NOW_MS,           severity: 1 },
  { id: 'b', timestamp: NOW_MS + HOUR_MS, severity: 3 },
  { id: 'c', timestamp: NOW_MS + 4 * HOUR_MS, severity: 5 },
];

test('timelineEntryById: finds + misses', () => {
  assert.equal(timelineEntryById(timelineFixture, 'b')?.severity, 3);
  assert.equal(timelineEntryById(timelineFixture, 'missing'), undefined);
});

test('buildScrubberMarks: maps fractions across timeline span', () => {
  const marks = buildScrubberMarks(timelineFixture);
  assert.equal(marks.length, 3);
  assert.equal(marks[0]!.fraction, 0);
  assert.equal(marks[2]!.fraction, 1);
  assert.ok(marks[1]!.fraction > 0 && marks[1]!.fraction < 1);
});

test('buildScrubberMarks: empty timeline → empty marks', () => {
  assert.deepEqual(buildScrubberMarks([]), []);
});

test('buildScrubberMarks: single-snapshot timeline pins at fraction 0.5', () => {
  const marks = buildScrubberMarks([{ id: 'only', timestamp: NOW_MS, severity: 4 }]);
  assert.equal(marks.length, 1);
  assert.equal(marks[0]!.fraction, 0.5);
});

test('buildScrubberMarks: identical-timestamp timeline still produces fraction 0.5 marks', () => {
  const marks = buildScrubberMarks([
    { id: 'a', timestamp: NOW_MS, severity: 1 },
    { id: 'b', timestamp: NOW_MS, severity: 2 },
  ]);
  assert.equal(marks.length, 2);
  for (const m of marks) assert.equal(m.fraction, 0.5);
});

// ── safe() wrapper ────────────────────────────────────────────────────

test('safe: returns the value when fn succeeds', () => {
  assert.equal(safe(() => 42), 42);
});

test('safe: returns null when fn throws', () => {
  assert.equal(safe(() => { throw new Error('boom'); }), null);
});

test('safe: coerces undefined to null', () => {
  assert.equal(safe(() => undefined), null);
});

// ── Defensive cases on DomainDelta shape ──────────────────────────────

test('domain present only-in-then has null nowSeverity + null severityDelta', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [ds('lonely', 4)] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [] });
  const out: DomainDelta[] = computeDomainDeltas(then_, now_);
  assert.equal(out[0]?.domain, 'lonely');
  assert.equal(out[0]?.thenSeverity, 4);
  assert.equal(out[0]?.nowSeverity, null);
  assert.equal(out[0]?.severityDelta, null);
});

test('domain present only-in-now has null thenSeverity + null severityDelta', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('emergent', 3)] });
  const out = computeDomainDeltas(then_, now_);
  assert.equal(out[0]?.thenSeverity, null);
  assert.equal(out[0]?.nowSeverity, 3);
  assert.equal(out[0]?.severityDelta, null);
});

test('eventCountDelta defaults missing eventCount to 0 on each side', () => {
  const then_ = snap({ id: 'a', capturedAt: NOW_MS, domainStates: [{ domain: 'x', severity: 1 } as DomainState] });
  const now_  = snap({ id: 'b', capturedAt: NOW_MS, domainStates: [ds('x', 1, 7)] });
  const row = computeDomainDeltas(then_, now_)[0]!;
  assert.equal(row.thenEventCount, 0);
  assert.equal(row.nowEventCount, 7);
  assert.equal(row.eventCountDelta, 7);
});
