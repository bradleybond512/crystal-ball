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
    recoverActive: (scope: { placeId: string; profileFingerprint: string; now: number }) => Promise<{
      status: string;
      packId: string | null;
    }>;
  };
}

const api = await import('../emergency-pack-store.ts').catch(() => ({} as StoreApi)) as StoreApi;

function artifacts(marker: string) {
  return REQUIRED_KINDS.map((kind) => ({
    kind,
    body: JSON.stringify({ marker, kind, placeId: PLACE_ID, profileFingerprint: PROFILE }),
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
  return store.commitGeneration({
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts(marker),
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
