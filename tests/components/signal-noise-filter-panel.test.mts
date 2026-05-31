/**
 * SignalNoiseFilterPanel — pure-helper unit tests.
 *
 * No DOM: each test calls the exported helper / renderer with fixture
 * FilterStats and SignalScore records and asserts the returned view
 * model or rendered HTML. The Panel base class is never instantiated.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQualityOverview,
  buildRecentScoresView,
  buildFactorBreakdown,
  buildNoiseSummary,
  renderSignalNoiseFilterHtml,
} from '../../src/components/signal-noise-filter-panel-helpers.ts';
import type {
  FilterStats,
  ScoreFactor,
  SignalScore,
} from '../../src/services/intelligence/signal-noise-filter.ts';

const NOW = 1_748_000_000_000;

function makeStats(o: Partial<FilterStats> = {}): FilterStats {
  return {
    totalScored: o.totalScored ?? 0,
    signalCount: o.signalCount ?? 0,
    noiseCount: o.noiseCount ?? 0,
    avgSignalScore: o.avgSignalScore ?? 0,
  };
}

function makeFactors(over: Partial<Record<string, number>> = {}): ScoreFactor[] {
  return [
    { name: 'sourceCount',   weight: 0.3, value: over.sourceCount   ?? 0.3 },
    { name: 'corroboration', weight: 0.4, value: over.corroboration ?? 0.1 },
    { name: 'recency',       weight: 0.3, value: over.recency       ?? 1.0 },
  ];
}

function makeScore(o: Partial<SignalScore> = {}): SignalScore {
  const factors = o.factors ?? makeFactors();
  const sig = o.signalScore ?? factors.reduce((s, f) => s + f.weight * f.value, 0);
  return {
    observationId: o.observationId ?? 'obs-1',
    signalScore: sig,
    noiseScore: o.noiseScore ?? 1 - sig,
    isSignal: o.isSignal ?? sig > 0.5,
    confidence: o.confidence ?? sig,
    factors,
  };
}

// ── buildQualityOverview ───────────────────────────────────────────

describe('buildQualityOverview', () => {
  it('returns empty badge when nothing scored', () => {
    const o = buildQualityOverview(makeStats({ totalScored: 0 }));
    assert.equal(o.badge, 'empty');
    assert.equal(o.signalPercent, 0);
  });

  it('classifies good when signal% > 70', () => {
    const o = buildQualityOverview(makeStats({ totalScored: 10, signalCount: 8, noiseCount: 2, avgSignalScore: 0.72 }));
    assert.equal(o.badge, 'good');
    assert.equal(o.signalPercent, 80);
  });

  it('classifies mixed when 40 <= signal% <= 70', () => {
    const mid = buildQualityOverview(makeStats({ totalScored: 10, signalCount: 5, noiseCount: 5, avgSignalScore: 0.5 }));
    assert.equal(mid.badge, 'mixed');
    const at40 = buildQualityOverview(makeStats({ totalScored: 10, signalCount: 4, noiseCount: 6, avgSignalScore: 0.4 }));
    assert.equal(at40.badge, 'mixed');
    const at70 = buildQualityOverview(makeStats({ totalScored: 10, signalCount: 7, noiseCount: 3, avgSignalScore: 0.7 }));
    assert.equal(at70.badge, 'mixed');
  });

  it('classifies noisy when signal% < 40', () => {
    const o = buildQualityOverview(makeStats({ totalScored: 10, signalCount: 2, noiseCount: 8, avgSignalScore: 0.22 }));
    assert.equal(o.badge, 'noisy');
    assert.equal(o.signalPercent, 20);
  });

  it('rounds signalPercent to the nearest integer', () => {
    const o = buildQualityOverview(makeStats({ totalScored: 3, signalCount: 2, noiseCount: 1, avgSignalScore: 0.6 }));
    assert.equal(o.signalPercent, 67); // 2/3 = 66.6…
  });
});

// ── buildRecentScoresView ──────────────────────────────────────────

describe('buildRecentScoresView', () => {
  const dom = (id: string) => (id.endsWith('-cyb') ? 'cyber' : 'weather');

  it('returns empty array for empty input', () => {
    assert.deepEqual(buildRecentScoresView([], dom), []);
  });

  it('caps the row count at the requested limit', () => {
    const list = Array.from({ length: 30 }, (_, i) => makeScore({ observationId: `obs-${i}` }));
    const rows = buildRecentScoresView(list, dom, 20);
    assert.equal(rows.length, 20);
  });

  it('preserves input order so callers can newest-first the source', () => {
    const list = [
      makeScore({ observationId: 'a' }),
      makeScore({ observationId: 'b' }),
      makeScore({ observationId: 'c' }),
    ];
    const rows = buildRecentScoresView(list, dom);
    assert.deepEqual(rows.map((r) => r.observationId), ['a', 'b', 'c']);
  });

  it('looks up domain through the injected callback', () => {
    const rows = buildRecentScoresView([makeScore({ observationId: 'evt-cyb' })], dom);
    assert.equal(rows[0]?.domain, 'cyber');
  });

  it('picks the top factor by weight × value', () => {
    const score = makeScore({
      factors: [
        { name: 'sourceCount',   weight: 0.3, value: 0.3 }, // 0.09
        { name: 'corroboration', weight: 0.4, value: 1.0 }, // 0.40 ← top
        { name: 'recency',       weight: 0.3, value: 0.4 }, // 0.12
      ],
    });
    const [row] = buildRecentScoresView([score], dom);
    assert.equal(row?.topFactorName, 'corroboration');
    assert.equal(row?.topFactorContribution, 0.4);
  });

  it('handles a score with no factors', () => {
    const score = makeScore({ factors: [] });
    const [row] = buildRecentScoresView([score], dom);
    assert.equal(row?.topFactorName, 'none');
    assert.equal(row?.topFactorContribution, 0);
  });

  it('passes through isSignal flag unchanged', () => {
    const sig = makeScore({ observationId: 'on', signalScore: 0.8, isSignal: true });
    const noise = makeScore({ observationId: 'off', signalScore: 0.2, isSignal: false });
    const rows = buildRecentScoresView([sig, noise], dom);
    assert.equal(rows[0]?.isSignal, true);
    assert.equal(rows[1]?.isSignal, false);
  });
});

// ── buildFactorBreakdown ───────────────────────────────────────────

describe('buildFactorBreakdown', () => {
  it('returns empty list when no scores', () => {
    assert.deepEqual(buildFactorBreakdown([]), []);
  });

  it('averages contributions across scores', () => {
    const scores = [
      makeScore({ factors: makeFactors({ sourceCount: 0.6, corroboration: 0.7, recency: 1.0 }) }),
      makeScore({ factors: makeFactors({ sourceCount: 1.0, corroboration: 0.4, recency: 0.7 }) }),
    ];
    const out = buildFactorBreakdown(scores);
    const corr = out.find((e) => e.name === 'corroboration');
    // ((0.4*0.7) + (0.4*0.4)) / 2 = 0.22
    assert.equal(corr?.avgContribution, 0.22);
  });

  it('sorts entries by avg contribution descending', () => {
    const scores = [makeScore({ factors: makeFactors({ sourceCount: 1, corroboration: 1, recency: 1 }) })];
    const out = buildFactorBreakdown(scores);
    // corroboration weight 0.4 > sourceCount 0.3 == recency 0.3
    assert.equal(out[0]?.name, 'corroboration');
  });

  it('produces percent shares that sum to ~100 (rounding)', () => {
    const scores = [makeScore({ factors: makeFactors({ sourceCount: 1, corroboration: 1, recency: 1 }) })];
    const out = buildFactorBreakdown(scores);
    const sum = out.reduce((s, e) => s + e.percentOfTotal, 0);
    assert.ok(Math.abs(sum - 100) <= 2, `sum=${sum} not within rounding window`);
  });

  it('handles factors with zero contribution', () => {
    const scores = [makeScore({ factors: makeFactors({ sourceCount: 0, corroboration: 0, recency: 0 }) })];
    const out = buildFactorBreakdown(scores);
    for (const e of out) {
      assert.equal(e.avgContribution, 0);
      assert.equal(e.percentOfTotal, 0);
    }
  });
});

// ── buildNoiseSummary ──────────────────────────────────────────────

describe('buildNoiseSummary', () => {
  it('emits the no-data message when totalScored=0', () => {
    const r = buildNoiseSummary(makeStats({ totalScored: 0 }));
    assert.ok(r.recommendation.toLowerCase().includes('no observations'));
    assert.equal(r.noisePercent, 0);
  });

  it('recommends reducing source diversity when noise > 60%', () => {
    const r = buildNoiseSummary(makeStats({ totalScored: 10, signalCount: 3, noiseCount: 7, avgSignalScore: 0.3 }));
    assert.equal(r.noisePercent, 70);
    assert.ok(r.recommendation.toLowerCase().includes('reduce source diversity'));
  });

  it('flags mixed quality between 30% and 60% noise', () => {
    const r = buildNoiseSummary(makeStats({ totalScored: 10, signalCount: 5, noiseCount: 5, avgSignalScore: 0.5 }));
    assert.equal(r.noisePercent, 50);
    assert.ok(r.recommendation.toLowerCase().includes('mixed'));
  });

  it('reports healthy when noise < 30%', () => {
    const r = buildNoiseSummary(makeStats({ totalScored: 10, signalCount: 9, noiseCount: 1, avgSignalScore: 0.85 }));
    assert.equal(r.noisePercent, 10);
    assert.ok(r.recommendation.toLowerCase().includes('healthy'));
  });

  it('rounds noisePercent to the nearest integer', () => {
    const r = buildNoiseSummary(makeStats({ totalScored: 3, signalCount: 1, noiseCount: 2, avgSignalScore: 0.4 }));
    assert.equal(r.noisePercent, 67); // 2/3 = 66.6…
  });
});

// ── renderSignalNoiseFilterHtml ────────────────────────────────────

describe('renderSignalNoiseFilterHtml', () => {
  const emptyState = {
    overview: buildQualityOverview(makeStats()),
    rows: [],
    breakdown: [],
    noise: buildNoiseSummary(makeStats()),
    generatedAt: NOW,
  };

  it('renders all four section headings even with empty data', () => {
    const html = renderSignalNoiseFilterHtml(emptyState);
    for (const heading of [
      'Quality Overview',
      'Recent Scores',
      'Factor Breakdown',
      'Noise Filter Active',
    ]) {
      assert.ok(html.includes(heading), `missing heading: ${heading}`);
    }
  });

  it('shows EMPTY badge when no observations are scored', () => {
    const html = renderSignalNoiseFilterHtml(emptyState);
    assert.ok(html.includes('empty'));
  });

  it('renders a row per recent score with SIG/NOISE label', () => {
    const dom = () => 'cyber';
    const rows = buildRecentScoresView(
      [
        makeScore({ observationId: 'a', signalScore: 0.8, isSignal: true }),
        makeScore({ observationId: 'b', signalScore: 0.2, isSignal: false }),
      ],
      dom,
    );
    const html = renderSignalNoiseFilterHtml({ ...emptyState, rows });
    assert.ok(html.includes('SIG'));
    assert.ok(html.includes('NOISE'));
    assert.ok(html.includes('cyber'));
  });

  it('escapes user-influenced observation ids', () => {
    const dom = () => 'weather';
    const rows = buildRecentScoresView(
      [makeScore({ observationId: '<script>x</script>' })],
      dom,
    );
    const html = renderSignalNoiseFilterHtml({ ...emptyState, rows });
    assert.ok(!html.includes('<script>x</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('shows the high-noise recommendation when noise > 60%', () => {
    const noise = buildNoiseSummary(makeStats({ totalScored: 10, signalCount: 2, noiseCount: 8, avgSignalScore: 0.2 }));
    const html = renderSignalNoiseFilterHtml({ ...emptyState, noise });
    assert.ok(html.toLowerCase().includes('reduce source diversity'));
  });

  it('renders a legend row per factor in the breakdown', () => {
    const dom = () => 'cyber';
    const rows = buildRecentScoresView(
      [makeScore({ factors: makeFactors({ sourceCount: 1, corroboration: 1, recency: 1 }) })],
      dom,
    );
    const breakdown = buildFactorBreakdown([makeScore({ factors: makeFactors({ sourceCount: 1, corroboration: 1, recency: 1 }) })]);
    const html = renderSignalNoiseFilterHtml({ ...emptyState, rows, breakdown });
    assert.ok(html.includes('sourceCount'));
    assert.ok(html.includes('corroboration'));
    assert.ok(html.includes('recency'));
  });
});
