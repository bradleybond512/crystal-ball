import { Panel } from './Panel';
import {
  buildRenderData,
  rankOutletsByReach,
  severityClass,
  statusClass,
  type StateMediaOutlet,
  type PropagandaCampaign,
} from './propaganda-tracking-helpers';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class PropagandaTrackingPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'propaganda-tracking',
      title: 'Propaganda Tracking',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'State media outlets, active propaganda campaigns, and the global information-war index. Data is static reference intelligence — no live fetch required.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = buildRenderData();
    const { outlets, campaigns, globalInfoWarIndex, activeCampaignCount, totalReachM, topActors } = data;

    this.setCount(activeCampaignCount);
    this.setContent(this.buildHtml(outlets, campaigns, globalInfoWarIndex, activeCampaignCount, totalReachM, topActors));
  }

  private buildHtml(
    outlets: StateMediaOutlet[],
    campaigns: PropagandaCampaign[],
    globalInfoWarIndex: number,
    activeCampaignCount: number,
    totalReachM: number,
    topActors: string[],
  ): string {
    const headerBlock = this.renderHeader(globalInfoWarIndex, activeCampaignCount, totalReachM, topActors);
    const campaignBlock = this.renderCampaigns(campaigns);
    const outletBlock = this.renderOutlets(outlets);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${headerBlock}
      ${campaignBlock}
      ${outletBlock}
    </div>`;
  }

  private renderHeader(
    globalInfoWarIndex: number,
    activeCampaignCount: number,
    totalReachM: number,
    topActors: string[],
  ): string {
    let indexColor: string;
    if (globalInfoWarIndex >= 60) {
      indexColor = '#d50000';
    } else if (globalInfoWarIndex >= 40) {
      indexColor = '#ff9800';
    } else {
      indexColor = '#ffeb3b';
    }
    const actorsText = topActors.slice(0, 3).join(', ');
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Info War Index</div>
        <div style="font-size:18px;font-weight:700;color:${indexColor};">${globalInfoWarIndex}/100</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Active Campaigns</div>
        <div style="font-size:18px;font-weight:700;color:#d50000;">${activeCampaignCount}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Total Outlet Reach</div>
        <div style="font-size:18px;font-weight:700;">${totalReachM}M</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Top Actors</div>
        <div style="font-size:12px;font-weight:600;">${escapeHtml(actorsText)}</div>
      </div>
    </div>`;
  }

  private renderCampaigns(campaigns: PropagandaCampaign[]): string {
    const rows = campaigns.map((c) => this.renderCampaignRow(c)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Active &amp; Recent Campaigns</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
  }

  private renderCampaignRow(c: PropagandaCampaign): string {
    const sevClass = severityClass(c.severity);
    const statusCls = statusClass(c.status);
    let sevColor: string;
    if (sevClass === 'sev-critical') {
      sevColor = '#d50000';
    } else if (sevClass === 'sev-high') {
      sevColor = '#ff9800';
    } else if (sevClass === 'sev-medium') {
      sevColor = '#ffeb3b';
    } else {
      sevColor = '#9e9e9e';
    }
    let statusColor: string;
    if (statusCls === 'status-active') {
      statusColor = '#4caf50';
    } else if (statusCls === 'status-dormant') {
      statusColor = '#ff9800';
    } else {
      statusColor = '#9e9e9e';
    }
    const platformsText = c.platforms.slice(0, 3).join(', ');
    const endNote = c.endDate ? ` &ndash; ${escapeHtml(c.endDate)}` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:4px;">
        <div style="font-weight:700;font-size:12px;">${escapeHtml(c.actor)}</div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <span style="font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;">${escapeHtml(c.status)}</span>
          <span style="font-size:10px;font-weight:600;color:${sevColor};text-transform:uppercase;">${escapeHtml(c.severity)}</span>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(c.startDate)}${endNote}</span>
        </div>
      </div>
      <div style="font-size:11px;font-style:italic;margin-bottom:4px;">${escapeHtml(c.primaryNarrative)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-bottom:4px;">${escapeHtml(c.description)}</div>
      <div style="display:flex;gap:12px;font-size:10px;color:var(--text-secondary,#aaa);">
        <span>Reach: ${c.estimatedReachM}M</span>
        <span>${escapeHtml(c.targetAudience)}</span>
        <span>${escapeHtml(platformsText)}</span>
      </div>
    </div>`;
  }

  private renderOutlets(outlets: StateMediaOutlet[]): string {
    const rows = rankOutletsByReach(outlets).map((o) => this.renderOutletRow(o)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">State Media Outlets</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderOutletRow(o: StateMediaOutlet): string {
    let fcColor: string;
    if (o.factCheckScore < 30) {
      fcColor = '#d50000';
    } else if (o.factCheckScore < 50) {
      fcColor = '#ff9800';
    } else {
      fcColor = '#ffeb3b';
    }
    const bannedText = o.bannedIn.length > 0
      ? `<span style="color:#ff9800;font-size:10px;">Banned: ${escapeHtml(o.bannedIn.slice(0, 3).join(', '))}</span>`
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:600;min-width:0;flex:1;">${escapeHtml(o.name)}</div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(o.country)}</div>
      <div style="font-family:ui-monospace,monospace;">${o.monthlyReachM}M/mo</div>
      <div style="font-weight:600;color:${fcColor};">FC: ${o.factCheckScore}/100</div>
      ${bannedText}
    </div>`;
  }
}
