export const CORRELATION_LIVENESS_BATCH_LIMIT = 24;
export const CORRELATION_LIVENESS_WINDOW_MS = 6 * 60 * 60_000;
export const CORRELATION_LIVENESS_MIN_BATCHES = 3;

const MAX_DIAGNOSTIC_COUNT = 1_000_000;
const MAX_DIAGNOSTIC_RULES = 100;

export type CorrelationRuntimeMode = 'live' | 'offline_replay';

interface CorrelationBatchSample {
  observationCount: number;
  learnedPairsEmitted: number;
  at: number;
}

interface CorrelationLivenessState {
  learnedRulesInstalled: number;
  batches: CorrelationBatchSample[];
}

let runtimeModes = new WeakMap<object, CorrelationRuntimeMode>();
let states = newStateMap();

export interface CorrelationBatchSizeDistribution {
  singleton: number;
  small: number;
  medium: number;
  large: number;
}

export interface CorrelationLivenessActivity {
  learnedRulesInstalled: number;
  batchCount: number;
  learnedPairsEmitted: number;
  lastBatchAt: number | null;
  batchSizeDistribution: CorrelationBatchSizeDistribution;
}

export interface CorrelationLivenessDiagnostics {
  schemaVersion: 1;
  status: 'unavailable' | 'healthy' | 'degraded';
  reason:
    | 'no_live_activity'
    | 'insufficient_live_batches'
    | 'no_learned_rules_installed'
    | 'learned_rules_active'
    | 'live_activity_observed'
    | 'learned_rules_dormant_on_singletons';
  recentBatchLimit: 24;
  recentWindowMs: number;
  minimumLiveBatches: 3;
  live: CorrelationLivenessActivity;
  offlineReplay: CorrelationLivenessActivity;
}

function emptyActivity(): CorrelationLivenessActivity {
  return {
    learnedRulesInstalled: 0,
    batchCount: 0,
    learnedPairsEmitted: 0,
    lastBatchAt: null,
    batchSizeDistribution: {
      singleton: 0,
      small: 0,
      medium: 0,
      large: 0,
    },
  };
}

export function getCorrelationLivenessDiagnostics(
  now: number = Date.now(),
): CorrelationLivenessDiagnostics {
  const live = summarize(
    states.live,
    Number.isFinite(now) ? now - CORRELATION_LIVENESS_WINDOW_MS : null,
    Number.isFinite(now) ? now : null,
  );
  const offlineReplay = summarize(states.offline_replay, null, null);
  const assessment = assessLive(live);
  return {
    schemaVersion: 1,
    ...assessment,
    recentBatchLimit: CORRELATION_LIVENESS_BATCH_LIMIT,
    recentWindowMs: CORRELATION_LIVENESS_WINDOW_MS,
    minimumLiveBatches: CORRELATION_LIVENESS_MIN_BATCHES,
    live,
    offlineReplay,
  };
}

export function registerCorrelationRuntime(
  runtime: object,
  mode: CorrelationRuntimeMode,
): void {
  try {
    if (!runtime || (mode !== 'live' && mode !== 'offline_replay')) return;
    runtimeModes.set(runtime, mode);
  } catch {
    // Diagnostics must never affect correlation behavior.
  }
}

export function recordLearnedRulesInstalled(runtime: object, count: number): void {
  try {
    const state = stateFor(runtime);
    if (!state || !Number.isInteger(count) || count < 0) return;
    state.learnedRulesInstalled = Math.min(count, MAX_DIAGNOSTIC_RULES);
  } catch {
    // Diagnostics must never affect correlation behavior.
  }
}

export function recordCorrelationBatch(
  runtime: object,
  observationCount: number,
  pairs: readonly { ruleId: string }[],
  at: number,
): void {
  try {
    const state = stateFor(runtime);
    if (
      !state
      || !Number.isInteger(observationCount)
      || observationCount <= 0
      || !Number.isFinite(at)
      || at < 0
      || !Array.isArray(pairs)
    ) return;
    let learnedPairsEmitted = 0;
    for (const pair of pairs as readonly unknown[]) {
      if (!pair || typeof pair !== 'object' || !('ruleId' in pair)) continue;
      const ruleId = pair.ruleId;
      if (typeof ruleId === 'string' && ruleId.startsWith('learned:')) {
        learnedPairsEmitted = Math.min(
          MAX_DIAGNOSTIC_COUNT,
          learnedPairsEmitted + 1,
        );
      }
    }
    state.batches.push({
      observationCount: Math.min(observationCount, MAX_DIAGNOSTIC_COUNT),
      learnedPairsEmitted,
      at,
    });
    if (state.batches.length > CORRELATION_LIVENESS_BATCH_LIMIT) {
      state.batches.splice(
        0,
        state.batches.length - CORRELATION_LIVENESS_BATCH_LIMIT,
      );
    }
  } catch {
    // Diagnostics must never affect correlation behavior.
  }
}

export function __resetCorrelationLivenessForTests(): void {
  runtimeModes = new WeakMap<object, CorrelationRuntimeMode>();
  states = newStateMap();
}

function newStateMap(): Record<CorrelationRuntimeMode, CorrelationLivenessState> {
  return {
    live: { learnedRulesInstalled: 0, batches: [] },
    offline_replay: { learnedRulesInstalled: 0, batches: [] },
  };
}

function stateFor(runtime: object): CorrelationLivenessState | null {
  const mode = runtimeModes.get(runtime);
  return mode ? states[mode] : null;
}

function summarize(
  state: CorrelationLivenessState,
  minimumAt: number | null,
  maximumAt: number | null,
): CorrelationLivenessActivity {
  const activity = emptyActivity();
  activity.learnedRulesInstalled = state.learnedRulesInstalled;
  for (const batch of state.batches) {
    if (minimumAt !== null && batch.at < minimumAt) continue;
    if (maximumAt !== null && batch.at > maximumAt) continue;
    activity.batchCount += 1;
    activity.learnedPairsEmitted = Math.min(
      MAX_DIAGNOSTIC_COUNT,
      activity.learnedPairsEmitted + batch.learnedPairsEmitted,
    );
    activity.lastBatchAt = Math.max(activity.lastBatchAt ?? 0, batch.at);
    const bucket = batchSizeBucket(batch.observationCount);
    activity.batchSizeDistribution[bucket] += 1;
  }
  return activity;
}

function batchSizeBucket(
  observationCount: number,
): keyof CorrelationBatchSizeDistribution {
  if (observationCount === 1) return 'singleton';
  if (observationCount <= 4) return 'small';
  if (observationCount <= 16) return 'medium';
  return 'large';
}

function assessLive(live: CorrelationLivenessActivity): Pick<
  CorrelationLivenessDiagnostics,
  'status' | 'reason'
> {
  if (live.batchCount === 0) {
    return { status: 'unavailable', reason: 'no_live_activity' };
  }
  if (live.batchCount < CORRELATION_LIVENESS_MIN_BATCHES) {
    return { status: 'healthy', reason: 'insufficient_live_batches' };
  }
  if (live.learnedRulesInstalled === 0) {
    return { status: 'healthy', reason: 'no_learned_rules_installed' };
  }
  if (
    live.batchSizeDistribution.singleton === live.batchCount
    && live.learnedPairsEmitted === 0
  ) {
    return {
      status: 'degraded',
      reason: 'learned_rules_dormant_on_singletons',
    };
  }
  if (live.learnedPairsEmitted > 0) {
    return { status: 'healthy', reason: 'learned_rules_active' };
  }
  return { status: 'healthy', reason: 'live_activity_observed' };
}
