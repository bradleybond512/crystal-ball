import assert from 'node:assert/strict';
import test from 'node:test';

import { NOW, PLACE_ID, PROFILE, REQUIRED_KINDS, requireFunction } from './test-support.mts';

interface Artifact {
  kind: string;
  body: string;
  expiresAt: number;
  semanticState: string;
  summary: string;
  itemCount: number;
}

interface OrchestrationApi {
  createEmergencyPackCaptureOrchestrator?: (dependencies: {
    sources: Record<string, (scope: Scope) => Promise<Artifact | null>>;
    commitGeneration: (input: {
      placeId: string;
      profileFingerprint: string;
      requiredKinds: readonly string[];
      optionalKinds: readonly string[];
      artifacts: Artifact[];
    }) => Promise<{ ok: boolean; packId?: string; reason?: string }>;
  }) => {
    capture: (scope: Scope) => Promise<{
      ok: boolean;
      packId?: string;
      failedKind?: string;
      reason?: string;
    }>;
  };
}

interface Scope {
  placeId: string;
  profileFingerprint: string;
  contactConsent: boolean;
}

const api = await import('../emergency-pack-capture.ts').catch(() => ({} as OrchestrationApi)) as OrchestrationApi;
const scope = { placeId: PLACE_ID, profileFingerprint: PROFILE, contactConsent: true };

function artifact(kind: string): Artifact {
  return {
    kind,
    body: JSON.stringify({ kind, placeId: PLACE_ID, profileFingerprint: PROFILE }),
    expiresAt: NOW + 60 * 60_000,
    semanticState: 'verified',
    summary: `${kind} captured`,
    itemCount: 1,
  };
}

function sources(overrides: Partial<Record<string, (candidate: Scope) => Promise<Artifact | null>>> = {}) {
  return {
    lifelines: async () => artifact('lifelines'),
    alerts: async () => artifact('alerts'),
    'route-primary': async () => artifact('route-primary'),
    'route-alternate': async () => artifact('route-alternate'),
    'offline-map': async () => artifact('offline-map'),
    'comms-plan': async () => artifact('comms-plan'),
    contacts: async () => artifact('contacts'),
    ...overrides,
  };
}

test('capture assembles every existing required source and commits alternate route only when available', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  const commits: Array<{ artifacts: Artifact[]; placeId: string; profileFingerprint: string }> = [];
  const sourceScopes: Array<{ kind: string; scope: Scope }> = [];
  const tracedSources = Object.fromEntries(Object.entries(sources()).map(([kind, read]) => [
    kind,
    async (candidate: Scope) => {
      sourceScopes.push({ kind, scope: candidate });
      return read(candidate);
    },
  ]));
  const orchestrator = create({
    sources: tracedSources,
    commitGeneration: async (input) => {
      commits.push(input);
      return { ok: true, packId: 'pack-2' };
    },
  });

  assert.deepEqual(await orchestrator.capture(scope), { ok: true, packId: 'pack-2' });
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.placeId, PLACE_ID);
  assert.equal(commits[0]?.profileFingerprint, PROFILE);
  assert.deepEqual(commits[0]?.artifacts.map((item) => item.kind), [...REQUIRED_KINDS, 'route-alternate']);
  assert.deepEqual(sourceScopes.map(({ kind }) => kind), [...REQUIRED_KINDS, 'route-alternate']);
  assert.ok(sourceScopes.every(({ scope: candidate }) => candidate === scope), 'all sources receive the exact capture scope');
});

test('one missing or rejected required artifact prevents any generation commit', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  for (const failedKind of REQUIRED_KINDS) {
    let commits = 0;
    const orchestrator = create({
      sources: sources({ [failedKind]: async () => null }),
      commitGeneration: async () => { commits += 1; return { ok: true, packId: 'must-not-exist' }; },
    });
    const result = await orchestrator.capture(scope);
    assert.equal(result.ok, false, failedKind);
    assert.equal(result.failedKind, failedKind, failedKind);
    assert.equal(commits, 0, failedKind);
  }

  let commits = 0;
  const rejected = create({
    sources: sources({ alerts: async () => { throw new Error('alerts unavailable'); } }),
    commitGeneration: async () => { commits += 1; return { ok: true }; },
  });
  assert.deepEqual(await rejected.capture(scope), {
    ok: false,
    failedKind: 'alerts',
    reason: 'alerts unavailable',
  });
  assert.equal(commits, 0);

  const malformed = create({
    sources: sources({ alerts: async () => ({ ...artifact('alerts'), body: '{not-json' }) }),
    commitGeneration: async () => { commits += 1; return { ok: true }; },
  });
  assert.deepEqual(await malformed.capture(scope), {
    ok: false,
    failedKind: 'alerts',
    reason: 'artifact-invalid',
  });
  assert.equal(commits, 0);
});

test('private contacts are not read or copied without explicit consent', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  let contactReads = 0;
  let commits = 0;
  const orchestrator = create({
    sources: sources({
      contacts: async () => { contactReads += 1; return artifact('contacts'); },
    }),
    commitGeneration: async () => { commits += 1; return { ok: true }; },
  });

  assert.deepEqual(await orchestrator.capture({ ...scope, contactConsent: false }), {
    ok: false,
    failedKind: 'contacts',
    reason: 'contact-consent-required',
  });
  assert.equal(contactReads, 0);
  assert.equal(commits, 0);
});

test('alternate-route failure is reported as optional and does not block the required pack', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  const committedKinds: string[][] = [];
  const orchestrator = create({
    sources: sources({ 'route-alternate': async () => null }),
    commitGeneration: async (input) => {
      committedKinds.push(input.artifacts.map((item) => item.kind));
      return { ok: true, packId: 'pack-required-only' };
    },
  });

  assert.deepEqual(await orchestrator.capture(scope), { ok: true, packId: 'pack-required-only' });
  assert.deepEqual(committedKinds, [[...REQUIRED_KINDS]]);
});
