// semiconductor-geopolitics-helpers.ts — pure deterministic helpers (no DOM, no fetch)

export interface ChipPower {
  id: string;
  country: string;
  role: 'manufacturer' | 'designer' | 'equipment-maker' | 'materials-supplier';
  marketSharePct: number; // in their segment
  keyCompanies: string[];
  strategicAssets: string[];
  vulnerabilities: string[];
  exportControlStatus: 'restricted' | 'controlled' | 'open';
  trend: 'gaining' | 'stable' | 'losing';
  notes: string;
}

export interface ExportControl {
  id: string;
  enforcedBy: string;
  targetCountry: string;
  controlledItems: string[];
  keyRestrictions: string;
  implementedYear: number;
  impactLevel: 'severe' | 'significant' | 'moderate';
  notes: string;
}

export interface ChokepointNode {
  id: string;
  name: string;
  type: 'fab' | 'equipment' | 'materials' | 'design-tool' | 'packaging';
  controlledBy: string;
  marketDominance: number; // 0-100 % of global market
  substituteAvailability: 'none' | 'limited' | 'developing' | 'available';
  strategicRisk: 'critical' | 'high' | 'medium';
  notes: string;
}

export interface SemiconductorData {
  chipPowers: ChipPower[];
  exportControls: ExportControl[];
  chokepoints: ChokepointNode[];
  lastUpdated: string;
  globalSupplyChainRiskIndex: number; // 0-100
}

export const CHIP_POWERS: ChipPower[] = [
  {
    id: 'taiwan',
    country: 'Taiwan',
    role: 'manufacturer',
    marketSharePct: 92,
    keyCompanies: ['TSMC', 'UMC', 'ASE Group'],
    strategicAssets: ['TSMC <3nm leading edge', 'Packaging expertise', 'CoWoS advanced packaging'],
    vulnerabilities: ['PRC invasion risk', 'Earthquake zone', 'Single-point dependency for advanced nodes'],
    exportControlStatus: 'controlled',
    trend: 'stable',
    notes: 'TSMC N2/A16 process nodes define global AI chip capacity; 92% of sub-3nm wafers',
  },
  {
    id: 'usa',
    country: 'United States',
    role: 'designer',
    marketSharePct: 65,
    keyCompanies: ['Nvidia', 'AMD', 'Intel', 'Qualcomm', 'Apple', 'Broadcom'],
    strategicAssets: ['EDA tools monopoly (Synopsys/Cadence)', 'IP portfolios', 'DARPA chip programs', 'Intel Foundry Services'],
    vulnerabilities: ['Manufacturing outsourced to TSMC/Samsung', 'CHIPS Act scale uncertain', 'China revenue exposure'],
    exportControlStatus: 'restricted',
    trend: 'gaining',
    notes: 'Controls chip design software (EDA) and key IP; CHIPS Act investing $52B in domestic fabs',
  },
  {
    id: 'netherlands',
    country: 'Netherlands',
    role: 'equipment-maker',
    marketSharePct: 100,
    keyCompanies: ['ASML'],
    strategicAssets: ['EUV lithography monopoly (all EUV machines globally)', 'DUV installed base', 'Holistic lithography software'],
    vulnerabilities: ['Single company dependency', 'Export pressure from US', 'China installed base creates leverage'],
    exportControlStatus: 'restricted',
    trend: 'stable',
    notes: 'ASML sole supplier of EUV machines required for sub-7nm chips; no viable alternative exists',
  },
  {
    id: 'south-korea',
    country: 'South Korea',
    role: 'manufacturer',
    marketSharePct: 17,
    keyCompanies: ['Samsung Foundry', 'SK Hynix', 'Samsung LSI'],
    strategicAssets: ['DRAM/NAND near-monopoly (HBM)', '3nm GAA process', 'HBM3e for AI accelerators'],
    vulnerabilities: ['North Korea threat', 'Samsung foundry yield issues', 'TSMC competition'],
    exportControlStatus: 'controlled',
    trend: 'stable',
    notes: 'Samsung + SK Hynix control ~70% of global DRAM and ~50% of NAND; critical for AI memory (HBM)',
  },
  {
    id: 'japan',
    country: 'Japan',
    role: 'materials-supplier',
    marketSharePct: 60,
    keyCompanies: ['Shin-Etsu Chemical', 'SUMCO', 'JSR', 'Tokyo Electron', 'Lasertec'],
    strategicAssets: ['Silicon wafer dominance (Shin-Etsu/SUMCO 60%)', 'Photoresist chemicals (JSR/TOK)', 'Inspection equipment (Lasertec EUV mask)'],
    vulnerabilities: ['Aging demographics in sector', 'China pressure', 'Earthquake risk'],
    exportControlStatus: 'controlled',
    trend: 'stable',
    notes: 'Controls critical materials and some equipment; photoresist and silicon wafer chokepoints',
  },
  {
    id: 'china',
    country: 'China',
    role: 'manufacturer',
    marketSharePct: 7,
    keyCompanies: ['SMIC', 'Hua Hong', 'YMTC', 'CXMT'],
    strategicAssets: ['Mature node capacity (28nm+)', 'YMTC 3D NAND progress', 'Large domestic market'],
    vulnerabilities: ['Blocked from EUV by export controls', 'SMIC limited to ~7nm DUV', 'No domestic EDA capability', 'Memory quality gap'],
    exportControlStatus: 'restricted',
    trend: 'gaining',
    notes: 'Massive investment to indigenize; SMIC achieved 7nm with DUV multilayer tricks; still 2-3 nodes behind',
  },
  {
    id: 'germany',
    country: 'Germany',
    role: 'equipment-maker',
    marketSharePct: 15,
    keyCompanies: ['Zeiss', 'Infineon', 'Bosch Semiconductor'],
    strategicAssets: ['Zeiss optics for ASML EUV (sole supplier of EUV lenses)', 'Infineon power chips', 'Auto semiconductor'],
    vulnerabilities: ['ASML dependency for Zeiss revenue', 'Energy costs', 'China market exposure'],
    exportControlStatus: 'controlled',
    trend: 'stable',
    notes: 'Carl Zeiss SMT sole supplier of optical systems inside every ASML EUV machine — nested chokepoint',
  },
  {
    id: 'india',
    country: 'India',
    role: 'designer',
    marketSharePct: 20,
    keyCompanies: ['Tata Electronics', 'Micron India', 'Foxconn SHM'],
    strategicAssets: ['Engineering talent pool', 'Micron DRAM assembly', 'Tata fab investment', 'Government PLI scheme'],
    vulnerabilities: ['No advanced fab capacity yet', 'Infrastructure gaps', 'Power reliability'],
    exportControlStatus: 'open',
    trend: 'gaining',
    notes: 'Emerging packaging/testing hub; Tata partnership with PSMC for 28nm fab; targeted for supply chain diversification',
  },
];

export const EXPORT_CONTROLS: ExportControl[] = [
  {
    id: 'us-oct2022',
    enforcedBy: 'United States (BIS)',
    targetCountry: 'China',
    controlledItems: ['Advanced AI chips (A100/H100 class)', 'EUV lithography machines', 'Advanced fab equipment', 'US persons at Chinese fabs'],
    keyRestrictions: 'Cut China off from sub-14nm chip manufacturing equipment and AI accelerators above 4800 TOPS',
    implementedYear: 2022,
    impactLevel: 'severe',
    notes: 'Oct 7, 2022 rules — watershed moment in chip war; extended Jan 2023 to allies',
  },
  {
    id: 'netherlands-2023',
    enforcedBy: 'Netherlands (Ministry of Economic Affairs)',
    targetCountry: 'China',
    controlledItems: ['ASML DUV immersion scanners (NXT series)', 'Advanced semiconductor manufacturing equipment'],
    keyRestrictions: 'Blocked ASML from shipping DUV immersion tools to China from Sept 2023',
    implementedYear: 2023,
    impactLevel: 'significant',
    notes: 'Coordinated with US; ASML lost ~15% revenue exposure to China',
  },
  {
    id: 'japan-2023',
    enforcedBy: 'Japan (METI)',
    targetCountry: 'China',
    controlledItems: ['23 categories of chip manufacturing equipment', 'Photolithography systems', 'Etching/deposition tools'],
    keyRestrictions: 'Export license required for advanced process equipment above 14nm to China',
    implementedYear: 2023,
    impactLevel: 'significant',
    notes: 'Tokyo Electron, Nikon, Shin-Etsu affected; coordinated with US/Netherlands trilateral',
  },
  {
    id: 'us-oct2023',
    enforcedBy: 'United States (BIS)',
    targetCountry: 'China',
    controlledItems: ['Updated AI chip thresholds (A800/H800 loophole closed)', 'Chip to >36 countries without individual licenses'],
    keyRestrictions: 'Closed loopholes in Oct 2022 rules; added 13 new country groups for license requirements',
    implementedYear: 2023,
    impactLevel: 'severe',
    notes: 'Nvidia lost China data center revenue; Huawei Ascend chips as partial substitute',
  },
  {
    id: 'us-2024-controls',
    enforcedBy: 'United States (BIS)',
    targetCountry: 'China',
    controlledItems: ['Gate-all-around transistor tech', 'Advanced packaging (CoWoS/HBM)', 'Memory above LPDDR5'],
    keyRestrictions: 'Extended controls to packaging technology and next-gen memory standards',
    implementedYear: 2024,
    impactLevel: 'significant',
    notes: 'Targeted TSMC CoWoS packaging used in Nvidia H100; aimed at AI cluster build-outs',
  },
  {
    id: 'dutch-chipequip-2024',
    enforcedBy: 'Netherlands (ASML)',
    targetCountry: 'China',
    controlledItems: ['Installed DUV service contracts', 'Remote monitoring for existing machines'],
    keyRestrictions: 'Service restrictions on previously shipped DUV tools inside China',
    implementedYear: 2024,
    impactLevel: 'moderate',
    notes: 'Constrains SMIC ability to maintain/upgrade existing DUV equipment for 7nm process',
  },
];

export const CHOKEPOINT_NODES: ChokepointNode[] = [
  {
    id: 'euv-machine',
    name: 'EUV Lithography Machine',
    type: 'equipment',
    controlledBy: 'ASML (Netherlands)',
    marketDominance: 100,
    substituteAvailability: 'none',
    strategicRisk: 'critical',
    notes: 'Zero substitutes. Required for sub-7nm nodes. 100% ASML. Each machine ~$200M, 18-month lead time',
  },
  {
    id: 'euv-lenses',
    name: 'EUV Optics (Zeiss)',
    type: 'equipment',
    controlledBy: 'Carl Zeiss SMT (Germany)',
    marketDominance: 100,
    substituteAvailability: 'none',
    strategicRisk: 'critical',
    notes: 'Zeiss sole supplier of optical systems inside all ASML EUV machines — nested monopoly',
  },
  {
    id: 'tsmc-advanced-nodes',
    name: 'TSMC Advanced Fab (<5nm)',
    type: 'fab',
    controlledBy: 'TSMC (Taiwan)',
    marketDominance: 92,
    substituteAvailability: 'limited',
    strategicRisk: 'critical',
    notes: 'Samsung at 3nm but lower yield/volume. Intel IFS lagging. 92% of AI/leading-edge chips',
  },
  {
    id: 'hbm-memory',
    name: 'High Bandwidth Memory (HBM)',
    type: 'fab',
    controlledBy: 'SK Hynix + Samsung (South Korea)',
    marketDominance: 96,
    substituteAvailability: 'developing',
    strategicRisk: 'critical',
    notes: 'SK Hynix ~53%, Samsung ~43% of HBM market. Required for Nvidia H100/B100 AI GPUs',
  },
  {
    id: 'eda-tools',
    name: 'EDA Design Software',
    type: 'design-tool',
    controlledBy: 'Synopsys + Cadence (USA)',
    marketDominance: 70,
    substituteAvailability: 'none',
    strategicRisk: 'critical',
    notes: 'No chip can be designed without EDA tools. Synopsys/Cadence 70%+. Export controls block China',
  },
  {
    id: 'silicon-wafers',
    name: 'Semiconductor Silicon Wafers',
    type: 'materials',
    controlledBy: 'Shin-Etsu + SUMCO (Japan)',
    marketDominance: 58,
    substituteAvailability: 'limited',
    strategicRisk: 'high',
    notes: 'Shin-Etsu + SUMCO ~58% of 300mm wafers. SK Siltron + GlobalWafers developing. Tight supply',
  },
  {
    id: 'photoresist',
    name: 'EUV Photoresist Chemicals',
    type: 'materials',
    controlledBy: 'JSR + Tokyo Ohka (Japan)',
    marketDominance: 90,
    substituteAvailability: 'developing',
    strategicRisk: 'high',
    notes: 'JSR taken private by Japanese government in 2023 for strategic control. EUV resist a critical input',
  },
  {
    id: 'advanced-packaging',
    name: 'Advanced Packaging (CoWoS/SoIC)',
    type: 'packaging',
    controlledBy: 'TSMC (Taiwan)',
    marketDominance: 85,
    substituteAvailability: 'developing',
    strategicRisk: 'high',
    notes: 'CoWoS packaging critical for HBM+GPU integration (Nvidia H100 uses TSMC CoWoS exclusively)',
  },
];

export function getByRole(powers: ChipPower[], role: ChipPower['role']): ChipPower[] {
  return powers.filter((p) => p.role === role);
}

export function getChokepoints(nodes: ChokepointNode[], risk: ChokepointNode['strategicRisk']): ChokepointNode[] {
  return nodes.filter((n) => n.strategicRisk === risk);
}

export function getCriticalChokepoints(nodes: ChokepointNode[]): ChokepointNode[] {
  return nodes.filter((n) => n.strategicRisk === 'critical');
}

export function getControlsByImpact(controls: ExportControl[], impact: ExportControl['impactLevel']): ExportControl[] {
  return controls.filter((c) => c.impactLevel === impact);
}

const RISK_ORDER: Record<ChokepointNode['strategicRisk'], number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

const IMPACT_ORDER: Record<ExportControl['impactLevel'], number> = {
  severe: 3,
  significant: 2,
  moderate: 1,
};

export function sortChokepointsByRisk(nodes: ChokepointNode[]): ChokepointNode[] {
  return [...nodes].sort((a, b) => RISK_ORDER[b.strategicRisk] - RISK_ORDER[a.strategicRisk]);
}

export function sortControlsByImpact(controls: ExportControl[]): ExportControl[] {
  return [...controls].sort((a, b) => IMPACT_ORDER[b.impactLevel] - IMPACT_ORDER[a.impactLevel]);
}

// Weighted score 0-100 based on critical chokepoints with no/limited substitutes.
export function computeGlobalSupplyChainRiskIndex(data: {
  chokepoints: ChokepointNode[];
}): number {
  const { chokepoints } = data;
  if (chokepoints.length === 0) return 0;
  let weighted = 0;
  for (const node of chokepoints) {
    const riskWeight = RISK_ORDER[node.strategicRisk]; // 1-3
    let substituteFactor: number;
    switch (node.substituteAvailability) {
      case 'none':
        substituteFactor = 1;
        break;
      case 'limited':
        substituteFactor = 0.7;
        break;
      case 'developing':
        substituteFactor = 0.45;
        break;
      default:
        substituteFactor = 0.2;
        break;
    }
    const dominanceFactor = node.marketDominance / 100; // 0-1
    weighted += riskWeight * substituteFactor * dominanceFactor;
  }
  const maxPossible = chokepoints.length * 3; // every node critical + no substitute + 100% dominance
  return Math.round((weighted / maxPossible) * 100);
}

export function trendClass(trend: ChipPower['trend']): string {
  switch (trend) {
    case 'gaining':
      return 'trend-gaining';
    case 'losing':
      return 'trend-losing';
    default:
      return 'trend-stable';
  }
}

export function riskClass(risk: ChokepointNode['strategicRisk']): string {
  switch (risk) {
    case 'critical':
      return 'risk-critical';
    case 'high':
      return 'risk-high';
    default:
      return 'risk-medium';
  }
}

export function buildRenderData(): SemiconductorData {
  return {
    chipPowers: CHIP_POWERS,
    exportControls: EXPORT_CONTROLS,
    chokepoints: CHOKEPOINT_NODES,
    lastUpdated: '2026-06-10',
    globalSupplyChainRiskIndex: computeGlobalSupplyChainRiskIndex({ chokepoints: CHOKEPOINT_NODES }),
  };
}
