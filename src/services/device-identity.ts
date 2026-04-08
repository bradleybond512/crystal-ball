/**
 * Device Identity Service — produces a DeviceFingerprint for the current
 * machine, used by the cyber threat reactor to score relevance. ASN-only
 * (no public-IP exfil). Cached in localStorage for 6h. Suppressed in
 * Ghost Mode (returns an empty fingerprint without making a network call).
 */

export interface DeviceFingerprint {
  asn: number | null;
  asnOrg: string | null;
  country: string | null;
  os: 'macos' | 'windows' | 'linux' | 'unknown';
  fetchedAt: number;
}

const STORAGE_KEY = 'crystalball-device-fingerprint';
const TTL_MS = 6 * 60 * 60 * 1000;
const BGPVIEW_SELF_URL = 'https://api.bgpview.io/ip/self';

function detectOs(): DeviceFingerprint['os'] {
  const ua =
 typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
 ? navigator.userAgent
 : '';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

function detectCountryFromLanguage(): string | null {
  if (typeof navigator === 'undefined') return null;
  const lang = navigator.language ?? '';
  const m = /-([A-Z]{2})\b/.exec(lang);
  return m?.[1] ?? null;
}

function emptyFingerprint(): DeviceFingerprint {
  return {
 asn: null,
 asnOrg: null,
 country: detectCountryFromLanguage(),
 os: detectOs(),
 fetchedAt: Date.now(),
  };
}

function readCache(): DeviceFingerprint | null {
  try {
 if (typeof localStorage === 'undefined') return null;
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as DeviceFingerprint;
 if (typeof parsed.fetchedAt !== 'number') return null;
 if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
 return parsed;
  } catch {
 return null;
  }
}

function writeCache(fp: DeviceFingerprint): void {
  try {
 if (typeof localStorage === 'undefined') return;
 localStorage.setItem(STORAGE_KEY, JSON.stringify(fp));
  } catch {
 // ignore quota / disabled storage
  }
}

async function isGhostModeSafe(): Promise<boolean> {
  const override = (
 globalThis as unknown as { __wmGhost?: () => boolean }
  ).__wmGhost;
  if (typeof override === 'function') {
 try {
 return override();
 } catch {
 return false;
 }
  }
  try {
 const mod = (await import('./mode-manager')) as {
 isGhostMode?: () => boolean;
 };
 return typeof mod.isGhostMode === 'function' ? mod.isGhostMode() : false;
  } catch {
 return false;
  }
}

interface BgpViewSelfResponse {
  data?: {
 prefixes?: {
 asn?: { asn?: number; name?: string; country_code?: string };
 }[];
  };
}

async function fetchSelfFingerprint(): Promise<DeviceFingerprint> {
  try {
 const res = await fetch(BGPVIEW_SELF_URL);
 if (!res.ok) return emptyFingerprint();
 const json = (await res.json()) as BgpViewSelfResponse;
 const first = json.data?.prefixes?.[0]?.asn;
 return {
 asn: typeof first?.asn === 'number' ? first.asn : null,
 asnOrg: first?.name ?? null,
 country: first?.country_code ?? detectCountryFromLanguage(),
 os: detectOs(),
 fetchedAt: Date.now(),
 };
  } catch {
 return emptyFingerprint();
  }
}

export async function getDeviceFingerprint(): Promise<DeviceFingerprint> {
  if (await isGhostModeSafe()) {
 return {
 asn: null,
 asnOrg: null,
 country: null,
 os: detectOs(),
 fetchedAt: Date.now(),
 };
  }
  const cached = readCache();
  if (cached) return cached;
  const fresh = await fetchSelfFingerprint();
  writeCache(fresh);
  return fresh;
}

export function clearDeviceFingerprintCache(): void {
  try {
 if (typeof localStorage === 'undefined') return;
 localStorage.removeItem(STORAGE_KEY);
  } catch {
 // ignore
  }
}
