/**
 * counterterrorism-helpers.ts
 *
 * Pure functions for the CounterterrorismPanel. No DOM, no fetch, no globals.
 * All functions are deterministic given the same inputs — suitable for unit tests
 * with static fixtures.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThreatTier = 'critical' | 'high' | 'elevated' | 'guarded' | 'low';

export type AttackVector =
  | 'vehicle'
  | 'ied'
  | 'suicide'
  | 'knife'
  | 'active_shooter'
  | 'chemical'
  | 'cyber'
  | 'rocket'
  | 'kidnapping'
  | 'other';

export type ThreatGroup =
  | 'ISIS'
  | 'Al-Qaeda'
  | 'Boko Haram'
  | 'al-Shabaab'
  | 'TTP'
  | 'PKK'
  | 'FARC remnants'
  | 'Hezbollah';

export type TrendDirection = 'increasing' | 'stable' | 'decreasing';

export interface IncidentRecord {
  id: string;
  date: number; // Unix ms
  region: string;
  country: string;
  group: ThreatGroup;
  vector: AttackVector;
  killed: number;
  wounded: number;
  ctSuccess: boolean; // true = CT operation disrupted/prevented
}

export interface GroupActivity {
  group: ThreatGroup;
  incidentCount30d: number;
  casualtiesTotal: number;
  primaryVector: AttackVector;
  primaryRegion: string;
  activityScore: number; // 0-100
  trend: TrendDirection;
}

export interface RegionRisk {
  region: string;
  tier: ThreatTier;
  score: number; // 0-100
  incidentCount30d: number;
  topGroup: ThreatGroup;
  topVector: AttackVector;
  trend: TrendDirection;
  ctSuccessRate: number; // 0-1
}

export interface AttackVectorSummary {
  vector: AttackVector;
  count: number;
  killed: number;
  wounded: number;
  proportion: number; // 0-1 fraction of all incidents
}

export interface CasualtySeverity {
  label: 'mass_casualty' | 'severe' | 'moderate' | 'minor' | 'none';
  killed: number;
  wounded: number;
  total: number;
}

export interface CtEffectiveness {
  total: number;
  successful: number;
  rate: number; // 0-1
  label: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface IncidentFrequency {
  count30d: number;
  count7d: number;
  dailyAvg30d: number;
  trend: TrendDirection;
  trendPct: number; // % change vs prior 30d window
}

export interface CounterterrorismRenderData {
  asOf: number;
  overallTier: ThreatTier;
  overallScore: number;
  regions: RegionRisk[];
  groups: GroupActivity[];
  vectors: AttackVectorSummary[];
  frequency: IncidentFrequency;
  ctEffectiveness: CtEffectiveness;
  topCasualty: CasualtySeverity;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const THREAT_TIER_THRESHOLDS: Record<ThreatTier, number> = {
  critical: 80,
  high: 60,
  elevated: 40,
  guarded: 20,
  low: 0,
};

export const TIER_COLORS: Record<ThreatTier, string> = {
  critical: '#ff453a',
  high: '#ff6d00',
  elevated: '#ffd600',
  guarded: '#2979ff',
  low: '#00c853',
};

export const VECTOR_LABELS: Record<AttackVector, string> = {
  vehicle: 'Vehicle RAM',
  ied: 'IED/Bomb',
  suicide: 'Suicide Bomb',
  knife: 'Knife/Blade',
  active_shooter: 'Active Shooter',
  chemical: 'Chemical',
  cyber: 'Cyber',
  rocket: 'Rocket/Mortar',
  kidnapping: 'Kidnapping',
  other: 'Other',
};

// ── Threat tier classifiers ───────────────────────────────────────────────────

/**
 * Classify a numeric score (0-100) into a ThreatTier.
 * critical >=80, high >=60, elevated >=40, guarded >=20, low <20.
 */
export function classifyThreatTier(score: number): ThreatTier {
  const clamped = Math.max(0, Math.min(100, score));
  if (clamped >= THREAT_TIER_THRESHOLDS.critical) return 'critical';
  if (clamped >= THREAT_TIER_THRESHOLDS.high) return 'high';
  if (clamped >= THREAT_TIER_THRESHOLDS.elevated) return 'elevated';
  if (clamped >= THREAT_TIER_THRESHOLDS.guarded) return 'guarded';
  return 'low';
}

/**
 * Return a human-readable label for a ThreatTier.
 */
export function tierLabel(tier: ThreatTier): string {
  const labels: Record<ThreatTier, string> = {
    critical: 'CRITICAL',
    high: 'HIGH',
    elevated: 'ELEVATED',
    guarded: 'GUARDED',
    low: 'LOW',
  };
  return labels[tier];
}

/**
 * Ordinal rank of threat tiers, highest = 4.
 */
export function tierOrdinal(tier: ThreatTier): number {
  const order: Record<ThreatTier, number> = {
    critical: 4,
    high: 3,
    elevated: 2,
    guarded: 1,
    low: 0,
  };
  return order[tier];
}

/**
 * Return the highest tier across a list of scores.
 */
export function aggregateTier(scores: number[]): ThreatTier {
  if (scores.length === 0) return 'low';
  const max = Math.max(...scores);
  return classifyThreatTier(max);
}

// ── Attack vector analyzers ───────────────────────────────────────────────────

/**
 * Summarize attack vectors from a list of incidents.
 * Returns entries sorted by count descending.
 */
export function analyzeAttackVectors(incidents: IncidentRecord[]): AttackVectorSummary[] {
  const total = incidents.length;
  const counts = new Map<AttackVector, { count: number; killed: number; wounded: number }>();

  for (const inc of incidents) {
    const existing = counts.get(inc.vector) ?? { count: 0, killed: 0, wounded: 0 };
    counts.set(inc.vector, {
      count: existing.count + 1,
      killed: existing.killed + inc.killed,
      wounded: existing.wounded + inc.wounded,
    });
  }

  return [...counts.entries()]
    .map(([vector, stats]) => ({
      vector,
      count: stats.count,
      killed: stats.killed,
      wounded: stats.wounded,
      proportion: total > 0 ? stats.count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Find the most frequently used attack vector in a set of incidents.
 * Returns 'other' when the list is empty.
 */
export function dominantVector(incidents: IncidentRecord[]): AttackVector {
  if (incidents.length === 0) return 'other';
  const summaries = analyzeAttackVectors(incidents);
  return summaries[0]?.vector ?? 'other';
}

/**
 * Compute average lethality weight for an attack vector
 * (killed + 0.5 * wounded per incident).
 */
export function vectorLethalityScore(incidents: IncidentRecord[], vector: AttackVector): number {
  const filtered = incidents.filter((i) => i.vector === vector);
  if (filtered.length === 0) return 0;
  const totalKilled = filtered.reduce((s, i) => s + i.killed, 0);
  const totalWounded = filtered.reduce((s, i) => s + i.wounded, 0);
  return (totalKilled + 0.5 * totalWounded) / filtered.length;
}

// ── Group activity scorers ─────────────────────────────────────────────────────

/**
 * Compute an activity score for a group based on incident count and casualties.
 * score = min(100, incidentCount * 4 + killed * 2 + wounded * 0.5)
 */
export function scoreGroupActivity(
  incidentCount: number,
  killed: number,
  wounded: number,
): number {
  const raw = incidentCount * 4 + killed * 2 + wounded * 0.5;
  return Math.min(100, Math.round(raw));
}

/**
 * Summarize activity for every unique group in the incident list.
 * Sorted by activityScore descending.
 */
export function analyzeGroupActivity(incidents: IncidentRecord[]): GroupActivity[] {
  const byGroup = new Map<
    ThreatGroup,
    { count: number; killed: number; wounded: number; regions: string[]; vectors: AttackVector[] }
  >();

  for (const inc of incidents) {
    const existing = byGroup.get(inc.group) ?? {
      count: 0,
      killed: 0,
      wounded: 0,
      regions: [],
      vectors: [],
    };
    byGroup.set(inc.group, {
      count: existing.count + 1,
      killed: existing.killed + inc.killed,
      wounded: existing.wounded + inc.wounded,
      regions: [...existing.regions, inc.region],
      vectors: [...existing.vectors, inc.vector],
    });
  }

  return [...byGroup.entries()]
    .map(([group, stats]) => ({
      group,
      incidentCount30d: stats.count,
      casualtiesTotal: stats.killed + stats.wounded,
      primaryVector: mostFrequent(stats.vectors) as AttackVector,
      primaryRegion: mostFrequent(stats.regions) as string,
      activityScore: scoreGroupActivity(stats.count, stats.killed, stats.wounded),
      trend: 'stable' as TrendDirection,
    }))
    .sort((a, b) => b.activityScore - a.activityScore);
}

// ── Incident frequency calculators ───────────────────────────────────────────

/**
 * Compute 30-day and 7-day incident frequency and trend direction.
 * Pass nowMs explicitly in tests for determinism.
 */
export function computeIncidentFrequency(
  incidents: IncidentRecord[],
  nowMs: number = Date.now(),
): IncidentFrequency {
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const ms60d = 60 * 24 * 60 * 60 * 1000;

  const window30d = incidents.filter((i) => nowMs - i.date <= ms30d);
  const window7d = incidents.filter((i) => nowMs - i.date <= ms7d);
  const prior30d = incidents.filter(
    (i) => nowMs - i.date > ms30d && nowMs - i.date <= ms60d,
  );

  const count30d = window30d.length;
  const count7d = window7d.length;
  const priorCount = prior30d.length;
  const dailyAvg30d = count30d / 30;

  let trendPct = 0;
  let trend: TrendDirection = 'stable';
  if (priorCount > 0) {
    trendPct = ((count30d - priorCount) / priorCount) * 100;
    if (trendPct > 10) trend = 'increasing';
    else if (trendPct < -10) trend = 'decreasing';
  } else if (count30d > 0) {
    trend = 'increasing';
    trendPct = 100;
  }

  return { count30d, count7d, dailyAvg30d, trend, trendPct };
}

// ── Casualty severity assessors ───────────────────────────────────────────────

/**
 * Assess casualty severity for given killed/wounded counts.
 * mass_casualty: killed>=10; severe: killed>=3 or total>=10;
 * moderate: total>=3; minor: total>=1; none: 0.
 */
export function assessCasualtySeverity(killed: number, wounded: number): CasualtySeverity {
  const total = killed + wounded;
  let label: CasualtySeverity['label'];
  if (killed >= 10) label = 'mass_casualty';
  else if (killed >= 3 || total >= 10) label = 'severe';
  else if (total >= 3) label = 'moderate';
  else if (total >= 1) label = 'minor';
  else label = 'none';
  return { label, killed, wounded, total };
}

/**
 * Find the single highest-severity incident in a list.
 * Returns zeros when list is empty.
 */
export function topCasualtyEvent(incidents: IncidentRecord[]): CasualtySeverity {
  if (incidents.length === 0) return { label: 'none', killed: 0, wounded: 0, total: 0 };
  const worst = incidents.reduce((best, inc) => {
    const incTotal = inc.killed + inc.wounded;
    const bestTotal = best.killed + best.wounded;
    if (inc.killed > best.killed || (inc.killed === best.killed && incTotal > bestTotal)) {
      return inc;
    }
    return best;
  }, incidents[0]!);
  return assessCasualtySeverity(worst.killed, worst.wounded);
}

// ── CT operation effectiveness metrics ───────────────────────────────────────

/**
 * Compute CT operation effectiveness rate and qualitative label.
 * excellent >=0.75, good >=0.5, fair >=0.25, poor <0.25.
 */
export function computeCtEffectiveness(incidents: IncidentRecord[]): CtEffectiveness {
  const total = incidents.length;
  const successful = incidents.filter((i) => i.ctSuccess).length;
  const rate = total > 0 ? successful / total : 0;
  let label: CtEffectiveness['label'];
  if (rate >= 0.75) label = 'excellent';
  else if (rate >= 0.5) label = 'good';
  else if (rate >= 0.25) label = 'fair';
  else label = 'poor';
  return { total, successful, rate, label };
}

// ── Regional risk aggregators ─────────────────────────────────────────────────

/**
 * Compute a risk score for a region from incident count and casualties.
 * score = min(100, count * 5 + killed * 3 + wounded)
 */
export function computeRegionScore(
  count: number,
  killed: number,
  wounded: number,
): number {
  return Math.min(100, Math.round(count * 5 + killed * 3 + wounded));
}

/**
 * Build a RegionRisk record for every unique region in the incident list.
 * Sorted by score descending.
 */
export function aggregateRegionRisks(incidents: IncidentRecord[]): RegionRisk[] {
  const byRegion = new Map<
    string,
    { killed: number; wounded: number; groups: ThreatGroup[]; vectors: AttackVector[]; ctSuccess: boolean[] }
  >();

  for (const inc of incidents) {
    const existing = byRegion.get(inc.region) ?? {
      killed: 0,
      wounded: 0,
      groups: [],
      vectors: [],
      ctSuccess: [],
    };
    byRegion.set(inc.region, {
      killed: existing.killed + inc.killed,
      wounded: existing.wounded + inc.wounded,
      groups: [...existing.groups, inc.group],
      vectors: [...existing.vectors, inc.vector],
      ctSuccess: [...existing.ctSuccess, inc.ctSuccess],
    });
  }

  return [...byRegion.entries()]
    .map(([region, stats]) => {
      const count = stats.groups.length;
      const score = computeRegionScore(count, stats.killed, stats.wounded);
      const successCount = stats.ctSuccess.filter(Boolean).length;
      const ctSuccessRate = count > 0 ? successCount / count : 0;
      return {
        region,
        tier: classifyThreatTier(score),
        score,
        incidentCount30d: count,
        topGroup: mostFrequent(stats.groups) as ThreatGroup,
        topVector: mostFrequent(stats.vectors) as AttackVector,
        trend: 'stable' as TrendDirection,
        ctSuccessRate,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Render-data builders ──────────────────────────────────────────────────────

/**
 * Build the full CounterterrorismRenderData from a list of incidents.
 * Pass nowMs explicitly in tests for determinism.
 */
export function buildRenderData(
  incidents: IncidentRecord[],
  nowMs: number = Date.now(),
): CounterterrorismRenderData {
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const recent = incidents.filter((i) => nowMs - i.date <= ms30d);

  const regions = aggregateRegionRisks(recent);
  const groups = analyzeGroupActivity(recent);
  const vectors = analyzeAttackVectors(recent);
  const frequency = computeIncidentFrequency(incidents, nowMs);
  const ctEffectiveness = computeCtEffectiveness(recent);
  const topCasualty = topCasualtyEvent(recent);

  const overallScore =
    regions.length > 0
      ? Math.round(regions.reduce((s, r) => s + r.score, 0) / regions.length)
      : 0;
  const overallTier = classifyThreatTier(overallScore);

  return {
    asOf: nowMs,
    overallTier,
    overallScore,
    regions,
    groups,
    vectors,
    frequency,
    ctEffectiveness,
    topCasualty,
  };
}

function trendArrowFor(trend: TrendDirection): string {
  if (trend === 'increasing') return '↑';
  if (trend === 'decreasing') return '↓';
  return '→';
}

function trendColorFor(trend: TrendDirection): string {
  if (trend === 'increasing') return '#ff453a';
  if (trend === 'decreasing') return '#4caf50';
  return '#9e9e9e';
}

/**
 * Build an HTML snippet for a single region row.
 */
export function buildRegionRowHtml(r: RegionRisk): string {
  const color = TIER_COLORS[r.tier];
  const trendArrow = trendArrowFor(r.trend);
  const trendColor = trendColorFor(r.trend);
  const ctPct = Math.round(r.ctSuccessRate * 100);
  return `<tr style="border-bottom:1px solid var(--border-subtle,#222);">
    <td style="padding:6px 10px;font-size:12px;color:#e5e5e5;">${escapeHtmlSimple(r.region)}</td>
    <td style="padding:6px 10px;">
      <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;
        background:${color}22;color:${color};border:1px solid ${color}44;">
        ${tierLabel(r.tier)}
      </span>
    </td>
    <td style="padding:6px 10px;font-size:12px;color:#e5e5e5;">${r.score}</td>
    <td style="padding:6px 10px;font-size:12px;color:#e5e5e5;">${r.incidentCount30d}</td>
    <td style="padding:6px 10px;font-size:12px;color:#bbb;">${escapeHtmlSimple(r.topGroup)}</td>
    <td style="padding:6px 10px;font-size:11px;color:#9e9e9e;">${VECTOR_LABELS[r.topVector] ?? r.topVector}</td>
    <td style="padding:6px 4px;font-size:13px;color:${trendColor};text-align:center;">${trendArrow}</td>
    <td style="padding:6px 10px;font-size:12px;color:#bbb;">${ctPct}%</td>
  </tr>`;
}

/**
 * Build an HTML snippet for a single group activity card.
 */
export function buildGroupCardHtml(g: GroupActivity): string {
  const tier = classifyThreatTier(g.activityScore);
  const color = TIER_COLORS[tier];
  return `<div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle,#222);display:flex;align-items:center;gap:8px;">
    <span style="flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:${color};"></span>
    <span style="flex:1;font-size:12px;color:#e5e5e5;font-weight:600;">${escapeHtmlSimple(g.group)}</span>
    <span style="font-size:11px;color:#9e9e9e;">${g.incidentCount30d} incidents</span>
    <span style="font-size:11px;color:#ff6d00;font-weight:700;">${g.activityScore}</span>
  </div>`;
}

// ── Internal utilities ─────────────────────────────────────────────────────────

/**
 * Return the most frequently occurring value in an array.
 * Returns the first element when all are tied, or '' on empty input.
 */
// eslint-disable-next-line sonarjs/function-return-type -- intentional '' sentinel on empty input, pinned by tests
export function mostFrequent<T>(arr: T[]): T | string {
  if (arr.length === 0) return '';
  const counts = new Map<string, number>();
  for (const item of arr) {
    const key = String(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = '';
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return arr.find((a) => String(a) === bestKey) ?? '';
}

/**
 * Minimal HTML escape for text content.
 */
export function escapeHtmlSimple(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Mock data factory ─────────────────────────────────────────────────────────

/** Stable seed timestamp for deterministic tests (2026-05-26T20:00:00Z). */
export const MOCK_SEED_NOW = 1_748_995_200_000;

/**
 * Return a deterministic set of mock incidents for offline/test use.
 * All dates are relative to seedNowMs.
 */
export function getMockIncidents(seedNowMs: number = MOCK_SEED_NOW): IncidentRecord[] {
  const d = (daysAgo: number): number =>
    seedNowMs - daysAgo * 24 * 60 * 60 * 1000;

  return [
    // Sahel / West Africa — Al-Qaeda & ISIS
    { id: 'i001', date: d(2),  region: 'Sahel', country: 'Mali',          group: 'Al-Qaeda',     vector: 'ied',           killed: 4,  wounded: 11, ctSuccess: false },
    { id: 'i002', date: d(5),  region: 'Sahel', country: 'Burkina Faso',  group: 'ISIS',          vector: 'active_shooter',killed: 9,  wounded: 6,  ctSuccess: false },
    { id: 'i003', date: d(8),  region: 'Sahel', country: 'Niger',         group: 'Al-Qaeda',     vector: 'vehicle',       killed: 2,  wounded: 3,  ctSuccess: true  },
    { id: 'i004', date: d(12), region: 'Sahel', country: 'Mali',          group: 'ISIS',          vector: 'ied',           killed: 6,  wounded: 14, ctSuccess: false },
    { id: 'i005', date: d(18), region: 'Sahel', country: 'Burkina Faso',  group: 'Al-Qaeda',     vector: 'rocket',        killed: 1,  wounded: 5,  ctSuccess: true  },
    // East Africa — al-Shabaab
    { id: 'i006', date: d(1),  region: 'East Africa', country: 'Somalia', group: 'al-Shabaab',   vector: 'suicide',       killed: 14, wounded: 22, ctSuccess: false },
    { id: 'i007', date: d(6),  region: 'East Africa', country: 'Kenya',   group: 'al-Shabaab',   vector: 'ied',           killed: 3,  wounded: 8,  ctSuccess: true  },
    { id: 'i008', date: d(11), region: 'East Africa', country: 'Somalia', group: 'al-Shabaab',   vector: 'active_shooter',killed: 7,  wounded: 12, ctSuccess: false },
    { id: 'i009', date: d(20), region: 'East Africa', country: 'Somalia', group: 'al-Shabaab',   vector: 'vehicle',       killed: 5,  wounded: 9,  ctSuccess: true  },
    // West Africa — Boko Haram
    { id: 'i010', date: d(3),  region: 'West Africa', country: 'Nigeria', group: 'Boko Haram',   vector: 'active_shooter',killed: 11, wounded: 18, ctSuccess: false },
    { id: 'i011', date: d(9),  region: 'West Africa', country: 'Cameroon',group: 'Boko Haram',   vector: 'kidnapping',    killed: 0,  wounded: 2,  ctSuccess: false },
    { id: 'i012', date: d(15), region: 'West Africa', country: 'Nigeria', group: 'Boko Haram',   vector: 'suicide',       killed: 8,  wounded: 15, ctSuccess: false },
    { id: 'i013', date: d(25), region: 'West Africa', country: 'Chad',    group: 'Boko Haram',   vector: 'ied',           killed: 3,  wounded: 7,  ctSuccess: true  },
    // South Asia — TTP & ISIS
    { id: 'i014', date: d(4),  region: 'South Asia',  country: 'Pakistan',     group: 'TTP',     vector: 'suicide',       killed: 16, wounded: 30, ctSuccess: false },
    { id: 'i015', date: d(7),  region: 'South Asia',  country: 'Afghanistan',  group: 'ISIS',    vector: 'ied',           killed: 8,  wounded: 21, ctSuccess: false },
    { id: 'i016', date: d(13), region: 'South Asia',  country: 'Pakistan',     group: 'TTP',     vector: 'active_shooter',killed: 5,  wounded: 9,  ctSuccess: true  },
    { id: 'i017', date: d(22), region: 'South Asia',  country: 'Pakistan',     group: 'TTP',     vector: 'rocket',        killed: 2,  wounded: 4,  ctSuccess: true  },
    // Middle East — ISIS & Hezbollah
    { id: 'i018', date: d(2),  region: 'Middle East', country: 'Iraq',    group: 'ISIS',          vector: 'ied',           killed: 5,  wounded: 13, ctSuccess: true  },
    { id: 'i019', date: d(6),  region: 'Middle East', country: 'Syria',   group: 'ISIS',          vector: 'active_shooter',killed: 3,  wounded: 6,  ctSuccess: true  },
    { id: 'i020', date: d(10), region: 'Middle East', country: 'Lebanon', group: 'Hezbollah',    vector: 'rocket',        killed: 1,  wounded: 4,  ctSuccess: false },
    { id: 'i021', date: d(16), region: 'Middle East', country: 'Iraq',    group: 'ISIS',          vector: 'suicide',       killed: 12, wounded: 25, ctSuccess: false },
    // Europe — PKK & ISIS
    { id: 'i022', date: d(5),  region: 'Europe',      country: 'Turkey',  group: 'PKK',           vector: 'ied',           killed: 2,  wounded: 8,  ctSuccess: true  },
    { id: 'i023', date: d(14), region: 'Europe',      country: 'France',  group: 'ISIS',          vector: 'knife',         killed: 1,  wounded: 2,  ctSuccess: true  },
    { id: 'i024', date: d(21), region: 'Europe',      country: 'Turkey',  group: 'PKK',           vector: 'active_shooter',killed: 3,  wounded: 5,  ctSuccess: false },
    // Latin America — FARC remnants
    { id: 'i025', date: d(8),  region: 'Latin America', country: 'Colombia',  group: 'FARC remnants', vector: 'ied',       killed: 1,  wounded: 4,  ctSuccess: true  },
    { id: 'i026', date: d(17), region: 'Latin America', country: 'Venezuela', group: 'FARC remnants', vector: 'kidnapping',killed: 0,  wounded: 1,  ctSuccess: false },
    // Prior 30-60d window (for trend calculation)
    { id: 'i027', date: d(35), region: 'Sahel',       country: 'Mali',    group: 'Al-Qaeda',     vector: 'ied',           killed: 5,  wounded: 9,  ctSuccess: false },
    { id: 'i028', date: d(40), region: 'East Africa', country: 'Somalia', group: 'al-Shabaab',   vector: 'suicide',       killed: 10, wounded: 18, ctSuccess: false },
    { id: 'i029', date: d(50), region: 'South Asia',  country: 'Pakistan',group: 'TTP',           vector: 'suicide',       killed: 8,  wounded: 20, ctSuccess: false },
    { id: 'i030', date: d(55), region: 'West Africa', country: 'Nigeria', group: 'Boko Haram',   vector: 'active_shooter',killed: 6,  wounded: 12, ctSuccess: false },
  ];
}
