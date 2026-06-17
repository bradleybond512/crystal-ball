import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export type WebcamSource = 'windy' | 'youtube' | 'dot' | 'custom';
export type WebcamRegion = 'iran' | 'middle-east' | 'europe' | 'asia' | 'americas';
export type EmbedType = 'iframe' | 'image';

export interface WebcamFeed {
  id: string;
  source: WebcamSource;
  title: string;
  city: string;
  country: string;
  region: WebcamRegion;
  lat: number;
  lon: number;
  thumbnailUrl?: string;
  embedUrl: string;
  embedType: EmbedType;
  refreshIntervalMs?: number;
  isLive: boolean;
  lastVerified: number;
  sourceId: string;
}

const YOUTUBE_CURATED = [
  { id: 'iran-tehran', city: 'Tehran', country: 'Iran', region: 'iran' as WebcamRegion, channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'iran-telaviv', city: 'Tel Aviv', country: 'Israel', region: 'iran' as WebcamRegion, channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'iran-jerusalem', city: 'Jerusalem', country: 'Israel', region: 'iran' as WebcamRegion, channelHandle: '@JerusalemLive', fallbackVideoId: 'JHwwZRH2wz8' },
  { id: 'iran-multicam', city: 'Middle East', country: 'Multi', region: 'iran' as WebcamRegion, channelHandle: '@MiddleEastCams', fallbackVideoId: '4E-iFtUM2kk' },
  { id: 'jerusalem', city: 'Jerusalem', country: 'Israel', region: 'middle-east' as WebcamRegion, channelHandle: '@TheWesternWall', fallbackVideoId: 'UyduhBUpO7Q' },
  { id: 'tehran', city: 'Tehran', country: 'Iran', region: 'middle-east' as WebcamRegion, channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'tel-aviv', city: 'Tel Aviv', country: 'Israel', region: 'middle-east' as WebcamRegion, channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'mecca', city: 'Mecca', country: 'Saudi Arabia', region: 'middle-east' as WebcamRegion, channelHandle: '@MakkahLive', fallbackVideoId: 'DEcpmPUbkDQ' },
  { id: 'kyiv', city: 'Kyiv', country: 'Ukraine', region: 'europe' as WebcamRegion, channelHandle: '@DWNews', fallbackVideoId: '-Q7FuPINDjA' },
  { id: 'odessa', city: 'Odessa', country: 'Ukraine', region: 'europe' as WebcamRegion, channelHandle: '@UkraineLiveCam', fallbackVideoId: 'e2gC37ILQmk' },
  { id: 'paris', city: 'Paris', country: 'France', region: 'europe' as WebcamRegion, channelHandle: '@PalaisIena', fallbackVideoId: 'OzYp4NRZlwQ' },
  { id: 'st-petersburg', city: 'St. Petersburg', country: 'Russia', region: 'europe' as WebcamRegion, channelHandle: '@SPBLiveCam', fallbackVideoId: 'CjtIYbmVfck' },
  { id: 'london', city: 'London', country: 'UK', region: 'europe' as WebcamRegion, channelHandle: '@EarthCam', fallbackVideoId: 'Lxqcg1qt0XU' },
  { id: 'washington', city: 'Washington DC', country: 'USA', region: 'americas' as WebcamRegion, channelHandle: '@AxisCommunications', fallbackVideoId: '1wV9lLe14aU' },
  { id: 'new-york', city: 'New York', country: 'USA', region: 'americas' as WebcamRegion, channelHandle: '@EarthCam', fallbackVideoId: '4qyZLflp-sI' },
  { id: 'los-angeles', city: 'Los Angeles', country: 'USA', region: 'americas' as WebcamRegion, channelHandle: '@VeniceVHotel', fallbackVideoId: 'EO_1LWqsCNE' },
  { id: 'miami', city: 'Miami', country: 'USA', region: 'americas' as WebcamRegion, channelHandle: '@FloridaLiveCams', fallbackVideoId: '5YCajRjvWCg' },
  { id: 'taipei', city: 'Taipei', country: 'Taiwan', region: 'asia' as WebcamRegion, channelHandle: '@JackyWuTaipei', fallbackVideoId: 'z_fY1pj1VBw' },
  { id: 'shanghai', city: 'Shanghai', country: 'China', region: 'asia' as WebcamRegion, channelHandle: '@SkylineWebcams', fallbackVideoId: '76EwqI5XZIc' },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', region: 'asia' as WebcamRegion, channelHandle: '@TokyoLiveCam4K', fallbackVideoId: '4pu9sF5Qssw' },
  { id: 'seoul', city: 'Seoul', country: 'South Korea', region: 'asia' as WebcamRegion, channelHandle: '@UNvillage_live', fallbackVideoId: '-JhoMGoAfFc' },
  { id: 'sydney', city: 'Sydney', country: 'Australia', region: 'asia' as WebcamRegion, channelHandle: '@WebcamSydney', fallbackVideoId: '7pcL-0Wo77U' },
];

const WINDY_COUNTRY_TO_REGION: Record<string, WebcamRegion> = {
  IR: 'iran',
  IL: 'middle-east',
  SA: 'middle-east',
  JO: 'middle-east',
  LB: 'middle-east',
  UA: 'europe',
  RU: 'europe',
  FR: 'europe',
  GB: 'europe',
  DE: 'europe',
  PL: 'europe',
  US: 'americas',
  CA: 'americas',
  MX: 'americas',
  BR: 'americas',
  CN: 'asia',
  JP: 'asia',
  KR: 'asia',
  TW: 'asia',
  AU: 'asia',
  IN: 'asia',
};

const CUSTOM_WEBCAMS_KEY = 'crystalball-custom-webcams';

const cache = new Map<string, { feeds: WebcamFeed[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const REGION_TO_COUNTRIES: Record<WebcamRegion, string[]> = {
  iran: ['IR'],
  'middle-east': ['IL', 'SA', 'JO', 'LB', 'IQ', 'SY', 'YE', 'AE', 'QA', 'BH', 'KW', 'OM'],
  europe: ['UA', 'RU', 'FR', 'GB', 'DE', 'PL', 'IT', 'ES', 'NL', 'BE', 'CZ', 'RO', 'SE', 'NO'],
  americas: ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO'],
  asia: ['CN', 'JP', 'KR', 'TW', 'AU', 'IN', 'TH', 'VN', 'PH', 'SG'],
};

export async function fetchWindyWebcams(region?: WebcamRegion): Promise<WebcamFeed[]> {
  try {
    const base = getApiBaseUrl();
    const countries = region ? REGION_TO_COUNTRIES[region] : undefined;
    if (region && (!countries || countries.length === 0)) return [];
    const countryParam = countries ? `&country=${countries.join(',')}` : '&country=US';
    const res = await fetch(`${base}/api/windy-webcams?limit=20${countryParam}`);
    if (!res.ok) return [];
    const data = await res.json() as { webcams?: { id: string; title: string; playerUrl: string; city: string; country: string; countryCode: string; lat: number; lon: number; thumbnail?: string }[] };
    const webcams = Array.isArray(data.webcams) ? data.webcams : [];
    const feeds: WebcamFeed[] = [];
    for (const cam of webcams) {
      const cc = cam.countryCode ?? '';
      const camRegion = WINDY_COUNTRY_TO_REGION[cc] ?? 'europe';
      if (region && camRegion !== region) continue;
      feeds.push({
        id: `windy-${cam.id}`,
        source: 'windy',
        title: cam.title ?? '',
        city: cam.city ?? '',
        country: cam.country ?? '',
        region: camRegion,
        lat: cam.lat ?? 0,
        lon: cam.lon ?? 0,
        thumbnailUrl: cam.thumbnail,
        embedUrl: cam.playerUrl ?? '',
        embedType: 'iframe',
        isLive: true,
        lastVerified: Date.now(),
        sourceId: String(cam.id),
      });
    }
    return feeds;
  } catch {
    return [];
  }
}

export function youtubeToFeeds(region?: WebcamRegion): WebcamFeed[] {
  const base = getApiBaseUrl();
  return YOUTUBE_CURATED
    .filter(f => !region || f.region === region)
    .map(f => ({
      id: `youtube-${f.id}`,
      source: 'youtube' as WebcamSource,
      title: `${f.city} Live`,
      city: f.city,
      country: f.country,
      region: f.region,
      lat: 0,
      lon: 0,
      embedUrl: `${base}/api/youtube-embed?videoId=${f.fallbackVideoId}`,
      embedType: 'iframe' as EmbedType,
      isLive: true,
      lastVerified: Date.now(),
      sourceId: f.fallbackVideoId,
    }));
}

export async function fetchDotCams(region?: WebcamRegion): Promise<WebcamFeed[]> {
  if (region && region !== 'americas') return [];
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/dot-traffic-cams`);
    if (!res.ok) return [];
    const data = await res.json() as { cameras?: { id: string; title: string; state: string; lat: number; lon: number; imageUrl: string; direction: string }[] };
    const cams = Array.isArray(data.cameras) ? data.cameras : [];
    return cams.map(cam => ({
      id: `dot-${cam.id}`,
      source: 'dot' as WebcamSource,
      title: cam.title ?? '',
      city: cam.title ?? '',
      country: 'USA',
      region: 'americas' as WebcamRegion,
      lat: cam.lat ?? 0,
      lon: cam.lon ?? 0,
      embedUrl: cam.imageUrl,
      embedType: 'image' as EmbedType,
      refreshIntervalMs: 30_000,
      isLive: true,
      lastVerified: Date.now(),
      sourceId: String(cam.id),
    }));
  } catch {
    return [];
  }
}

export function getCustomWebcams(): WebcamFeed[] {
  try {
    const stored = localStorage.getItem(CUSTOM_WEBCAMS_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return (parsed as WebcamFeed[]).filter(f => f && typeof f.id === 'string' && typeof f.embedUrl === 'string');
  } catch {
    return [];
  }
}

export function addCustomWebcam(url: string, title: string, city: string, country: string, region: WebcamRegion): void {
  const existing = getCustomWebcams();
  const feed: WebcamFeed = {
    id: `custom-${Date.now()}`,
    source: 'custom',
    title,
    city,
    country,
    region,
    lat: 0,
    lon: 0,
    embedUrl: url,
    embedType: 'iframe',
    isLive: false,
    lastVerified: Date.now(),
    sourceId: url,
  };
  localStorage.setItem(CUSTOM_WEBCAMS_KEY, JSON.stringify([...existing, feed]));
}

export function removeCustomWebcam(id: string): void {
  const existing = getCustomWebcams();
  localStorage.setItem(CUSTOM_WEBCAMS_KEY, JSON.stringify(existing.filter(f => f.id !== id)));
}

export async function getWebcamFeeds(region?: WebcamRegion, limit = 24): Promise<WebcamFeed[]> {
  const cacheKey = region ?? '__all__';
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.feeds.slice(0, limit);
  }

  const [windyResult, dotResult] = await Promise.allSettled([
    fetchWindyWebcams(region),
    fetchDotCams(region),
  ]);

  const windy = windyResult.status === 'fulfilled' ? windyResult.value : [];
  const youtube = youtubeToFeeds(region);
  const dot = dotResult.status === 'fulfilled' ? dotResult.value : [];
  const custom = getCustomWebcams().filter(f => !region || f.region === region);

  const seen = new Set<string>();
  const merged: WebcamFeed[] = [];

  for (const feed of [...windy, ...youtube, ...dot, ...custom]) {
    const key = `${feed.city.toLowerCase()}-${feed.country.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(feed);
    }
  }

  const result = merged.slice(0, limit);

  cache.set(cacheKey, { feeds: merged, expiresAt: Date.now() + CACHE_TTL_MS });

  if (result.length > 0) {
    dataFreshness.recordUpdate('webcams', result.length);
  }

  return result;
}

export function clearWebcamCache(): void {
  cache.clear();
}
