import assert from 'node:assert/strict';
import test from 'node:test';

import { PLACE_ID, PROFILE, requireFunction } from './test-support.mts';

interface CoordinatorApi {
  createEmergencyPackCoordinator?: (dependencies: {
    readActive: (scope: Scope) => Promise<State>;
    recoverActive: (scope: Scope) => Promise<State>;
    captureAndCommit: (scope: Scope) => Promise<State>;
  }) => {
    refresh: (scope: Scope) => Promise<State>;
    recover: (scope: Scope) => Promise<State>;
    capture: (scope: Scope) => Promise<State>;
    getState: (placeId: string) => State;
  };
}

interface Scope {
  placeId: string;
  profileFingerprint: string;
}

interface State {
  status: string;
  packId: string | null;
  profileFingerprint: string;
}

const api = await import('../emergency-pack-coordinator.ts').catch(() => ({} as CoordinatorApi)) as CoordinatorApi;
const scope = { placeId: PLACE_ID, profileFingerprint: PROFILE };
const notSaved = { status: 'not-saved', packId: null, profileFingerprint: PROFILE };

test('invalidation refreshes authoritative state and revokes stale readiness', async () => {
  let authoritative: State = { status: 'ready', packId: 'pack-1', profileFingerprint: PROFILE };
  const create = requireFunction(api, 'createEmergencyPackCoordinator');
  const coordinator = create({
    readActive: async () => ({ ...authoritative }),
    recoverActive: async () => ({ ...authoritative }),
    captureAndCommit: async () => ({ ...authoritative }),
  });

  assert.equal((await coordinator.refresh(scope)).status, 'ready');
  authoritative = notSaved;
  assert.deepEqual(await coordinator.refresh(scope), notSaved);
  assert.deepEqual(coordinator.getState(PLACE_ID), notSaved);
});

test('recovery replaces cached state only with the store verified result', async () => {
  const recovered = { status: 'ready', packId: 'pack-previous', profileFingerprint: PROFILE };
  const create = requireFunction(api, 'createEmergencyPackCoordinator');
  const coordinator = create({
    readActive: async () => notSaved,
    recoverActive: async () => recovered,
    captureAndCommit: async () => notSaved,
  });

  await coordinator.refresh(scope);
  assert.deepEqual(await coordinator.recover(scope), recovered);
  assert.deepEqual(coordinator.getState(PLACE_ID), recovered);
});

test('an older overlapping capture cannot overwrite a newer completion in coordinator state', async () => {
  const completions: Array<(state: State) => void> = [];
  const create = requireFunction(api, 'createEmergencyPackCoordinator');
  const coordinator = create({
    readActive: async () => notSaved,
    recoverActive: async () => notSaved,
    captureAndCommit: () => new Promise((resolve) => completions.push(resolve)),
  });

  const older = coordinator.capture(scope);
  const newer = coordinator.capture(scope);
  completions[1]?.({ status: 'ready', packId: 'pack-new', profileFingerprint: PROFILE });
  assert.equal((await newer).packId, 'pack-new');
  completions[0]?.({ status: 'ready', packId: 'pack-old', profileFingerprint: PROFILE });
  await older;
  assert.equal(coordinator.getState(PLACE_ID).packId, 'pack-new');
});

test('a moved-place refresh cannot expose readiness from the old profile', async () => {
  const create = requireFunction(api, 'createEmergencyPackCoordinator');
  const coordinator = create({
    readActive: async (candidate) => candidate.profileFingerprint === PROFILE
      ? { status: 'ready', packId: 'pack-1', profileFingerprint: PROFILE }
      : { status: 'not-saved', packId: null, profileFingerprint: candidate.profileFingerprint },
    recoverActive: async () => notSaved,
    captureAndCommit: async () => notSaved,
  });

  await coordinator.refresh(scope);
  const moved = await coordinator.refresh({ ...scope, profileFingerprint: `${PROFILE}:moved` });
  assert.equal(moved.status, 'not-saved');
  assert.equal(coordinator.getState(PLACE_ID).status, 'not-saved');
});
