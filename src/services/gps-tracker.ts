import { tryInvokeTauri } from '@/services/tauri-bridge';
import { getApiBaseUrl } from '@/services/runtime';
import { parseNmea } from '@/services/nmea-parser';

export type GpsTier = 1 | 2 | 3;

export interface GpsPosition {
  lat: number;
  lon: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp: number;
  source: 'corelocation' | 'browser' | 'external';
}

export type GpsListener = (pos: GpsPosition) => void;

interface CoreLocationResult {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  course?: number;
  horizontalAccuracy?: number;
}

export class GpsTracker {
  private _currentTier: GpsTier | null = null;
  private _lastPosition: GpsPosition | null = null;
  private _active = false;
  private _starting: Promise<void> | null = null;
  private _watchId: number | null = null;
  private _pollId: ReturnType<typeof setInterval> | null = null;
  private _listeners = new Set<GpsListener>();

  get currentTier(): GpsTier | null { return this._currentTier; }
  get tierName(): string {
    switch (this._currentTier) {
      case 1: { return 'CoreLocation';
      }
      case 2: { return 'Browser';
      }
      case 3: { return 'External GPS';
      }
      default: { return 'None';
      }
    }
  }
  get lastPosition(): GpsPosition | null { return this._lastPosition; }
  get active(): boolean { return this._active; }

  addListener(fn: GpsListener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private emit(pos: GpsPosition): void {
    this._lastPosition = pos;
    for (const fn of this._listeners) fn(pos);
  }

  async start(): Promise<void> {
    if (this._active) return;
    // Concurrent callers await the SAME startup attempt via the _starting latch,
    // so they never each spin up a poll interval AND never get a false "success"
    // resolve before the real attempt finishes. _active only flips true on a tier
    // that actually connected.
    if (this._starting) return this._starting;
    this._starting = this._startInner();
    try {
      await this._starting;
    } finally {
      this._starting = null;
    }
  }

  private async _startInner(): Promise<void> {
    if (await this._tryTier1()) { this._currentTier = 1; this._active = true; return; }
    if (await this._tryTier2()) { this._currentTier = 2; this._active = true; return; }
    if (await this._tryTier3()) { this._currentTier = 3; this._active = true; }
    // If no tier connected, _active stays false so start() can be retried.
  }

  private _clearBrowserWatch(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  stop(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    if (this._pollId !== null) {
      clearInterval(this._pollId);
      this._pollId = null;
    }
    this._active = false;
    this._currentTier = null;
  }

  destroy(): void {
    this.stop();
    this._listeners.clear();
  }

  private async _tryTier1(): Promise<boolean> {
    const result = await tryInvokeTauri<CoreLocationResult>('plugin:corelocation|get_location');
    if (!result) return false;

    this.emit({
      lat: result.latitude,
      lon: result.longitude,
      altitude: result.altitude ?? null,
      speed: result.speed ?? null,
      heading: result.course ?? null,
      accuracy: result.horizontalAccuracy ?? null,
      timestamp: Date.now(),
      source: 'corelocation',
    });

    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async poll body is self-contained (own try/catch); nothing awaits the interval
    this._pollId = setInterval(async () => {
      try {
        const r = await tryInvokeTauri<CoreLocationResult>('plugin:corelocation|get_location');
        if (!r) return;
        this.emit({
          lat: r.latitude,
          lon: r.longitude,
          altitude: r.altitude ?? null,
          speed: r.speed ?? null,
          heading: r.course ?? null,
          accuracy: r.horizontalAccuracy ?? null,
          timestamp: Date.now(),
          source: 'corelocation',
        });
      } catch { /* GPS unavailable; keep trying next tick */ }
    }, 1000);

    return true;
  }

  private _tryTier2(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(false);
        return;
      }

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Tier 2 timed out — tear down the watch so it can't keep emitting
          // 'browser' fixes alongside a later tier.
          this._clearBrowserWatch();
          resolve(false);
        }
      }, 10_000);

      // eslint-disable-next-line sonarjs/no-intrusive-permissions -- geolocation is the core purpose of the GPS tracker; consent is handled by the OS/browser prompt
      this._watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(true);
          }
          this.emit({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            altitude: pos.coords.altitude,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            source: 'browser',
          });
        },
        () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this._clearBrowserWatch();
            resolve(false);
          }
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
  }

  private async _nmeaHeaders(): Promise<Record<string, string>> {
    // The /gps/nmea route is auth-gated like the other sidecar endpoints, but
    // it lives outside the /api/ prefix the global fetch patch authorizes, so
    // attach the local API token here. Tier 3 is desktop-only; in the browser
    // build the token is absent and the fetch simply fails back to no Tier 3.
    const token = await tryInvokeTauri<string>('get_local_api_token').catch(() => null);
    return token ? { Authorization: `Bearer ${token.trim()}` } : {};
  }

  private async _tryTier3(): Promise<boolean> {
    try {
      const base = getApiBaseUrl();
      // The local API token can be transiently unavailable at desktop cold
      // start, which now yields a 401 from the auth-gated route. Treat that as
      // retryable (re-acquiring the token each attempt) so a startup race
      // doesn't leave Tier 3 permanently disabled until the user toggles GPS.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const headers = await this._nmeaHeaders();
        res = await fetch(`${base}/gps/nmea`, { headers, signal: AbortSignal.timeout(3000) });
        if (res.status !== 401) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!res?.ok) return false;
      const text = await res.text();
      const pos = parseNmea(text.trim());
      if (!pos || pos.latitude === 0 || pos.longitude === 0) return false;

      this.emit({
        lat: pos.latitude,
        lon: pos.longitude,
        altitude: pos.altitude,
        speed: pos.speed,
        heading: pos.heading,
        accuracy: pos.accuracy,
        timestamp: pos.timestamp,
        source: 'external',
      });

      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async poll body is self-contained (own try/catch); nothing awaits the interval
      this._pollId = setInterval(async () => {
        try {
          const r = await fetch(`${base}/gps/nmea`, {
            headers: await this._nmeaHeaders(),
            signal: AbortSignal.timeout(3000),
          });
          if (!r.ok) return;
          const t = await r.text();
          const p = parseNmea(t.trim());
          if (!p) return;
          this.emit({
            lat: p.latitude,
            lon: p.longitude,
            altitude: p.altitude,
            speed: p.speed,
            heading: p.heading,
            accuracy: p.accuracy,
            timestamp: p.timestamp,
            source: 'external',
          });
        } catch {
          // poll silently
        }
      }, 1000);

      return true;
    } catch {
      return false;
    }
  }
}
