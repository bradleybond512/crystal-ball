/**
 * Bridge: emit the ProviderSnapshot shape that
 * src/services/diagnostics/provider-redundancy.ts already consumes, so
 * Command Center and SystemDiagnosticPanel keep working unchanged.
 */

import type { ProviderHealthLevel, ProviderSnapshot } from '../diagnostics/provider-redundancy.ts';
import type { ProviderDomain, ProviderStatus, RuntimeSecretKey } from './provider-types.ts';
import { getProviderDefinition, PROVIDER_DEFINITIONS } from './provider-registry.ts';
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

/**
 * Demote providers whose declared `requiredSecret` isn't configured.
 *
 * Such a provider is structurally unreachable — it can never answer. Left
 * alone it fails once at startup, which is short of DOWN_CONSECUTIVE_FAILURES
 * (3), so deriveProviderHealth pins it at 'degraded' — and provider-redundancy
 * counts 'degraded' as UP. The domain then claims corroboration from a source
 * that is not merely down but was never enabled. Several loaders run once at
 * boot, so the third failure that would demote it honestly never arrives.
 *
 * Pure by injection: `isSecretConfigured` comes from the caller, because
 * runtime-config reads localStorage / Tauri IPC and must not leak into this
 * layer. There is deliberately no default — a call site that omits the
 * predicate should not silently fail open.
 *
 * Matched on registry id only. The live diagnostics 'economic' and 'oil' look
 * like FRED and EIA but are aggregates over several upstreams — both fall back
 * to keyless sources that record success — so aliasing them onto the keyed
 * definitions would zero a domain that is actually delivering data.
 */
export function demoteUnconfiguredProviders(
  snapshots: readonly ProviderSnapshot[],
  isSecretConfigured: (key: RuntimeSecretKey) => boolean,
): ProviderSnapshot[] {
  return snapshots.map((snap) => {
    const secret = getProviderDefinition(snap.providerId)?.requiredSecret;
    if (!secret || isSecretConfigured(secret)) return snap;
    return {
      ...snap,
      level: 'failing' as const,
      lastError: `${secret} is not configured — provider cannot be reached.`,
      unconfiguredSecret: secret,
    };
  });
}
