import { Ion, buildModuleUrl } from 'cesium';

export function initCesium(ionToken?: string): void {
  (window as unknown as Record<string, unknown>).CESIUM_BASE_URL = '/cesium';
  (buildModuleUrl as unknown as { setBaseUrl: (url: string) => void }).setBaseUrl('/cesium/');
  if (ionToken) {
 Ion.defaultAccessToken = ionToken;
  }
}
