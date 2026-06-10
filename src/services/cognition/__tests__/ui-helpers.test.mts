/**
 * Unit tests for cognition/ui-helpers.ts (PR 6 — UI wiring).
 *
 * All tests run in Node.js with static fixtures — no DOM, no fetch, no real
 * IDB. The module is pure deterministic; localStorage access is guarded by
 * typeof checks in the module.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage before importing the module (flag API reads localStorage).
const _lsStore: Record<string, string> = {};
const _lsStub = {
  getItem: (k: string) => _lsStore[k] ?? null,
  setItem: (k: string, v: string) => { _lsStore[k] = v; },
  removeItem: (k: string) => { delete _lsStore[k]; },
};
// @ts-expect-error — stubbing global for test
globalThis.localStorage = _lsStub;

import {
  cogFlags,
  formatOutcomeBadge,
  formatSimilarityPct,
  formatIntervalWhisker,
  formatEstimatesTable,
  formatSpreadLabel,
  formatTrajectoryArrow,
  formatTrajectoryTooltip,
  formatCalibrationSummary,
  formatComparisonLine,
  formatEvoiChip,
  formatAnalogLine,
} from '../ui-helpers.js';

import type { EntityDossier } from '../entity-dossier.js';
import type { ReliabilityCurve } from '../recalibration.js';
import type { CalibrationComparison } from '../forecast-journal.js';
import type { Recall } from '../episodic-memory.js';
import type { Estimate } from '../probability-aggregation.js';
import type { CollectionAction } from '../evoi-planner.js';

// ── Flag API ──────────────────────────────────────────────────────────────────

describe('cogFlags', () => {
  before(() => {
    // Clear flags before each suite.
    delete _lsStore['crystalball-cognition-flags-v1'];
  });

  it('defaults all flags to true', () => {
    assert.strictEqual(cogFlags.get('episodic-memory'), true);
    assert.strictEqual(cogFlags.get('personalization'), true);
    assert.strictEqual(cogFlags.get('superforecast'), true);
  });

  it('persists a flag change', () => {
    cogFlags.set('episodic-memory', false);
    assert.strictEqual(cogFlags.get('episodic-memory'), false);
    // Other flags unaffected.
    assert.strictEqual(cogFlags.get('personalization'), true);
  });

  it('all() returns all three keys', () => {
    cogFlags.set('episodic-memory', true); // restore
    const flags = cogFlags.all();
    assert.ok('episodic-memory' in flags);
    assert.ok('personalization' in flags);
    assert.ok('superforecast' in flags);
  });

  it('survives malformed localStorage value by returning defaults', () => {
    _lsStore['crystalball-cognition-flags-v1'] = '{bad json';
    assert.strictEqual(cogFlags.get('episodic-memory'), true);
    delete _lsStore['crystalball-cognition-flags-v1'];
  });

  after(() => {
    delete _lsStore['crystalball-cognition-flags-v1'];
  });
});

// ── formatOutcomeBadge ────────────────────────────────────────────────────────

describe('formatOutcomeBadge', () => {
  it('materialized → [materialized]', () => {
    assert.strictEqual(formatOutcomeBadge('materialized'), '[materialized]');
  });
  it('fizzled → [fizzled]', () => {
    assert.strictEqual(formatOutcomeBadge('fizzled'), '[fizzled]');
  });
  it('contradictory flag takes precedence over outcome', () => {
    assert.strictEqual(formatOutcomeBadge('materialized', true), '[contradictory]');
  });
  it('undefined outcome → [pending]', () => {
    assert.strictEqual(formatOutcomeBadge(undefined), '[pending]');
  });
  it('partial → [partial]', () => {
    assert.strictEqual(formatOutcomeBadge('partial'), '[partial]');
  });
  it('unknown → [unknown]', () => {
    assert.strictEqual(formatOutcomeBadge('unknown'), '[unknown]');
  });
});

// ── formatSimilarityPct ───────────────────────────────────────────────────────

describe('formatSimilarityPct', () => {
  it('rounds to nearest percent', () => {
    assert.strictEqual(formatSimilarityPct(0.745), '75%');
    assert.strictEqual(formatSimilarityPct(0.5), '50%');
    assert.strictEqual(formatSimilarityPct(1.0), '100%');
    assert.strictEqual(formatSimilarityPct(0.0), '0%');
  });
});

// ── formatIntervalWhisker ────────────────────────────────────────────────────

describe('formatIntervalWhisker', () => {
  it('formats a normal interval', () => {
    assert.strictEqual(formatIntervalWhisker(0.62, 0.48, 0.76), '62% [48–76%]');
  });
  it('suppresses uninformative [0–100%] interval', () => {
    assert.strictEqual(formatIntervalWhisker(0.62, 0.0, 1.0), '62%');
  });
  it('falls back gracefully when lo/hi are undefined', () => {
    assert.strictEqual(formatIntervalWhisker(0.55, undefined, undefined), '55%');
  });
  it('rounds correctly at boundaries', () => {
    assert.strictEqual(formatIntervalWhisker(0.5, 0.35, 0.65), '50% [35–65%]');
  });
});

// ── formatEstimatesTable ──────────────────────────────────────────────────────

describe('formatEstimatesTable', () => {
  it('returns placeholder on empty array', () => {
    const result = formatEstimatesTable([]);
    assert.deepStrictEqual(result, ['(no estimates)']);
  });

  it('formats source / p% / weight correctly', () => {
    const estimates: Estimate[] = [
      { source: 'base-rate', p: 0.45, weight: 0.3 },
      { source: 'persona-analyst', p: 0.6, weight: 0.35 },
    ];
    const lines = formatEstimatesTable(estimates);
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0]?.includes('base-rate'));
    assert.ok(lines[0]?.includes('45%'));
    assert.ok(lines[0]?.includes('30%'));
    assert.ok(lines[1]?.includes('persona-analyst'));
    assert.ok(lines[1]?.includes('60%'));
    assert.ok(lines[1]?.includes('35%'));
  });
});

// ── formatSpreadLabel ─────────────────────────────────────────────────────────

describe('formatSpreadLabel', () => {
  it('≥0.30 → high disagreement', () => {
    assert.ok(formatSpreadLabel(0.32).includes('high disagreement'));
  });
  it('0.15–0.29 → moderate disagreement', () => {
    assert.ok(formatSpreadLabel(0.2).includes('moderate disagreement'));
  });
  it('<0.15 → consensus', () => {
    assert.ok(formatSpreadLabel(0.1).includes('consensus'));
  });
});

// ── formatTrajectoryArrow ─────────────────────────────────────────────────────

describe('formatTrajectoryArrow', () => {
  it('heating → ▲', () => { assert.strictEqual(formatTrajectoryArrow('heating'), '▲'); });
  it('stable → ▬', () => { assert.strictEqual(formatTrajectoryArrow('stable'), '▬'); });
  it('cooling → ▼', () => { assert.strictEqual(formatTrajectoryArrow('cooling'), '▼'); });
});

// ── formatTrajectoryTooltip ───────────────────────────────────────────────────

describe('formatTrajectoryTooltip', () => {
  const baseDossier: EntityDossier = {
    entity: 'RUS', entityType: 'country',
    firstSeen: 0, lastSeen: 0,
    timeline: [], heat: 0.5, trajectory: 'heating',
    trajectoryEvidence: { recent7dCount: 12, prior21dCount: 8, rateRatio: 2.25, recentWindowDays: 7, priorWindowDays: 21 },
    topAssociates: [],
  };

  it('includes event counts', () => {
    const tip = formatTrajectoryTooltip(baseDossier);
    assert.ok(tip.includes('12'));
    assert.ok(tip.includes('8'));
  });

  it('includes rate ratio when available', () => {
    const tip = formatTrajectoryTooltip(baseDossier);
    assert.ok(tip.includes('rate ratio'));
  });

  it('handles null rateRatio gracefully', () => {
    const d = { ...baseDossier, trajectoryEvidence: { ...baseDossier.trajectoryEvidence, rateRatio: null } };
    const tip = formatTrajectoryTooltip(d);
    assert.ok(tip.includes('insufficient samples'));
  });
});

// ── formatCalibrationSummary ──────────────────────────────────────────────────

describe('formatCalibrationSummary', () => {
  const emptyBins = Array.from({ length: 10 }, (_, i) => ({
    lo: i * 0.1, hi: (i + 1) * 0.1, n: 0, predictedMean: 0, observedRate: 0,
  }));

  it('returns accumulating message when n=0', () => {
    const curve: ReliabilityCurve = {
      domain: 'global', bins: emptyBins, sampleSize: 0, brier: 0, generatedAt: 0,
    };
    const summary = formatCalibrationSummary(curve);
    assert.ok(summary.includes('accumulating'));
  });

  it('includes Brier score and n', () => {
    const bins = emptyBins.map((b, i) =>
      i === 5 ? { ...b, n: 10, predictedMean: 0.55, observedRate: 0.3 } : b,
    );
    const curve: ReliabilityCurve = {
      domain: 'global', bins, sampleSize: 52, brier: 0.183, generatedAt: 0,
    };
    const summary = formatCalibrationSummary(curve);
    assert.ok(summary.includes('0.183'));
    assert.ok(summary.includes('n=52'));
  });

  it('identifies the most miscalibrated bin', () => {
    const bins = emptyBins.map((b, i) =>
      i === 6 ? { ...b, n: 8, predictedMean: 0.65, observedRate: 0.2 } : b,
    );
    const curve: ReliabilityCurve = {
      domain: 'global', bins, sampleSize: 30, brier: 0.2, generatedAt: 0,
    };
    const summary = formatCalibrationSummary(curve);
    // Bin 6 = [0.6, 0.7)
    assert.ok(summary.includes('60'));
    assert.ok(summary.includes('70'));
  });
});

// ── formatComparisonLine ──────────────────────────────────────────────────────

describe('formatComparisonLine', () => {
  const emptyCurve: ReliabilityCurve = {
    domain: 'global', bins: [], sampleSize: 0, brier: 0, generatedAt: 0,
  };

  it('prompts to log more when humanEdge is null', () => {
    const cmp: CalibrationComparison = {
      domain: 'global',
      operator: { brier: 0, n: 5, curve: emptyCurve },
      system: { brier: 0, n: 10, curve: emptyCurve },
      humanEdge: null,
      explanation: 'Insufficient data',
    };
    const line = formatComparisonLine(cmp);
    assert.ok(line.includes('more forecasts'));
  });

  it('positive humanEdge → you outperform', () => {
    const cmp: CalibrationComparison = {
      domain: 'global',
      operator: { brier: 0.15, n: 40, curve: emptyCurve },
      system: { brier: 0.20, n: 40, curve: emptyCurve },
      humanEdge: 0.05,
      explanation: '',
    };
    const line = formatComparisonLine(cmp);
    assert.ok(line.includes('outperform'));
    assert.ok(line.includes('+0.05') || line.includes('+0.050'));
  });

  it('negative humanEdge → system outperforms', () => {
    const cmp: CalibrationComparison = {
      domain: 'global',
      operator: { brier: 0.25, n: 40, curve: emptyCurve },
      system: { brier: 0.18, n: 40, curve: emptyCurve },
      humanEdge: -0.07,
      explanation: '',
    };
    const line = formatComparisonLine(cmp);
    assert.ok(line.includes('System outperforms'));
  });

  it('zero humanEdge → equally calibrated', () => {
    const cmp: CalibrationComparison = {
      domain: 'global',
      operator: { brier: 0.18, n: 40, curve: emptyCurve },
      system: { brier: 0.18, n: 40, curve: emptyCurve },
      humanEdge: 0,
      explanation: '',
    };
    const line = formatComparisonLine(cmp);
    assert.ok(line.includes('equally calibrated'));
  });
});

// ── formatEvoiChip ────────────────────────────────────────────────────────────

describe('formatEvoiChip', () => {
  it('includes label and bits', () => {
    const action: CollectionAction = {
      label: 'Check crack spread',
      expectedInfoGainBits: 0.114,
      effort: 'glance',
      explanation: 'test',
    };
    const chip = formatEvoiChip(action);
    assert.ok(chip.includes('Check crack spread'));
    assert.ok(chip.includes('0.11') || chip.includes('0.114'));
    assert.ok(chip.includes('bits'));
  });
});

// ── formatAnalogLine ──────────────────────────────────────────────────────────

describe('formatAnalogLine', () => {
  const baseEpisode = {
    id: 'ep-1', kind: 'hypothesis' as const,
    signature: 'sig', summary: 'Black Sea wheat disruption',
    domains: ['commodity'], entities: ['Ukraine', 'wheat'],
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    vector: [], tier: 'hashed' as const,
    outcome: 'materialized' as const,
  };

  it('includes similarity %, outcome badge, and explanation', () => {
    const recall: Recall = {
      episode: baseEpisode,
      similarity: 0.78,
      ageDays: 5,
      explanation: 'matched on: Ukraine, wheat',
    };
    const line = formatAnalogLine(recall);
    assert.ok(line.includes('78%'));
    assert.ok(line.includes('[materialized]'));
    assert.ok(line.includes('matched on: Ukraine, wheat'));
  });

  it('shows today for <1 day old episode', () => {
    const recall: Recall = {
      episode: { ...baseEpisode, outcome: 'fizzled' },
      similarity: 0.6,
      ageDays: 0.5,
      explanation: 'matched on: crude oil',
    };
    const line = formatAnalogLine(recall);
    assert.ok(line.includes('today'));
  });

  it('shows months for old episodes', () => {
    const recall: Recall = {
      episode: { ...baseEpisode },
      similarity: 0.55,
      ageDays: 65,
      explanation: 'matched on: energy',
    };
    const line = formatAnalogLine(recall);
    assert.ok(line.includes('mo ago') || line.includes('2mo ago'));
  });

  it('respects contradictory flag in badge', () => {
    const recall: Recall = {
      episode: { ...baseEpisode, contradictory: true },
      similarity: 0.7,
      ageDays: 10,
      explanation: 'matched on: wheat',
    };
    const line = formatAnalogLine(recall);
    assert.ok(line.includes('[contradictory]'));
  });
});
