import { Ion, buildModuleUrl } from 'cesium';
import { deploymentAssetUrl } from '../utils/deployment-base';

export function initCesium(ionToken?: string): void {
  const baseUrl = deploymentAssetUrl('cesium/');
  (window as unknown as Record<string, unknown>).CESIUM_BASE_URL = baseUrl;
  (buildModuleUrl as unknown as { setBaseUrl: (url: string) => void }).setBaseUrl(baseUrl);
  if (ionToken) {
 Ion.defaultAccessToken = ionToken;
  }
}
