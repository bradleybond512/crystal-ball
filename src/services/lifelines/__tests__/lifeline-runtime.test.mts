import assert from 'node:assert/strict';
import test from 'node:test';

import { createLifelineRuntime } from '../lifeline-runtime.ts';
import { writeOfflineCacheEntry } from '../../offline-alert-cache.ts';
import type {
  AreaCondition,
  LocalLogisticsSnapshot,
  ResourceObservation,
  ResourceSite,
} from '../../local-logistics-types.ts';

const T0 = Date.parse('2026-08-14T14:00:00.000Z');
const fingerprint = 'v2|41.61110|-86.72250|25.00|fuel,hospital,hotel,pharmacy,recovery,shelter,water|3';

class MemoryStorage {
  readonly values = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const place = { id: 'home', lat: 41.6111, lon: -86.7225, radiusKm: 50 };

function site(): ResourceSite {
  return {
    id: 'fema:shelter:1',
    kind: 'shelter',
    name: 'North Shelter',
    lat: 41.62,
    lon: -86.72,
    sourceRefs: [{ provider: 'fema', recordId: '1' }],
    capabilities: {},
  };
}

function observation(operational: ResourceObservation['operational'] = 'open'): ResourceObservation {
  return {
    id: `fema:shelter:1:${operational}`,
    siteId: 'fema:shelter:1',
    provider: 'fema',
    verification: 'official',
    operational,
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    observedAt: new Date(T0),
    retrievedAt: new Date(T0),
    expiresAt: new Date(T0 + 30 * 60_000),
    confidence: 'high',
    sourceUrl: 'https://gis.fema.gov/example',
  };
}

function area(customersOut = 0, at = T0): AreaCondition {
  return {
    id: 'ornl-odin:18091:utility-1',
    type: 'power_outage',
    coverage: 'reported',
    countyFips: '18091',
    county: 'LaPorte',
    state: 'Indiana',
    customersOut,
    observedAt: new Date(at),
    retrievedAt: new Date(at),
    expiresAt: new Date(at + 30 * 60_000),
    source: 'ornl-odin',
  };
}

function snapshot(overrides: Partial<LocalLogisticsSnapshot> = {}): LocalLogisticsSnapshot {
  return {
    schemaVersion: 2,
    queryFingerprint: fingerprint,
    placeId: 'home',
    placeName: 'Home',
    effectiveRadiusKm: 25,
    countyFips: '18091',
    categories: ['shelter', 'hotel', 'hospital', 'pharmacy', 'fuel', 'water', 'recovery'],
    sites: [site()],
    observations: [observation()],
    nodes: [],
    areaConditions: [area()],
    providers: [
      { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(T0), retrievedAt: new Date(T0) },
      { id: 'fema-open-shelters', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: new Date(T0), retrievedAt: new Date(T0) },
      { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(T0), retrievedAt: new Date(T0) },
      { id: 'ornl-odin', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: new Date(T0), retrievedAt: new Date(T0) },
    ],
    fetchedAt: new Date(T0),
    isStale: false,
    isExpired: false,
    staleAgeMs: 0,
    source: 'network',
    ...overrides,
  };
}

function artifactServiceId(value: LocalLogisticsSnapshot): string {
  return `local-logistics:v2:${value.placeId}:${value.queryFingerprint}`;
}

function persistExactArtifact(storage: MemoryStorage, value: LocalLogisticsSnapshot): void {
  writeOfflineCacheEntry(
    artifactServiceId(value),
    JSON.parse(JSON.stringify(value)) as unknown,
    storage,
  );
}

interface Receipt {
  placeId: string;
  capturedAt: Date;
  expiresAt: Date | null;
  isExpired: boolean;
}

function getReceipt(runtime: ReturnType<typeof createLifelineRuntime>, target = place): Receipt | null {
  const getter = (runtime as unknown as {
    getVerifiedLifelinesReceipt?: (candidate: typeof place) => Receipt | null;
  }).getVerifiedLifelinesReceipt;
  assert.equal(typeof getter, 'function', 'runtime should expose the narrow verified receipt accessor');
  return getter.call(runtime, target);
}

test('a verified network snapshot creates exact-fingerprint offline Lifelines readiness', () => {
  const storage = new MemoryStorage();
  const runtime = createLifelineRuntime(storage, () => T0 + 60_000);
  persistExactArtifact(storage, snapshot());

  const update = runtime.processSnapshot(snapshot());
  assert.equal(update?.pack.status, 'ready');
  assert.equal(runtime.getPackReadiness(place).status, 'ready');
  assert.equal(runtime.getPackReadiness({ ...place, lat: 41.7 }).status, 'not-saved');
});

test('storage failure never claims the offline pack is ready', () => {
  const runtime = createLifelineRuntime({
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  }, () => T0 + 60_000);

  assert.equal(runtime.processSnapshot(snapshot())?.pack.status, 'not-saved');
  assert.equal(runtime.getPackReadiness(place).status, 'not-saved');
});

test('writable manifest storage cannot claim readiness without the exact persisted artifact', () => {
  const storage = new MemoryStorage();
  const runtime = createLifelineRuntime(storage, () => T0 + 60_000);

  assert.equal(runtime.processSnapshot(snapshot())?.pack.status, 'not-saved');
  assert.equal(runtime.getPackReadiness(place).status, 'not-saved');
  assert.equal(
    [...storage.values.keys()].some((key) => key.startsWith('wm_lifeline_pack_manifest_v1:')),
    false,
    'an unproven artifact must not get a manifest',
  );
});

test('a failed replacement artifact write cannot advance an existing exact manifest', () => {
  const storage = new MemoryStorage();
  const accepted = snapshot();
  persistExactArtifact(storage, accepted);
  let now = T0 + 60_000;
  const runtime = createLifelineRuntime(storage, () => now);
  assert.equal(runtime.processSnapshot(accepted)?.pack.status, 'ready');
  const manifestKey = 'wm_lifeline_pack_manifest_v1:home';
  const priorManifest = storage.getItem(manifestKey);
  assert.ok(priorManifest);

  now = T0 + 3 * 60_000;
  const replacementWithoutWrite = snapshot({ fetchedAt: new Date(T0 + 2 * 60_000) });
  assert.equal(runtime.processSnapshot(replacementWithoutWrite)?.pack.status, 'ready',
    'the older proven artifact remains usable until its own expiry');
  assert.equal(storage.getItem(manifestKey), priorManifest,
    'an unpersisted replacement must not extend the artifact timestamp or TTL');
});

test('evicting the exact artifact after manifest creation demotes readiness', () => {
  const storage = new MemoryStorage();
  const accepted = snapshot();
  persistExactArtifact(storage, accepted);
  const runtime = createLifelineRuntime(storage, () => T0 + 60_000);

  assert.equal(runtime.processSnapshot(accepted)?.pack.status, 'ready');
  storage.removeItem(`wm_offline_${artifactServiceId(accepted)}`);

  const readiness = runtime.getPackReadiness(place);
  assert.equal(readiness.status, 'not-saved');
  assert.deepEqual(readiness.missingKinds, ['lifelines']);
  assert.equal(runtime.getLatestUpdate('home', fingerprint)?.pack.status, 'not-saved',
    'cached runtime updates must not preserve stale readiness after eviction');
});

test('verified receipt accessor returns only cloned receipt dates and never writes', () => {
  const storage = new MemoryStorage();
  const accepted = snapshot();
  persistExactArtifact(storage, accepted);
  const runtime = createLifelineRuntime(storage, () => T0 + 60_000);
  runtime.processSnapshot(accepted);
  storage.writes = 0;

  const first = getReceipt(runtime);
  assert.deepEqual(Object.keys(first ?? {}).sort(), ['capturedAt', 'expiresAt', 'isExpired', 'placeId']);
  assert.equal(first?.placeId, place.id, 'receipt identity must match the exact requested place');
  assert.equal(first?.capturedAt.getTime(), T0);
  assert.equal(first?.expiresAt?.getTime(), T0 + 24 * 60 * 60_000);
  assert.equal(first?.isExpired, false);
  first?.capturedAt.setTime(0);
  first?.expiresAt?.setTime(0);

  const second = getReceipt(runtime);
  assert.equal(second?.capturedAt.getTime(), T0, 'capture date should be cloned per read');
  assert.equal(second?.expiresAt?.getTime(), T0 + 24 * 60 * 60_000, 'expiry date should be cloned per read');
  assert.equal(storage.writes, 0, 'receipt reads must not mutate persisted state');
});

test('verified receipt accessor rejects absent, moved, and evicted artifacts', () => {
  const emptyStorage = new MemoryStorage();
  assert.equal(getReceipt(createLifelineRuntime(emptyStorage, () => T0 + 60_000)), null);

  const storage = new MemoryStorage();
  const accepted = snapshot();
  persistExactArtifact(storage, accepted);
  const runtime = createLifelineRuntime(storage, () => T0 + 60_000);
  runtime.processSnapshot(accepted);
  assert.equal(getReceipt(runtime, { ...place, lat: 41.7 }), null, 'moved place must not inherit the prior receipt');

  storage.removeItem(`wm_offline_${artifactServiceId(accepted)}`);
  assert.equal(getReceipt(runtime), null, 'evicted exact artifact must revoke its receipt');
});

test('verified receipt accessor retains an expired receipt with explicit expiry state', () => {
  const storage = new MemoryStorage();
  const accepted = snapshot();
  persistExactArtifact(storage, accepted);
  let now = T0 + 60_000;
  const runtime = createLifelineRuntime(storage, () => now);
  runtime.processSnapshot(accepted);

  now = T0 + 24 * 60 * 60_000;
  const receipt = getReceipt(runtime);
  assert.equal(receipt?.capturedAt.getTime(), T0);
  assert.equal(receipt?.expiresAt?.getTime(), now);
  assert.equal(receipt?.isExpired, true);
});

test('a newer official transition creates a shadow-only change while an older response is ignored', () => {
  const runtime = createLifelineRuntime(new MemoryStorage(), () => T0 + 3 * 60_000);
  assert.deepEqual(runtime.processSnapshot(snapshot())?.changes, []);

  const changed = snapshot({
    fetchedAt: new Date(T0 + 2 * 60_000),
    observations: [{ ...observation('closed'), observedAt: new Date(T0 + 2 * 60_000), retrievedAt: new Date(T0 + 2 * 60_000) }],
    areaConditions: [area(25, T0 + 2 * 60_000)],
  });
  const changes = runtime.processSnapshot(changed)?.changes ?? [];
  assert.ok(changes.some((change) => change.kind === 'site-status-changed' && change.to === 'closed'));
  assert.ok(changes.some((change) => change.kind === 'area-outage-changed' && change.to === 25));
  assert.ok(changes.every((change) => change.shadowOnly));

  const ignored = runtime.processSnapshot(snapshot({ fetchedAt: new Date(T0 + 60_000) }));
  assert.equal(ignored?.situation.sites[0]?.operational.value, 'closed');

  const movedFingerprint = fingerprint.replace('41.61110', '41.71110');
  assert.deepEqual(runtime.processSnapshot(snapshot({
    queryFingerprint: movedFingerprint,
    fetchedAt: new Date(T0 + 4 * 60_000),
  }))?.changes, []);
  assert.equal(runtime.getRecentChanges('home', movedFingerprint).length, 0,
    'a moved-place fingerprint must not surface the prior location change log');
  assert.ok(runtime.getRecentChanges('home', fingerprint).length > 0,
    'the original exact fingerprint retains its own bounded shadow history');
});

test('ODIN accepts an explicit reported zero but an empty result changes coverage to unknown', () => {
  const storage = new MemoryStorage();
  let now = T0 + 60_000;
  const runtime = createLifelineRuntime(storage, () => now);
  const reported = runtime.processSnapshot(snapshot());
  assert.equal(reported?.outage?.coverage, 'reported');
  assert.equal(reported?.outage?.customersOut, 0);

  now = T0 + 3 * 60_000;
  const empty = runtime.processSnapshot(snapshot({
    fetchedAt: new Date(T0 + 2 * 60_000),
    areaConditions: [],
    providers: [{
      id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0,
      observedAt: new Date(T0 + 2 * 60_000), retrievedAt: new Date(T0 + 2 * 60_000),
    }],
  }));
  assert.equal(empty?.outage?.coverage, 'unknown');
  assert.equal(empty?.outage?.customersOut, null);
  assert.equal(empty?.outage?.reason, 'empty-response');
});
