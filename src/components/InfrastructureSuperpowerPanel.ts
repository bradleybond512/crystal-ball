/**
 * Infrastructure Intelligence — five sections (Grid & Power, Water,
 * Telecom, Transport, Critical Infrastructure Risk Index).
 *
 * Pure compute + section renderers live in `infrastructure-superpower-render`
 * so they're testable without importing the Panel base (which transitively
 * pulls in Vite-only `?worker` syntax that node test runners can't parse).
 */

import { Panel } from './Panel';
import {
  InfrastructureSuperpowerEngine,
  compositeRisk,
  renderPowerSection,
  renderRiskIndex,
  renderTelecomSection,
  renderTransportSection,
  renderWaterSection,
  type InfrastructureState,
} from './infrastructure-superpower-render';

// Re-export the pure surface so other call sites can import from the
// panel module path if they prefer.
export {
  InfrastructureSuperpowerEngine,
  SECTOR_WEIGHTS,
  TIER_COLOR,
  CRITICAL_OUTAGE_CUSTOMERS,
  MAJOR_HIGHWAY_CLOSURE_MS,
  compositeRisk,
  formatCustomers,
  formatEta,
  powerSectorScore,
  renderPowerSection,
  renderRiskIndex,
  renderTelecomSection,
  renderTransportSection,
  renderWaterSection,
  telecomSectorScore,
  tierFromScore,
  transportSectorScore,
  waterSectorScore,
  type BgpAnomaly,
  type CableEvent,
  type CdnPerformance,
  type CloudOutage,
  type InfrastructureState,
  type PowerOutage,
  type PowerSectorState,
  type RiskIndex,
  type Sector,
  type SectorRisk,
  type SectorTier,
  type TelecomSectorState,
  type TransportIncident,
  type TransportMode,
  type TransportSectorState,
  type WaterAdvisory,
  type WaterAdvisoryLevel,
  type WaterSectorState,
} from './infrastructure-superpower-render';

const REFRESH_MS = 5 * 60_000;

export class InfrastructureSuperpowerPanel extends Panel {
  private state: InfrastructureState = InfrastructureSuperpowerEngine.defaultState();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'infrastructure-superpower',
      title: 'Infrastructure Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep infrastructure intelligence: power grid status, water advisories, telecom anomalies, transportation disruptions, and a composite Critical Infrastructure Risk Index (energy 35 / water 25 / comms 20 / transport 20). 5-minute refresh.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  /** Public seam for tests + external feeds. */
  public setData(next: Partial<InfrastructureState>): void {
    const merged: InfrastructureState = {
      power: next.power ?? this.state.power,
      water: next.water ?? this.state.water,
      telecom: next.telecom ?? this.state.telecom,
      transport: next.transport ?? this.state.transport,
      risk: { composite: 0, tier: 'operational', sectors: [] },
      generatedAt: Date.now(),
    };
    merged.risk = compositeRisk(merged);
    this.state = merged;
    this.setCount(merged.risk.sectors.filter((s) => s.tier === 'critical' || s.tier === 'stressed').length);
    this.render();
  }

  private render(): void {
    const s = this.state;
    const stamp = s.generatedAt > 0
      ? `<div style="opacity:0.55;font-size:10px;margin-top:12px">Generated ${timeAgo(s.generatedAt)}</div>`
      : '';
    this.setContent(
      renderPowerSection(s.power)
      + renderWaterSection(s.water)
      + renderTelecomSection(s.telecom)
      + renderTransportSection(s.transport)
      + renderRiskIndex(s.risk)
      + stamp,
    );
  }
}

function timeAgo(epoch: number): string {
  const s = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
