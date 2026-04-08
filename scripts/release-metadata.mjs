export const SUPPORTED_RELEASE_VARIANTS = ['full'];

export function assertSupportedReleaseVariant(variant) {
  if (variant !== 'full') {
    throw new Error(`Unsupported release variant: ${variant}`);
  }
  return variant;
}

export function buildReleaseTag(version, variant = 'full') {
  assertSupportedReleaseVariant(variant);
  return `v${version}`;
}

export function buildReleaseName(version, variant = 'full') {
  return `${getReleaseProductName(variant)} v${version}`;
}

export function getReleaseProductName(variant = 'full') {
  assertSupportedReleaseVariant(variant);
  return 'Crystal Ball';
}

export function parseReleaseTag(tagName) {
  const trimmed = String(tagName || '').trim();
  const match = trimmed.match(/^v(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error(`Unsupported release tag: ${tagName}`);
  }

  return {
    tag: trimmed,
    version: match[1],
    variant: 'full',
  };
}

export function parseReleaseRef(refName) {
  const trimmed = String(refName || '').trim();
  const tagName = trimmed.startsWith('refs/tags/') ? trimmed.slice('refs/tags/'.length) : trimmed;
  return parseReleaseTag(tagName);
}
