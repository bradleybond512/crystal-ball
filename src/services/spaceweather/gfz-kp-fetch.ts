/**
 * Fail-closed fetches for the two space_weather Kp voters.
 *
 * NOAA SWPC rides on /api/spaceweather/status, which the sidecar already
 * fetches and caches for the geomag panel — deliberately NOT a second request
 * for the same upstream product. GFZ Potsdam has its own route.
 */

import { getApiBaseUrl } from '@/services/runtime';
import type { KpSample } from './kp-fusion-observations';

export interface KpFetchResult {
  ok: boolean;
  samples: KpSample[];
}

/**
 * Both sources are trimmed to the same rolling 48h so their bin sets line up.
 * NOAA publishes ~7 days of bins and GFZ's route asks for 48h; without the
 * trim NOAA's extra ~44 bins would each fuse as a permanent single-vote fact.
 */
const KP_FUSION_WINDOW_MS = 48 * 60 * 60 * 1000;

// Must exceed the sidecar's 12s upstream deadline, or the renderer gives up
// while the sidecar is still working and a slow-but-successful upstream reads
// as a hard failure.
const RENDERER_TIMEOUT_MS = 15_000;

function failed(): KpFetchResult {
  return { ok: false, samples: [] };
}

function withinWindow(samples: KpSample[], now: number): KpSample[] {
  const cutoff = now - KP_FUSION_WINDOW_MS;
  return samples.filter((s) => s.observedAt >= cutoff);
}

/** NOAA SWPC estimated planetary Kp, read off the cached status payload. */
export async function fetchSwpcKp(): Promise<KpFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/spaceweather/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(RENDERER_TIMEOUT_MS),
    });
    if (!res.ok) return failed();
    const data = (await res.json()) as { kpPoints?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    if (!Array.isArray(data.kpPoints)) return failed();
    const samples: KpSample[] = [];
    for (const point of data.kpPoints as { time_tag?: unknown; kp?: unknown }[]) {
      if (!point || typeof point !== 'object') continue;
      // The sidecar normalizer stamps an explicit Z, so this is TZ-safe. A
      // suffix-less tag would be read as host-local and land in the wrong bin.
      const observedAt = typeof point.time_tag === 'string' ? Date.parse(point.time_tag) : Number.NaN;
      const kp = typeof point.kp === 'number' ? point.kp : Number.NaN;
      if (!Number.isFinite(observedAt) || !Number.isFinite(kp)) continue;
      samples.push({ observedAt, kp });
    }
    const recent = withinWindow(samples, Date.now());
    // An empty series is a failure, not a quiet success: a provider that
    // returns nothing must record ok:false so its health goes down, rather
    // than looking healthy while contributing no votes.
    if (recent.length === 0) return failed();
    return { ok: true, samples: recent };
  } catch {
    return failed();
  }
}

/** GFZ Potsdam Kp — the corroborating vote. */
export async function fetchGfzKp(): Promise<KpFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/spaceweather-kp-gfz`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(RENDERER_TIMEOUT_MS),
    });
    if (!res.ok) return failed();
    const data = (await res.json()) as { samples?: unknown; degraded?: boolean } | null;
    if (!data || data.degraded) return failed();
    if (!Array.isArray(data.samples)) return failed();
    const samples: KpSample[] = [];
    for (const sample of data.samples as { observedAt?: unknown; kp?: unknown }[]) {
      if (!sample || typeof sample !== 'object') continue;
      const observedAt = typeof sample.observedAt === 'number' ? sample.observedAt : Number.NaN;
      const kp = typeof sample.kp === 'number' ? sample.kp : Number.NaN;
      if (!Number.isFinite(observedAt) || !Number.isFinite(kp)) continue;
      samples.push({ observedAt, kp });
    }
    const recent = withinWindow(samples, Date.now());
    if (recent.length === 0) return failed();
    return { ok: true, samples: recent };
  } catch {
    return failed();
  }
}
