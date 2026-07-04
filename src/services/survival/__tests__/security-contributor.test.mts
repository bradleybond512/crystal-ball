import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSecurityContributor } from '../security-contributor.ts';
import type { ForecastSnapshot, ModeAdvisory, ForecastDomain } from '../../mode-forecast.ts';

const NOW = 1_700_000_000_000;

function advisory(over: Partial<ModeAdvisory> & { domain: ForecastDomain }): ModeAdvisory {
  return {
    domain: over.domain,
    pressure: over.pressure ?? 0.6,
    slope: over.slope ?? 0.1,
    etaMin: over.etaMin ?? null,
    statement: over.statement ?? 'Security pressure rising',
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

test('no security/cyber advisory -> no threats', () => {
  const c = makeSecurityContributor(makeSnapshot([]));
  assert.deepEqual(c.contribute(NOW), []);
});

test('only a finance advisory -> no security threats', () => {
  const c = makeSecurityContributor(makeSnapshot([advisory({ domain: 'finance', pressure: 0.9 })]));
  assert.deepEqual(c.contribute(NOW), []);
});

test('security advisory at pressure 0.6 -> one advisory-level security threat', () => {
  const c = makeSecurityContributor(makeSnapshot([advisory({ domain: 'security', pressure: 0.6 })]));
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'security');
  assert.equal(t.severity, 60);
  assert.equal(t.threatLevel, 'advisory');
  assert.equal(t.sourceEventId, 'security-pressure');
  assert.equal(t.hazardKind, 'other');
  assert.equal(t.hazardLabel, 'Security pressure elevated');
  assert.equal(t.confidenceLabel, 'medium');
});

test('cyber advisory at pressure 0.82 -> severity 82, warning', () => {
  const c = makeSecurityContributor(makeSnapshot([advisory({ domain: 'cyber', pressure: 0.82 })]));
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'security');
  assert.equal(t.severity, 82);
  assert.equal(t.threatLevel, 'warning');
  assert.equal(t.sourceEventId, 'cyber-pressure');
  assert.equal(t.hazardLabel, 'Cyber threat pressure elevated');
  assert.equal(t.confidenceLabel, 'high');
});

test('both security and cyber present -> 2 threats in order [security, cyber]', () => {
  const c = makeSecurityContributor(makeSnapshot([
    advisory({ domain: 'cyber', pressure: 0.55 }),
    advisory({ domain: 'security', pressure: 0.9 }),
  ]));
  const threats = c.contribute(NOW);
  assert.equal(threats.length, 2);
  assert.deepEqual(threats.map((t) => t.sourceEventId), ['security-pressure', 'cyber-pressure']);
  assert.deepEqual(threats.map((t) => t.severity), [90, 55]);
});

test('etaMin populates arrivalLabel and timeToImpactMins', () => {
  const t = makeSecurityContributor(makeSnapshot([advisory({ domain: 'security', pressure: 0.6, etaMin: 5 })])).contribute(NOW)[0]!;
  assert.equal(t.timeToImpactMins, 5);
  assert.equal(t.arrivalLabel, '~5m to threshold');
});

test('null etaMin -> null arrivalLabel', () => {
  const t = makeSecurityContributor(makeSnapshot([advisory({ domain: 'security', pressure: 0.6, etaMin: null })])).contribute(NOW)[0]!;
  assert.equal(t.timeToImpactMins, null);
  assert.equal(t.arrivalLabel, null);
});

test('why equals the advisory statement', () => {
  const c = makeSecurityContributor(makeSnapshot([advisory({ domain: 'security', pressure: 0.6, statement: 'Civil unrest escalating near saved place' })]));
  assert.equal(c.contribute(NOW)[0]!.why, 'Civil unrest escalating near saved place');
});
