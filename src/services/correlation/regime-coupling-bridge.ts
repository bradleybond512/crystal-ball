/**
 * Regime-coupling bridge — the only stateful piece of §D5. Reads the
 * BOCPD regime cache (kill-switch respected inside getActiveRegimeShifts:
 * disabled → {} → all-neutral context) and installs providers on the
 * live SituationStoreV2 engine. Context rebuilds are throttled; all
 * math lives in the pure regime-coupling module.
 */

import { getActiveRegimeShifts } from '../cognition/regime-monitor';
import { getSituationStoreV2 } from '../intelligence/situation-store-v2';
import {
  buildRegimeContext,
  emptyRegimeContext,
  regimeFactorFor,
  windowMultiplierFor,
  type RegimeContext,
} from './regime-coupling';

const CONTEXT_TTL_MS = 60_000;

let cached: { at: number; ctx: RegimeContext } | null = null;

function currentContext(now: number): RegimeContext {
  if (!cached || now - cached.at > CONTEXT_TTL_MS) {
    try {
      cached = { at: now, ctx: buildRegimeContext(getActiveRegimeShifts(), now) };
    } catch {
      cached = { at: now, ctx: emptyRegimeContext() };
    }
  }
  return cached.ctx;
}

/** Test hook. */
export function resetRegimeCouplingCache(): void {
  cached = null;
}

let started = false;

/** Install regime providers on the live situation store. Idempotent;
 *  returns a cleanup function. */
export function startRegimeCoupling(store = getSituationStoreV2()): () => void {
  if (started) return noop;
  started = true;
  store.setRegimeProvider({
    factorFor: (domainA, domainB) =>
      regimeFactorFor(domainA, domainB, currentContext(Date.now())),
    windowMultiplierFor: (ruleDomains) =>
      windowMultiplierFor(ruleDomains, currentContext(Date.now())),
  });
  return () => {
    started = false;
    cached = null;
    store.setRegimeProvider();
  };
}

function noop(): void {
  // second start is a no-op; nothing to clean up
}
