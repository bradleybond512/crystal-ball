import assert from 'node:assert/strict';
import test from 'node:test';

import { mineCascades, cascadePairKeys, type DomainEvent } from '../learned-cascades.ts';
import {
  computeCompoundRisk,
  registerLearnedCascadePairs,
  clearLearnedCascadePairs,
  type CompoundRiskInput,
} from '../compound-risk.ts';

const NOW = 1_745_000_000_000;
const HOUR = 3_600_000;

test('mines a strong A→B cascade when B reliably follows A within the window', () => {
  const events: DomainEvent[] = [];
  // 5 weather events, each followed by an infra event ~6h later.
  for (let i = 0; i < 5; i += 1) {
    events.push({ domain: 'weather', at: NOW + i * 24 * HOUR });
    events.push({ domain: 'infra', at: NOW + i * 24 * HOUR + 6 * HOUR });
  }
  const cascades = mineCascades(events, { windowMs: 72 * HOUR });
  const wi = cascades.find((c) => c.from === 'weather' && c.to === 'infra');
  assert.ok(wi, 'weather→infra cascade discovered');
  assert.equal(wi!.support, 5);
  assert.ok(wi!.confidence > 0.9, `confidence ${wi!.confidence}`);
  assert.equal(wi!.medianLagMs, 6 * HOUR);
});

test('does not emit a cascade below the support/confidence floor', () => {
  // weather appears 5×, infra follows only once → confidence 0.2 < 0.3 default.
  const events: DomainEvent[] = [
    ...Array.from({ length: 5 }, (_, i): DomainEvent => ({ domain: 'weather', at: NOW + i * 24 * HOUR })),
    { domain: 'infra', at: NOW + 6 * HOUR },
  ];
  const cascades = mineCascades(events, { windowMs: 12 * HOUR });
  assert.equal(cascades.find((c) => c.from === 'weather' && c.to === 'infra'), undefined);
});

test('respects the lag window — a too-late B does not count', () => {
  const events: DomainEvent[] = [];
  for (let i = 0; i < 4; i += 1) {
    events.push({ domain: 'cyber', at: NOW + i * 30 * 24 * HOUR });
    events.push({ domain: 'markets', at: NOW + i * 30 * 24 * HOUR + 100 * HOUR }); // beyond 72h
  }
  const cascades = mineCascades(events, { windowMs: 72 * HOUR, minAntecedents: 3 });
  assert.equal(cascades.find((c) => c.from === 'cyber' && c.to === 'markets'), undefined);
});

test('excludes self-pairs and respects minAntecedents', () => {
  const events: DomainEvent[] = [
    { domain: 'weather', at: NOW }, { domain: 'weather', at: NOW + HOUR },
    { domain: 'infra', at: NOW + 2 * HOUR },
  ];
  const cascades = mineCascades(events, { minAntecedents: 3 });
  assert.equal(cascades.length, 0, 'too few antecedents → nothing eligible; no self-pairs');
});

test('cascadePairKeys emits from|to keys above the confidence floor', () => {
  const keys = cascadePairKeys(
    [
      { from: 'weather', to: 'infra', support: 5, confidence: 0.9, medianLagMs: HOUR },
      { from: 'cyber', to: 'markets', support: 2, confidence: 0.2, medianLagMs: HOUR },
    ],
    0.3,
  );
  assert.ok(keys.has('weather|infra'));
  assert.ok(!keys.has('cyber|markets'), 'below-floor pair excluded');
});

test('registered learned pairs augment compound-risk clustering (and clear cleanly)', () => {
  // Two inputs that share NO entity/region/location and are NOT a fixed
  // cascade pair (cyber|aviation). They should compound ONLY once the
  // learned pair is registered.
  const inputs: CompoundRiskInput[] = [
    { id: 'a', title: 'Cyber intrusion at carrier ops', domain: 'cyber', domains: ['cyber'], severityScore: 80, confidence: 0.9, entities: ['ACME'] },
    { id: 'b', title: 'Fleet groundings cascade', domain: 'aviation', domains: ['aviation'], severityScore: 75, confidence: 0.9, entities: ['ZETA'] },
  ];

  clearLearnedCascadePairs();
  const before = computeCompoundRisk(inputs);
  assert.equal(before.length, 2, 'unrelated domains do not compound by default');

  registerLearnedCascadePairs(['cyber|aviation']);
  const after = computeCompoundRisk(inputs);
  assert.equal(after.length, 1, 'a registered learned pair makes them compound');
  assert.equal(after[0]!.memberIds.length, 2);

  clearLearnedCascadePairs();
  assert.equal(computeCompoundRisk(inputs).length, 2, 'clearing restores default behavior');
});
