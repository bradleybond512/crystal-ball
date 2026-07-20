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

let cached: { signature: string; ctx: RegimeContext } | null = null;

/** Re-reads the shift cache on EVERY call (it is a cheap map read that
 *  honors the bocpd kill-switch — disabling must take effect
 *  immediately, never after a TTL) and only memoizes the projection
 *  math, keyed by the shift set's identity. */
function currentContext(now: number): RegimeContext {
  try {
    const shifts = getActiveRegimeShifts();
    // Minute bucket in the key so the 6h staleness cutoff inside
    // buildRegimeContext re-evaluates even when the shift set is static.
    if (Object.keys(shifts).length === 0) return emptyRegimeContext();
    const bucket = Math.floor(now / 60_000);
    const parts = Object.entries(shifts).map(([d, s]) => `${d}:${s?.detectedAt ?? 0}`);
    parts.sort((x, y) => x.localeCompare(y));
    const signature = `${bucket}|${parts.join(',')}`;
    if (cached?.signature !== signature) {
      cached = { signature, ctx: buildRegimeContext(shifts, now) };
    }
    return cached.ctx;
  } catch {
    return emptyRegimeContext();
  }
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
