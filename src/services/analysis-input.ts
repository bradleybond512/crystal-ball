export const MAX_CORRELATION_CLUSTERS = 1000;
// Preserve useful cross-topic deduplication while bounding ONNX's quadratic grouping work.
export const MAX_SEMANTIC_CLUSTER_INPUTS = 50;
export const ANALYSIS_TIMEOUT_STALL_GRACE_MS = 1000;

export function boundCorrelationClusters<T>(clusters: T[]): T[] {
  return clusters.length <= MAX_CORRELATION_CLUSTERS
    ? clusters
    : clusters.slice(0, MAX_CORRELATION_CLUSTERS);
}

export function boundSemanticClusters<T>(clusters: T[]): T[] {
  return clusters.length <= MAX_SEMANTIC_CLUSTER_INPUTS
    ? clusters
    : clusters.slice(0, MAX_SEMANTIC_CLUSTER_INPUTS);
}

export function shouldExtendAnalysisTimeout(
  firedAtMs: number,
  deadlineMs: number,
  alreadyExtended: boolean,
): boolean {
  return !alreadyExtended && firedAtMs - deadlineMs >= ANALYSIS_TIMEOUT_STALL_GRACE_MS;
}
