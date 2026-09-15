export type SiteVariant = 'full' | 'tech' | 'finance' | 'happy';

const SITE_VARIANTS = new Set<SiteVariant>(['full', 'tech', 'finance', 'happy']);
const requestedVariant = import.meta.env?.VITE_VARIANT as SiteVariant | undefined;

export const SITE_VARIANT: SiteVariant = requestedVariant && SITE_VARIANTS.has(requestedVariant)
  ? requestedVariant
  : 'full';

export function initializeVariant(): void {
  let variant = SITE_VARIANT;
  if (variant === 'full') {
    let stored: string | null = null;
    try { stored = localStorage.getItem('crystalball-variant'); } catch { /* storage unavailable */ }
    if (stored && SITE_VARIANTS.has(stored as SiteVariant)) {
      variant = stored as SiteVariant;
    } else {
      const prefix = location.hostname.split('.')[0];
      if (prefix && SITE_VARIANTS.has(prefix as SiteVariant)) variant = prefix as SiteVariant;
    }
  }
  document.documentElement.dataset.variant = variant;
}
