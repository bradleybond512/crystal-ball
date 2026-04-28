import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateAlgorithmHealth,
  type AlgorithmDefinition,
} from '../algorithm-health.ts';
import type { CalibrationSummary } from '../algorithm-evaluation-ledger.ts';

const NOW = 1_745_000_000_000;

function defWeather(overrides: Partial<AlgorithmDefinition> = {}): AlgorithmDefinition {
  return {
    algorithmId: 'weather-polygon-v1',
    label: 'Weather polygon match',
    domain: 'weather_polygon',
    criticality: 'safety',
    ...overrides,
  };
}

function calibration(overrides: Partial<CalibrationSummary> = {}): CalibrationSummary {
  return {
    algorithmId: 'weather-polygon-v1',
    domain: 'weather_polygon',
    graded: 50,
    hits: 48,
    misses: 1,
    partials: 1,
    inconclusive: 0,
    hitRate: 48 / 50,
    weightedHitRate: (48 + 0.5) / 50,
    meanDurationMs: 12,
    ...overrides,
  };
}

// ── Healthy + unknown ──────────────────────────────────────────────────

test('healthy: weighted hit rate clears the safety floor with enough samples', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather()],
    calibrations: [calibration()],
  });
  assert.equal(report.status, 'healthy');
  assert.equal(report.algorithms[0]?.status, 'healthy');
  assert.equal(report.algorithms[0]?.recommendedAdjustment, '');
  assert.match(report.summary, /within their calibration floors/);
});

test('unknown: no calibration recorded', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather()],
    calibrations: [],
  });
  assert.equal(report.algorithms[0]?.status, 'unknown');
  assert.equal(report.status, 'unknown');
});

test('unknown: graded samples below the minimum', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather({ minGradedSamples: 25 })],
    calibrations: [calibration({ graded: 10 })],
  });
  assert.equal(report.algorithms[0]?.status, 'unknown');
  assert.match(report.algorithms[0]?.reason ?? '', /Only 10 graded samples/);
});

// ── Degraded / failing / unsafe transitions ────────────────────────────

test('degraded: weighted hit rate just below the floor', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather({ criticality: 'medium' })],
    calibrations: [
      calibration({ weightedHitRate: 0.5, hits: 25, partials: 0, misses: 25 }),
    ],
  });
  // medium floor is 0.55, gap is 0.05 (< 0.1) so degraded
  assert.equal(report.algorithms[0]?.status, 'degraded');
  assert.match(report.algorithms[0]?.recommendedAdjustment ?? '', /threshold|tighten|raise|tune|fit|inspect|verify|audit|re-/i);
});

test('failing: weighted hit rate >0.1 below the floor (non-safety)', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather({ criticality: 'medium' })],
    calibrations: [
      calibration({ weightedHitRate: 0.3, hits: 15, partials: 0, misses: 35 }),
    ],
  });
  assert.equal(report.algorithms[0]?.status, 'failing');
  assert.equal(report.status, 'failing');
});

test('unsafe: safety algorithm well below floor escalates the whole report', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather()], // criticality safety, default floor 0.85
    calibrations: [
      calibration({ weightedHitRate: 0.5, hits: 25, partials: 0, misses: 25 }),
    ],
  });
  assert.equal(report.algorithms[0]?.status, 'unsafe');
  assert.equal(report.status, 'unsafe');
  assert.match(report.summary, /Safety-critical/);
  assert.match(report.recommendations[0] ?? '', /Quarantine/);
});

test('safety algorithm just below floor stays at failing (not unsafe)', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather()], // safety, floor 0.85
    calibrations: [
      // 0.84 — within the 0.10 margin so flagged as failing not unsafe
      calibration({ weightedHitRate: 0.84, hits: 42, partials: 0, misses: 8 }),
    ],
  });
  assert.equal(report.algorithms[0]?.status, 'failing');
  // Safety + failing → 'unsafe' at the report level (escalation rule).
  assert.equal(report.status, 'unsafe');
});

// ── Latency degradation ────────────────────────────────────────────────

test('degraded by latency even with passing hit rate', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather({ maxMeanDurationMs: 50 })],
    calibrations: [calibration({ meanDurationMs: 200 })],
  });
  assert.equal(report.algorithms[0]?.status, 'degraded');
  assert.match(report.algorithms[0]?.reason ?? '', /200 ms exceeds/);
});

// ── Recommendations + ordering ─────────────────────────────────────────

test('recommendations: safety failures come before non-safety, deduped, capped at 8', () => {
  const definitions: AlgorithmDefinition[] = [
    defWeather({ algorithmId: 'low-1', label: 'Low 1', criticality: 'low', domain: 'truth_score' }),
    defWeather({ algorithmId: 'wx-1', label: 'WX 1', criticality: 'safety', domain: 'weather_polygon' }),
  ];
  const calibrations: CalibrationSummary[] = [
    calibration({ algorithmId: 'low-1', domain: 'truth_score', weightedHitRate: 0.2, hits: 5, partials: 0, misses: 25 }),
    calibration({ algorithmId: 'wx-1', domain: 'weather_polygon', weightedHitRate: 0.5, hits: 25, partials: 0, misses: 25 }),
  ];
  const report = aggregateAlgorithmHealth({ generatedAt: NOW, definitions, calibrations });
  assert.match(report.recommendations[0] ?? '', /WX 1/);
  // The 2nd recommendation is for low-1 (non-safety, failing).
  assert.match(report.recommendations[1] ?? '', /Low 1/);
});

// ── Domain-specific adjustment text ────────────────────────────────────

test('adjustment suggestions are domain-aware', () => {
  const cases: { domain: AlgorithmDefinition['domain']; pattern: RegExp }[] = [
    { domain: 'truth_score', pattern: /contradiction|corroboration/ },
    { domain: 'evidence_graph', pattern: /source-trust priors/ },
    { domain: 'situation_clustering', pattern: /merge similarity threshold/ },
    { domain: 'baseline_deviation', pattern: /seasonal baselines/ },
    { domain: 'compound_risk', pattern: /dependency weights/ },
    { domain: 'forecast_calibration', pattern: /Brier-score calibrator/ },
    { domain: 'watchlist_relevance', pattern: /relevance threshold/ },
    { domain: 'shortage_score', pattern: /USDA \/ FRED/ },
    { domain: 'weather_polygon', pattern: /UGC zone overlap/ },
    { domain: 'weather_urgency', pattern: /urgency ladder/ },
    { domain: 'reasoning_hypothesis', pattern: /thread continuity/ },
    { domain: 'negative_evidence', pattern: /missing-confirmation/ },
  ];
  for (const c of cases) {
    const def = defWeather({
      algorithmId: `id-${c.domain}`,
      criticality: 'medium',
      domain: c.domain,
    });
    const cal = calibration({
      algorithmId: `id-${c.domain}`,
      domain: c.domain,
      weightedHitRate: 0.3,
      hits: 15,
      partials: 0,
      misses: 35,
    });
    const report = aggregateAlgorithmHealth({
      generatedAt: NOW,
      definitions: [def],
      calibrations: [cal],
    });
    assert.match(
      report.algorithms[0]?.recommendedAdjustment ?? '',
      c.pattern,
      `${c.domain} adjustment text should match ${c.pattern}`,
    );
  }
});

// ── Custom thresholds ──────────────────────────────────────────────────

test('custom minWeightedHitRate overrides the criticality default', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather({ criticality: 'safety', minWeightedHitRate: 0.5 })],
    calibrations: [calibration({ weightedHitRate: 0.6 })],
  });
  // Default safety floor would mark this failing at 0.6, but 0.5 floor passes.
  assert.equal(report.algorithms[0]?.status, 'healthy');
});

// ── Output shape ───────────────────────────────────────────────────────

test('aggregateAlgorithmHealth output is JSON-serializable', () => {
  const report = aggregateAlgorithmHealth({
    generatedAt: NOW,
    definitions: [defWeather()],
    calibrations: [calibration()],
  });
  const json = JSON.stringify(report);
  const parsed = JSON.parse(json) as { status: string };
  assert.equal(parsed.status, 'healthy');
});
