// src/services/survival/__tests__/survival-posture-view.test.mts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSurvivalPostureBoardView } from '../survival-posture-view.ts';
import type {
  AxisState,
  PostureThreat,
  SurvivalAxis,
  SurvivalPosture,
} from '../survival-types.ts';
import { bandForLevel, bandRank } from '../survival-types.ts';
import type { ConfidenceBreakdown } from '../../intelligence/types.ts';

// ── fixture builders ─────────────────────────────────────────────────────────

function confidence(total: number, max: number): ConfidenceBreakdown {
  return {
    total,
    max,
    items: [{ label: 'src', value: total, max, polarity: 'positive' }],
  };
}

function threat(over: Partial<PostureThreat> = {}): PostureThreat {
  return {
    sourceEventId: over.sourceEventId ?? 'evt-1',
    axis: over.axis ?? 'physical_safety',
    severity: over.severity ?? 60,
    threatLevel: over.threatLevel ?? 'high',
    hazardKind: over.hazardKind ?? 'tornado',
    hazardLabel: over.hazardLabel ?? 'Tornado Warning',
    // key-presence checks so an explicit null survives (?? would coerce it back).
    timeToImpactMins: 'timeToImpactMins' in over ? (over.timeToImpactMins ?? null) : 45,
    arrivalLabel: 'arrivalLabel' in over ? (over.arrivalLabel ?? null) : '35-55 min',
    why: over.why ?? 'polygon intersects saved place',
    confidenceLabel: over.confidenceLabel ?? 'high',
  };
}

function axisState(
  over: Partial<AxisState> & { axis: SurvivalAxis; level: number },
): AxisState {
  return {
    axis: over.axis,
    level: over.level,
    band: over.band ?? bandForLevel(over.level),
    trend: over.trend ?? 'steady',
    threats: over.threats ?? [],
    confidence: over.confidence ?? confidence(80, 100),
    explanation: over.explanation ?? {
      headline: `${over.axis} explanation`,
      lines: [],
      missingConfirmation: [],
    },
    drivers: over.drivers ?? [`${over.axis} driver`],
  };
}

function posture(over: Partial<SurvivalPosture> = {}): SurvivalPosture {
  const axes = over.axes ?? [axisState({ axis: 'supply', level: 55 })];
  // Derive overall from worst axis unless explicitly overridden.
  const worst = axes.reduce(
    (w, a) => (bandRank(a.band) > bandRank(w.band) || (a.band === w.band && a.level > w.level) ? a : w),
    axes[0] ?? axisState({ axis: 'supply', level: 0 }),
  );
  return {
    axes,
    overallLevel: over.overallLevel ?? (axes.length > 0 ? worst.level : 0),
    overallBand: over.overallBand ?? (axes.length > 0 ? worst.band : 'secure'),
    worstAxis: over.worstAxis ?? (axes.length > 0 ? worst.axis : 'supply'),
    headline: over.headline ?? 'headline text',
    capturedAtMs: over.capturedAtMs ?? 0,
    staleInputs: over.staleInputs ?? [],
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('title is the constant board title, headline passes through', () => {
  const view = buildSurvivalPostureBoardView(posture({ headline: 'Supply at high.' }));
  assert.equal(view.title, 'Survival posture');
  assert.equal(view.headline, 'Supply at high.');
});

test('overall level / band / worst axis pass through with a title', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [axisState({ axis: 'financial', level: 85 })],
      overallLevel: 85,
      overallBand: 'critical',
      worstAxis: 'financial',
    }),
  );
  assert.equal(view.overallLevel, 85);
  assert.equal(view.overallBand, 'critical');
  assert.equal(view.worstAxis, 'financial');
  assert.equal(view.worstAxisTitle, 'Financial');
});

test('rows are sorted worst-first by band then level', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'comms', level: 20 }), // guarded
        axisState({ axis: 'supply', level: 85 }), // critical
        axisState({ axis: 'mobility', level: 55 }), // elevated
        axisState({ axis: 'health', level: 65 }), // high
      ],
    }),
  );
  assert.deepEqual(
    view.rows.map((r) => r.axis),
    ['supply', 'health', 'mobility', 'comms'],
  );
});

test('worst-first tie on band breaks by level, then stable axis order', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'security', level: 42 }), // elevated
        axisState({ axis: 'mobility', level: 48 }), // elevated, higher level
        axisState({ axis: 'comms', level: 42 }), // elevated, same level as security → axis order
      ],
    }),
  );
  assert.deepEqual(
    view.rows.map((r) => r.axis),
    ['mobility', 'comms', 'security'],
  );
});

test('trend labels are Title Case', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'supply', level: 80, trend: 'worsening' }),
        axisState({ axis: 'comms', level: 30, trend: 'improving' }),
        axisState({ axis: 'health', level: 30, trend: 'steady' }),
      ],
    }),
  );
  const byAxis = Object.fromEntries(view.rows.map((r) => [r.axis, r.trendLabel]));
  assert.equal(byAxis.supply, 'Worsening');
  assert.equal(byAxis.comms, 'Improving');
  assert.equal(byAxis.health, 'Steady');
});

test('row tone blends band with trend', () => {
  const worseningCritical = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 85, trend: 'worsening' })] }),
  );
  assert.equal(worseningCritical.rows[0].tone, 'danger');

  const steadyHigh = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 65, trend: 'steady' })] }),
  );
  assert.equal(steadyHigh.rows[0].tone, 'caution');

  const improvingCritical = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 90, trend: 'improving' })] }),
  );
  assert.equal(improvingCritical.rows[0].tone, 'caution');

  const worseningElevated = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 45, trend: 'worsening' })] }),
  );
  assert.equal(worseningElevated.rows[0].tone, 'caution');

  const steadyElevated = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 45, trend: 'steady' })] }),
  );
  assert.equal(steadyElevated.rows[0].tone, 'muted');

  const steadyGuarded = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 25, trend: 'steady' })] }),
  );
  assert.equal(steadyGuarded.rows[0].tone, 'neutral');
});

test('card tone is the worst row tone across every axis', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'comms', level: 25, trend: 'steady' }), // neutral
        axisState({ axis: 'supply', level: 85, trend: 'worsening' }), // danger
      ],
    }),
  );
  assert.equal(view.tone, 'danger');
});

test('topDriver reads drivers[0]; falls back when empty', () => {
  const withDriver = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, drivers: ['grain export halt', 'x'] })] }),
  );
  assert.equal(withDriver.rows[0].topDriver, 'grain export halt');

  const noDriver = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, drivers: [] })] }),
  );
  assert.equal(noDriver.rows[0].topDriver, 'no active drivers');
});

test('confidence percent + label derive from the ConfidenceBreakdown ratio', () => {
  const high = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, confidence: confidence(90, 100) })] }),
  );
  assert.equal(high.rows[0].confidencePct, 90);
  assert.equal(high.rows[0].confidenceLabel, 'High');

  const medium = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, confidence: confidence(30, 50) })] }),
  );
  assert.equal(medium.rows[0].confidencePct, 60);
  assert.equal(medium.rows[0].confidenceLabel, 'Medium');

  const low = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, confidence: confidence(10, 100) })] }),
  );
  assert.equal(low.rows[0].confidencePct, 10);
  assert.equal(low.rows[0].confidenceLabel, 'Low');
});

test('confidence percent is 0 when the breakdown max is zero (no divide-by-zero)', () => {
  const view = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, confidence: confidence(0, 0) })] }),
  );
  assert.equal(view.rows[0].confidencePct, 0);
  assert.equal(view.rows[0].confidenceLabel, 'Low');
});

test('lead threat prefers the soonest impact', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({
          axis: 'physical_safety',
          level: 80,
          threats: [
            threat({ hazardLabel: 'Flood Warning', timeToImpactMins: 120, arrivalLabel: '2 hr' }),
            threat({ hazardLabel: 'Tornado Warning', timeToImpactMins: 30, arrivalLabel: '30 min' }),
          ],
        }),
      ],
    }),
  );
  const row = view.rows[0];
  assert.equal(row.threatCount, 2);
  assert.equal(row.leadThreat?.hazardLabel, 'Tornado Warning');
  assert.equal(row.leadThreatLabel, 'Tornado Warning · 30 min');
});

test('a known arrival beats an unknown one regardless of order', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({
          axis: 'physical_safety',
          level: 80,
          threats: [
            threat({ hazardLabel: 'Known', timeToImpactMins: 90, arrivalLabel: '90 min' }),
            threat({ hazardLabel: 'Unknown', timeToImpactMins: null, arrivalLabel: null, severity: 99 }),
          ],
        }),
      ],
    }),
  );
  assert.equal(view.rows[0].leadThreat?.hazardLabel, 'Known');
});

test('among unknown-arrival threats the highest severity leads; no arrival label', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({
          axis: 'physical_safety',
          level: 80,
          threats: [
            threat({ hazardLabel: 'Minor', timeToImpactMins: null, arrivalLabel: null, severity: 20 }),
            threat({ hazardLabel: 'Major', timeToImpactMins: null, arrivalLabel: null, severity: 70 }),
          ],
        }),
      ],
    }),
  );
  const row = view.rows[0];
  assert.equal(row.leadThreat?.hazardLabel, 'Major');
  assert.equal(row.leadThreat?.arrivalLabel, '');
  assert.equal(row.leadThreatLabel, 'Major');
});

test('an axis with no threats has a null lead threat and empty label', () => {
  const view = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 50, threats: [] })] }),
  );
  const row = view.rows[0];
  assert.equal(row.threatCount, 0);
  assert.equal(row.leadThreat, null);
  assert.equal(row.leadThreatLabel, '');
});

test('axesAtRiskCount counts elevated-or-worse across the whole posture', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'supply', level: 85 }), // critical → at risk
        axisState({ axis: 'health', level: 65 }), // high → at risk
        axisState({ axis: 'mobility', level: 45 }), // elevated → at risk
        axisState({ axis: 'comms', level: 25 }), // guarded → not
        axisState({ axis: 'security', level: 5 }), // secure → not
      ],
    }),
  );
  assert.equal(view.axesAtRiskCount, 3);
});

test('maxAxes caps rows worst-first and reports overflow; count fields read all', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'supply', level: 85 }),
        axisState({ axis: 'health', level: 65 }),
        axisState({ axis: 'mobility', level: 45 }),
        axisState({ axis: 'comms', level: 42 }),
      ],
    }),
    { maxAxes: 2 },
  );
  assert.equal(view.rows.length, 2);
  assert.deepEqual(
    view.rows.map((r) => r.axis),
    ['supply', 'health'],
  );
  assert.equal(view.overflow, 2);
  assert.equal(view.overflowLabel, '+2 more');
  assert.equal(view.axesAtRiskCount, 4); // still counts the capped-out rows
});

test('maxAxes floors to 1 so the card never blanks', () => {
  const view = buildSurvivalPostureBoardView(
    posture({
      axes: [
        axisState({ axis: 'supply', level: 85 }),
        axisState({ axis: 'health', level: 65 }),
      ],
    }),
    { maxAxes: 0 },
  );
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].axis, 'supply');
  assert.equal(view.overflow, 1);
});

test('stale inputs are surfaced verbatim with a pluralised label', () => {
  const one = buildSurvivalPostureBoardView(posture({ staleInputs: ['nws'] }));
  assert.deepEqual(one.staleInputs, ['nws']);
  assert.equal(one.staleLabel, '1 stale input');

  const two = buildSurvivalPostureBoardView(posture({ staleInputs: ['nws', 'eia'] }));
  assert.equal(two.staleLabel, '2 stale inputs');

  const none = buildSurvivalPostureBoardView(posture({ staleInputs: [] }));
  assert.equal(none.staleLabel, '');
});

test('allClear is true only when overall level is zero', () => {
  const clear = buildSurvivalPostureBoardView(
    posture({
      axes: [axisState({ axis: 'supply', level: 0 })],
      overallLevel: 0,
      overallBand: 'secure',
    }),
  );
  assert.equal(clear.allClear, true);

  const active = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 30 })] }),
  );
  assert.equal(active.allClear, false);
});

test('empty posture → isEmpty, neutral tone, null worst axis, no rows', () => {
  const view = buildSurvivalPostureBoardView(
    posture({ axes: [], overallLevel: 0, overallBand: 'secure', staleInputs: [] }),
  );
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.worstAxis, null);
  assert.equal(view.worstAxisTitle, '');
  assert.deepEqual(view.rows, []);
  assert.equal(view.axesAtRiskCount, 0);
});

test('populated posture → not empty', () => {
  const view = buildSurvivalPostureBoardView(posture());
  assert.equal(view.isEmpty, false);
});

test('level and band carry through verbatim on the row', () => {
  const view = buildSurvivalPostureBoardView(
    posture({ axes: [axisState({ axis: 'supply', level: 72, band: 'high' })] }),
  );
  assert.equal(view.rows[0].level, 72);
  assert.equal(view.rows[0].band, 'high');
});

test('staleInputs array is a copy, not the core reference', () => {
  const p = posture({ staleInputs: ['nws'] });
  const view = buildSurvivalPostureBoardView(p);
  view.staleInputs.push('mutated');
  assert.deepEqual(p.staleInputs, ['nws']);
});
