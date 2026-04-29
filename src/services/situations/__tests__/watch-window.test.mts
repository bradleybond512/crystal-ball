import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWatchWindowEvaluation,
  evaluateWatchWindow,
} from '../watch-window';
import type { Situation } from '../situation-types';

const NOW = 1_745_000_000_000;

function fakeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'wx:1',
    domain: 'weather',
    title: 'Test',
    summary: 'test',
    severity: 'critical',
    confidence: 0.7,
    urgency: 0.8,
    userExposure: 0.9,
    personalImpact: { summary: '', level: 'high', reasons: [] },
    evidence: [],
    sourceAgreement: { agreeing: [], disagreeing: [], independentSourceCount: 0 },
    whatChanged: [],
    expectedNextSignals: [
      { id: 'sig:radar-strengthen', description: 'Radar core strengthens within 30 min' },
      { id: 'sig:storm-reports', description: 'Storm reports begin' },
    ],
    invalidationSignals: [
      { id: 'sig:nws-cancel', description: 'NWS cancels alert' },
    ],
    recommendedActions: [],
    timeline: [],
    diagnosticsTrace: {
      createdReason: 'test',
      severityRationale: 'test',
      confidenceRationale: 'test',
      exposureRationale: 'test',
      sourceContributions: {},
      thresholdsCrossed: [],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: NOW,
    lastUpdated: NOW,
    ...overrides,
  };
}

describe('evaluateWatchWindow — confirmation', () => {
  it('observed expected signal bumps confidence by +0.05', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.7 }),
      observedSignalIds: ['sig:radar-strengthen'],
      now: () => NOW + 5 * 60_000,
    });
    assert.equal(e.confirmed.length, 1);
    assert.ok(e.confidence > 0.7);
    assert.ok(e.confidence <= 0.95);
  });

  it('multiple confirmations stack additively', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.7 }),
      observedSignalIds: ['sig:radar-strengthen', 'sig:storm-reports'],
      now: () => NOW + 5 * 60_000,
    });
    assert.equal(e.confirmed.length, 2);
    assert.ok(e.confidence >= 0.79); // 0.7 + 0.05 + 0.05
  });

  it('confidence caps at 0.95', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.94 }),
      observedSignalIds: ['sig:radar-strengthen', 'sig:storm-reports'],
      now: () => NOW + 5 * 60_000,
    });
    assert.ok(e.confidence <= 0.95);
  });

  it('confirmed-only with no misses → phase active', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ phase: 'developing' }),
      observedSignalIds: ['sig:radar-strengthen'],
      now: () => NOW + 5 * 60_000,
    });
    assert.equal(e.phase, 'active');
  });
});

describe('evaluateWatchWindow — decay on missed signals', () => {
  it('signals past default window without observation → confidence and urgency drop', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.7, urgency: 0.8 }),
      observedSignalIds: [],
      now: () => NOW + 90 * 60_000, // past 60-min default
    });
    assert.equal(e.missed.length, 2);
    assert.ok(e.confidence < 0.7);
    assert.ok(e.urgency < 0.8);
  });

  it('signal with explicit expectByMs respects that timestamp', () => {
    const sit = fakeSituation({
      expectedNextSignals: [
        { id: 'short-window', description: 'urgent', expectByMs: NOW + 10 * 60_000 },
      ],
    });
    const e = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: [],
      now: () => NOW + 12 * 60_000, // 2 min past the 10-min window
    });
    assert.equal(e.missed.length, 1);
  });

  it('within window without observation → no adjustment', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.7 }),
      observedSignalIds: [],
      now: () => NOW + 5 * 60_000,
    });
    assert.equal(e.missed.length, 0);
    assert.equal(e.confirmed.length, 0);
    assert.equal(e.confidence, 0.7);
  });

  it('all-missed and confidence < 0.3 → phase resolved (or developing if 0.15..0.3)', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.3 }),
      observedSignalIds: [],
      now: () => NOW + 90 * 60_000,
    });
    // 0.3 - 0.1 - 0.1 = 0.1 → < 0.15 → resolved
    assert.equal(e.phase, 'resolved');
  });

  it('confidence ≥ 0.3 remains in active phase even after misses', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation({ confidence: 0.6 }),
      observedSignalIds: [],
      now: () => NOW + 90 * 60_000,
    });
    // 0.6 - 0.2 = 0.4 → ≥ 0.3 → phase unchanged
    assert.equal(e.phase, 'active');
  });
});

describe('evaluateWatchWindow — invalidation', () => {
  it('observed invalidation signal collapses confidence to 0.1 + phase resolved', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation(),
      observedSignalIds: ['sig:nws-cancel'],
      now: () => NOW + 30 * 60_000,
    });
    assert.equal(e.confidence, 0.1);
    assert.equal(e.phase, 'resolved');
    assert.equal(e.invalidated.length, 1);
    assert.equal(e.predictionOutcome?.verdict, 'false_positive');
  });

  it('invalidation wins over confirmation', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation(),
      observedSignalIds: ['sig:radar-strengthen', 'sig:nws-cancel'],
      now: () => NOW + 30 * 60_000,
    });
    assert.equal(e.confidence, 0.1);
    assert.equal(e.phase, 'resolved');
  });

  it('predictionOutcome.notes names the firing signal', () => {
    const e = evaluateWatchWindow({
      situation: fakeSituation(),
      observedSignalIds: ['sig:nws-cancel'],
      now: () => NOW + 30 * 60_000,
    });
    assert.match(e.predictionOutcome?.notes ?? '', /sig:nws-cancel/);
  });
});

describe('applyWatchWindowEvaluation', () => {
  it('appends confirmed/missed entries to whatChanged + timeline', () => {
    const sit = fakeSituation();
    const evaluation = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: ['sig:radar-strengthen'],
      now: () => NOW + 5 * 60_000,
    });
    const updated = applyWatchWindowEvaluation(sit, evaluation, NOW + 5 * 60_000);
    assert.ok(updated.whatChanged.length > sit.whatChanged.length);
    assert.ok(updated.whatChanged.some((e) => /confirmed/i.test(e.text)));
  });

  it('appends thresholdsCrossed to diagnosticsTrace', () => {
    const sit = fakeSituation();
    const evaluation = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: ['sig:radar-strengthen'],
      now: () => NOW + 5 * 60_000,
    });
    const updated = applyWatchWindowEvaluation(sit, evaluation, NOW + 5 * 60_000);
    assert.ok(updated.diagnosticsTrace.thresholdsCrossed.some((t) => t.startsWith('confirmed:')));
  });

  it('writes the new confidence/urgency/phase onto the situation', () => {
    const sit = fakeSituation({ confidence: 0.7, urgency: 0.8 });
    const evaluation = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: ['sig:nws-cancel'],
      now: () => NOW + 30 * 60_000,
    });
    const updated = applyWatchWindowEvaluation(sit, evaluation, NOW + 30 * 60_000);
    assert.equal(updated.confidence, 0.1);
    assert.equal(updated.urgency, 0.1);
    assert.equal(updated.phase, 'resolved');
    assert.equal(updated.predictionOutcome.verdict, 'false_positive');
  });

  it('preserves identity for fields not touched by the evaluator', () => {
    const sit = fakeSituation({ summary: 'unique-summary-12345' });
    const evaluation = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: [],
      now: () => NOW + 5 * 60_000,
    });
    const updated = applyWatchWindowEvaluation(sit, evaluation, NOW + 5 * 60_000);
    assert.equal(updated.summary, 'unique-summary-12345');
    assert.equal(updated.id, sit.id);
    assert.equal(updated.domain, sit.domain);
  });
});

describe('JSON round-trip after watch-window evaluation', () => {
  it('updated situation remains JSON-serializable', () => {
    const sit = fakeSituation();
    const evaluation = evaluateWatchWindow({
      situation: sit,
      observedSignalIds: ['sig:radar-strengthen'],
      now: () => NOW + 5 * 60_000,
    });
    const updated = applyWatchWindowEvaluation(sit, evaluation, NOW + 5 * 60_000);
    assert.doesNotThrow(() => JSON.stringify(updated));
  });
});
