/**
 * Pure decision logic for the Panel loading-honesty budget.
 *
 * A panel spinner may only run while a request is genuinely in flight. When the
 * budget expires with no data, the panel resolves to a truthful STATIC state.
 * The DOM/timer wiring lives in Panel.ts; this module is the pure branch so it
 * is testable without the Vite `?worker` import chain the base class pulls in.
 */

export type StalledResolution = 'unreachable' | 'waiting-on-key';

export interface StalledLoadContext {
  /** Data has arrived but rendering was deferred by the off-screen render gate.
   *  Not a stall — the flush renders it on scroll-in, so do NOT resolve. */
  hasPendingContent: boolean;
  /** This panel declares a required feature (keyed source). */
  requiresFeature: boolean;
  /** Whether that required feature is currently available (key present, etc). */
  featureAvailable: boolean;
}

/**
 * Decide how a panel whose loading budget expired should resolve.
 *  - `null`  → do not resolve (data pending; the gate will flush it).
 *  - `'waiting-on-key'` → the panel needs a key it doesn't have; show the honest
 *    configuration state, not a misleading "unreachable".
 *  - `'unreachable'` → the source genuinely didn't respond; show the retry state.
 */
export function decideStalledResolution(ctx: StalledLoadContext): StalledResolution | null {
  if (ctx.hasPendingContent) return null;
  if (ctx.requiresFeature && !ctx.featureAvailable) return 'waiting-on-key';
  return 'unreachable';
}
