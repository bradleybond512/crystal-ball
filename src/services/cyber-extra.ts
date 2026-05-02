/**
 * Additional cyber threat intelligence sources:
 * ThreatFox, OpenPhish, Spamhaus DROP, CISA KEV
 *
 * All fetch from local sidecar routes. Sources without lat/lon use 0,0
 * (omitted from map globe; shown in panel table).
 */
import { getApiBaseUrl } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';
import { dataFreshness } from '@/services/data-freshness';
import type { CyberThreat } from '@/types';

// ── Feed-specific interfaces ──────────────────────────────────────────────────

/** Raw ThreatFox IOC as returned by the sidecar (pre-mapped to CyberThreat shape) */
export interface ThreatFoxIOC {
  id: string;
  type: string;
  source: 'threatfox';
  indicator: string;
  indicatorType: 'ip' | 'domain' | 'url';
  lat: number;
  lon: number;
  country: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  malwareFamily: string;
  tags: string[];
  firstSeen: string;
  lastSeen: string;
}

/** CISA Known Exploited Vulnerability entry */
export interface CISAVulnerability {
  id: string;
  type: 'exploited_vulnerability';
  source: 'cisa_kev';
  indicator: string;
  indicatorType: 'domain';
  lat: number;
  lon: number;
  country: string;
  severity: 'critical';
  malwareFamily: string;
  tags: string[];
  firstSeen: string;
  lastSeen: string;
}

/** OpenPhish phishing URL entry */
export interface OpenPhishURL {
  id: string;
  type: 'phishing';
  source: 'openphish';
  indicator: string;
  indicatorType: 'url';
  lat: number;
  lon: number;
  country: string;
  severity: 'high';
  malwareFamily: string;
  tags: string[];
  firstSeen: string;
  lastSeen: string;
}

/** Spamhaus DROP/EDROP CIDR block entry */
export interface SpamhausDrop {
  id: string;
  type: 'malicious_ip_range';
  source: 'spamhaus';
  indicator: string;
  indicatorType: 'ip';
  lat: number;
  lon: number;
  country: string;
  severity: 'high';
  malwareFamily: string;
  tags: string[];
  firstSeen: string;
  lastSeen: string;
}

// ── Client-side cache (15-min TTL) ────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const _cyberCache = new Map<string, CacheEntry<CyberThreat[]>>();

function getCached(key: string): CyberThreat[] | null {
  const entry = _cyberCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
 _cyberCache.delete(key);
 return null;
  }
  return entry.data;
}

function setCached(key: string, data: CyberThreat[]): void {
  _cyberCache.set(key, { data, ts: Date.now() });
}

// ── ThreatFox ──────────────────────────────────────────────────────────────
export async function fetchThreatFoxIOCs(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('threatfoxThreatIntel')) return [];
  const cached = getCached('threatfox');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/threatfox-iocs`, { method: 'GET' });
 if (!res.ok) {
 dataFreshness.recordError('cyber-extra', `threatfox: ${res.status}`);
 return [];
 }
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('threatfox', data);
 dataFreshness.recordUpdate('cyber-extra', data.length);
 return data;
  } catch (error) {
 dataFreshness.recordError('cyber-extra', String(error));
 return [];
  }
}

// ── OpenPhish ──────────────────────────────────────────────────────────────
export async function fetchOpenPhishFeed(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('openPhishThreatIntel')) return [];
  const cached = getCached('openphish');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/openphish-feed`);
 if (!res.ok) return [];
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('openphish', data);
 return data;
  } catch {
 return [];
  }
}

// ── Spamhaus DROP/EDROP ────────────────────────────────────────────────────
export async function fetchSpamhausDrop(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('spamhausDrop')) return [];
  const cached = getCached('spamhaus');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/spamhaus-drop`);
 if (!res.ok) return [];
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('spamhaus', data);
 return data;
  } catch {
 return [];
  }
}

// ── CISA KEV ───────────────────────────────────────────────────────────────
export async function fetchCisaKev(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('cisaKev')) return [];
  const cached = getCached('cisa-kev');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/cisa-kev`);
 if (!res.ok) return [];
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('cisa-kev', data);
 return data;
  } catch {
 return [];
  }
}

// ── AlienVault OTX ─────────────────────────────────────────────────────────
export async function fetchOtxIOCs(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('alienvaultOtxThreatIntel')) return [];
  const cached = getCached('otx');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/otx-iocs`, { method: 'GET' });
 if (!res.ok) return [];
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('otx', data);
 return data;
  } catch {
 return [];
  }
}

// ── VirusTotal reputation lookup ────────────────────────────────────────────
export interface VtReputation {
  indicator: string;
  type: string;
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  reputation: number;
  lastAnalysisDate: number | null;
}

export async function lookupVtIndicator(
  indicator: string,
  type: 'ip' | 'domain' | 'url',
): Promise<VtReputation | null> {
  if (!isFeatureAvailable('virusTotalEnrichment')) return null;
  try {
 const params = new URLSearchParams({ indicator, type });
 const res = await fetch(`${getApiBaseUrl()}/api/virustotal-lookup?${params}`);
 if (!res.ok) return null;
 return (await res.json()) as VtReputation;
  } catch {
 return null;
  }
}

// ── PhishStats phishing database ───────────────────────────────────────────
export async function fetchPhishStatsFeed(): Promise<CyberThreat[]> {
  if (!isFeatureAvailable('phishstatsFeed')) return [];
  const cached = getCached('phishstats');
  if (cached) return cached;
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/phishstats-feed`);
 if (!res.ok) return [];
 const data = (await res.json()) as CyberThreat[];
 if (!Array.isArray(data)) return [];
 setCached('phishstats', data);
 return data;
  } catch {
 return [];
  }
}

// ── GreyNoise Community IP enrichment ──────────────────────────────────────
export interface GreyNoiseResult {
  classification: 'malicious' | 'benign' | 'unknown';
  noise: boolean;
  name: string | null;
}

export async function enrichWithGreyNoise(ip: string): Promise<GreyNoiseResult | null> {
  try {
 const params = new URLSearchParams({ ip });
 const res = await fetch(`${getApiBaseUrl()}/api/greynoise-lookup?${params}`);
 if (!res.ok) return null;
 return (await res.json()) as GreyNoiseResult;
  } catch {
 return null;
  }
}
