/** Vite and bundled assets share one browser-canonical absolute deployment path. */
export function normalizeDeploymentBase(base = '/'): string {
  const path = base.trim() || '/';
  let browserPath: string | null;
  try {
    browserPath = new URL(path, 'https://deployment.invalid').pathname;
  } catch {
    browserPath = null;
  }
  if (!path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path)
    || browserPath !== path) {
    throw new Error('Deployment base must be a canonical absolute URL path without query, fragment, or traversal');
  }
  if (path === '/') return '/';
  let end = path.length;
  while (end > 1 && path[end - 1] === '/') end -= 1;
  return `${path.slice(0, end)}/`;
}

/** Only bundled static assets belong here; API routes keep their own semantics. */
export function deploymentAssetUrl(assetPath: string, base = import.meta.env?.BASE_URL ?? '/'): string {
  return `${normalizeDeploymentBase(base)}${assetPath.replace(/^\/+/, '')}`;
}
