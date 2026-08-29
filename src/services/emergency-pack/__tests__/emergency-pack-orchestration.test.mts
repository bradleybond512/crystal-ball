import assert from 'node:assert/strict';
import test from 'node:test';

import { NOW, PLACE_ID, PROFILE, REQUIRED_KINDS, requireFunction } from './test-support.mts';

interface Artifact {
  kind: string;
  body: string;
  capturedAt: number;
  expiresAt: number;
  semanticState: string;
  summary: string;
  itemCount: number;
  sourceRevision?: string;
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
    releaseArtifact?: (artifact: Artifact) => Promise<void>;
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
const ALERT_SOURCE_REVISION = 'a'.repeat(64);

function artifact(kind: string): Artifact {
  const capturedAt = NOW - 60_000;
  const body = kind === 'offline-map'
    ? {
      kind,
      placeId: PLACE_ID,
      profileFingerprint: PROFILE,
      capturedAt,
      generationId: 'generation-home-1',
      tiles: [{
        url: 'https://a.basemaps.cartocdn.com/dark_all/8/66/95@2x.png',
        cacheKey: 'https://offline-map.crystalball.invalid/exact/generation-home-1/0',
        sha256: 'a'.repeat(64),
        generationId: 'generation-home-1',
        byteLength: 32_000,
        verified: true,
      }],
      totalBytes: 32_000,
    }
    : kind === 'alerts'
      ? {
        kind,
        placeId: PLACE_ID,
        profileFingerprint: PROFILE,
        capturedAt,
        sourceRevision: ALERT_SOURCE_REVISION,
      }
    : { kind, placeId: PLACE_ID, profileFingerprint: PROFILE, capturedAt };
  return {
    kind,
    body: JSON.stringify(body),
    capturedAt,
    expiresAt: NOW + 60 * 60_000,
    semanticState: 'verified',
    summary: `${kind} captured`,
    itemCount: 1,
    ...(kind === 'alerts' ? { sourceRevision: ALERT_SOURCE_REVISION } : {}),
  };
}

function reboundArtifact(kind: string, placeId: string, profileFingerprint: string): Artifact {
  const candidate = artifact(kind);
  candidate.body = JSON.stringify({
    ...(JSON.parse(candidate.body) as Record<string, unknown>),
    placeId,
    profileFingerprint,
  });
  return candidate;
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

test('alert source revision is strict, body-bound, forwarded unchanged, and forbidden on other kinds', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  const committedAlerts: Artifact[] = [];
  const accepted = create({
    sources: sources(),
    commitGeneration: async (input) => {
      const alert = input.artifacts.find(({ kind }) => kind === 'alerts');
      if (alert) committedAlerts.push(alert);
      return { ok: true, packId: 'revision-bound' };
    },
  });

  assert.deepEqual(await accepted.capture(scope), { ok: true, packId: 'revision-bound' });
  assert.equal(committedAlerts.length, 1);
  assert.equal(committedAlerts[0]?.sourceRevision, ALERT_SOURCE_REVISION);
  assert.equal(JSON.parse(committedAlerts[0]!.body).sourceRevision, ALERT_SOURCE_REVISION);

  const missingEnvelope = artifact('alerts');
  delete missingEnvelope.sourceRevision;
  const missingBody = artifact('alerts');
  const missingBodyPayload = JSON.parse(missingBody.body) as Record<string, unknown>;
  delete missingBodyPayload.sourceRevision;
  missingBody.body = JSON.stringify(missingBodyPayload);
  const malformed = artifact('alerts');
  malformed.sourceRevision = 'A'.repeat(64);
  malformed.body = JSON.stringify({
    ...(JSON.parse(malformed.body) as Record<string, unknown>),
    sourceRevision: malformed.sourceRevision,
  });
  const mismatched = artifact('alerts');
  mismatched.sourceRevision = 'b'.repeat(64);
  const nonAlertRevision = artifact('lifelines');
  nonAlertRevision.sourceRevision = ALERT_SOURCE_REVISION;
  const nonAlertBodyRevision = artifact('lifelines');
  nonAlertBodyRevision.body = JSON.stringify({
    ...(JSON.parse(nonAlertBodyRevision.body) as Record<string, unknown>),
    sourceRevision: ALERT_SOURCE_REVISION,
  });

  for (const [failedKind, candidate] of [
    ['alerts', missingEnvelope],
    ['alerts', missingBody],
    ['alerts', malformed],
    ['alerts', mismatched],
    ['lifelines', nonAlertRevision],
    ['lifelines', nonAlertBodyRevision],
  ] as const) {
    let commits = 0;
    const rejected = create({
      sources: sources({ [failedKind]: async () => candidate }),
      commitGeneration: async () => { commits += 1; return { ok: true }; },
    });
    assert.deepEqual(await rejected.capture(scope), {
      ok: false,
      failedKind,
      reason: 'artifact-invalid',
    });
    assert.equal(commits, 0);
  }
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

test('capture rejects otherwise valid artifacts bound to another place or profile', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  for (const [label, candidate] of [
    ['place', reboundArtifact('lifelines', `${PLACE_ID}:other`, PROFILE)],
    ['profile', reboundArtifact('lifelines', PLACE_ID, `${PROFILE}:other`)],
  ] as const) {
    let commits = 0;
    const orchestrator = create({
      sources: sources({ lifelines: async () => candidate }),
      commitGeneration: async () => { commits += 1; return { ok: true }; },
    });

    assert.deepEqual(await orchestrator.capture({ ...scope }), {
      ok: false,
      failedKind: 'lifelines',
      reason: 'artifact-invalid',
    }, label);
    assert.equal(commits, 0, label);
  }
});

test('capture aborts when awaited required or optional sources change either scope identity field', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  const scenarios = [
    { kind: 'contacts', identity: 'placeId', changed: `${PLACE_ID}:changed` },
    { kind: 'contacts', identity: 'profileFingerprint', changed: `${PROFILE}:changed` },
    { kind: 'route-alternate', identity: 'placeId', changed: `${PLACE_ID}:changed` },
    { kind: 'route-alternate', identity: 'profileFingerprint', changed: `${PROFILE}:changed` },
  ] as const;

  for (const scenario of scenarios) {
    let commits = 0;
    const released: Artifact[] = [];
    const orchestrator = create({
      sources: sources({
        [scenario.kind]: async (candidate) => {
          candidate[scenario.identity] = scenario.changed;
          return reboundArtifact(scenario.kind, candidate.placeId, candidate.profileFingerprint);
        },
      }),
      commitGeneration: async () => { commits += 1; return { ok: true }; },
      releaseArtifact: async (candidate) => { released.push(candidate); },
    });

    assert.deepEqual(await orchestrator.capture({ ...scope }), {
      ok: false,
      failedKind: scenario.kind,
      reason: 'scope-changed',
    }, `${scenario.kind}:${scenario.identity}`);
    assert.equal(commits, 0, `${scenario.kind}:${scenario.identity}`);
    assert.deepEqual(
      released.map(({ kind }) => kind),
      ['offline-map'],
      `${scenario.kind}:${scenario.identity}`,
    );
  }
});

test('capture rejects artifacts whose evidence time is missing, inconsistent, or not before expiry', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  for (const candidate of [
    (() => {
      const value = artifact('alerts') as Artifact & { capturedAt?: number };
      delete value.capturedAt;
      return value;
    })(),
    (() => {
      const value = artifact('alerts');
      value.body = JSON.stringify({
        kind: value.kind,
        placeId: PLACE_ID,
        profileFingerprint: PROFILE,
        capturedAt: value.capturedAt - 1,
      });
      return value;
    })(),
    (() => {
      const value = artifact('alerts');
      value.capturedAt = value.expiresAt;
      value.body = JSON.stringify({
        kind: value.kind,
        placeId: PLACE_ID,
        profileFingerprint: PROFILE,
        capturedAt: value.capturedAt,
      });
      return value;
    })(),
  ]) {
    let commits = 0;
    const orchestrator = create({
      sources: sources({ alerts: async () => candidate }),
      commitGeneration: async () => { commits += 1; return { ok: true }; },
    });
    assert.deepEqual(await orchestrator.capture(scope), {
      ok: false,
      failedKind: 'alerts',
      reason: 'artifact-invalid',
    });
    assert.equal(commits, 0);
  }
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

test('an already captured offline map is released on every later abort path', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  const scenarios = [
    {
      name: 'missing required source',
      overrides: { 'comms-plan': async () => null },
      commitGeneration: async () => ({ ok: true }),
      expected: { ok: false, failedKind: 'comms-plan', reason: 'artifact-missing' },
    },
    {
      name: 'thrown required source',
      overrides: { contacts: async () => { throw new Error('contacts unavailable'); } },
      commitGeneration: async () => ({ ok: true }),
      expected: { ok: false, failedKind: 'contacts', reason: 'contacts unavailable' },
    },
    {
      name: 'invalid required artifact',
      overrides: { contacts: async () => ({ ...artifact('contacts'), body: '{not-json' }) },
      commitGeneration: async () => ({ ok: true }),
      expected: { ok: false, failedKind: 'contacts', reason: 'artifact-invalid' },
    },
    {
      name: 'returned commit failure',
      overrides: {},
      commitGeneration: async () => ({ ok: false, reason: 'commit rejected' }),
      expected: { ok: false, reason: 'commit rejected' },
    },
    {
      name: 'thrown commit failure',
      overrides: {},
      commitGeneration: async () => { throw new Error('commit unavailable'); },
      expected: { ok: false, reason: 'commit unavailable' },
    },
  ];

  for (const scenario of scenarios) {
    const released: Artifact[] = [];
    const orchestrator = create({
      sources: sources(scenario.overrides),
      commitGeneration: scenario.commitGeneration,
      releaseArtifact: async (candidate) => { released.push(candidate); },
    });
    assert.deepEqual(await orchestrator.capture({ ...scope }), scenario.expected, scenario.name);
    assert.equal(released.length, 1, scenario.name);
    assert.equal(released[0]?.kind, 'offline-map', scenario.name);
  }
});

test('consent revoked after map capture releases the map before reading private sources', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  let privateReads = 0;
  const released: Artifact[] = [];
  const orchestrator = create({
    sources: sources({
      'offline-map': async (candidate) => {
        candidate.contactConsent = false;
        return artifact('offline-map');
      },
      'comms-plan': async () => { privateReads += 1; return artifact('comms-plan'); },
      contacts: async () => { privateReads += 1; return artifact('contacts'); },
    }),
    commitGeneration: async () => ({ ok: true, packId: 'must-not-commit' }),
    releaseArtifact: async (candidate) => { released.push(candidate); },
  });

  assert.deepEqual(await orchestrator.capture({ ...scope }), {
    ok: false,
    failedKind: 'contacts',
    reason: 'contact-consent-required',
  });
  assert.equal(privateReads, 0);
  assert.equal(released.length, 1);
  assert.equal(released[0]?.kind, 'offline-map');
});

test('release failure cannot turn an aborted capture into success and successful commit never releases', async () => {
  const create = requireFunction(api, 'createEmergencyPackCaptureOrchestrator');
  let releaseAttempts = 0;
  const rejected = create({
    sources: sources(),
    commitGeneration: async () => ({ ok: false, reason: 'commit rejected' }),
    releaseArtifact: async () => { releaseAttempts += 1; throw new Error('release failed'); },
  });
  assert.deepEqual(await rejected.capture({ ...scope }), { ok: false, reason: 'commit rejected' });
  assert.equal(releaseAttempts, 1);

  const committed = create({
    sources: sources(),
    commitGeneration: async () => ({ ok: true, packId: 'pack-success' }),
    releaseArtifact: async () => { releaseAttempts += 1; },
  });
  assert.deepEqual(await committed.capture({ ...scope }), { ok: true, packId: 'pack-success' });
  assert.equal(releaseAttempts, 1, 'successful commit must retain its map generation');
});
