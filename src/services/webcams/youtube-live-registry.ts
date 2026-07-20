export interface YoutubeLiveFeed {
  id: string;
  city: string;
  country: string;
  region: 'iran' | 'middle-east' | 'europe' | 'americas' | 'asia';
  /** City coordinates — used to plot the stream on the panel's map view. */
  lat: number;
  lon: number;
  channelHandle: string;
  fallbackVideoId: string;
}

// Verified YouTube live stream IDs — validated Feb 2026 via title cross-check.
// IDs may rotate; update when stale.
export const YOUTUBE_LIVE_FEEDS: YoutubeLiveFeed[] = [
  // Iran Attacks — Tehran, Tel Aviv, Jerusalem
  { id: 'iran-tehran', city: 'Tehran', country: 'Iran', region: 'iran', lat: 35.6892, lon: 51.389, channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'iran-telaviv', city: 'Tel Aviv', country: 'Israel', region: 'iran', lat: 32.0853, lon: 34.7818, channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'iran-jerusalem', city: 'Jerusalem', country: 'Israel', region: 'iran', lat: 31.7683, lon: 35.2137, channelHandle: '@JerusalemLive', fallbackVideoId: 'JHwwZRH2wz8' },
  { id: 'iran-multicam', city: 'Middle East', country: 'Multi', region: 'iran', lat: 30, lon: 45, channelHandle: '@MiddleEastCams', fallbackVideoId: '4E-iFtUM2kk' },
  // Middle East — Jerusalem & Tehran adjacent (conflict hotspots)
  { id: 'jerusalem', city: 'Jerusalem', country: 'Israel', region: 'middle-east', lat: 31.7683, lon: 35.2137, channelHandle: '@TheWesternWall', fallbackVideoId: 'UyduhBUpO7Q' },
  { id: 'tehran', city: 'Tehran', country: 'Iran', region: 'middle-east', lat: 35.6892, lon: 51.389, channelHandle: '@IranHDCams', fallbackVideoId: '-zGuR1qVKrU' },
  { id: 'tel-aviv', city: 'Tel Aviv', country: 'Israel', region: 'middle-east', lat: 32.0853, lon: 34.7818, channelHandle: '@IsraelLiveCam', fallbackVideoId: 'gmtlJ_m2r5A' },
  { id: 'mecca', city: 'Mecca', country: 'Saudi Arabia', region: 'middle-east', lat: 21.4225, lon: 39.8262, channelHandle: '@MakkahLive', fallbackVideoId: 'DEcpmPUbkDQ' },
  // Europe
  { id: 'kyiv', city: 'Kyiv', country: 'Ukraine', region: 'europe', lat: 50.4501, lon: 30.5234, channelHandle: '@DWNews', fallbackVideoId: '-Q7FuPINDjA' },
  { id: 'odessa', city: 'Odessa', country: 'Ukraine', region: 'europe', lat: 46.4825, lon: 30.7233, channelHandle: '@UkraineLiveCam', fallbackVideoId: 'e2gC37ILQmk' },
  { id: 'paris', city: 'Paris', country: 'France', region: 'europe', lat: 48.8566, lon: 2.3522, channelHandle: '@PalaisIena', fallbackVideoId: 'OzYp4NRZlwQ' },
  { id: 'st-petersburg', city: 'St. Petersburg', country: 'Russia', region: 'europe', lat: 59.9311, lon: 30.3609, channelHandle: '@SPBLiveCam', fallbackVideoId: 'CjtIYbmVfck' },
  { id: 'london', city: 'London', country: 'UK', region: 'europe', lat: 51.5074, lon: -0.1278, channelHandle: '@EarthCam', fallbackVideoId: 'Lxqcg1qt0XU' },
  // Americas
  { id: 'washington', city: 'Washington DC', country: 'USA', region: 'americas', lat: 38.9072, lon: -77.0369, channelHandle: '@AxisCommunications', fallbackVideoId: '1wV9lLe14aU' },
  { id: 'new-york', city: 'New York', country: 'USA', region: 'americas', lat: 40.7128, lon: -74.006, channelHandle: '@EarthCam', fallbackVideoId: '4qyZLflp-sI' },
  { id: 'los-angeles', city: 'Los Angeles', country: 'USA', region: 'americas', lat: 34.0522, lon: -118.2437, channelHandle: '@VeniceVHotel', fallbackVideoId: 'EO_1LWqsCNE' },
  { id: 'miami', city: 'Miami', country: 'USA', region: 'americas', lat: 25.7617, lon: -80.1918, channelHandle: '@FloridaLiveCams', fallbackVideoId: '5YCajRjvWCg' },
  // Asia-Pacific — Taipei first (strait hotspot), then Shanghai, Tokyo, Seoul
  { id: 'taipei', city: 'Taipei', country: 'Taiwan', region: 'asia', lat: 25.033, lon: 121.5654, channelHandle: '@JackyWuTaipei', fallbackVideoId: 'z_fY1pj1VBw' },
  { id: 'shanghai', city: 'Shanghai', country: 'China', region: 'asia', lat: 31.2304, lon: 121.4737, channelHandle: '@SkylineWebcams', fallbackVideoId: '76EwqI5XZIc' },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', region: 'asia', lat: 35.6762, lon: 139.6503, channelHandle: '@TokyoLiveCam4K', fallbackVideoId: '4pu9sF5Qssw' },
  { id: 'seoul', city: 'Seoul', country: 'South Korea', region: 'asia', lat: 37.5665, lon: 126.978, channelHandle: '@UNvillage_live', fallbackVideoId: '-JhoMGoAfFc' },
  { id: 'sydney', city: 'Sydney', country: 'Australia', region: 'asia', lat: -33.8688, lon: 151.2093, channelHandle: '@WebcamSydney', fallbackVideoId: '7pcL-0Wo77U' },
];

export function feedsForRegion(region: string): YoutubeLiveFeed[] {
  if (!region || region === 'all') return YOUTUBE_LIVE_FEEDS;
  return YOUTUBE_LIVE_FEEDS.filter((f) => f.region === region);
}
