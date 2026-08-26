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
    bodies: MemoryBodies;
    digest: typeof digest;
    now: () => number;
    createPackId: () => string;
  }) => {
    commitGeneration: (input: {
      placeId: string;
      profileFingerprint: string;
      requiredKinds: readonly string[];
      optionalKinds: readonly string[];
      artifacts: Array<{
        kind: string;
        body: string;
        expiresAt: number;
        semanticState: string;
        summary: string;
        itemCount: number;
      }>;
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

function artifacts(marker: string, placeId = PLACE_ID, profileFingerprint = PROFILE) {
  return REQUIRED_KINDS.map((kind) => ({
    kind,
    body: JSON.stringify({ marker, kind, placeId, profileFingerprint }),
    expiresAt: NOW + 60 * 60_000,
    semanticState: 'verified',
    summary: `${kind} captured`,
    itemCount: 1,
  }));
}

function harness() {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  let nextId = 1;
  const create = requireFunction(api, 'createEmergencyPackStore');
  const store = create({ metadata, bodies, digest, now: () => NOW, createPackId: () => `pack-${nextId++}` });
  return { metadata, bodies, operations, store };
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
