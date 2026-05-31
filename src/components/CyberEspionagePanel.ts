import { Panel } from './Panel';
import {
  APT_GROUPS,
  ACTIVE_CAMPAIGNS,
  SECTOR_RISKS,
  buildCyberEspionageRenderData,
  renderSummaryBar,
  renderAptGroupsSection,
  renderActiveCampaignsSection,
  renderSectorRiskSection,
} from './cyber-espionage-helpers';
import type { AptGroup, ActiveCampaign, SectorRisk } from './cyber-espionage-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

export interface CyberEspionageInputs {
  aptGroups?: AptGroup[];
  campaigns?: ActiveCampaign[];
  sectorRisks?: SectorRisk[];
}

export class CyberEspionagePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Required<CyberEspionageInputs> = {
    aptGroups: APT_GROUPS,
    campaigns: ACTIVE_CAMPAIGNS,
    sectorRisks: SECTOR_RISKS,
  };

  constructor() {
    super({
      id: 'cyber-espionage',
      title: 'Cyber Espionage Tracker',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  setInputs(partial: CyberEspionageInputs): void {
    this.inputs = {
      aptGroups:   partial.aptGroups   ?? this.inputs.aptGroups,
      campaigns:   partial.campaigns   ?? this.inputs.campaigns,
      sectorRisks: partial.sectorRisks ?? this.inputs.sectorRisks,
    };
    this.render();
  }

  private activeCampaignCount(): number {
    return this.inputs.campaigns.filter(c => c.status === 'active').length;
  }

  private render(): void {
    try {
      const data = buildCyberEspionageRenderData(
        this.inputs.aptGroups,
        this.inputs.campaigns,
        this.inputs.sectorRisks,
      );

      this.setCount(this.activeCampaignCount());

      const html =
        renderSummaryBar(data) +
        renderActiveCampaignsSection(this.inputs.campaigns) +
        renderSectorRiskSection(this.inputs.sectorRisks) +
        renderAptGroupsSection(this.inputs.aptGroups, this.inputs.campaigns);

      this.setContent(html);
      this.setDataBadge('live', 'mock');
    } catch (err) {
      this.showError(`Cyber Espionage Tracker failed to render: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
