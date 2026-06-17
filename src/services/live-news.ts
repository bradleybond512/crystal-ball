import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

interface LiveVideoInfo {
  videoId: string | null;
  hlsUrl: string | null;
}

const liveVideoCache = new Map<string, { videoId: string | null; hlsUrl: string | null; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchLiveVideoInfo(channelHandle: string): Promise<LiveVideoInfo> {
  const cached = liveVideoCache.get(channelHandle);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
 return { videoId: cached.videoId, hlsUrl: cached.hlsUrl };
  }

  try {
 const baseUrl = isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
 const res = await fetch(`${baseUrl}/api/youtube/live?channel=${encodeURIComponent(channelHandle)}`);
 if (!res.ok) throw new Error('API error');
 const data = await res.json() as { videoId?: string | null; hlsUrl?: string | null };
 if (!data || typeof data !== 'object') {
 dataFreshness.recordError('live-news', 'malformed response');
 return { videoId: null, hlsUrl: null };
 }
 const videoId = data.videoId ?? null;
 const hlsUrl = data.hlsUrl ?? null;
 liveVideoCache.set(channelHandle, { videoId, hlsUrl, timestamp: Date.now() });
 dataFreshness.recordUpdate('live-news', videoId ? 1 : 0);
 return { videoId, hlsUrl };
  } catch (error) {
 dataFreshness.recordError('live-news', String(error));
 // eslint-disable-next-line no-console
 console.warn(`[LiveNews] Failed to fetch live info for ${channelHandle}:`, error);
 return { videoId: null, hlsUrl: null };
  }
}

/** @deprecated Use fetchLiveVideoInfo instead */
export async function fetchLiveVideoId(channelHandle: string): Promise<string | null> {
  const info = await fetchLiveVideoInfo(channelHandle);
  return info.videoId;
}
