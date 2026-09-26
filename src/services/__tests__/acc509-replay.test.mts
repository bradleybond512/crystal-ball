import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../unified-alerts.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/acc509-replay.json', import.meta.url), 'utf8'));
const values = new Map<string, string>();
let clock = fixture.now;
let dispatched: string[] = [];
let failWrites = false;
Object.assign(globalThis, {
  window: {},
  document: { dispatchEvent: () => true, addEventListener: () => {}, hidden: false },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('Injected storage quota failure');
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  },
});
const { SituationEngine, situationEngine } = await import('../situation-engine.ts');
const { UnifiedAlertStore, unifiedAlertStore, _setNotifyThrottleForTest } = await import('../unified-alerts.ts');
const { notificationDispatcher } = await import('../notification-dispatcher.ts');
const { alertDB } = await import('../alert-store.ts');
const { startSituationFeed } = await import('../situation-feed.ts');
_setNotifyThrottleForTest(0);

beforeEach((t) => {
  values.clear();
  clock = fixture.now;
  dispatched = [];
  failWrites = false;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(alertDB, 'putBatch', async () => {});
  t.mock.method(notificationDispatcher, 'dispatchNotification', (alert: UnifiedAlert) => {
    dispatched.push(alert.id);
  });
});

function alert(overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return { ...structuredClone(fixture.base), ...overrides };
}

function metric(name: string, value: unknown): void {
  if (process.env.ACC509_REPLAY_METRICS) {
    appendFileSync(process.env.ACC509_REPLAY_METRICS, JSON.stringify({ name, value }) + '\n');
  }
}

function shape(engine: InstanceType<typeof SituationEngine>) {
  return engine.getSituations().map((situation) => ({
    id: situation.id, confidence: situation.confidence,
    signals: situation.signals.length,
    sources: situation.verificationDetails?.independentSources,
    lastUpdated: situation.lastUpdated,
    timestamps: situation.signals.map((signal) => signal.timestamp),
  }));
}

test('frozen delayed source replay neither creates situations nor inflates confidence or source votes', () => {
  const engine = new SituationEngine();
  const delayed = alert({ timestamp: clock - fixture.oldAgeMs });
  engine.observeAlerts([delayed]);
  const initial = shape(engine);
  for (const delay of fixture.repeatDelaysMs) {
    clock = fixture.now + delay;
    engine.observeAlerts([structuredClone(delayed)]);
  }
  const actual = shape(engine);
  metric('delayed-repeat', { initial, actual, duplicateSituations: actual.length - initial.length });
  assert.deepEqual(actual, initial);
});

test('same title, source time and locality do not collapse distinct report identities', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert(), ...fixture.distinct.map((entry: Partial<UnifiedAlert>) => alert(entry))]);
  const actual = engine.getSituations();
  metric('distinct-reports', { expected: 3, situations: actual.length, falseMerges: 3 - actual.length });
  assert.equal(actual.length, 3);
  assert.deepEqual(actual.map((entry) => entry.signals.length), [1, 1, 1]);
});

test('a delayed material revision updates the mapped situation once and retains event chronology', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert()]);
  const id = engine.getSituations()[0]!.id;
  clock += 12 * 3_600_000;
  const revision = alert(fixture.revision);
  engine.observeAlerts([revision]);
  const afterRevision = shape(engine);
  clock += 60_000;
  engine.observeAlerts([structuredClone(revision)]);
  metric('revision-replay', { afterRevision, replay: shape(engine) });
  assert.equal(afterRevision.length, 1);
  assert.equal(afterRevision[0]!.id, id);
  assert.equal(afterRevision[0]!.signals, 1);
  assert.deepEqual(afterRevision[0]!.timestamps, [revision.timestamp]);
  assert.deepEqual(shape(engine), afterRevision);
});

test('valid zero coordinates remain geographic evidence and missing coordinates stay unknown', () => {
  const actual = [];
  for (const point of fixture.zeroPoints) {
    values.clear();
    const engine = new SituationEngine();
    engine.observeAlerts([alert({ location: point })]);
    const geo = engine.getSituations()[0]!.geo;
    actual.push(geo);
    assert.ok(geo.kind === 'point');
    assert.equal(geo.lat, point.lat);
    assert.equal(geo.lon, point.lon);
  }
  values.clear();
  const unknown = new SituationEngine();
  unknown.observeAlerts([alert({ location: undefined, spatialScope: undefined })]);
  const geo = unknown.getSituations()[0]!.geo;
  metric('geography', { zeroPoints: actual, unknown: geo });
  assert.equal(geo.kind, 'unknown');
  assert.equal('lat' in geo, false);
  assert.equal('lon' in geo, false);
});

test('capacity churn and restart preserve notification consideration and acknowledged state', () => {
  const store = new UnifiedAlertStore();
  const original = alert({ acknowledged: true, snoozedUntil: clock + 3_600_000 });
  store.ingest([original]);
  store.ingest(Array.from({ length: fixture.capacityCount }, (_, index) => alert({
    id: `churn-${index}`, timestamp: clock + index, title: `Capacity event ${index}`,
  })));
  store._flushNowForTest();
  assert.equal(store.getAll().length, 500);
  assert.ok(!store.getAll().some((entry) => entry.id === original.id));
  const before = dispatched.length;
  const restarted = new UnifiedAlertStore();
  restarted.ingest([alert()]);
  restarted._flushNowForTest();
  const replayed = restarted.getAll().find((entry) => entry.id === original.id);
  metric('capacity-restart', { before, after: dispatched.length, repeatedConsiderations: dispatched.length - before, replayed });
  assert.equal(dispatched.length, before);
  if (replayed) {
    assert.equal(replayed.acknowledged, true);
    assert.equal(replayed.snoozedUntil, original.snoozedUntil);
  }
});

test('evicted derived situations are not recreated by restart replay', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert()]);
  engine.reset();
  const restarted = new SituationEngine();
  restarted.observeAlerts([alert()]);
  metric('eviction-restart', { situations: restarted.getSituations().length });
  assert.equal(restarted.getSituations().length, 0);
});

test('failed persistence retains usable in-memory deduplication', () => {
  failWrites = true;
  const engine = new SituationEngine();
  const store = new UnifiedAlertStore();
  const original = alert({ timestamp: clock - fixture.oldAgeMs });
  engine.observeAlerts([original]);
  store.ingest([original]);
  store._flushNowForTest();
  const initial = shape(engine);
  clock += 60_000;
  engine.observeAlerts([original]);
  store.ingest([original]);
  store._flushNowForTest();
  metric('persistence-failure', { initial, actual: shape(engine), considered: dispatched.length });
  assert.deepEqual(shape(engine), initial);
  assert.equal(dispatched.length, 1);
});

test('real unified-store subscription delivers same-ID material revisions and excludes derived feedback', () => {
  situationEngine.reset();
  startSituationFeed();
  situationEngine.stop();
  unifiedAlertStore.ingest([alert()]);
  unifiedAlertStore._flushNowForTest();
  const before = situationEngine.getSituations();
  assert.equal(before.length, 1);
  const id = before[0]!.id;
  clock += 60_000;
  unifiedAlertStore.ingest([alert(fixture.revision)]);
  unifiedAlertStore._flushNowForTest();
  const revised = situationEngine.getSituations();
  metric('feed-revision', { situations: revised.length, timestamps: revised.flatMap((entry) => entry.signals.map((signal) => signal.timestamp)) });
  assert.equal(revised.length, 1);
  assert.equal(revised[0]!.id, id);
  assert.equal(revised[0]!.signals[0]!.timestamp, fixture.revision.timestamp);
  const afterRevision = shape(situationEngine);
  unifiedAlertStore.ingest([alert({ id: 'derived-feedback', source: 'correlation' })]);
  unifiedAlertStore._flushNowForTest();
  assert.deepEqual(shape(situationEngine), afterRevision);
});

test('bounded admission preserves source warnings while preventing untracked derived amplification', () => {
  const engine = new SituationEngine(undefined, { identityLimits: { maxEntries: 1 } });
  const store = new UnifiedAlertStore({ identityLimits: { maxEntries: 1 } });
  const admitted = alert();
  const rejected = [
    alert({ id: 'overflow-critical', severity: 'critical' }),
    alert({ id: 'x'.repeat(fixture.oversizedIdBytes), severity: 'critical' }),
  ];
  engine.observeAlerts([admitted]);
  store.ingest([admitted]);
  const originalId = engine.getSituations()[0]!.id;
  for (let repeat = 0; repeat < 3; repeat++) {
    engine.observeAlerts(rejected);
    store.ingest(rejected);
  }
  engine.observeAlerts([alert(fixture.revision)]);
  store.ingest([alert(fixture.revision)]);
  store._flushNowForTest();
  const engineDiagnostics = engine.getIdentityDiagnostics();
  const storeDiagnostics = store.getIdentityDiagnostics();
  metric('saturation', { engineDiagnostics, storeDiagnostics, situations: engine.getSituations().length, visibleWarnings: store.getAll().length, considered: dispatched.length });
  assert.equal(engine.getSituations().length, 1);
  assert.equal(engine.getSituations()[0]!.id, originalId);
  assert.equal(engine.getSituations()[0]!.signals[0]!.timestamp, fixture.revision.timestamp);
  assert.equal(store.getAll().length, 3);
  assert.equal(dispatched.length, 3);
  assert.ok(dispatched.includes('overflow-critical'));
  assert.equal(storeDiagnostics.entries, 1);
  assert.ok(storeDiagnostics.capacityFailures > 0);
  assert.ok(engineDiagnostics.admissionFailures > 0);
});

test('replay cannot refresh the seven-day registry retention clock', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert()]);
  engine.reset();
  clock += fixture.limits.ageMs - 1;
  engine.observeAlerts([alert()]);
  assert.equal(engine.getSituations().length, 0);
  clock += 2;
  engine.observeAlerts([alert()]);
  metric('seven-day-boundary', { situationsAfterExpiry: engine.getSituations().length, diagnostics: engine.getIdentityDiagnostics() });
  assert.equal(engine.getSituations().length, 1, 'expired protection can admit the report again; replay does not extend seven days');
});

test('old revisions cannot roll back newer state, clocks, confidence or source counts after restart', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert()]);
  clock += 60_000;
  engine.observeAlerts([alert(fixture.revision)]);
  const expected = shape(engine);
  const restarted = new SituationEngine();
  clock += 60_000;
  restarted.observeAlerts([alert()]);
  restarted.observeAlerts([alert(fixture.revision)]);
  metric('restart-revisions', { expected, actual: shape(restarted) });
  assert.deepEqual(shape(restarted), expected);
});

test('native signal event-time affinity survives delayed ingestion without receipt-time affinity', () => {
  const engine = new SituationEngine();
  const timestamp = new Date(clock - fixture.oldAgeMs);
  const signal = {
    id: 'native-delayed-a', type: 'keyword_spike' as const,
    title: 'Native event A', description: 'Corroborating delayed fixture', confidence: 0.7,
    timestamp, data: { relatedTopics: ['Taiwan Strait'] },
  };
  engine.observeSignals([signal]);
  const id = engine.getSituations()[0]!.id;
  clock += 60_000;
  engine.observeSignals([{ ...signal, id: 'native-delayed-b', title: 'Native event B', data: { relatedTopics: ['Taiwan Strait'] } }]);
  const actual = engine.getSituations();
  metric('native-event-affinity', { situations: actual.length, signalCounts: actual.map((entry) => entry.signals.length) });
  assert.equal(actual.length, 1);
  assert.equal(actual[0]!.id, id);
  assert.equal(actual[0]!.signals.length, 2);
  assert.ok(actual[0]!.signals.every((entry) => entry.timestamp === timestamp.getTime()));
});

test('ACC509 keeps source-age retention at 48 hours without inventing active warning freshness', () => {
  const store = new UnifiedAlertStore();
  store.ingest([
    alert({ id: 'old-source-warning', timestamp: clock - 49 * 3_600_000 }),
    alert({ id: 'fresh-source-warning', timestamp: clock - 47 * 3_600_000 }),
  ]);
  store._flushNowForTest();
  assert.deepEqual(store.getAll().map((entry) => entry.id), ['fresh-source-warning']);
  const restarted = new UnifiedAlertStore();
  assert.deepEqual(restarted.getAll().map((entry) => entry.id), ['fresh-source-warning']);
});

test('production registry count cannot exceed 4096 through admission, raised limits or hydration', async () => {
  const { createIdentityLedger, hydrateIdentityLedger } = await import('../alert-identity.ts');
  const valid = (value: unknown): value is boolean => typeof value === 'boolean';
  const ledger = createIdentityLedger(valid, { maxEntries: fixture.limits.identities + 1 });
  const protectedKeys = new Set<string>();
  for (let index = 0; index < fixture.limits.identities; index++) {
    const key = `fixture-${index}`;
    assert.equal(ledger.admit({ key, revision: 'original', eventTime: clock }, true, clock, protectedKeys), 'accepted');
    protectedKeys.add(key);
  }
  assert.equal(ledger.admit({ key: 'overflow', revision: 'original', eventTime: clock }, true, clock, protectedKeys), 'capacity');
  assert.equal(ledger.size, fixture.limits.identities);
  const snapshot = ledger.snapshot();
  assert.equal(ledger.byteLength, Buffer.byteLength(JSON.stringify(snapshot)));
  const restored = hydrateIdentityLedger(snapshot, clock, valid);
  assert.equal(restored.size, fixture.limits.identities);
  snapshot.entries.push({ ...snapshot.entries[0]!, key: 'malicious-extra' });
  assert.equal(hydrateIdentityLedger(snapshot, clock, valid, { maxEntries: 9999 }).size, 0);
  metric('hard-count-bound', { entries: ledger.size, bytes: ledger.byteLength, hydrated: restored.size });
});

test('production registry byte budget counts UTF8 and remains at most 2 MiB across persistence and hydration', async () => {
  const { createIdentityLedger, hydrateIdentityLedger } = await import('../alert-identity.ts');
  const valid = (value: unknown): value is boolean => typeof value === 'boolean';
  const ledger = createIdentityLedger(valid, { maxBytes: fixture.limits.bytes + 1_000_000 });
  const protectedKeys = new Set<string>();
  const revision = 'é'.repeat(8000);
  let rejected = false;
  for (let index = 0; index < 200; index++) {
    const key = `fixture-${index}`;
    const outcome = ledger.admit({ key, revision, eventTime: clock }, true, clock, protectedKeys);
    if (outcome === 'capacity') { rejected = true; break; }
    assert.equal(outcome, 'accepted');
    protectedKeys.add(key);
  }
  assert.equal(rejected, true);
  const snapshot = ledger.snapshot();
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  assert.equal(ledger.byteLength, bytes);
  assert.ok(bytes <= fixture.limits.bytes);
  assert.ok(bytes + Buffer.byteLength(revision) > fixture.limits.bytes);
  const restored = hydrateIdentityLedger(snapshot, clock, valid);
  assert.equal(restored.size, ledger.size);
  snapshot.entries.push({ ...snapshot.entries[0]!, key: 'extra-byte-overflow' });
  assert.equal(hydrateIdentityLedger(snapshot, clock, valid, { maxBytes: 9999999 }).size, 0);
  metric('hard-byte-bound', { entries: ledger.size, bytes, hardLimit: fixture.limits.bytes, hydrated: restored.size });
});


test('observing native signals does not mutate caller data or carry identity into a distinct report', () => {
  const engine = new SituationEngine();
  const sharedData = { relatedTopics: ['keyword_spike'] };
  const originalData = structuredClone(sharedData);
  const first = {
    id: 'native-shared-a', type: 'keyword_spike' as const,
    title: 'Native event A', description: 'Shared provider data', confidence: 0.7,
    timestamp: new Date(clock), data: sharedData,
  };
  engine.observeSignals([first]);
  assert.deepEqual(sharedData, originalData, 'identity annotation must not escape into caller-owned provider data');
  engine.observeSignals([{ ...first, id: 'native-shared-b' }]);
  assert.equal(engine.getSituations().flatMap((entry) => entry.signals).length, 2);
});

test('malformed coordinates do not become derived global or zero-coordinate situations', () => {
  const engine = new SituationEngine();
  engine.observeAlerts(fixture.invalidPoints.map((point: { lat: number; lon: number }, index: number) =>
    alert({ id: `invalid-geography-${index}`, location: point })));
  assert.equal(engine.getSituations().length, 0);
  assert.equal(engine.getIdentityDiagnostics().admissionFailures, fixture.invalidPoints.length);
});

test('replayed independent sources keep the original confidence and two-source vote count', () => {
  const engine = new SituationEngine();
  const reports = [alert(), alert({ id: 'gdacs-independent-alpha', source: 'gdacs' })];
  engine.observeAlerts(reports);
  const original = shape(engine);
  assert.equal(original.length, 1);
  assert.equal(original[0]!.signals, 2);
  assert.equal(original[0]!.sources, 2);
  for (const delay of fixture.repeatDelaysMs) {
    clock = fixture.now + delay;
    engine.observeAlerts(structuredClone(reports));
  }
  const actual = shape(engine);
  metric('independent-source-replay', { original, actual, confidenceInflation: actual[0]!.confidence - original[0]!.confidence, voteInflation: actual[0]!.sources! - original[0]!.sources! });
  assert.deepEqual(actual, original);
});
