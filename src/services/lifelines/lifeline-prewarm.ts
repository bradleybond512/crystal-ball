import {
  buildLifelinePrewarmFingerprint,
  fetchLocalLogistics,
  resolveLifelinePrewarmRadius,
  type LocalLogisticsRadiusChoiceKm,
  type LocalLogisticsSnapshot,
} from '../local-logistics';
import type { SavedPlace } from '../saved-places';
import { verifyExactLifelinesSnapshot } from './lifeline-runtime';

export type LifelinePrewarmTrigger = 'manual' | 'startup' | 'storm';
export type LifelinePrewarmPhase =
  | 'queued'
  | 'fetching'
  | 'verifying'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'cooldown';

export interface LifelinePrewarmState {
  placeId: string;
  radiusKm: LocalLogisticsRadiusChoiceKm;
  queryFingerprint: string;
  phase: LifelinePrewarmPhase;
  triggers: LifelinePrewarmTrigger[];
  retryAt: number | null;
  error: string | null;
}

interface VerificationResult {
  status: 'ready' | 'partial';
  exact: boolean;
}

export interface LifelinePrewarmCoordinatorOptions {
  now?: () => number;
  fetchSnapshot?: (
    place: SavedPlace,
    options: { radiusKm: LocalLogisticsRadiusChoiceKm },
  ) => Promise<LocalLogisticsSnapshot>;
  verifySnapshot?: (
    snapshot: LocalLogisticsSnapshot,
    place: SavedPlace,
    radiusKm: LocalLogisticsRadiusChoiceKm,
  ) => VerificationResult | null | Promise<VerificationResult | null>;
}

export interface LifelinePrewarmCoordinator {
  enqueue(input: {
    place: SavedPlace;
    radiusKm?: number;
    trigger: LifelinePrewarmTrigger;
  }): void;
  retry(placeId: string, queryFingerprint: string): void;
  getState(placeId: string): LifelinePrewarmState | null;
  subscribe(listener: (state: LifelinePrewarmState) => void): () => void;
  resolveRadius(place: SavedPlace, explicitRadiusKm?: number): LocalLogisticsRadiusChoiceKm;
  destroy(): void;
}

interface Job {
  place: SavedPlace;
  radiusKm: LocalLogisticsRadiusChoiceKm;
  queryFingerprint: string;
  triggers: LifelinePrewarmTrigger[];
  generation: number;
  failureCount: number;
}

const SUCCESS_COOLDOWN_MS = 15 * 60_000;
const INITIAL_FAILURE_BACKOFF_MS = 30_000;
const MAX_FAILURE_BACKOFF_MS = 15 * 60_000;
const MAX_TRACKED_JOBS = 100;
const MAX_CONCURRENCY = 2;
const PREWARM_FAILURE_MESSAGE = 'Offline Lifelines preparation failed. Check your connection and try again.';

function cloneState(state: LifelinePrewarmState): LifelinePrewarmState {
  return { ...state, triggers: [...state.triggers] };
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= MAX_TRACKED_JOBS) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function appendTrigger(
  triggers: LifelinePrewarmTrigger[],
  trigger: LifelinePrewarmTrigger,
): LifelinePrewarmTrigger[] {
  return triggers.includes(trigger) ? triggers : [...triggers, trigger];
}

function jobKey(placeId: string, queryFingerprint: string): string {
  return `${placeId}|${queryFingerprint}`;
}

export function createLifelinePrewarmCoordinator(
  options: LifelinePrewarmCoordinatorOptions = {},
): LifelinePrewarmCoordinator {
  const now = options.now ?? Date.now;
  const fetchSnapshot = options.fetchSnapshot ?? ((place, fetchOptions) => (
    fetchLocalLogistics(place, fetchOptions)
  ));
  const verifySnapshot = options.verifySnapshot ?? ((snapshot, place, radiusKm) => (
    verifyExactLifelinesSnapshot(place, radiusKm, snapshot)
  ));
  const states = new Map<string, LifelinePrewarmState>();
  const jobs = new Map<string, Job>();
  const generations = new Map<string, number>();
  const successAt = new Map<string, number>();
  const failedUntil = new Map<string, number>();
  const listeners = new Set<(state: LifelinePrewarmState) => void>();
  const activePlaces = new Set<string>();
  const queue: Job[] = [];
  let activeCount = 0;
  let destroyed = false;

  const isCurrent = (job: Job): boolean => (
    !destroyed && generations.get(job.place.id) === job.generation
  );

  const publish = (
    job: Job,
    phase: LifelinePrewarmPhase,
    retryAt: number | null = null,
    error: string | null = null,
  ): void => {
    if (!isCurrent(job)) return;
    const state: LifelinePrewarmState = {
      placeId: job.place.id,
      radiusKm: job.radiusKm,
      queryFingerprint: job.queryFingerprint,
      phase,
      triggers: [...job.triggers],
      retryAt,
      error,
    };
    boundedSet(states, job.place.id, state);
    for (const listener of listeners) {
      try {
        listener(cloneState(state));
      } catch {
        // A presentation listener cannot interrupt preparation or other listeners.
      }
    }
  };

  const pump = (): void => {
    if (destroyed) return;
    while (activeCount < MAX_CONCURRENCY) {
      const nextIndex = queue.findIndex((job) => !activePlaces.has(job.place.id));
      if (nextIndex === -1) return;
      const [job] = queue.splice(nextIndex, 1);
      if (!job || !isCurrent(job)) continue;
      activeCount += 1;
      activePlaces.add(job.place.id);
      void run(job).finally(() => {
        activeCount -= 1;
        activePlaces.delete(job.place.id);
        pump();
      });
    }
  };

  const run = async (job: Job): Promise<void> => {
    publish(job, 'fetching');
    try {
      const snapshot = await fetchSnapshot(job.place, { radiusKm: job.radiusKm });
      if (!isCurrent(job)) return;
      publish(job, 'verifying');
      const verification = await verifySnapshot(snapshot, job.place, job.radiusKm);
      if (!isCurrent(job)) return;
      if (snapshot.source !== 'network') throw new Error('Only cached Lifelines were available');
      if (!verification?.exact
        || (verification.status !== 'ready' && verification.status !== 'partial')) {
        throw new Error('The exact Lifelines snapshot could not be verified after saving');
      }
      failedUntil.delete(jobKey(job.place.id, job.queryFingerprint));
      job.failureCount = 0;
      boundedSet(successAt, jobKey(job.place.id, job.queryFingerprint), now());
      publish(job, verification.status);
    } catch {
      if (!isCurrent(job)) return;
      job.failureCount += 1;
      const delay = Math.min(
        MAX_FAILURE_BACKOFF_MS,
        INITIAL_FAILURE_BACKOFF_MS * 2 ** Math.max(0, job.failureCount - 1),
      );
      const retryAt = now() + delay;
      boundedSet(failedUntil, jobKey(job.place.id, job.queryFingerprint), retryAt);
      publish(
        job,
        'failed',
        retryAt,
        PREWARM_FAILURE_MESSAGE,
      );
    }
  };

  const queueJob = (job: Job): void => {
    boundedSet(jobs, jobKey(job.place.id, job.queryFingerprint), job);
    publish(job, 'queued');
    const supersededIndex = queue.findIndex((queued) => queued.place.id === job.place.id);
    if (supersededIndex !== -1) queue.splice(supersededIndex, 1);
    if (queue.length >= MAX_TRACKED_JOBS) queue.shift();
    queue.push(job);
    pump();
  };

  const handleExistingJob = (
    prior: Job | undefined,
    currentGeneration: number | undefined,
    key: string,
    queryFingerprint: string,
    trigger: LifelinePrewarmTrigger,
  ): boolean => {
    if (!prior || prior.generation !== currentGeneration) return false;
    prior.triggers = appendTrigger(prior.triggers, trigger);
    const currentState = states.get(prior.place.id);
    if (currentState?.queryFingerprint !== queryFingerprint) return false;
    const succeededAt = successAt.get(key);
    const cooldownActive = succeededAt !== undefined && now() - succeededAt < SUCCESS_COOLDOWN_MS;
    if (cooldownActive && (
      currentState.phase === 'ready'
      || currentState.phase === 'partial'
      || currentState.phase === 'cooldown'
    )) {
      publish(prior, 'cooldown', succeededAt + SUCCESS_COOLDOWN_MS);
      return true;
    }
    if (currentState.phase === 'failed'
      && currentState.retryAt !== null && now() < currentState.retryAt) {
      publish(prior, 'failed', currentState.retryAt, currentState.error);
      return true;
    }
    if (currentState.phase === 'queued'
      || currentState.phase === 'fetching'
      || currentState.phase === 'verifying') {
      publish(prior, currentState.phase, currentState.retryAt, currentState.error);
      return true;
    }
    return false;
  };

  const enqueue: LifelinePrewarmCoordinator['enqueue'] = ({ place, radiusKm, trigger }) => {
    if (destroyed) return;
    const resolvedRadiusKm = resolveLifelinePrewarmRadius(place, radiusKm);
    const queryFingerprint = buildLifelinePrewarmFingerprint(place, resolvedRadiusKm);
    const key = jobKey(place.id, queryFingerprint);
    const prior = jobs.get(key);
    const currentGeneration = generations.get(place.id);
    if (handleExistingJob(prior, currentGeneration, key, queryFingerprint, trigger)) return;

    const triggers = appendTrigger(prior?.triggers ?? [], trigger);
    const succeededAt = successAt.get(key);
    const generation = (currentGeneration ?? 0) + 1;
    boundedSet(generations, place.id, generation);
    const job: Job = {
      place: { ...place, tags: [...place.tags] },
      radiusKm: resolvedRadiusKm,
      queryFingerprint,
      triggers,
      generation,
      failureCount: prior?.failureCount ?? 0,
    };
    boundedSet(jobs, key, job);

    if (succeededAt !== undefined && now() - succeededAt < SUCCESS_COOLDOWN_MS) {
      publish(job, 'cooldown', succeededAt + SUCCESS_COOLDOWN_MS);
      return;
    }
    const retryAt = failedUntil.get(key);
    if (retryAt !== undefined && now() < retryAt) {
      publish(job, 'failed', retryAt, prior ? states.get(place.id)?.error ?? PREWARM_FAILURE_MESSAGE : PREWARM_FAILURE_MESSAGE);
      return;
    }
    queueJob(job);
  };

  return {
    enqueue,
    retry(placeId, queryFingerprint): void {
      if (destroyed) return;
      const key = jobKey(placeId, queryFingerprint);
      const failed = jobs.get(key);
      const state = states.get(placeId);
      if (!failed || state?.phase !== 'failed' || state.queryFingerprint !== queryFingerprint) return;
      failedUntil.delete(key);
      const generation = (generations.get(placeId) ?? 0) + 1;
      boundedSet(generations, placeId, generation);
      const retryJob: Job = {
        ...failed,
        place: { ...failed.place, tags: [...failed.place.tags] },
        triggers: [...failed.triggers],
        generation,
      };
      queueJob(retryJob);
    },
    getState(placeId): LifelinePrewarmState | null {
      const state = states.get(placeId);
      return state ? cloneState(state) : null;
    },
    subscribe(listener): () => void {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveRadius: resolveLifelinePrewarmRadius,
    destroy(): void {
      destroyed = true;
      queue.length = 0;
      listeners.clear();
      states.clear();
      jobs.clear();
      generations.clear();
      successAt.clear();
      failedUntil.clear();
    },
  };
}

export const lifelinePrewarmCoordinator = createLifelinePrewarmCoordinator();
