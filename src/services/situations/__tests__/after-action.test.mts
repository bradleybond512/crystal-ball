import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAfterActionReview,
  reviewSituation,
  type GroundTruthObservation,
} from '../after-action';
import type { Situation } from '../situation-types';

const NOW = 1_745_000_000_000;
const ONE_MIN = 60_000;

function fakeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'wx:1',
    domain: 'weather',
    title: 'Tornado Warning',
    summary: 's',
    severity: 'critical',
    confidence: 0.85,
    urgency: 0.9,
    userExposure: 0.95,
    personalImpact: { summary: '', level: 'severe', reasons: [] },
    evidence: [],
    sourceAgreement: { agreeing: ['NWS', 'Spotter'], disagreeing: [], independentSourceCount: 2 },
    whatChanged: [],
    expectedNextSignals: [],
    invalidationSignals: [],
    recommendedActions: [],
    timeline: [],
    diagnosticsTrace: {
      createdReason: 't',
      severityRationale: 't',
      confidenceRationale: 't',
      exposureRationale: 't',
      sourceContributions: {},
      thresholdsCrossed: [],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: NOW,
    lastUpdated: NOW + 30 * ONE_MIN,
    ...overrides,
  };
}

describe('reviewSituation — verdict classification', () => {
  it('correct: event happened, severity tier matched, on-time warning', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    assert.equal(r.verdict, 'correct');
    assert.equal(r.warningMinutes, 30);
  });

  it('false_positive: predicted event, did not happen', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: { actuallyHappened: false },
    });
    assert.equal(r.verdict, 'false_positive');
  });

  it('late: event arrived BEFORE the alert was emitted', () => {
    const r = reviewSituation({
      situation: fakeSituation({ firstSeen: NOW + 10 * ONE_MIN }),
      groundTruth: {
        actuallyHappened: true,
        arrivedAt: NOW + 5 * ONE_MIN,
        actualSeverityTier: 'critical',
      },
    });
    assert.equal(r.verdict, 'late');
    assert.ok(r.warningMinutes < 0);
  });

  it('early: predicted severity 2+ tiers above actual', () => {
    const r = reviewSituation({
      situation: fakeSituation({ severity: 'emergency' }),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'watch',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    assert.equal(r.verdict, 'early');
  });

  it('missed: event happened but situation never reached active phase', () => {
    const r = reviewSituation({
      situation: fakeSituation({ phase: 'developing' }),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    assert.equal(r.verdict, 'missed');
  });
});

describe('reviewSituation — recommendations', () => {
  it('late verdict → recommend lowering severity threshold (require_user_approval)', () => {
    const r = reviewSituation({
      situation: fakeSituation({ firstSeen: NOW + 10 * ONE_MIN }),
      groundTruth: { actuallyHappened: true, arrivedAt: NOW + 5 * ONE_MIN },
    });
    const rec = r.recommendations.find((x) => x.target === 'severity_threshold');
    assert.ok(rec);
    assert.equal(rec?.gateAction, 'require_user_approval');
    assert.ok(rec?.delta && rec.delta < 0);
  });

  it('false_positive verdict → recommend raising confidence floor', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: { actuallyHappened: false },
    });
    const rec = r.recommendations.find((x) => x.target === 'confidence_floor');
    assert.ok(rec);
    assert.equal(rec?.gateAction, 'require_user_approval');
    assert.ok(rec?.delta && rec.delta > 0);
  });

  it('early verdict → recommend reducing source weight (require_pr_review)', () => {
    const r = reviewSituation({
      situation: fakeSituation({ severity: 'emergency' }),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'watch',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    const rec = r.recommendations.find((x) => x.target === 'source_weight');
    assert.ok(rec);
    assert.equal(rec?.gateAction, 'require_pr_review');
  });

  it('missed verdict → recommend lowering confidence floor (require_pr_review)', () => {
    const r = reviewSituation({
      situation: fakeSituation({ phase: 'developing' }),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    const rec = r.recommendations.find((x) => x.target === 'confidence_floor');
    assert.ok(rec);
    assert.equal(rec?.gateAction, 'require_pr_review');
  });

  it('correct + long lead time → tighten urgency decay (allow_auto)', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 180 * ONE_MIN, // 3 hours ahead
      },
    });
    const rec = r.recommendations.find((x) => x.target === 'urgency_decay_rate');
    assert.ok(rec);
    assert.equal(rec?.gateAction, 'allow_auto');
  });

  it('no recommendation when verdict is correct + reasonable lead time', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    assert.equal(r.recommendations.length, 0);
  });
});

describe('reviewSituation — brief composition', () => {
  it('positive lead time: brief says "We warned X min before arrival"', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 42 * ONE_MIN,
      },
    });
    assert.match(r.brief, /We warned 42 min before arrival/i);
  });

  it('negative lead time: brief flags late alert', () => {
    const r = reviewSituation({
      situation: fakeSituation({ firstSeen: NOW + 10 * ONE_MIN }),
      groundTruth: { actuallyHappened: true, arrivedAt: NOW + 5 * ONE_MIN },
    });
    assert.match(r.brief, /late alert/i);
  });

  it('brief includes source agreement when present', () => {
    const r = reviewSituation({
      situation: fakeSituation({
        sourceAgreement: { agreeing: ['NWS', 'Spotter'], disagreeing: [], independentSourceCount: 2 },
      }),
      groundTruth: { actuallyHappened: true, arrivedAt: NOW + 10 * ONE_MIN },
    });
    assert.match(r.brief, /Sources confirmed/i);
    assert.match(r.brief, /NWS|Spotter/);
  });

  it('verdict-specific recommendation hint appears in brief', () => {
    const r = reviewSituation({
      situation: fakeSituation({ firstSeen: NOW + 10 * ONE_MIN }),
      groundTruth: { actuallyHappened: true, arrivedAt: NOW + 5 * ONE_MIN },
    });
    assert.match(r.brief, /lower severity threshold/i);
  });
});

describe('applyAfterActionReview', () => {
  it('writes verdict + notes onto the situation', () => {
    const sit = fakeSituation();
    const report = reviewSituation({
      situation: sit,
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
      },
    });
    const updated = applyAfterActionReview(sit, report, NOW + 60 * ONE_MIN);
    assert.equal(updated.phase, 'resolved');
    assert.equal(updated.predictionOutcome.verdict, 'correct');
    assert.equal(updated.predictionOutcome.resolvedAt, NOW + 60 * ONE_MIN);
    assert.match(updated.predictionOutcome.notes ?? '', /Verdict: correct/);
  });

  it('preserves identity for fields the review does not touch', () => {
    const sit = fakeSituation({ summary: 'unique-summary-99' });
    const report = reviewSituation({
      situation: sit,
      groundTruth: { actuallyHappened: false },
    });
    const updated = applyAfterActionReview(sit, report);
    assert.equal(updated.summary, 'unique-summary-99');
    assert.equal(updated.id, sit.id);
  });
});

describe('after-action — JSON round-trip', () => {
  it('report is JSON-serializable', () => {
    const r = reviewSituation({
      situation: fakeSituation(),
      groundTruth: {
        actuallyHappened: true,
        actualSeverityTier: 'critical',
        arrivedAt: NOW + 30 * ONE_MIN,
        observedImpact: 'Tornado on the ground for 4 minutes',
      },
    });
    assert.doesNotThrow(() => JSON.stringify(r));
  });

  it('updated situation is JSON-serializable', () => {
    const sit = fakeSituation();
    const report = reviewSituation({
      situation: sit,
      groundTruth: { actuallyHappened: false },
    });
    const updated = applyAfterActionReview(sit, report);
    assert.doesNotThrow(() => JSON.stringify(updated));
  });
});
