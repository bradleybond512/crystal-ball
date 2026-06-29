/**
 * Bridge: emit the ProviderSnapshot shape that
 * src/services/diagnostics/provider-redundancy.ts already consumes, so
 * Command Center and SystemDiagnosticPanel keep working unchanged.
 */

import type { ProviderHealthLevel, ProviderSnapshot } from '../diagnostics/provider-redundancy.ts';
import type { ProviderDomain, ProviderStatus } from './provider-types.ts';
import { PROVIDER_DEFINITIONS } from './provider-registry.ts';
import type { ProviderHealthState } from './provider-health.ts';
import { deriveProviderHealth } from './provider-health.ts';

const STATUS_TO_LEVEL: Record<ProviderStatus, ProviderHealthLevel> = {
  healthy: 'healthy',
  degraded: 'degraded',
  down: 'failing',
  stale: 'silent',
  unknown_provider: 'unknown',
};

export function snapshotsFromRegistry(
  state: ProviderHealthState,
  now: number,
  domain?: ProviderDomain,
  fingerprints?: Readonly<Record<string, string>>,
): ProviderSnapshot[] {
  const defs = domain ? PROVIDER_DEFINITIONS.filter((d) => d.domain === domain) : PROVIDER_DEFINITIONS;
  return defs.map((def) => {
    const health = deriveProviderHealth(state, def.id, now);
    const fp = fingerprints?.[def.id];
    return {
      providerId: def.id,
      domain: def.domain,
      label: def.displayName,
      primary: def.fallbackPriority === 1,
      level: STATUS_TO_LEVEL[health.status],
      lastSuccessAt: health.lastSuccessAt,
      successRate: health.successRate,
      lastError: health.lastError,
      ...(fp ? { recentFactFingerprint: fp } : {}),
    };
  });
}
