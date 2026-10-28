const BUILD_VARIANTS = ['full', 'tech', 'finance', 'happy'];

/**
 * Vite and the variant identity spec read VITE_VARIANT.
 * SITE_VARIANT is the in-app constant derived from that env var, not an input.
 */
export class VariantEnv {
  static resolve(env) {
    const source = env && typeof env === 'object' ? env : {};
    const vite = typeof source.VITE_VARIANT === 'string' ? source.VITE_VARIANT.trim() : '';
    const site = typeof source.SITE_VARIANT === 'string' ? source.SITE_VARIANT.trim() : '';
    if (site && vite && site !== vite) {
      throw new Error(`SITE_VARIANT=${site} disagrees with VITE_VARIANT=${vite}. Vite reads VITE_VARIANT only.`);
    }
    if (site && !vite) {
      throw new Error(`SITE_VARIANT=${site} is not a Vite env var. Set VITE_VARIANT=${site}.`);
    }
    const candidate = vite || 'full';
    if (!BUILD_VARIANTS.includes(candidate)) {
      throw new Error(`Unsupported VITE_VARIANT "${candidate}". Expected one of: ${BUILD_VARIANTS.join(', ')}`);
    }
    return candidate;
  }
}
