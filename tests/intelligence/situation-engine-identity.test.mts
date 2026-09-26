import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { UnifiedAlert } from '../../src/services/unified-alerts.ts';
import type { Situation } from '../../src/services/situation-types.ts';

const storage = new Map<string, string>();
let now = 1_790_000_000_000;
let failWrites = false;
Object.assign(globalThis, {
  window: { setTimeout: () => 0, addEventListener: () => {} },
  document: { dispatchEvent: () => true, addEventListener: () => {}, hidden: false },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('quota'); storage.set(key, value); },
    removeItem: (key: string) => storage.delete(key),
  },
});
const { SituationEngine, situationEngine, domainHintForAlertSource } = await import('../../src/services/situation-engine.ts');
const { situationDisplayCenter, situationReportedPoint } = await import('../../src/services/situation-types.ts');
const { unifiedAlertStore } = await import('../../src/services/unified-alerts.ts');
const { startSituationAlertBridge } = await import('../../src/services/situation-alert-bridge.ts');

beforeEach(t => {
  storage.clear(); now = 1_790_000_000_000; failWrites = false;
  t.mock.method(Date, 'now', () => now);
});
function alert(overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return { id: 'nws-test', source: 'nws', title: 'Flood Warning', body: 'Flooding observed', severity: 'high',
    timestamp: now, location: { lat: 0, lon: 12, label: 'River' }, spatialScope: { kind: 'point', basis: 'reported-event' },
    relevanceScore: 90, acknowledged: false, pinned: false, ...overrides };
}

function native(data: object = {}) {
  return { id: 'native-good', type: 'keyword_spike' as const, title: 'Event', description: '',
    confidence: 0.7, timestamp: new Date(now), data };
}

test('malformed native context is rejected without interrupting valid members of a batch', () => {
  const invalid = [
    { relatedTopics: [null] }, { correlatedEntities: [3] }, { placeIds: {} },
    { correlatedNews: [{}] }, { explanation: {} }, { placeSummary: [] },
    { source: {} }, { domainHint: 'unexpected' },
  ];
  for (const data of invalid) {
    const engine = new SituationEngine();
    assert.doesNotThrow(() => engine.observeSignals([native(data) as never, native()]));
    assert.equal(engine.getSituations().length, 1);
    assert.equal(engine.getIdentityDiagnostics().admissionFailures, 1);
    storage.clear();
  }
});

test('malformed persisted signals are quarantined with diagnostics while valid rows remain usable', () => {
  for (const fields of [{ entities: [null] }, { source: {} }, { identity: { key: 3 } },
    { type: 'invented' }, { domain: 'invented' }, { confidence: 7 }, { timestamp: -1 },
    { timestamp: { toString: null, valueOf: null } }]) {
    storage.clear();
    const seed = new SituationEngine(); seed.observeAlerts([alert()]);
    const envelope = JSON.parse(storage.get('wm-situations-v2')!);
    const bad = structuredClone(envelope.situations[0]); bad.id = 'bad';
    Object.assign(bad.signals[0], fields);
    envelope.situations.push(bad);
    storage.set('wm-situations-v2', JSON.stringify(envelope));
    const engine = new SituationEngine();
    assert.equal(engine.getSituations().length, 1);
    assert.equal(engine.getIdentityDiagnostics().restartProtected, false);
    assert.ok(engine.getIdentityDiagnostics().persistenceFailures > 0);
    assert.doesNotThrow(() => engine.observeSignals([native({ relatedTopics: ['River'] })]));
  }
});

test('material geographic revisions use current source snapshots through restart and removal', () => {
  const engine = new SituationEngine();
  const sources = [alert(), alert({ source: 'gdacs', id: 'other-source' })];
  engine.observeAlerts(sources);
  assert.equal(engine.getSituations().length, 1);
  assert.equal(engine.getSituations()[0]!.signals.length, 2);
  now += 1000;
  engine.observeAlerts([{ ...sources[0]!, timestamp: now, location: { lat: 50, lon: 50 } }]);
  assert.deepEqual(situationReportedPoint(engine.getSituations()[0]!.geo), { lat: 50, lon: 50 });
  engine.observeAlerts(sources.map(a => ({ ...a, timestamp: now, location: { lat: 50, lon: 50 } })));
  const moved = engine.getSituations()[0]!;
  assert.deepEqual(situationReportedPoint(moved.geo), { lat: 50, lon: 50 });
  const restarted = new SituationEngine();
  assert.deepEqual(situationReportedPoint(restarted.getSituations()[0]!.geo), { lat: 50, lon: 50 });
  now += 1000;
  restarted.observeAlerts(sources.map(a => ({ ...a, timestamp: now, location: undefined, spatialScope: undefined })));
  assert.equal(situationReportedPoint(restarted.getSituations()[0]!.geo), null);
  assert.equal(restarted.getSituations()[0]!.geo.kind, 'unknown');
});

test('the real LSR adapter carries validated zero point geography into the engine', async () => {
  const { stormReportToAlert } = await import('../../src/services/intel-channels-bridge.ts');
  const report = stormReportToAlert({ id: 'positional', type: 'tornado', severity: 'critical',
    magnitude: '0', location: 'River', county: 'County', state: 'State', remarks: 'Reported',
    reportedAt: new Date(now), lat: 0, lon: 0 });
  assert.ok(report);
  const engine = new SituationEngine(); engine.observeAlerts([report]);
  assert.deepEqual(situationReportedPoint(engine.getSituations()[0]!.geo), { lat: 0, lon: 0 });
});

test('current geography is independent of revision arrival order and falls back to remaining provenance', () => {
  const run = (reverse: boolean) => {
    storage.clear();
    const engine = new SituationEngine();
    const sources = [alert(), alert({ source: 'gdacs', id: 'other-source' })];
    engine.observeAlerts(sources);
    const updates = sources.map((a, index) => ({ ...a, timestamp: now + 1,
      location: { lat: 50 + index, lon: 50 + index } }));
    engine.observeAlerts(reverse ? [...updates].reverse() : updates);
    const result = engine.getSituations()[0]!;
    assert.deepEqual(situationReportedPoint(result.geo), { lat: 51, lon: 51 });
    engine.observeAlerts([{ ...updates[1]!, timestamp: now + 2, location: undefined, spatialScope: undefined }]);
    assert.deepEqual(situationReportedPoint(result.geo), { lat: 50, lon: 50 });
    return result.geo;
  };
  assert.deepEqual(run(false), run(true));
});

test('v2 rows without per-source geography cannot revive aggregate coordinates on restart', () => {
  const engine = new SituationEngine(); engine.observeAlerts([alert()]);
  const envelope = JSON.parse(storage.get('wm-situations-v2')!);
  delete envelope.situations[0].signals[0].geo;
  storage.set('wm-situations-v2', JSON.stringify(envelope));
  const restarted = new SituationEngine();
  assert.equal(restarted.getSituations().length, 1);
  assert.equal(restarted.getSituations()[0]!.geo.kind, 'unknown');
});

test('direct feedback and forged correlation source do not enter the engine', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert({ source: 'correlation' })]);
  engine.observeSignals([{ id: 'echo', type: 'keyword_spike', title: 'Echo', description: '', confidence: 0.9,
    timestamp: new Date(now), data: { source: 'correlation' } }]);
  assert.deepEqual(engine.getSituations(), []);
  assert.equal(engine.getIdentityDiagnostics().size, 0);
});

test('weather and disaster hints remain domain-correct without changing generic news classification', () => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert(), alert({ id: 'gdacs-test', source: 'gdacs', location: { lat: 30, lon: 40 } })]);
  assert.ok(engine.getSituations().every(s => s.domain === 'natural_hazard'));
  assert.equal(domainHintForAlertSource('breaking-news'), undefined);
  assert.equal(domainHintForAlertSource('__proto__'), undefined);
});

test('legacy source situation remains readable but cannot be promoted by the actual alert bridge', t => {
  const engine = new SituationEngine();
  engine.observeAlerts([alert()]);
  const legacy = engine.getSituations()[0]!;
  legacy.phase = 'active'; legacy.confidence = 0.9;
  delete (legacy as Partial<Situation>).latestEventAt;
  for (const signal of legacy.signals) delete signal.identity;
  const raw = JSON.stringify([legacy]);
  storage.clear(); storage.set('wm-situations-v1', raw);
  const restored = new SituationEngine();
  assert.equal(restored.getSituations()[0]!.latestEventAt, now);
  assert.equal(restored.getSituations()[0]!.legacyUnverified, true);
  assert.equal(restored.getSituations()[0]!.geo.kind, 'unknown');
  assert.deepEqual(restored.getActionableSituations(), []);
  assert.equal(storage.get('wm-situations-v1'), raw);
  assert.ok(storage.get('wm-situations-v2'));
  let sync: (() => void) | undefined;
  const promotions: UnifiedAlert[] = [];
  t.mock.method(situationEngine, 'getActionableSituations', () => restored.getSituations());
  t.mock.method(situationEngine, 'subscribe', callback => { sync = callback; return () => {}; });
  t.mock.method(unifiedAlertStore, 'ingest', alerts => { promotions.push(...alerts); });
  startSituationAlertBridge();
  assert.ok(sync);
  sync();
  assert.deepEqual(promotions, []);
});

test('migration failure leaves v1 intact and reports degraded restart protection', () => {
  const engine = new SituationEngine(); engine.observeAlerts([alert()]);
  const raw = JSON.stringify(engine.getSituations());
  storage.clear(); storage.set('wm-situations-v1', raw); failWrites = true;
  const restored = new SituationEngine();
  assert.equal(restored.getSituations().length, 1);
  assert.equal(storage.get('wm-situations-v1'), raw);
  assert.equal(storage.has('wm-situations-v2'), false);
  assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
  assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 1);
});

test('all display centers are explicit and only reported points permit distance inference', () => {
  const common = { label: '', countries: [], radiusKm: 0 };
  assert.deepEqual(situationDisplayCenter({ ...common, kind: 'point', basis: 'reported-event', lat: 0, lon: 0 }), { lat: 0, lon: 0 });
  assert.deepEqual(situationReportedPoint({ ...common, kind: 'point', basis: 'reported-event', lat: 51, lon: 0 }), { lat: 51, lon: 0 });
  assert.equal(situationReportedPoint({ ...common, kind: 'point', basis: 'centroid', lat: 51, lon: 0 }), null);
  assert.deepEqual(situationDisplayCenter({ ...common, kind: 'area', basis: 'nws-geometry', centroid: { lat: 0, lon: 12 } }), { lat: 0, lon: 12 });
  assert.equal(situationReportedPoint({ ...common, kind: 'area', basis: 'nws-geometry', centroid: { lat: 0, lon: 12 } }), null);
  for (const kind of ['unknown', 'country', 'global'] as const) assert.equal(situationDisplayCenter({ ...common, kind }), null);
});

test('unchanged observation returns before persistence and subscriber notification', t => {
  const engine = new SituationEngine(); const source = alert();
  let notifications = 0;
  engine.subscribe(() => notifications++);
  const writes = t.mock.method(localStorage, 'setItem', (key, value) => { storage.set(key, value); });
  engine.observeAlerts([source]);
  const count = writes.mock.callCount();
  now += 60_000;
  engine.observeAlerts([source]);
  assert.equal(writes.mock.callCount(), count);
  assert.equal(notifications, 1);
});

test('generic signal/domain tokens and matching location labels do not establish shared entities', () => {
  const engine = new SituationEngine();
  for (const id of ['one', 'two']) engine.observeSignals([{
    id, type: 'keyword_spike', title: 'Same', description: '', confidence: 0.7, timestamp: new Date(now),
    data: { relatedTopics: ['keyword_spike', 'civil_unrest', 'Global'], placeSummary: 'Same locality' },
  }]);
  assert.equal(engine.getSituations().length, 2);
  assert.ok(engine.getSituations().every(s => s.signals.length === 1));
});

test('invalid persisted identity snapshots report degraded restart protection', () => {
  for (const identities of [{ version: 9, entries: [] }, { version: 1, entries: [{}] }]) {
    storage.set('wm-situations-v2', JSON.stringify({ version: 2, situations: [], identities }));
    const restored = new SituationEngine();
    assert.equal(restored.getIdentityDiagnostics().size, 0);
    assert.equal(restored.getIdentityDiagnostics().restartProtected, false);
    assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 1);
  }
});

test('ordinary identity expiry during hydration does not report corrupt persistence', () => {
  const engine = new SituationEngine(); engine.observeAlerts([alert()]);
  now += 7 * 86_400_000;
  const restored = new SituationEngine();
  assert.equal(restored.getIdentityDiagnostics().size, 0);
  assert.equal(restored.getIdentityDiagnostics().restartProtected, true);
  assert.equal(restored.getIdentityDiagnostics().persistenceFailures, 0);
});
