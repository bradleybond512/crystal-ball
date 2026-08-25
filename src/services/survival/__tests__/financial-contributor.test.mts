import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeFinancialContributor } from '../financial-contributor.ts';
import type { ForecastSnapshot, ModeAdvisory, ForecastDomain } from '../../mode-forecast.ts';

const NOW = 1_700_000_000_000;
const FINANCIAL_CONTRIBUTOR_SOURCE = readFileSync(
  new URL('../financial-contributor.ts', import.meta.url),
  'utf8',
);
const SECURITY_CONTRIBUTOR_SOURCE = readFileSync(
  new URL('../security-contributor.ts', import.meta.url),
  'utf8',
);

function advisory(over: Partial<ModeAdvisory> & { domain: ForecastDomain }): ModeAdvisory {
  return {
    domain: over.domain,
    pressure: over.pressure ?? 0.6,
    slope: over.slope ?? 0.1,
    etaMin: over.etaMin ?? null,
    statement: over.statement ?? 'Finance pressure rising',
    timestamp: over.timestamp ?? NOW,
  };
}

function makeSnapshot(advisories: ModeAdvisory[]): ForecastSnapshot {
  return {
    timestamp: 0,
    advisories,
    pressure: { finance: 0, security: 0, disaster: 0, cyber: 0 },
  };
}

test('mode-forecast contributors use the shared source-event identifiers', () => {
  assert.match(FINANCIAL_CONTRIBUTOR_SOURCE, /MODE_FORECAST_THREAT_SOURCE_IDS\.finance/);
  assert.match(SECURITY_CONTRIBUTOR_SOURCE, /MODE_FORECAST_THREAT_SOURCE_IDS\.security/);
  assert.match(SECURITY_CONTRIBUTOR_SOURCE, /MODE_FORECAST_THREAT_SOURCE_IDS\.cyber/);
});

test('no advisories -> no financial threats', () => {
  const c = makeFinancialContributor(makeSnapshot([]));
  assert.deepEqual(c.contribute(NOW), []);
});

test('only a non-finance advisory -> no financial threats', () => {
  const c = makeFinancialContributor(makeSnapshot([advisory({ domain: 'security', pressure: 0.9 })]));
  assert.deepEqual(c.contribute(NOW), []);
});

test('finance advisory at pressure 0.6 -> one advisory-level financial threat', () => {
  const c = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.6 })]));
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'financial');
  assert.equal(t.severity, 60);
  assert.equal(t.threatLevel, 'advisory');
  assert.equal(t.sourceEventId, 'finance-pressure');
  assert.equal(t.hazardKind, 'other');
  assert.equal(t.hazardLabel, 'Financial pressure elevated');
  assert.equal(t.confidenceLabel, 'medium');
});

test('pressure 0.8 -> severity 80, warning', () => {
  const t = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.8 })])).contribute(NOW)[0]!;
  assert.equal(t.severity, 80);
  assert.equal(t.threatLevel, 'warning');
  assert.equal(t.confidenceLabel, 'high');
});

test('pressure 0.97 -> severity 97, emergency, high confidence', () => {
  const t = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.97 })])).contribute(NOW)[0]!;
  assert.equal(t.severity, 97);
  assert.equal(t.threatLevel, 'emergency');
  assert.equal(t.confidenceLabel, 'high');
});

test('etaMin populates arrivalLabel and timeToImpactMins', () => {
  const t = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.6, etaMin: 8 })])).contribute(NOW)[0]!;
  assert.equal(t.timeToImpactMins, 8);
  assert.equal(t.arrivalLabel, '~8m to threshold');
});

test('null etaMin -> null arrivalLabel', () => {
  const t = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.6, etaMin: null })])).contribute(NOW)[0]!;
  assert.equal(t.timeToImpactMins, null);
  assert.equal(t.arrivalLabel, null);
});

test('why equals the advisory statement', () => {
  const c = makeFinancialContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.6, statement: 'Volatility spiking across equities' })]));
  assert.equal(c.contribute(NOW)[0]!.why, 'Volatility spiking across equities');
});
