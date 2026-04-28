/**
 * Coverage for `failure-prediction.ts` — verifies the deterministic
 * per-capability risk classifier.
 *
 * Cases exercised:
 *   - All-healthy inputs → all-low.
 *   - Stale source on a safety-critical domain → elevated/high.
 *   - Failing safety-critical algorithm → unsafe.
 *   - Notification permission denied + safety domain → unsafe.
 *   - Active-domain escalation moves elevated→high and high→unsafe.
 *   - JSON-serializable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { predictFailures, type PredictFailuresInput } from '../failure-prediction.ts';
import type { CapabilityReadiness } from '@/services/ops/capability-readiness';
import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';

const NOW = 1_745_000_000_000;

const weatherCapability: CapabilityReadiness = {
  capabilityId: 'weather-warning',
  label: 'Weather warning',
  domain: 'weather_safety',
  level: 'ready',
  score: 1.0,
  checkpoints: [],
  summary: 'Weather warnings are operational.',
};

const cyberCapability: CapabilityReadiness = {
  capabilityId: 'cyber-watch',
  label: 'Cyber exposure',
  domain: 'cyber_exposure',
  level: 'ready',
  score: 1.0,
  checkpoints: [],
  summary: 'Cyber feeds are operational.',
};

function baseInput(overrides: Partial<PredictFailuresInput> = {}): PredictFailuresInput {
  return {
    generatedAt: NOW,
    capabilityReadiness: [weatherCapability, cyberCapability],
    algorithmHealth: [],
    providerSnapshots: [],
    notificationTrace: { permissionGranted: true, recentDispatchCount: 0, recentDispatchErrors: 0 },
    sourceFreshness: { byCapability: {} },
    ...overrides,
  };
}

test('all-healthy inputs produce all-low predictions', () => {
  const report = predictFailures(baseInput());
  assert.equal(report.worst, 'low');
  for (const p of report.predictions) assert.equal(p.level, 'low');
});

test('stale weather source escalates beyond ceiling (30 min)', () => {
  const report = predictFailures(baseInput({
    sourceFreshness: {
      byCapability: {
        'weather-warning': { msSinceFresh: 90 * 60 * 1000, silentProviders: 0, degradedProviders: 0 },
      },
    },
  }));
  const weather = report.predictions.find((p) => p.capabilityId === 'weather-warning')!;
  assert.notEqual(weather.level, 'low');
  assert.ok(weather.reasons.some((r) => r.id === 'source_stale'));
});

test('safety-critical failing algorithm pushes capability to unsafe', () => {
  const algo: AlgorithmHealth = {
    algorithmId: 'weather-urgency',
    label: 'Weather urgency',
    domain: 'weather_urgency',
    criticality: 'safety',
    status: 'unsafe',
    reason: 'Hit rate dropped below 60% over 50 samples',
    explanation: ['Hit rate 58%'],
  };
  const report = predictFailures(baseInput({ algorithmHealth: [algo] }));
  const weather = report.predictions.find((p) => p.capabilityId === 'weather-warning')!;
  assert.equal(weather.level, 'unsafe', `weather: ${weather.level} reasons=${JSON.stringify(weather.reasons)}`);
  assert.ok(weather.reasons.some((r) => r.id === 'algo_unsafe'));
});

test('notification permission denied + weather safety → unsafe', () => {
  const report = predictFailures(baseInput({
    notificationTrace: { permissionGranted: false, recentDispatchCount: 0, recentDispatchErrors: 0 },
  }));
  const weather = report.predictions.find((p) => p.capabilityId === 'weather-warning')!;
  assert.equal(weather.level, 'unsafe');
  assert.ok(weather.reasons.some((r) => r.id === 'notif_denied'));
  assert.ok(weather.recommendations.some((r) => r.id === 'enable_notifications'));
  // Cyber capability is also a safety domain; same signal applies.
  const cyber = report.predictions.find((p) => p.capabilityId === 'cyber-watch')!;
  assert.equal(cyber.level, 'unsafe');
});

test('active-domain escalation moves the level up one tier', () => {
  // A stale safety-domain source (weight 0.5) lands at "high" without
  // escalation; with the user actively depending on weather_safety
  // it escalates to "unsafe".
  const fresh = {
    byCapability: {
      'weather-warning': { msSinceFresh: 35 * 60 * 1000, silentProviders: 0, degradedProviders: 0 },
    },
  };
  const without = predictFailures(baseInput({ sourceFreshness: fresh }));
  const w1 = without.predictions.find((p) => p.capabilityId === 'weather-warning')!;
  assert.equal(w1.level, 'high');

  const withActive = predictFailures(baseInput({ sourceFreshness: fresh, activeDomains: ['weather_safety'] }));
  const w2 = withActive.predictions.find((p) => p.capabilityId === 'weather-warning')!;
  assert.equal(w2.level, 'unsafe', 'active domain escalates high → unsafe');
});

test('active-domain escalation: elevated → high (non-safety domain)', () => {
  // Markets is non-safety, so a stale source uses the lower 0.3
  // weight, landing at "elevated"; active-domain escalation lifts
  // it to "high".
  const marketCap: CapabilityReadiness = {
    capabilityId: 'market-pulse',
    label: 'Market pulse',
    domain: 'market_portfolio_risk',
    level: 'ready',
    score: 1.0,
    checkpoints: [],
    summary: 'Markets feed operational.',
  };
  const fresh = {
    byCapability: {
      'market-pulse': { msSinceFresh: 30 * 60 * 1000, silentProviders: 0, degradedProviders: 0 },
    },
  };
  const without = predictFailures(baseInput({ capabilityReadiness: [marketCap], sourceFreshness: fresh }));
  const m1 = without.predictions.find((p) => p.capabilityId === 'market-pulse')!;
  assert.equal(m1.level, 'elevated', `expected elevated, got ${m1.level} score=${m1.score}`);

  const withActive = predictFailures(baseInput({
    capabilityReadiness: [marketCap],
    sourceFreshness: fresh,
    activeDomains: ['market_portfolio_risk'],
  }));
  const m2 = withActive.predictions.find((p) => p.capabilityId === 'market-pulse')!;
  assert.equal(m2.level, 'high', 'active domain escalates elevated → high');
});

test('not_ready capability surfaces remediation suggestions', () => {
  const cap: CapabilityReadiness = {
    capabilityId: 'cyber-watch',
    label: 'Cyber exposure',
    domain: 'cyber_exposure',
    level: 'not_ready',
    score: 0,
    checkpoints: [{
      id: 'cyber-key-set',
      label: 'OTX key set',
      satisfied: false,
      reason: 'OTX_API_KEY not configured',
      remediation: 'Add OTX API key in Settings → API Keys',
    }],
    summary: 'OTX_API_KEY missing.',
  };
  const report = predictFailures(baseInput({ capabilityReadiness: [cap] }));
  const cyber = report.predictions.find((p) => p.capabilityId === 'cyber-watch')!;
  assert.equal(cyber.recommendations.length, 1);
  assert.equal(cyber.recommendations[0]!.needsUser, true);
  assert.match(cyber.recommendations[0]!.text, /OTX/);
});

test('worst level reflects the worst single prediction', () => {
  const report = predictFailures(baseInput({
    notificationTrace: { permissionGranted: false, recentDispatchCount: 0, recentDispatchErrors: 0 },
  }));
  assert.equal(report.worst, 'unsafe');
});

test('empty input → low risk + sane summary', () => {
  const report = predictFailures(baseInput({ capabilityReadiness: [] }));
  assert.equal(report.predictions.length, 0);
  assert.equal(report.worst, 'low');
  assert.match(report.summary, /No capabilities/);
});

test('output is JSON-serializable', () => {
  const report = predictFailures(baseInput({
    notificationTrace: { permissionGranted: false, recentDispatchCount: 5, recentDispatchErrors: 4 },
  }));
  const json = JSON.stringify(report);
  const round = JSON.parse(json);
  assert.equal(JSON.stringify(round), json);
});

test('determinism: same inputs produce same outputs', () => {
  const input = baseInput({
    sourceFreshness: {
      byCapability: { 'weather-warning': { msSinceFresh: 60 * 60 * 1000, silentProviders: 1, degradedProviders: 1 } },
    },
  });
  const a = predictFailures(input);
  const b = predictFailures(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
