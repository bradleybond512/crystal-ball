import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCyberStormMode } from '../cyber-storm-mode';
import type { Situation } from '../situation-types';

const NOW = 1_745_000_000_000;

function fakeCyberSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'cyber:CVE-2026-1',
    domain: 'cyber',
    title: 'macOS WebKit RCE actively exploited',
    summary: 's',
    severity: 'critical',
    confidence: 0.85,
    urgency: 0.85,
    userExposure: 0.9,
    personalImpact: { summary: '', level: 'high', reasons: ['Affected vendor matches your OS'] },
    evidence: [{ id: 'e1', source: 'CISA', claim: 'CVE-2026-1: Apple macOS RCE', observedAt: NOW, weight: 0.9 }],
    sourceAgreement: { agreeing: ['CISA', 'Apple'], disagreeing: [], independentSourceCount: 2 },
    whatChanged: [],
    expectedNextSignals: [
      { id: 'patch', description: 'Vendor patch or mitigation released' },
      { id: 'kev', description: 'CISA advisory or KEV addition' },
    ],
    invalidationSignals: [],
    recommendedActions: [],
    timeline: [],
    diagnosticsTrace: {
      createdReason: 'test',
      severityRationale: 'test',
      confidenceRationale: 'test',
      exposureRationale: 'test',
      sourceContributions: { CISA: 0.5, Apple: 0.5 },
      thresholdsCrossed: ['stage:kev_listed', 'severity:critical', 'user_vendor_match'],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: NOW,
    lastUpdated: NOW,
    ...overrides,
  };
}

describe('buildCyberStormMode — activation threshold', () => {
  it('activates for critical-severity cyber situation', () => {
    const p = buildCyberStormMode(fakeCyberSituation());
    assert.equal(p.active, true);
  });

  it('activates for severity=elevated when userExposure >= 0.85', () => {
    const p = buildCyberStormMode(fakeCyberSituation({ severity: 'elevated', userExposure: 0.9 }));
    assert.equal(p.active, true);
  });

  it('does NOT activate for severity=watch + low exposure', () => {
    const p = buildCyberStormMode(fakeCyberSituation({ severity: 'watch', userExposure: 0.2 }));
    assert.equal(p.active, false);
  });

  it('refuses to activate for non-cyber situations', () => {
    const p = buildCyberStormMode(fakeCyberSituation({ domain: 'weather' }));
    assert.equal(p.active, false);
  });
});

describe('buildCyberStormMode — patch status mapping', () => {
  it('kev_listed → patch available', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:kev_listed', 'severity:critical', 'user_vendor_match'] },
    }));
    assert.equal(p.patchStatus, 'available');
  });

  it('exploit_observed → no_patch_yet', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:exploit_observed', 'severity:critical', 'user_vendor_match'] },
    }));
    assert.equal(p.patchStatus, 'no_patch_yet');
  });

  it('ransomware_in_use → in_progress', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:ransomware_in_use', 'severity:critical', 'user_vendor_match'] },
    }));
    assert.equal(p.patchStatus, 'in_progress');
  });
});

describe('buildCyberStormMode — phishing risk', () => {
  it('critical_infra threat → high phishing risk', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:kev_listed', 'severity:critical', 'critical_infra'] },
    }));
    assert.equal(p.phishingScamRisk, 'high');
  });

  it('user_vendor_match alone → medium phishing risk', () => {
    const p = buildCyberStormMode(fakeCyberSituation());
    assert.equal(p.phishingScamRisk, 'medium');
  });

  it('no special threshold → low phishing risk', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:kev_listed', 'severity:critical'] },
      userExposure: 0.95,
    }));
    assert.equal(p.phishingScamRisk, 'low');
  });
});

describe('buildCyberStormMode — primaryAction', () => {
  it('user-vendor-match patches their system', () => {
    const p = buildCyberStormMode(fakeCyberSituation());
    assert.match(p.primaryAction, /Patch/i);
  });

  it('no vendor match → monitor accounts + watch phishing', () => {
    const p = buildCyberStormMode(fakeCyberSituation({
      userExposure: 0.95,
      diagnosticsTrace: { ...fakeCyberSituation().diagnosticsTrace, thresholdsCrossed: ['stage:kev_listed', 'severity:critical'] },
    }));
    assert.match(p.primaryAction, /Monitor|phishing/i);
  });
});

describe('buildCyberStormMode — JSON round-trip', () => {
  it('payload is JSON-serializable', () => {
    const p = buildCyberStormMode(fakeCyberSituation());
    assert.doesNotThrow(() => JSON.stringify(p));
  });
});
