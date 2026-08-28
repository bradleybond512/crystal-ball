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
    recoverReadiness: (scope: { placeId: string; profileFingerprint: string; now: number }) => Promise<{
      status: string;
      packId: string | null;
      reason?: string;
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function pausingBodyBoundary(
  bodies: MemoryBodies,
  options: { failAfterRelease?: boolean } = {},
) {
  const entered = deferred();
  const release = deferred();
  let paused = false;
  return {
    entered: entered.promise,
    release: release.resolve,
    boundary: {
      async put(key: string, body: string) {
        if (!paused) {
          paused = true;
          entered.resolve();
          await release.promise;
          if (options.failAfterRelease) throw new Error('quota exceeded');
        }
        await bodies.put(key, body);
      },
      get: (key: string) => bodies.get(key),
      async delete(key: string) {
        await bodies.delete(key);
        return true;
      },
    },
  };
}

function sharedStore(
  metadata: MemoryMetadata,
  bodies: {
    put(key: string, body: string): Promise<void>;
    get(key: string): Promise<string | null>;
    delete(key: string): Promise<boolean>;
  },
  packId: string,
) {
  return requireFunction(api, 'createEmergencyPackStore')({
    metadata,
    bodies,
    digest,
    now: () => NOW,
    createPackId: () => packId,
  });
}

async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
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

const STAGING_PREFIX = 'wm-emergency-pack-v2:staging:';

test('two store instances serialize migrations while the first owns a pre-body journal', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const paused = pausingBodyBoundary(bodies);
  const writer = sharedStore(metadata, paused.boundary, 'pack-writer');
  const follower = sharedStore(metadata, paused.boundary, 'pack-follower');
  const writerResult = writer.migrateLifelineGeneration(legacyMigrationInput());
  await paused.entered;
  const writerJournal = `${STAGING_PREFIX}pack-writer`;
  assert.equal(metadata.values.has(writerJournal), true);
  let followerSettled = false;
  const followerResult = follower.migrateLifelineGeneration(legacyMigrationInput())
    .finally(() => { followerSettled = true; });
  let assertionError: unknown;
  try {
    await drainMicrotasks();
    assert.equal(followerSettled, false, 'second migration must wait for journal ownership transfer');
    assert.equal(metadata.values.has(writerJournal), true, 'queued migration cannot reconcile writer ownership');
    assert.equal(
      operations.some((entry) => entry === `metadata:remove:${writerJournal}`),
      false,
      'queued migration cannot delete the writer journal',
    );
  } catch (error) {
    assertionError = error;
  } finally {
    paused.release();
  }
  const [published, queued] = await Promise.all([writerResult, followerResult]);
  if (assertionError) throw assertionError;
  assert.deepEqual(published, { ok: true, packId: 'pack-writer' });
  assert.deepEqual(queued, { ok: false, reason: 'active-v2-exists' });
});

test('commit and migration share one FIFO transaction across store instances', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const paused = pausingBodyBoundary(bodies);
  const writer = sharedStore(metadata, paused.boundary, 'pack-commit');
  const follower = sharedStore(metadata, paused.boundary, 'pack-migration');
  const writerResult = commit(writer, 'paused-commit');
  await paused.entered;
  let followerSettled = false;
  const followerResult = follower.migrateLifelineGeneration(legacyMigrationInput())
    .finally(() => { followerSettled = true; });
  let assertionError: unknown;
  try {
    await drainMicrotasks();
    assert.equal(followerSettled, false, 'migration must queue behind a committing store instance');
    assert.equal(metadata.values.has(`${STAGING_PREFIX}pack-commit`), true);
  } catch (error) {
    assertionError = error;
  } finally {
    paused.release();
  }
  const [published, queued] = await Promise.all([writerResult, followerResult]);
  if (assertionError) throw assertionError;
  assert.deepEqual(published, { ok: true, packId: 'pack-commit' });
  assert.deepEqual(queued, { ok: false, reason: 'active-v2-exists' });
});

test('locked recovery waits for a paused writer while readActive keeps the old head available', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const initial = sharedStore(metadata, {
    put: (key, body) => bodies.put(key, body),
    get: (key) => bodies.get(key),
    async delete(key) {
      await bodies.delete(key);
      return true;
    },
  }, 'pack-old');
  assert.deepEqual(await commit(initial, 'old-head'), { ok: true, packId: 'pack-old' });

  const paused = pausingBodyBoundary(bodies);
  const writer = sharedStore(metadata, paused.boundary, 'pack-new');
  const reader = sharedStore(metadata, paused.boundary, 'pack-reader');
  const writerResult = commit(writer, 'new-head');
  await paused.entered;
  let activeRecoverySettled = false;
  let readinessRecoverySettled = false;
  const activeRecovery = reader.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })
    .finally(() => { activeRecoverySettled = true; });
  const readinessRecovery = reader.recoverReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })
    .finally(() => { readinessRecoverySettled = true; });
  let assertionError: unknown;
  try {
    assert.deepEqual(
      await reader.readActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'ready', packId: 'pack-old' },
      'ordinary reads remain available from the last-known-good head',
    );
    await drainMicrotasks();
    assert.equal(activeRecoverySettled, false);
    assert.equal(readinessRecoverySettled, false);
    assert.equal(metadata.values.has(`${STAGING_PREFIX}pack-new`), true);
  } catch (error) {
    assertionError = error;
  } finally {
    paused.release();
  }
  const [published, recoveredActive, recoveredReadiness] = await Promise.all([
    writerResult,
    activeRecovery,
    readinessRecovery,
  ]);
  if (assertionError) throw assertionError;
  assert.deepEqual(published, { ok: true, packId: 'pack-new' });
  assert.deepEqual(recoveredActive, { status: 'ready', packId: 'pack-new' });
  assert.equal(recoveredReadiness.packId, 'pack-new');
});

test('prune queues behind a paused writer and cannot remove the old head mid-transaction', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const initial = sharedStore(metadata, {
    put: (key, body) => bodies.put(key, body),
    get: (key) => bodies.get(key),
    async delete(key) {
      await bodies.delete(key);
      return true;
    },
  }, 'pack-old');
  assert.deepEqual(await commit(initial, 'old-head'), { ok: true, packId: 'pack-old' });
  const head = [...metadata.values.keys()].find((key) => key.includes(':head:'));
  assert.ok(head);

  const paused = pausingBodyBoundary(bodies);
  const writer = sharedStore(metadata, paused.boundary, 'pack-new');
  const pruner = sharedStore(metadata, paused.boundary, 'pack-pruner');
  const writerResult = commit(writer, 'new-head');
  await paused.entered;
  let pruneSettled = false;
  const pruneResult = pruner.prune({ placeIds: [], maxPlaces: 5, generationsPerPlace: 2 })
    .finally(() => { pruneSettled = true; });
  let assertionError: unknown;
  try {
    await drainMicrotasks();
    assert.equal(pruneSettled, false);
    assert.equal(metadata.values.has(head), true, 'queued prune cannot remove the last-known-good head');
    assert.equal(metadata.values.has(`${STAGING_PREFIX}pack-new`), true);
  } catch (error) {
    assertionError = error;
  } finally {
    paused.release();
  }
  await Promise.all([writerResult, pruneResult]);
  if (assertionError) throw assertionError;
  assert.equal(metadata.values.has(head), false, 'prune executes after the writer releases the queue');
});

test('a failed writer releases the FIFO queue so the next recovery completes', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const initial = sharedStore(metadata, {
    put: (key, body) => bodies.put(key, body),
    get: (key) => bodies.get(key),
    async delete(key) {
      await bodies.delete(key);
      return true;
    },
  }, 'pack-old');
  assert.deepEqual(await commit(initial, 'old-head'), { ok: true, packId: 'pack-old' });

  const paused = pausingBodyBoundary(bodies, { failAfterRelease: true });
  const writer = sharedStore(metadata, paused.boundary, 'pack-failed');
  const reader = sharedStore(metadata, paused.boundary, 'pack-reader');
  const writerResult = commit(writer, 'failed-writer');
  await paused.entered;
  let recoverySettled = false;
  const recoveryResult = reader.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW })
    .finally(() => { recoverySettled = true; });
  await drainMicrotasks();
  const settledBeforeRelease = recoverySettled;
  const journalRetainedBeforeRelease = metadata.values.has(`${STAGING_PREFIX}pack-failed`);
  paused.release();

  assert.equal(settledBeforeRelease, false, 'recovery remains FIFO-queued behind the failing writer');
  assert.equal(journalRetainedBeforeRelease, true, 'queued recovery cannot reconcile the failing writer early');
  assert.deepEqual(await writerResult, { ok: false, reason: 'storage-quota' });
  assert.deepEqual(await recoveryResult, { status: 'ready', packId: 'pack-old' });
});

test('oversized but otherwise valid journal text is retained before parsing or cleanup', async () => {
  const created = harness();
  assert.deepEqual(await commit(created.store, 'old-head'), { ok: true, packId: 'pack-1' });
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'oversized', 'pack-oversized', ['contacts']);
  const encoded = created.metadata.values.get(staged.journalKey);
  assert.ok(encoded);
  created.metadata.values.set(staged.journalKey, `${encoded}${' '.repeat(64 * 1024)}`);
  const bodiesBefore = new Map(created.bodies.values);

  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.equal(created.metadata.values.has(staged.journalKey), true);
  assert.deepEqual(created.bodies.values, bodiesBefore);
});

async function seedStagingJournal(
  metadata: MemoryMetadata,
  bodies: MemoryBodies,
  marker: string,
  packId: string,
  kinds: readonly string[] = REQUIRED_KINDS,
  storedBodyCount = kinds.length,
): Promise<{ journalKey: string; manifestKey: string; bodyKeys: string[] }> {
  const stagedArtifacts = artifacts(marker).filter(({ kind }) => kinds.includes(kind));
  const bodyEntries = await Promise.all(stagedArtifacts.map(async (artifact) => ({
    kind: artifact.kind,
    cacheKey: `wm-emergency-pack-v2:body:${encodeURIComponent(packId)}:${artifact.kind}`,
    sha256: await digest(artifact.body),
    body: artifact.body,
  })));
  for (const entry of bodyEntries.slice(0, storedBodyCount)) bodies.values.set(entry.cacheKey, entry.body);
  const key = `${STAGING_PREFIX}${encodeURIComponent(packId)}`;
  const candidateManifestKey = `wm-emergency-pack-v2:manifest:${encodeURIComponent(PLACE_ID)}:${encodeURIComponent(packId)}`;
  metadata.values.set(key, JSON.stringify({
    schemaVersion: 1,
    packId,
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    manifestKey: candidateManifestKey,
    artifacts: bodyEntries.map(({ body: _body, ...entry }) => entry),
  }));
  metadata.values.set(candidateManifestKey, JSON.stringify({ unpublished: packId }));
  return {
    journalKey: key,
    manifestKey: candidateManifestKey,
    bodyKeys: bodyEntries.map(({ cacheKey }) => cacheKey),
  };
}

type StagingJournal = {
  schemaVersion: unknown;
  packId: unknown;
  placeId: unknown;
  profileFingerprint: unknown;
  manifestKey: unknown;
  artifacts: unknown;
  [key: string]: unknown;
};

function readStagingJournal(metadata: MemoryMetadata, key: string): StagingJournal {
  const encoded = metadata.values.get(key);
  assert.ok(encoded);
  return JSON.parse(encoded) as StagingJournal;
}

function writeStagingJournal(metadata: MemoryMetadata, key: string, journal: unknown): void {
  metadata.values.set(key, JSON.stringify(journal));
}

async function assertStagingJournalRejected(
  created: ReturnType<typeof harness>,
  staged: Awaited<ReturnType<typeof seedStagingJournal>>,
  message: string,
): Promise<void> {
  const bodiesBefore = new Map(created.bodies.values);
  const manifestBefore = created.metadata.values.get(staged.manifestKey);
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
    message,
  );
  assert.equal(created.metadata.values.has(staged.journalKey), true, `${message}: journal retained`);
  assert.equal(created.metadata.values.get(staged.manifestKey), manifestBefore, `${message}: manifest retained`);
  assert.deepEqual(created.bodies.values, bodiesBefore, `${message}: bodies retained`);
}

async function seedCustomStagingJournal(
  created: ReturnType<typeof harness>,
  values: { packId: string; placeId: string; profileFingerprint: string },
) {
  const kind = 'contacts';
  const body = JSON.stringify({ marker: 'strict-journal', kind });
  const journalKey = `${STAGING_PREFIX}${encodeURIComponent(values.packId)}`;
  const candidateManifestKey = `wm-emergency-pack-v2:manifest:${encodeURIComponent(values.placeId)}:${encodeURIComponent(values.packId)}`;
  const cacheKey = `wm-emergency-pack-v2:body:${encodeURIComponent(values.packId)}:${kind}`;
  created.bodies.values.set(cacheKey, body);
  created.metadata.values.set(candidateManifestKey, JSON.stringify({ unpublished: values.packId }));
  writeStagingJournal(created.metadata, journalKey, {
    schemaVersion: 1,
    ...values,
    manifestKey: candidateManifestKey,
    artifacts: [{ kind, cacheKey, sha256: await digest(body) }],
  });
  return { journalKey, manifestKey: candidateManifestKey, bodyKeys: [cacheKey] };
}

test('staging journal enforces its 64 KiB UTF-8 byte cap before parsing', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'utf8-cap', 'pack-utf8', ['contacts']);
  const valid = created.metadata.values.get(staged.journalKey);
  assert.ok(valid);
  const encoded = `{"placeId":"${'😀'.repeat(17_000)}",${valid.slice(1)}`;
  assert.ok(encoded.length <= 64 * 1024, 'fixture stays within the UTF-16 fast-path bound');
  assert.ok(new TextEncoder().encode(encoded).byteLength > 64 * 1024, 'fixture exceeds the UTF-8 byte bound');
  created.metadata.values.set(staged.journalKey, encoded);

  await assertStagingJournalRejected(created, staged, 'UTF-8 byte cap');
});

test('staging recovery rejects more than sixteen journals before deleting any ownership evidence', async () => {
  const created = harness();
  const staged = await Promise.all(Array.from({ length: 17 }, (_, index) => (
    seedStagingJournal(created.metadata, created.bodies, `journal-${index}`, `pack-${index}`, ['contacts'])
  )));
  const bodiesBefore = new Map(created.bodies.values);

  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.equal(staged.every(({ journalKey }) => created.metadata.values.has(journalKey)), true);
  assert.deepEqual(created.bodies.values, bodiesBefore);
});

for (const [label, value] of [['null', null], ['array', []]] as const) {
  test(`staging journal rejects a ${label} top-level value`, async () => {
    const created = harness();
    const staged = await seedStagingJournal(created.metadata, created.bodies, label, `pack-${label}`, ['contacts']);
    writeStagingJournal(created.metadata, staged.journalKey, value);

    await assertStagingJournalRejected(created, staged, `top-level ${label}`);
  });
}

test('staging journal rejects unknown top-level fields', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'extra-field', 'pack-extra', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  journal.privateBody = 'must-not-be-accepted';
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'exact top-level fields');
});

test('staging journal accepts only schema version one', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'schema', 'pack-schema', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  journal.schemaVersion = 2;
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'schema version');
});

test('staging journal pack id must canonically match its metadata key', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'canonical-key', 'pack-canonical', ['contacts']);
  const noncanonicalKey = `${STAGING_PREFIX}different-pack`;
  created.metadata.values.set(noncanonicalKey, created.metadata.values.get(staged.journalKey)!);
  created.metadata.values.delete(staged.journalKey);
  const moved = { ...staged, journalKey: noncanonicalKey };

  await assertStagingJournalRejected(created, moved, 'canonical staging key');
});

for (const [label, values] of [
  ['empty pack id', { packId: '', placeId: PLACE_ID, profileFingerprint: PROFILE }],
  ['oversized pack id', { packId: 'p'.repeat(513), placeId: PLACE_ID, profileFingerprint: PROFILE }],
  ['empty place id', { packId: 'pack-empty-place', placeId: '', profileFingerprint: PROFILE }],
  ['oversized place id', { packId: 'pack-long-place', placeId: 'p'.repeat(513), profileFingerprint: PROFILE }],
  ['empty profile fingerprint', { packId: 'pack-empty-profile', placeId: PLACE_ID, profileFingerprint: '' }],
  ['oversized profile fingerprint', {
    packId: 'pack-long-profile',
    placeId: PLACE_ID,
    profileFingerprint: 'f'.repeat(1025),
  }],
] as const) {
  test(`staging journal rejects ${label}`, async () => {
    const created = harness();
    const staged = await seedCustomStagingJournal(created, values);

    await assertStagingJournalRejected(created, staged, label);
  });
}

test('staging journal manifest key must exactly match its place and pack', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'manifest-key', 'pack-manifest', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  journal.manifestKey = 'wm-emergency-pack-v2:manifest:other:pack-manifest';
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'exact manifest key');
});

test('staging journal artifacts must be an array', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'artifact-array', 'pack-array', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  journal.artifacts = { 0: (journal.artifacts as unknown[])[0], length: 1 };
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'artifact array type');
});

test('staging journal artifact list must not be empty', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'empty-artifacts', 'pack-empty-artifacts', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  journal.artifacts = [];
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'nonempty artifacts');
});

test('staging journal artifact list is bounded to the allowlisted kind count', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'many-artifacts', 'pack-many');
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  const entries = journal.artifacts as unknown[];
  journal.artifacts = [...entries, entries[0], entries[1]];
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'bounded artifacts');
});

for (const [label, value] of [['null', null], ['array', []]] as const) {
  test(`staging journal rejects a ${label} artifact entry`, async () => {
    const created = harness();
    const staged = await seedStagingJournal(created.metadata, created.bodies, `artifact-${label}`, `pack-artifact-${label}`, ['contacts']);
    const journal = readStagingJournal(created.metadata, staged.journalKey);
    journal.artifacts = [value];
    writeStagingJournal(created.metadata, staged.journalKey, journal);

    await assertStagingJournalRejected(created, staged, `artifact ${label}`);
  });
}

test('staging journal artifact entries have exactly kind, cache key, and digest fields', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'artifact-fields', 'pack-artifact-fields', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  (journal.artifacts as Array<Record<string, unknown>>)[0]!.body = 'private-body';
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'exact artifact fields');
});

test('staging journal artifact kind must be allowlisted', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'artifact-kind', 'pack-artifact-kind', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  const artifact = (journal.artifacts as Array<Record<string, unknown>>)[0]!;
  const oldCacheKey = artifact.cacheKey as string;
  const cacheKey = 'wm-emergency-pack-v2:body:pack-artifact-kind:private-unknown';
  created.bodies.values.set(cacheKey, created.bodies.values.get(oldCacheKey)!);
  created.bodies.values.delete(oldCacheKey);
  artifact.kind = 'private-unknown';
  artifact.cacheKey = cacheKey;
  writeStagingJournal(created.metadata, staged.journalKey, journal);
  const mutated = { ...staged, bodyKeys: [cacheKey] };

  await assertStagingJournalRejected(created, mutated, 'allowlisted artifact kind');
});

test('staging journal artifact cache key must exactly match its pack and kind', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'artifact-key', 'pack-artifact-key', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  const artifact = (journal.artifacts as Array<Record<string, unknown>>)[0]!;
  const oldCacheKey = artifact.cacheKey as string;
  const cacheKey = 'wm-emergency-pack-v2:body:other-pack:contacts';
  created.bodies.values.set(cacheKey, created.bodies.values.get(oldCacheKey)!);
  created.bodies.values.delete(oldCacheKey);
  artifact.cacheKey = cacheKey;
  writeStagingJournal(created.metadata, staged.journalKey, journal);
  const mutated = { ...staged, bodyKeys: [cacheKey] };

  await assertStagingJournalRejected(created, mutated, 'exact artifact cache key');
});

for (const [label, invalidDigest] of [
  ['uppercase', 'A'.repeat(64)],
  ['short', 'a'.repeat(63)],
  ['non-hex', `${'a'.repeat(63)}z`],
] as const) {
  test(`staging journal rejects a ${label} SHA-256 digest`, async () => {
    const created = harness({ digest: async () => invalidDigest });
    const staged = await seedStagingJournal(created.metadata, created.bodies, `digest-${label}`, `pack-digest-${label}`, ['contacts']);
    const journal = readStagingJournal(created.metadata, staged.journalKey);
    (journal.artifacts as Array<Record<string, unknown>>)[0]!.sha256 = invalidDigest;
    writeStagingJournal(created.metadata, staged.journalKey, journal);

    await assertStagingJournalRejected(created, staged, `strict ${label} digest`);
  });
}

test('staging journal artifact kinds must be unique', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'duplicate-kind', 'pack-duplicate', ['contacts']);
  const journal = readStagingJournal(created.metadata, staged.journalKey);
  const artifact = (journal.artifacts as unknown[])[0];
  journal.artifacts = [artifact, artifact];
  writeStagingJournal(created.metadata, staged.journalKey, journal);

  await assertStagingJournalRejected(created, staged, 'unique artifact kinds');
});

test('a complete digest-only staging journal is read back before the first body write', async () => {
  const created = harness();
  const metadataWrites: Array<{ key: string; value: string }> = [];
  const setItem = created.metadata.setItem.bind(created.metadata);
  created.metadata.setItem = (key, value) => {
    metadataWrites.push({ key, value });
    setItem(key, value);
  };
  const generation = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: REQUIRED_KINDS,
    optionalKinds: ['route-alternate'],
    artifacts: artifacts('journal-order').map((artifact) => artifact.kind === 'contacts'
      ? {
        ...artifact,
        body: JSON.stringify({
          marker: 'journal-order',
          kind: artifact.kind,
          placeId: PLACE_ID,
          profileFingerprint: PROFILE,
          capturedAt: artifact.capturedAt,
          privateContact: 'do-not-store-in-metadata',
        }),
      }
      : artifact),
  };

  assert.deepEqual(await created.store.commitGeneration(generation), { ok: true, packId: 'pack-1' });

  const journalWrite = created.operations.findIndex((entry) => entry === `${'metadata:set:'}${STAGING_PREFIX}pack-1`);
  const journalReadback = created.operations.findIndex((entry, index) => (
    index > journalWrite && entry === `${'metadata:get:'}${STAGING_PREFIX}pack-1`
  ));
  const firstBodyWrite = created.operations.findIndex((entry) => entry.startsWith('body:put:'));
  assert.ok(journalWrite >= 0 && journalReadback > journalWrite && firstBodyWrite > journalReadback);
  const encodedJournal = metadataWrites.find(({ key }) => key === `${STAGING_PREFIX}pack-1`)?.value;
  assert.ok(encodedJournal);
  const journal = JSON.parse(encodedJournal) as { artifacts: Array<Record<string, unknown>> };
  assert.equal(encodedJournal.includes('do-not-store-in-metadata'), false);
  assert.deepEqual(
    journal.artifacts.map((entry) => Object.keys(entry).sort()),
    REQUIRED_KINDS.map(() => ['cacheKey', 'kind', 'sha256']),
  );
  assert.equal(created.metadata.values.has(`${STAGING_PREFIX}pack-1`), false);
});

test('restart recovery removes every uncommitted staged body and manifest before its journal', async () => {
  const created = harness();
  assert.deepEqual(await commit(created.store, 'known-good'), { ok: true, packId: 'pack-1' });
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'crash-restart', 'pack-crash');
  const released: string[] = [];
  const restarted = requireFunction(api, 'createEmergencyPackStore')({
    metadata: created.metadata,
    bodies: {
      put: (key, body) => created.bodies.put(key, body),
      get: (key) => created.bodies.get(key),
      async delete(key) {
        await created.bodies.delete(key);
        return true;
      },
    },
    digest,
    now: () => NOW,
    createPackId: () => 'pack-after-restart',
    releaseArtifactBody(kind, body) {
      if (kind === 'offline-map') released.push(body);
    },
  });
  const start = created.operations.length;

  assert.deepEqual(
    await restarted.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
  assert.deepEqual(released.map((body) => JSON.parse(body).marker), ['crash-restart']);
  assert.equal(staged.bodyKeys.every((key) => !created.bodies.values.has(key)), true);
  assert.equal(created.metadata.values.has(staged.manifestKey), false);
  assert.equal(created.metadata.values.has(staged.journalKey), false);
  const recoveryOperations = created.operations.slice(start);
  const lastBodyDelete = Math.max(...staged.bodyKeys.map((key) => recoveryOperations.indexOf(`body:delete:${key}`)));
  const manifestRemove = recoveryOperations.indexOf(`metadata:remove:${staged.manifestKey}`);
  const journalRemove = recoveryOperations.indexOf(`metadata:remove:${staged.journalKey}`);
  assert.ok(lastBodyDelete >= 0 && manifestRemove > lastBodyDelete && journalRemove > manifestRemove);
});

test('restart cleanup verifies every staged body digest before deleting any body', async () => {
  const created = harness();
  const staged = await seedStagingJournal(
    created.metadata,
    created.bodies,
    'digest-preflight',
    'pack-digest-preflight',
    ['lifelines', 'contacts'],
  );
  created.bodies.values.set(staged.bodyKeys[1]!, 'tampered-private-contacts');
  const bodiesBefore = new Map(created.bodies.values);
  const operationStart = created.operations.length;

  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.equal(
    created.operations.slice(operationStart).some((entry) => entry.startsWith('body:delete:')),
    false,
    'a later digest mismatch prevents every staged body deletion',
  );
  assert.deepEqual(created.bodies.values, bodiesBefore);
  assert.equal(created.metadata.values.has(staged.journalKey), true);
  assert.equal(created.metadata.values.has(staged.manifestKey), true);
});

test('restart cleanup releases the offline generation before deleting the first staged body', async () => {
  const operations: string[] = [];
  const metadata = new MemoryMetadata(operations);
  const bodies = new MemoryBodies(operations);
  const staged = await seedStagingJournal(metadata, bodies, 'release-order', 'pack-release-order');
  const store = requireFunction(api, 'createEmergencyPackStore')({
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
    now: () => NOW,
    createPackId: () => 'pack-after-release',
    releaseArtifactBody(kind) {
      operations.push(`body:release:${kind}`);
    },
  });
  const operationStart = operations.length;

  assert.deepEqual(
    await store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'not-saved', packId: null },
  );
  const cleanup = operations.slice(operationStart);
  const release = cleanup.indexOf('body:release:offline-map');
  const firstDelete = cleanup.findIndex((entry) => entry.startsWith('body:delete:'));
  assert.ok(release >= 0 && firstDelete > release, 'offline generation release precedes every body deletion');
  assert.equal(staged.bodyKeys.every((key) => !bodies.values.has(key)), true);
  assert.equal(metadata.values.has(staged.journalKey), false);
});

test('silent unpublished-manifest removal failure retains ownership and blocks later capture', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'manifest-noop', 'pack-manifest-noop');
  const removeItem = created.metadata.removeItem.bind(created.metadata);
  created.metadata.removeItem = (key) => {
    if (key !== staged.manifestKey) removeItem(key);
  };

  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.equal(created.metadata.values.has(staged.manifestKey), true);
  assert.equal(created.metadata.values.has(staged.journalKey), true);
  assert.deepEqual(await commit(created.store, 'blocked-after-manifest-noop'), {
    ok: false,
    reason: 'storage-failure',
  });
  assert.equal(created.metadata.values.has(staged.journalKey), true);
});

test('silent staging-journal removal failure retains ownership and blocks later capture', async () => {
  const created = harness();
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'journal-noop', 'pack-journal-noop');
  const removeItem = created.metadata.removeItem.bind(created.metadata);
  created.metadata.removeItem = (key) => {
    if (key !== staged.journalKey) removeItem(key);
  };

  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );
  assert.equal(created.metadata.values.has(staged.journalKey), true);
  assert.equal(created.metadata.values.has(staged.manifestKey), false);
  assert.deepEqual(await commit(created.store, 'blocked-after-journal-noop'), {
    ok: false,
    reason: 'storage-failure',
  });
  assert.equal(created.metadata.values.has(staged.journalKey), true);
});

test('restart cleanup is deterministic after the journal and after each staged body including contacts', async () => {
  for (let storedBodyCount = 0; storedBodyCount <= REQUIRED_KINDS.length; storedBodyCount += 1) {
    const created = harness();
    assert.deepEqual(await commit(created.store, 'known-good'), { ok: true, packId: 'pack-1' });
    const staged = await seedStagingJournal(
      created.metadata,
      created.bodies,
      `crash-after-${storedBodyCount}`,
      'pack-crash',
      REQUIRED_KINDS,
      storedBodyCount,
    );

    assert.deepEqual(
      await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'ready', packId: 'pack-1' },
      `crash after ${storedBodyCount} bodies`,
    );
    assert.equal(created.metadata.values.has(staged.journalKey), false, `journal ${storedBodyCount}`);
    assert.equal(created.metadata.values.has(staged.manifestKey), false, `manifest ${storedBodyCount}`);
    assert.equal(staged.bodyKeys.every((key) => !created.bodies.values.has(key)), true, `bodies ${storedBodyCount}`);
  }
});

test('restart recovery recognizes active and previous committed journal ownership without deleting bodies', async () => {
  const created = harness();
  assert.deepEqual(await commit(created.store, 'previous'), { ok: true, packId: 'pack-1' });
  assert.deepEqual(await commit(created.store, 'active'), { ok: true, packId: 'pack-2' });
  for (const packId of ['pack-2', 'pack-1']) {
    const manifestEntry = [...created.metadata.values.entries()]
      .find(([key]) => key.includes(':manifest:') && key.endsWith(`:${packId}`));
    assert.ok(manifestEntry);
    const manifest = JSON.parse(manifestEntry[1]) as { receipts: ReceiptFixture[] };
    const journalKey = `${STAGING_PREFIX}${packId}`;
    created.metadata.values.set(journalKey, JSON.stringify({
      schemaVersion: 1,
      packId,
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      manifestKey: manifestEntry[0],
      artifacts: manifest.receipts.map(({ kind, cacheKey, sha256 }) => ({ kind, cacheKey, sha256 })),
    }));
    const bodiesBefore = new Map(created.bodies.values);
    const deletesBefore = created.operations.filter((entry) => entry.startsWith('body:delete:')).length;

    assert.deepEqual(
      await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'ready', packId: 'pack-2' },
    );
    assert.equal(created.metadata.values.has(journalKey), false);
    assert.deepEqual(created.bodies.values, bodiesBefore);
    assert.equal(created.operations.filter((entry) => entry.startsWith('body:delete:')).length, deletesBefore);
  }
});

test('malformed or digest-mismatched staging ownership blocks capture and recovery without changing the old head', async () => {
  for (const defect of ['malformed', 'digest-mismatch'] as const) {
    const created = harness();
    assert.deepEqual(await commit(created.store, 'old-head'), { ok: true, packId: 'pack-1' });
    const oldHead = [...created.metadata.values.entries()].find(([key]) => key.includes(':head:'));
    assert.ok(oldHead);
    const staged = await seedStagingJournal(created.metadata, created.bodies, defect, 'pack-crash', ['contacts']);
    if (defect === 'malformed') created.metadata.values.set(staged.journalKey, '{');
    else created.bodies.values.set(staged.bodyKeys[0]!, 'tampered-private-contacts');

    assert.deepEqual(
      await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
      { status: 'unavailable', packId: null, reason: 'storage-failure' },
      defect,
    );
    assert.equal((await commit(created.store, 'must-not-start')).ok, false, defect);
    assert.equal(created.metadata.values.get(oldHead[0]), oldHead[1], defect);
    assert.equal(created.metadata.values.has(staged.journalKey), true, defect);
    assert.equal(created.bodies.values.has(staged.bodyKeys[0]!), true, defect);
  }
});

test('unconfirmed private-contact deletion retains its journal and retries cleanup before recovery', async () => {
  let retainContacts = true;
  const created = harness({
    async deleteBody(key, deleteDefault) {
      if (retainContacts && key.endsWith('pack-crash:contacts')) return false;
      return deleteDefault();
    },
  });
  assert.deepEqual(await commit(created.store, 'old-head'), { ok: true, packId: 'pack-1' });
  const staged = await seedStagingJournal(created.metadata, created.bodies, 'private-retry', 'pack-crash');

  assert.deepEqual(
    await created.store.recoverReadiness({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    {
      status: 'not-saved',
      packId: null,
      profileFingerprint: PROFILE,
      requiredKinds: [...REQUIRED_KINDS],
      optionalKinds: ['route-alternate'],
      receipts: [],
      missingKinds: [...REQUIRED_KINDS],
      expiredKinds: [],
      reason: 'storage-failure',
    },
  );
  assert.equal(created.metadata.values.has(staged.journalKey), true);
  assert.equal(created.metadata.values.has(staged.manifestKey), true);
  assert.equal(created.bodies.values.has(staged.bodyKeys.find((key) => key.endsWith(':contacts'))!), true);

  retainContacts = false;
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
  assert.equal(created.metadata.values.has(staged.journalKey), false);
  assert.equal(created.metadata.values.has(staged.manifestKey), false);
  assert.equal(staged.bodyKeys.every((key) => !created.bodies.values.has(key)), true);
});

test('a committed journal removal failure retains durable ownership and blocks until retry', async () => {
  const created = harness();
  const removeItem = created.metadata.removeItem.bind(created.metadata);
  let rejectJournalRemoval = true;
  created.metadata.removeItem = (key) => {
    if (rejectJournalRemoval && key.startsWith(STAGING_PREFIX)) throw new Error('journal removal failed');
    removeItem(key);
  };

  assert.deepEqual(await commit(created.store, 'committed'), { ok: true, packId: 'pack-1' });
  assert.equal(created.metadata.values.has(`${STAGING_PREFIX}pack-1`), true);
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'unavailable', packId: null, reason: 'storage-failure' },
  );

  rejectJournalRemoval = false;
  assert.deepEqual(
    await created.store.recoverActive({ placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }),
    { status: 'ready', packId: 'pack-1' },
  );
  assert.equal(created.metadata.values.has(`${STAGING_PREFIX}pack-1`), false);
});

test('a generation is published only after every body is written, read back, and hashed', async () => {
  const { operations, store } = harness();
  const result = await commit(store, 'first');
  assert.deepEqual(result, { ok: true, packId: 'pack-1' });

  const manifestWrite = operations.findIndex((entry) => entry.includes('metadata:set:') && entry.includes('manifest'));
  const lastReadback = Math.max(...operations.map((entry, index) => (
    index < manifestWrite && entry.startsWith('body:get:') ? index : -1
  )));
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
  const manifestWrite = publicationOperations
    .findIndex((entry) => entry.includes('metadata:set:') && entry.includes(':manifest:'));
  const lastBodyRead = Math.max(...publicationOperations
    .map((entry, index) => index < manifestWrite && entry.startsWith('body:get:') ? index : -1));
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
