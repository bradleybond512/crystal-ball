import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestDomain, type DomainObservation } from '../fusion-ingest.ts';
import { recordFetchOutcome, emptyProviderHealthState } from '../provider-health.ts';
import type { ProviderHealthState } from '../provider-health.ts';
import { snapshotsFromRegistry } from '../provider-bridge.ts';
import { assessProviderRedundancy } from '../../diagnostics/provider-redundancy.ts';

const NOW = 1_745_000_000_000;

function healthyCrypto(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['coingecko', 'coinbase']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 50, at: NOW });
  }
  return s;
}

function healthyStocks(): ProviderHealthState {
  let s = emptyProviderHealthState();
  for (const id of ['stooq', 'yahoo-finance']) {
    s = recordFetchOutcome(s, id, { ok: true, latencyMs: 50, at: NOW });
  }
  return s;
}

/** Crypto/stock observation: matched by `key` (symbol/ticker), no geo. */
function px(providerId: string, key: string, value: number): DomainObservation {
  return { providerId, key, value, lat: 0, lon: 0, occurredAt: NOW };
}

test('same symbol within the relative band → matched + corroborated (key mode)', () => {
  const r = ingestDomain('crypto', [
    px('coingecko', 'BTC', 95_000),
    px('coinbase', 'BTC', 96_000), // |1000| < 2% of 96000 (=1920) → agree
  ], healthyCrypto(), NOW);

  assert.equal(r.facts.length, 1, 'same symbol collapses to one fact');
  const f = r.facts[0]!;
  assert.equal(f.fusion.independentSourceCount, 2);
  assert.equal(f.fusion.disagreements.length, 0);
  assert.ok(f.fusion.confidenceMultiplier > 0.6);
  assert.equal(r.providerFingerprints['coingecko'], r.providerFingerprints['coinbase']);
});

test('same symbol beyond the relative band → disagreement, capped (key mode)', () => {
  const r = ingestDomain('crypto', [
    px('coingecko', 'BTC', 95_000),
    px('coinbase', 'BTC', 99_000), // |4000| > 2% of 99000 (=1980) → disagree
  ], healthyCrypto(), NOW);
  const f = r.facts[0]!;
  assert.ok(f.fusion.disagreements.length >= 1, 'price disagreement surfaces');
  assert.ok(f.fusion.confidenceMultiplier <= 0.6);
  assert.notEqual(r.providerFingerprints['coingecko'], r.providerFingerprints['coinbase']);
});

test('different symbols are different facts (no cross-symbol match)', () => {
  const r = ingestDomain('crypto', [
    px('coingecko', 'BTC', 95_000),
    px('coinbase', 'ETH', 3_500),
  ], healthyCrypto(), NOW);
  assert.equal(r.facts.length, 2, 'BTC and ETH stay distinct');
  assert.ok(r.facts.every((f) => f.fusion.independentSourceCount === 1));
});

test('relative band scales with magnitude — a cheap coin agrees at the same %', () => {
  // 0.50 vs 0.505 → |0.005| < 2% of 0.505 (=0.0101) → agree, even though the
  // absolute gap is tiny. Proves relative (not absolute) tolerance.
  const r = ingestDomain('crypto', [
    px('coingecko', 'XRP', 0.50),
    px('coinbase', 'XRP', 0.505),
  ], healthyCrypto(), NOW);
  assert.equal(r.facts[0]!.fusion.disagreements.length, 0);
  assert.equal(r.providerFingerprints['coingecko'], r.providerFingerprints['coinbase']);
});

test('end to end: agreeing crypto prices → redundant_agreement for markets', () => {
  const health = healthyCrypto();
  const r = ingestDomain('crypto', [
    px('coingecko', 'BTC', 95_000),
    px('coinbase', 'BTC', 95_400),
  ], health, NOW);
  // markets domain also has FRED/SEC/Treasury; restrict to the crypto pair so
  // the unrelated markets providers don't dilute the verdict in this unit test.
  const snaps = snapshotsFromRegistry(health, NOW, 'markets', r.providerFingerprints)
    .filter((s) => s.providerId === 'coingecko' || s.providerId === 'coinbase');
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  assert.equal(report.domains[0]!.verdict, 'redundant_agreement');
});

test('spatial domains are unaffected by the key-mode addition (earthquakes still fuse)', () => {
  let s = emptyProviderHealthState();
  for (const id of ['usgs-earthquakes', 'emsc-seismic']) s = recordFetchOutcome(s, id, { ok: true, latencyMs: 100, at: NOW });
  const r = ingestDomain('earthquakes', [
    { providerId: 'usgs-earthquakes', value: 6.1, lat: 35, lon: 139, occurredAt: NOW },
    { providerId: 'emsc-seismic', value: 6.0, lat: 35.05, lon: 139.02, occurredAt: NOW },
  ], s, NOW);
  assert.equal(r.facts.length, 1);
  assert.equal(r.facts[0]!.fusion.independentSourceCount, 2);
});

test('stocks: same ticker within 1% → corroborated; per-ticker, not cross-ticker', () => {
  const health = healthyStocks();
  const r = ingestDomain('stocks', [
    px('stooq', 'AAPL', 212.00),
    px('yahoo-finance', 'AAPL', 213.50), // |1.50| < 1% of 213.50 (=2.135) → agree
    px('stooq', 'MSFT', 450.00),
    px('yahoo-finance', 'MSFT', 449.00),
  ], health, NOW);
  assert.equal(r.facts.length, 2, 'AAPL and MSFT are distinct facts');
  for (const f of r.facts) {
    assert.equal(f.fusion.independentSourceCount, 2);
    assert.equal(f.fusion.disagreements.length, 0);
  }
  const snaps = snapshotsFromRegistry(health, NOW, 'equities', r.providerFingerprints);
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  assert.equal(report.domains.find((d) => d.domain === 'equities')!.verdict, 'redundant_agreement');
});

test('crypto and stocks do not cross-contaminate (separate redundancy domains)', () => {
  // Both fusion domains agree internally; because crypto is registry-domain
  // 'markets' and stocks is 'equities', their fingerprints must NOT collide
  // into a false redundant_disagreement.
  let health = emptyProviderHealthState();
  for (const id of ['coingecko', 'coinbase', 'stooq', 'yahoo-finance']) {
    health = recordFetchOutcome(health, id, { ok: true, latencyMs: 50, at: NOW });
  }
  const crypto = ingestDomain('crypto', [px('coingecko', 'BTC', 95_000), px('coinbase', 'BTC', 95_400)], health, NOW);
  const stocks = ingestDomain('stocks', [px('stooq', 'AAPL', 212), px('yahoo-finance', 'AAPL', 213.5)], health, NOW);

  const snaps = snapshotsFromRegistry(health, NOW, undefined, { ...crypto.providerFingerprints, ...stocks.providerFingerprints })
    .filter((s) => ['coingecko', 'coinbase', 'stooq', 'yahoo-finance'].includes(s.providerId));
  const report = assessProviderRedundancy({ generatedAt: NOW, snapshots: snaps });
  assert.equal(report.domains.find((d) => d.domain === 'markets')!.verdict, 'redundant_agreement');
  assert.equal(report.domains.find((d) => d.domain === 'equities')!.verdict, 'redundant_agreement');
});

test('stocks: a >1% quote gap surfaces as a disagreement', () => {
  const r = ingestDomain('stocks', [
    px('stooq', 'TSLA', 250.00),
    px('yahoo-finance', 'TSLA', 260.00), // |10| > 1% of 260 (=2.6) → disagree
  ], healthyStocks(), NOW);
  assert.ok(r.facts[0]!.fusion.disagreements.length >= 1);
  assert.notEqual(r.providerFingerprints['stooq'], r.providerFingerprints['yahoo-finance']);
});
