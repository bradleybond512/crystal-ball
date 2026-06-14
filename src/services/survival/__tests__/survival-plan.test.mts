// src/services/survival/__tests__/survival-plan.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlan, commitMove, moveStatus, applyPlanToPosture } from '../survival-plan.ts';
import type { SurvivalMove, SurvivalPlan, SurvivalPosture, AxisState } from '../survival-types.ts';

const NOW = 1_700_000_000_000;

function axis(over: Partial<AxisState> & { axis: AxisState['axis'] }): AxisState {
  return {
    axis: over.axis, level: over.level ?? 0, band: over.band ?? 'secure', trend: over.trend ?? 'steady',
    threats: over.threats ?? [], drivers: over.drivers ?? [],
    confidence: over.confidence ?? { total: over.level ?? 0, max: 100, items: [] },
    explanation: over.explanation ?? { headline: '', lines: [], missingConfirmation: [] },
  };
}
function postureWithPhysical(level: number): SurvivalPosture {
  const phys = axis({ axis: 'physical_safety', level, band: level >= 80 ? 'critical' : 'secure' });
  return { axes: [phys], overallLevel: level, overallBand: phys.band, worstAxis: 'physical_safety', headline: '', capturedAtMs: NOW, staleInputs: [] };
}
const SHELTER: SurvivalMove = {
  id: 'move-shelter', label: 'Shelter', detail: '', affects: ['physical_safety'], cost: 'free', leadTimeMins: 1,
  trigger: '', effect: [{ axis: 'physical_safety', deltaLevel: -30, rationale: 'shelter' }],
};

test('emptyPlan has no committed moves', () => {
  assert.deepEqual(emptyPlan().committed, []);
});

test('commitMove records a planned move; moveStatus reflects it; double-commit is idempotent', () => {
  const p1 = commitMove(emptyPlan(), SHELTER, NOW);
  assert.equal(p1.committed.length, 1);
  assert.equal(moveStatus(p1, 'move-shelter'), 'planned');
  assert.equal(moveStatus(p1, 'nope'), 'none');
  const p2 = commitMove(p1, SHELTER, NOW);
  assert.equal(p2.committed.length, 1);
});

test('applyPlanToPosture lowers the affected axis level and marks it improving', () => {
  const posture = postureWithPhysical(90);
  const plan = commitMove(emptyPlan(), SHELTER, NOW);
  const improved = applyPlanToPosture(posture, plan, [SHELTER]);
  const phys = improved.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.level, 60);
  assert.equal(phys.trend, 'improving');
  assert.equal(improved.overallLevel, 60);
  assert.ok(improved.headline.includes('high'), 'headline should reflect the new (improved) band');
  assert.equal(phys.confidence.total, 60);
  assert.equal(phys.confidence.total, phys.confidence.items.reduce((s, i) => s + i.value, 0));
  assert.ok(phys.explanation.headline.includes('high'));
});

test('applyPlanToPosture ignores skipped moves', () => {
  const posture = postureWithPhysical(90);
  const plan: SurvivalPlan = { committed: [{ moveId: 'move-shelter', committedAtMs: NOW, status: 'skipped' }] };
  const result = applyPlanToPosture(posture, plan, [SHELTER]);
  assert.equal(result.axes.find((a) => a.axis === 'physical_safety')!.level, 90);
});
