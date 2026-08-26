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
  const migrated = migrate({
    schemaVersion: 1,
    placeId: PLACE_ID,
    queryFingerprint: PROFILE,
    requiredKinds: ['lifelines'],
    artifacts: [{
      kind: 'lifelines',
      queryFingerprint: PROFILE,
      cachedAt: new Date(NOW - 60_000).toISOString(),
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    }],
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 30_000).toISOString(),
  }, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }, receipt('lifelines'));

  assert.ok(migrated);
  assert.deepEqual(migrated.receipts.map((item) => item.kind), ['lifelines']);
  assert.equal(migrated.migration?.source, 'lifeline-pack-v1');
  assert.equal(
    derive(migrated, { placeId: PLACE_ID, profileFingerprint: PROFILE, now: NOW }).status,
    'partial',
  );
});
