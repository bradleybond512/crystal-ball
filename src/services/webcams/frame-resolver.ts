/**
 * Resolve a webcam feed's `snapshotUrl` to a directly-loadable image URL.
 *
 * Most feeds carry an absolute https image URL that an <img> can load directly
 * (CSP img-src allows `https:`). But FAA feeds (~65% of the catalog) carry a
 * RELATIVE resolver path — `/api/faa-camera-image?cameraId=…` — that returns
 * JSON `{ imageUrl, frames }`, NOT image bytes. The panel used to assign that
 * JSON endpoint straight to `img.src`, so every FAA camera rendered blank (and
 * in the packaged app the relative path doesn't even reach the sidecar). Here
 * we do the resolve step: fetch the JSON from the sidecar (the runtime fetch
 * patch auto-attaches the bearer token) and hand back the real https image URL.
 */
import { getApiBaseUrl } from '@/services/runtime';

interface FaaFrameResponse {
  imageUrl?: string | null;
  frames?: { imageUrl?: string }[];
}

/**
 * @returns a directly-loadable image URL, or null if the feed has no current
 *   frame (degraded upstream) or the resolve failed.
 */
export async function resolveFrameUrl(
  snapshotUrl: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!snapshotUrl) return null;
  // Absolute URLs are already image bytes — load them directly.
  if (!snapshotUrl.startsWith('/api/')) return snapshotUrl;
  try {
    const res = await fetch(`${getApiBaseUrl()}${snapshotUrl}`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as FaaFrameResponse;
    return data.imageUrl ?? data.frames?.[0]?.imageUrl ?? null;
  } catch {
    return null;
  }
}

/** True when the feed needs a JSON resolve step (vs. a direct-loadable URL). */
export function needsFrameResolve(snapshotUrl: string | undefined): boolean {
  return !!snapshotUrl && snapshotUrl.startsWith('/api/');
}
