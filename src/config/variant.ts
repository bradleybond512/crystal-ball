export type SiteVariant = 'full' | 'tech' | 'finance' | 'happy';

const SITE_VARIANTS = new Set<SiteVariant>(['full', 'tech', 'finance', 'happy']);
const requestedVariant = import.meta.env?.VITE_VARIANT as SiteVariant | undefined;

// Literal comparisons let explicit full builds fold variant-specific branches.
export const SITE_VARIANT: SiteVariant = requestedVariant === 'tech' || requestedVariant === 'finance' || requestedVariant === 'happy'
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
  if (variant === 'full') delete document.documentElement.dataset.variant;
  else document.documentElement.dataset.variant = variant;
}
