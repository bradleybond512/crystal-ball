import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WAR_RISK_WEIGHTS,
  WAR_RISK_COMPONENT_LABEL,
  bandForWarRisk,
  ceasefireStatusColor,
  ceasefireStatusLabel,
  computeWarRiskIndex,
  conflictKindLabel,
  countActiveWars,
  countCollapsedCeasefires,
  countEscalatingTrends,
  countHighRungs,
  deEscalationKindLabel,
  deEscalationRollupScore,
  formatAge,
  intensityColor,
  intensityLabel,
  rungColor,
  rungIndex,
  rungLabel,
  summarizeActiveConflicts,
  summarizeCeasefires,
  summarizeDeEscalationSignals,
  summarizeEscalationLadder,
  summarizeIntensityTrends,
  trendColor,
  trendDirection,
  trendLabel,
  warRiskBandColor,
  warRiskBandLabel,
  type Ceasefire,
  type ConflictDyad,
  type ConflictIntensitySample,
  type DeEscalationSignal,
  type EscalationLadderEntry,
  type WarRiskInput,
} from '../conflict-escalation-helpers';

const NOW = 1_700_000_000_000;

describe('computeWarRiskIndex', () => {
  it('returns zero score + null topDriver when every input is zero', () => {
    const empty: WarRiskInput = {
      activeConflictScore: 0,
      ceasefireFragilityScore: 0,
      intensityTrendScore: 0,
      escalationLadderScore: 0,
      deEscalationScore: 0,
      crossDomainPressureScore: 0,
    };
    const r = computeWarRiskIndex(empty);
    assert.equal(r.score, 0);
    assert.equal(r.band, 'low');
    assert.equal(r.topDriver, null);
    assert.equal(r.deEscalationDeduction, 0);
  });

  it('saturates at 100 + severe band when every positive driver is 100 and no de-escalation', () => {
    const r = computeWarRiskIndex({
      activeConflictScore: 100,
      ceasefireFragilityScore: 100,
      intensityTrendScore: 100,
      escalationLadderScore: 100,
      deEscalationScore: 0,
      crossDomainPressureScore: 100,
    });
    assert.equal(r.score, 100);
    assert.equal(r.band, 'severe');
    assert.ok(r.topDriver !== null);
  });

  it('picks top driver by weighted contribution', () => {
    const r = computeWarRiskIndex({
      activeConflictScore: 100,
      ceasefireFragilityScore: 50,
      intensityTrendScore: 50,
      escalationLadderScore: 50,
      deEscalationScore: 0,
      crossDomainPressureScore: 100,
    });
    // activeConflict (25%×100=25) ties with escalationLadder (25%×50=12.5)
    // — activeConflict wins. crossDomainPressure (10%×100=10) is smaller.
    assert.equal(r.topDriver, WAR_RISK_COMPONENT_LABEL.activeConflictScore);
  });

  it('de-escalation deducts up to 30 points and surfaces the deduction', () => {
    const r = computeWarRiskIndex({
      activeConflictScore: 100,
      ceasefireFragilityScore: 100,
      intensityTrendScore: 100,
      escalationLadderScore: 100,
      deEscalationScore: 100,
      crossDomainPressureScore: 100,
    });
    assert.equal(r.score, 70);
    assert.equal(r.deEscalationDeduction, 30);
  });

  it('clamps out-of-range inputs into [0, 100]', () => {
    const r = computeWarRiskIndex({
      activeConflictScore: -50,
      ceasefireFragilityScore: 1000,
      intensityTrendScore: NaN,
      escalationLadderScore: 0,
      deEscalationScore: 0,
      crossDomainPressureScore: 0,
    });
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.equal(r.topDriver, WAR_RISK_COMPONENT_LABEL.ceasefireFragilityScore);
  });

  it('positive-driver weights sum to 1.0', () => {
    const sum = Object.values(WAR_RISK_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9);
  });

  it('de-escalation cannot drive the score below zero', () => {
    const r = computeWarRiskIndex({
      activeConflictScore: 10,
      ceasefireFragilityScore: 0,
      intensityTrendScore: 0,
      escalationLadderScore: 0,
      deEscalationScore: 100,
      crossDomainPressureScore: 0,
    });
    assert.ok(r.score >= 0);
  });
});

describe('bandForWarRisk', () => {
  it('respects band boundaries', () => {
    assert.equal(bandForWarRisk(0), 'low');
    assert.equal(bandForWarRisk(19), 'low');
    assert.equal(bandForWarRisk(20), 'guarded');
    assert.equal(bandForWarRisk(39), 'guarded');
    assert.equal(bandForWarRisk(40), 'elevated');
    assert.equal(bandForWarRisk(59), 'elevated');
    assert.equal(bandForWarRisk(60), 'high');
    assert.equal(bandForWarRisk(79), 'high');
    assert.equal(bandForWarRisk(80), 'severe');
    assert.equal(bandForWarRisk(100), 'severe');
  });
});

describe('summarizeActiveConflicts', () => {
  const dyads: ConflictDyad[] = [
    { id: 'a', dyad: 'A-vs-B', region: 'EU',   kind: 'interstate', intensity: 'medium', battleDeaths30d: 100, civilianCasualties30d: 50,  lastIncidentAt: NOW - 60_000 },
    { id: 'b', dyad: 'C-vs-D', region: 'ME',   kind: 'interstate', intensity: 'war',    battleDeaths30d: 5000, civilianCasualties30d: 2000, lastIncidentAt: NOW - 3_600_000 },
    { id: 'c', dyad: 'E-vs-F', region: 'AFR',  kind: 'intrastate', intensity: 'high',   battleDeaths30d: 400, civilianCasualties30d: 100, lastIncidentAt: NOW - 7_200_000 },
  ];
  it('sorts by intensity desc then total-casualties desc', () => {
    const rows = summarizeActiveConflicts(dyads, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  });
  it('computes total casualties as battle + civilian', () => {
    const rows = summarizeActiveConflicts(dyads, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('b')!.totalCasualties30d, 7000);
  });
  it('clamps negative casualties to 0', () => {
    const rows = summarizeActiveConflicts([
      { ...dyads[0]!, id: 'd', battleDeaths30d: -100, civilianCasualties30d: -50 },
    ], NOW);
    assert.equal(rows[0]!.battleDeaths30d, 0);
    assert.equal(rows[0]!.civilianCasualties30d, 0);
  });
  it('attaches kind + intensity labels', () => {
    const rows = summarizeActiveConflicts(dyads, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('b')!.intensityLabel, 'Active war');
    assert.equal(byId.get('c')!.kindLabel, 'Intrastate');
  });
});

describe('summarizeCeasefires', () => {
  const ceasefires: Ceasefire[] = [
    { id: 'a', dyad: 'A-vs-B', region: 'EU',  signedAt: NOW - 10 * 86_400_000, violations7d: 7,  violations24h: 1, status: 'holding',        observedAt: NOW - 60_000 },
    { id: 'b', dyad: 'C-vs-D', region: 'ME',  signedAt: NOW - 2  * 86_400_000, violations7d: 0,  violations24h: 0, status: 'collapsed',      observedAt: NOW - 3_600_000 },
    { id: 'c', dyad: 'E-vs-F', region: 'AFR', signedAt: NOW - 30 * 86_400_000, violations7d: 14, violations24h: 5, status: 'violated_major', observedAt: NOW - 7_200_000 },
  ];
  it('sorts by status severity desc then violations24h desc', () => {
    const rows = summarizeCeasefires(ceasefires, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'c', 'a']);
  });
  it('computes days-holding from signedAt', () => {
    const rows = summarizeCeasefires(ceasefires, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('a')!.daysHolding, 10);
    assert.equal(byId.get('c')!.daysHolding, 30);
  });
  it('flags accelerating when 24h count exceeds 1.5x the 7d daily average', () => {
    const rows = summarizeCeasefires(ceasefires, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    // 'a': 7 v / 7d = 1.0 avg, 24h=1 → not accelerating
    assert.equal(byId.get('a')!.accelerating, false);
    // 'c': 14 v / 7d = 2.0 avg, 24h=5 → 5 > 2 * 1.5 = 3.0 → accelerating
    assert.equal(byId.get('c')!.accelerating, true);
  });
  it('uses fallback acceleration threshold when 7d avg is zero', () => {
    const rows = summarizeCeasefires([
      { ...ceasefires[0]!, id: 'd', violations7d: 0, violations24h: 2, status: 'fraying' },
      { ...ceasefires[0]!, id: 'e', violations7d: 0, violations24h: 1, status: 'fraying' },
    ], NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('d')!.accelerating, true);
    assert.equal(byId.get('e')!.accelerating, false);
  });
});

describe('trendDirection', () => {
  it('requires at least 5 points of movement to call a trend', () => {
    assert.equal(trendDirection(50, 50), 'steady');
    assert.equal(trendDirection(50, 54), 'steady');
    assert.equal(trendDirection(50, 55), 'steady');
    assert.equal(trendDirection(50, 56), 'escalating');
    assert.equal(trendDirection(50, 45), 'steady');
    assert.equal(trendDirection(50, 44), 'de_escalating');
  });
  it('clamps out-of-range inputs', () => {
    assert.equal(trendDirection(-50, 50), 'escalating');
    assert.equal(trendDirection(50, 1000), 'escalating');
  });
});

describe('summarizeIntensityTrends', () => {
  const samples: ConflictIntensitySample[] = [
    { id: 'a', dyad: 'A-vs-B', region: 'EU',  scoreBaseline: 30, scoreNow: 70, computedAt: NOW - 60_000 },
    { id: 'b', dyad: 'C-vs-D', region: 'ME',  scoreBaseline: 70, scoreNow: 30, computedAt: NOW - 3_600_000 },
    { id: 'c', dyad: 'E-vs-F', region: 'AFR', scoreBaseline: 50, scoreNow: 52, computedAt: NOW - 7_200_000 },
  ];
  it('sorts escalating first then de-escalating last', () => {
    const rows = summarizeIntensityTrends(samples, NOW);
    assert.equal(rows[0]!.direction, 'escalating');
    assert.equal(rows[rows.length - 1]!.direction, 'de_escalating');
  });
  it('computes delta + percentage change', () => {
    const rows = summarizeIntensityTrends(samples, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('a')!.delta, 40);
    assert.equal(byId.get('a')!.pctChange, 133);
  });
  it('emits null pctChange when baseline is zero', () => {
    const rows = summarizeIntensityTrends([
      { id: 'z', dyad: 'X-vs-Y', region: 'r', scoreBaseline: 0, scoreNow: 40, computedAt: NOW },
    ], NOW);
    assert.equal(rows[0]!.pctChange, null);
    assert.equal(rows[0]!.delta, 40);
  });
});

describe('escalation ladder', () => {
  it('rungIndex covers the 7-rung ladder in order', () => {
    assert.equal(rungIndex('rhetoric'), 0);
    assert.equal(rungIndex('posturing'), 1);
    assert.equal(rungIndex('mobilization'), 2);
    assert.equal(rungIndex('border_incident'), 3);
    assert.equal(rungIndex('limited_strikes'), 4);
    assert.equal(rungIndex('wider_engagement'), 5);
    assert.equal(rungIndex('general_war'), 6);
  });
  it('rungLabel includes the numbered rung in the label', () => {
    assert.ok(rungLabel('rhetoric').startsWith('1. '));
    assert.ok(rungLabel('general_war').startsWith('7. '));
  });
});

describe('summarizeEscalationLadder', () => {
  const entries: EscalationLadderEntry[] = [
    { id: 'a', dyad: 'A-vs-B', region: 'EU',  rung: 'limited_strikes',  previousRung: 'border_incident', observedAt: NOW - 60_000 },
    { id: 'b', dyad: 'C-vs-D', region: 'ME',  rung: 'general_war',      previousRung: 'wider_engagement', observedAt: NOW - 3_600_000 },
    { id: 'c', dyad: 'E-vs-F', region: 'AFR', rung: 'posturing',        previousRung: null, observedAt: NOW - 7_200_000 },
  ];
  it('sorts highest-rung-first then largest-step-change-first', () => {
    const rows = summarizeEscalationLadder(entries, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  });
  it('computes step change when previousRung is known, null otherwise', () => {
    const rows = summarizeEscalationLadder(entries, NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('a')!.stepChange, 1);
    assert.equal(byId.get('b')!.stepChange, 1);
    assert.equal(byId.get('c')!.stepChange, null);
  });
  it('returns negative step change on de-escalation back down the ladder', () => {
    const rows = summarizeEscalationLadder([
      { id: 'd', dyad: 'a', region: 'r', rung: 'rhetoric', previousRung: 'mobilization', observedAt: NOW },
    ], NOW);
    assert.equal(rows[0]!.stepChange, -2);
  });
});

describe('summarizeDeEscalationSignals', () => {
  const signals: DeEscalationSignal[] = [
    { id: 'a', dyad: 'A-vs-B', region: 'EU',  kind: 'talks_announced',    confidence: 0.8, description: 'Geneva', observedAt: NOW - 60_000 },
    { id: 'b', dyad: 'C-vs-D', region: 'ME',  kind: 'hostage_release',    confidence: 0.9, description: 'IDF',    observedAt: NOW - 3_600_000 },
    { id: 'c', dyad: 'E-vs-F', region: 'AFR', kind: 'mediation_offered',  confidence: 0.5, description: 'AU',     observedAt: NOW - 7_200_000 },
  ];
  it('sorts highest-weight-first then most-recent-first', () => {
    const rows = summarizeDeEscalationSignals(signals, NOW);
    assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c']);
  });
  it('multiplies kind weight by confidence', () => {
    const rows = summarizeDeEscalationSignals([
      { id: 'x', dyad: 'd', region: 'r', kind: 'hostage_release', confidence: 1, description: 'd', observedAt: NOW },
      { id: 'y', dyad: 'd', region: 'r', kind: 'hostage_release', confidence: 0, description: 'd', observedAt: NOW },
    ], NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('x')!.weight, 0.95);
    assert.equal(byId.get('y')!.weight, 0);
  });
  it('clamps confidence into [0, 1]', () => {
    const rows = summarizeDeEscalationSignals([
      { id: 'x', dyad: 'd', region: 'r', kind: 'talks_announced', confidence: 99, description: 'd', observedAt: NOW },
    ], NOW);
    assert.equal(rows[0]!.confidence, 1);
  });
});

describe('deEscalationRollupScore', () => {
  it('caps at 100 even when many strong signals accumulate', () => {
    const rows = summarizeDeEscalationSignals(
      Array.from({ length: 20 }, (_, i) => ({
        id: `n${i}`, dyad: 'd', region: 'r', kind: 'hostage_release' as const,
        confidence: 1, description: 'd', observedAt: NOW,
      })),
      NOW,
    );
    assert.ok(deEscalationRollupScore(rows) <= 100);
  });
  it('returns 0 for empty input', () => {
    assert.equal(deEscalationRollupScore([]), 0);
  });
  it('strong single signal produces a meaningful score', () => {
    const rows = summarizeDeEscalationSignals([
      { id: 'x', dyad: 'd', region: 'r', kind: 'hostage_release', confidence: 1, description: 'd', observedAt: NOW },
    ], NOW);
    const score = deEscalationRollupScore(rows);
    assert.ok(score > 30 && score < 80);
  });
});

describe('counts / aggregators', () => {
  it('countActiveWars counts war + high intensity', () => {
    const rows = summarizeActiveConflicts([
      { id: 'a', dyad: 'a', region: 'r', kind: 'interstate', intensity: 'war',    battleDeaths30d: 1, civilianCasualties30d: 0, lastIncidentAt: NOW },
      { id: 'b', dyad: 'b', region: 'r', kind: 'interstate', intensity: 'high',   battleDeaths30d: 1, civilianCasualties30d: 0, lastIncidentAt: NOW },
      { id: 'c', dyad: 'c', region: 'r', kind: 'interstate', intensity: 'medium', battleDeaths30d: 1, civilianCasualties30d: 0, lastIncidentAt: NOW },
    ], NOW);
    assert.equal(countActiveWars(rows), 2);
  });
  it('countCollapsedCeasefires counts only collapsed status', () => {
    const rows = summarizeCeasefires([
      { id: 'a', dyad: 'a', region: 'r', signedAt: NOW, violations7d: 0, violations24h: 0, status: 'collapsed',      observedAt: NOW },
      { id: 'b', dyad: 'b', region: 'r', signedAt: NOW, violations7d: 0, violations24h: 0, status: 'violated_major', observedAt: NOW },
    ], NOW);
    assert.equal(countCollapsedCeasefires(rows), 1);
  });
  it('countEscalatingTrends counts only escalating', () => {
    const rows = summarizeIntensityTrends([
      { id: 'a', dyad: 'a', region: 'r', scoreBaseline: 10, scoreNow: 80, computedAt: NOW },
      { id: 'b', dyad: 'b', region: 'r', scoreBaseline: 80, scoreNow: 10, computedAt: NOW },
    ], NOW);
    assert.equal(countEscalatingTrends(rows), 1);
  });
  it('countHighRungs counts rungs >= limited_strikes (index 4)', () => {
    const rows = summarizeEscalationLadder([
      { id: 'a', dyad: 'a', region: 'r', rung: 'general_war',    previousRung: null, observedAt: NOW },
      { id: 'b', dyad: 'b', region: 'r', rung: 'limited_strikes', previousRung: null, observedAt: NOW },
      { id: 'c', dyad: 'c', region: 'r', rung: 'rhetoric',        previousRung: null, observedAt: NOW },
    ], NOW);
    assert.equal(countHighRungs(rows), 2);
  });
});

describe('display constants', () => {
  it('warRiskBandColor + warRiskBandLabel cover every band', () => {
    for (const b of ['low','guarded','elevated','high','severe'] as const) {
      assert.ok(warRiskBandColor(b).length > 0);
      assert.ok(warRiskBandLabel(b).length > 0);
    }
  });
  it('intensityColor + intensityLabel cover every intensity', () => {
    for (const i of ['latent','low','medium','high','war'] as const) {
      assert.ok(intensityColor(i).length > 0);
      assert.ok(intensityLabel(i).length > 0);
    }
  });
  it('conflictKindLabel covers every kind', () => {
    for (const k of ['interstate','intrastate','internationalized_intrastate','non_state'] as const) {
      assert.ok(conflictKindLabel(k).length > 0);
    }
  });
  it('ceasefireStatusLabel + ceasefireStatusColor cover every status', () => {
    for (const s of ['holding','fraying','violated_minor','violated_major','collapsed'] as const) {
      assert.ok(ceasefireStatusLabel(s).length > 0);
      assert.ok(ceasefireStatusColor(s).length > 0);
    }
  });
  it('trendLabel + trendColor cover every direction', () => {
    for (const t of ['escalating','steady','de_escalating'] as const) {
      assert.ok(trendLabel(t).length > 0);
      assert.ok(trendColor(t).length > 0);
    }
  });
  it('rungColor covers every rung', () => {
    for (const r of ['rhetoric','posturing','mobilization','border_incident','limited_strikes','wider_engagement','general_war'] as const) {
      assert.ok(rungColor(r).length > 0);
    }
  });
  it('deEscalationKindLabel covers every kind', () => {
    for (const k of ['talks_announced','prisoner_exchange','mediation_offered','troop_drawdown','humanitarian_corridor','hostage_release','back_channel_active'] as const) {
      assert.ok(deEscalationKindLabel(k).length > 0);
    }
  });
  it('WAR_RISK_COMPONENT_LABEL covers every key on WarRiskInput', () => {
    const keys: Array<keyof WarRiskInput> = [
      'activeConflictScore','ceasefireFragilityScore','intensityTrendScore',
      'escalationLadderScore','deEscalationScore','crossDomainPressureScore',
    ];
    for (const k of keys) {
      assert.ok(WAR_RISK_COMPONENT_LABEL[k].length > 0);
    }
  });
});

describe('formatAge', () => {
  it('renders coarsely by magnitude', () => {
    assert.equal(formatAge(NOW, NOW), 'just now');
    assert.equal(formatAge(NOW - 60_000, NOW), '1m ago');
    assert.equal(formatAge(NOW - 3_600_000, NOW), '1h ago');
    assert.equal(formatAge(NOW - 86_400_000, NOW), '1d ago');
    assert.equal(formatAge(NOW - 7 * 86_400_000, NOW), '1w ago');
    assert.equal(formatAge(NOW - 35 * 86_400_000, NOW), '1mo ago');
    assert.equal(formatAge(NOW - 400 * 86_400_000, NOW), '1y ago');
  });
});
