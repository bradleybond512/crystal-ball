export const SUPPORTED_RELEASE_VARIANTS = ['full', 'tech', 'finance'];

// Display names for each variant's product banner. `full` is the flagship
// Crystal Ball; tech/finance are focused-variant spinoffs that share the
// same release pipeline and version cadence.
const VARIANT_PRODUCT_NAMES = {
  full: 'Crystal Ball',
  tech: 'Tech Monitor',
  finance: 'Finance Monitor',
};

export function assertSupportedReleaseVariant(variant) {
  if (!SUPPORTED_RELEASE_VARIANTS.includes(variant)) {
    throw new Error(`Unsupported release variant: ${variant}`);
  }
  return variant;
}

export function buildReleaseTag(version, variant = 'full') {
  assertSupportedReleaseVariant(variant);
  // `full` is the canonical release — untagged — so its tag is just `vX.Y.Z`.
  // Other variants append a `-<variant>` suffix so the release pipeline can
  // distinguish them without a separate tag namespace.
  return variant === 'full' ? `v${version}` : `v${version}-${variant}`;
}

export function buildReleaseName(version, variant = 'full') {
  return `${getReleaseProductName(variant)} v${version}`;
}

export function getReleaseProductName(variant = 'full') {
  assertSupportedReleaseVariant(variant);
  return VARIANT_PRODUCT_NAMES[variant];
}

export function parseReleaseTag(tagName) {
  const trimmed = String(tagName || '').trim();
  // Full variant: `vX.Y.Z`
  const fullMatch = /^v(\d+\.\d+\.\d+)$/.exec(trimmed);
  if (fullMatch) {
    return { tag: trimmed, version: fullMatch[1], variant: 'full' };
  }
  // Variant tag: `vX.Y.Z-<variant>`
  const variantMatch = /^v(\d+\.\d+\.\d+)-([a-z]+)$/.exec(trimmed);
  if (variantMatch) {
    const variant = variantMatch[2];
    if (!SUPPORTED_RELEASE_VARIANTS.includes(variant)) {
      throw new Error(`Unsupported release tag: ${tagName}`);
    }
    return { tag: trimmed, version: variantMatch[1], variant };
  }
  throw new Error(`Unsupported release tag: ${tagName}`);
}

export function parseReleaseRef(refName) {
  const trimmed = String(refName || '').trim();
  const tagName = trimmed.startsWith('refs/tags/') ? trimmed.slice('refs/tags/'.length) : trimmed;
  return parseReleaseTag(tagName);
}
