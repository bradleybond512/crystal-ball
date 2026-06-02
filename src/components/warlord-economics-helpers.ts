/**
 * Pure helpers for WarlordEconomicsPanel.
 *
 * No DOM, no fetch — safe to import in Node.js tests. The panel itself is a
 * thin DOM layer; all scoring, filtering, and catalogue data live here.
 *
 * Coverage: 10 active conflict-economy profiles spanning minerals, narcotics,
 * taxation, port extortion, kidnapping, and natural-resource exploitation by
 * armed non-state actors. Strictly analytical / security-intelligence framing.
 *
 * Helper functions exported:
 *   getByResourceType                  filter profiles by a primary resource type
 *   getHighRevenue                     filter above a revenue threshold (billions)
 *   getByRegion                        filter profiles by conflict region
 *   computeGlobalConflictEconomyIndex  aggregate index across all profiles
 *   revenueClass                       classify annual revenue into a named band
 *   resourceTypeClass                  CSS class token for a resource type
 *   buildRenderData                    enriched rows for the panel renderer
 */

// ── Types ────────────────────────────────────────────────────────────

export type ResourceType =
  | 'minerals'
  | 'gold'
  | 'narcotics'
  | 'cocaine'
  | 'jade'
  | 'oil'
  | 'timber'
  | 'taxation'
  | 'kidnapping'
  | 'port-fees';

export type RevenueClass = 'micro' | 'minor' | 'moderate' | 'major' | 'mega';

export type ConflictRegion =
  | 'Sub-Saharan Africa'
  | 'East Africa'
  | 'West Africa'
  | 'Sahel'
  | 'South Asia'
  | 'Southeast Asia'
  | 'Middle East'
  | 'Latin America'
  | 'Iraq-Syria'
  | 'Caribbean';

export interface ConflictEconomyProfile {
  /** Kebab-case unique identifier. */
  id: string;
  /** Human-readable display name (country + primary commodity). */
  name: string;
  country: string;
  region: ConflictRegion;
  controllingActor: string;
  externalBackers: string[];
  primaryRevenueSources: ResourceType[];
  /** Low end of published annual revenue estimates, in USD billions. */
  annualRevenueMinBillions: number;
  /** High end of published annual revenue estimates, in USD billions. */
  annualRevenueMaxBillions: number;
  /** Mid-point estimate used for scoring. */
  annualRevenueMidBillions: number;
  keyNote: string;
}

export interface GlobalConflictEconomyIndex {
  /** Sum of all mid-point annual revenue estimates. */
  totalAnnualRevenueBillions: number;
  profileCount: number;
  megaRevenueCount: number;
  majorRevenueCount: number;
  /** Top 3 regions by total estimated annual revenue. */
  topRegions: { region: ConflictRegion; totalBillions: number }[];
  /** Resource types appearing across the most profiles, descending. */
  dominantResourceTypes: { type: ResourceType; profileCount: number }[];
  /** 0-100 composite severity score. */
  indexScore: number;
}

export interface ConflictEconomyRenderRow {
  profile: ConflictEconomyProfile;
  revenueClass: RevenueClass;
  revenueColor: string;
  revenueRangeLabel: string;
  resourceLabels: string[];
  primaryResourceLabel: string;
}

export interface WarlordEconomicsRenderData {
  rows: ConflictEconomyRenderRow[];
  globalIndex: GlobalConflictEconomyIndex;
  highRevenueProfiles: ConflictEconomyProfile[];
  updatedAt: string;
}

// ── Static catalogue ─────────────────────────────────────────────────

export const CONFLICT_ECONOMY_PROFILES: readonly ConflictEconomyProfile[] = [
  {
    id: 'drc-minerals',
    name: 'DRC — Coltan / Gold',
    country: 'Democratic Republic of Congo',
    region: 'Sub-Saharan Africa',
    controllingActor: 'M23 / RSF-allied militias',
    externalBackers: ['Rwanda (alleged)', 'Uganda (alleged)'],
    primaryRevenueSources: ['minerals', 'gold'],
    annualRevenueMinBillions: 0.9,
    annualRevenueMaxBillions: 1.5,
    annualRevenueMidBillions: 1.2,
    keyNote:
      'M23 and allied militias control coltan and gold-mining zones in eastern DRC. ' +
      'Smuggling routes funnel output through Rwanda. UN GoE estimates $1.2B/yr ' +
      'in illicit mineral revenues sustaining armed groups.',
  },
  {
    id: 'afghanistan-narcotics',
    name: 'Afghanistan — Opium to Methamphetamine',
    country: 'Afghanistan',
    region: 'South Asia',
    controllingActor: 'Taliban',
    externalBackers: [],
    primaryRevenueSources: ['narcotics', 'taxation'],
    annualRevenueMinBillions: 1,
    annualRevenueMaxBillions: 2,
    annualRevenueMidBillions: 1.5,
    keyNote:
      'Taliban taxes narcotics cultivation and trade. 2022 opium-ban collapsed ' +
      'poppy output but industrial methamphetamine production surged using ' +
      'locally harvested ephedra. UNODC estimates $1-2B/yr in narcotics revenue.',
  },
  {
    id: 'sudan-rsf-gold',
    name: 'Sudan — RSF Gold',
    country: 'Sudan',
    region: 'East Africa',
    controllingActor: 'Rapid Support Forces (RSF)',
    externalBackers: ['UAE (alleged)', 'Wagner Group (historical)'],
    primaryRevenueSources: ['gold', 'minerals'],
    annualRevenueMinBillions: 1.3,
    annualRevenueMaxBillions: 1.7,
    annualRevenueMidBillions: 1.5,
    keyNote:
      "RSF under Hemeti controls ~80% of Sudan's artisanal gold output. " +
      'Gold is flown directly to UAE refineries, bypassing state systems. ' +
      'Estimated $1.5B/yr provides the RSF with independent war-financing capacity.',
  },
  {
    id: 'myanmar-uwsa',
    name: 'Myanmar — Jade / Opium / Meth',
    country: 'Myanmar',
    region: 'Southeast Asia',
    controllingActor: 'UWSA / Kachin Independence Army',
    externalBackers: ['China (tacit tolerance)'],
    primaryRevenueSources: ['jade', 'narcotics', 'minerals'],
    annualRevenueMinBillions: 1,
    annualRevenueMaxBillions: 3,
    annualRevenueMidBillions: 2,
    keyNote:
      'Wa State (UWSA) operates as a de-facto independent polity. Global Witness ' +
      'estimates jade-sector value at $31B cumulative; annual flows multi-billion. ' +
      'Golden Triangle meth and opium sustained by Shan/Kachin actors.',
  },
  {
    id: 'somalia-al-shabaab',
    name: 'Somalia — Charcoal / Taxation',
    country: 'Somalia',
    region: 'East Africa',
    controllingActor: 'Al-Shabaab',
    externalBackers: [],
    primaryRevenueSources: ['timber', 'taxation', 'kidnapping'],
    annualRevenueMinBillions: 0.05,
    annualRevenueMaxBillions: 0.1,
    annualRevenueMidBillions: 0.075,
    keyNote:
      'Al-Shabaab generates $50-100M/yr through charcoal export (UN-banned), ' +
      'taxation of trade routes, port fees, and ransom from kidnapping. ' +
      'Charcoal smuggling via Kismayo continues despite AU/UN interdiction efforts.',
  },
  {
    id: 'mali-sahel-jnim',
    name: 'Mali / Sahel — JNIM Trade-Route Taxation',
    country: 'Mali / Burkina Faso / Niger',
    region: 'Sahel',
    controllingActor: 'JNIM / GSIM',
    externalBackers: ['AQIM network'],
    primaryRevenueSources: ['taxation', 'kidnapping', 'minerals'],
    annualRevenueMinBillions: 0.1,
    annualRevenueMaxBillions: 0.3,
    annualRevenueMidBillions: 0.2,
    keyNote:
      'JNIM controls trans-Saharan trade corridors, levying taxes on goods, ' +
      'livestock, and fuel. Kidnapping ransoms from Western hostages provide ' +
      'high-value irregular income. Gold-mine extortion is an emerging revenue stream.',
  },
  {
    id: 'yemen-houthi',
    name: 'Yemen — Houthi Port / Oil Revenue',
    country: 'Yemen',
    region: 'Middle East',
    controllingActor: 'Houthis (Ansar Allah)',
    externalBackers: ['Iran (IRGC-QF)'],
    primaryRevenueSources: ['port-fees', 'oil', 'taxation'],
    annualRevenueMinBillions: 0.2,
    annualRevenueMaxBillions: 0.5,
    annualRevenueMidBillions: 0.35,
    keyNote:
      'Houthis control Hodeidah port and Ras Issa oil terminal, taxing all imports. ' +
      'Iran supplies weapons, cash, and training. Multi-hundred-million-dollar annual ' +
      'revenue base funds ballistic missile and drone programs targeting Red Sea shipping.',
  },
  {
    id: 'colombia-armed-groups',
    name: 'Colombia — Cocaine Processing',
    country: 'Colombia',
    region: 'Latin America',
    controllingActor: 'FARC-EMC / ELN / Clan del Golfo',
    externalBackers: ['Venezuelan state elements (alleged)'],
    primaryRevenueSources: ['cocaine', 'narcotics', 'taxation'],
    annualRevenueMinBillions: 0.8,
    annualRevenueMaxBillions: 1.5,
    annualRevenueMidBillions: 1,
    keyNote:
      'FARC dissidents (EMC), ELN, and Clan del Golfo collectively process and ' +
      'export the majority of global cocaine supply. Combined revenue exceeds $1B/yr. ' +
      'Petro government total-peace negotiations ongoing with mixed results.',
  },
  {
    id: 'iraq-syria-isis',
    name: 'Iraq / Syria — IS Remnants',
    country: 'Iraq / Syria',
    region: 'Iraq-Syria',
    controllingActor: 'Islamic State remnants',
    externalBackers: [],
    primaryRevenueSources: ['oil', 'taxation', 'kidnapping'],
    annualRevenueMinBillions: 0.1,
    annualRevenueMaxBillions: 0.3,
    annualRevenueMidBillions: 0.2,
    keyNote:
      'IS remnants collect oil-field taxation in Deir ez-Zor, extort local businesses, ' +
      'and conduct kidnapping in rural Iraq. Revenue sharply reduced from 2015 peak ' +
      '($2B+), but ongoing insurgency in Badia Desert remains self-financing.',
  },
  {
    id: 'haiti-gangs',
    name: 'Haiti — G9 / Viv Ansanm Port Extortion',
    country: 'Haiti',
    region: 'Caribbean',
    controllingActor: 'G9 an Fanmi / Viv Ansanm coalition',
    externalBackers: ['Diaspora remittance networks (alleged)'],
    primaryRevenueSources: ['port-fees', 'taxation', 'kidnapping'],
    annualRevenueMinBillions: 0.1,
    annualRevenueMaxBillions: 0.3,
    annualRevenueMidBillions: 0.2,
    keyNote:
      'Gang coalitions control ~80% of Port-au-Prince including key fuel terminals ' +
      'and the Varreux port. Kidnapping for ransom generates high per-incident returns. ' +
      'MSS (Kenya-led) deployment has had limited effect on gang territorial control.',
  },
];

// ── Label / color helpers ─────────────────────────────────────────────

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  minerals:    'Minerals',
  gold:        'Gold',
  narcotics:   'Narcotics',
  cocaine:     'Cocaine',
  jade:        'Jade',
  oil:         'Oil',
  timber:      'Timber / Charcoal',
  taxation:    'Taxation',
  kidnapping:  'Kidnapping / Ransom',
  'port-fees': 'Port Fees',
};

export function resourceTypeLabel(t: ResourceType): string {
  return RESOURCE_TYPE_LABELS[t] ?? t;
}

export function resourceTypeClass(t: ResourceType): string {
  const map: Record<ResourceType, string> = {
    minerals:    'wep-resource-minerals',
    gold:        'wep-resource-gold',
    narcotics:   'wep-resource-narcotics',
    cocaine:     'wep-resource-cocaine',
    jade:        'wep-resource-jade',
    oil:         'wep-resource-oil',
    timber:      'wep-resource-timber',
    taxation:    'wep-resource-taxation',
    kidnapping:  'wep-resource-kidnapping',
    'port-fees': 'wep-resource-port',
  };
  return map[t] ?? 'wep-resource-unknown';
}

/**
 * Classify annual revenue (in USD billions) into a named band.
 *
 * micro    < $50M   (< 0.05)
 * minor    $50-200M   (0.05-0.2)
 * moderate $200-500M  (0.2-0.5)
 * major    $500M-1B   (0.5-1.0)
 * mega     > $1B      (>= 1.0)
 */
export function revenueClass(annualRevenueBillions: number): RevenueClass {
  if (annualRevenueBillions < 0.05) return 'micro';
  if (annualRevenueBillions < 0.2)  return 'minor';
  if (annualRevenueBillions < 0.5)  return 'moderate';
  if (annualRevenueBillions < 1)  return 'major';
  return 'mega';
}

export function revenueClassLabel(rc: RevenueClass): string {
  const map: Record<RevenueClass, string> = {
    micro:    'Micro (<$50M)',
    minor:    'Minor ($50-200M)',
    moderate: 'Moderate ($200-500M)',
    major:    'Major ($500M-1B)',
    mega:     'Mega (>$1B)',
  };
  return map[rc];
}

export function revenueClassColor(rc: RevenueClass): string {
  const map: Record<RevenueClass, string> = {
    micro:    'var(--severity-none,     #9e9e9e)',
    minor:    'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    major:    'var(--severity-high,     #fb923c)',
    mega:     'var(--severity-critical, #ef4444)',
  };
  return map[rc];
}

export function formatRevenueBillions(mid: number, min: number, max: number): string {
  if (mid < 0.1) {
    return '$' + Math.round(mid * 1000) + 'M/yr (est. $' + Math.round(min * 1000) + '-' + Math.round(max * 1000) + 'M)';
  }
  const midStr = mid >= 1 ? '$' + mid.toFixed(1) + 'B' : '$' + Math.round(mid * 1000) + 'M';
  const minStr = min >= 1 ? '$' + min.toFixed(1) + 'B' : '$' + Math.round(min * 1000) + 'M';
  const maxStr = max >= 1 ? '$' + max.toFixed(1) + 'B' : '$' + Math.round(max * 1000) + 'M';
  return midStr + '/yr (est. ' + minStr + '-' + maxStr + ')';
}

// ── Filter helpers ───────────────────────────────────────────────────

export function getByResourceType(
  profiles: readonly ConflictEconomyProfile[],
  type: ResourceType,
): ConflictEconomyProfile[] {
  return profiles.filter((p) => p.primaryRevenueSources.includes(type));
}

export function getHighRevenue(
  profiles: readonly ConflictEconomyProfile[],
  minBillions: number,
): ConflictEconomyProfile[] {
  return profiles.filter((p) => p.annualRevenueMidBillions >= minBillions);
}

export function getByRegion(
  profiles: readonly ConflictEconomyProfile[],
  region: ConflictRegion,
): ConflictEconomyProfile[] {
  return profiles.filter((p) => p.region === region);
}

// ── Aggregate index ──────────────────────────────────────────────────

/**
 * Compute a global conflict-economy index across the supplied profiles.
 * indexScore (0-100): each $1B annual conflict revenue contributes ~10 pts, clamped.
 */
export function computeGlobalConflictEconomyIndex(
  profiles: readonly ConflictEconomyProfile[],
): GlobalConflictEconomyIndex {
  const total = profiles.reduce((s, p) => s + p.annualRevenueMidBillions, 0);

  const megaRevenueCount  = profiles.filter((p) => revenueClass(p.annualRevenueMidBillions) === 'mega').length;
  const majorRevenueCount = profiles.filter((p) => revenueClass(p.annualRevenueMidBillions) === 'major').length;

  const regionMap = new Map<ConflictRegion, number>();
  for (const p of profiles) {
    regionMap.set(p.region, (regionMap.get(p.region) ?? 0) + p.annualRevenueMidBillions);
  }
  const topRegions = [...regionMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([region, totalBillions]) => ({ region, totalBillions }));

  const rtMap = new Map<ResourceType, number>();
  for (const p of profiles) {
    for (const rt of p.primaryRevenueSources) {
      rtMap.set(rt, (rtMap.get(rt) ?? 0) + 1);
    }
  }
  const dominantResourceTypes = [...rtMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, profileCount]) => ({ type, profileCount }));

  const indexScore = Math.min(100, Math.round(total * 10));

  return {
    totalAnnualRevenueBillions: Math.round(total * 10) / 10,
    profileCount: profiles.length,
    megaRevenueCount,
    majorRevenueCount,
    topRegions,
    dominantResourceTypes,
    indexScore,
  };
}

// ── Render-data builder ──────────────────────────────────────────────

export function buildRenderData(
  profiles: readonly ConflictEconomyProfile[],
  now: string = new Date().toISOString(),
): WarlordEconomicsRenderData {
  const rows: ConflictEconomyRenderRow[] = profiles.map((profile) => {
    const rc = revenueClass(profile.annualRevenueMidBillions);
    return {
      profile,
      revenueClass: rc,
      revenueColor: revenueClassColor(rc),
      revenueRangeLabel: formatRevenueBillions(
        profile.annualRevenueMidBillions,
        profile.annualRevenueMinBillions,
        profile.annualRevenueMaxBillions,
      ),
      resourceLabels: profile.primaryRevenueSources.map(r => resourceTypeLabel(r)),
      primaryResourceLabel: resourceTypeLabel(profile.primaryRevenueSources[0] ?? 'taxation'),
    };
  });

  const globalIndex = computeGlobalConflictEconomyIndex(profiles);
  const highRevenueProfiles = getHighRevenue(profiles, 0.5);

  return { rows, globalIndex, highRevenueProfiles, updatedAt: now };
}
