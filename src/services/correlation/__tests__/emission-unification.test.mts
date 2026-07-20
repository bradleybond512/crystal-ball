import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestCompoundRisk,
  recomputeCompoundRisk,
  resetCompoundRiskCadence,
  situationsToCompoundInputs,
  startCompoundRiskCadence,
  subscribeCompoundRisk,
} from '../compound-risk-cadence';
import { startPairPersistence } from '../pair-persistence';
import { makeCorrelationContributor } from '../../survival/correlation-contributor';
import { computeMultiAxisPosture } from '../../survival/survival-posture';
import { SituationStoreV2, type Situation } from '../../intelligence/situation-store-v2';
import { getCorrelationStore } from '../../intelligence/correlation-store';
import type { CompoundRiskResult } from '../../intelligence/compound-risk';
import type { ObservationEvent } from '../../../types/intelligence';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const HOUR = 3_600_000;

beforeEach(() => resetCompoundRiskCadence());

function situation(overrides: Partial<Situation> & { id: string }): Situation {
  return {
    name: `Situation ${overrides.id}`,
    domain: 'weather',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    confidence: 0.8,
    observations: [],
    edges: [],
    entityIds: ['ent-1'],
    tags: [],
    location: { lat: 41.6, lon: -86.7 },
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    ...overrides,
  } as Situation;
}

test('situationsToCompoundInputs maps fields and drops resolved situations', () => {
  const inputs = situationsToCompoundInputs([
    situation({ id: 's1', severity: 'critical', relatedDomains: ['infra'] }),
    situation({ id: 's2', status: 'resolved' }),
  ]);
  assert.equal(inputs.length, 1);
  const input = inputs[0]!;
  assert.equal(input.id, 's1');
  assert.equal(input.severityScore, 92);
  assert.deepEqual(input.domains, ['weather', 'infra']);
  assert.deepEqual(input.entities, ['ent-1']);
  assert.ok(input.centroid);
});

test('recomputeCompoundRisk stores a snapshot and notifies subscribers', () => {
  let notified = 0;
  const unsub = subscribeCompoundRisk(() => { notified += 1; });
  const snap = recomputeCompoundRisk([situation({ id: 's1' })], T0);
  assert.equal(snap.computedAt, T0);
  assert.equal(latestCompoundRisk(), snap);
  assert.equal(notified, 1);
  unsub();
});

test('cross-domain situations sharing an entity compose into a compound cluster', () => {
  const snap = recomputeCompoundRisk([
    situation({ id: 'w', domain: 'weather', severity: 'critical', entityIds: ['county:X'] }),
    situation({ id: 'i', domain: 'infra', severity: 'high', entityIds: ['county:X'] }),
  ], T0);
  const multi = snap.results.find((r) => r.memberIds.length >= 2);
  assert.ok(multi, 'expected a multi-situation compound cluster');
  assert.ok(multi!.affectedDomains.includes('weather') && multi!.affectedDomains.includes('infra'));
});

test('startCompoundRiskCadence computes immediately and is idempotent', () => {
  const fakeStore = { list: () => [situation({ id: 's1' })] };
  const stop = startCompoundRiskCadence({ store: fakeStore, intervalMs: 60_000 });
  const stop2 = startCompoundRiskCadence({ store: fakeStore });
  assert.ok(latestCompoundRisk() !== null);
  stop2();
  stop();
});

test('pair persistence: live ingest pairs land in the correlation store', () => {
  const store = new SituationStoreV2({ clock: () => T0 + HOUR });
  const cleanup = startPairPersistence(store);
  const before = getCorrelationStore().getRecent(undefined, T0 + 2 * HOUR).length;
  const obs = (id: string, extra: Partial<ObservationEvent>): ObservationEvent => ({
    id, sourceId: 'src', domain: 'weather', timestamp: T0, severity: 'HIGH',
    title: id, raw: null, entityIds: [], tags: [], ...extra,
  });
  store.ingest([
    obs('w1', { sourceId: 'nws-alerts', tags: ['red-flag-warning'], entityIds: ['county:X'] }),
    obs('f1', { sourceId: 'inciweb-wildfire', tags: ['wildfire'], entityIds: ['county:X'], timestamp: T0 + HOUR }),
  ]);
  const after = getCorrelationStore().getRecent(undefined, T0 + 2 * HOUR);
  assert.equal(after.length, before + 1);
  assert.equal(after[0]!.ruleId, 'weather-wildfire');
  // Re-ingesting the same pair is deduped by the store.
  store.ingest([
    obs('w1', { sourceId: 'nws-alerts', tags: ['red-flag-warning'], entityIds: ['county:X'] }),
    obs('f1', { sourceId: 'inciweb-wildfire', tags: ['wildfire'], entityIds: ['county:X'], timestamp: T0 + HOUR }),
  ]);
  assert.equal(getCorrelationStore().getRecent(undefined, T0 + 2 * HOUR).length, before + 1);
  cleanup();
});

// ── correlation contributor ──────────────────────────────────────────────

function compound(overrides: Partial<CompoundRiskResult> = {}): CompoundRiskResult {
  return {
    id: 'cr-1',
    score: 72,
    level: 'high',
    memberIds: ['s1', 's2'],
    affectedDomains: ['weather', 'infra'],
    impactCategories: [],
    cascadePaths: [{ situationIds: ['s1', 's2'], narrative: 'storm → grid stress', plausibility: 0.7 }],
    watchItems: [],
    headline: 'Compound: storm + grid stress',
    ...overrides,
  } as CompoundRiskResult;
}

test('contributor maps affected domains to axes with capped severity', () => {
  const threats = makeCorrelationContributor([compound({ score: 97 })]).contribute(T0);
  assert.ok(threats.length >= 2, 'one threat per affected axis');
  for (const t of threats) {
    assert.equal(t.severity, 85, 'severity capped at the inference ceiling');
    assert.equal(t.hazardKind, 'other');
    assert.ok(t.why.includes('storm → grid stress'));
    assert.notEqual(t.confidenceLabel, 'high');
  }
});

test('contributor drops sub-threshold and malformed scores', () => {
  assert.equal(makeCorrelationContributor([compound({ score: 39 })]).contribute(T0).length, 0);
  assert.equal(makeCorrelationContributor([compound({ score: Number.NaN })]).contribute(T0).length, 0);
  assert.equal(makeCorrelationContributor(null).contribute(T0).length, 0);
  assert.equal(makeCorrelationContributor([]).contribute(T0).length, 0);
});

test('contributor threats raise the axis level through the real posture engine', () => {
  const posture = computeMultiAxisPosture({
    contributors: [makeCorrelationContributor([compound({ score: 80 })])],
    freshness: [],
    capturedAtMs: T0,
  }, { now: T0 });
  const warmed = posture.axes.filter((a) => a.level > 0);
  assert.ok(warmed.length >= 1, 'at least one axis warmed by correlation');
  assert.ok(warmed.every((a) => a.level <= 85));
});

test('deduplicated axes: two domains mapping to one axis yield one threat', () => {
  const threats = makeCorrelationContributor([
    compound({ affectedDomains: ['weather', 'wildfire'] }),
  ]).contribute(T0);
  const axes = threats.map((t) => t.axis);
  assert.equal(new Set(axes).size, axes.length);
});
