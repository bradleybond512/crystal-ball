/**
 * Single source of truth for "does the Home Shell boot as the opening
 * surface?" — Phase 2 flipped the default ON for the full desktop
 * variant. Pure core (computeShellGate) + a thin environment reader
 * (isHomeShellDefaultOn) used by panel-layout and shortcut-bootstrap.
 *
 * Keys:
 *   crystalball-classic-view = '1'  → user opted back to the classic UI
 *   crystalball-home-shell   = '1'  → legacy Phase-1 opt-in; NO LONGER
 *                                     CONSULTED (full/desktop is on by
 *                                     default). Read into inputs only so
 *                                     migrations can inspect it.
 */

import { SITE_VARIANT } from '../../config/variant';
// concrete module, not the @/utils barrel — the barrel pulls in Vite-only import.meta.glob and breaks node:test
import { MOBILE_BREAKPOINT_PX } from '../../utils/breakpoint';

export const CLASSIC_VIEW_KEY = 'crystalball-classic-view';
export const LEGACY_OPT_IN_KEY = 'crystalball-home-shell';

export interface ShellGateInputs {
  variant: string;
  viewportWidth: number;
  classicFlag: string | null;
  legacyOptIn: string | null;
}

/** Pure decision core — fixture-testable. */
export function computeShellGate(inputs: ShellGateInputs): boolean {
  if (inputs.variant !== 'full') return false;
  // Width 0 means the window isn't laid out yet (hidden/restored/embedded
  // at boot) — "cannot measure" must not be inferred as mobile. Real mobile
  // devices always report a positive width.
  if (inputs.viewportWidth > 0 && inputs.viewportWidth <= MOBILE_BREAKPOINT_PX) return false;
  if (inputs.classicFlag === '1') return false;
  return true;
}

/**
 * Can the Home Shell mount at all on this build/viewport, IGNORING the classic
 * opt-out? Same as the gate minus the classicFlag check. Used to decide whether
 * to offer the ⌘⇧O shortcut and the classic "New view" button — otherwise
 * opting into classic once removes every way back, stranding the user in
 * classic with no affordance to return.
 */
export function computeShellAvailable(inputs: ShellGateInputs): boolean {
  return computeShellGate({ ...inputs, classicFlag: null });
}

/** Environment reader used at boot. */
export function isHomeShellDefaultOn(): boolean {
  return computeShellGate({
    variant: SITE_VARIANT,
    viewportWidth: window.innerWidth,
    classicFlag: localStorage.getItem(CLASSIC_VIEW_KEY),
    legacyOptIn: localStorage.getItem(LEGACY_OPT_IN_KEY),
  });
}

/** Environment reader: shell can mount here (independent of the classic opt-out). */
export function isHomeShellAvailable(): boolean {
  return computeShellAvailable({
    variant: SITE_VARIANT,
    viewportWidth: window.innerWidth,
    classicFlag: null,
    legacyOptIn: localStorage.getItem(LEGACY_OPT_IN_KEY),
  });
}
