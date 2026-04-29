import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  rankingScore,
  severityFromScore,
  SEVERITY_RANK,
  type Situation,
} from '../situation-types';

const baseSituation = (
  overrides: Partial<Pick<Situation, 'severity' | 'confidence' | 'urgency' | 'userExposure'>>,
): Pick<Situation, 'severity' | 'confidence' | 'urgency' | 'userExposure'> => ({
  severity: 'fyi',
  confidence: 0.5,
  urgency: 0.5,
  userExposure: 0.5,
  ...overrides,
});

describe('SEVERITY_RANK', () => {
  it('orders fyi < watch < elevated < critical < emergency', () => {
    assert.ok(SEVERITY_RANK.fyi < SEVERITY_RANK.watch);
    assert.ok(SEVERITY_RANK.watch < SEVERITY_RANK.elevated);
    assert.ok(SEVERITY_RANK.elevated < SEVERITY_RANK.critical);
    assert.ok(SEVERITY_RANK.critical < SEVERITY_RANK.emergency);
  });
});

describe('severityFromScore', () => {
  it('maps the score ladder correctly', () => {
    assert.equal(severityFromScore(0.95), 'emergency');
    assert.equal(severityFromScore(0.85), 'emergency');
    assert.equal(severityFromScore(0.7), 'critical');
    assert.equal(severityFromScore(0.5), 'elevated');
    assert.equal(severityFromScore(0.3), 'watch');
    assert.equal(severityFromScore(0.1), 'fyi');
    assert.equal(severityFromScore(0), 'fyi');
  });

  it('round-trips: every emitted severity maps back to the same tier', () => {
    // For each severity, find a representative score and confirm
    // severityFromScore returns the same tier.
    assert.equal(severityFromScore(0.05), 'fyi');
    assert.equal(severityFromScore(0.3), 'watch');
    assert.equal(severityFromScore(0.5), 'elevated');
    assert.equal(severityFromScore(0.7), 'critical');
    assert.equal(severityFromScore(0.9), 'emergency');
  });
});

describe('rankingScore', () => {
  it('ranks higher severity above lower severity at equal confidence/urgency/exposure', () => {
    const lo = rankingScore(baseSituation({ severity: 'fyi' }));
    const hi = rankingScore(baseSituation({ severity: 'emergency' }));
    assert.ok(hi > lo);
  });

  it('low-confidence emergency does not outrank high-confidence elevated', () => {
    const lowConfEmergency = rankingScore(
      baseSituation({ severity: 'emergency', confidence: 0.1, urgency: 0.5, userExposure: 0.5 }),
    );
    const highConfElevated = rankingScore(
      baseSituation({ severity: 'elevated', confidence: 0.95, urgency: 0.5, userExposure: 0.5 }),
    );
    assert.ok(highConfElevated > lowConfEmergency,
      `expected highConfElevated (${highConfElevated}) > lowConfEmergency (${lowConfEmergency})`);
  });

  it('userExposure breaks ties at equal severity/confidence/urgency', () => {
    const direct = rankingScore(baseSituation({ severity: 'critical', userExposure: 0.9 }));
    const distant = rankingScore(baseSituation({ severity: 'critical', userExposure: 0.1 }));
    assert.ok(direct > distant);
  });

  it('urgency contributes positively', () => {
    const urgent = rankingScore(baseSituation({ severity: 'elevated', urgency: 0.95 }));
    const calm = rankingScore(baseSituation({ severity: 'elevated', urgency: 0.05 }));
    assert.ok(urgent > calm);
  });

  it('zero-confidence situation still has comparative ordering (floor 0.1)', () => {
    const a = rankingScore(baseSituation({ severity: 'critical', confidence: 0 }));
    const b = rankingScore(baseSituation({ severity: 'fyi', confidence: 0 }));
    assert.ok(a > b);
  });

  it('is deterministic', () => {
    const inputs = baseSituation({ severity: 'critical', confidence: 0.7, urgency: 0.8, userExposure: 0.6 });
    assert.equal(rankingScore(inputs), rankingScore(inputs));
  });
});
