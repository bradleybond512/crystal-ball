import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  healthClass,
  tierClass,
  type IntelPartner,
  type IntelSharingEvent,
} from './intelligence-cooperation-helpers';

const REFRESH_MS = 60 * 60 * 1000;

export class IntelligenceCooperationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastFetchAt: number | null = null;

  constructor() {
    super({
      id: 'intelligence-cooperation',
      title: 'Intelligence Cooperation',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Five Eyes and partner intelligence sharing relationships, partnership health, trust scores, and recent cooperation or friction events.',
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
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    const data = buildRenderData();
    this.lastFetchAt = Date.now();
    const { strainedCount, suspendedCount } = data;
    this.setCount(strainedCount + suspendedCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const { partners, events, globalCoopIndex, tier1Count, tier2Count, strainedCount, suspendedCount, averageTrustScore } = data;
    let coopColor = '#ff453a';
    if (globalCoopIndex >= 70) { coopColor = '#4caf50'; }
    else if (globalCoopIndex >= 50) { coopColor = '#ffeb3b'; }
    const sorted = [...partners].sort((a, b) => {
      const tierOrder: Record<string, number> = { 'Tier 1 (Core)': 0, 'Tier 2 (Enhanced)': 1, 'Tier 3 (Liaison)': 2, 'Adversarial': 3 };
      const ta = tierOrder[a.tier] ?? 3;
      const tb = tierOrder[b.tier] ?? 3;
      if (ta !== tb) return ta - tb;
      return b.trustScore - a.trustScore;
    });
    const ageStr = this.renderAge();
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderHeader(globalCoopIndex, coopColor, tier1Count, tier2Count, strainedCount, suspendedCount, averageTrustScore)}
      ${this.renderPartners(sorted)}
      ${this.renderEvents(events)}
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(ageStr)}</div>
    </div>`;
  }

  private renderAge(): string {
    if (this.lastFetchAt === null) return 'Loading…';
    const ageMs = Date.now() - this.lastFetchAt;
    if (ageMs < 60_000) return 'Updated just now';
    if (ageMs < 3_600_000) return `Updated ${Math.round(ageMs / 60_000)}m ago`;
    return `Updated ${Math.round(ageMs / 3_600_000)}h ago`;
  }

  private renderHeader(
    globalCoopIndex: number,
    coopColor: string,
    tier1Count: number,
    tier2Count: number,
    strainedCount: number,
    suspendedCount: number,
    averageTrustScore: number,
  ): string {
    return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid ${coopColor};border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Coop Index</span>
        <span style="font-size:16px;font-weight:700;color:${coopColor};">${globalCoopIndex}/100</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid #2196f3;border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Five Eyes (T1)</span>
        <span style="font-size:16px;font-weight:700;color:#2196f3;">${tier1Count}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid #9c27b0;border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Enhanced (T2)</span>
        <span style="font-size:16px;font-weight:700;color:#9c27b0;">${tier2Count}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid #ff9800;border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Strained</span>
        <span style="font-size:16px;font-weight:700;color:#ff9800;">${strainedCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid #ff453a;border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Suspended</span>
        <span style="font-size:16px;font-weight:700;color:#ff453a;">${suspendedCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;padding:6px 12px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Avg Trust</span>
        <span style="font-size:16px;font-weight:700;">${averageTrustScore}/10</span>
      </div>
    </div>`;
  }

  private renderPartners(partners: IntelPartner[]): string {
    if (partners.length === 0) {
      return `<div style="font-size:11px;color:var(--text-secondary,#aaa);">No partner data available.</div>`;
    }
    const rows = partners.map((p) => this.renderPartnerRow(p)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Intelligence Partners (${partners.length})</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
  }

  private renderPartnerRow(p: IntelPartner): string {
    const hClass = healthClass(p.partnershipHealth);
    const tClass = tierClass(p.tier);
    let healthColor = '#2196f3';
    if (hClass === 'health-strong') { healthColor = '#4caf50'; }
    else if (hClass === 'health-strained') { healthColor = '#ff9800'; }
    else if (hClass === 'health-suspended') { healthColor = '#ff453a'; }
    let tierColor = '#ff453a';
    if (tClass === 'tier-1') { tierColor = '#2196f3'; }
    else if (tClass === 'tier-2') { tierColor = '#9c27b0'; }
    else if (tClass === 'tier-3') { tierColor = '#607d8b'; }
    const domains = p.domainsShared.length > 0
      ? escapeHtml(p.domainsShared.join(' · '))
      : 'Adversarial — no sharing';
    const trustBadge = p.trustScore > 0
      ? `<span style="font-size:10px;color:var(--text-secondary,#aaa);">Trust: ${p.trustScore}/10</span>`
      : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${healthColor};border-radius:3px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:4px;">
        <div style="font-weight:700;font-size:12px;">${escapeHtml(p.country)}</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:600;color:${tierColor};text-transform:uppercase;">${escapeHtml(p.tier)}</span>
          <span style="font-size:10px;font-weight:600;color:${healthColor};text-transform:uppercase;">${escapeHtml(p.partnershipHealth)}</span>
          ${trustBadge}
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(p.primaryAgency)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${domains}</div>
      <div style="font-size:10px;margin-top:4px;">${escapeHtml(p.recentDevelopment)}</div>
    </div>`;
  }

  private renderEvents(events: IntelSharingEvent[]): string {
    if (events.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Intelligence Sharing Events</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No events recorded.</div>
      </div>`;
    }
    const rows = events.map((ev) => this.renderEventRow(ev)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Intelligence Sharing Events (${events.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderEventRow(ev: IntelSharingEvent): string {
    let sigColor = '#9e9e9e';
    if (ev.significance === 'Critical') { sigColor = '#ff453a'; }
    else if (ev.significance === 'Notable') { sigColor = '#ff9800'; }
    const frictionColor = ev.positive ? '#4caf50' : '#ff453a';
    const sentiment = ev.positive ? 'Cooperation' : 'Friction';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sigColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:4px;">
        <div style="font-weight:600;">${escapeHtml(ev.actors.join(' + '))} · ${escapeHtml(ev.domain)}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-size:10px;font-weight:700;color:${sigColor};text-transform:uppercase;">${escapeHtml(ev.significance)}</span>
          <span style="font-size:10px;color:${frictionColor};">${escapeHtml(sentiment)}</span>
          <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(ev.date)}</span>
        </div>
      </div>
      <div style="margin-top:4px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(ev.description)}</div>
    </div>`;
  }
}
