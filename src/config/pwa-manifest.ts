import { deploymentAssetUrl, normalizeDeploymentBase } from '../utils/deployment-base';

export function createPwaManifestPaths(base: string) {
  const deploymentBase = normalizeDeploymentBase(base);
  return {
    start_url: deploymentBase,
    scope: deploymentBase,
    icons: [
      { src: deploymentAssetUrl('favico/android-chrome-192x192.png', deploymentBase), sizes: '192x192', type: 'image/png' },
      { src: deploymentAssetUrl('favico/android-chrome-512x512.png', deploymentBase), sizes: '512x512', type: 'image/png' },
      { src: deploymentAssetUrl('favico/android-chrome-512x512.png', deploymentBase), sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    ],
  };
}
