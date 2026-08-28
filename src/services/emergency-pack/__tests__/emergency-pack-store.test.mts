import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryBodies,
  MemoryMetadata,
  NOW,
  PLACE_ID,
  PROFILE,
  REQUIRED_KINDS,
  digest,
  requireFunction,
  type ReceiptFixture,
} from './test-support.mts';

interface StoreApi {
  createEmergencyPackStore?: (dependencies: {
    metadata: MemoryMetadata;
    bodies: {
      put: (key: string, body: string) => Promise<void>;
      get: (key: string) => Promise<string | null>;
      delete: (key: string) => Promise<boolean>;
    };
    digest: typeof digest;
    now: () => number;
    createPackId: () => string;
    verifyArtifactBody?: (kind: string, body: string) => boolean | Promise<boolean>;
    adoptArtifactBody?: (kind: string, body: string) => void | Promise<void>;
    reconcileRecoveredArtifactBody?: (kind: string, body: string) => void | Promise<void>;
    releaseArtifactBody?: (kind: string, body: string) => void | Promise<void>;
  }) => {
    commitGeneration: (input: {
      placeId: string;
      profileFingerprint: string;
      requiredKinds: readonly string[];
      optionalKinds: readonly string[];
      artifacts: Array<{
        kind: string;
        body: string;
        capturedAt: number;
        sourceRevision?: string;
        expiresAt: number;
        semanticState: string;
        summary: string;
        itemCount: number;
      }>;
    }) => Promise<{ ok: boolean; packId?: string; reason?: string }>;
    migrateLifelineGeneration: (input: {
      placeId: string;
      profileFingerprint: string;
      legacyQueryFingerprint: string;
      legacyManifest: unknown;
      artifact: {
        kind: 'lifelines';
        body: string;
        capturedAt: number;
        expiresAt: number;
        semanticState: 'verified' | 'verified-empty';
        summary: string;
        itemCount: number;
      };
    }) => Promise<{ ok: boolean; packId?: string; reason?: string }>;
    readActive: (scope: { placeId: string; profileFingerprint: string; now: number }) => Promise<{
      status: string;
      packId: string | null;
      reason?: string;
    }>;
    readReadiness: (scope: { placeId: string; profileFingerprint: string; now: number }) => Promise<{
      status: string;
      packId: string | null;
      profileFingerprint: string;
      requiredKinds: string[];
      optionalKinds: string[];
      receipts: ReceiptFixture[];
      missingKinds: string[];
      expiredKinds: string[];
      reason?: string;
    }>;
    readOfflineMapRevision: (scope: {
      placeId: string;
      profileFingerprint: string;
      now: number;
    }) => string | null;
    readVerifiedOfflineMapArtifact: (scope: {
      placeId: string;
      profileFingerprint: string;
      now: number;
    }) => Promise<{ body: string; revision: string; expiresAt: number } | null>;
    invalidateArtifacts: (input: {
      placeId: string;
      profileFingerprint: string;
      kinds: readonly string[];
      capturedAt: number;
      sourceRevision?: string;
    }) => Promise<{ ok: boolean; reason?: string }>;
    reconcileAlertRevision: (input: {
      placeId: string;
      profileFingerprint: string;
      capturedAt: number;
      sourceRevision: string;
    }) => Promise<{ ok: boolean; reason?: string }>;
    recoverActive: (scope: { placeId: string; profileFingerprint: string; now: number }) => Promise<{
      status: string;
      packId: string | null;
    }>;
    prune: (input: {
      placeIds: string[];
      maxPlaces: number;
      generationsPerPlace: number;
    }) => Promise<void>;
  };
}

const api = await import('../emergency-pack-store.ts').catch(() => ({} as StoreApi)) as StoreApi;
const ALERT_REVISION_A = 'a'.repeat(64);
const ALERT_REVISION_B = 'b'.repeat(64);

function artifacts(
  marker: string,
  placeId = PLACE_ID,
  profileFingerprint = PROFILE,
  capturedAtOverride?: number,
  alertSourceRevision = ALERT_REVISION_A,
) {
  return REQUIRED_KINDS.map((kind, index) => {
    const capturedAt = capturedAtOverride ?? NOW - (index + 1) * 60_000;
    const sourceRevision = kind === 'alerts' ? alertSourceRevision : undefined;
    return {
    kind,
    body: JSON.stringify({ marker, kind, placeId, profileFingerprint, capturedAt, ...(
      sourceRevision === undefined ? {} : { sourceRevision }
    ) }),
    capturedAt,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    expiresAt: NOW + 60 * 60_000,
    semanticState: 'verified',
    summary: `${kind} captured`,
    itemCount: 1,
    };
  });
}

function harness(overrides: {
  verifyArtifactBody?: (kind: string, body: string) => boolean | Promise<boolean>;
  adoptArtifactBody?: (kind: string, body: string) => void | Promise<void>;
  reconcileRecoveredArtifactBody?: (kind: string, body: string) => void | Promise<void>;
  releaseArtifactBody?: (kind: string, body: string) => void | Promise<void>;
  digest?: (body: string) => Promise<string>;
  deleteBody?: (key: string, deleteDefault: () => Promise<boolean>) => Promise<boolean>;
} = {}) {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const bodyBoundary = {
    put: (key: string, body: string) => bodies.put(key, body),
    get: (key: string) => bodies.get(key),
    delete: (key: string) => overrides.deleteBody?.(key, async () => {
      await bodies.delete(key);
      return true;
    }) ?? (async () => {
      await bodies.delete(key);
      return true;
    })(),
  };
  let nextId = 1;
  const create = requireFunction(api, 'createEmergencyPackStore');
  const store = create({
    metadata,
    bodies: bodyBoundary,
    digest: overrides.digest ?? digest,
    now: () => NOW,
    createPackId: () => `pack-${nextId++}`,
    ...overrides,
  });
  return { metadata, bodies, operations, store };
}

function createEmergencyPackStoreForClock(
  metadata: MemoryMetadata,
  bodies: MemoryBodies,
  timestamp: number,
  packId: string,
) {
  const create = requireFunction(api, 'createEmergencyPackStore');
  return {
    store: create({
      metadata,
      bodies: {
        put: (key, body) => bodies.put(key, body),
        get: (key) => bodies.get(key),
        async delete(key) {
          await bodies.delete(key);
          return true;
        },
      },
      digest,
      now: () => timestamp,
      createPackId: () => packId,
    }),
  };
}

async function commit(store: ReturnType<typeof harness>['store'], marker: string) {
  return commitScope(store, PLACE_ID, PROFILE, marker);
}

async function commitScope(
  store: ReturnType<typeof harness>['store'],
  placeId: string,
  profileFingerprint: string,
  marker: string,
) {
  return store.commitGeneration({
    placeId,
    profileFingerprint,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts(marker, placeId, profileFingerprint),
  });
}

function legacyMigrationInput(
  profileFingerprint = PROFILE,
  legacyQueryFingerprint = 'lifelines-exact-v1',
) {
  const legacyManifest = {
    schemaVersion: 1,
    placeId: PLACE_ID,
    queryFingerprint: legacyQueryFingerprint,
    requiredKinds: ['lifelines'],
    artifacts: [{
      kind: 'lifelines',
      queryFingerprint: legacyQueryFingerprint,
      cachedAt: new Date(NOW - 60_000).toISOString(),
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    }],
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 30_000).toISOString(),
  };
  const capturedAt = NOW - 60_000;
  return {
    placeId: PLACE_ID,
    profileFingerprint,
    legacyQueryFingerprint,
    legacyManifest,
    artifact: {
      kind: 'lifelines' as const,
      body: JSON.stringify({ snapshot: legacyManifest, marker: 'legacy-exact-body', capturedAt }),
      capturedAt,
      expiresAt: NOW + 60 * 60_000,
      semanticState: 'verified' as const,
      summary: 'Migrated exact Lifelines snapshot',
      itemCount: 1,
    },
  };
}

async function rewriteActiveManifest(
  metadata: MemoryMetadata,
  mutate: (manifest: {
    receipts: ReceiptFixture[];
    [key: string]: unknown;
  }) => void,
): Promise<void> {
  const headEntry = [...metadata.values.entries()].find(([key]) => key.includes(':head:'));
  assert.ok(headEntry);
  const head = JSON.parse(headEntry[1]) as { manifestKey: string; manifestSha256: string };
  const encodedManifest = metadata.values.get(head.manifestKey);
  assert.ok(encodedManifest);
  const manifest = JSON.parse(encodedManifest) as { receipts: ReceiptFixture[]; [key: string]: unknown };
  mutate(manifest);
  const rewritten = JSON.stringify(manifest);
  metadata.values.set(head.manifestKey, rewritten);
  head.manifestSha256 = await digest(rewritten);
  metadata.values.set(headEntry[0], JSON.stringify(head));
}

test('a generation is published only after every body is written, read back, and hashed', async () => {
  const { operations, store } = harness();
  const result = await commit(store, 'first');
  assert.deepEqual(result, { ok: true, packId: 'pack-1' });

  const lastReadback = Math.max(...operations.map((entry, index) => entry.startsWith('body:get:') ? index : -1));
  const manifestWrite = operations.findIndex((entry) => entry.includes('metadata:set:') && entry.includes('manifest'));
  const headWrite = operations.findIndex((entry) => entry.includes('metadata:set:') && entry.includes('head'));
  assert.ok(lastReadback >= 0 && manifestWrite > lastReadback, 'manifest follows exact body readback');
  assert.ok(headWrite > manifestWrite, 'head is the final publication write');
});

test('generation receipts preserve mixed source ages and reject future or body-inconsistent evidence', async () => {
  const mixedHarness = harness();
  assert.deepEqual(await commit(mixedHarness.store, 'mixed-age'), { ok: true, packId: 'pack-1' });
  const readiness = await mixedHarness.store.readReadiness({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    now: NOW,
  });
  assert.deepEqual(
    readiness.receipts.map(({ kind, capturedAt, verifiedAt }) => ({ kind, capturedAt, verifiedAt })),
    REQUIRED_KINDS.map((kind, index) => ({
      kind,
      capturedAt: new Date(NOW - (index + 1) * 60_000).toISOString(),
      verifiedAt: new Date(NOW).toISOString(),
    })),
  );

  for (const scenario of ['future', 'body-mismatch'] as const) {
    const candidate = artifacts(scenario);
    const first = candidate[0];
    assert.ok(first);
    if (scenario === 'future') {
      first.capturedAt = NOW + 1;
      first.body = JSON.stringify({
        marker: scenario,
        kind: first.kind,
        placeId: PLACE_ID,
        profileFingerprint: PROFILE,
        capturedAt: first.capturedAt,
      });
    } else {
      first.body = JSON.stringify({
        marker: scenario,
        kind: first.kind,
        placeId: PLACE_ID,
        profileFingerprint: PROFILE,
        capturedAt: first.capturedAt - 1,
      });
    }
    const rejected = await harness().store.commitGeneration({
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      requiredKinds: REQUIRED_KINDS,
      optionalKinds: ['route-alternate'],
      artifacts: candidate,
    });
    assert.equal(rejected.ok, false, scenario);
  }
});

test('quota, corrupt readback, manifest failure, and head failure retain the prior active generation', async () => {
  for (const failure of ['quota', 'readback', 'manifest', 'head'] as const) {
    const { metadata, bodies, store } = harness();
    assert.deepEqual(await commit(store, 'good'), { ok: true, packId: 'pack-1' });

    if (failure === 'quota') bodies.failPut = true;
    if (failure === 'readback') bodies.alterReadback = true;
    if (failure === 'manifest') metadata.fail = (key) => key.includes('manifest');
    if (failure === 'head') metadata.fail = (key) => key.includes('head');

    assert.equal((await commit(store, failure)).ok, false, failure);
    bodies.failPut = false;
    bodies.alterReadback = false;
    metadata.fail = null;
    assert.deepEqual(
      await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'ready', packId: 'pack-1' },
      failure,
    );
  }
});

test('offline map adoption completes before head publication and failed adoption never displaces the prior head', async () => {
  let metadata: MemoryMetadata;
  let failAdoption = false;
  let pauseAdoption = false;
  let signalAdoptionStarted = () => undefined;
  let releaseAdoption = () => undefined;
  const adoptionStarted = new Promise<void>((resolve) => { signalAdoptionStarted = resolve; });
  const adoptionRelease = new Promise<void>((resolve) => { releaseAdoption = resolve; });
  const adopted: Array<{ marker: string; publishedPackId: string | null }> = [];
  const released: string[] = [];
  const created = harness({
    async adoptArtifactBody(kind, body) {
      if (kind !== 'offline-map') return;
      const head = [...metadata.values.entries()].find(([key]) => key.includes(':head:'))?.[1] ?? null;
      adopted.push({
        marker: (JSON.parse(body) as { marker: string }).marker,
        publishedPackId: head === null ? null : (JSON.parse(head) as { packId: string }).packId,
      });
      if (failAdoption) throw new Error('offline map generation adoption failed');
      if (pauseAdoption) {
        signalAdoptionStarted();
        await adoptionRelease;
      }
    },
    releaseArtifactBody(kind, body) {
      if (kind === 'offline-map') released.push((JSON.parse(body) as { marker: string }).marker);
    },
  });
  metadata = created.metadata;

  assert.deepEqual(await commit(created.store, 'active-a'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(adopted, [{ marker: 'active-a', publishedPackId: null }]);

  adopted.length = 0;
  await created.store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
  assert.deepEqual(adopted, [], 'verified active reads must never adopt map ownership');

  pauseAdoption = true;
  const candidate = commit(created.store, 'candidate-b');
  await adoptionStarted;
  assert.deepEqual(
    await created.store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
    'the prior head remains authoritative until adoption completes',
  );
  releaseAdoption();
  assert.deepEqual(await candidate, { ok: true, packId: 'pack-2' });
  pauseAdoption = false;

  failAdoption = true;
  const failed = await commit(created.store, 'candidate-c');
  failAdoption = false;

  assert.equal(failed.ok, false);
  assert.deepEqual(adopted, [
    { marker: 'candidate-b', publishedPackId: 'pack-1' },
    { marker: 'candidate-c', publishedPackId: 'pack-2' },
  ]);
  assert.deepEqual(released, ['candidate-c']);
  assert.deepEqual(
    await created.store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-2' },
  );
});

test('active reads re-hash bodies and recover the previous verified generation after corruption', async () => {
  const { metadata, bodies, store } = harness();
  assert.equal((await commit(store, 'previous')).packId, 'pack-1');
  assert.equal((await commit(store, 'current')).packId, 'pack-2');

  const currentKey = [...bodies.values.keys()].find((key) => key.includes('pack-2'));
  assert.ok(currentKey);
  bodies.values.set(currentKey, `${bodies.values.get(currentKey)}tampered`);

  assert.deepEqual(
    await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
  assert.ok(
    [...metadata.values.values()].some((value) => value.includes('pack-1')),
    'recovery republishes only a verified generation',
  );
  const recoveredHead = [...metadata.values.entries()].find(([key]) => key.includes(':head:'));
  assert.ok(recoveredHead);
  assert.equal(JSON.parse(recoveredHead[1]).packId, 'pack-1');
});

for (const failure of ['silent-drop', 'altered-readback'] as const) {
  test(`recovery refuses ${failure} head publication`, async () => {
    const { metadata, bodies, store } = harness();
    assert.deepEqual(await commit(store, 'previous'), { ok: true, packId: 'pack-1' });
    assert.deepEqual(await commit(store, 'current'), { ok: true, packId: 'pack-2' });

    const currentBodyKey = [...bodies.values.keys()].find((key) => key.includes('pack-2'));
    assert.ok(currentBodyKey);
    bodies.values.set(currentBodyKey, `${bodies.values.get(currentBodyKey)}tampered`);

    const originalSetItem = metadata.setItem.bind(metadata);
    metadata.setItem = (key, value) => {
      const proposed = key.includes(':head:') ? JSON.parse(value) as { packId?: string } : null;
      if (proposed?.packId !== 'pack-1') {
        originalSetItem(key, value);
        return;
      }
      if (failure === 'altered-readback') {
        originalSetItem(key, value.replace('"packId":"pack-1"', '"packId":"altered"'));
      }
    };

    assert.deepEqual(
      await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'not-saved', packId: null },
    );
    const persistedHead = [...metadata.values.entries()].find(([key]) => key.includes(':head:'));
    assert.ok(persistedHead);
    assert.equal(JSON.parse(persistedHead[1]).packId, 'pack-2');
    assert.deepEqual(
      await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'corrupt', packId: null, reason: 'verification-failed' },
    );
  });
}

test('recovery keeps a verified current ready generation authoritative over its previous generation', async () => {
  const { metadata, operations, store } = harness();
  assert.deepEqual(await commit(store, 'previous-ready'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await commit(store, 'current-ready'), { ok: true, packId: 'pack-2' });
  operations.length = 0;

  assert.deepEqual(
    await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-2' },
  );
  assert.equal(
    operations.some((entry) => entry.includes('metadata:set:') && entry.includes(':head:')),
    false,
    'a verified current head is returned without republishing an older generation',
  );
  const head = [...metadata.values.entries()].find(([key]) => key.includes(':head:'));
  assert.ok(head);
  assert.equal(JSON.parse(head[1]).packId, 'pack-2');
});

test('verified-current recovery reconciles offline map ownership before returning', async () => {
  let reconciliationHasStarted = false;
  let releaseReconciliation = () => undefined;
  let signalReconciliationStarted = () => undefined;
  const reconciliationStarted = new Promise<void>((resolve) => { signalReconciliationStarted = resolve; });
  const reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
  const reconciled: string[] = [];
  const { store } = harness({
    async reconcileRecoveredArtifactBody(kind, body) {
      if (kind !== 'offline-map') return;
      reconciled.push((JSON.parse(body) as { marker: string }).marker);
      reconciliationHasStarted = true;
      signalReconciliationStarted();
      await reconciliationRelease;
    },
  });
  assert.deepEqual(await commit(store, 'current-ready'), { ok: true, packId: 'pack-1' });

  let settled = false;
  const recovery = store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })
    .finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reconciliationHasStarted, true, 'verified-current recovery must reconcile map ownership');
  await reconciliationStarted;
  assert.equal(settled, false, 'recovery must not return before ownership reconciliation');
  assert.deepEqual(reconciled, ['current-ready']);
  releaseReconciliation();
  assert.deepEqual(await recovery, { status: 'ready', packId: 'pack-1' });
});

test('fallback recovery reconciles ownership before publishing and rejects an alert binding changed during the await', async () => {
  let pauseReconciliation = false;
  let reconciliationHasStarted = false;
  let releaseReconciliation = () => undefined;
  let signalReconciliationStarted = () => undefined;
  let reconciliationStarted = new Promise<void>((resolve) => { signalReconciliationStarted = resolve; });
  let reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
  const { metadata, bodies, store } = harness({
    async reconcileRecoveredArtifactBody(kind) {
      if (kind !== 'offline-map' || !pauseReconciliation) return;
      reconciliationHasStarted = true;
      signalReconciliationStarted();
      await reconciliationRelease;
    },
  });
  assert.deepEqual(await commit(store, 'previous-ready'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await commit(store, 'current-corrupt'), { ok: true, packId: 'pack-2' });
  const currentBodyKey = [...bodies.values.keys()].find((key) => key.includes('pack-2'));
  assert.ok(currentBodyKey);
  bodies.values.set(currentBodyKey, `${bodies.values.get(currentBodyKey)}tampered`);
  const activeHead = () => JSON.parse(
    [...metadata.values.entries()].find(([key]) => key.includes(':head:'))?.[1] ?? '{}',
  ) as { packId?: string };

  pauseReconciliation = true;
  const recovery = store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reconciliationHasStarted, true, 'fallback recovery must reconcile map ownership');
  await reconciliationStarted;
  assert.equal(activeHead().packId, 'pack-2', 'fallback head must remain unpublished while ownership is unresolved');
  releaseReconciliation();
  assert.deepEqual(await recovery, { status: 'ready', packId: 'pack-1' });
  assert.equal(activeHead().packId, 'pack-1');

  metadata.values.set(
    [...metadata.values.keys()].find((key) => key.includes(':head:')) ?? '',
    JSON.stringify({
      ...activeHead(),
      packId: 'pack-2',
      manifestKey: [...metadata.values.keys()].find((key) => key.includes(':manifest:') && key.includes('pack-2')),
      manifestSha256: await digest(
        metadata.values.get([...metadata.values.keys()].find(
          (key) => key.includes(':manifest:') && key.includes('pack-2'),
        ) ?? '') ?? '',
      ),
    }),
  );
  reconciliationStarted = new Promise<void>((resolve) => { signalReconciliationStarted = resolve; });
  reconciliationRelease = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
  reconciliationHasStarted = false;
  const staleRecovery = store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reconciliationHasStarted, true);
  await reconciliationStarted;
  assert.deepEqual(await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_B,
  }), { ok: true });
  releaseReconciliation();
  assert.deepEqual(await staleRecovery, { status: 'not-saved', packId: null });
  assert.equal(activeHead().packId, 'pack-2', 'stale recovered alert evidence must not replace the prior head');
});

test('failed recovery reconciliation preserves storage and a claimed candidate is never released after head failure', async () => {
  let rejectReconciliation = false;
  let releaseCalls = 0;
  const created = harness({
    reconcileRecoveredArtifactBody: () => {
      if (rejectReconciliation) throw new Error('recovery ownership reconciliation failed');
    },
    releaseArtifactBody: () => { releaseCalls += 1; },
  });
  assert.deepEqual(await commit(created.store, 'previous-ready'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await commit(created.store, 'current-corrupt'), { ok: true, packId: 'pack-2' });
  const currentBodyKey = [...created.bodies.values.keys()].find((key) => key.includes('pack-2'));
  assert.ok(currentBodyKey);
  created.bodies.values.set(currentBodyKey, `${created.bodies.values.get(currentBodyKey)}tampered`);

  rejectReconciliation = true;
  const metadataBefore = [...created.metadata.values.entries()];
  const bodiesBefore = [...created.bodies.values.entries()];
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.deepEqual([...created.metadata.values.entries()], metadataBefore);
  assert.deepEqual([...created.bodies.values.entries()], bodiesBefore);
  assert.equal(releaseCalls, 0);

  rejectReconciliation = false;
  let failRecoveredHeadOnce = true;
  created.metadata.fail = (key) => {
    if (!key.includes(':head:') || !failRecoveredHeadOnce) return false;
    failRecoveredHeadOnce = false;
    return true;
  };
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'not-saved', packId: null },
  );
  created.metadata.fail = null;
  const head = [...created.metadata.values.entries()].find(([key]) => key.includes(':head:'));
  assert.ok(head);
  assert.equal(JSON.parse(head[1]).packId, 'pack-2', 'failed recovered publication restores the prior head');
  assert.equal(releaseCalls, 0, 'claimed recovered ownership must not be rolled back');
});

test('recovery keeps verified partial and expired current generations authoritative', async () => {
  const partialHarness = harness();
  assert.equal((await commit(partialHarness.store, 'previous-complete')).packId, 'pack-1');
  assert.equal((await commit(partialHarness.store, 'current-partial')).packId, 'pack-2');
  await rewriteActiveManifest(partialHarness.metadata, (manifest) => {
    manifest.receipts = manifest.receipts.filter(({ kind }) => kind !== 'alerts');
  });
  assert.deepEqual(
    await partialHarness.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'partial', packId: 'pack-2' },
  );

  const expiredHarness = harness();
  assert.equal((await commit(expiredHarness.store, 'previous-expiring')).packId, 'pack-1');
  assert.equal((await commit(expiredHarness.store, 'current-expiring')).packId, 'pack-2');
  assert.deepEqual(
    await expiredHarness.store.recoverActive({
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      now: NOW + 2 * 60 * 60_000,
    }),
    { status: 'expired', packId: 'pack-2' },
  );
});

test('active and detailed reads reject same-length body corruption before reporting readiness', async () => {
  const { bodies, store } = harness();
  assert.deepEqual(await commit(store, 'exact'), { ok: true, packId: 'pack-1' });
  const activeKey = [...bodies.values.keys()].find((key) => key.includes('pack-1'));
  assert.ok(activeKey);
  const original = bodies.values.get(activeKey);
  assert.ok(original);
  const replacement = original.startsWith('{') ? `[${original.slice(1)}` : `x${original.slice(1)}`;
  assert.equal(new TextEncoder().encode(replacement).byteLength, new TextEncoder().encode(original).byteLength);
  bodies.values.set(activeKey, replacement);

  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'corrupt', packId: null, reason: 'verification-failed' },
  );
  assert.equal(
    (await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })).status,
    'not-saved',
  );
});

test('active, detailed, and recovery reads fail closed on invalid external offline-map generations', async () => {
  let rejectMarker: string | null = null;
  let throwVerification = false;
  const verifiedBodies: string[] = [];
  const { store } = harness({
    verifyArtifactBody: (kind, body) => {
      if (kind === 'offline-map') verifiedBodies.push(body);
      if (kind === 'offline-map' && throwVerification) throw new Error('external verification failed');
      return Promise.resolve(kind !== 'offline-map' || rejectMarker === null || !body.includes(rejectMarker));
    },
  });
  assert.deepEqual(await commit(store, 'previous-map'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await commit(store, 'current-map'), { ok: true, packId: 'pack-2' });
  rejectMarker = 'current-map';
  verifiedBodies.length = 0;

  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'corrupt', packId: null, reason: 'verification-failed' },
  );
  assert.equal(
    (await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })).status,
    'not-saved',
  );
  assert.deepEqual(
    await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
  assert.equal(verifiedBodies.some((body) => body.includes('current-map')), true);
  assert.equal(verifiedBodies.some((body) => body.includes('previous-map')), true);
  rejectMarker = '-map';
  assert.deepEqual(
    await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'not-saved', packId: null },
  );
  rejectMarker = null;
  throwVerification = true;
  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'corrupt', packId: null, reason: 'verification-failed' },
  );
});

test('offline map consumers receive only the active profile-bound unexpired verified map artifact', async () => {
  const { bodies, store } = harness();
  const first = artifacts('first');
  const firstMap = first.find(({ kind }) => kind === 'offline-map');
  assert.ok(firstMap);
  firstMap.body = JSON.stringify({ marker: 'first-map', capturedAt: firstMap.capturedAt });
  assert.deepEqual(await store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: first,
  }), { ok: true, packId: 'pack-1' });
  const firstVerified = await store.readVerifiedOfflineMapArtifact({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  });
  assert.equal(firstVerified?.body, firstMap.body);
  assert.equal(firstVerified?.revision, store.readOfflineMapRevision({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  }));
  assert.equal(firstVerified?.expiresAt, firstMap.expiresAt);
  assert.equal(await store.readVerifiedOfflineMapArtifact({
    placeId: PLACE_ID, profileFingerprint: `${PROFILE}:moved`, now: NOW,
  }), null);
  assert.equal(await store.readVerifiedOfflineMapArtifact({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW + 2 * 60 * 60_000,
  }), null);

  const second = artifacts('second');
  const secondMap = second.find(({ kind }) => kind === 'offline-map');
  assert.ok(secondMap);
  secondMap.body = JSON.stringify({ marker: 'second-map', capturedAt: secondMap.capturedAt });
  assert.deepEqual(await store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: second,
  }), { ok: true, packId: 'pack-2' });
  const secondVerified = await store.readVerifiedOfflineMapArtifact({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  });
  assert.equal(secondVerified?.body, secondMap.body, 'the previous generation must never be selected');
  assert.notEqual(secondVerified?.revision, firstVerified?.revision, 'the active head revision must advance');

  const activeMapKey = [...bodies.values.keys()].find((key) => key.includes('pack-2:offline-map'));
  assert.ok(activeMapKey);
  bodies.values.set(activeMapKey, JSON.stringify({ marker: 'tampered-xx' }));
  assert.equal(await store.readVerifiedOfflineMapArtifact({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  }), null);
});

test('persisted domain watermarks invalidate stale receipts and later captures supersede them', async () => {
  const { metadata, bodies, store } = harness();
  assert.deepEqual(await commit(store, 'before-events'), { ok: true, packId: 'pack-1' });
  for (const [kinds, missing] of [
    [['route-primary', 'route-alternate'], ['route-primary']],
    [['comms-plan', 'contacts'], ['comms-plan', 'contacts']],
    [['lifelines'], ['lifelines']],
    [['alerts'], ['alerts']],
  ] as const) {
    assert.deepEqual(await store.invalidateArtifacts({
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      kinds,
      capturedAt: NOW,
      ...(kinds.includes('alerts') ? { sourceRevision: ALERT_REVISION_B } : {}),
    }), { ok: true });
    const readiness = await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
    assert.equal(readiness.status, 'partial');
    for (const kind of missing) assert.ok(readiness.missingKinds.includes(kind));
    assert.notEqual((await store.readActive({
      placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
    })).status, 'ready');
    assert.deepEqual(await store.recoverActive({
      placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
    }), { status: 'partial', packId: 'pack-1' });
  }
  assert.ok([...metadata.values.keys()].some((key) => key.includes(':invalidation:')));

  const later = createEmergencyPackStoreForClock(metadata, bodies, NOW + 1, 'pack-later');
  assert.deepEqual(await later.store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts('after-events', PLACE_ID, PROFILE, NOW + 1, ALERT_REVISION_B)
      .map((artifact) => ({ ...artifact, expiresAt: NOW + 2 * 60 * 60_000 })),
  }), { ok: true, packId: 'pack-later' });
  assert.equal((await later.store.readActive({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW + 1,
  })).status, 'ready');
});

test('an exact alert revision and monotonic sequence supersede invalidation without replay', async () => {
  const { metadata, bodies, store } = harness();
  const sourceCapturedAt = NOW - 5 * 60_000;
  assert.deepEqual(await store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts('alerts-before', PLACE_ID, PROFILE, sourceCapturedAt, ALERT_REVISION_A),
  }), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_B,
  }), { ok: true });
  assert.ok((await store.readReadiness({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  })).missingKinds.includes('alerts'));
  assert.deepEqual(await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW + 1,
    sourceRevision: ALERT_REVISION_A,
  }), { ok: true });
  assert.ok((await store.readReadiness({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  })).missingKinds.includes('alerts'), 'A→B→A must not replay the old sequence-zero A receipt');

  const later = createEmergencyPackStoreForClock(metadata, bodies, NOW + 2, 'pack-2');
  assert.deepEqual(await later.store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts('alerts-after', PLACE_ID, PROFILE, sourceCapturedAt, ALERT_REVISION_A)
      .map((artifact) => ({ ...artifact, expiresAt: NOW + 60 * 60_000 })),
  }), { ok: true, packId: 'pack-2' });
  assert.deepEqual(await later.store.readActive({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW + 2,
  }), { status: 'ready', packId: 'pack-2' });
  const readiness = await later.store.readReadiness({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW + 2,
  });
  assert.equal(readiness.receipts.find(({ kind }) => kind === 'alerts')?.alertSequence, 2);

  const persistedInvalidation = [...metadata.values.entries()]
    .find(([key]) => key.includes(':invalidation:'))?.[1];
  assert.ok(persistedInvalidation);
  assert.deepEqual(JSON.parse(persistedInvalidation).cutoffs, {});
  assert.equal(JSON.parse(persistedInvalidation).sourceRevision, ALERT_REVISION_A);
  assert.equal(JSON.parse(persistedInvalidation).alertSequence, 2);
});

test('startup alert reconciliation preserves matching active evidence and revokes a differing revision', async () => {
  const { metadata, store } = harness();
  assert.deepEqual(await commit(store, 'startup-alert-a'), { ok: true, packId: 'pack-1' });

  assert.deepEqual(await store.reconcileAlertRevision({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_A,
  }), { ok: true });
  assert.equal(
    [...metadata.values.keys()].some((key) => key.includes(':invalidate:')),
    false,
    'matching startup evidence must not manufacture an invalidation sequence',
  );
  assert.equal((await store.readReadiness({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    now: NOW,
  })).status, 'ready');

  assert.deepEqual(await store.reconcileAlertRevision({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_B,
  }), { ok: true });
  const readiness = await store.readReadiness({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    now: NOW,
  });
  assert.equal(readiness.status, 'partial');
  assert.ok(readiness.missingKinds.includes('alerts'));
});

test('alert invalidation is idempotent for one digest and fails closed at sequence exhaustion', async () => {
  const { metadata, store } = harness();
  const input = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'] as const,
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_A,
  };
  assert.deepEqual(await store.invalidateArtifacts(input), { ok: true });
  assert.deepEqual(await store.invalidateArtifacts({ ...input, capturedAt: NOW + 1 }), { ok: true });
  const invalidationKey = [...metadata.values.keys()].find((key) => key.includes(':invalidation:'));
  assert.ok(invalidationKey);
  const persisted = JSON.parse(metadata.values.get(invalidationKey) ?? 'null') as Record<string, unknown>;
  assert.equal(persisted.alertSequence, 1);

  persisted.alertSequence = Number.MAX_SAFE_INTEGER;
  metadata.values.set(invalidationKey, JSON.stringify(persisted));
  assert.equal((await store.invalidateArtifacts({
    ...input,
    capturedAt: NOW + 2,
    sourceRevision: ALERT_REVISION_B,
  })).ok, false);
  assert.equal(JSON.parse(metadata.values.get(invalidationKey) ?? 'null').alertSequence, Number.MAX_SAFE_INTEGER);
});

test('an alert revision change during manifest persistence prevents head publication', async () => {
  let injectRevisionChange = false;
  let metadata: MemoryMetadata;
  const repair = harness({
    digest: async (body) => {
      if (injectRevisionChange && body.includes('"packId":"pack-2"') && body.includes('"receipts"')) {
        injectRevisionChange = false;
        const key = [...metadata.values.keys()].find((item) => item.includes(':invalidation:'));
        assert.ok(key);
        const persisted = JSON.parse(metadata.values.get(key) ?? 'null') as Record<string, unknown>;
        persisted.sourceRevision = 'c'.repeat(64);
        persisted.alertSequence = 2;
        metadata.values.set(key, JSON.stringify(persisted));
      }
      return digest(body);
    },
  });
  metadata = repair.metadata;
  assert.deepEqual(await commit(repair.store, 'race-before'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await repair.store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_B,
  }), { ok: true });
  injectRevisionChange = true;
  const laterArtifacts = artifacts('race-after', PLACE_ID, PROFILE, NOW - 60_000, ALERT_REVISION_B)
    .map((artifact) => ({ ...artifact, expiresAt: NOW + 60 * 60_000 }));
  assert.equal((await repair.store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: laterArtifacts,
  })).ok, false);
  const head = [...metadata.values.entries()].find(([key]) => key.includes(':head:'));
  assert.ok(head);
  assert.equal(JSON.parse(head[1]).packId, 'pack-1');
});

test('alert invalidation and generation revisions fail closed when missing, malformed, or mismatched', async () => {
  const { store } = harness();
  for (const sourceRevision of [undefined, 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}z`]) {
    assert.equal((await store.invalidateArtifacts({
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      kinds: ['alerts'],
      capturedAt: NOW,
      ...(sourceRevision === undefined ? {} : { sourceRevision }),
    })).ok, false);
  }
  assert.equal((await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['lifelines'],
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_A,
  })).ok, false);

  const missingRevision = artifacts('missing-alert-revision');
  const missingAlert = missingRevision.find(({ kind }) => kind === 'alerts');
  assert.ok(missingAlert);
  delete missingAlert.sourceRevision;
  assert.equal((await store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: missingRevision,
  })).ok, false);

  const mismatchedRevision = artifacts('mismatched-alert-revision');
  const mismatchedAlert = mismatchedRevision.find(({ kind }) => kind === 'alerts');
  assert.ok(mismatchedAlert);
  mismatchedAlert.sourceRevision = ALERT_REVISION_B;
  assert.equal((await store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: mismatchedRevision,
  })).ok, false);
});

test('profile-scoped invalidations cannot resurrect stale alert evidence from another profile', async () => {
  const { metadata, store } = harness();
  assert.deepEqual(await commit(store, 'profile-a'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW,
    sourceRevision: ALERT_REVISION_B,
  }), { ok: true });
  assert.ok((await store.readReadiness({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  })).missingKinds.includes('alerts'));
  const movedProfile = `${PROFILE}:moved`;
  assert.deepEqual(await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: movedProfile,
    kinds: ['lifelines'],
    capturedAt: NOW + 1,
  }), { ok: true });
  assert.equal([...metadata.values.keys()].filter((key) => key.includes(':invalidation:')).length, 2);
  assert.ok((await store.readReadiness({
    placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW,
  })).missingKinds.includes('alerts'), 'another profile must not overwrite the original alert tombstone');
});

test('invalid or failed watermark persistence fails closed without changing historical bodies', async () => {
  const { metadata, bodies, store } = harness();
  assert.equal((await commit(store, 'immutable')).ok, true);
  const before = new Map(bodies.values);
  metadata.fail = (key) => key.includes(':invalidation:');
  assert.equal((await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['alerts'],
    capturedAt: NOW,
  })).ok, false);
  metadata.fail = null;
  assert.deepEqual(bodies.values, before);
  assert.equal((await store.invalidateArtifacts({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    kinds: ['not-a-kind'],
    capturedAt: NOW,
  })).ok, false);
});

test('failed offline-map staging and publication release only the staged external generation', async () => {
  const verificationReleases: string[] = [];
  const verificationHarness = harness({
    verifyArtifactBody: (kind) => Promise.resolve(kind !== 'offline-map'),
    releaseArtifactBody: (kind, body) => {
      if (kind === 'offline-map') verificationReleases.push(body);
      return Promise.resolve();
    },
  });
  assert.equal((await commit(verificationHarness.store, 'rejected-map')).ok, false);
  assert.deepEqual(verificationReleases.map((body) => JSON.parse(body).marker), ['rejected-map']);
  assert.equal(verificationHarness.bodies.values.size, 0);

  const publicationReleases: string[] = [];
  const publicationHarness = harness({
    releaseArtifactBody: (kind, body) => {
      if (kind === 'offline-map') publicationReleases.push(body);
      return Promise.resolve();
    },
  });
  publicationHarness.metadata.fail = (key) => key.includes(':head:');
  assert.equal((await commit(publicationHarness.store, 'unpublished-map')).ok, false);
  publicationHarness.metadata.fail = null;
  assert.deepEqual(publicationReleases.map((body) => JSON.parse(body).marker), ['unpublished-map']);
  assert.deepEqual(
    await publicationHarness.store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'not-saved', packId: null },
  );
});

test('old-generation cleanup and pruning release removed maps but retain active and previous maps', async () => {
  const oldGenerationReleases: string[] = [];
  const oldHarness = harness({
    releaseArtifactBody: (kind, body) => {
      if (kind === 'offline-map') oldGenerationReleases.push(body);
      return Promise.resolve();
    },
  });
  assert.equal((await commit(oldHarness.store, 'old-map')).ok, true);
  assert.equal((await commit(oldHarness.store, 'previous-map')).ok, true);
  assert.equal((await commit(oldHarness.store, 'active-map')).ok, true);
  assert.deepEqual(oldGenerationReleases.map((body) => JSON.parse(body).marker), ['old-map']);

  const pruneReleases: string[] = [];
  const pruneHarness = harness({
    releaseArtifactBody: (kind, body) => {
      if (kind === 'offline-map') pruneReleases.push(body);
      return Promise.resolve();
    },
  });
  const placeIds = Array.from({ length: 6 }, (_, index) => `map-place-${index + 1}`);
  for (const placeId of placeIds) {
    assert.equal((await commitScope(pruneHarness.store, placeId, `profile:${placeId}`, placeId)).ok, true);
  }
  pruneReleases.length = 0;
  await pruneHarness.store.prune({ placeIds, maxPlaces: 5, generationsPerPlace: 2 });
  assert.deepEqual(pruneReleases.map((body) => JSON.parse(body).marker), [placeIds[5]]);
  for (const placeId of placeIds.slice(0, 5)) {
    assert.equal(
      (await pruneHarness.store.readActive({ placeId, profileFingerprint: `profile:${placeId}`, now: NOW })).status,
      'ready',
    );
  }
});

test('release failures cannot report a failed publication as success or revoke the verified head', async () => {
  const { metadata, store } = harness({
    releaseArtifactBody: () => Promise.reject(new Error('external release failed')),
  });
  assert.deepEqual(await commit(store, 'verified-head'), { ok: true, packId: 'pack-1' });
  metadata.fail = (key) => key.includes(':head:');
  assert.equal((await commit(store, 'failed-candidate')).ok, false);
  metadata.fail = null;
  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
});

test('tombstone persistence failure retains the generation manifest and body for a later safe release', async () => {
  const { metadata, bodies, store } = harness({
    releaseArtifactBody: (kind) => kind === 'offline-map'
      ? Promise.reject(new Error('cleanup tombstone write failed'))
      : Promise.resolve(),
  });
  assert.equal((await commit(store, 'first')).ok, true);
  assert.equal((await commit(store, 'second')).ok, true);
  const firstManifestKey = [...metadata.values.keys()].find((key) => key.includes(':manifest:') && key.endsWith(':pack-1'));
  const firstMapBodyKey = [...bodies.values.keys()].find((key) => key.endsWith('pack-1:offline-map'));
  assert.ok(firstManifestKey);
  assert.ok(firstMapBodyKey);

  assert.equal((await commit(store, 'third')).ok, true);

  assert.equal(metadata.values.has(firstManifestKey), true, 'manifest ownership is retained without a durable tombstone');
  assert.equal(bodies.values.has(firstMapBodyKey), true, 'map artifact body is retained without a durable tombstone');
});

for (const retainedKind of ['lifelines', 'contacts'] as const) {
  for (const failure of ['retained', 'error'] as const) {
    test(`cleanup retains generation metadata when ${retainedKind} deletion is ${failure}`, async () => {
      const created = harness({
        async deleteBody(key, deleteDefault) {
          if (key.endsWith(`pack-1:${retainedKind}`)) {
            if (failure === 'error') throw new Error('cache deletion unavailable');
            return false;
          }
          return deleteDefault();
        },
      });
      assert.equal((await commit(created.store, 'first')).ok, true);
      assert.equal((await commit(created.store, 'second')).ok, true);
      const manifestKey = [...created.metadata.values.keys()]
        .find((key) => key.includes(':manifest:') && key.endsWith(':pack-1'));
      const bodyKey = [...created.bodies.values.keys()]
        .find((key) => key.endsWith(`pack-1:${retainedKind}`));
      assert.ok(manifestKey);
      assert.ok(bodyKey);

      assert.equal((await commit(created.store, 'third')).ok, true);

      assert.equal(created.metadata.values.has(manifestKey), true, 'manifest keeps ownership metadata');
      assert.equal(created.bodies.values.has(bodyKey), true, 'unconfirmed body remains owned by the manifest');
      const mapKey = [...created.bodies.values.keys()].find((key) => key.endsWith('pack-1:offline-map'));
      assert.equal(
        mapKey !== undefined,
        retainedKind === 'lifelines',
        'cleanup stops before an early failure and preserves metadata after a late failure',
      );
    });
  }
}

test('cleanup retry removes retained private contacts before their ownership manifest', async () => {
  let retainContacts = true;
  const created = harness({
    async deleteBody(key, deleteDefault) {
      if (retainContacts && key.endsWith('pack-1:contacts')) return false;
      return deleteDefault();
    },
  });
  assert.equal((await commit(created.store, 'first')).ok, true);
  assert.equal((await commit(created.store, 'second')).ok, true);
  const manifestKey = [...created.metadata.values.keys()]
    .find((key) => key.includes(':manifest:') && key.endsWith(':pack-1'));
  const contactsKey = [...created.bodies.values.keys()].find((key) => key.endsWith('pack-1:contacts'));
  assert.ok(manifestKey);
  assert.ok(contactsKey);

  assert.equal((await commit(created.store, 'third')).ok, true);
  assert.equal(created.metadata.values.has(manifestKey), true);
  assert.equal(created.bodies.values.has(contactsKey), true);

  retainContacts = false;
  const retryStart = created.operations.length;
  assert.equal((await commit(created.store, 'fourth')).ok, true);
  assert.equal(created.bodies.values.has(contactsKey), false);
  assert.equal(created.metadata.values.has(manifestKey), false);
  const retryOperations = created.operations.slice(retryStart);
  const bodyDelete = retryOperations.findIndex((entry) => entry === `body:delete:${contactsKey}`);
  const manifestRemove = retryOperations.findIndex((entry) => entry === `metadata:remove:${manifestKey}`);
  assert.ok(bodyDelete >= 0 && manifestRemove > bodyDelete, 'private body is gone before ownership metadata');
});

test('cleanup treats an already absent offline-map body as an idempotent retry', async () => {
  const created = harness();
  assert.equal((await commit(created.store, 'first')).ok, true);
  assert.equal((await commit(created.store, 'second')).ok, true);
  const manifestKey = [...created.metadata.values.keys()]
    .find((key) => key.includes(':manifest:') && key.endsWith(':pack-1'));
  const mapKey = [...created.bodies.values.keys()].find((key) => key.endsWith('pack-1:offline-map'));
  assert.ok(manifestKey);
  assert.ok(mapKey);
  created.bodies.values.delete(mapKey);

  assert.equal((await commit(created.store, 'third')).ok, true);

  assert.equal(created.metadata.values.has(manifestKey), false);
  assert.equal(
    [...created.bodies.values.keys()].some((key) => key.includes('pack-1:')),
    false,
    'ordinary body cleanup completes when one body is already absent',
  );
});

test('v1 Lifelines migration publishes one verified partial v2 generation without replacing a valid v2 head', async () => {
  const { metadata, bodies, operations, store } = harness();
  const input = legacyMigrationInput();
  const migrated = await store.migrateLifelineGeneration(input);
  assert.deepEqual(migrated, { ok: true, packId: 'pack-1' });
  const publicationOperations = [...operations];
  const readiness = await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
  assert.equal(readiness.status, 'partial');
  assert.deepEqual(readiness.receipts.map(({ kind }) => kind), ['lifelines']);
  assert.deepEqual(readiness.missingKinds, REQUIRED_KINDS.filter((kind) => kind !== 'lifelines'));
  const lifelinesReceipt = readiness.receipts[0];
  assert.ok(lifelinesReceipt);
  assert.equal(lifelinesReceipt.cacheKey, 'wm-emergency-pack-v2:body:pack-1:lifelines');
  assert.equal(lifelinesReceipt.sha256, await digest(input.artifact.body));
  assert.equal(bodies.values.get(lifelinesReceipt.cacheKey), input.artifact.body);
  const encodedManifest = [...metadata.values.entries()].find(([key]) => key.includes(':manifest:'))?.[1];
  assert.ok(encodedManifest);
  assert.equal(JSON.parse(encodedManifest).migration.source, 'lifeline-pack-v1');
  const lastBodyRead = Math.max(...publicationOperations
    .map((entry, index) => entry.startsWith('body:get:') ? index : -1));
  const manifestWrite = publicationOperations
    .findIndex((entry) => entry.includes('metadata:set:') && entry.includes(':manifest:'));
  const headWrite = publicationOperations
    .findIndex((entry) => entry.includes('metadata:set:') && entry.includes(':head:'));
  assert.ok(lastBodyRead >= 0 && manifestWrite > lastBodyRead, 'migration manifest follows exact body readback');
  assert.ok(headWrite > manifestWrite, 'migration head is published last');

  const replacementBody = JSON.parse(input.artifact.body) as Record<string, unknown>;
  replacementBody.marker = 'replacement';
  const replacement = await store.migrateLifelineGeneration({
    ...input,
    artifact: { ...input.artifact, body: JSON.stringify(replacementBody) },
  });
  assert.deepEqual(replacement, { ok: false, reason: 'active-v2-exists' });
  assert.equal((await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })).packId, 'pack-1');
});

test('v1 migration fails closed across staging and publication failures', async () => {
  for (const failure of ['quota', 'readback', 'manifest', 'head'] as const) {
    const { metadata, bodies, operations, store } = harness();
    if (failure === 'quota') bodies.failPut = true;
    if (failure === 'readback') bodies.alterReadback = true;
    if (failure === 'manifest') metadata.fail = (key) => key.includes('manifest');
    if (failure === 'head') metadata.fail = (key) => key.includes('head');

    assert.equal((await store.migrateLifelineGeneration(legacyMigrationInput())).ok, false, failure);
    bodies.failPut = false;
    bodies.alterReadback = false;
    metadata.fail = null;
    assert.deepEqual(
      await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'not-saved', packId: null },
      failure,
    );
    assert.equal([...metadata.values.keys()].some((key) => key.includes(':head:')), false, failure);
    assert.equal(operations.filter((entry) => entry.includes('metadata:set:') && entry.includes(':head:')).length <= 1, true);
  }
});

test('v1 migration rejects invalid legacy evidence and never replaces a valid v2 head for the place', async () => {
  const invalidHarness = harness();
  const invalid = legacyMigrationInput();
  invalid.legacyManifest = { ...invalid.legacyManifest, queryFingerprint: 'wrong-legacy-query' };
  assert.deepEqual(
    await invalidHarness.store.migrateLifelineGeneration(invalid),
    { ok: false, reason: 'invalid-legacy-pack' },
  );
  assert.equal([...invalidHarness.metadata.values.keys()].some((key) => key.includes(':head:')), false);
  assert.equal(invalidHarness.bodies.values.size, 0);

  const existingHarness = harness();
  assert.deepEqual(await commit(existingHarness.store, 'existing-v2'), { ok: true, packId: 'pack-1' });
  const moved = legacyMigrationInput(`${PROFILE}:moved`);
  assert.deepEqual(
    await existingHarness.store.migrateLifelineGeneration(moved),
    { ok: false, reason: 'active-v2-exists' },
  );
  assert.deepEqual(
    await existingHarness.store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
});

test('an unreferenced manifest left by a crash cannot displace the last-known-good head', async () => {
  const { metadata, store } = harness();
  assert.equal((await commit(store, 'good')).packId, 'pack-1');
  metadata.fail = (key) => key.includes('head');
  assert.equal((await commit(store, 'crash-before-head')).ok, false);
  metadata.fail = null;

  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
});

test('a place move cannot read the prior profile even when the place id is unchanged', async () => {
  const { store } = harness();
  await commit(store, 'good');
  assert.deepEqual(
    await store.readActive({ placeId: PLACE_ID, profileFingerprint: `${PROFILE}:moved`, now: NOW }),
    { status: 'not-saved', packId: null, reason: 'profile-fingerprint-mismatch' },
  );
});

test('detailed readiness returns exact re-hashed receipts and fails closed after a place move', async () => {
  const { metadata, operations, store } = harness();
  assert.deepEqual(await commit(store, 'verified-details'), { ok: true, packId: 'pack-1' });
  const encodedManifest = [...metadata.values.entries()]
    .find(([key]) => key.includes(':manifest:'))?.[1];
  assert.ok(encodedManifest);
  const manifest = JSON.parse(encodedManifest) as {
    profileFingerprint: string;
    requiredKinds: string[];
    optionalKinds: string[];
    receipts: ReceiptFixture[];
  };

  operations.length = 0;
  assert.equal(typeof store.readReadiness, 'function', 'readReadiness should be implemented');
  assert.deepEqual(
    await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    {
      status: 'ready',
      packId: 'pack-1',
      profileFingerprint: manifest.profileFingerprint,
      requiredKinds: manifest.requiredKinds,
      optionalKinds: manifest.optionalKinds,
      receipts: manifest.receipts,
      missingKinds: [],
      expiredKinds: [],
    },
  );
  assert.deepEqual(
    new Set(operations.filter((entry) => entry.startsWith('body:get:')).map((entry) => entry.slice('body:get:'.length))),
    new Set(manifest.receipts.map(({ cacheKey }) => cacheKey)),
    'every returned receipt must be backed by an exact body readback',
  );

  const movedProfile = `${PROFILE}:moved`;
  assert.deepEqual(
    await store.readReadiness({ placeId: PLACE_ID, profileFingerprint: movedProfile, now: NOW }),
    {
      status: 'not-saved',
      packId: null,
      profileFingerprint: movedProfile,
      requiredKinds: [...REQUIRED_KINDS],
      optionalKinds: ['route-alternate'],
      receipts: [],
      missingKinds: [...REQUIRED_KINDS],
      expiredKinds: [],
      reason: 'profile-fingerprint-mismatch',
    },
  );
});

test('pruning keeps only five allowed place heads and each active plus previous generation', async () => {
  const { metadata, bodies, store } = harness();
  const placeIds = Array.from({ length: 6 }, (_, index) => `place-${index + 1}`);
  const profileFor = (placeId: string) => `profile:${placeId}`;

  for (const placeId of placeIds) {
    for (let generation = 1; generation <= 3; generation += 1) {
      assert.equal(
        (await commitScope(store, placeId, profileFor(placeId), `${placeId}-${generation}`)).ok,
        true,
      );
    }
  }

  assert.equal(typeof store.prune, 'function', 'prune should be implemented');
  await store.prune({ placeIds, maxPlaces: 5, generationsPerPlace: 2 });

  const heads = [...metadata.values.entries()]
    .filter(([key]) => key.includes(':head:'))
    .map(([, value]) => JSON.parse(value) as { packId: string; placeId: string; previousPackId: string | null });
  const retainedPlaceIds = placeIds.slice(0, 5);
  assert.deepEqual(heads.map(({ placeId }) => placeId).sort(), [...retainedPlaceIds].sort());

  const manifests = [...metadata.values.entries()]
    .filter(([key]) => key.includes(':manifest:'))
    .map(([, value]) => JSON.parse(value) as {
      packId: string;
      placeId: string;
      receipts: Array<{ cacheKey: string }>;
    });
  const expectedBodyKeys = new Set<string>();
  for (const placeId of retainedPlaceIds) {
    const head = heads.find((candidate) => candidate.placeId === placeId);
    assert.ok(head);
    const retained = manifests.filter((candidate) => candidate.placeId === placeId);
    assert.equal(retained.length, 2, `${placeId} should retain only active and previous manifests`);
    assert.deepEqual(
      retained.map(({ packId }) => packId).sort(),
      [head.packId, head.previousPackId].filter((packId): packId is string => packId !== null).sort(),
    );
    for (const manifest of retained) {
      for (const { cacheKey } of manifest.receipts) {
        expectedBodyKeys.add(cacheKey);
        assert.equal(bodies.values.has(cacheKey), true, `${cacheKey} must remain readable`);
      }
    }
    assert.equal(
      (await store.readActive({ placeId, profileFingerprint: profileFor(placeId), now: NOW })).status,
      'ready',
    );
  }

  assert.equal(manifests.some(({ placeId }) => placeId === placeIds[5]), false);
  assert.deepEqual([...bodies.values.keys()].sort(), [...expectedBodyKeys].sort());
});
