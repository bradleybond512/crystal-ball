/**
 * DiplomaticCrisisPanel helper tests.
 *
 * Covers every pure helper exported from `diplomatic-crisis-helpers.ts`:
 *   - computeDiplomaticHeatIndex / bandForHeatScore
 *   - severityForExpulsion / summarizeExpulsions
 *   - summarizeEmbassyClosures
 *   - escalationRankForStage / nextEscalationRung / summarizeDisputes
 *   - outcomeRiskWeight / summarizeUnscSessions
 *   - severityForTariff / summarizeTradeWarSignals
 *   - actionRiskRank / summarizeTreatyEvents
 *   - summarizeBackchannelActivity
 *   - formatAge
 *   - constants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKCHANNEL_DIRECTION_GLYPH,
  BACKCHANNEL_DIRECTION_LABEL,
  BACKCHANNEL_TYPE_LABEL,
  DISPUTE_STAGE_COLOR,
  DISPUTE_STAGE_LABEL,
  EMBASSY_CLOSURE_TYPE_LABEL,
  HEAT_BAND_COLOR,
  HEAT_COMPONENT_LABEL,
  HEAT_WEIGHTS,
  RANK_LABEL,
  SEVERITY_COLOR,
  TRADE_WAR_KIND_LABEL,
  TREATY_ACTION_COLOR,
  TREATY_ACTION_LABEL,
  UNSC_OUTCOME_COLOR,
  UNSC_OUTCOME_LABEL,
  actionRiskRank,
  bandForHeatScore,
  computeDiplomaticHeatIndex,
  escalationRankForStage,
  formatAge,
  nextEscalationRung,
  outcomeRiskWeight,
  severityForExpulsion,
  severityForTariff,
  summarizeBackchannelActivity,
  summarizeDisputes,
  summarizeEmbassyClosures,
  summarizeExpulsions,
  summarizeTradeWarSignals,
  summarizeTreatyEvents,
  summarizeUnscSessions,
  type BackchannelIndicator,
  type BilateralDispute,
  type EmbassyClosureEvent,
  type ExpulsionEvent,
  type TradeWarSignal,
  type TreatyEvent,
  type UnscSession,
} from '../diplomatic-crisis-helpers';

const NOW = Date.UTC(2026, 4, 26, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── Heat index ───────────────────────────────────────────────────────

describe('computeDiplomaticHeatIndex', () => {
  it('returns zero score + null topDriver when every component is zero', () => {
    const r = computeDiplomaticHeatIndex({
      expulsionScore: 0, embassyClosureScore: 0, disputeEscalationScore: 0,
      unscEmergencyScore: 0, tradeWarScore: 0, treatyActionScore: 0, backchannelEscalationScore: 0,
    });
    assert.equal(r.score, 0);
    assert.equal(r.topDriver, null);
    assert.equal(r.band, 'low');
  });

  it('hits 100 + critical band when every component is saturated', () => {
    const r = computeDiplomaticHeatIndex({
      expulsionScore: 100, embassyClosureScore: 100, disputeEscalationScore: 100,
      unscEmergencyScore: 100, tradeWarScore: 100, treatyActionScore: 100, backchannelEscalationScore: 100,
    });
    assert.equal(r.score, 100);
    assert.equal(r.band, 'critical');
  });

  it('picks top driver by weighted contribution, not raw score', () => {
    // backchannel 100 * 0.05 = 5; trade 60 * 0.15 = 9. Trade wins.
    const r = computeDiplomaticHeatIndex({
      expulsionScore: 0, embassyClosureScore: 0, disputeEscalationScore: 0,
      unscEmergencyScore: 0, tradeWarScore: 60, treatyActionScore: 0, backchannelEscalationScore: 100,
    });
    assert.equal(r.topDriver, HEAT_COMPONENT_LABEL.tradeWarScore);
  });

  it('clamps out-of-range inputs into [0, 100] before weighting', () => {
    const r = computeDiplomaticHeatIndex({
      expulsionScore: -50, embassyClosureScore: 300, disputeEscalationScore: Number.NaN,
      unscEmergencyScore: 0, tradeWarScore: 0, treatyActionScore: 0, backchannelEscalationScore: 0,
    });
    // embassy 300 clamps to 100 → 100 * 0.2 = 20.
    assert.equal(r.score, 20);
    assert.equal(r.weightedContributions.expulsionScore, 0);
    assert.equal(r.weightedContributions.disputeEscalationScore, 0);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(HEAT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `expected ~1.0, got ${sum}`);
  });
});

describe('bandForHeatScore', () => {
  it('respects band boundaries', () => {
    assert.equal(bandForHeatScore(0), 'low');
    assert.equal(bandForHeatScore(19), 'low');
    assert.equal(bandForHeatScore(20), 'moderate');
    assert.equal(bandForHeatScore(39), 'moderate');
    assert.equal(bandForHeatScore(40), 'elevated');
    assert.equal(bandForHeatScore(59), 'elevated');
    assert.equal(bandForHeatScore(60), 'severe');
    assert.equal(bandForHeatScore(79), 'severe');
    assert.equal(bandForHeatScore(80), 'critical');
    assert.equal(bandForHeatScore(100), 'critical');
  });
});

// ── Expulsions ───────────────────────────────────────────────────────

describe('severityForExpulsion', () => {
  it('ambassador expulsion is always severe', () => {
    assert.equal(severityForExpulsion('ambassador', 1, false), 'severe');
  });
  it('chargé expulsion is severe', () => {
    assert.equal(severityForExpulsion('chargé', 1, false), 'severe');
  });
  it('5+ lower-rank expulsions escalate to severe', () => {
    assert.equal(severityForExpulsion('diplomat', 5, false), 'severe');
    assert.equal(severityForExpulsion('attaché', 7, false), 'severe');
  });
  it('reciprocal flag bumps moderate to severe', () => {
    assert.equal(severityForExpulsion('diplomat', 1, false), 'moderate');
    assert.equal(severityForExpulsion('diplomat', 1, true), 'severe');
  });
  it('count <= 0 returns low (treated as data-quality miss)', () => {
    assert.equal(severityForExpulsion('ambassador', 0, false), 'low');
    assert.equal(severityForExpulsion('diplomat', -2, true), 'low');
  });
});

describe('summarizeExpulsions', () => {
  const fixture: ExpulsionEvent[] = [
    { id: 'e1', hostCountry: 'US', sendingCountry: 'RU', rank: 'diplomat', count: 3, reciprocal: false, observedAt: NOW - 6 * HOUR },
    { id: 'e2', hostCountry: 'RU', sendingCountry: 'US', rank: 'ambassador', count: 1, reciprocal: true, observedAt: NOW - 2 * HOUR },
    { id: 'e3', hostCountry: 'UK', sendingCountry: 'CN', rank: 'attaché', count: 1, reciprocal: false, observedAt: NOW - 30 * MIN },
  ];

  it('sorts severe-first then most-recent-first', () => {
    const rows = summarizeExpulsions(fixture, NOW);
    assert.equal(rows[0].id, 'e2'); // severe (ambassador), 2h
    assert.equal(rows[1].id, 'e3'); // moderate, 30m
    assert.equal(rows[2].id, 'e1'); // moderate, 6h
  });

  it('attaches a human-readable age label', () => {
    const rows = summarizeExpulsions(fixture, NOW);
    assert.equal(rows.find((r) => r.id === 'e3')!.ageLabel, '30m');
    assert.equal(rows.find((r) => r.id === 'e2')!.ageLabel, '2h');
  });

  it('preserves reciprocal + count fields verbatim', () => {
    const rows = summarizeExpulsions(fixture, NOW);
    const e2 = rows.find((r) => r.id === 'e2')!;
    assert.equal(e2.reciprocal, true);
    assert.equal(e2.count, 1);
  });
});

// ── Embassy closures ─────────────────────────────────────────────────

describe('summarizeEmbassyClosures', () => {
  const fixture: EmbassyClosureEvent[] = [
    { id: 'c1', hostCountry: 'NE', sendingCountry: 'FR', type: 'evacuated', observedAt: NOW - 5 * DAY },
    { id: 'c2', hostCountry: 'BY', sendingCountry: 'CA', type: 'partial_suspension', observedAt: NOW - 2 * HOUR },
    { id: 'c3', hostCountry: 'AF', sendingCountry: 'US', type: 'fully_closed', observedAt: NOW - 1 * DAY },
  ];

  it('sorts severe-first then most-recent-first', () => {
    const rows = summarizeEmbassyClosures(fixture, NOW);
    assert.equal(rows[0].id, 'c3'); // severe (fully_closed), 1d
    assert.equal(rows[1].id, 'c1'); // severe (evacuated), 5d
    assert.equal(rows[2].id, 'c2'); // moderate
  });

  it('preserves host + sending + type', () => {
    const rows = summarizeEmbassyClosures(fixture, NOW);
    const c3 = rows.find((r) => r.id === 'c3')!;
    assert.equal(c3.hostCountry, 'AF');
    assert.equal(c3.sendingCountry, 'US');
    assert.equal(c3.type, 'fully_closed');
  });
});

// ── Disputes ─────────────────────────────────────────────────────────

describe('escalationRankForStage', () => {
  it('returns monotonically increasing ranks along the ladder', () => {
    assert.equal(escalationRankForStage('protest'), 1);
    assert.equal(escalationRankForStage('recall_consultations'), 2);
    assert.equal(escalationRankForStage('expel_diplomat'), 3);
    assert.equal(escalationRankForStage('expel_ambassador'), 4);
    assert.equal(escalationRankForStage('sever_relations'), 5);
  });
});

describe('nextEscalationRung', () => {
  it('returns the next stage on the ladder', () => {
    assert.equal(nextEscalationRung('protest'), 'recall_consultations');
    assert.equal(nextEscalationRung('expel_diplomat'), 'expel_ambassador');
  });
  it('returns null at the top rung', () => {
    assert.equal(nextEscalationRung('sever_relations'), null);
  });
});

describe('summarizeDisputes', () => {
  const fixture: BilateralDispute[] = [
    { id: 'd1', countryA: 'IN', countryB: 'PK', topic: 'Kashmir', stage: 'protest', updatedAt: NOW - 1 * HOUR },
    { id: 'd2', countryA: 'CN', countryB: 'JP', topic: 'Senkaku', stage: 'expel_ambassador', updatedAt: NOW - 12 * HOUR },
    { id: 'd3', countryA: 'CA', countryB: 'IR', topic: 'Detained citizens', stage: 'recall_consultations', updatedAt: NOW - 3 * HOUR },
  ];

  it('sorts by stage rank desc, then most-recent-first', () => {
    const rows = summarizeDisputes(fixture, NOW);
    assert.equal(rows[0].id, 'd2');
    assert.equal(rows[1].id, 'd3');
    assert.equal(rows[2].id, 'd1');
  });

  it('attaches stageRank + nextStage', () => {
    const rows = summarizeDisputes(fixture, NOW);
    const d2 = rows.find((r) => r.id === 'd2')!;
    assert.equal(d2.stageRank, 4);
    assert.equal(d2.nextStage, 'sever_relations');
    const d1 = rows.find((r) => r.id === 'd1')!;
    assert.equal(d1.nextStage, 'recall_consultations');
  });

  it('preserves topic and country pair verbatim', () => {
    const rows = summarizeDisputes(fixture, NOW);
    const d2 = rows.find((r) => r.id === 'd2')!;
    assert.equal(d2.countryA, 'CN');
    assert.equal(d2.topic, 'Senkaku');
  });
});

// ── UNSC sessions ────────────────────────────────────────────────────

describe('outcomeRiskWeight', () => {
  it('weights vetoed and no_action highest, passed lowest', () => {
    assert.equal(outcomeRiskWeight('vetoed'), 1);
    assert.equal(outcomeRiskWeight('no_action'), 1);
    assert.equal(outcomeRiskWeight('statement'), 0.5);
    assert.equal(outcomeRiskWeight('resolution_passed'), 0.3);
  });
});

describe('summarizeUnscSessions', () => {
  const fixture: UnscSession[] = [
    { id: 's1', agenda: 'Gaza', requestingMember: 'FR', outcome: 'vetoed', vetoedBy: 'US', observedAt: NOW - 1 * DAY },
    { id: 's2', agenda: 'Sahel', requestingMember: 'GB', outcome: 'resolution_passed', vetoedBy: null, observedAt: NOW - 2 * HOUR },
    { id: 's3', agenda: 'Ukraine', requestingMember: 'AL', outcome: 'no_action', vetoedBy: null, observedAt: NOW - 5 * HOUR },
  ];

  it('sorts by risk weight desc, then most-recent-first', () => {
    const rows = summarizeUnscSessions(fixture, NOW);
    assert.equal(rows[0].id, 's3'); // no_action, 5h
    assert.equal(rows[1].id, 's1'); // vetoed, 1d
    assert.equal(rows[2].id, 's2'); // resolution_passed
  });

  it('preserves vetoedBy when present', () => {
    const rows = summarizeUnscSessions(fixture, NOW);
    const s1 = rows.find((r) => r.id === 's1')!;
    assert.equal(s1.vetoedBy, 'US');
  });
});

// ── Trade war signals ────────────────────────────────────────────────

describe('severityForTariff', () => {
  it('returns ladder low / moderate / severe', () => {
    assert.equal(severityForTariff(5), 'low');
    assert.equal(severityForTariff(9.9), 'low');
    assert.equal(severityForTariff(10), 'moderate');
    assert.equal(severityForTariff(24.9), 'moderate');
    assert.equal(severityForTariff(25), 'severe');
    assert.equal(severityForTariff(100), 'severe');
  });
});

describe('summarizeTradeWarSignals', () => {
  const fixture: TradeWarSignal[] = [
    { id: 't1', imposer: 'US', target: 'CN', kind: 'tariff', magnitude: 30, sector: 'semis', observedAt: NOW - 1 * HOUR },
    { id: 't2', imposer: 'EU', target: 'RU', kind: 'sanction', magnitude: 3, sector: 'oil', observedAt: NOW - 4 * HOUR },
    { id: 't3', imposer: 'US', target: 'CN', kind: 'export_control', magnitude: 1, sector: 'dual-use', observedAt: NOW - 30 * MIN },
  ];

  it('sorts severe-first then most-recent-first', () => {
    const rows = summarizeTradeWarSignals(fixture, NOW);
    assert.equal(rows[0].id, 't1'); // severe (tariff 30 %), 1h
    assert.equal(rows[1].id, 't2'); // severe (sanction 3), 4h
    assert.equal(rows[2].id, 't3'); // low (export_control 1)
  });

  it('attaches kind-specific severity', () => {
    const rows = summarizeTradeWarSignals(fixture, NOW);
    assert.equal(rows.find((r) => r.id === 't1')!.severity, 'severe');
    assert.equal(rows.find((r) => r.id === 't2')!.severity, 'severe');
    assert.equal(rows.find((r) => r.id === 't3')!.severity, 'low');
  });

  it('preserves imposer / target / sector verbatim', () => {
    const rows = summarizeTradeWarSignals(fixture, NOW);
    const t2 = rows.find((r) => r.id === 't2')!;
    assert.equal(t2.imposer, 'EU');
    assert.equal(t2.target, 'RU');
    assert.equal(t2.sector, 'oil');
  });
});

// ── Treaty events ────────────────────────────────────────────────────

describe('actionRiskRank', () => {
  it('ranks withdrew highest, reservation_added lowest', () => {
    assert.equal(actionRiskRank('reservation_added'), 1);
    assert.equal(actionRiskRank('suspended'), 2);
    assert.equal(actionRiskRank('denounced'), 3);
    assert.equal(actionRiskRank('withdrew'), 4);
  });
});

describe('summarizeTreatyEvents', () => {
  const fixture: TreatyEvent[] = [
    { id: 'tr1', treaty: 'New START', party: 'RU', action: 'suspended', effectiveAt: NOW - 7 * DAY },
    { id: 'tr2', treaty: 'INF', party: 'US', action: 'withdrew', effectiveAt: NOW - 30 * DAY },
    { id: 'tr3', treaty: 'Open Skies', party: 'RU', action: 'denounced', effectiveAt: NOW - 1 * DAY },
  ];

  it('sorts by actionRank desc, then most-recent-first', () => {
    const rows = summarizeTreatyEvents(fixture, NOW);
    assert.equal(rows[0].id, 'tr2'); // withdrew
    assert.equal(rows[1].id, 'tr3'); // denounced
    assert.equal(rows[2].id, 'tr1'); // suspended
  });

  it('attaches actionRank', () => {
    const rows = summarizeTreatyEvents(fixture, NOW);
    assert.equal(rows.find((r) => r.id === 'tr2')!.actionRank, 4);
    assert.equal(rows.find((r) => r.id === 'tr1')!.actionRank, 2);
  });

  it('preserves treaty + party verbatim', () => {
    const rows = summarizeTreatyEvents(fixture, NOW);
    const tr3 = rows.find((r) => r.id === 'tr3')!;
    assert.equal(tr3.treaty, 'Open Skies');
    assert.equal(tr3.party, 'RU');
  });
});

// ── Back-channel activity ────────────────────────────────────────────

describe('summarizeBackchannelActivity', () => {
  it('returns maintenance + zero confidence for empty input', () => {
    const r = summarizeBackchannelActivity([]);
    assert.equal(r.overall, 'maintenance');
    assert.equal(r.confidence, 0);
    assert.deepEqual(r.indicators, []);
  });

  it('classifies escalation when weighted net > 0.3', () => {
    const fixture: BackchannelIndicator[] = [
      { id: 'b1', pair: 'US-CN', type: 'leaked_communique', direction: 'escalation', confidence: 0.9, rationale: 'hot mic', observedAt: NOW },
      { id: 'b2', pair: 'US-CN', type: 'envoy_dispatched', direction: 'escalation', confidence: 0.7, rationale: 'protest', observedAt: NOW },
    ];
    const r = summarizeBackchannelActivity(fixture);
    assert.equal(r.overall, 'escalation');
    assert.ok(r.confidence > 0);
  });

  it('classifies de_escalation when weighted net < -0.3', () => {
    const fixture: BackchannelIndicator[] = [
      { id: 'b1', pair: 'A-B', type: 'third_party_mediator', direction: 'de_escalation', confidence: 0.9, rationale: 'Oman', observedAt: NOW },
      { id: 'b2', pair: 'A-B', type: 'summit_floated', direction: 'de_escalation', confidence: 0.9, rationale: 'talks', observedAt: NOW },
    ];
    const r = summarizeBackchannelActivity(fixture);
    assert.equal(r.overall, 'de_escalation');
  });

  it('returns maintenance when weighted net falls inside [-0.3, 0.3]', () => {
    const fixture: BackchannelIndicator[] = [
      { id: 'b1', pair: 'A-B', type: 'track_two', direction: 'escalation', confidence: 0.4, rationale: '', observedAt: NOW },
      { id: 'b2', pair: 'A-B', type: 'track_two', direction: 'de_escalation', confidence: 0.4, rationale: '', observedAt: NOW },
      { id: 'b3', pair: 'A-B', type: 'track_two', direction: 'maintenance', confidence: 0.8, rationale: '', observedAt: NOW },
    ];
    const r = summarizeBackchannelActivity(fixture);
    assert.equal(r.overall, 'maintenance');
  });

  it('clamps confidence into [0, 1] before weighting', () => {
    const fixture: BackchannelIndicator[] = [
      { id: 'b1', pair: 'A-B', type: 'secret_talks', direction: 'escalation', confidence: 5, rationale: '', observedAt: NOW },
      { id: 'b2', pair: 'A-B', type: 'secret_talks', direction: 'escalation', confidence: -1, rationale: '', observedAt: NOW },
    ];
    const r = summarizeBackchannelActivity(fixture);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  });
});

// ── Formatter ────────────────────────────────────────────────────────

describe('formatAge', () => {
  it('formats minutes / hours / days / months', () => {
    assert.equal(formatAge(NOW - 5 * MIN, NOW), '5m');
    assert.equal(formatAge(NOW - 3 * HOUR, NOW), '3h');
    assert.equal(formatAge(NOW - 4 * DAY, NOW), '4d');
    assert.equal(formatAge(NOW - 90 * DAY, NOW), '3mo');
  });
  it('returns "-" when observation is in the future', () => {
    assert.equal(formatAge(NOW + HOUR, NOW), '-');
  });
});

// ── Constants ────────────────────────────────────────────────────────

describe('display constants', () => {
  it('cover every band / severity / stage / outcome / kind / action / direction', () => {
    for (const band of ['low', 'moderate', 'elevated', 'severe', 'critical'] as const) {
      assert.ok(HEAT_BAND_COLOR[band]);
    }
    for (const sev of ['low', 'moderate', 'severe'] as const) {
      assert.ok(SEVERITY_COLOR[sev]);
    }
    for (const rank of ['ambassador', 'consul', 'chargé', 'diplomat', 'attaché'] as const) {
      assert.ok(RANK_LABEL[rank]);
    }
    for (const type of ['partial_suspension', 'consular_only', 'evacuated', 'fully_closed'] as const) {
      assert.ok(EMBASSY_CLOSURE_TYPE_LABEL[type]);
    }
    for (const stage of ['protest', 'recall_consultations', 'expel_diplomat', 'expel_ambassador', 'sever_relations'] as const) {
      assert.ok(DISPUTE_STAGE_LABEL[stage]);
      assert.ok(DISPUTE_STAGE_COLOR[stage]);
    }
    for (const outcome of ['resolution_passed', 'statement', 'no_action', 'vetoed'] as const) {
      assert.ok(UNSC_OUTCOME_LABEL[outcome]);
      assert.ok(UNSC_OUTCOME_COLOR[outcome]);
    }
    for (const kind of ['tariff', 'sanction', 'export_control'] as const) {
      assert.ok(TRADE_WAR_KIND_LABEL[kind]);
    }
    for (const action of ['reservation_added', 'suspended', 'denounced', 'withdrew'] as const) {
      assert.ok(TREATY_ACTION_LABEL[action]);
      assert.ok(TREATY_ACTION_COLOR[action]);
    }
    for (const type of ['third_party_mediator', 'secret_talks', 'summit_floated', 'envoy_dispatched', 'leaked_communique', 'track_two'] as const) {
      assert.ok(BACKCHANNEL_TYPE_LABEL[type]);
    }
    for (const dir of ['de_escalation', 'maintenance', 'escalation'] as const) {
      assert.ok(BACKCHANNEL_DIRECTION_GLYPH[dir]);
      assert.ok(BACKCHANNEL_DIRECTION_LABEL[dir]);
    }
  });

  it('HEAT_COMPONENT_LABEL covers every HEAT_WEIGHTS key', () => {
    const labelKeys = Object.keys(HEAT_COMPONENT_LABEL).sort();
    const weightKeys = Object.keys(HEAT_WEIGHTS).sort();
    assert.deepEqual(labelKeys, weightKeys);
  });
});
