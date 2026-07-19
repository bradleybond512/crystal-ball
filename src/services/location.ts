/**
 * LocationService — single entry point for "where is the user right now?"
 *
 * Multiple panels and bootstrap paths each ran their own location lookup:
 * `resolveUserRegion` at app boot, `getCurrentGpsLocation` from the location
 * gate, `get_native_location` direct from WelcomeFlow, and the GpsTracker
 * tier-1 swift subprocess polled every second. Every distinct lookup path
 * could surface its own macOS Location Services prompt.
 *
 * This service collapses all one-shot lookups into a single IPC against the
 * Rust-side `get_native_location` (which talks to the app-retained
 * CLLocationManager) on desktop, falling back to `navigator.geolocation` on
 * the web. Results are cached for the lifetime of the renderer with an
 * optional max-age guard for callers that genuinely need a fresh fix
 * (e.g. user explicitly tapping "Use my location").
 *
 * Long-running subscriptions (the GpsTracker's 1Hz updates inside
 * GodsVisionView) are *not* routed through here — they own a single
 * subscription each and aren't the source of the duplicate prompts.
 */
import { invokeTauri, hasTauriInvokeBridge } from '@/services/tauri-bridge';

export interface LocationFix {
  lat: number;
  lon: number;
  accuracy?: number;
  timestamp: number;
  source: 'native' | 'browser';
}

interface GetLocationOptions {
  /**
   * Reject a cached fix older than this many ms. Defaults to 5 minutes —
   * the same maximumAge already used by `resolveUserRegion`.
   */
  maxAgeMs?: number;
  /** Bypass the cache and force a fresh lookup. */
  force?: boolean;
  /** Underlying IPC / browser timeout. */
  timeoutMs?: number;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

class LocationService {
  private cached: LocationFix | null = null;
  private inflight: Promise<LocationFix> | null = null;

  getCached(): LocationFix | null {
    return this.cached;
  }

  async getLocation(opts: GetLocationOptions = {}): Promise<LocationFix> {
    const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (!opts.force && this.cached && Date.now() - this.cached.timestamp < maxAge) {
      return this.cached;
    }
    if (this.inflight) return this.inflight;

    const pending = this.fetchLocation(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      .then((fix) => {
        this.cached = fix;
        this.inflight = null;
        return fix;
      })
      .catch((error) => {
        this.inflight = null;
        throw error;
      });

    this.inflight = pending;
    return pending;
  }

  /** Drop the cached fix; the next `getLocation` issues a fresh lookup. */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchLocation(timeoutMs: number): Promise<LocationFix> {
    if (hasTauriInvokeBridge()) {
      // Cast to `unknown` first — Rust can return null or an unexpected shape
      // during early boot before CLLocationManager is ready. Destructuring an
      // undefined tuple would silently inject NaN into every geo calculation.
      const result = await invokeTauri<unknown>('get_native_location');
      if (
        !Array.isArray(result) ||
        result.length < 2 ||
        // Number.isFinite rejects NaN/Infinity (which typeof 'number' accepts)
        // and the range check rejects impossible coordinates before they reach
        // any geo calculation.
        !Number.isFinite(result[0]) ||
        !Number.isFinite(result[1]) ||
        (result[0] as number) < -90 || (result[0] as number) > 90 ||
        (result[1] as number) < -180 || (result[1] as number) > 180
      ) {
        throw new Error(`get_native_location: unexpected response shape — got ${JSON.stringify(result)}`);
      }
      const [lat, lon] = result as [number, number];
      return { lat, lon, timestamp: Date.now(), source: 'native' };
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('Geolocation not supported in this environment');
    }

    return new Promise<LocationFix>((resolve, reject) => {
      // eslint-disable-next-line sonarjs/no-intrusive-permissions
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
          source: 'browser',
        }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error('Location permission denied. Enable in System Settings → Privacy & Security → Location Services.'));
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            reject(new Error('Location unavailable. Check that Wi-Fi or GPS is enabled.'));
          } else {
            reject(new Error(`Location timed out. ${err.message}`));
          }
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      );
    });
  }
}

export const locationService = new LocationService();
