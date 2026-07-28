import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDecisionBoardView } from '../decision-consequence-view.ts';
import type { DecisionConsequence, MoveConsequence } from '../decision-consequence.ts';

function consequence(over: Partial<MoveConsequence> = {}): MoveConsequence {
  return {
    moveId: over.moveId ?? 'shelter',
    moveLabel: over.moveLabel ?? 'Shelter interior room',
    cost: over.cost ?? 'free',
    leadTimeMins: over.leadTimeMins ?? 0,
    baselineExpected: over.baselineExpected ?? 80,
    movedExpected: over.movedExpected ?? 68,
    expectedReduction: over.expectedReduction ?? 12,
    tailReduction: over.tailReduction ?? 8,
    residualPeakAxis: 'residualPeakAxis' in over ? (over.residualPeakAxis ?? null) : 'supply',
    axisImpacts: over.axisImpacts ?? [],
    rationale: over.rationale ?? 'Cuts expected Physical safety peak from 80 to 68 (−12).',
  };
}

function decision(over: Partial<DecisionConsequence> = {}): DecisionConsequence {
  const consequences = over.consequences ?? [];
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    consequences,
    recommendedMoveId: over.recommendedMoveId ?? null,
    headline: over.headline ?? 'test headline',
  };
}

test('empty decision → neutral, empty, headline passed through', () => {
  const view = buildDecisionBoardView(decision({ headline: 'No branches to evaluate.' }));
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.rows.length, 0);
  assert.equal(view.recommendedMoveId, null);
  assert.equal(view.headline, 'No branches to evaluate.');
});

test('title is the constant board title', () => {
  const view = buildDecisionBoardView(decision());
  assert.equal(view.title, 'If I act now');
});

test('recommended move → act card + act row flagged', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ moveId: 'shelter' })], recommendedMoveId: 'shelter' }),
  );
  assert.equal(view.tone, 'act');
  assert.equal(view.recommendedMoveId, 'shelter');
  assert.equal(view.rows[0]!.isRecommended, true);
  assert.equal(view.rows[0]!.tone, 'act');
});

test('non-recommended but material move → prepare tone', () => {
  const view = buildDecisionBoardView(
    decision({
      consequences: [consequence({ moveId: 'a', expectedReduction: 6 })],
      recommendedMoveId: null,
    }),
  );
  assert.equal(view.rows[0]!.isRecommended, false);
  assert.equal(view.rows[0]!.tone, 'prepare');
});

test('no-effect move → muted tone and 0 pts metric', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ moveId: 'a', expectedReduction: 0 })] }),
  );
  assert.equal(view.rows[0]!.tone, 'muted');
  assert.equal(view.rows[0]!.metric, '0 pts');
});

test('card tone is muted when consequences exist but none is recommended', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ expectedReduction: 0 })], recommendedMoveId: null }),
  );
  assert.equal(view.tone, 'muted');
});

test('metric shows improvement as −N pts', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ expectedReduction: 12.4 })] }),
  );
  assert.equal(view.rows[0]!.metric, '−12 pts');
});

test('metric shows a worsening move as +N pts', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ expectedReduction: -7 })] }),
  );
  assert.equal(view.rows[0]!.metric, '+7 pts');
});

test('lead time: 0 → now', () => {
  const view = buildDecisionBoardView(decision({ consequences: [consequence({ leadTimeMins: 0 })] }));
  assert.equal(view.rows[0]!.leadTimeLabel, 'now');
});

test('lead time: sub-hour → N min', () => {
  const view = buildDecisionBoardView(decision({ consequences: [consequence({ leadTimeMins: 45 })] }));
  assert.equal(view.rows[0]!.leadTimeLabel, '45 min');
});

test('lead time: multi-hour → N h', () => {
  const view = buildDecisionBoardView(decision({ consequences: [consequence({ leadTimeMins: 120 })] }));
  assert.equal(view.rows[0]!.leadTimeLabel, '2 h');
});

test('cost label capitalizes the cost tier', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ cost: 'medium' })] }),
  );
  assert.equal(view.rows[0]!.costLabel, 'Medium');
});

test('residual label names the still-worst axis, empty when none', () => {
  const withAxis = buildDecisionBoardView(
    decision({ consequences: [consequence({ residualPeakAxis: 'supply' })] }),
  );
  assert.equal(withAxis.rows[0]!.residualLabel, 'Still worst: Supply');
  const noAxis = buildDecisionBoardView(
    decision({ consequences: [consequence({ residualPeakAxis: null })] }),
  );
  assert.equal(noAxis.rows[0]!.residualLabel, '');
});

test('rows preserve the sim ranking order', () => {
  const view = buildDecisionBoardView(
    decision({
      consequences: [
        consequence({ moveId: 'first' }),
        consequence({ moveId: 'second' }),
        consequence({ moveId: 'third' }),
      ],
    }),
  );
  assert.deepEqual(view.rows.map((r) => r.moveId), ['first', 'second', 'third']);
});

test('maxRows caps rows and reports overflow', () => {
  const consequences = Array.from({ length: 6 }, (_, i) => consequence({ moveId: `m${i}` }));
  const view = buildDecisionBoardView(decision({ consequences }), { maxRows: 2 });
  assert.equal(view.rows.length, 2);
  assert.equal(view.overflow, 4);
  assert.equal(view.overflowLabel, '+4 more');
});

test('default cap is 4 rows', () => {
  const consequences = Array.from({ length: 6 }, (_, i) => consequence({ moveId: `m${i}` }));
  const view = buildDecisionBoardView(decision({ consequences }));
  assert.equal(view.rows.length, 4);
  assert.equal(view.overflow, 2);
});

test('non-positive maxRows collapses to zero rows, everything overflows', () => {
  const consequences = [consequence({ moveId: 'a' }), consequence({ moveId: 'b' })];
  const view = buildDecisionBoardView(decision({ consequences }), { maxRows: 0 });
  assert.equal(view.rows.length, 0);
  assert.equal(view.overflow, 2);
});

test('rationale is carried verbatim', () => {
  const view = buildDecisionBoardView(
    decision({ consequences: [consequence({ rationale: 'Trims the worst-case tail by 8.' })] }),
  );
  assert.equal(view.rows[0]!.rationale, 'Trims the worst-case tail by 8.');
});
