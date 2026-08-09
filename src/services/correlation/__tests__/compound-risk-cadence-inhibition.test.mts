import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import type { InhibitoryLeadLagEdge } from '../lead-lag.ts';
import { clearInhibitorySnapshot, replaceInhibitorySnapshot } from '../inhibition.ts';
import {
  recomputeCompoundRisk,
  resetCompoundRiskCadence,
  situationsToCompoundInputs,
} from '../compound-risk-cadence.ts';
import type { Situation } from '../../intelligence/situation-store-v2.ts';
import { makeCorrelationContributor } from '../../survival/correlation-contributor.ts';
import { computeMultiAxisPosture } from '../../survival/survival-posture.ts';

const T0 = Date.UTC(2026, 7, 4, 12);

function situation(overrides: Partial<Situation> & { id: string }): Situation {
  return {
    name: overrides.id,
    domain: 'wildfire',
    relatedDomains: [],
    severity: 'critical',
    status: 'active',
    confidence: 1,
    observations: [],
    edges: [],
    entityIds: ['shared'],
    tags: [],
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...overrides,
  } as Situation;
}

function inhibitor(): InhibitoryLeadLagEdge {
  return {
    effect: 'inhibitory',
    from: 'wildfire',
    to: 'infrastructure',
    windowMs: 21_600_000,
    support: 0,
    antecedents: 12,
    followRate: 0,
    expectedRate: 0.5,
    lift: 0,
    zScore: -8,
    strength: 0,
    explanation: 'wildfire suppresses infrastructure',
  };
}

beforeEach(() => {
  clearInhibitorySnapshot();
  resetCompoundRiskCadence();
});

test('mapper retains normalized compound domains without a shadow-only source-domain field', () => {
  const [input] = situationsToCompoundInputs([
    situation({ id: 'w', relatedDomains: ['infrastructure'] }),
  ]);

  assert.deepEqual(input?.domains, ['weather', 'infra']);
  assert.equal(input ? 'sourceDomains' in input : true, false);
});

test('active learned inhibition cannot change compound results or downstream posture', () => {
  const situations = [
    situation({ id: 'w' }),
    situation({ id: 'i', domain: 'infrastructure' }),
  ];
  const undampened = recomputeCompoundRisk(situations, T0).results;
  const threatsBefore = makeCorrelationContributor(undampened).contribute(T0);
  const postureBefore = computeMultiAxisPosture({
    contributors: [makeCorrelationContributor(undampened)],
    freshness: [],
    capturedAtMs: T0,
  }, { now: T0 });
  replaceInhibitorySnapshot([inhibitor()], 4, T0);

  const shadowActive = recomputeCompoundRisk(situations, T0 + 1).results;
  const threatsAfter = makeCorrelationContributor(shadowActive).contribute(T0);
  const postureAfter = computeMultiAxisPosture({
    contributors: [makeCorrelationContributor(shadowActive)],
    freshness: [],
    capturedAtMs: T0,
  }, { now: T0 });

  assert.deepEqual(shadowActive, undampened);
  assert.deepEqual(threatsAfter, threatsBefore);
  assert.deepEqual(postureAfter, postureBefore);
  assert.equal(situations[0]!.severity, 'critical');
  assert.equal(situations[0]!.confidence, 1);
});

test('active and expired learned inhibition are both operationally neutral', () => {
  const situations = [
    situation({ id: 'w' }),
    situation({ id: 'i', domain: 'infrastructure' }),
  ];
  replaceInhibitorySnapshot([inhibitor()], 4, T0);
  const active = recomputeCompoundRisk(situations, T0 + 1).results;
  const expired = recomputeCompoundRisk(situations, T0 + 2 * 3_600_000 + 1).results;

  assert.deepEqual(active, expired);
});
