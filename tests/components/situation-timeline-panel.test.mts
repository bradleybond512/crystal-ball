/**
 * SituationTimelinePanel — pure render-helper unit tests.
 *
 * The panel itself wires DOM events and reads from the live
 * `getSituationTimelineService()` singleton. Tests here exercise the
 * pure HTML helpers + utility functions exposed through `__internals`
 * so the rendering contract stays nailed down without needing JSDOM.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  QUICK_RANGES,
  SEVERITY_COLOR,
  STATUS_COLOR,
  HOUR_MS,
  DAY_MS,
  parseDate,
  isQuickRangeActive,
  renderStatsRow,
  renderTimeline,
  renderRow,
  renderExpansion,
  formatDurationText,
  formatHours,
  formatAgo,
} from '../../src/components/situation-timeline-render.ts';
import type { TimelineEntry, TimelineStats, TimelineFilter } from '../../src/services/intelligence/situation-timeline.ts';

const NOW = 1_780_000_000_000;

function makeEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    situationId: 'sit-1',
    title: 'Storm cluster over Midwest',
    domain: 'weather',
    startedAt: NOW - 2 * HOUR_MS,
    peakAt: NOW - HOUR_MS,
    resolvedAt: null,
    peakSeverity: 'high',
    currentSeverity: 'medium',
    duration: 2 * HOUR_MS,
    status: 'active',
    correlationCount: 0,
    ...over,
  };
}

function makeStats(over: Partial<TimelineStats> = {}): TimelineStats {
  return {
    totalSituations: 5,
    activeCount: 2,
    avgDurationHours: 3.5,
    longestActiveSituation: null,
    mostActiveDomain: 'weather',
    ...over,
  };
}

// ── QUICK_RANGES ─────────────────────────────────────────────────────

describe('QUICK_RANGES', () => {
  it('exposes the four spec presets', () => {
    assert.equal(QUICK_RANGES.length, 4);
    assert.deepEqual(
      QUICK_RANGES.map((r) => r.label),
      ['1h', '6h', '24h', '7d'],
    );
  });

  it('preset windowMs values match their labels', () => {
    const byLabel = Object.fromEntries(QUICK_RANGES.map((r) => [r.label, r.windowMs]));
    assert.equal(byLabel['1h'], HOUR_MS);
    assert.equal(byLabel['6h'], 6 * HOUR_MS);
    assert.equal(byLabel['24h'], DAY_MS);
    assert.equal(byLabel['7d'], 7 * DAY_MS);
  });
});

// ── isQuickRangeActive ───────────────────────────────────────────────

describe('isQuickRangeActive', () => {
  it('returns false when filter.fromDate is undefined', () => {
    const filter: TimelineFilter = {};
    assert.equal(isQuickRangeActive(filter, HOUR_MS, NOW), false);
  });

  it('returns true when fromDate matches now - window exactly', () => {
    const filter: TimelineFilter = { fromDate: NOW - HOUR_MS };
    assert.equal(isQuickRangeActive(filter, HOUR_MS, NOW), true);
  });

  it('tolerates up to 60s of clock drift', () => {
    const filter: TimelineFilter = { fromDate: NOW - HOUR_MS + 30_000 };
    assert.equal(isQuickRangeActive(filter, HOUR_MS, NOW), true);
  });

  it('returns false when drift exceeds 60s', () => {
    const filter: TimelineFilter = { fromDate: NOW - HOUR_MS - 90_000 };
    assert.equal(isQuickRangeActive(filter, HOUR_MS, NOW), false);
  });

  it('different windows do not match each other', () => {
    const filter: TimelineFilter = { fromDate: NOW - HOUR_MS };
    assert.equal(isQuickRangeActive(filter, DAY_MS, NOW), false);
  });
});

// ── parseDate ────────────────────────────────────────────────────────

describe('parseDate', () => {
  it('returns undefined for empty input', () => {
    assert.equal(parseDate(''), undefined);
  });

  it('parses an ISO date string to epoch ms', () => {
    const ts = parseDate('2024-01-15');
    assert.equal(typeof ts, 'number');
    assert.equal(ts, Date.parse('2024-01-15'));
  });

  it('returns undefined for unparseable input', () => {
    assert.equal(parseDate('not-a-date'), undefined);
  });
});

// ── Severity / status color tables ───────────────────────────────────

describe('SEVERITY_COLOR + STATUS_COLOR', () => {
  it('covers the four severity levels', () => {
    assert.ok(SEVERITY_COLOR.low);
    assert.ok(SEVERITY_COLOR.medium);
    assert.ok(SEVERITY_COLOR.high);
    assert.ok(SEVERITY_COLOR.critical);
  });

  it('critical is the brightest red signal', () => {
    assert.equal(SEVERITY_COLOR.critical, '#f44336');
  });

  it('low is gray', () => {
    assert.equal(SEVERITY_COLOR.low, '#9e9e9e');
  });

  it('active uses red, resolved uses green', () => {
    assert.equal(STATUS_COLOR.active, '#f44336');
    assert.equal(STATUS_COLOR.resolved, '#4caf50');
  });
});

// ── Format helpers ───────────────────────────────────────────────────

describe('formatHours', () => {
  it('renders sub-hour durations in minutes', () => {
    assert.equal(formatHours(15 * 60 * 1000), '15m');
  });

  it('renders 1-24h durations with 1 decimal hour', () => {
    assert.equal(formatHours(2.5 * 60 * 60 * 1000), '2.5h');
  });

  it('renders multi-day durations in days', () => {
    assert.equal(formatHours(3 * 24 * 60 * 60 * 1000), '3.0d');
  });
});

describe('formatAgo', () => {
  it('returns "just now" for negative durations', () => {
    assert.equal(formatAgo(-1000), 'just now');
  });

  it('renders sub-minute as seconds', () => {
    assert.equal(formatAgo(30_000), '30s ago');
  });

  it('renders sub-hour as minutes', () => {
    assert.equal(formatAgo(5 * 60_000), '5m ago');
  });

  it('renders sub-day as hours', () => {
    assert.equal(formatAgo(5 * 60 * 60_000), '5h ago');
  });

  it('renders multi-day as days', () => {
    assert.equal(formatAgo(3 * 24 * 60 * 60_000), '3d ago');
  });
});

describe('formatDurationText', () => {
  it('renders em-dash for null duration', () => {
    assert.equal(formatDurationText(makeEntry({ duration: null })), '—');
  });

  it('renders "so far" suffix for active entries', () => {
    const txt = formatDurationText(makeEntry({ status: 'active', duration: 2 * HOUR_MS }));
    assert.match(txt, /so far$/);
  });

  it('renders bare duration for resolved entries', () => {
    const txt = formatDurationText(makeEntry({ status: 'resolved', duration: 2 * HOUR_MS }));
    assert.equal(txt, '2.0h');
  });
});

// ── renderStatsRow ───────────────────────────────────────────────────

describe('renderStatsRow', () => {
  it('renders the totals + active count + avg duration', () => {
    const html = renderStatsRow(makeStats({ totalSituations: 12, activeCount: 4, avgDurationHours: 3.5 }));
    assert.match(html, /12.*total/);
    assert.match(html, /4.*active/);
    assert.match(html, /3\.5 h/);
  });

  it('shows em-dash when no most-active domain is known', () => {
    const html = renderStatsRow(makeStats({ mostActiveDomain: null }));
    assert.match(html, /most active:.*—/);
  });

  it('escapes the most-active-domain name', () => {
    const html = renderStatsRow(makeStats({ mostActiveDomain: '<script>x</script>' }));
    assert.ok(!html.includes('<script>x</script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('shows longest active situation when present', () => {
    const longest = makeEntry({ title: 'Hurricane Echo', duration: 12 * HOUR_MS });
    const html = renderStatsRow(makeStats({ longestActiveSituation: longest }));
    assert.match(html, /Hurricane Echo/);
    assert.match(html, /12\.0h/);
  });
});

// ── renderTimeline ───────────────────────────────────────────────────

describe('renderTimeline empty + populated', () => {
  it('renders empty-state copy when there are no entries', () => {
    const html = renderTimeline([], null);
    assert.match(html, /No situations match the current filter/i);
  });

  it('renders an entry list with one li per entry', () => {
    const entries = [makeEntry({ situationId: 'a' }), makeEntry({ situationId: 'b' })];
    const html = renderTimeline(entries, null);
    const liCount = (html.match(/<li /g) ?? []).length;
    assert.equal(liCount, 2);
  });

  it('marks the matching id as expanded', () => {
    const entries = [makeEntry({ situationId: 'a' }), makeEntry({ situationId: 'b' })];
    const html = renderTimeline(entries, 'b');
    // The expanded row has the down-arrow ▾ and the collapsed has ▸.
    const downArrowCount = (html.match(/▾/g) ?? []).length;
    const rightArrowCount = (html.match(/▸/g) ?? []).length;
    assert.equal(downArrowCount, 1);
    assert.equal(rightArrowCount, 1);
  });
});

// ── renderRow ────────────────────────────────────────────────────────

describe('renderRow', () => {
  it('renders the data-timeline-row attribute carrying the situation id', () => {
    const html = renderRow(makeEntry({ situationId: 'sit-42' }), false);
    assert.match(html, /data-timeline-row="sit-42"/);
  });

  it('uses the critical color when severity is critical', () => {
    const html = renderRow(makeEntry({ currentSeverity: 'critical' }), false);
    assert.ok(html.includes(SEVERITY_COLOR.critical));
  });

  it('escapes the entry title against XSS', () => {
    const html = renderRow(makeEntry({ title: '<img src=x onerror=alert(1)>' }), false);
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;img/);
  });

  it('shows the right arrow when collapsed', () => {
    const html = renderRow(makeEntry(), false);
    assert.match(html, /▸/);
    assert.ok(!html.includes('▾'));
  });

  it('shows the down arrow + expansion content when expanded', () => {
    const html = renderRow(makeEntry({ peakAt: NOW - HOUR_MS, peakSeverity: 'high' }), true);
    assert.match(html, /▾/);
    assert.match(html, /peak/);
  });
});

// ── renderExpansion ──────────────────────────────────────────────────

describe('renderExpansion', () => {
  it('renders "(current)" when peakAt is null', () => {
    const html = renderExpansion(makeEntry({ peakAt: null, peakSeverity: 'medium' }));
    assert.match(html, /medium \(current\)/);
  });

  it('renders "ongoing" when resolvedAt is null', () => {
    const html = renderExpansion(makeEntry({ resolvedAt: null }));
    assert.match(html, /ongoing/);
  });

  it('renders "resolved <iso>" when resolved', () => {
    const html = renderExpansion(makeEntry({ resolvedAt: NOW }));
    assert.match(html, /resolved \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/);
  });

  it('renders singular "edge" for one correlation', () => {
    const html = renderExpansion(makeEntry({ correlationCount: 1 }));
    assert.match(html, /1 correlation edge\b/);
    assert.ok(!html.includes('edges'));
  });

  it('renders plural "edges" for many correlations', () => {
    const html = renderExpansion(makeEntry({ correlationCount: 3 }));
    assert.match(html, /3 correlation edges/);
  });

  it('uses peakSeverity color for the peak label', () => {
    const html = renderExpansion(makeEntry({ peakSeverity: 'critical' }));
    assert.ok(html.includes(SEVERITY_COLOR.critical));
  });
});
