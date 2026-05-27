// human-rights-abuses-helpers.ts — pure deterministic helpers

export type AbuseCategory = 'extrajudicial-killing' | 'forced-disappearance' | 'torture' | 'arbitrary-detention' | 'forced-displacement' | 'suppression-assembly';

export type TrendDirection = 'worsening' | 'stable' | 'improving';

export interface HumanRightsEvent {
  country: string;
  category: AbuseCategory;
  severity: number; // 0-100
  date: string; // ISO
  prosecuted: boolean;
}

export interface CountryRiskProfile {
  country: string;
  abuseRiskScore: number; // 0-100
  impunityIndex: number; // 0-1 (1 = full impunity)
  trend: TrendDirection;
  dominantCategory: AbuseCategory;
  incidentCount: number;
}

export interface ImpunityData {
  incidents: number;
  prosecutions: number;
}

const MOCK_EVENTS: HumanRightsEvent[] = [
  { country: 'China', category: 'arbitrary-detention', severity: 90, date: '2026-05-01', prosecuted: false },
  { country: 'China', category: 'forced-disappearance', severity: 85, date: '2026-04-20', prosecuted: false },
  { country: 'Russia', category: 'arbitrary-detention', severity: 80, date: '2026-05-10', prosecuted: false },
  { country: 'Russia', category: 'torture', severity: 75, date: '2026-04-15', prosecuted: false },
  { country: 'Iran', category: 'extrajudicial-killing', severity: 88, date: '2026-05-05', prosecuted: false },
  { country: 'Iran', category: 'suppression-assembly', severity: 70, date: '2026-04-28', prosecuted: true },
  { country: 'Saudi Arabia', category: 'arbitrary-detention', severity: 72, date: '2026-05-12', prosecuted: false },
  { country: 'Myanmar', category: 'forced-displacement', severity: 85, date: '2026-04-10', prosecuted: false },
  { country: 'Myanmar', category: 'extrajudicial-killing', severity: 90, date: '2026-05-03', prosecuted: false },
  { country: 'Syria', category: 'torture', severity: 88, date: '2026-04-22', prosecuted: false },
  { country: 'North Korea', category: 'arbitrary-detention', severity: 95, date: '2026-05-08', prosecuted: false },
  { country: 'Ethiopia', category: 'forced-displacement', severity: 78, date: '2026-04-18', prosecuted: false },
  { country: 'Venezuela', category: 'suppression-assembly', severity: 65, date: '2026-05-15', prosecuted: false },
  { country: 'Belarus', category: 'arbitrary-detention', severity: 70, date: '2026-05-07', prosecuted: false },
  { country: 'Afghanistan', category: 'extrajudicial-killing', severity: 82, date: '2026-04-30', prosecuted: false },
];

export function scoreAbuseRisk(events: HumanRightsEvent[]): number {
  if (events.length === 0) return 0;
  const avgSeverity = events.reduce((s, e) => s + e.severity, 0) / events.length;
  const categoryPenalty = new Set(events.map(e => e.category)).size * 3;
  return Math.min(100, Math.round(avgSeverity + categoryPenalty));
}

export function categorizeCrimes(events: HumanRightsEvent[]): Record<AbuseCategory, number> {
  const counts: Record<AbuseCategory, number> = {
    'extrajudicial-killing': 0,
    'forced-disappearance': 0,
    'torture': 0,
    'arbitrary-detention': 0,
    'forced-displacement': 0,
    'suppression-assembly': 0,
  };
  for (const e of events) counts[e.category]++;
  return counts;
}

export function getDominantCategory(events: HumanRightsEvent[]): AbuseCategory {
  const counts = categorizeCrimes(events);
  return (Object.entries(counts).sort(([, a], [, b]) => b - a)[0][0]) as AbuseCategory;
}

export function assessTrend(events: HumanRightsEvent[], windowDays: number): TrendDirection {
  const now = new Date('2026-05-27');
  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  const recent = events.filter(e => new Date(e.date) >= cutoff);
  const older = events.filter(e => new Date(e.date) < cutoff);
  if (recent.length === 0 && older.length === 0) return 'stable';
  const recentAvg = recent.length ? recent.reduce((s, e) => s + e.severity, 0) / recent.length : 0;
  const olderAvg = older.length ? older.reduce((s, e) => s + e.severity, 0) / older.length : recentAvg;
  if (recentAvg > olderAvg + 5) return 'worsening';
  if (recentAvg < olderAvg - 5) return 'improving';
  return 'stable';
}

export function computeImpunityIndex(data: ImpunityData): number {
  if (data.incidents === 0) return 0;
  const prosecutionRate = Math.min(1, data.prosecutions / data.incidents);
  return parseFloat((1 - prosecutionRate).toFixed(3));
}

export function detectPatterns(events: HumanRightsEvent[]): 'systematic' | 'opportunistic' | 'none' {
  if (events.length === 0) return 'none';
  const unprosecuted = events.filter(e => !e.prosecuted).length / events.length;
  const uniqueCategories = new Set(events.map(e => e.category)).size;
  if (unprosecuted > 0.8 && uniqueCategories >= 3) return 'systematic';
  if (events.length >= 2) return 'opportunistic';
  return 'none';
}

export function rankCountries(profiles: CountryRiskProfile[]): CountryRiskProfile[] {
  return [...profiles].sort((a, b) => b.abuseRiskScore - a.abuseRiskScore);
}

export function buildCountryProfiles(): CountryRiskProfile[] {
  const countries = Array.from(new Set(MOCK_EVENTS.map(e => e.country)));
  return countries.map(country => {
    const events = MOCK_EVENTS.filter(e => e.country === country);
    const prosecuted = events.filter(e => e.prosecuted).length;
    return {
      country,
      abuseRiskScore: scoreAbuseRisk(events),
      impunityIndex: computeImpunityIndex({ incidents: events.length, prosecutions: prosecuted }),
      trend: assessTrend(events, 30),
      dominantCategory: getDominantCategory(events),
      incidentCount: events.length,
    };
  });
}

export function buildRenderData(): { profiles: CountryRiskProfile[]; totalIncidents: number; systematicCount: number } {
  const profiles = rankCountries(buildCountryProfiles());
  const totalIncidents = MOCK_EVENTS.length;
  const systematicCount = profiles.filter(p => detectPatterns(MOCK_EVENTS.filter(e => e.country === p.country)) === 'systematic').length;
  return { profiles, totalIncidents, systematicCount };
}
