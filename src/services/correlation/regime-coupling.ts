/**
 * Regime coupling — BOCPD regime shifts modulate correlation.
 *
 * During a detected regime shift the world is re-organizing and
 * cross-domain coupling strengthens: pairs touching shifted domains get
 * a bounded confidence boost, and rules touching them get a wider time
 * window. Boost-only by design — a broken or disabled regime source can
 * never penalize (see edge-confidence's [1, 1.15] regime clamp).
 *
 * Pure deterministic: shifts and `now` are injected; the live bridge
 * (regime-coupling-bridge.ts) is the only stateful reader.
 * See docs/CORRELATION_NEXTGEN_PLAN.md §D5.
 */

import type { RegimeShift } from '../cognition/regime-detection';
import type { ForecastDomain } from '../mode-forecast';

/** Pressure-forecast domains → the observation-domain strings they
 *  govern. Observation domains outside this map never couple to regimes. */
export const FORECAST_TO_OBSERVATION_DOMAINS: Record<ForecastDomain, readonly string[]> = {
  finance: ['markets', 'macro', 'finance', 'crypto', 'stocks'],
  security: ['conflict', 'military', 'security', 'sanctions'],
  disaster: ['weather', 'humanitarian', 'seismic', 'wildfire', 'flood'],
  cyber: ['cyber', 'infrastructure', 'infra'],
};

export interface RegimeContextEntry {
  forecastDomain: ForecastDomain;
  detectedAt: number;
  direction: RegimeShift['direction'];
}

export interface RegimeContext {
  /** observation-domain → the shift governing it (fresh shifts only). */
  shifted: ReadonlyMap<string, RegimeContextEntry>;
}

export const DEFAULT_REGIME_MAX_AGE_MS = 6 * 3_600_000;

export const REGIME_FACTOR_BOTH = 1.15;
export const REGIME_FACTOR_ONE = 1.05;
export const REGIME_WINDOW_MULTIPLIER = 1.5;

export function emptyRegimeContext(): RegimeContext {
  return { shifted: new Map() };
}

/** Project active BOCPD shifts onto observation domains, dropping stale
 *  ones. `now` is injected — never read a clock here. */
export function buildRegimeContext(
  shifts: Partial<Record<ForecastDomain, RegimeShift>>,
  now: number,
  maxAgeMs: number = DEFAULT_REGIME_MAX_AGE_MS,
): RegimeContext {
  const shifted = new Map<string, RegimeContextEntry>();
  for (const [forecastDomain, shift] of Object.entries(shifts) as [ForecastDomain, RegimeShift][]) {
    if (!shift) continue;
    if (!Number.isFinite(shift.detectedAt) || now - shift.detectedAt > maxAgeMs) continue;
    for (const obsDomain of FORECAST_TO_OBSERVATION_DOMAINS[forecastDomain] ?? []) {
      shifted.set(obsDomain, {
        forecastDomain,
        detectedAt: shift.detectedAt,
        direction: shift.direction,
      });
    }
  }
  return { shifted };
}

/** Confidence factor for a candidate pair: both domains under a fresh
 *  shift → 1.15 (co-shift is itself weak corroboration), one → 1.05,
 *  none → 1.0. */
export function regimeFactorFor(
  domainA: string,
  domainB: string,
  ctx: RegimeContext,
): number {
  const a = ctx.shifted.has(domainA);
  const b = ctx.shifted.has(domainB);
  if (a && b) return REGIME_FACTOR_BOTH;
  if (a || b) return REGIME_FACTOR_ONE;
  return 1;
}

/** Rules touching a shifted domain search a wider window — couplings
 *  surface faster while the regime is moving. */
export function windowMultiplierFor(
  ruleDomains: readonly string[],
  ctx: RegimeContext,
): number {
  if (ctx.shifted.size === 0) return 1;
  // Empty domains = any-domain rule; a live shift widens it too.
  if (ruleDomains.length === 0) return REGIME_WINDOW_MULTIPLIER;
  for (const d of ruleDomains) {
    if (ctx.shifted.has(d)) return REGIME_WINDOW_MULTIPLIER;
  }
  return 1;
}
