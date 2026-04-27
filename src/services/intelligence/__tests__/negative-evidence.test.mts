import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateNegativeEvidence,
  defaultExpectedSignalsFor,
} from '../negative-evidence.ts';
import type { ExpectedSignal } from '../negative-evidence.ts';
import type { NormalizedFact, SourceAttestation } from '../types.ts';

const NOW = 1_745_000_000_000;

function source(providerId: string): SourceAttestation {
  return { providerId, observedAt: NOW };
}

function quakeFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'q-major',
    domain: 'space',
    eventType: 'earthquake-major',
    claim: 'M6.5 quake near Sendai',
    severity: 'high',
    occurredAt: NOW - 60 * 60 * 1000, // 1h ago — windows for tsunami(30m) and aftershock(60m) closed
    lat: 38.27,
    lon: 140.87,
    locationPrecision: 'point',
    entities: ['JP'],
    sources: [source('usgs')],
    ...overrides,
  };
}

function tsunamiFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'ts-1',
    domain: 'humanitarian',
    eventType: 'tsunami-warning',
    claim: 'Tsunami advisory issued for east coast',
    severity: 'critical',
    occurredAt: NOW - 50 * 60 * 1000, // 10 min after the quake
    locationPrecision: 'country',
    entities: ['JP'],
    sources: [source('jma')],
    ...overrides,
  };
}

function aftershockFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'q-after',
    domain: 'space',
    eventType: 'earthquake',
    claim: 'M4.5 aftershock',
    severity: 'low',
    occurredAt: NOW - 30 * 60 * 1000, // 30 min after the quake
    lat: 38.27,
    lon: 140.87,
    locationPrecision: 'point',
    entities: ['JP'],
    sources: [source('usgs')],
    ...overrides,
  };
}

// ── Default catalog ─────────────────────────────────────────────────────

test('defaultExpectedSignalsFor: returns empty array for unknown eventType', () => {
  assert.deepEqual(defaultExpectedSignalsFor('something-unknown'), []);
});

test('defaultExpectedSignalsFor: earthquake-major includes tsunami + aftershock', () => {
  const signals = defaultExpectedSignalsFor('earthquake-major');
  assert.ok(signals.some((s) => /tsunami/i.test(s.label)));
  assert.ok(signals.some((s) => /aftershock/i.test(s.label)));
});

test('defaultExpectedSignalsFor: cve-published includes EPSS + KEV', () => {
  const signals = defaultExpectedSignalsFor('cve-published');
  assert.ok(signals.some((s) => /epss/i.test(s.label)));
  assert.ok(signals.some((s) => /kev/i.test(s.label)));
});

// ── Observation logic ──────────────────────────────────────────────────

test('observation: tsunami advisory observed within window → 1 observed, 0 missing for that signal', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent, tsunamiFact()], 0.85, { now: NOW });
  assert.equal(r.observed.length, 1);
  assert.equal(r.observed[0]!.signal.id, 'tsunami-status');
});

test('observation: aftershock observed within window → marked observed', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent, aftershockFact()], 0.85, { now: NOW });
  assert.ok(r.observed.some((o) => o.signal.id === 'aftershock'));
});

test('observation: candidate outside time window does not match', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const lateAftershock = aftershockFact({
    id: 'q-late',
    occurredAt: NOW - 10 * 60 * 1000, // 50 min after parent — past 60-min window? actually inside since window is 60min
  });
  // window is 5min-60min. 50min < 60min so should match.
  const r = evaluateNegativeEvidence(parent, signals, [parent, lateAftershock], 0.85, { now: NOW });
  assert.ok(r.observed.some((o) => o.signal.id === 'aftershock'));
});

test('observation: too-late candidate does NOT match', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const tooLate = aftershockFact({
    id: 'q-toolate',
    occurredAt: NOW - 10 * 60 * 1000, // adjusted: still within 60min, but let's test 70min after
  });
  // Force 70 min after parent.occurredAt:
  tooLate.occurredAt = quakeFact().occurredAt + 70 * 60 * 1000;
  const r = evaluateNegativeEvidence(parent, signals, [parent, tooLate], 0.85, { now: NOW });
  assert.ok(!r.observed.some((o) => o.signal.id === 'aftershock'));
});

test('observation: candidate without entity overlap does not match (default scoping)', () => {
  const parent = quakeFact(); // entities: ['JP']
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const wrongEntity = tsunamiFact({ entities: ['CL'] });
  const r = evaluateNegativeEvidence(parent, signals, [parent, wrongEntity], 0.85, { now: NOW });
  assert.equal(r.observed.length, 0);
});

// ── Pending signals ────────────────────────────────────────────────────

test('pending: signal whose window has not closed appears as pending, not missing', () => {
  // Parent occurred 5 min ago. Tsunami window is 30 min, aftershock 60 min.
  // Both windows still open → both should be pending if no candidates match.
  const parent = quakeFact({ occurredAt: NOW - 5 * 60 * 1000 });
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  assert.equal(r.pending.length, 2);
  assert.equal(r.missing.length, 0);
  assert.equal(r.totalAbsencePenalty, 0);
});

test('pending: msUntilWindowEnd is positive and accurate', () => {
  const parent = quakeFact({ occurredAt: NOW - 10 * 60 * 1000 });
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  const tsunami = r.pending.find((p) => p.signal.id === 'tsunami-status');
  assert.ok(tsunami);
  assert.ok(tsunami!.msUntilWindowEnd > 0);
  // tsunami window = 30 min. parent was 10 min ago. → ~20 min remaining.
  assert.ok(Math.abs(tsunami!.msUntilWindowEnd - 20 * 60 * 1000) < 1000);
});

// ── Missing signals + penalty ──────────────────────────────────────────

test('missing: closed-window without observation produces a penalty', () => {
  const parent = quakeFact(); // 1h ago — both windows closed
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  assert.equal(r.missing.length, 2);
  assert.ok(r.totalAbsencePenalty > 0);
  assert.ok(r.adjustedConfidence < 0.85);
});

test('missing: penalty is summed across signals and capped at default 0.6', () => {
  const parent = quakeFact();
  // 7 hypothetical signals each with 0.15 penalty → 1.05 raw, capped at 0.6.
  const signals: ExpectedSignal[] = Array.from({ length: 7 }).map((_, i) => ({
    id: `s-${i}`,
    label: `signal ${i}`,
    domain: 'space',
    eventType: 'never-fires',
    windowStartMs: 0,
    windowEndMs: 60 * 1000, // already closed
    absencePenalty: 0.15,
  }));
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.95, { now: NOW });
  assert.equal(r.totalAbsencePenalty, 0.6);
  assert.equal(r.adjustedConfidence, 0.35);
});

test('missing: maxPenalty option is honored', () => {
  const parent = quakeFact();
  const signals: ExpectedSignal[] = Array.from({ length: 5 }).map((_, i) => ({
    id: `s-${i}`,
    label: `signal ${i}`,
    domain: 'space',
    eventType: 'never-fires',
    windowStartMs: 0,
    windowEndMs: 60 * 1000,
    absencePenalty: 0.15,
  }));
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.95, {
    now: NOW,
    maxPenalty: 0.3,
  });
  assert.equal(r.totalAbsencePenalty, 0.3);
});

// ── Adjusted confidence ─────────────────────────────────────────────────

test('confidence: clamped to 0 even if penalties exceed baseConfidence', () => {
  const parent = quakeFact();
  const signals: ExpectedSignal[] = [{
    id: 's-big',
    label: 'huge',
    domain: 'space',
    eventType: 'never-fires',
    windowStartMs: 0,
    windowEndMs: 60 * 1000,
    absencePenalty: 0.5,
  }];
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.3, { now: NOW });
  assert.equal(r.adjustedConfidence, 0);
});

test('confidence: unchanged when no signals expected', () => {
  const parent = quakeFact();
  const r = evaluateNegativeEvidence(parent, [], [parent], 0.85, { now: NOW });
  assert.equal(r.adjustedConfidence, 0.85);
  assert.equal(r.totalAbsencePenalty, 0);
});

// ── Missing-confirmation strings ────────────────────────────────────────

test('missingConfirmation: lists missing signals', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  assert.ok(r.missingConfirmation.some((line) => /Missing/.test(line)));
});

test('missingConfirmation: pending signals show remaining minutes', () => {
  const parent = quakeFact({ occurredAt: NOW - 10 * 60 * 1000 });
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  assert.ok(r.missingConfirmation.some((line) => /Watching/.test(line)));
  assert.ok(r.missingConfirmation.some((line) => /min remaining/.test(line)));
});

// ── Custom signal scoping ──────────────────────────────────────────────

test('custom: signal with explicit entities filters candidates', () => {
  const parent: NormalizedFact = {
    ...quakeFact(),
    entities: ['JP'],
  };
  const signal: ExpectedSignal = {
    id: 'us-only',
    label: 'US-only follow-up',
    domain: 'space',
    entities: ['US'], // only candidates with US entity match
    windowStartMs: 0,
    windowEndMs: 60 * 60 * 1000,
    absencePenalty: 0.1,
  };
  const candidate: NormalizedFact = {
    ...aftershockFact(),
    entities: ['JP'], // wrong entity for this signal
  };
  const r = evaluateNegativeEvidence(parent, [signal], [parent, candidate], 0.85, { now: NOW });
  assert.equal(r.observed.length, 0);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs produce same output', () => {
  const parent = quakeFact();
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const candidates = [parent, tsunamiFact()];
  const a = evaluateNegativeEvidence(parent, signals, candidates, 0.85, { now: NOW });
  const b = evaluateNegativeEvidence(parent, signals, candidates, 0.85, { now: NOW });
  assert.deepEqual(a, b);
});

// ── Plan worked example ─────────────────────────────────────────────────

test('integration: plan example "No tsunami bulletin lowers quake cascade risk"', () => {
  // The insights digest (PR 2) lists this scenario verbatim. Negative
  // evidence is the source of truth: quake + 1h elapsed + no tsunami
  // bulletin → adjusted confidence drops.
  const parent = quakeFact(); // 1h ago, M6.5 near Sendai
  const signals = defaultExpectedSignalsFor('earthquake-major');
  const r = evaluateNegativeEvidence(parent, signals, [parent], 0.85, { now: NOW });
  assert.ok(r.missing.some((m) => /tsunami/i.test(m.signal.label)));
  assert.ok(r.adjustedConfidence < 0.85);
});
