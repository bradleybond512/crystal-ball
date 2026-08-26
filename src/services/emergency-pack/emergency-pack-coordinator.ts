export type EmergencyPackCoordinatorStatus = 'ready' | 'partial' | 'expired' | 'not-saved';

export interface EmergencyPackCoordinatorScope {
  placeId: string;
  profileFingerprint: string;
}

export interface EmergencyPackCoordinatorState {
  status: EmergencyPackCoordinatorStatus;
  packId: string | null;
  profileFingerprint: string;
}

export interface EmergencyPackCoordinatorDependencies {
  readActive: (scope: EmergencyPackCoordinatorScope) => Promise<EmergencyPackCoordinatorState>;
  recoverActive: (scope: EmergencyPackCoordinatorScope) => Promise<EmergencyPackCoordinatorState>;
  captureAndCommit: (scope: EmergencyPackCoordinatorScope) => Promise<EmergencyPackCoordinatorState>;
}

const STATUSES = new Set<EmergencyPackCoordinatorStatus>([
  'ready',
  'partial',
  'expired',
  'not-saved',
]);

function notSaved(profileFingerprint: string): EmergencyPackCoordinatorState {
  return {
    status: 'not-saved',
    packId: null,
    profileFingerprint,
  };
}

function normalizeState(
  value: EmergencyPackCoordinatorState,
  scope: EmergencyPackCoordinatorScope,
): EmergencyPackCoordinatorState {
  if (
    !value
    || typeof value !== 'object'
    || value.profileFingerprint !== scope.profileFingerprint
    || !STATUSES.has(value.status)
    || (value.packId !== null && (typeof value.packId !== 'string' || value.packId.length === 0))
    || (value.status !== 'not-saved' && value.packId === null)
  ) {
    return notSaved(scope.profileFingerprint);
  }

  return {
    status: value.status,
    packId: value.status === 'not-saved' ? null : value.packId,
    profileFingerprint: scope.profileFingerprint,
  };
}

export function createEmergencyPackCoordinator(dependencies: EmergencyPackCoordinatorDependencies) {
  const states = new Map<string, EmergencyPackCoordinatorState>();
  const generations = new Map<string, number>();

  function begin(scope: EmergencyPackCoordinatorScope): number {
    const generation = (generations.get(scope.placeId) ?? 0) + 1;
    generations.set(scope.placeId, generation);

    const current = states.get(scope.placeId);
    if (current?.profileFingerprint !== scope.profileFingerprint) {
      states.set(scope.placeId, notSaved(scope.profileFingerprint));
    }

    return generation;
  }

  async function run(
    scope: EmergencyPackCoordinatorScope,
    operation: (scope: EmergencyPackCoordinatorScope) => Promise<EmergencyPackCoordinatorState>,
  ): Promise<EmergencyPackCoordinatorState> {
    const expectedScope = {
      placeId: scope.placeId,
      profileFingerprint: scope.profileFingerprint,
    };
    const generation = begin(expectedScope);
    const result = normalizeState(await operation({ ...expectedScope }), expectedScope);

    if (generations.get(expectedScope.placeId) === generation) {
      states.set(expectedScope.placeId, result);
      return { ...result };
    }

    return { ...(states.get(expectedScope.placeId) ?? notSaved(expectedScope.profileFingerprint)) };
  }

  return {
    refresh(scope: EmergencyPackCoordinatorScope): Promise<EmergencyPackCoordinatorState> {
      return run(scope, dependencies.readActive);
    },

    recover(scope: EmergencyPackCoordinatorScope): Promise<EmergencyPackCoordinatorState> {
      return run(scope, dependencies.recoverActive);
    },

    capture(scope: EmergencyPackCoordinatorScope): Promise<EmergencyPackCoordinatorState> {
      return run(scope, dependencies.captureAndCommit);
    },

    getState(placeId: string): EmergencyPackCoordinatorState {
      return { ...(states.get(placeId) ?? notSaved('')) };
    },
  };
}
