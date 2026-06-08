export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const REQUEST_TIMEOUT_MS = 8000;

// Initialise to (now - interval) so the first request fires immediately
// but subsequent rapid-fire calls are staggered by MIN_INTERVAL_MS.
// The old initialisation (0) was always in the past relative to Date.now()
// (~1.7e12), which meant the throttle never engaged and every request fired
// instantly — flooding Nominatim and triggering rate-limit slowdowns.
const MIN_INTERVAL_MS = 1000;
let lastRequestTime = Date.now() - MIN_INTERVAL_MS;

// In-flight AbortController so a new forward-geocode can cancel the previous one.
let activeController: AbortController | null = null;

async function throttledFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const now = Date.now();
  const sleepUntil = Math.max(lastRequestTime + MIN_INTERVAL_MS, now);
  lastRequestTime = sleepUntil; // reserve this time slot
  const wait = sleepUntil - now;
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));

  // If the caller already cancelled us during the wait, bail early.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const timeoutController = new AbortController();
  const combinedAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', combinedAbort);
  const timer = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: timeoutController.signal,
      headers: { 'Accept-Language': 'en', 'User-Agent': 'CrystalBall/1.0' },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', combinedAbort);
  }
}

export async function forwardGeocode(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Cancel any in-flight forward-geocode before starting a new one.
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5&addressdetails=0`;
  try {
    const res = await throttledFetch(url, controller.signal);
    if (!res.ok) return [];
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    return data
      .filter((item) => item.display_name && item.lat && item.lon)
      .map((item) => ({
        displayName: item.display_name,
        lat: Number.parseFloat(item.lat),
        lon: Number.parseFloat(item.lon),
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  } catch {
    return [];
  } finally {
    if (activeController === controller) activeController = null;
  }
}

export async function reverseGeocodeLabel(lat: number, lon: number): Promise<string | null> {
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=0`;
  try {
    const res = await throttledFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}
