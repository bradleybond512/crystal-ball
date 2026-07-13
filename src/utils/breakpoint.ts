/** Breakpoint (px): below this width the app uses the simplified mobile layout. Must match CSS @media (max-width: …). */
export const MOBILE_BREAKPOINT_PX = 768;

/** True when viewport is below mobile breakpoint. Touch-capable notebooks keep desktop layout. */
export function isMobileDevice(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}
