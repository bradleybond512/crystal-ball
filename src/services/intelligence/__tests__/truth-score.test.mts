import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreFact,
  defaultContext,
  freshnessScore,
  corroborationScore,
  sourceDiversityScore,
  precisionScore,
  contradictionPenalty,
  labelFor,
} from '../truth-score.ts';
import type { NormalizedFact, TruthScoreContext } from '../truth-score.ts';
import type { SourceAttestation } from '../types.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────

const NOW = 1_745_000_000_000;
function fixedCtx(overrides: Partial<TruthScoreContext> = {}): TruthScoreContext {
  return defaultContext({ now: () => NOW, ...overrides });
}

function source(providerId: string, observedAt = NOW, derivedFrom?: string): SourceAttestation {
  return { providerId, observedAt, derivedFrom };
}

function weatherFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'wx-1',
    domain: 'weather',
    eventType: 'severe-thunderstorm',
    claim: 'Severe thunderstorm warning issued for La Porte County',
    severity: 'high',
    occurredAt: NOW,
    lat: 41.6,
    lon: -86.7,
    locationPrecision: 'local',
    entities: ['US-IN'],
    sources: [source('nws')],
    ...overrides,
  };
}

function cyberFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'cve-2026-1234',
    domain: 'cyber',
    eventType: 'cve-published',
    claim: 'CVE-2026-1234: critical RCE in Acme Server',
    severity: 'critical',
    occurredAt: NOW - 30 * 60 * 1000,
    locationPrecision: 'global',
    entities: ['acme-server'],
    sources: [source('nvd'), source('cisa-kev')],
    ...overrides,
  };
}

function aviationFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'flight-emergency-icao-abc123',
    domain: 'aviation',
    eventType: 'flight-emergency',
    claim: 'Squawk 7700 — emergency declared',
    severity: 'high',
    occurredAt: NOW - 2 * 60 * 1000,
    lat: 35.5,
    lon: -97.5,
    locationPrecision: 'point',
    entities: ['ABC123'],
    sources: [source('opensky'), source('adsb-fi'), source('airplanes-live')],
    ...overrides,
  };
}

function maritimeFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'ais-gap-mmsi-123456',
    domain: 'maritime',
    eventType: 'ais-gap',
    claim: 'Vessel went dark for 6h in disputed waters',
    severity: 'moderate',
    occurredAt: NOW - 10 * 60 * 1000,
    lat: 12.3,
    lon: 119.5,
    locationPrecision: 'regional',
    entities: ['MMSI-123456'],
    sources: [source('marinetraffic')],
    ...overrides,
  };
}

function marketsFact(overrides: Partial<NormalizedFact> = {}): NormalizedFact {
  return {
    id: 'spy-drop-2026-04-27',
    domain: 'markets',
    eventType: 'index-drawdown',
    claim: 'S&P 500 -3.2% intraday',
    severity: 'high',
    occurredAt: NOW - 60 * 1000,
    locationPrecision: 'global',
    entities: ['SPY'],
    sources: [source('finnhub'), source('fmp'), source('yahoo')],
    ...overrides,
  };
}

// ── Component scorers ────────────────────────────────────────────────────

test('freshnessScore: 1.0 at observation, 0.5 at TTL, 0 at 2× TTL', () => {
  const ttl = 60 * 60 * 1000; // 1h
  assert.equal(freshnessScore(NOW, ttl, NOW), 1);
  assert.equal(freshnessScore(NOW - ttl, ttl, NOW), 0.5);
  assert.equal(freshnessScore(NOW - 2 * ttl, ttl, NOW), 0);
  assert.equal(freshnessScore(NOW - 3 * ttl, ttl, NOW), 0);
});

test('freshnessScore: bogus inputs return midpoint', () => {
  assert.equal(freshnessScore(Number.NaN, 1000, NOW), 0.5);
  assert.equal(freshnessScore(NOW, 0, NOW), 0.5);
  assert.equal(freshnessScore(NOW, Number.NaN, NOW), 0.5); // non-finite ttl must not NaN the score
});

test('scoreFact: always returns a finite score (never NaN) even with missing/unknown fields', () => {
  // locationPrecision is typed non-optional but facts from external data arrive
  // without it; an undefined here used to fall through precisionScore and make
  // the whole score NaN, silently poisoning the ledger. Lock the invariant.
  const cases: NormalizedFact[] = [
    weatherFact({ locationPrecision: undefined as unknown as NormalizedFact['locationPrecision'] }),
    weatherFact({ domain: 'totally-unknown-domain' }),
    weatherFact({ sources: [] }),
    weatherFact(),
  ];
  for (const f of cases) {
    const r = scoreFact(f);
    assert.ok(Number.isFinite(r.score), `score must be finite, got ${r.score} for ${f.domain}/${String(f.locationPrecision)}`);
    assert.ok(r.score >= 0 && r.score <= 1, `score in [0,1], got ${r.score}`);
  }
});

test('scoreFact: a context returning NaN (reliability/historical) still yields a finite score', () => {
  // clamp01 is NaN-safe so a hostile/custom context can't poison the score either.
  const r1 = scoreFact(weatherFact(), fixedCtx({ reliabilityFor: () => Number.NaN }));
  assert.ok(Number.isFinite(r1.score) && r1.score >= 0 && r1.score <= 1, `reliability NaN → ${r1.score}`);
  const r2 = scoreFact(weatherFact(), fixedCtx({ historicalAccuracyFor: () => Number.NaN }));
  assert.ok(Number.isFinite(r2.score) && r2.score >= 0 && r2.score <= 1, `historical NaN → ${r2.score}`);
});

test('corroborationScore: ladder matches doc', () => {
  assert.equal(corroborationScore(0), 0);
  // Single source has no corroboration; 0.3 keeps it under the
  // "plausible" cap once weighted into the final score.
  assert.equal(corroborationScore(1), 0.3);
  assert.equal(corroborationScore(2), 0.75);
  assert.equal(corroborationScore(3), 0.9);
  assert.equal(corroborationScore(4), 1.0);
  assert.equal(corroborationScore(10), 1.0);
});

test('precisionScore: point > local > regional > country > global', () => {
  assert.equal(precisionScore('point'), 1.0);
  assert.equal(precisionScore('local'), 0.85);
  assert.equal(precisionScore('regional'), 0.7);
  assert.equal(precisionScore('country'), 0.55);
  assert.equal(precisionScore('global'), 0.3);
});

test('sourceDiversityScore: penalizes echo chambers', () => {
  // 3 fully independent sources → ratio 1.0
  const indep = weatherFact({ sources: [source('a'), source('b'), source('c')] });
  assert.equal(sourceDiversityScore(indep), 1);

  // 3 sources but two are derived from the third → 1 distinct root,
  // ratio 1/3 → floored to 0.4
  const echo = weatherFact({
    sources: [
      source('wire-original'),
      source('reblog-a', NOW, 'wire-original'),
      source('reblog-b', NOW, 'wire-original'),
    ],
  });
  assert.equal(sourceDiversityScore(echo), 0.4);

  // Single source returns 0.5 (no diversity to score)
  assert.equal(sourceDiversityScore(weatherFact()), 0.5);
});

test('contradictionPenalty: 0.15 each, capped at 0.6', () => {
  assert.equal(contradictionPenalty(weatherFact()), 0);
  assert.equal(contradictionPenalty(weatherFact({ contradictedBy: ['x'] })), 0.15);
  assert.equal(contradictionPenalty(weatherFact({ contradictedBy: ['x', 'y'] })), 0.3);
  assert.equal(
    contradictionPenalty(weatherFact({ contradictedBy: ['a', 'b', 'c', 'd', 'e', 'f'] })),
    0.6,
  );
});

// ── Top-level scorer ─────────────────────────────────────────────────────

test('scoreFact: single fresh source caps at "plausible"', () => {
  const ts = scoreFact(weatherFact(), fixedCtx());
  assert.equal(ts.contributingProviders.length, 1);
  // single source can't reach 'likely' (needs corroboration)
  assert.ok(ts.score < 0.65, `expected <0.65, got ${ts.score}`);
  assert.ok(['plausible', 'weak'].includes(ts.label));
});

test('scoreFact: two-source agreement crosses into "likely"', () => {
  const ts = scoreFact(cyberFact(), fixedCtx());
  assert.equal(ts.contributingProviders.length, 2);
  assert.ok(ts.label === 'likely' || ts.label === 'confirmed', `got ${ts.label} (${ts.score})`);
});

test('scoreFact: 3+ fresh sources + precision can hit "confirmed"', () => {
  const ts = scoreFact(aviationFact(), fixedCtx({
    reliabilityFor: () => 0.9,
    historicalAccuracyFor: () => 0.9,
  }));
  assert.equal(ts.contributingProviders.length, 3);
  assert.ok(ts.score >= 0.8, `expected confirmed-tier score, got ${ts.score}`);
  assert.equal(ts.label, 'confirmed');
});

test('scoreFact: contradictions flip even high scores to disputed', () => {
  const ts = scoreFact(
    aviationFact({ contradictedBy: ['fact-a', 'fact-b'] }),
    fixedCtx({ reliabilityFor: () => 0.9 }),
  );
  assert.equal(ts.disputed, true);
  assert.equal(ts.label, 'disputed');
});

test('scoreFact: stale data reduces, does not silently drop', () => {
  const fresh = scoreFact(weatherFact(), fixedCtx());
  const stale = scoreFact(
    weatherFact({ occurredAt: NOW - 6 * 60 * 60 * 1000, sources: [source('nws', NOW - 6 * 60 * 60 * 1000)] }),
    fixedCtx(),
  );
  assert.ok(stale.score < fresh.score, `stale (${stale.score}) should be < fresh (${fresh.score})`);
  assert.ok(stale.components.freshness < fresh.components.freshness);
});

test('scoreFact: explanation components round to 3 decimals', () => {
  const ts = scoreFact(maritimeFact(), fixedCtx());
  for (const v of Object.values(ts.components)) {
    const decimals = (v.toString().split('.')[1] ?? '').length;
    assert.ok(decimals <= 3, `component ${v} has >3 decimals`);
  }
});

test('scoreFact: contributingProviders is deduped and ordered', () => {
  const ts = scoreFact(marketsFact(), fixedCtx());
  assert.deepEqual(ts.contributingProviders, ['finnhub', 'fmp', 'yahoo']);
});

test('scoreFact: deterministic for same inputs', () => {
  const a = scoreFact(cyberFact(), fixedCtx());
  const b = scoreFact(cyberFact(), fixedCtx());
  assert.deepEqual(a, b);
});

test('scoreFact: zero sources gives a score of 0 reliability/diversity', () => {
  const ts = scoreFact(weatherFact({ sources: [] }), fixedCtx());
  assert.equal(ts.components.reliability, 0);
  assert.equal(ts.components.sourceDiversity, 0);
  // historicalAccuracy falls back to default 0.7
  assert.equal(ts.components.historicalAccuracy, 0.7);
});

// ── labelFor ─────────────────────────────────────────────────────────────

test('labelFor: thresholds match doc', () => {
  assert.equal(labelFor(0.95, false), 'confirmed');
  assert.equal(labelFor(0.8, false), 'confirmed');
  assert.equal(labelFor(0.65, false), 'likely');
  assert.equal(labelFor(0.45, false), 'plausible');
  assert.equal(labelFor(0.3, false), 'weak');
  assert.equal(labelFor(0.95, true), 'disputed');
  assert.equal(labelFor(0, true), 'disputed');
});
