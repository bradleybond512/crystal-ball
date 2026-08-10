export const MAX_CORRELATION_CLUSTERS = 1000;
export const ANALYSIS_TIMEOUT_STALL_GRACE_MS = 1000;

export function boundCorrelationClusters<T>(clusters: T[]): T[] {
  return clusters.length <= MAX_CORRELATION_CLUSTERS
    ? clusters
    : clusters.slice(0, MAX_CORRELATION_CLUSTERS);
}

export function shouldExtendAnalysisTimeout(
  firedAtMs: number,
  deadlineMs: number,
  alreadyExtended: boolean,
): boolean {
  return !alreadyExtended && firedAtMs - deadlineMs >= ANALYSIS_TIMEOUT_STALL_GRACE_MS;
}
