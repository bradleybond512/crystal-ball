import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPostureTrajectoryBoardView } from '../posture-trajectory-view.ts';
import type {
  AxisProjection,
  PostureTrajectory,
  TrajectoryHorizon,
} from '../posture-trajectory.ts';
import { bandForLevel } from '../survival-types.ts';

function proj(over: Partial<AxisProjection> = {}): AxisProjection {
  const projectedLevel = over.projectedLevel ?? 30;
  const currentLevel = over.currentLevel ?? projectedLevel;
  return {
    axis: over.axis ?? 'supply',
    horizonId: over.horizonId ?? '6h',
    horizonMins: over.horizonMins ?? 360,
    currentLevel,
    projectedLevel,
    projectedBand: over.projectedBand ?? bandForLevel(projectedLevel),
    delta: over.delta ?? projectedLevel - currentLevel,
    direction: over.direction ?? 'steady',
    confidence: over.confidence ?? 0.8,
    drivers: over.drivers ?? ['test driver'],
    rationale: over.rationale ?? 'test rationale',
  };
}

function trajectory(over: Partial<PostureTrajectory> = {}): PostureTrajectory {
  const projections = over.projections ?? [proj()];
  let peak: AxisProjection | null = null;
  for (const p of projections) if (!peak || p.projectedLevel > peak.projectedLevel) peak = p;
  const horizons: TrajectoryHorizon[] =
    over.horizons ??
    [...new Map(projections.map((p) => [p.horizonId, { id: p.horizonId, mins: p.horizonMins }])).values()];
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    horizons: horizons.length > 0 ? horizons : [{ id: '6h', mins: 360 }],
    projections,
    peakAxis: 'peakAxis' in over ? over.peakAxis! : peak ? peak.axis : null,
    peakLevel: over.peakLevel ?? (peak ? peak.projectedLevel : 0),
    peakHorizonId: 'peakHorizonId' in over ? over.peakHorizonId! : peak ? peak.horizonId : null,
    headline: over.headline ?? 'test headline',
  };
}

test('title is the constant board title', () => {
  assert.equal(buildPostureTrajectoryBoardView(trajectory()).title, 'Where this is heading');
});

test('headline is passed through verbatim', () => {
  const view = buildPostureTrajectoryBoardView(trajectory({ headline: 'Supply projected to reach high.' }));
  assert.equal(view.headline, 'Supply projected to reach high.');
});

test('directionLabel: escalating / steady / easing', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', direction: 'escalating', currentLevel: 40, projectedLevel: 70, delta: 30 }),
        proj({ axis: 'health', direction: 'steady', projectedLevel: 30 }),
        proj({ axis: 'comms', direction: 'easing', currentLevel: 70, projectedLevel: 40, delta: -30 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.horizons[0]!.rows.map((r) => [r.axis, r.directionLabel]));
  assert.equal(byAxis.supply, 'Escalating');
  assert.equal(byAxis.health, 'Steady');
  assert.equal(byAxis.comms, 'Easing');
});

test('deltaLabel is signed: rise → "+N pts", fall → "−N pts", flat → "0 pts"', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', currentLevel: 40, projectedLevel: 58, delta: 18, direction: 'escalating' }),
        proj({ axis: 'health', currentLevel: 70, projectedLevel: 64, delta: -6, direction: 'easing' }),
        proj({ axis: 'comms', currentLevel: 30, projectedLevel: 30, delta: 0 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.horizons[0]!.rows.map((r) => [r.axis, r.deltaLabel]));
  assert.equal(byAxis.supply, '+18 pts');
  assert.equal(byAxis.health, '−6 pts');
  assert.equal(byAxis.comms, '0 pts');
});

test('row tone: escalating into critical/high is danger, into a lower band is caution', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', direction: 'escalating', currentLevel: 40, projectedLevel: 85, delta: 45 }),
        proj({ axis: 'health', direction: 'escalating', currentLevel: 20, projectedLevel: 45, delta: 25 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.horizons[0]!.rows.map((r) => [r.axis, r.tone]));
  assert.equal(byAxis.supply, 'danger');
  assert.equal(byAxis.health, 'caution');
});

test('row tone: a steady high axis is caution, a steady low axis is muted, easing is neutral', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', direction: 'steady', projectedLevel: 72 }),
        proj({ axis: 'health', direction: 'steady', projectedLevel: 30 }),
        proj({ axis: 'comms', direction: 'easing', currentLevel: 70, projectedLevel: 45, delta: -25 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.horizons[0]!.rows.map((r) => [r.axis, r.tone]));
  assert.equal(byAxis.supply, 'caution');
  assert.equal(byAxis.health, 'muted');
  assert.equal(byAxis.comms, 'neutral');
});

test('card tone is the worst row tone across the whole trajectory', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'health', direction: 'steady', projectedLevel: 30 }),
        proj({ axis: 'supply', direction: 'escalating', currentLevel: 40, projectedLevel: 88, delta: 48 }),
      ],
    }),
  );
  assert.equal(view.tone, 'danger');
});

test('card tone counts capped-out rows too — a hidden escalation still colours the card', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'physical_safety', horizonId: '6h', direction: 'steady', projectedLevel: 30 }),
        proj({ axis: 'supply', horizonId: '6h', direction: 'steady', projectedLevel: 28 }),
        proj({ axis: 'health', horizonId: '6h', direction: 'escalating', currentLevel: 40, projectedLevel: 90, delta: 50 }),
      ],
    }),
    { maxAxesPerHorizon: 1 },
  );
  assert.equal(view.horizons[0]!.rows.length, 1);
  assert.equal(view.tone, 'danger');
});

test('confidenceLabel buckets: High ≥ 0.75, Medium ≥ 0.5, else Low', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', confidence: 0.9 }),
        proj({ axis: 'health', confidence: 0.6 }),
        proj({ axis: 'comms', confidence: 0.3 }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.horizons[0]!.rows.map((r) => [r.axis, r.confidenceLabel]));
  assert.equal(byAxis.supply, 'High');
  assert.equal(byAxis.health, 'Medium');
  assert.equal(byAxis.comms, 'Low');
});

test('rows are grouped per horizon in the core horizon order', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      horizons: [
        { id: '6h', mins: 360 },
        { id: '24h', mins: 1440 },
      ],
      projections: [
        proj({ axis: 'supply', horizonId: '6h', horizonMins: 360, projectedLevel: 50 }),
        proj({ axis: 'supply', horizonId: '24h', horizonMins: 1440, projectedLevel: 70 }),
      ],
    }),
  );
  assert.deepEqual(view.horizons.map((h) => h.horizonId), ['6h', '24h']);
  assert.equal(view.horizons[0]!.rows[0]!.projectedLevel, 50);
  assert.equal(view.horizons[1]!.rows[0]!.projectedLevel, 70);
});

test('maxAxesPerHorizon caps each horizon and reports overflow', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '6h', projectedLevel: 80 }),
        proj({ axis: 'health', horizonId: '6h', projectedLevel: 60 }),
        proj({ axis: 'comms', horizonId: '6h', projectedLevel: 40 }),
        proj({ axis: 'mobility', horizonId: '6h', projectedLevel: 20 }),
      ],
    }),
    { maxAxesPerHorizon: 2 },
  );
  assert.equal(view.horizons[0]!.rows.length, 2);
  assert.equal(view.horizons[0]!.overflow, 2);
  assert.equal(view.horizons[0]!.overflowLabel, '+2 more');
});

test('non-positive maxAxesPerHorizon is floored to 1 so each horizon keeps its worst axis', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '6h', projectedLevel: 80 }),
        proj({ axis: 'health', horizonId: '6h', projectedLevel: 40 }),
      ],
    }),
    { maxAxesPerHorizon: 0 },
  );
  assert.equal(view.horizons[0]!.rows.length, 1);
  assert.equal(view.horizons[0]!.rows[0]!.projectedLevel, 80);
  assert.equal(view.horizons[0]!.overflow, 1);
});

test('worstBand reflects all axes at a horizon, not just the shown rows', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '6h', projectedLevel: 45 }),
        proj({ axis: 'health', horizonId: '6h', projectedLevel: 85 }),
      ],
    }),
    { maxAxesPerHorizon: 1 },
  );
  // Only the level-85 (critical) axis is shown here, but even if a lower one led,
  // worstBand is computed over the full horizon set.
  assert.equal(view.horizons[0]!.worstBand, 'critical');
});

test('escalatingCount counts escalating projections across the whole trajectory', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '6h', direction: 'escalating', currentLevel: 40, projectedLevel: 60, delta: 20 }),
        proj({ axis: 'supply', horizonId: '24h', direction: 'escalating', currentLevel: 40, projectedLevel: 75, delta: 35 }),
        proj({ axis: 'health', horizonId: '6h', direction: 'steady', projectedLevel: 30 }),
      ],
    }),
  );
  assert.equal(view.escalatingCount, 2);
});

test('peak fields mirror the core, and peakBand is derived from peakLevel', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '24h', direction: 'escalating', currentLevel: 40, projectedLevel: 82, delta: 42 }),
      ],
      peakAxis: 'supply',
      peakLevel: 82,
      peakHorizonId: '24h',
    }),
  );
  assert.equal(view.peakAxis, 'supply');
  assert.equal(view.peakAxisTitle, 'Supply');
  assert.equal(view.peakLevel, 82);
  assert.equal(view.peakBand, 'critical');
  assert.equal(view.peakHorizonId, '24h');
});

test('peakCallout names axis, verb, band, and horizon for an escalating peak', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', horizonId: '24h', direction: 'escalating', currentLevel: 40, projectedLevel: 82, delta: 42 }),
      ],
      peakAxis: 'supply',
      peakLevel: 82,
      peakHorizonId: '24h',
    }),
  );
  assert.equal(view.peakCallout, 'Supply reaching critical by 24h');
});

test('peakCallout uses "holding at" for a steady peak', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [proj({ axis: 'security', horizonId: '6h', direction: 'steady', projectedLevel: 72 })],
      peakAxis: 'security',
      peakLevel: 72,
      peakHorizonId: '6h',
    }),
  );
  assert.equal(view.peakCallout, 'Security holding at high by 6h');
});

test('peakCallout is empty when the peak sits below the callout floor', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [proj({ axis: 'supply', horizonId: '6h', direction: 'steady', projectedLevel: 15 })],
      peakAxis: 'supply',
      peakLevel: 15,
      peakHorizonId: '6h',
    }),
  );
  assert.equal(view.peakCallout, '');
});

test('an axis with no drivers falls back to the no-escalation-drivers label', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({ projections: [proj({ axis: 'supply', drivers: [] })] }),
  );
  assert.equal(view.horizons[0]!.rows[0]!.topDriver, 'no active escalation drivers');
});

test('currentBand is derived from the current level and rationale is verbatim', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({
      projections: [
        proj({ axis: 'supply', currentLevel: 65, projectedLevel: 82, delta: 17, direction: 'escalating', rationale: 'Supply projected to reach critical by 24h (storm arriving 18h).' }),
      ],
    }),
  );
  const row = view.horizons[0]!.rows[0]!;
  assert.equal(row.currentBand, 'high');
  assert.equal(row.rationale, 'Supply projected to reach critical by 24h (storm arriving 18h).');
});

test('empty trajectory: isEmpty true, neutral tone, no peak, empty callout', () => {
  const view = buildPostureTrajectoryBoardView(
    trajectory({ projections: [], peakAxis: null, peakLevel: 0, peakHorizonId: null }),
  );
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.peakAxis, null);
  assert.equal(view.peakAxisTitle, '');
  assert.equal(view.peakCallout, '');
  assert.equal(view.escalatingCount, 0);
});

test('a populated trajectory is not empty', () => {
  assert.equal(buildPostureTrajectoryBoardView(trajectory()).isEmpty, false);
});
