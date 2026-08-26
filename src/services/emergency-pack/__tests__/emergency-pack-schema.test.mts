import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOW,
  PLACE_ID,
  PROFILE,
  REQUIRED_KINDS,
  manifest,
  receipt,
  requireFunction,
  type ManifestFixture,
} from './test-support.mts';

interface SchemaApi {
  parseEmergencyPackManifest?: (value: unknown) => ManifestFixture | null;
  deriveEmergencyPackReadiness?: (
    value: ManifestFixture | null,
    scope: { placeId: string; profileFingerprint: string; now: number },
  ) => { status: string; missingKinds: string[]; expiredKinds: string[]; reasons: string[] };
  migrateLifelinePackV1?: (value: unknown, scope: {
    placeId: string;
    profileFingerprint: string;
    legacyQueryFingerprint: string;
    now: number;
  }, verifiedLifelinesReceipt: ReturnType<typeof receipt>) => ManifestFixture | null;
}

const api = await import('../emergency-pack-schema.ts').catch(() => ({} as SchemaApi)) as SchemaApi;

test('v2 parsing is strict about schema, keys, kinds, duplicates, and profile identity', () => {
  const parse = requireFunction(api, 'parseEmergencyPackManifest');
  assert.deepEqual(parse(manifest()), manifest());
  assert.equal(parse({ ...manifest(), schemaVersion: 1 }), null);
  assert.equal(parse({ ...manifest(), unexpected: true }), null);
  assert.equal(parse({ ...manifest(), profileFingerprint: '' }), null);
  assert.equal(parse({ ...manifest(), requiredKinds: [...REQUIRED_KINDS, 'unknown'] }), null);
  assert.equal(parse({ ...manifest(), requiredKinds: [...REQUIRED_KINDS, 'lifelines'] }), null);
  assert.equal(parse({ ...manifest(), receipts: [receipt('lifelines'), receipt('lifelines')] }), null);
});

test('v2 receipts preserve mixed evidence ages with strict chronology, hashes, and per-kind byte caps', () => {
  const parse = requireFunction(api, 'parseEmergencyPackManifest');
  const byteCaps: Record<string, number> = {
    lifelines: 1024 * 1024,
    alerts: 256 * 1024,
    'route-primary': 512 * 1024,
    'route-alternate': 512 * 1024,
    'offline-map': 50 * 1024 * 1024,
    'comms-plan': 128 * 1024,
    contacts: 128 * 1024,
  };
  const mixed = manifest({
    committedAt: new Date(NOW).toISOString(),
    receipts: REQUIRED_KINDS.map((kind, index) => receipt(kind, {
      capturedAt: new Date(NOW - (index + 1) * 60_000).toISOString(),
      verifiedAt: new Date(NOW).toISOString(),
    })),
  });
  assert.deepEqual(parse(mixed), mixed);

  for (const [kind, cap] of Object.entries(byteCaps)) {
    assert.equal(parse(manifest({ receipts: [receipt(kind, { byteLength: cap + 1 })] })), null, kind);
  }
  for (const sha256 of ['', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}z`]) {
    assert.equal(parse(manifest({ receipts: [receipt('lifelines', { sha256 })] })), null, sha256);
  }
  assert.equal(parse(manifest({ receipts: [receipt('lifelines', {
    capturedAt: new Date(NOW + 1).toISOString(),
    verifiedAt: new Date(NOW).toISOString(),
  })] })), null);
  assert.equal(parse(manifest({ receipts: [receipt('lifelines', {
    verifiedAt: new Date(NOW + 60 * 60_000).toISOString(),
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
  })] })), null);
  assert.equal(parse(manifest({ receipts: [receipt('lifelines', {
    verifiedAt: new Date(NOW - 1).toISOString(),
  })] })), null);
});

test('v2 receipts bind one strict alert source revision and reject it for every other kind', () => {
  const parse = requireFunction(api, 'parseEmergencyPackManifest');
  const validRevision = 'b'.repeat(64);
  assert.deepEqual(parse(manifest({
    receipts: [receipt('alerts', { sourceRevision: validRevision })],
  })), manifest({
    receipts: [receipt('alerts', { sourceRevision: validRevision })],
  }));
  for (const sourceRevision of ['', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}z`]) {
    assert.equal(parse(manifest({
      receipts: [receipt('alerts', { sourceRevision })],
    })), null);
  }
  assert.equal(parse(manifest({
    receipts: [receipt('lifelines', { sourceRevision: validRevision })],
  })), null);
  for (const alertSequence of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parse(manifest({
      receipts: [receipt('alerts', { alertSequence })],
    })), null);
  }
  assert.equal(parse(manifest({
    receipts: [receipt('lifelines', { alertSequence: 1 })],
  })), null);
  const missingRevision = receipt('alerts') as ReturnType<typeof receipt> & { sourceRevision?: string | null };
  delete missingRevision.sourceRevision;
  assert.equal(parse(manifest({ receipts: [missingRevision as ReturnType<typeof receipt>] })), null);
});

test('readiness requires every exact, current required receipt but not an optional route', () => {
  const derive = requireFunction(api, 'deriveEmergencyPackReadiness');
  assert.deepEqual(derive(manifest(), { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }), {
    status: 'ready',
    missingKinds: [],
    expiredKinds: [],
    reasons: [],
  });

  const withoutPrimary = manifest({
    receipts: REQUIRED_KINDS.filter((kind) => kind !== 'route-primary').map((kind) => receipt(kind)),
  });
  assert.equal(
    derive(withoutPrimary, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }).status,
    'partial',
  );
});

test('expired required evidence and a moved place fail closed while expired optional evidence does not', () => {
  const derive = requireFunction(api, 'deriveEmergencyPackReadiness');
  const expiredRequired = manifest({
    receipts: REQUIRED_KINDS.map((kind) => receipt(kind, kind === 'alerts'
      ? { expiresAt: new Date(NOW).toISOString() }
      : {})),
  });
  const expired = derive(expiredRequired, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW });
  assert.equal(expired.status, 'expired');
  assert.deepEqual(expired.expiredKinds, ['alerts']);

  const moved = derive(manifest(), { placeId: PLACE_ID, profileFingerprint: `${PROFILE}:moved`, now: NOW });
  assert.equal(moved.status, 'not-saved');
  assert.deepEqual(moved.reasons, ['profile-fingerprint-mismatch']);

  const optionalExpired = manifest({
    receipts: [...REQUIRED_KINDS.map((kind) => receipt(kind)), receipt('route-alternate', {
      expiresAt: new Date(NOW).toISOString(),
    })],
  });
  assert.equal(
    derive(optionalExpired, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }).status,
    'ready',
  );
});

test('v1 migration preserves only Lifelines evidence and can never claim a complete v2 pack', () => {
  const migrate = requireFunction(api, 'migrateLifelinePackV1');
  const derive = requireFunction(api, 'deriveEmergencyPackReadiness');
  const legacyQueryFingerprint = 'lifelines-exact-v2';
  const migrated = migrate({
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
  }, {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    legacyQueryFingerprint,
    now: NOW,
  }, receipt('lifelines', { verifiedAt: new Date(NOW).toISOString() }));

  assert.ok(migrated);
  assert.deepEqual(migrated.receipts.map((item) => item.kind), ['lifelines']);
  assert.equal(migrated.migration?.source, 'lifeline-pack-v1');
  assert.equal(
    derive(migrated, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }).status,
    'partial',
  );

  assert.equal(migrate({
    schemaVersion: 1,
    placeId: PLACE_ID,
    queryFingerprint: `${legacyQueryFingerprint}:moved`,
    requiredKinds: ['lifelines'],
    artifacts: [{
      kind: 'lifelines',
      queryFingerprint: `${legacyQueryFingerprint}:moved`,
      cachedAt: new Date(NOW - 60_000).toISOString(),
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    }],
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 30_000).toISOString(),
  }, {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    legacyQueryFingerprint,
    now: NOW,
  }, receipt('lifelines', { verifiedAt: new Date(NOW).toISOString() })), null);
});

test('v1 migration rejects malformed, ambiguous, expired, and mismatched legacy evidence', () => {
  const migrate = requireFunction(api, 'migrateLifelinePackV1');
  const legacyQueryFingerprint = 'lifelines-exact-v2';
  const scope = {
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    legacyQueryFingerprint,
    now: NOW,
  };
  const verifiedReceipt = receipt('lifelines', { verifiedAt: new Date(NOW).toISOString() });
  const legacy = {
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

  assert.equal(migrate({ ...legacy, requiredKinds: [] }, scope, verifiedReceipt), null);
  assert.equal(migrate({ ...legacy, requiredKinds: ['lifelines', 'alerts'] }, scope, verifiedReceipt), null);
  assert.equal(migrate({ ...legacy, artifacts: [...legacy.artifacts, legacy.artifacts[0]] }, scope, verifiedReceipt), null);
  assert.equal(migrate({
    ...legacy,
    artifacts: [{ ...legacy.artifacts[0], expiresAt: new Date(NOW).toISOString() }],
  }, scope, verifiedReceipt), null);
  assert.equal(migrate(legacy, scope, receipt('lifelines', {
    profileFingerprint: `${PROFILE}:moved`,
    verifiedAt: new Date(NOW).toISOString(),
  })), null);
  assert.equal(migrate(legacy, { ...scope, now: Number.NaN }, verifiedReceipt), null);
  assert.equal(migrate(legacy, scope, receipt('lifelines')), null);
});
