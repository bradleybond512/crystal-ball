/**
 * Diagnostics liveness deadman. The registries that feed the diagnostics layer
 * (feature/panel/source health, degradation alerts) are only useful while the
 * boot tick that refreshes them keeps running. If that loop stops (boot-order
 * change, thrown error in the scheduler), every registry silently freezes on
 * its last value and reads green — the exact "green-when-broken" failure the
 * diagnostics remediation targets.
 *
 * The degradation tick stamps a heartbeat here each run; a self-test probe reads
 * the age. A stale heartbeat means "don't trust the other green probes."
 */
let lastBeatAt: number | undefined;

export function recordDiagnosticsHeartbeat(now: number = Date.now()): void {
  lastBeatAt = now;
}

/** Age (ms) since the last heartbeat, or Infinity if it has never run. */
export function diagnosticsHeartbeatAgeMs(now: number = Date.now()): number {
  return lastBeatAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, now - lastBeatAt);
}

/** Test-only reset. */
export function resetDiagnosticsHeartbeatForTest(): void {
  lastBeatAt = undefined;
}
