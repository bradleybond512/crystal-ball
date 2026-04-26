/**
 * Data Health Monitor — Graceful Degradation Cascade
 *
 * Tracks upstream API health per data source and propagates reduced
 * confidence through dependent systems. When a source goes stale,
 * all downstream consumers that depend on it get a confidence penalty.
 *
 * Sources are registered with their dependencies. When health degrades,
 * the penalty cascades through the dependency graph.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SourceHealth {
  source: string;
  lastSuccess: number;
  lastFailure: number | null;
  consecutiveFailures: number;
  healthy: boolean;
  confidenceMultiplier: number;
}

interface SourceDeps {
  source: string;
  dependsOn: string[];
}

// ── State ────────────────────────────────────────────────────────────────────

const healthMap = new Map<string, SourceHealth>();
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const CRITICAL_STALE_MS = 60 * 60 * 1000;

const DEPENDENCY_GRAPH: SourceDeps[] = [
  { source: 'economic-stress', dependsOn: [] },
  { source: 'financial-contagion', dependsOn: ['economic-stress'] },
  { source: 'mode-forecast', dependsOn: ['financial-contagion', 'situation-engine', 'anomaly-detection'] },
  { source: 'situation-engine', dependsOn: ['unified-alerts', 'correlation-engine'] },
  { source: 'anomaly-detection', dependsOn: [] },
  { source: 'unified-alerts', dependsOn: [] },
  { source: 'correlation-engine', dependsOn: ['unified-alerts'] },
  { source: 'military-flights', dependsOn: [] },
  { source: 'military-surge', dependsOn: ['military-flights'] },
  { source: 'military-patterns', dependsOn: ['military-flights'] },
  { source: 'strike-packages', dependsOn: ['military-flights'] },
  { source: 'dark-vessel', dependsOn: [] },
  { source: 'maritime-air-convergence', dependsOn: ['dark-vessel', 'military-surge'] },
  { source: 'weather-alerts', dependsOn: [] },
  { source: 'weather-threat', dependsOn: ['weather-alerts', 'unified-alerts'] },
  { source: 'country-instability', dependsOn: ['unified-alerts', 'military-flights'] },
  { source: 'ema-forecast', dependsOn: ['unified-alerts'] },
];

// ── Core ─────────────────────────────────────────────────────────────────────

function getOrCreate(source: string): SourceHealth {
  let health = healthMap.get(source);
  if (!health) {
    health = {
      source,
      lastSuccess: Date.now(),
      lastFailure: null,
      consecutiveFailures: 0,
      healthy: true,
      confidenceMultiplier: 1,
    };
    healthMap.set(source, health);
  }
  return health;
}

export function recordSuccess(source: string): void {
  const health = getOrCreate(source);
  health.lastSuccess = Date.now();
  health.consecutiveFailures = 0;
  health.healthy = true;
}

export function recordFailure(source: string): void {
  const health = getOrCreate(source);
  health.lastFailure = Date.now();
  health.consecutiveFailures++;
}

function computeOwnMultiplier(health: SourceHealth): number {
  const now = Date.now();
  const staleness = now - health.lastSuccess;

  if (staleness < STALE_THRESHOLD_MS && health.consecutiveFailures < 3) return 1;
  if (staleness >= CRITICAL_STALE_MS) return 0.3;
  if (health.consecutiveFailures >= 5) return 0.3;

  const staleDecay = Math.max(0.3, 1 - (staleness - STALE_THRESHOLD_MS) / (CRITICAL_STALE_MS - STALE_THRESHOLD_MS) * 0.7);
  const failDecay = Math.max(0.3, 1 - (health.consecutiveFailures - 2) * 0.15);
  return Math.min(staleDecay, failDecay);
}

/**
 * Recompute confidence multipliers for all sources, cascading through deps.
 */
export function recomputeHealth(): void {
  const depMap = new Map(DEPENDENCY_GRAPH.map(d => [d.source, d.dependsOn]));

  for (const [source] of healthMap) {
    const health = healthMap.get(source)!;
    let multiplier = computeOwnMultiplier(health);

    const deps = depMap.get(source) ?? [];
    for (const dep of deps) {
      const depHealth = healthMap.get(dep);
      if (depHealth) {
        multiplier = Math.min(multiplier, 0.5 + depHealth.confidenceMultiplier * 0.5);
      }
    }

    health.confidenceMultiplier = multiplier;
    health.healthy = multiplier > 0.7;
  }
}

/**
 * Get confidence multiplier for a source (cascaded).
 * Returns 1.0 if source is unknown (assume healthy until proven otherwise).
 */
export function getConfidenceMultiplier(source: string): number {
  const health = healthMap.get(source);
  return health?.confidenceMultiplier ?? 1;
}

export function getHealthStatus(): SourceHealth[] {
  recomputeHealth();
  return [...healthMap.values()];
}

export function getDegradedSources(): SourceHealth[] {
  recomputeHealth();
  return [...healthMap.values()].filter(h => !h.healthy);
}
