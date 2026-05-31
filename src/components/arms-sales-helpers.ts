// arms-sales-helpers.ts
// Pure logic for ArmsSalesPanel — no DOM, no Panel imports

export type ArmsTrend = 'rising' | 'stable' | 'declining';
export type DealStatus = 'Delivered' | 'In Progress' | 'Contracted' | 'Suspended';
export type SystemType =
  | 'Fighter Aircraft'
  | 'Air Defense'
  | 'Tanks'
  | 'Artillery'
  | 'Submarines'
  | 'Naval'
  | 'Helicopters'
  | 'Missiles'
  | 'Mixed/Aid';

export interface ArmsExporter {
  country: string;
  globalSharePct: number;
  trend: ArmsTrend;
  topRecipients: string[];
}

export interface ArmsDeal {
  id: string;
  exporter: string;
  recipient: string;
  systemType: SystemType;
  valueB: number; // USD billions
  year: number;
  status: DealStatus;
  significance: number; // 1-10
  description: string;
}

export interface ArmsRenderData {
  exporters: ArmsExporter[];
  deals: ArmsDeal[];
  globalArmsIndex: number;
  usaDominanceScore: number;
  totalValueB: number;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const EXPORTERS: ArmsExporter[] = [
  { country: 'USA',         globalSharePct: 42.0, trend: 'rising',   topRecipients: ['Ukraine', 'Israel', 'Taiwan', 'Saudi Arabia', 'South Korea'] },
  { country: 'Russia',      globalSharePct: 11.0, trend: 'declining', topRecipients: ['India', 'China', 'Iran', 'Algeria'] },
  { country: 'France',      globalSharePct: 11.0, trend: 'rising',   topRecipients: ['India', 'UAE', 'Qatar', 'Greece'] },
  { country: 'China',       globalSharePct:  5.8, trend: 'stable',   topRecipients: ['Pakistan', 'Bangladesh', 'Thailand'] },
  { country: 'Germany',     globalSharePct:  5.6, trend: 'rising',   topRecipients: ['Ukraine', 'Hungary', 'South Korea', 'Norway'] },
  { country: 'Italy',       globalSharePct:  3.8, trend: 'stable',   topRecipients: ['Qatar', 'Kuwait', 'Egypt'] },
  { country: 'UK',          globalSharePct:  3.1, trend: 'stable',   topRecipients: ['Saudi Arabia', 'USA', 'Oman'] },
  { country: 'Spain',       globalSharePct:  2.8, trend: 'stable',   topRecipients: ['Australia', 'Saudi Arabia', 'Turkey'] },
  { country: 'Israel',      globalSharePct:  2.4, trend: 'declining', topRecipients: ['India', 'Azerbaijan', 'Philippines'] },
  { country: 'South Korea', globalSharePct:  2.3, trend: 'rising',   topRecipients: ['Poland', 'Australia', 'UAE'] },
];

const DEALS: ArmsDeal[] = [
  {
    id: 'AD001', exporter: 'USA', recipient: 'Ukraine',
    systemType: 'Mixed/Aid', valueB: 61.0, year: 2022,
    status: 'In Progress', significance: 10,
    description: 'Comprehensive military aid package: HIMARS rocket systems, M1 Abrams tanks, Patriot air defense, F-16 fighters, artillery ammunition.',
  },
  {
    id: 'AD002', exporter: 'USA', recipient: 'Taiwan',
    systemType: 'Fighter Aircraft', valueB: 19.0, year: 2022,
    status: 'In Progress', significance: 9,
    description: 'Major arms sales package including F-16V upgrade kits, air-to-air missiles, and advanced avionics as part of Taiwan deterrence strategy.',
  },
  {
    id: 'AD003', exporter: 'USA', recipient: 'Israel',
    systemType: 'Mixed/Aid', valueB: 14.0, year: 2023,
    status: 'In Progress', significance: 8,
    description: 'Emergency military aid 2023-2024 following October 7 attacks: precision munitions, Iron Dome interceptors, artillery shells, naval support.',
  },
  {
    id: 'AD004', exporter: 'South Korea', recipient: 'Poland',
    systemType: 'Tanks', valueB: 15.0, year: 2022,
    status: 'In Progress', significance: 9,
    description: 'Landmark $15B deal: 1,000 K2 Black Panther tanks and 648 K9 Thunder self-propelled howitzers. Largest arms export deal in South Korean history.',
  },
  {
    id: 'AD005', exporter: 'France', recipient: 'India',
    systemType: 'Fighter Aircraft', valueB: 8.8, year: 2024,
    status: 'In Progress', significance: 8,
    description: '26 additional Rafale-M naval fighters ordered in 2024 following original 36-aircraft deal. Covers pilot training, weapons package, and technology transfer.',
  },
  {
    id: 'AD006', exporter: 'Germany', recipient: 'Ukraine',
    systemType: 'Tanks', valueB: 5.2, year: 2023,
    status: 'Delivered', significance: 8,
    description: 'Leopard 2 main battle tanks, Patriot air defense systems, and Gepard anti-aircraft systems. Marks major shift in German arms export policy.',
  },
  {
    id: 'AD007', exporter: 'USA', recipient: 'South Korea',
    systemType: 'Air Defense', valueB: 4.1, year: 2023,
    status: 'Delivered', significance: 7,
    description: 'F-35A Lightning II deliveries continuing plus THAAD terminal high-altitude area defense system expansion in response to North Korean threats.',
  },
  {
    id: 'AD008', exporter: 'USA', recipient: 'Saudi Arabia',
    systemType: 'Air Defense', valueB: 3.8, year: 2023,
    status: 'Contracted', significance: 6,
    description: 'Air defense enhancement package including Patriot missile defense battery upgrades and advanced interceptor missiles for Houthi threat mitigation.',
  },
  {
    id: 'AD009', exporter: 'China', recipient: 'Pakistan',
    systemType: 'Fighter Aircraft', valueB: 1.4, year: 2022,
    status: 'Delivered', significance: 7,
    description: '25 J-10C Vigorous Dragon multirole fighters delivered, establishing China as credible alternative to Western suppliers. Powered by Russian AL-31F engine.',
  },
  {
    id: 'AD010', exporter: 'Russia', recipient: 'Iran',
    systemType: 'Fighter Aircraft', valueB: 0.9, year: 2023,
    status: 'Contracted', significance: 6,
    description: 'Reported Su-35 Flanker-E fighter agreement amid Western sanctions. Evidence disputed; Iran already supplying Russia with Shahed drones in exchange.',
  },
  {
    id: 'AD011', exporter: 'USA', recipient: 'Australia',
    systemType: 'Submarines', valueB: 368.0, year: 2023,
    status: 'Contracted', significance: 10,
    description: 'AUKUS submarine partnership: Australia to acquire 3-5 Virginia-class SSNs by 2033, then build SSN-AUKUS class. Largest defence procurement in Australian history.',
  },
  {
    id: 'AD012', exporter: 'Israel', recipient: 'Various',
    systemType: 'Mixed/Aid', valueB: 1.2, year: 2024,
    status: 'Suspended', significance: 5,
    description: 'Israeli arms exports declining post-Gaza conflict. Multiple European nations suspended licenses. India, Azerbaijan, Philippines remain major recipients.',
  },
];

// ── Helper functions ─────────────────────────────────────────────────────────

export function getTopExporters(exporters: ArmsExporter[], n = 5): ArmsExporter[] {
  return [...exporters].sort((a, b) => b.globalSharePct - a.globalSharePct).slice(0, n);
}

export function getMajorDeals(deals: ArmsDeal[], minSignificance = 7): ArmsDeal[] {
  return deals.filter(d => d.significance >= minSignificance);
}

export function getByRecipient(deals: ArmsDeal[], recipient: string): ArmsDeal[] {
  return deals.filter(d => d.recipient.toLowerCase() === recipient.toLowerCase());
}

export function getByExporter(deals: ArmsDeal[], exporter: string): ArmsDeal[] {
  return deals.filter(d => d.exporter.toLowerCase() === exporter.toLowerCase());
}

export function computeGlobalArmsIndex(deals: ArmsDeal[]): number {
  if (!deals.length) return 0;
  const totalValue = deals.reduce((sum, d) => sum + d.valueB, 0);
  // Count unique exporters for concentration factor (more exporters = more distributed = lower concentration)
  const uniqueExporters = new Set(deals.map(d => d.exporter)).size;
  const concentrationFactor = Math.max(0.1, 1 - uniqueExporters / 20);
  return Math.min(100, Math.round((totalValue / 10) * concentrationFactor));
}

export function exporterShareClass(sharesPct: number): string {
  if (sharesPct >= 30) return 'share-dominant';
  if (sharesPct >= 10) return 'share-major';
  if (sharesPct >= 3)  return 'share-significant';
  return 'share-minor';
}

export function dealStatusClass(status: DealStatus): string {
  const map: Record<DealStatus, string> = {
    'Delivered':   'status-delivered',
    'In Progress': 'status-in-progress',
    'Contracted':  'status-contracted',
    'Suspended':   'status-suspended',
  };
  return map[status] ?? 'status-contracted';
}

export function buildRenderData(): ArmsRenderData {
  const totalValueB = DEALS.reduce((sum, d) => sum + d.valueB, 0);
  const usaExporter = EXPORTERS.find(e => e.country === 'USA');
  const usaDominanceScore = usaExporter ? Math.round(usaExporter.globalSharePct) : 0;
  return {
    exporters: EXPORTERS,
    deals: DEALS,
    globalArmsIndex: computeGlobalArmsIndex(DEALS),
    usaDominanceScore,
    totalValueB,
  };
}
