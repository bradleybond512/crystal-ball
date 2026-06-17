import { getApiBaseUrl } from '@/services/runtime';
import { loadProximityConfig } from '@/services/proximity-filter';

export interface HifldAsset {
  type: 'hospital' | 'urgent_care' | 'fuel' | 'shelter';
  name: string;
  address: string;
  phone: string | null;
  beds: number | null;
  subtype: string;
  lat: number | null;
  lon: number | null;
}

export async function fetchNearbyInfrastructure(radiusMiles = 50): Promise<HifldAsset[]> {
  const config = loadProximityConfig();
  if (!config?.location?.lat || !config?.location?.lon) return [];
  try {
 const url = `${getApiBaseUrl()}/api/hifld-infrastructure?lat=${config.location.lat}&lon=${config.location.lon}&radius=${radiusMiles}`;
 const resp = await fetch(url);
 if (!resp.ok) return [];
 const raw = await resp.json() as unknown;
 if (!raw || typeof raw !== 'object') return [];
 const data = raw as { assets?: HifldAsset[] };
 return data.assets ?? [];
  } catch {
 return [];
  }
}
