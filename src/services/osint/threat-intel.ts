import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';

export interface GreyNoiseResult {
  ip: string;
  noise: boolean;
  riot: boolean;
  classification: 'malicious' | 'benign' | 'unknown';
  name: string;
  link: string;
}

export interface OtxPulse {
  id: string;
  name: string;
  description: string;
  created: string;
  author_name: string;
  tags: string[];
  targeted_countries: string[];
  indicators_count: number;
}

export interface AbuseIpEntry {
  ipAddress: string;
  abuseConfidenceScore: number;
  countryCode: string;
  usageType: string;
  isp: string;
  totalReports: number;
  lastReportedAt: string;
}

export interface UrlscanResult {
  id: string;
  url: string | null;
  domain: string | null;
  ip: string | null;
  country: string | null;
  score: number;
  malicious: boolean;
  tags: string[];
  submittedAt: string | null;
  screenshot: string | null;
}

export async function fetchGreyNoise(): Promise<GreyNoiseResult[]> {
  if (!isFeatureAvailable('greynoiseIntel')) return [];
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/greynoise-scanners`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as GreyNoiseResult[];
  } catch { return []; }
}

export async function fetchOtxPulses(): Promise<OtxPulse[]> {
  if (!isFeatureAvailable('alienvaultOtxThreatIntel')) return [];
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/otx-pulses`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as OtxPulse[];
  } catch { return []; }
}

export async function fetchAbuseIpDb(): Promise<AbuseIpEntry[]> {
  if (!isFeatureAvailable('abuseIpdbThreatIntel')) return [];
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/abuseipdb-reports`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as AbuseIpEntry[];
  } catch { return []; }
}

export async function fetchUrlscanFeed(): Promise<UrlscanResult[]> {
  // No feature flag — always fetches
  try {
 const r = await fetch(`${getApiBaseUrl()}/api/urlscan-feed`);
 if (!r.ok) return [];
 const data = await r.json() as unknown;
 if (!Array.isArray(data)) return [];
 return data as UrlscanResult[];
  } catch { return []; }
}
