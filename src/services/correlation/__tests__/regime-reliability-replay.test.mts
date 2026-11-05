import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as calibration from '../correlation-calibration';
import { computeEdgeConfidence } from '../edge-confidence';
import { startPressureHistory } from '../../pressure-history';
import * as monitor from '../../cognition/regime-monitor';
import { notificationDispatcher } from '../../notification-dispatcher';
import type { PredictionRecord } from '../../intelligence/forecast-calibration';

type Regime = 'calm' | 'shifted';
type Arm = 'conditional' | 'pooled';
const STORAGE_KEY = 'crystalball-correlation-calibration-v1';
const RULE = 'island:cyber->infrastructure';
const SOURCE = `corr-rule:${RULE}`;
const MINUTE = 60_000;

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, String(value)); }
  removeItem(key: string): void { this.data.delete(key); }
}

test('chronological regime replay compares matched arms without future labels or retrospective tags', (t) => {
  assert.equal(typeof monitor.getCorrelationRegime, 'function', 'replay requires the real current-regime classifier');
  assert.equal(typeof calibration.reliabilityDiagnosticsForRule, 'function', 'replay requires auditable cohort selection');
  const saved = new Map(['document', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget();
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  let now = Date.UTC(2026, 10, 1);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(notificationDispatcher, 'dispatchNotification', () => Promise.resolve());
  try {
    startPressureHistory();
    monitor.startRegimeMonitor();
    function sample(value: number): void {
      now += 2 * MINUTE;
      document.dispatchEvent(new CustomEvent('cb:mode-advisory', {
        detail: { timestamp: now, advisories: [], pressure: { finance: value, security: 0, disaster: 0, cyber: 0 } },
      }));
    }
    function enter(regime: Regime): void {
      if (regime === 'calm') for (let i = 0; i < 30; i++) sample(0);
      else sample(1);
      assert.equal(monitor.getCorrelationRegime(now), regime, 'only actual witnessed pressure and detector output establish regime');
    }
    function settled(): PredictionRecord[] {
      return calibration.getCorrelationCalibrationStore().all().filter((row) => row.status.startsWith('resolved_'));
    }
    function run(arm: Arm) {
      storage.removeItem(STORAGE_KEY);
      calibration.resetCorrelationCalibration();
      const tags = new Map<string, Regime>();
      const decisions: { regime: Regime; probability: number; outcome: boolean; resolvedBefore: number }[] = [];
      const selections: Record<string, number> = {};
      let index = 0;
      function step(regime: Regime, training: boolean): void {
        now += 1_000;
        const previous = settled();
        assert.equal(previous.length, index, 'each decision sees exactly the outcomes settled earlier');
        assert.ok(previous.every((row) => row.resolvedAt! < now), 'future labels cannot enter a decision');
        for (const row of previous) assert.equal(row.outcomeRegime, tags.get(row.id), 'later regimes cannot rewrite outcome tags');
        const diagnostics = calibration.reliabilityDiagnosticsForRule(RULE, now);
        const conditional = calibration.reliabilityForRule(RULE, now);
        const pooled = calibration.getCorrelationCalibrationStore().bySource().find((row) => row.sourceId === SOURCE)?.multiplier ?? 1;
        assert.equal(diagnostics.currentRegime, regime);
        assert.equal(conditional, diagnostics.multiplier);
        assert.equal(diagnostics.overall.resolvedCount, index);
        const n = previous.filter((row) => row.outcomeRegime === regime).length;
        assert.equal(diagnostics[regime].resolvedCount, n);
        assert.equal(diagnostics.selected, n >= 5 ? regime : index >= 5 ? 'pooled' : 'neutral');
        if (n < 5) assert.equal(conditional, pooled, 'sparse regimes must retain the exact pooled path');
        const probability = training ? 0.9 : computeEdgeConfidence({
          gapMs: 0, timeWindowMs: MINUTE, baseConfidence: 0.6,
          sharedEntityCount: 0, reliability: arm === 'conditional' ? conditional : pooled,
        }).value;
        const outcome = regime === 'calm';
        const id = `${arm}:${index}`;
        assert.equal(calibration.recordCalibrationPrediction({
          id, sourceId: SOURCE, domain: 'cyber', claim: 'synthetic replay', probability,
          predictedAt: now, resolveBy: now + MINUTE, status: 'pending',
        }), true);
        assert.equal(settled().length, index, 'recording a prediction supplies no outcome');
        if (!training) {
          decisions.push({ regime, probability, outcome, resolvedBefore: index });
          selections[diagnostics.selected] = (selections[diagnostics.selected] ?? 0) + 1;
        }
        now += 1_000;
        assert.equal(calibration.resolveCalibrationPrediction(id, outcome, now), true);
        tags.set(id, regime);
        const row = calibration.getCorrelationCalibrationStore().get(id)!;
        assert.equal(row.outcomeRegime, regime);
        assert.equal(row.resolvedAt, now);
        assert.equal(calibration.resolveCalibrationPrediction(id, !outcome, now + 1), false, 'resolution is immutable');
        index += 1;
      }
      enter('calm');
      for (let i = 0; i < 6; i++) step('calm', true);
      enter('shifted');
      for (let i = 0; i < 6; i++) step('shifted', true);
      const beforeRestart = JSON.parse(JSON.stringify(calibration.getCorrelationCalibrationStore().toJson()));
      calibration.resetCorrelationCalibration();
      assert.deepEqual(JSON.parse(JSON.stringify(calibration.getCorrelationCalibrationStore().toJson())), beforeRestart, 'restart preserves outcome-time tags and scores');
      for (let cycle = 0; cycle < 2; cycle++) {
        enter('calm');
        for (let i = 0; i < 6; i++) step('calm', false);
        enter('shifted');
        for (let i = 0; i < 6; i++) step('shifted', false);
      }
      const error = (rows: typeof decisions) => rows.reduce((sum, row) => sum + (row.probability - Number(row.outcome)) ** 2, 0) / rows.length;
      assert.equal(decisions.length, 24);
      assert.equal(settled().length, 36);
      assert.deepEqual(selections, { calm: 12, shifted: 12 });
      return {
        arm, training: 12, evaluated: decisions.length, calmEvaluated: 12, shiftedEvaluated: 12, brier: error(decisions),
        calmBrier: error(decisions.filter((row) => row.regime === 'calm')),
        shiftedBrier: error(decisions.filter((row) => row.regime === 'shifted')),
        schedule: decisions.map(({ regime, outcome, resolvedBefore }) => ({ regime, outcome, resolvedBefore })),
      };
    }
    const conditional = run('conditional');
    const pooled = run('pooled');
    assert.deepEqual(conditional.schedule, pooled.schedule, 'both arms predict the same outcomes with the same settlement schedule');
    assert.ok(conditional.brier < pooled.brier, 'known regime-dependent toy data should distinguish the conditional policy');
    t.diagnostic(JSON.stringify({
      fixture: 'synthetic-regime-replay-v1', productionUplift: false,
      interpretation: 'Two chronological arms; each updates only from its own earlier settled forecasts. Same deterministic pressure and outcome schedule; not production evidence.',
      arms: [conditional, pooled].map(({ schedule: _schedule, ...summary }) => summary),
    }));
  } finally {
    monitor._resetRegimeMonitorForTests();
    calibration.resetCorrelationCalibration();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
