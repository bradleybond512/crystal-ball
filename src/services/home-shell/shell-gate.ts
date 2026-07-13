/**
 * Single source of truth for "does the Home Shell boot as the opening
 * surface?" — Phase 2 flipped the default ON for the full desktop
 * variant. Pure core (computeShellGate) + a thin environment reader
 * (isHomeShellDefaultOn) used by panel-layout and shortcut-bootstrap.
 *
 * Keys:
 *   crystalball-classic-view = '1'  → user opted back to the classic UI
 *   crystalball-home-shell   = '1'  → legacy Phase-1 opt-in (still honored
 *                                     as ON for full/desktop, but classic
 *                                     flag wins; ignored on other variants)
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
  if (inputs.viewportWidth <= MOBILE_BREAKPOINT_PX) return false;
  if (inputs.classicFlag === '1') return false;
  return true;
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
