export type SiteVariant = 'full' | 'tech' | 'finance' | 'happy';

const SITE_VARIANTS = new Set<SiteVariant>(['full', 'tech', 'finance', 'happy']);
const requestedVariant = import.meta.env?.VITE_VARIANT as SiteVariant | undefined;

export const SITE_VARIANT: SiteVariant = requestedVariant && SITE_VARIANTS.has(requestedVariant)
  ? requestedVariant
  : 'full';
