/**
 * Pure helpers for TradeDisruptionPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type SanctionsSeverity = 'targeted' | 'sectoral' | 'comprehensive';
export type TariffStage = 'threat' | 'imposed' | 'escalating' | 'retaliatory';
export type ExportCategory = 'semiconductors' | 'agriculture' | 'energy' | 'military' | 'dual-use';
export type DisputeStatus = 'monitoring' | 'active' | 'critical' | 'resolved';
export type FlowRisk = 0 | 1 | 2 | 3 | 4;

export interface SanctionsRegime {
  target: string;
  imposingParties: string;
  severity: SanctionsSeverity;
  annualTradeImpactBn: number;
  sectors: string;
}

export interface TariffEscalation {
  countries: string;
  tariffRate: number;
  stage: TariffStage;
  tradeVolumeBn: number;
  primarySectors: string;
}

export interface ExportBan {
  country: string;
  commodity: string;
  category: ExportCategory;
  affectedImporters: string;
  volumeMt: number;
}

export interface TradeFlashpoint {
  parties: string;
  dispute: string;
  status: DisputeStatus;
  tradeAtRiskBn: number;
}

export interface FlowRegion {
  region: string;
  risk: FlowRisk;
}

// ── Sanctions helpers ─────────────────────────────────────────────────────

export function sanctionsSeverityColor(s: SanctionsSeverity): string {
  const colors: Record<SanctionsSeverity, string> = {
    targeted:      'var(--severity-medium,   #facc15)',
    sectoral:      'var(--severity-high,     #fb923c)',
    comprehensive: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function sanctionsSeverityLabel(s: SanctionsSeverity): string {
  const labels: Record<SanctionsSeverity, string> = {
    targeted:      'Targeted',
    sectoral:      'Sectoral',
    comprehensive: 'Comprehensive',
  };
  return labels[s];
}

// ── Tariff helpers ────────────────────────────────────────────────────────

export function tariffStageColor(t: TariffStage): string {
  const colors: Record<TariffStage, string> = {
    threat:      'var(--severity-low,      #4caf50)',
    imposed:     'var(--severity-medium,   #facc15)',
    escalating:  'var(--severity-high,     #fb923c)',
    retaliatory: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function tariffStageLabel(t: TariffStage): string {
  const labels: Record<TariffStage, string> = {
    threat:      'Threat',
    imposed:     'Imposed',
    escalating:  'Escalating',
    retaliatory: 'Retaliatory',
  };
  return labels[t];
}

export function formatTariffRate(rate: number): string {
  return `${rate}%`;
}

// ── Export ban helpers ────────────────────────────────────────────────────

export function exportCategoryColor(c: ExportCategory): string {
  const colors: Record<ExportCategory, string> = {
    semiconductors: 'var(--severity-critical, #ef4444)',
    military:       'var(--severity-critical, #ef4444)',
    energy:         'var(--severity-high,     #fb923c)',
    'dual-use':     'var(--severity-high,     #fb923c)',
    agriculture:    'var(--severity-medium,   #facc15)',
  };
  return colors[c];
}

export function exportCategoryLabel(c: ExportCategory): string {
  const labels: Record<ExportCategory, string> = {
    semiconductors: 'Semiconductors',
    agriculture:    'Agriculture',
    energy:         'Energy',
    military:       'Military',
    'dual-use':     'Dual-Use',
  };
  return labels[c];
}

export function formatVolumeMt(mt: number): string {
  if (mt >= 1000) return `${(mt / 1000).toFixed(1)}B t`;
  if (mt >= 1)     return `${mt.toFixed(1)}M t`;
  return `${(mt * 1000).toFixed(0)}K t`;
}

// ── Flashpoint helpers ────────────────────────────────────────────────────

export function disputeStatusColor(s: DisputeStatus): string {
  const colors: Record<DisputeStatus, string> = {
    monitoring: 'var(--severity-low,      #4caf50)',
    active:     'var(--severity-medium,   #facc15)',
    critical:   'var(--severity-critical, #ef4444)',
    resolved:   'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function disputeStatusLabel(s: DisputeStatus): string {
  const labels: Record<DisputeStatus, string> = {
    monitoring: 'Monitoring',
    active:     'Active',
    critical:   'Critical',
    resolved:   'Resolved',
  };
  return labels[s];
}

// ── Flow risk helpers ─────────────────────────────────────────────────────

export function flowRiskColor(r: FlowRisk): string {
  const colors: Record<FlowRisk, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function flowRiskLabel(r: FlowRisk): string {
  const labels: Record<FlowRisk, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Severe',
  };
  return labels[r];
}

// ── Trade volume formatting ────────────────────────────────────────────────

export function formatTradeBn(bn: number): string {
  if (bn >= 1000) return `$${(bn / 1000).toFixed(1)}T`;
  if (bn >= 100)   return `$${Math.round(bn)}B`;
  return `$${bn.toFixed(1)}B`;
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countComprehensiveSanctions(regimes: SanctionsRegime[]): number {
  return regimes.filter((r) => r.severity === 'comprehensive').length;
}

export function countCriticalDisputes(flashpoints: TradeFlashpoint[]): number {
  return flashpoints.filter((f) => f.status === 'critical').length;
}

export function countEscalatingTariffs(tariffs: TariffEscalation[]): number {
  return tariffs.filter((t) => t.stage === 'escalating' || t.stage === 'retaliatory').length;
}

export function totalTradeAtRiskBn(flashpoints: TradeFlashpoint[]): number {
  return flashpoints.reduce((sum, f) => sum + f.tradeAtRiskBn, 0);
}

// ── Static data ───────────────────────────────────────────────────────────

export const SANCTIONS_REGIMES: SanctionsRegime[] = [
  {
    target:           'Russia',
    imposingParties:  'US / EU / UK / G7',
    severity:         'comprehensive',
    annualTradeImpactBn: 850,
    sectors:          'Energy, finance, defense, tech',
  },
  {
    target:           'Iran',
    imposingParties:  'US / EU / UN',
    severity:         'comprehensive',
    annualTradeImpactBn: 200,
    sectors:          'Oil, banking, shipping',
  },
  {
    target:           'North Korea',
    imposingParties:  'US / UN',
    severity:         'comprehensive',
    annualTradeImpactBn: 28,
    sectors:          'Coal, seafood, textiles, arms',
  },
  {
    target:           'China (entity list)',
    imposingParties:  'US',
    severity:         'sectoral',
    annualTradeImpactBn: 320,
    sectors:          'Semiconductors, AI hardware, telecom',
  },
  {
    target:           'Belarus',
    imposingParties:  'US / EU / UK',
    severity:         'sectoral',
    annualTradeImpactBn: 42,
    sectors:          'Potash, oil products, finance',
  },
  {
    target:           'Venezuela',
    imposingParties:  'US',
    severity:         'sectoral',
    annualTradeImpactBn: 30,
    sectors:          'Oil, gold, banking',
  },
];

export const TARIFF_ESCALATIONS: TariffEscalation[] = [
  {
    countries:       'US ↔ China',
    tariffRate:      145,
    stage:           'retaliatory',
    tradeVolumeBn:   575,
    primarySectors:  'Electronics, machinery, consumer goods',
  },
  {
    countries:       'US ↔ EU',
    tariffRate:      25,
    stage:           'escalating',
    tradeVolumeBn:   280,
    primarySectors:  'Steel, aluminum, autos',
  },
  {
    countries:       'China ↔ Australia',
    tariffRate:      80,
    stage:           'imposed',
    tradeVolumeBn:   18,
    primarySectors:  'Barley, wine, coal',
  },
  {
    countries:       'India ↔ Pakistan',
    tariffRate:      200,
    stage:           'imposed',
    tradeVolumeBn:   2,
    primarySectors:  'Agricultural, textiles',
  },
  {
    countries:       'US → Canada / Mexico',
    tariffRate:      25,
    stage:           'escalating',
    tradeVolumeBn:   840,
    primarySectors:  'Steel, aluminum, autos, energy',
  },
];

export const EXPORT_BANS: ExportBan[] = [
  {
    country:          'China',
    commodity:        'Gallium / Germanium',
    category:         'semiconductors',
    affectedImporters: 'US, EU, Japan, South Korea',
    volumeMt:         0.8,
  },
  {
    country:          'India',
    commodity:        'Non-basmati rice',
    category:         'agriculture',
    affectedImporters: 'Southeast Asia, Africa',
    volumeMt:         10,
  },
  {
    country:          'Russia',
    commodity:        'Fertilizers (urea)',
    category:         'agriculture',
    affectedImporters: 'Global (via MENA distributors)',
    volumeMt:         18.5,
  },
  {
    country:          'US',
    commodity:        'Advanced AI chips (A100/H100)',
    category:         'semiconductors',
    affectedImporters: 'China, Russia, Iran, North Korea',
    volumeMt:         0.01,
  },
  {
    country:          'Indonesia',
    commodity:        'Nickel ore',
    category:         'dual-use',
    affectedImporters: 'China, EU, South Korea',
    volumeMt:         850,
  },
];

export const TRADE_FLASHPOINTS: TradeFlashpoint[] = [
  {
    parties:        'US / China',
    dispute:        'Technology decoupling — semiconductors, EVs, AI',
    status:         'critical',
    tradeAtRiskBn:  575,
  },
  {
    parties:        'EU / China',
    dispute:        'EV anti-subsidy tariffs + forced technology transfer',
    status:         'critical',
    tradeAtRiskBn:  110,
  },
  {
    parties:        'US / Canada / Mexico',
    dispute:        'Steel / aluminum tariffs + USMCA review',
    status:         'active',
    tradeAtRiskBn:  840,
  },
  {
    parties:        'China / Australia',
    dispute:        'Diplomatic-linked trade restrictions',
    status:         'active',
    tradeAtRiskBn:  18,
  },
  {
    parties:        'India / China',
    dispute:        'Border tensions → import restrictions on Chinese apps / goods',
    status:         'monitoring',
    tradeAtRiskBn:  95,
  },
];

export const FLOW_INDEX: FlowRegion[] = [
  { region: 'East Asia / Pacific',  risk: 4 },
  { region: 'Russia / CIS',         risk: 4 },
  { region: 'Middle East',          risk: 3 },
  { region: 'North America',        risk: 3 },
  { region: 'South Asia',           risk: 2 },
  { region: 'Europe',               risk: 2 },
  { region: 'Sub-Saharan Africa',   risk: 1 },
];
