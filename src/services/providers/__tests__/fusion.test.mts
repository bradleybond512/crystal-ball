import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreFreshness,
  scoreReliability,
  scoreCorroboration,
  combineScores,
} from '../fusion.ts';
import type { ProviderDefinition } from '../registry.ts';
import type { ProviderHealthRecord } from '../health.ts';

function fxDef(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: 'fx',
    domain: 'aviation',
    name: 'Fx',
    auth: 'none',
    baseUrl: 'https://example.test',
    ttlMs: 60_000,
    baselineWeight: 0.7,
    fallbackPriority: 0,
    lifecycle: 'active',
    ...overrides,
  };
}

function fxHealth(overrides: Partial<ProviderHealthRecord> = {}): ProviderHealthRecord {
  return {
    providerId: 'fx',
    status: 'healthy',
    lastSuccessAt: Date.now(),
    lastErrorAt: null,
    lastError: null,
    lastLatencyMs: 100,
    avgLatencyMs: 100,
    successCount: 5,
    errorCount: 0,
    quotaResetsAt: null,
    ...overrides,
  };
}

// ── scoreFreshness ────────────────────────────────────────────────────────

test('scoreFreshness: at observation time → 1.0', () => {
  const now = 100_000;
  assert.equal(scoreFreshness(now, 60_000, now), 1);
});

test('scoreFreshness: at 1x ttl → 0.5', () => {
  const now = 100_000;
  assert.equal(scoreFreshness(now - 60_000, 60_000, now), 0.5);
});

test('scoreFreshness: at 2x ttl → 0.0', () => {
  const now = 100_000;
  assert.equal(scoreFreshness(now - 120_000, 60_000, now), 0);
});

test('scoreFreshness: beyond 2x ttl clamps to 0', () => {
  const now = 100_000;
  assert.equal(scoreFreshness(now - 600_000, 60_000, now), 0);
});

test('scoreFreshness: invalid inputs → 0.5', () => {
  assert.equal(scoreFreshness(NaN, 60_000), 0.5);
  assert.equal(scoreFreshness(Date.now(), 0), 0.5);
});

// ── scoreReliability ──────────────────────────────────────────────────────

test('scoreReliability: no health → baseline weight', () => {
  const def = fxDef({ baselineWeight: 0.85 });
  assert.equal(scoreReliability(def, null), 0.85);
});

test('scoreReliability: healthy → baseline weight', () => {
  const def = fxDef({ baselineWeight: 0.8 });
  assert.equal(scoreReliability(def, fxHealth({ status: 'healthy' })), 0.8);
});

test('scoreReliability: degraded → 60% of baseline', () => {
  const def = fxDef({ baselineWeight: 0.8 });
  const r = scoreReliability(def, fxHealth({ status: 'degraded' }));
  assert.ok(Math.abs(r - 0.48) < 1e-9);
});

test('scoreReliability: down → 0', () => {
  const def = fxDef({ baselineWeight: 0.9 });
  assert.equal(scoreReliability(def, fxHealth({ status: 'down' })), 0);
});

test('scoreReliability: rateLimited → 50% of baseline', () => {
  const def = fxDef({ baselineWeight: 0.8 });
  const r = scoreReliability(def, fxHealth({ status: 'rateLimited' }));
  assert.ok(Math.abs(r - 0.4) < 1e-9);
});

// ── scoreCorroboration ────────────────────────────────────────────────────

test('scoreCorroboration: no sources → neutral 0.5', () => {
  const r = scoreCorroboration({ agreeing: 0, disagreeing: 0 });
  assert.equal(r.score, 0.5);
  assert.equal(r.conflict, false);
});

test('scoreCorroboration: single source → 0.5 (no corroboration)', () => {
  const r = scoreCorroboration({ agreeing: 1, disagreeing: 0 });
  assert.equal(r.score, 0.5);
  assert.equal(r.conflict, false);
});

test('scoreCorroboration: two agreeing → 0.75', () => {
  const r = scoreCorroboration({ agreeing: 2, disagreeing: 0 });
  assert.equal(r.score, 0.75);
});

test('scoreCorroboration: three+ agreeing → 0.9', () => {
  const r = scoreCorroboration({ agreeing: 3, disagreeing: 0 });
  assert.equal(r.score, 0.9);
});

test('scoreCorroboration: 4+ agreeing → 1.0', () => {
  const r = scoreCorroboration({ agreeing: 4, disagreeing: 0 });
  assert.equal(r.score, 1.0);
});

test('scoreCorroboration: 1 agreeing + 1 disagreeing → conflict, low score', () => {
  const r = scoreCorroboration({ agreeing: 1, disagreeing: 1 });
  assert.equal(r.conflict, true);
  assert.ok(r.score < 0.4);
});

test('scoreCorroboration: 2-of-3 agreement → not conflict (majority holds)', () => {
  const r = scoreCorroboration({ agreeing: 2, disagreeing: 1 });
  // agreementRatio = 2/3 = 0.666… → just at boundary; conflict = false (boundary is <= 0.66)
  assert.equal(r.conflict, false);
});

// ── combineScores ─────────────────────────────────────────────────────────

test('combineScores: empty contributors → all zero, label low', () => {
  const r = combineScores({ contributors: [] });
  assert.equal(r.confidence, 'low');
  assert.deepEqual([r.freshness, r.reliability, r.corroboration], [0, 0, 0]);
});

test('combineScores: one healthy fresh source → medium (no corroboration possible)', () => {
  const def = fxDef({ baselineWeight: 0.85, ttlMs: 60_000 });
  const health = fxHealth({ status: 'healthy' });
  const r = combineScores({
    contributors: [{ providerDef: def, health, observedAt: Date.now() }],
  });
  assert.equal(r.confidence, 'medium');
  assert.equal(r.conflictDetected, false);
  assert.equal(r.contributors.length, 1);
});

test('combineScores: three healthy fresh sources agreeing → high', () => {
  const baseDef = fxDef({ baselineWeight: 0.8, ttlMs: 60_000 });
  const now = Date.now();
  const r = combineScores({
    contributors: [
      { providerDef: { ...baseDef, id: 's1' }, health: fxHealth({ providerId: 's1' }), observedAt: now },
      { providerDef: { ...baseDef, id: 's2' }, health: fxHealth({ providerId: 's2' }), observedAt: now },
      { providerDef: { ...baseDef, id: 's3' }, health: fxHealth({ providerId: 's3' }), observedAt: now },
    ],
  });
  assert.equal(r.confidence, 'high');
});

test('combineScores: disagreement → conflict label', () => {
  const baseDef = fxDef({ baselineWeight: 0.8 });
  const now = Date.now();
  const r = combineScores({
    contributors: [
      { providerDef: { ...baseDef, id: 'a' }, health: fxHealth({ providerId: 'a' }), observedAt: now, agrees: true },
      { providerDef: { ...baseDef, id: 'b' }, health: fxHealth({ providerId: 'b' }), observedAt: now, agrees: false },
    ],
  });
  assert.equal(r.confidence, 'conflict');
  assert.equal(r.conflictDetected, true);
});

test('combineScores: down source pulls reliability but agreement still matters', () => {
  const def = fxDef({ baselineWeight: 0.9 });
  const now = Date.now();
  const r = combineScores({
    contributors: [
      { providerDef: { ...def, id: 'live' }, health: fxHealth({ providerId: 'live' }), observedAt: now },
      { providerDef: { ...def, id: 'dead' }, health: fxHealth({ providerId: 'dead', status: 'down' }), observedAt: now },
    ],
  });
  // Reliability halved (one source live, one dead). Two agreeing sources → corroboration 0.75.
  // Should land in medium territory, not conflict.
  assert.notEqual(r.confidence, 'conflict');
});

test('combineScores: stale data at very high freshness deficit pulls down to low', () => {
  const def = fxDef({ baselineWeight: 0.6, ttlMs: 1_000 });
  const r = combineScores({
    contributors: [
      { providerDef: def, health: fxHealth({ status: 'healthy' }), observedAt: Date.now() - 600_000 },
    ],
  });
  // Single stale source: freshness 0, baseline 0.6 reliability, no corroboration (0.5).
  // Blended = 0*0.3 + 0.6*0.4 + 0.5*0.3 = 0.39 → low.
  assert.equal(r.confidence, 'low');
});
