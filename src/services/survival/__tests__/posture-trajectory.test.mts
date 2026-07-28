// src/services/survival/__tests__/posture-trajectory.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPostureTrajectory, DEFAULT_HORIZONS,
} from '../posture-trajectory.ts';
import type { AxisState, PostureThreat, SurvivalAxis, SurvivalPosture } from '../survival-types.ts';
import type { ConfidenceBreakdown, AlgorithmExplanation } from '../../intelligence/types.ts';

const CONF: ConfidenceBreakdown = { total: 50, max: 100, items: [] };
const EXPL: AlgorithmExplanation = { headline: '', lines: [], missingConfirmation: [] };

function threat(p: Partial<PostureThreat> = {}): PostureThreat {
  return {
    sourceEventId: 'ev-1',
    axis: 'physical_safety',
    severity: 50,
    threatLevel: 'advisory',
    hazardKind: 'tornado',
    hazardLabel: 'Tornado Warning',
    timeToImpactMins: null,
    arrivalLabel: null,
    why: 'over home',
    confidenceLabel: 'medium',
    ...p,
  };
}

function axis(p: Partial<AxisState> = {}): AxisState {
  return {
    axis: 'physical_safety',
    level: 0,
    band: 'secure',
    trend: 'steady',
    threats: [],
    confidence: CONF,
    explanation: EXPL,
    drivers: [],
    ...p,
  };
}

function posture(axes: AxisState[]): SurvivalPosture {
  return {
    axes,
    overallLevel: axes.reduce((m, a) => Math.max(m, a.level), 0),
    overallBand: 'secure',
    worstAxis: 'physical_safety',
    headline: '',
    capturedAtMs: 1_700_000_000_000,
    staleInputs: [],
  };
}

function at(t: ReturnType<typeof projectPostureTrajectory>, ax: SurvivalAxis, horizonId: string) {
  return t.projections.find((p) => p.axis === ax && p.horizonId === horizonId)!;
}

test('empty posture -> no projections, null peak, honest headline', () => {
  const t = projectPostureTrajectory(posture([]));
  assert.deepEqual(t.projections, []);
  assert.equal(t.peakAxis, null);
  assert.equal(t.peakLevel, 0);
  assert.equal(t.peakHorizonId, null);
  assert.equal(t.headline, 'No posture data to project.');
});

test('all-secure axes -> flat projections, steady headline', () => {
  const t = projectPostureTrajectory(posture([axis(), axis({ axis: 'supply' })]));
  assert.equal(t.projections.length, 2 * DEFAULT_HORIZONS.length);
  for (const p of t.projections) {
    assert.equal(p.projectedLevel, 0);
    assert.equal(p.direction, 'steady');
    assert.equal(p.delta, 0);
  }
  assert.equal(t.headline, 'Posture holds steady across the projection window.');
});

test('timed threat within horizon escalates the axis to its severity', () => {
  const a = axis({ level: 30, trend: 'worsening', threats: [threat({ severity: 90, timeToImpactMins: 45, arrivalLabel: '35-55 min', threatLevel: 'emergency' })] });
  const t = projectPostureTrajectory(posture([a]));
  const p6 = at(t, 'physical_safety', '6h');
  assert.equal(p6.projectedLevel, 90); // 45min <= 360min -> full severity
  assert.equal(p6.direction, 'escalating');
  assert.equal(p6.projectedBand, 'critical');
  assert.ok(p6.drivers[0]!.includes('Tornado Warning'));
  assert.ok(p6.drivers[0]!.includes('35-55 min'));
});

test('timed threat beyond horizon ramps partially from current level, then fully later', () => {
  // severity 90 arriving in 48h (2880 min), axis currently at 20. The axis
  // interpolates UP from the current level toward the peak as arrival nears:
  // at 6h ramp=360/2880=0.125 -> 20 + (90-20)*0.125 = 28.75; at 72h ramp=1 -> 90.
  const a = axis({ level: 20, threats: [threat({ severity: 90, timeToImpactMins: 2880 })] });
  const t = projectPostureTrajectory(posture([a]));
  const p6 = at(t, 'physical_safety', '6h');
  assert.ok(Math.abs(p6.projectedLevel - 28.75) < 0.01);
  assert.ok(p6.projectedLevel > 20); // already climbing at 6h, not flat
  assert.equal(at(t, 'physical_safety', '72h').projectedLevel, 90);
});

test('a timed threat no worse than the current level does not manufacture escalation', () => {
  // axis already at 70; a milder threat (severity 50) approaching cannot pull it up.
  const a = axis({ level: 70, threats: [threat({ severity: 50, timeToImpactMins: 120 })] });
  const t = projectPostureTrajectory(posture([a]));
  const p6 = at(t, 'physical_safety', '6h');
  assert.equal(p6.projectedLevel, 70);
  assert.equal(p6.direction, 'steady');
});

test('untimed threat contributes full severity at every horizon', () => {
  const a = axis({ level: 10, threats: [threat({ severity: 70, timeToImpactMins: null })] });
  const t = projectPostureTrajectory(posture([a]));
  for (const h of DEFAULT_HORIZONS) {
    assert.equal(at(t, 'physical_safety', h.id).projectedLevel, 70);
  }
});

test('worsening trend nudge grows with horizon length', () => {
  const a = axis({ level: 40, trend: 'worsening' });
  const t = projectPostureTrajectory(posture([a]));
  const l6 = at(t, 'physical_safety', '6h').projectedLevel;
  const l72 = at(t, 'physical_safety', '72h').projectedLevel;
  assert.ok(l6 > 40 && l6 < l72);
  assert.equal(l72, 50); // 40 + MAX_TREND_NUDGE(10) at full horizon
});

test('improving trend nudge lowers level and never below 0', () => {
  const a = axis({ level: 6, trend: 'improving' });
  const t = projectPostureTrajectory(posture([a]));
  assert.ok(at(t, 'physical_safety', '72h').projectedLevel < 6);
  assert.ok(at(t, 'physical_safety', '72h').projectedLevel >= 0);
});

test('confidence decays as horizon lengthens', () => {
  const a = axis({ level: 50, threats: [threat({ severity: 80, timeToImpactMins: 60, confidenceLabel: 'high' })] });
  const t = projectPostureTrajectory(posture([a]));
  const c6 = at(t, 'physical_safety', '6h').confidence;
  const c24 = at(t, 'physical_safety', '24h').confidence;
  const c72 = at(t, 'physical_safety', '72h').confidence;
  assert.ok(c6 > c24 && c24 > c72);
});

test('nudge-driven escalation (no timed threat) is confidence-discounted vs threat-driven', () => {
  const nudgeOnly = axis({ level: 45, trend: 'worsening' });
  const timed = axis({ level: 45, trend: 'worsening', threats: [threat({ severity: 90, timeToImpactMins: 60, confidenceLabel: 'high' })] });
  const cn = at(projectPostureTrajectory(posture([nudgeOnly])), 'physical_safety', '6h').confidence;
  const ct = at(projectPostureTrajectory(posture([timed])), 'physical_safety', '6h').confidence;
  assert.ok(cn < ct);
});

test('threat evidence label scales confidence (high > low)', () => {
  const hi = axis({ level: 20, threats: [threat({ severity: 80, timeToImpactMins: 60, confidenceLabel: 'high' })] });
  const lo = axis({ level: 20, threats: [threat({ severity: 80, timeToImpactMins: 60, confidenceLabel: 'low' })] });
  const chi = at(projectPostureTrajectory(posture([hi])), 'physical_safety', '6h').confidence;
  const clo = at(projectPostureTrajectory(posture([lo])), 'physical_safety', '6h').confidence;
  assert.ok(chi > clo);
});

test('projections are worst-first within each horizon', () => {
  const axes = [
    axis({ axis: 'supply', level: 20, threats: [threat({ axis: 'supply', severity: 20, timeToImpactMins: null })] }),
    axis({ axis: 'physical_safety', level: 85, threats: [threat({ severity: 85, timeToImpactMins: null })] }),
    axis({ axis: 'comms', level: 50, threats: [threat({ axis: 'comms', severity: 50, timeToImpactMins: null })] }),
  ];
  const t = projectPostureTrajectory(posture(axes));
  const first6 = t.projections.filter((p) => p.horizonId === '6h');
  assert.deepEqual(first6.map((p) => p.axis), ['physical_safety', 'comms', 'supply']);
});

test('peak rollup selects the max projected level across all horizons', () => {
  // supply peaks late (arrives in 40h), physical_safety is high now.
  const axes = [
    axis({ axis: 'physical_safety', level: 60, threats: [threat({ severity: 60, timeToImpactMins: null })] }),
    axis({ axis: 'supply', level: 10, threats: [threat({ axis: 'supply', severity: 95, timeToImpactMins: 2400 })] }),
  ];
  const t = projectPostureTrajectory(posture(axes));
  assert.equal(t.peakAxis, 'supply');
  assert.equal(t.peakLevel, 95);
  assert.equal(t.peakHorizonId, '72h');
  assert.ok(t.headline.includes('Supply'));
  assert.ok(t.headline.includes('72h'));
});

test('delta, direction and band are internally consistent', () => {
  const a = axis({ level: 30, threats: [threat({ severity: 75, timeToImpactMins: 30 })] });
  const p = at(projectPostureTrajectory(posture([a])), 'physical_safety', '6h');
  assert.equal(p.delta, Math.round((p.projectedLevel - p.currentLevel) * 10) / 10);
  assert.equal(p.direction, 'escalating');
  assert.equal(p.projectedBand, 'high'); // 75 -> high
});

test('non-finite level and severity are guarded (no NaN / Infinity leaks)', () => {
  const a = axis({ level: Number.NaN, threats: [threat({ severity: Number.POSITIVE_INFINITY, timeToImpactMins: 10 })] });
  const t = projectPostureTrajectory(posture([a]));
  for (const p of t.projections) {
    assert.ok(Number.isFinite(p.projectedLevel));
    assert.ok(Number.isFinite(p.confidence));
    assert.ok(Number.isFinite(p.delta));
    assert.ok(p.projectedLevel >= 0 && p.projectedLevel <= 100);
  }
});

test('projected level is clamped to 100 even with severity + nudge', () => {
  const a = axis({ level: 98, trend: 'worsening', threats: [threat({ severity: 100, timeToImpactMins: null })] });
  const t = projectPostureTrajectory(posture([a]));
  for (const p of t.projections) assert.ok(p.projectedLevel <= 100);
});

test('custom horizons option is respected', () => {
  const a = axis({ level: 40, trend: 'worsening' });
  const t = projectPostureTrajectory(posture([a]), { horizons: [{ id: '1h', mins: 60 }] });
  assert.deepEqual(t.horizons, [{ id: '1h', mins: 60 }]);
  assert.equal(t.projections.length, 1);
  assert.equal(t.projections[0]!.horizonId, '1h');
});

test('confidence tracks the peak-driving threat, not the max label among all threats', () => {
  const driverLow = threat({ severity: 90, timeToImpactMins: 60, confidenceLabel: 'low' });
  const bystanderHigh = threat({
    severity: 30, timeToImpactMins: null, confidenceLabel: 'high',
    hazardKind: 'heat', hazardLabel: 'Heat Advisory',
  });
  const withBystander = axis({ level: 20, threats: [driverLow, bystanderHigh] });
  const withoutBystander = axis({ level: 20, threats: [driverLow] });
  const cWith = at(projectPostureTrajectory(posture([withBystander])), 'physical_safety', '6h').confidence;
  const cWithout = at(projectPostureTrajectory(posture([withoutBystander])), 'physical_safety', '6h').confidence;
  // A high-confidence bystander threat that does NOT drive the projection must
  // not inflate our certainty in the (low-confidence) escalation that does.
  assert.equal(cWith, cWithout);
  assert.ok(Math.abs(cWith - 0.9 * 0.6) < 0.01);
});

test('headline says "holds at" for a steady peak, not "projected to reach"', () => {
  const a = axis({ axis: 'security', level: 85, threats: [threat({ axis: 'security', severity: 85, timeToImpactMins: null })] });
  const t = projectPostureTrajectory(posture([a]));
  assert.equal(t.peakAxis, 'security');
  assert.ok(t.headline.includes('holds at'));
  assert.ok(!t.headline.includes('projected to reach'));
});

test('headline says "easing toward" when the peak axis is declining', () => {
  const a = axis({ level: 95, trend: 'improving' });
  const t = projectPostureTrajectory(posture([a]), { horizons: [{ id: '72h', mins: 4320 }] });
  assert.equal(t.projections[0]!.direction, 'easing');
  assert.ok(t.headline.includes('easing toward'));
  assert.ok(t.headline.includes('72h'));
});

test('easing headline is reachable with DEFAULT horizons (window-end, not peak-horizon)', () => {
  // Improving axis: highest near-term (steady at 6h) yet declining by 72h. The
  // headline must reflect the window-END trajectory, not the near-term peak.
  const a = axis({ level: 95, trend: 'improving' });
  const t = projectPostureTrajectory(posture([a]));
  assert.equal(at(t, 'physical_safety', '72h').direction, 'easing');
  assert.ok(t.headline.includes('easing toward'), t.headline);
  assert.ok(!t.headline.includes('holds at'), t.headline);
});

test('a timed bystander threat does not rescue confidence in a trend-only move', () => {
  // Axis climbs on trend nudge alone; a timed but MILDER threat is present yet
  // never drives the projection, so it must not change the discounted certainty.
  const withBystander = axis({ level: 60, trend: 'worsening', threats: [threat({ severity: 40, timeToImpactMins: 60 })] });
  const pure = axis({ level: 60, trend: 'worsening' });
  const cB = at(projectPostureTrajectory(posture([withBystander])), 'physical_safety', '72h').confidence;
  const cP = at(projectPostureTrajectory(posture([pure])), 'physical_safety', '72h').confidence;
  assert.equal(cB, cP);
});

test('non-finite custom horizon minutes are sanitized (no NaN/Infinity in output)', () => {
  const a = axis({ level: 40, threats: [threat({ severity: 80, timeToImpactMins: 100 })] });
  const t = projectPostureTrajectory(posture([a]), { horizons: [{ id: 'bad', mins: Number.POSITIVE_INFINITY }] });
  assert.equal(t.horizons[0]!.mins, 0);
  const p = at(t, 'physical_safety', 'bad');
  assert.ok(Number.isFinite(p.horizonMins));
  assert.ok(Number.isFinite(p.projectedLevel));
});
