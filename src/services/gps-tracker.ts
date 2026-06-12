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
  private _watchId: number | null = null;
  private _pollId: ReturnType<typeof setInterval> | null = null;
  private _listeners = new Set<GpsListener>();

  get currentTier(): GpsTier | null { return this._currentTier; }
  get tierName(): string {
    switch (this._currentTier) {
      case 1: return 'CoreLocation';
      case 2: return 'Browser';
      case 3: return 'External GPS';
      default: return 'None';
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

    if (await this._tryTier1()) {
      this._currentTier = 1;
      this._active = true;
      return;
    }
    if (await this._tryTier2()) {
      this._currentTier = 2;
      this._active = true;
      return;
    }
    if (await this._tryTier3()) {
      this._currentTier = 3;
      this._active = true;
      return;
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

    this._pollId = setInterval(async () => {
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
          resolve(false);
        }
      }, 10000);

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
            resolve(false);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
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
      const headers = await this._nmeaHeaders();
      const res = await fetch(`${base}/gps/nmea`, { headers, signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
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
