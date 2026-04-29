import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectCompoundThreats,
  DEFAULT_CASCADE_PATHS,
  type CascadePathDefinition,
} from '../compound-threat';
import type { Situation } from '../situation-types';

const NOW = 1_745_000_000_000;

function fakeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'test:1',
    domain: 'weather',
    title: 'Weather',
    summary: 's',
    severity: 'critical',
    confidence: 0.8,
    urgency: 0.7,
    userExposure: 0.5,
    personalImpact: { summary: '', level: 'medium', reasons: [] },
    evidence: [],
    sourceAgreement: { agreeing: ['NWS'], disagreeing: [], independentSourceCount: 1 },
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
    lastUpdated: NOW,
    ...overrides,
  };
}

describe('detectCompoundThreats — empty + below-threshold inputs', () => {
  it('returns empty when no situations are passed', () => {
    const r = detectCompoundThreats({ situations: [], now: () => NOW });
    assert.deepEqual(r.compounds, []);
    assert.deepEqual(r.suppressedIds, []);
  });

  it('ignores situations below minSeverity', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'a', domain: 'weather', severity: 'watch' }),
        fakeSituation({ id: 'b', domain: 'cyber', severity: 'watch' }),
      ],
      now: () => NOW,
    });
    assert.deepEqual(r.compounds, []);
  });

  it('ignores resolved situations', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'a', domain: 'weather', severity: 'critical', phase: 'resolved' }),
        fakeSituation({ id: 'b', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    assert.deepEqual(r.compounds, []);
  });
});

describe('detectCompoundThreats — military + cyber cascade', () => {
  it('matches mil_cyber_infra when both domains have eligible situations', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    assert.equal(r.compounds.length, 1);
    assert.equal(r.compounds[0]?.id, 'compound:mil_cyber_infra');
    assert.equal(r.compounds[0]?.domain, 'compound');
  });

  it('suppresses constituent ids', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    assert.ok(r.suppressedIds.includes('mil-1'));
    assert.ok(r.suppressedIds.includes('cy-1'));
  });
});

describe('detectCompoundThreats — severity bump', () => {
  it('compound severity is one tier above max constituent', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'elevated' }),
      ],
      now: () => NOW,
    });
    // max constituent = 'critical' → bumped to 'emergency'
    assert.equal(r.compounds[0]?.severity, 'emergency');
  });

  it('emergency stays at emergency (no further bump)', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'emergency' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    assert.equal(r.compounds[0]?.severity, 'emergency');
  });
});

describe('detectCompoundThreats — confidence + exposure aggregation', () => {
  it('compound confidence is the average of constituents', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical', confidence: 0.6 }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical', confidence: 0.9 }),
      ],
      now: () => NOW,
    });
    assert.equal(r.compounds[0]?.confidence, 0.75);
  });

  it('compound urgency is the max of constituents', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical', urgency: 0.4 }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical', urgency: 0.9 }),
      ],
      now: () => NOW,
    });
    assert.equal(r.compounds[0]?.urgency, 0.9);
  });

  it('compound userExposure is the max of constituents', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical', userExposure: 0.2 }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical', userExposure: 0.95 }),
      ],
      now: () => NOW,
    });
    assert.equal(r.compounds[0]?.userExposure, 0.95);
    assert.equal(r.compounds[0]?.personalImpact.level, 'severe');
  });
});

describe('detectCompoundThreats — diagnostics trace', () => {
  it('records cascade id + constituent ids in thresholdsCrossed', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    const t = r.compounds[0]?.diagnosticsTrace.thresholdsCrossed ?? [];
    assert.ok(t.some((x) => x.startsWith('cascade:')));
    assert.ok(t.includes('constituent:mil-1'));
    assert.ok(t.includes('constituent:cy-1'));
  });
});

describe('detectCompoundThreats — JSON round-trip', () => {
  it('compound situations are JSON-serializable', () => {
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-1', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-1', domain: 'cyber', severity: 'critical' }),
      ],
      now: () => NOW,
    });
    assert.doesNotThrow(() => JSON.stringify(r.compounds));
  });
});

describe('detectCompoundThreats — custom cascade catalog', () => {
  it('honors a custom cascade definition', () => {
    const customPath: CascadePathDefinition = {
      id: 'mil_cyber_infra',
      name: 'Custom mil+cyber',
      domainChain: ['military', 'cyber'],
      cascadeExplanation: 'custom',
    };
    const r = detectCompoundThreats({
      situations: [
        fakeSituation({ id: 'mil-x', domain: 'military', severity: 'critical' }),
        fakeSituation({ id: 'cy-x', domain: 'cyber', severity: 'critical' }),
      ],
      cascadePaths: [customPath],
      now: () => NOW,
    });
    assert.equal(r.compounds.length, 1);
  });
});

describe('detectCompoundThreats — default catalog completeness', () => {
  it('default catalog covers the 6 vision-doc cascades', () => {
    const ids = DEFAULT_CASCADE_PATHS.map((p) => p.id).sort();
    assert.deepEqual(ids, [
      'conflict_chokepoint_commodity',
      'geomagnetic_grid_aviation',
      'heatwave_smoke_hospital',
      'hurricane_port_fuel',
      'mil_cyber_infra',
      'weather_airport_travel',
    ]);
  });
});
