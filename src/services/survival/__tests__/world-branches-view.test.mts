// src/services/survival/__tests__/world-branches-view.test.mts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorldBranchesBoardView } from '../world-branches-view.ts';
import type {
  AxisBranch,
  AxisBranchSet,
  BranchKind,
  WorldBranches,
} from '../world-branches.ts';
import type { SurvivalAxis } from '../survival-types.ts';
import { bandForLevel } from '../survival-types.ts';

// ── fixture builders ─────────────────────────────────────────────────────────

function branch(
  axis: SurvivalAxis,
  horizonId: string,
  kind: BranchKind,
  probability: number,
  level: number,
): AxisBranch {
  const band = bandForLevel(level);
  return {
    axis,
    horizonId,
    kind,
    probability,
    level,
    band,
    rationale: `${axis} ${kind} → ${band} by ${horizonId}.`,
  };
}

/** Build a fan for one axis-horizon. escLevel/holdLevel/easeLevel drive bands;
 *  probabilities default to a plausible escalate<hold spread but are overridable. */
function fan(
  over: Partial<{
    axis: SurvivalAxis;
    horizonId: string;
    escLevel: number;
    holdLevel: number;
    easeLevel: number;
    pEsc: number;
    pHold: number;
    pEase: number;
    expectedLevel: number;
    mostLikely: BranchKind;
  }> = {},
): AxisBranchSet {
  const axis = over.axis ?? 'supply';
  const horizonId = over.horizonId ?? '24h';
  const escLevel = over.escLevel ?? 80;
  const holdLevel = over.holdLevel ?? 55;
  const easeLevel = over.easeLevel ?? 30;
  const pEsc = over.pEsc ?? 0.2;
  const pHold = over.pHold ?? 0.6;
  const pEase = over.pEase ?? 0.2;
  const branches: AxisBranch[] = [
    branch(axis, horizonId, 'escalate', pEsc, escLevel),
    branch(axis, horizonId, 'hold', pHold, holdLevel),
    branch(axis, horizonId, 'ease', pEase, easeLevel),
  ];
  const expectedLevel =
    over.expectedLevel ?? pEsc * escLevel + pHold * holdLevel + pEase * easeLevel;
  return {
    axis,
    horizonId,
    branches,
    expectedLevel,
    expectedBand: bandForLevel(expectedLevel),
    mostLikely: over.mostLikely ?? 'hold',
  };
}

function branches(over: Partial<WorldBranches> = {}): WorldBranches {
  const axisSets = over.axisSets ?? [fan()];
  const horizons =
    over.horizons ??
    [...new Set(axisSets.map((s) => s.horizonId))].map((id) => ({ id, mins: 60 }));
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    horizons,
    axisSets,
    headline: over.headline ?? 'headline text',
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('title is the constant board title, headline passes through', () => {
  const view = buildWorldBranchesBoardView(branches({ headline: 'Supply could escalate.' }));
  assert.equal(view.title, 'What could happen');
  assert.equal(view.headline, 'Supply could escalate.');
});

test('each fan yields exactly three chips in escalate → hold → ease order', () => {
  const view = buildWorldBranchesBoardView(branches());
  const row = view.horizons[0].rows[0];
  assert.deepEqual(
    row.chips.map((c) => c.kind),
    ['escalate', 'hold', 'ease'],
  );
  assert.deepEqual(
    row.chips.map((c) => c.kindLabel),
    ['Escalate', 'Hold', 'Ease'],
  );
});

test('probability labels are integer-percent formatted and carry the raw value', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ pEsc: 0.22, pHold: 0.6, pEase: 0.18 })] }),
  );
  const chips = view.horizons[0].rows[0].chips;
  assert.equal(chips[0].probabilityPct, 22);
  assert.equal(chips[0].probabilityLabel, '22%');
  assert.equal(chips[0].probability, 0.22);
  assert.equal(chips[2].probabilityLabel, '18%');
});

test('chip tone follows each branch band, not the expected band', () => {
  // Calm expectation (ease-heavy) but a critical escalate tail.
  const view = buildWorldBranchesBoardView(
    branches({
      axisSets: [
        fan({ escLevel: 90, holdLevel: 30, easeLevel: 10, pEsc: 0.15, pHold: 0.35, pEase: 0.5, expectedLevel: 28 }),
      ],
    }),
  );
  const row = view.horizons[0].rows[0];
  assert.equal(row.tone, 'neutral'); // expected band guarded → neutral
  assert.equal(row.chips[0].tone, 'danger'); // escalate → critical → danger
});

test('row tone reads the calibrated expected band', () => {
  const critical = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ expectedLevel: 85 })] }),
  );
  assert.equal(critical.horizons[0].rows[0].tone, 'danger');

  const high = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ expectedLevel: 65 })] }),
  );
  assert.equal(high.horizons[0].rows[0].tone, 'caution');

  const elevated = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ expectedLevel: 45 })] }),
  );
  assert.equal(elevated.horizons[0].rows[0].tone, 'muted');

  const guarded = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ expectedLevel: 25 })] }),
  );
  assert.equal(guarded.horizons[0].rows[0].tone, 'neutral');
});

test('mostLikely branch is flagged and labelled', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ mostLikely: 'escalate' })] }),
  );
  const row = view.horizons[0].rows[0];
  assert.equal(row.mostLikely, 'escalate');
  assert.equal(row.mostLikelyLabel, 'Escalate');
  assert.equal(row.chips[0].isMostLikely, true);
  assert.equal(row.chips[1].isMostLikely, false);
  assert.equal(row.chips[2].isMostLikely, false);
});

test('expectedLevel is rounded for display; expectedBand passes through', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ expectedLevel: 54.7 })] }),
  );
  const row = view.horizons[0].rows[0];
  assert.equal(row.expectedLevel, 55);
  assert.equal(row.expectedBand, 'elevated');
});

test('downsideLabel summarises the escalate tail above the material floor', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ escLevel: 82, pEsc: 0.22 })] }),
  );
  assert.equal(view.horizons[0].rows[0].downsideLabel, '22% → critical');
});

test('downsideLabel is empty when the escalate branch is sub-material', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ escLevel: 15, holdLevel: 10, easeLevel: 5, expectedLevel: 10 })] }),
  );
  assert.equal(view.horizons[0].rows[0].downsideLabel, '');
});

test('topDownside picks the largest probability-weighted escalate branch', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      axisSets: [
        fan({ axis: 'supply', escLevel: 70, pEsc: 0.3 }), // score 21
        fan({ axis: 'financial', escLevel: 90, pEsc: 0.4 }), // score 36
      ],
    }),
  );
  assert.ok(view.topDownside);
  assert.equal(view.topDownside?.axis, 'financial');
  assert.equal(view.topDownside?.band, 'critical');
  assert.equal(view.topDownside?.probabilityPct, 40);
  assert.equal(view.topDownside?.label, 'Financial → critical (~40%) by 24h');
});

test('topDownside filters materiality BEFORE ranking (sub-material high-prob loses)', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      axisSets: [
        // huge probability but sub-material level → must be excluded
        fan({ axis: 'comms', escLevel: 15, holdLevel: 10, easeLevel: 5, pEsc: 0.9, expectedLevel: 10 }),
        // lower score but genuinely material critical branch → must win
        fan({ axis: 'supply', escLevel: 88, pEsc: 0.25 }),
      ],
    }),
  );
  assert.equal(view.topDownside?.axis, 'supply');
});

test('topDownside is null when no escalate branch is material', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      axisSets: [fan({ escLevel: 12, holdLevel: 8, easeLevel: 4, expectedLevel: 8 })],
    }),
  );
  assert.equal(view.topDownside, null);
});

test('card tone is the worst row tone across the whole fan', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      axisSets: [
        fan({ axis: 'comms', horizonId: '6h', expectedLevel: 25 }), // neutral
        fan({ axis: 'supply', horizonId: '6h', expectedLevel: 85 }), // danger
      ],
    }),
  );
  assert.equal(view.tone, 'danger');
});

test('per-horizon grouping preserves the core order and caps rows with overflow', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      horizons: [{ id: '6h', mins: 360 }],
      axisSets: [
        fan({ axis: 'supply', horizonId: '6h', expectedLevel: 80 }),
        fan({ axis: 'financial', horizonId: '6h', expectedLevel: 60 }),
        fan({ axis: 'mobility', horizonId: '6h', expectedLevel: 40 }),
        fan({ axis: 'comms', horizonId: '6h', expectedLevel: 20 }),
      ],
    }),
    { maxAxesPerHorizon: 2 },
  );
  const col = view.horizons[0];
  assert.equal(col.rows.length, 2);
  assert.deepEqual(
    col.rows.map((r) => r.axis),
    ['supply', 'financial'],
  );
  assert.equal(col.overflow, 2);
  assert.equal(col.overflowLabel, '+2 more');
});

test('maxAxesPerHorizon floors to 1 so a horizon never blanks', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      horizons: [{ id: '6h', mins: 360 }],
      axisSets: [
        fan({ axis: 'supply', horizonId: '6h', expectedLevel: 80 }),
        fan({ axis: 'financial', horizonId: '6h', expectedLevel: 60 }),
      ],
    }),
    { maxAxesPerHorizon: 0 },
  );
  assert.equal(view.horizons[0].rows.length, 1);
  assert.equal(view.horizons[0].overflow, 1);
});

test('worstExpectedBand reads all axes at the horizon, not just shown rows', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      horizons: [{ id: '6h', mins: 360 }],
      axisSets: [
        fan({ axis: 'supply', horizonId: '6h', expectedLevel: 45 }), // shown, elevated
        fan({ axis: 'financial', horizonId: '6h', expectedLevel: 90 }), // capped-out, critical
      ],
    }),
    { maxAxesPerHorizon: 1 },
  );
  const col = view.horizons[0];
  assert.equal(col.rows.length, 1);
  assert.equal(col.worstExpectedBand, 'critical');
});

test('multiple horizons each get their own column in core order', () => {
  const view = buildWorldBranchesBoardView(
    branches({
      horizons: [
        { id: '6h', mins: 360 },
        { id: '24h', mins: 1440 },
      ],
      axisSets: [
        fan({ axis: 'supply', horizonId: '6h', expectedLevel: 50 }),
        fan({ axis: 'supply', horizonId: '24h', expectedLevel: 70 }),
      ],
    }),
  );
  assert.equal(view.horizons.length, 2);
  assert.equal(view.horizons[0].horizonId, '6h');
  assert.equal(view.horizons[0].horizonMins, 360);
  assert.equal(view.horizons[1].horizonId, '24h');
});

test('empty branches → isEmpty, neutral tone, null downside, no horizons', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [], horizons: [], headline: 'No posture data to branch.' }),
  );
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.topDownside, null);
  assert.deepEqual(view.horizons, []);
});

test('populated branches → not empty', () => {
  const view = buildWorldBranchesBoardView(branches());
  assert.equal(view.isEmpty, false);
});

test('chip levels and bands carry through verbatim', () => {
  const view = buildWorldBranchesBoardView(
    branches({ axisSets: [fan({ escLevel: 88, holdLevel: 52, easeLevel: 18 })] }),
  );
  const chips = view.horizons[0].rows[0].chips;
  assert.deepEqual(
    chips.map((c) => c.level),
    [88, 52, 18],
  );
  assert.deepEqual(
    chips.map((c) => c.band),
    ['critical', 'elevated', 'secure'],
  );
});

test('chip rationale is carried verbatim from the core', () => {
  const view = buildWorldBranchesBoardView(branches({ axisSets: [fan({ axis: 'supply' })] }));
  const chip = view.horizons[0].rows[0].chips[0];
  assert.equal(chip.rationale, 'supply escalate → critical by 24h.');
});
