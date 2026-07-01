/**
 * Provider Registry + Fusion Core — shared types.
 *
 * See docs/superpowers/specs/2026-06-11-provider-registry-fusion-core-design.md.
 * Pure deterministic layer: no DOM, no fetch, no timers, no globals.
 */

import type { RuntimeSecretKey } from '../runtime-config.ts';


export type ProviderDomain =
  | 'weather'
  | 'disasters'
  | 'adsb'
  | 'aviation'
  | 'commodities'
  | 'food_security'
  | 'conflict'
  | 'cyber'
  | 'cyber_threat'
  | 'markets'
  | 'maritime'
  | 'infrastructure'
  | 'transport'
  | 'space'
  | 'air_quality'
  | 'equities'
  | 'fx';

export type ProviderAuthType = 'none' | 'free_key' | 'account';

export interface ProviderDefinition {
  id: string;
  domain: ProviderDomain;
  displayName: string;
  authType: ProviderAuthType;
  /** Key name from SUPPORTED_SECRET_KEYS when authType !== 'none'. */
  requiredSecret?: RuntimeSecretKey;
  baseUrl: string;
  /** Human note for the diagnostics display. */
  rateLimitNote: string;
  /** How long a successful fetch counts as fresh. */
  freshnessTtlMs: number;
  /** 0..1 prior reliability. */
  reliabilityWeight: number;
  /** 1 = primary for its domain, 2+ = backups. */
  fallbackPriority: number;
  /** Providers sharing an upstream count as ONE independent source. */
  independenceGroup: string;
}

export interface FetchOutcome {
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  /** ms timestamp of the attempt. */
  at: number;
  errorMessage?: string;
}

export type ProviderStatus = 'healthy' | 'stale' | 'degraded' | 'down' | 'unknown_provider';

export interface ProviderHealth {
  providerId: string;
  status: ProviderStatus;
  /** Rolling success rate 0..1 over the retained window (1 when no data). */
  successRate: number;
  /** Median latency of successful fetches; 0 when none. */
  p50LatencyMs: number;
  /** Recent 429s, or repeated 403s after earlier success. */
  quotaSuspected: boolean;
  lastSuccessAt?: number;
  lastError?: string;
  reason: string;
}

export interface SourceObservation {
  providerId: string;
  value: number | string;
  observedAt: number;
}

export interface FusionComponent {
  score: number;
  reason: string;
}

export interface Disagreement {
  providerIds: readonly string[];
  value: number | string;
  reason: string;
}

export type FusionLabel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

export interface FusionResult {
  confidenceMultiplier: number;
  label: FusionLabel;
  components: {
    freshness: FusionComponent;
    reliability: FusionComponent;
    corroboration: FusionComponent;
  };
  disagreements: readonly Disagreement[];
  independentSourceCount: number;
}

export {type RuntimeSecretKey} from '../runtime-config.ts';