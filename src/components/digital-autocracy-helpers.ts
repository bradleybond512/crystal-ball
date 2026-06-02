// digital-autocracy-helpers.ts
// Pure logic for DigitalAutocracyPanel — no DOM, no Panel imports

export type FreedomCategory = 'Free' | 'Partly Free' | 'Not Free';
export type VpnUsageLevel = 'Negligible' | 'Low' | 'Medium' | 'High' | 'Very High';
export type CensorshipTrend = 'improving' | 'stable' | 'worsening';
export type IncidentType = 'Platform Block' | 'Content Removal' | 'Network Shutdown' | 'Throttling' | 'Account Purge';
export type IncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface CountryCensorship {
  country: string;
  code: string;
  freedomScore: number; // 0-100, higher = freer
  category: FreedomCategory;
  blockedPlatforms: string[];
  vpnUsage: VpnUsageLevel;
  socialCredit: boolean;
  shutdownsLastYear: number;
  trend: CensorshipTrend;
  population: number; // millions
}

export interface CensorshipIncident {
  country: string;
  date: string;
  type: IncidentType;
  target: string;
  severity: IncidentSeverity;
  description: string;
}

export interface DigitalFreedomData {
  countries: CountryCensorship[];
  incidents: CensorshipIncident[];
  globalFreedomIndex: number;
  notFreeCount: number;
  partlyFreeCount: number;
  freeCount: number;
  totalBlockedPlatforms: number;
  populationUnderRepression: number; // millions under Not Free regimes
}

const COUNTRIES: CountryCensorship[] = [
  { country: 'China', code: 'CN', freedomScore: 9, category: 'Not Free', blockedPlatforms: ['Google', 'YouTube', 'Facebook', 'Twitter/X', 'Instagram', 'WhatsApp', 'Telegram', 'Wikipedia', 'Reddit', 'Gmail'], vpnUsage: 'High', socialCredit: true, shutdownsLastYear: 0, trend: 'worsening', population: 1412 },
  { country: 'North Korea', code: 'KP', freedomScore: 2, category: 'Not Free', blockedPlatforms: ['All foreign internet'], vpnUsage: 'Negligible', socialCredit: false, shutdownsLastYear: 0, trend: 'stable', population: 26 },
  { country: 'Iran', code: 'IR', freedomScore: 17, category: 'Not Free', blockedPlatforms: ['Facebook', 'Twitter/X', 'YouTube', 'WhatsApp', 'Telegram', 'Instagram', 'TikTok'], vpnUsage: 'Very High', socialCredit: false, shutdownsLastYear: 4, trend: 'worsening', population: 87 },
  { country: 'Russia', code: 'RU', freedomScore: 23, category: 'Not Free', blockedPlatforms: ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn'], vpnUsage: 'Very High', socialCredit: false, shutdownsLastYear: 2, trend: 'worsening', population: 145 },
  { country: 'Belarus', code: 'BY', freedomScore: 27, category: 'Not Free', blockedPlatforms: ['Telegram (sporadic)', 'Independent news sites'], vpnUsage: 'High', socialCredit: false, shutdownsLastYear: 1, trend: 'stable', population: 9 },
  { country: 'Myanmar', code: 'MM', freedomScore: 22, category: 'Not Free', blockedPlatforms: ['Facebook', 'Twitter/X', 'Instagram', 'WhatsApp'], vpnUsage: 'Very High', socialCredit: false, shutdownsLastYear: 6, trend: 'worsening', population: 54 },
  { country: 'Ethiopia', code: 'ET', freedomScore: 29, category: 'Not Free', blockedPlatforms: ['Social media during conflicts'], vpnUsage: 'Medium', socialCredit: false, shutdownsLastYear: 5, trend: 'worsening', population: 126 },
  { country: 'Cuba', code: 'CU', freedomScore: 31, category: 'Not Free', blockedPlatforms: ['Twitter/X', 'YouTube (throttled)', 'Many news sites'], vpnUsage: 'High', socialCredit: false, shutdownsLastYear: 2, trend: 'stable', population: 11 },
  { country: 'Turkey', code: 'TR', freedomScore: 35, category: 'Partly Free', blockedPlatforms: ['Twitter/X (periodic)', 'Wikipedia (2017-2020)', 'Some VPNs'], vpnUsage: 'High', socialCredit: false, shutdownsLastYear: 3, trend: 'worsening', population: 85 },
  { country: 'Azerbaijan', code: 'AZ', freedomScore: 37, category: 'Partly Free', blockedPlatforms: ['Independent media sites', 'Some VoIP apps'], vpnUsage: 'Medium', socialCredit: false, shutdownsLastYear: 1, trend: 'stable', population: 10 },
  { country: 'Pakistan', code: 'PK', freedomScore: 40, category: 'Partly Free', blockedPlatforms: ['Twitter/X (periodic)', 'TikTok (periodic)', 'Wikipedia (2023)'], vpnUsage: 'High', socialCredit: false, shutdownsLastYear: 4, trend: 'worsening', population: 231 },
  { country: 'Hungary', code: 'HU', freedomScore: 42, category: 'Partly Free', blockedPlatforms: [], vpnUsage: 'Low', socialCredit: false, shutdownsLastYear: 0, trend: 'stable', population: 10 },
  { country: 'India', code: 'IN', freedomScore: 49, category: 'Partly Free', blockedPlatforms: ['Twitter/X (sporadic)', 'TikTok (banned 2020)'], vpnUsage: 'Medium', socialCredit: false, shutdownsLastYear: 84, trend: 'worsening', population: 1440 },
  { country: 'United States', code: 'US', freedomScore: 76, category: 'Free', blockedPlatforms: ['TikTok (legislation pending)'], vpnUsage: 'Low', socialCredit: false, shutdownsLastYear: 0, trend: 'stable', population: 335 },
  { country: 'Germany', code: 'DE', freedomScore: 79, category: 'Free', blockedPlatforms: [], vpnUsage: 'Low', socialCredit: false, shutdownsLastYear: 0, trend: 'stable', population: 84 },
];

const INCIDENTS: CensorshipIncident[] = [
  { country: 'Myanmar', date: '2024-02-15', type: 'Network Shutdown', target: 'Entire internet', severity: 'Critical', description: 'Military junta ordered 72-hour nationwide blackout during anniversary protests.' },
  { country: 'Ethiopia', date: '2024-03-01', type: 'Network Shutdown', target: 'Amhara region', severity: 'Critical', description: 'Internet cut to Amhara region amid ongoing armed conflict with federal forces.' },
  { country: 'Iran', date: '2024-01-20', type: 'Throttling', target: 'VPN services', severity: 'High', description: 'IRGC-linked ISPs throttled VPN traffic to sub-1Mbps ahead of parliamentary elections.' },
  { country: 'Russia', date: '2024-03-15', type: 'Platform Block', target: 'CloudFlare DNS', severity: 'High', description: 'Roskomnadzor ordered blocking of Cloudflare 1.1.1.1 DNS resolver to enforce content filtering.' },
  { country: 'Pakistan', date: '2024-02-08', type: 'Network Shutdown', target: 'Mobile networks nationwide', severity: 'Critical', description: 'Election-day internet blackout; mobile data suspended for 10 hours across Pakistan.' },
  { country: 'China', date: '2024-01-05', type: 'Account Purge', target: 'WeChat political accounts', severity: 'Medium', description: 'CAC ordered removal of 1.4M accounts for "spreading harmful information" about economy.' },
  { country: 'Turkey', date: '2024-02-22', type: 'Platform Block', target: 'Twitter/X', severity: 'High', description: 'Twitter/X access suspended for 12 hours following sharing of earthquake footage.' },
  { country: 'India', date: '2024-03-10', type: 'Network Shutdown', target: 'Manipur state', severity: 'High', description: 'Internet suspended in Manipur for 150th consecutive day amid ethnic violence.' },
];

export function computeGlobalFreedomIndex(countries: CountryCensorship[]): number {
  if (!countries.length) return 0;
  const avg = countries.reduce((s, c) => s + c.freedomScore, 0) / countries.length;
  return Math.round(avg);
}

export function getNotFreeCountries(countries: CountryCensorship[]): CountryCensorship[] {
  return countries.filter(c => c.category === 'Not Free');
}

export function getPartlyFreeCountries(countries: CountryCensorship[]): CountryCensorship[] {
  return countries.filter(c => c.category === 'Partly Free');
}

export function getFreeCountries(countries: CountryCensorship[]): CountryCensorship[] {
  return countries.filter(c => c.category === 'Free');
}

export function countTotalBlockedPlatforms(countries: CountryCensorship[]): number {
  return countries.reduce((s, c) => s + c.blockedPlatforms.length, 0);
}

export function computePopulationUnderRepression(countries: CountryCensorship[]): number {
  return countries.filter(c => c.category === 'Not Free').reduce((s, c) => s + c.population, 0);
}

export function getMostRestrictive(countries: CountryCensorship[], n = 5): CountryCensorship[] {
  return [...countries].sort((a, b) => a.freedomScore - b.freedomScore).slice(0, n);
}

export function getWorseningCountries(countries: CountryCensorship[]): CountryCensorship[] {
  return countries.filter(c => c.trend === 'worsening');
}

export function categoryCssClass(category: FreedomCategory): string {
  const map: Record<FreedomCategory, string> = { Free: 'cat-free', 'Partly Free': 'cat-partly', 'Not Free': 'cat-not-free' };
  return map[category] ?? 'cat-not-free';
}

export function incidentSeverityClass(severity: IncidentSeverity): string {
  const map: Record<IncidentSeverity, string> = { Critical: 'sev-critical', High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' };
  return map[severity] ?? 'sev-low';
}

export function trendIcon(trend: CensorshipTrend): string {
  return { improving: '↑', stable: '→', worsening: '↓' }[trend] ?? '→';
}

export function buildRenderData(): DigitalFreedomData {
  return {
    countries: COUNTRIES,
    incidents: INCIDENTS,
    globalFreedomIndex: computeGlobalFreedomIndex(COUNTRIES),
    notFreeCount: getNotFreeCountries(COUNTRIES).length,
    partlyFreeCount: getPartlyFreeCountries(COUNTRIES).length,
    freeCount: getFreeCountries(COUNTRIES).length,
    totalBlockedPlatforms: countTotalBlockedPlatforms(COUNTRIES),
    populationUnderRepression: computePopulationUnderRepression(COUNTRIES),
  };
}
