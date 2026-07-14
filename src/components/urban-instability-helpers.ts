/**
 * Pure helpers for UrbanInstabilityPanel.
 * No DOM, no fetch, no globals — safe to import in Node.js tests.
 *
 * Models city-level protest intensity, gang control, displacement pressure,
 * and government response capacity into a composite instability risk score.
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CityRawData {
  name: string;
  country: string;
  protestIntensity: number;       // 0–100
  riotFrequency: number;          // 0–100
  gangControlPercent: number;     // 0–100 (territorial %)
  vigilanteActivity: number;      // 0–100
  govResponseCapacity: number;    // 0–100 (higher = more capable)
  displacementPressure: number;   // 0–100
  economicGrievanceIndex: number; // 0–100
  lastUpdated: string;            // ISO date string
}

export interface CityInstabilityResult {
  city: CityRawData;
  compositeRisk: number;          // 0–100
  tier: InstabilityTier;
  tierLabel: string;
  dominantDriver: string;
  protestScore: number;
  displacementScore: number;
  responseCapacityScore: number;
  renderClass: string;
}

export type InstabilityTier = 'critical' | 'severe' | 'high' | 'elevated' | 'moderate' | 'low';

// ── Tier classification ────────────────────────────────────────────────────

export function classifyInstabilityTier(compositeRisk: number): InstabilityTier {
  if (compositeRisk >= 85) return 'critical';
  if (compositeRisk >= 70) return 'severe';
  if (compositeRisk >= 55) return 'high';
  if (compositeRisk >= 40) return 'elevated';
  if (compositeRisk >= 25) return 'moderate';
  return 'low';
}

export function tierToLabel(tier: InstabilityTier): string {
  switch (tier) {
    case 'critical': {  return 'Critical';
    }
    case 'severe': {    return 'Severe';
    }
    case 'high': {      return 'High';
    }
    case 'elevated': {  return 'Elevated';
    }
    case 'moderate': {  return 'Moderate';
    }
    case 'low': {       return 'Low';
    }
  }
}

export function tierToRenderClass(tier: InstabilityTier): string {
  return `tier-${tier}`;
}

// ── Component scorers ────────────────────────────────────────────────────

export function scoreProtestIntensity(protestIntensity: number, riotFrequency: number): number {
  const raw = protestIntensity * 0.6 + riotFrequency * 0.4;
  return Math.max(0, Math.min(100, raw));
}

export function scoreDisplacementPressure(displacement: number, economicGrievance: number): number {
  const raw = displacement * 0.7 + economicGrievance * 0.3;
  return Math.max(0, Math.min(100, raw));
}

export function scoreResponseCapacity(govCapacity: number): number {
  return 100 - govCapacity;
}

// ── Composite risk ─────────────────────────────────────────────────────────

export function computeCompositeRisk(city: CityRawData): number {
  const protestScore = scoreProtestIntensity(city.protestIntensity, city.riotFrequency);
  const displacementScore = scoreDisplacementPressure(city.displacementPressure, city.economicGrievanceIndex);
  const responseScore = scoreResponseCapacity(city.govResponseCapacity);

  const raw =
    protestScore * 0.25 +
    city.riotFrequency * 0.15 +
    city.gangControlPercent * 0.2 +
    city.vigilanteActivity * 0.1 +
    responseScore * 0.15 +
    displacementScore * 0.15;

  return Math.max(0, Math.min(100, raw));
}

// ── Dominant driver identification ────────────────────────────────────────

export function identifyDominantDriver(city: CityRawData): string {
  const factors: { label: string; value: number }[] = [
    { label: 'Protest Intensity', value: city.protestIntensity },
    { label: 'Riot Frequency', value: city.riotFrequency },
    { label: 'Gang Territorial Control', value: city.gangControlPercent },
    { label: 'Vigilante Activity', value: city.vigilanteActivity },
    { label: 'Governance Deficit', value: scoreResponseCapacity(city.govResponseCapacity) },
    { label: 'Displacement Pressure', value: city.displacementPressure },
    { label: 'Economic Grievance', value: city.economicGrievanceIndex },
  ];

  let max: { label: string; value: number } = factors[0] ?? { label: 'Unknown', value: 0 };
  for (const f of factors) {
    if (f.value > max.value) max = f;
  }
  return max.label;
}

// ── Result builder ────────────────────────────────────────────────────────

export function buildCityResult(city: CityRawData): CityInstabilityResult {
  const compositeRisk = computeCompositeRisk(city);
  const tier = classifyInstabilityTier(compositeRisk);
  return {
    city,
    compositeRisk,
    tier,
    tierLabel: tierToLabel(tier),
    dominantDriver: identifyDominantDriver(city),
    protestScore: scoreProtestIntensity(city.protestIntensity, city.riotFrequency),
    displacementScore: scoreDisplacementPressure(city.displacementPressure, city.economicGrievanceIndex),
    responseCapacityScore: scoreResponseCapacity(city.govResponseCapacity),
    renderClass: tierToRenderClass(tier),
  };
}

// ── Sorting & filtering ───────────────────────────────────────────────────

export function sortCitiesByRisk(results: CityInstabilityResult[]): CityInstabilityResult[] {
  return [...results].sort((a, b) => b.compositeRisk - a.compositeRisk);
}

const TIER_ORDER: Record<InstabilityTier, number> = {
  critical: 5,
  severe: 4,
  high: 3,
  elevated: 2,
  moderate: 1,
  low: 0,
};

export function filterByTier(results: CityInstabilityResult[], minTier: InstabilityTier): CityInstabilityResult[] {
  const minOrder = TIER_ORDER[minTier];
  return results.filter((r) => TIER_ORDER[r.tier] >= minOrder);
}

// ── Mock city data ────────────────────────────────────────────────────────

export function getMockCityData(): CityRawData[] {
  return [
    {
      name: 'Caracas',
      country: 'Venezuela',
      protestIntensity: 70,
      riotFrequency: 60,
      gangControlPercent: 65,
      vigilanteActivity: 45,
      govResponseCapacity: 30,
      displacementPressure: 70,
      economicGrievanceIndex: 85,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Port-au-Prince',
      country: 'Haiti',
      protestIntensity: 75,
      riotFrequency: 70,
      gangControlPercent: 90,
      vigilanteActivity: 60,
      govResponseCapacity: 15,
      displacementPressure: 80,
      economicGrievanceIndex: 80,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Mogadishu',
      country: 'Somalia',
      protestIntensity: 75,
      riotFrequency: 70,
      gangControlPercent: 55,
      vigilanteActivity: 65,
      govResponseCapacity: 20,
      displacementPressure: 70,
      economicGrievanceIndex: 75,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Kabul',
      country: 'Afghanistan',
      protestIntensity: 60,
      riotFrequency: 55,
      gangControlPercent: 50,
      vigilanteActivity: 80,
      govResponseCapacity: 10,
      displacementPressure: 75,
      economicGrievanceIndex: 80,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Baghdad',
      country: 'Iraq',
      protestIntensity: 60,
      riotFrequency: 55,
      gangControlPercent: 60,
      vigilanteActivity: 55,
      govResponseCapacity: 35,
      displacementPressure: 60,
      economicGrievanceIndex: 65,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Tripoli',
      country: 'Libya',
      protestIntensity: 60,
      riotFrequency: 65,
      gangControlPercent: 70,
      vigilanteActivity: 60,
      govResponseCapacity: 25,
      displacementPressure: 65,
      economicGrievanceIndex: 65,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Khartoum',
      country: 'Sudan',
      protestIntensity: 80,
      riotFrequency: 70,
      gangControlPercent: 55,
      vigilanteActivity: 65,
      govResponseCapacity: 15,
      displacementPressure: 90,
      economicGrievanceIndex: 80,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Nairobi',
      country: 'Kenya',
      protestIntensity: 55,
      riotFrequency: 45,
      gangControlPercent: 40,
      vigilanteActivity: 35,
      govResponseCapacity: 50,
      displacementPressure: 40,
      economicGrievanceIndex: 60,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'Karachi',
      country: 'Pakistan',
      protestIntensity: 60,
      riotFrequency: 55,
      gangControlPercent: 65,
      vigilanteActivity: 50,
      govResponseCapacity: 45,
      displacementPressure: 55,
      economicGrievanceIndex: 70,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
    {
      name: 'São Paulo',
      country: 'Brazil',
      protestIntensity: 50,
      riotFrequency: 40,
      gangControlPercent: 55,
      vigilanteActivity: 40,
      govResponseCapacity: 55,
      displacementPressure: 40,
      economicGrievanceIndex: 65,
      lastUpdated: '2026-05-27T00:00:00Z',
    },
  ];
}

// ── Pipeline entry point ──────────────────────────────────────────────────

export function buildPanelRenderData(cities: CityRawData[]): CityInstabilityResult[] {
  return sortCitiesByRisk(cities.map((city) => buildCityResult(city)));
}

// ── Tier color palette ────────────────────────────────────────────────────

export function tierToColor(tier: InstabilityTier): string {
  switch (tier) {
    case 'critical': { return '#ff453a'; }
    case 'severe': { return '#e64a19'; }
    case 'high': { return '#ff9800'; }
    case 'elevated': { return '#fbc02d'; }
    case 'moderate': { return '#aed581'; }
    case 'low': { return '#4caf50'; }
  }
}

// ── HTML rendering ────────────────────────────────────────────────────────

export function renderCityCard(result: CityInstabilityResult): string {
  const color = tierToColor(result.tier);
  return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px 12px;margin-bottom:8px;background:var(--bg-elevated,rgba(255,255,255,0.02));">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <div>
        <span style="font-weight:700;font-size:13px;">${escapeHtml(result.city.name)}</span>
        <span style="color:var(--text-secondary,#888);font-size:11px;margin-left:6px;">${escapeHtml(result.city.country)}</span>
      </div>
      <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:1px 6px;border:1px solid ${color};border-radius:2px;">${escapeHtml(result.tierLabel)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;font-size:11px;color:var(--text-secondary,#aaa);">
      <span>Risk: <strong style="color:${color};">${result.compositeRisk.toFixed(0)}</strong></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(result.dominantDriver)}">Driver: ${escapeHtml(result.dominantDriver)}</span>
    </div>
  </div>`;
}

export function renderCitiesSection(results: CityInstabilityResult[]): string {
  if (results.length === 0) {
    return '<div style="padding:12px;color:var(--text-secondary,#777);font-size:12px;">No city data available.</div>';
  }
  return results.map((result) => renderCityCard(result)).join('');
}
