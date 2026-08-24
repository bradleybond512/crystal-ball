import type { BreakerDataState } from '@/utils/circuit-breaker';

export interface TrackedEarthquakeBatch<T> {
  earthquakes: T[];
  dataState: BreakerDataState;
}

export interface TrackedFredBatch<T> {
  data: T[];
  dataState: BreakerDataState;
}

export interface TrackedRssLoad {
  itemCount: number;
  dataState: BreakerDataState;
}

export interface SuccessfulAdapterUpdate {
  itemCount: number;
  updatedAt: number;
}

export function getEarthquakeSuccessfulUpdate<T>(
  result: TrackedEarthquakeBatch<T>,
  outerFetchFresh: boolean,
): SuccessfulAdapterUpdate | null {
  if (!outerFetchFresh || result.dataState.mode !== 'live' || result.dataState.timestamp === null) return null;
  return { itemCount: result.earthquakes.length, updatedAt: result.dataState.timestamp };
}

export function getFredSuccessfulUpdate<T>(
  result: TrackedFredBatch<T>,
  outerFetchFresh: boolean,
): SuccessfulAdapterUpdate | null {
  if (!outerFetchFresh || result.dataState.mode !== 'live' || result.dataState.timestamp === null) return null;
  return { itemCount: result.data.length, updatedAt: result.dataState.timestamp };
}

export function getRssSuccessfulUpdate(
  loads: readonly TrackedRssLoad[],
): SuccessfulAdapterUpdate | null {
  if (loads.length === 0) return null;
  const dataState = summarizeAdapterDataStates(loads.map((load) => load.dataState));
  if (dataState.mode !== 'live' || dataState.timestamp === null) return null;
  return {
    itemCount: loads.reduce((total, load) => total + load.itemCount, 0),
    updatedAt: dataState.timestamp,
  };
}

export function summarizeAdapterDataStates(states: readonly BreakerDataState[]): BreakerDataState {
  const timestamps = states.flatMap((state) => state.timestamp === null ? [] : [state.timestamp]);
  const timestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const offline = states.some((state) => state.offline);
  if (states.length > 0 && states.every((state) => state.mode === 'live')) {
    return { mode: 'live', timestamp, offline };
  }
  if (states.length > 0 && states.every((state) => state.mode !== 'unavailable')) {
    return { mode: 'cached', timestamp, offline };
  }
  return { mode: 'unavailable', timestamp, offline };
}

export const summarizeRssFeedStates = summarizeAdapterDataStates;

export function getSidecarDataState(payload: unknown): BreakerDataState {
  if (!payload || typeof payload !== 'object') {
    return { mode: 'unavailable', timestamp: null, offline: false };
  }
  const candidate = payload as { provenance?: unknown; fetchedAt?: unknown };
  const timestamp = typeof candidate.fetchedAt === 'number'
    && Number.isFinite(candidate.fetchedAt)
    && candidate.fetchedAt > 0
    ? candidate.fetchedAt
    : null;
  if (timestamp === null || (candidate.provenance !== 'live' && candidate.provenance !== 'cache')) {
    return { mode: 'unavailable', timestamp, offline: false };
  }
  return { mode: candidate.provenance === 'live' ? 'live' : 'cached', timestamp, offline: false };
}

export function getOldestValidTimestamp(...timestamps: (number | null)[]): number | null {
  const valid = timestamps.filter((timestamp): timestamp is number => (
    timestamp !== null && Number.isFinite(timestamp) && timestamp > 0
  ));
  return valid.length > 0 ? Math.min(...valid) : null;
}
