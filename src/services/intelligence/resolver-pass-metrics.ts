export const FORECAST_RESOLUTION_GRACE_MS = 15 * 60_000;

export const RESOLVER_METRIC_KEYS = [
  'pending', 'rawOverdueBefore', 'rawOverdueAfter', 'diagnosticOverdueBefore', 'diagnosticOverdueAfter',
  'pastExpiryGrace', 'eligibleOverdueBefore', 'eligibleOverdueAfter', 'opportunities',
  'unsupported', 'invalidCriteria', 'awaitingEvidence', 'windowOpen', 'rejectedWrites',
  'expired', 'direct', 'proxy', 'unattributed', 'persistenceFailures',
] as const;

export type ResolverPassMetrics = Record<typeof RESOLVER_METRIC_KEYS[number], number>;

export function emptyResolverPassMetrics(): ResolverPassMetrics {
  return {
    pending: 0, rawOverdueBefore: 0, rawOverdueAfter: 0, diagnosticOverdueBefore: 0, diagnosticOverdueAfter: 0,
    pastExpiryGrace: 0, eligibleOverdueBefore: 0, eligibleOverdueAfter: 0, opportunities: 0,
    unsupported: 0, invalidCriteria: 0, awaitingEvidence: 0, windowOpen: 0, rejectedWrites: 0,
    expired: 0, direct: 0, proxy: 0, unattributed: 0, persistenceFailures: 0,
  };
}

export interface BridgePassMetrics {
  enabled: boolean;
  shortageExpired: number;
  advisoryExpired: number;
  legacyExpired: number;
  failed: boolean;
}
