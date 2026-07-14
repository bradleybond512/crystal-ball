import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  scoreCampaignThreat,
  type PsyopCampaign,
  type ThreatActor,
  type PsyopPhase,
} from './psychological-operations-helpers';

const ACTOR_COLOR: Record<ThreatActor, string> = {
  Russia: '#ff453a',
  China: '#ff5722',
  Iran: '#ff9800',
  'North Korea': '#ffeb3b',
  'non-state': '#9e9e9e',
};

const PHASE_COLOR: Record<PsyopPhase, string> = {
  active: '#ff453a',
  exploitation: '#ff5722',
  preparation: '#ffeb3b',
  consolidation: '#ff9800',
  dormant: '#9e9e9e',
};

function threatColor(score: number): string {
  if (score >= 75) return '#ff453a';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#4caf50';
}

export class PsychologicalOperationsPanel extends Panel {
  static readonly panelId = 'psychological-operations';

  constructor() {
    super({
      id: 'psychological-operations',
      title: 'Psychological Operations Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks active influence operations, disinformation campaigns, and psychological operations by state and non-state actors. Scores campaign threat by sophistication, narrative coherence, detection difficulty, and reach.',
    });
    this.render();
  }

  private render(): void {
    const data = buildRenderData();
    const activeCampaigns = data.campaigns.filter((c) => c.phase === 'active').length;
    this.setCount(activeCampaigns);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const headerBlock = this.renderHeader(data);
    const campaignsBlock = this.renderCampaigns(data.campaigns);
    const disinfoBlock = this.renderDisinfo(data);
    const channelBlock = this.renderChannels(data);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${headerBlock}
      ${campaignsBlock}
      ${disinfoBlock}
      ${channelBlock}
    </div>`;
  }

  private renderHeader(data: ReturnType<typeof buildRenderData>): string {
    const actorColor = ACTOR_COLOR[data.mostActiveActor] ?? '#9e9e9e';
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:2px;">Most Active Actor</div>
        <div style="font-size:13px;font-weight:700;color:${actorColor};">${escapeHtml(data.mostActiveActor)}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:2px;">Total Reach</div>
        <div style="font-size:13px;font-weight:700;">${data.totalReachMillions}M</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:2px;">Disinfo Exposure</div>
        <div style="font-size:13px;font-weight:700;color:${threatColor(data.disinfoExposure)};">${data.disinfoExposure}/100</div>
      </div>
    </div>`;
  }

  private renderCampaigns(campaigns: PsyopCampaign[]): string {
    if (campaigns.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Active Campaigns</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No campaigns found.</div>
      </div>`;
    }
    const rows = campaigns.slice(0, 8).map((c) => this.renderCampaignRow(c)).join('');
    const more = campaigns.length > 8
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${campaigns.length - 8} more</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Campaigns (${campaigns.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderCampaignRow(c: PsyopCampaign): string {
    const score = scoreCampaignThreat(c);
    const scoreColor = threatColor(score);
    const actorColor = ACTOR_COLOR[c.actor] ?? '#9e9e9e';
    const phaseColor = PHASE_COLOR[c.phase] ?? '#9e9e9e';
    const countries = c.targetCountries.slice(0, 3).map((t) => escapeHtml(t)).join(', ');
    const moreCountries = c.targetCountries.length > 3 ? ` +${c.targetCountries.length - 3}` : '';
    const channels = c.channels.map((ch) => escapeHtml(ch)).join(' · ');
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${scoreColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${countries}${escapeHtml(moreCountries)} · ${escapeHtml(channels)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
          <div style="font-weight:700;font-family:ui-monospace,monospace;color:${scoreColor};">${score}</div>
          <div style="font-size:10px;font-weight:600;color:${actorColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(c.actor)}</div>
          <div style="font-size:10px;color:${phaseColor};text-transform:uppercase;">${escapeHtml(c.phase)}</div>
        </div>
      </div>
      <div style="margin-top:4px;display:flex;gap:10px;font-size:10px;color:var(--text-secondary,#aaa);">
        <span>Reach: ${c.estimatedReach}M</span>
        <span>Soph: ${c.sophisticationScore}</span>
        <span>Detection: ${c.detectionDifficulty}</span>
      </div>
    </div>`;
  }

  private renderDisinfo(data: ReturnType<typeof buildRenderData>): string {
    if (data.disinfo.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Disinformation Narratives</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No active disinformation campaigns tracked.</div>
      </div>`;
    }
    const rows = data.disinfo.map((d) => {
      const actorColor = ACTOR_COLOR[d.actor] ?? '#9e9e9e';
      const bColor = threatColor(d.believabilityScore);
      const factTag = d.factChecked
        ? `<span style="color:#4caf50;">fact-checked</span>`
        : `<span style="color:#ff9800;">unverified</span>`;
      const retractTag = d.retracted
        ? `<span style="color:#4caf50;margin-left:6px;">retracted</span>`
        : '';
      return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${actorColor};border-radius:3px;padding:6px 8px;font-size:11px;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.narrative)}</div>
            <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(d.targetCountry)} · ${factTag}${retractTag}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
            <div style="font-weight:700;color:${actorColor};font-size:10px;text-transform:uppercase;">${escapeHtml(d.actor)}</div>
            <div style="font-size:10px;color:${bColor};">believability ${d.believabilityScore}</div>
            <div style="font-size:10px;color:var(--text-secondary,#aaa);">${(d.spreadVelocity / 1000).toFixed(0)}k/day</div>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Disinformation Narratives (${data.disinfo.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderChannels(data: ReturnType<typeof buildRenderData>): string {
    const entries = Object.entries(data.channelDistribution)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
    if (entries.length === 0) {
      return '';
    }
    const max = entries[0]?.[1] ?? 1;
    const bars = entries.map(([channel, count]) => {
      const pct = max > 0 ? Math.round((count / max) * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:4px;">
        <div style="width:110px;font-size:10px;color:var(--text-secondary,#aaa);flex-shrink:0;">${escapeHtml(channel)}</div>
        <div style="flex:1;height:6px;background:var(--border-subtle,#333);border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:#2196f3;border-radius:3px;"></div>
        </div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);width:18px;text-align:right;">${count}</div>
      </div>`;
    }).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Channel Usage</div>
      ${bars}
    </div>`;
  }
}
