import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLifelineOfflinePackManifest,
  deriveLifelineOfflinePackReadiness,
  type LifelineOfflinePackArtifact,
  type LifelineOfflinePackArtifactKind,
} from '../offline-pack.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const FINGERPRINT = 'v2|41.61000|-86.72000|25.00|fuel,shelter|3';
const REQUIRED: LifelineOfflinePackArtifactKind[] = ['lifelines', 'alerts', 'route-primary'];

function artifact(
  kind: LifelineOfflinePackArtifactKind,
  overrides: Partial<LifelineOfflinePackArtifact> = {},
): LifelineOfflinePackArtifact {
  return {
    kind,
    queryFingerprint: FINGERPRINT,
    cachedAt: new Date(NOW - 60_000),
    expiresAt: new Date(NOW + 60 * 60_000),
    ...overrides,
  };
}

function manifest(artifacts = REQUIRED.map((kind) => artifact(kind))) {
  return buildLifelineOfflinePackManifest({
    placeId: 'home',
    queryFingerprint: FINGERPRINT,
    requiredKinds: REQUIRED,
    artifacts,
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
  });
}

test('an exact-fingerprint manifest with all current required artifacts is ready', () => {
  const readiness = deriveLifelineOfflinePackReadiness(FINGERPRINT, manifest(), NOW);

  assert.equal(readiness.status, 'ready');
  assert.deepEqual(readiness.missingKinds, []);
  assert.deepEqual(readiness.expiredKinds, []);
});

test('a manifest for another fingerprint cannot satisfy the request even for the same place', () => {
  const old = buildLifelineOfflinePackManifest({
    placeId: 'home',
    queryFingerprint: 'old-location-or-options',
    requiredKinds: REQUIRED,
    artifacts: REQUIRED.map((kind) => artifact(kind, { queryFingerprint: 'old-location-or-options' })),
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
  });
  const readiness = deriveLifelineOfflinePackReadiness(FINGERPRINT, old, NOW);

  assert.equal(readiness.status, 'not-saved');
  assert.deepEqual(readiness.reasons, ['manifest-fingerprint-mismatch']);
  assert.equal(readiness.compatibleArtifactCount, 0);
});

test('an artifact with the wrong fingerprint is incompatible rather than reusable', () => {
  const readiness = deriveLifelineOfflinePackReadiness(FINGERPRINT, manifest([
    artifact('lifelines'),
    artifact('alerts'),
    artifact('route-primary', { queryFingerprint: 'other-route-query' }),
  ]), NOW);

  assert.equal(readiness.status, 'partial');
  assert.deepEqual(readiness.missingKinds, ['route-primary']);
  assert.deepEqual(readiness.incompatibleKinds, ['route-primary']);
});

test('a required artifact at its expiry boundary makes the pack expired', () => {
  const readiness = deriveLifelineOfflinePackReadiness(FINGERPRINT, manifest([
    artifact('lifelines'),
    artifact('alerts', { expiresAt: new Date(NOW) }),
    artifact('route-primary'),
  ]), NOW);

  assert.equal(readiness.status, 'expired');
  assert.deepEqual(readiness.expiredKinds, ['alerts']);
});

test('missing required content is partial but expired optional content does not matter', () => {
  const partial = deriveLifelineOfflinePackReadiness(FINGERPRINT, manifest([
    artifact('lifelines'),
    artifact('alerts'),
  ]), NOW);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.missingKinds, ['route-primary']);

  const withExpiredOptional = manifest([
    ...REQUIRED.map((kind) => artifact(kind)),
    artifact('offline-map', { expiresAt: new Date(NOW - 1) }),
  ]);
  assert.equal(deriveLifelineOfflinePackReadiness(FINGERPRINT, withExpiredOptional, NOW).status, 'ready');
});

test('no manifest is not saved, and duplicate artifact kinds are rejected', () => {
  assert.equal(deriveLifelineOfflinePackReadiness(FINGERPRINT, null, NOW).status, 'not-saved');
  assert.throws(() => manifest([artifact('lifelines'), artifact('lifelines')]), /duplicate artifact kind/);
});
