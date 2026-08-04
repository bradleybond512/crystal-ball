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

test('mapper preserves raw situation domains while retaining normalized compound domains', () => {
  const [input] = situationsToCompoundInputs([
    situation({ id: 'w', relatedDomains: ['infrastructure'] }),
  ]);

  assert.deepEqual(input?.sourceDomains, ['wildfire', 'infrastructure']);
  assert.deepEqual(input?.domains, ['weather', 'infra']);
});

test('active learned inhibition dampens only the grouped compound score and records provenance', () => {
  const situations = [
    situation({ id: 'w' }),
    situation({ id: 'i', domain: 'infrastructure' }),
  ];
  const inputsBefore = situationsToCompoundInputs(situations);
  const undampened = recomputeCompoundRisk(situations, T0).results[0]!;
  replaceInhibitorySnapshot([inhibitor()], 4, T0);

  const dampened = recomputeCompoundRisk(situations, T0 + 1).results[0]!;

  assert.ok(dampened.score < undampened.score);
  assert.deepEqual(dampened.memberIds, undampened.memberIds);
  assert.deepEqual(dampened.affectedDomains, undampened.affectedDomains);
  assert.equal(dampened.level, undampened.level);
  assert.equal(dampened.inhibition?.fromDomain, 'wildfire');
  assert.equal(dampened.inhibition?.toDomain, 'infrastructure');
  assert.deepEqual(situationsToCompoundInputs(situations), inputsBefore);
  assert.equal(situations[0]!.severity, 'critical');
  assert.equal(situations[0]!.confidence, 1);
});

test('expired learned inhibition is neutral at compound cadence', () => {
  const situations = [
    situation({ id: 'w' }),
    situation({ id: 'i', domain: 'infrastructure' }),
  ];
  replaceInhibitorySnapshot([inhibitor()], 4, T0);
  const active = recomputeCompoundRisk(situations, T0 + 1).results[0]!;
  const expired = recomputeCompoundRisk(situations, T0 + 2 * 3_600_000 + 1).results[0]!;

  assert.ok(active.score < expired.score);
  assert.equal(expired.inhibition, undefined);
});
