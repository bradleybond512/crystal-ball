import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

// ── Types ────────────────────────────────────────────────────────────────

export type GridStressTier = 'stable' | 'elevated' | 'stressed' | 'critical';

export interface GridStressIndex {
  score: number;
  tier: GridStressTier;
  activeOutages: number;
  pipelineDisruptions: number;
  refineryIncidents: number;
}

export interface PowerOutage {
  id: string;
  region: string;
  customersAffected: number;
  cause: 'storm' | 'equipment' | 'cyber' | 'unknown';
  restorationEta?: number;
}

export interface PipelineWatch {
  id: string;
  pipelineName: string;
  type: 'gas' | 'oil' | 'LNG';
  disruptionType: 'shutdown' | 'leak' | 'rupture' | 'pressure_anomaly';
  affectedCapacity: number;
  capacityUnit: 'Mcf' | 'bpd';
}

export interface EnergySupplyChain {
  sprLevelPct?: number;
  lngExportCapacityPct?: number;
  importDependencyFlags: { region: string; flagged: boolean; reason?: string }[];
  priceStressIndicators: { commodity: string; stressLevel: 'low' | 'medium' | 'high' }[];
}

export interface InfrastructureRiskRegion {
  region: string;
  riskLevel: 0 | 1 | 2 | 3 | 4;
  topRiskDriver: string;
}

export interface EnergySuperpowerData {
  gridStress: GridStressIndex;
  outages: PowerOutage[];
  pipelines: PipelineWatch[];
  supplyChain: EnergySupplyChain;
  infraRisk: InfrastructureRiskRegion[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const GRID_STRESS_TIER_COLOR: Record<GridStressTier, string> = {
  stable:   'var(--severity-low,    #4caf50)',
  elevated: 'var(--severity-medium, #facc15)',
  stressed: 'var(--severity-high,   #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const INFRA_RISK_COLOR: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'var(--severity-none,     #9e9e9e)',
  1: 'var(--severity-low,      #4caf50)',
  2: 'var(--severity-medium,   #facc15)',
  3: 'var(--severity-high,     #fb923c)',
  4: 'var(--severity-critical, #ef4444)',
};

const CAUSE_LABEL: Record<PowerOutage['cause'], string> = {
  storm: 'Storm', equipment: 'Equipment', cyber: 'Cyber', unknown: 'Unknown',
};

const DISRUPTION_LABEL: Record<PipelineWatch['disruptionType'], string> = {
  shutdown: 'Shutdown', leak: 'Leak', rupture: 'Rupture', pressure_anomaly: 'Pressure Anomaly',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function gridTier(score: number): GridStressTier {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'stressed';
  if (score >= 25) return 'elevated';
  return 'stable';
}

// ── Panel ─────────────────────────────────────────────────────────────────

export class EnergySuperpowerPanel extends Panel {
  constructor() {
    super({ id: 'energy-superpower', title: 'Energy Intelligence', showCount: true, trackActivity: true });
  }

  refresh(data?: Partial<EnergySuperpowerData>): void {
    const gridStress = safe(() => data?.gridStress) ?? {
      score: 0, tier: 'stable' as GridStressTier,
      activeOutages: 0, pipelineDisruptions: 0, refineryIncidents: 0,
    };
    const outages     = safe(() => data?.outages ?? []) ?? [];
    const pipelines   = safe(() => data?.pipelines ?? []) ?? [];
    const supplyChain = safe(() => data?.supplyChain) ?? {
      importDependencyFlags: [], priceStressIndicators: [],
    };
    const infraRisk   = safe(() => data?.infraRisk ?? []) ?? [];

    const html = this.buildHtml({ gridStress, outages, pipelines, supplyChain, infraRisk });
    this.setContent(html);
    this.setCount(outages.length + pipelines.filter(p => p.disruptionType === 'rupture' || p.disruptionType === 'shutdown').length);
    this.markFresh();
  }

  buildHtml(data: EnergySuperpowerData): string {
    return `<div class="energy-superpower">
      ${this.buildGridStressSection(data.gridStress)}
      ${this.buildOutageSection(data.outages)}
      ${this.buildPipelineSection(data.pipelines)}
      ${this.buildSupplyChainSection(data.supplyChain)}
      ${this.buildInfraRiskSection(data.infraRisk)}
    </div>`;
  }

  private buildGridStressSection(gs: GridStressIndex): string {
    const tier = gs.tier ?? gridTier(gs.score);
    return `<section class="esp-section">
      <h3>Grid Stress Index</h3>
      <div class="esp-gauge">
        <span class="esp-score">${gs.score}/100</span>
        <span class="esp-tier" style="color:${GRID_STRESS_TIER_COLOR[tier]}">${escapeHtml(tier.toUpperCase())}</span>
      </div>
      <div class="esp-grid-factors">
        <span>Outages: ${gs.activeOutages}</span>
        <span>Pipeline: ${gs.pipelineDisruptions}</span>
        <span>Refinery: ${gs.refineryIncidents}</span>
      </div>
    </section>`;
  }

  private buildOutageSection(outages: PowerOutage[]): string {
    const items = outages.length === 0
      ? '<div class="esp-empty">No active outages</div>'
      : outages.map(o => `
        <div class="esp-outage-item">
          <span class="esp-region">${escapeHtml(o.region)}</span>
          <span class="esp-customers">${o.customersAffected.toLocaleString()} customers</span>
          <span class="esp-cause">${escapeHtml(CAUSE_LABEL[o.cause])}</span>
          <span class="esp-eta">${o.restorationEta == null ? 'Ongoing' : new Date(o.restorationEta).toLocaleString()}</span>
        </div>`).join('');
    return `<section class="esp-section"><h3>Power Outages</h3>${items}</section>`;
  }

  private buildPipelineSection(pipelines: PipelineWatch[]): string {
    const items = pipelines.length === 0
      ? '<div class="esp-empty">No active disruptions</div>'
      : pipelines.map(p => `
        <div class="esp-pipeline-item">
          <span class="esp-name">${escapeHtml(p.pipelineName)}</span>
          <span class="esp-type">${escapeHtml(p.type)}</span>
          <span class="esp-disruption">${escapeHtml(DISRUPTION_LABEL[p.disruptionType])}</span>
          <span class="esp-capacity">${p.affectedCapacity.toLocaleString()} ${escapeHtml(p.capacityUnit)}</span>
        </div>`).join('');
    return `<section class="esp-section"><h3>Pipeline Watch</h3>${items}</section>`;
  }

  private buildSupplyChainSection(sc: EnergySupplyChain): string {
    const sprLine = sc.sprLevelPct == null
      ? '' : `<div class="esp-supply-row">Strategic Petroleum Reserve: ${sc.sprLevelPct}%</div>`;
    const lngLine = sc.lngExportCapacityPct == null
      ? '' : `<div class="esp-supply-row">LNG Export Capacity: ${sc.lngExportCapacityPct}%</div>`;
    const flagged = sc.importDependencyFlags.filter(f => f.flagged);
    const flagLines = flagged.length === 0
      ? '<div class="esp-empty">No import flags</div>'
      : flagged.map(f => `<div class="esp-flag-row">${escapeHtml(f.region)}${f.reason ? ': ' + escapeHtml(f.reason) : ''}</div>`).join('');
    const priceLines = sc.priceStressIndicators.map(pi =>
      `<div class="esp-price-row">${escapeHtml(pi.commodity)}: ${escapeHtml(pi.stressLevel)}</div>`).join('');
    return `<section class="esp-section">
      <h3>Supply Chain</h3>
      ${sprLine}${lngLine}
      <div class="esp-import-flags">${flagLines}</div>
      <div class="esp-price-stress">${priceLines}</div>
    </section>`;
  }

  private buildInfraRiskSection(regions: InfrastructureRiskRegion[]): string {
    const items = regions.length === 0
      ? '<div class="esp-empty">No infrastructure risk data</div>'
      : regions.map(r => `
        <div class="esp-infra-item">
          <span class="esp-region">${escapeHtml(r.region)}</span>
          <span class="esp-risk-level" style="color:${INFRA_RISK_COLOR[r.riskLevel]}">${r.riskLevel}</span>
          <span class="esp-driver">${escapeHtml(r.topRiskDriver)}</span>
        </div>`).join('');
    return `<section class="esp-section"><h3>Infrastructure Risk</h3>${items}</section>`;
  }
}
