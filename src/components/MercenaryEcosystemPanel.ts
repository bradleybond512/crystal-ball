import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  scorePMCThreat,
  type PMCGroup,
  type PMCIncident,
} from './mercenary-ecosystem-helpers';

const REFRESH_MS = 3_600_000;

const STATUS_COLOR: Record<PMCGroup['status'], string> = {
  active: '#ff9800',
  sanctioned: '#ff453a',
  disbanded: '#9e9e9e',
  rebranded: '#2196f3',
};

const INCIDENT_TYPE_COLOR: Record<PMCIncident['type'], string> = {
  atrocity: '#ff453a',
  'combat-loss': '#ff9800',
  mutiny: '#ffeb3b',
  sanction: '#2196f3',
  defection: '#9e9e9e',
};

function threatColor(score: number): string {
  if (score >= 75) return '#ff453a';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#4caf50';
}

export class MercenaryEcosystemPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'mercenary-ecosystem',
      title: 'Mercenary Ecosystem Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks private military companies (PMCs) and mercenary groups worldwide. Shows threat scores, active theaters, human rights flags, and recent incidents. Data sourced from open intelligence.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    let data: ReturnType<typeof buildRenderData> | null = null;
    try {
      data = buildRenderData();
    } catch {
      this.setContent(
        `<div style="padding:12px;font-size:12px;color:#ff9800;">Data unavailable</div>`,
      );
      return;
    }

    const hrCount = data.humanRightsViolators.length;
    this.setCount(hrCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderSummary(data)}
      ${this.renderGroups(data.groups)}
      ${this.renderIncidents(data.recentIncidents)}
    </div>`;
  }

  private renderSummary(data: ReturnType<typeof buildRenderData>): string {
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Total Strength</div>
        <div style="font-size:16px;font-weight:700;font-family:ui-monospace,monospace;">${data.totalStrength.toLocaleString()}</div>
      </div>
      <div style="flex:1;min-width:120px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Most Active Theater</div>
        <div style="font-size:13px;font-weight:600;">${escapeHtml(data.mostActiveTheater)}</div>
      </div>
      <div style="flex:1;min-width:120px;padding:8px 10px;border:1px solid #ff453a;border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">HR Violators</div>
        <div style="font-size:16px;font-weight:700;color:#ff453a;font-family:ui-monospace,monospace;">${data.humanRightsViolators.length}</div>
      </div>
    </div>`;
  }

  private renderGroups(groups: PMCGroup[]): string {
    const rows = groups.slice(0, 8).map((g) => this.renderGroupRow(g)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">PMC Groups (by Threat Score)</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderGroupRow(g: PMCGroup): string {
    const score = scorePMCThreat(g);
    const color = threatColor(score);
    const statusColor = STATUS_COLOR[g.status];
    const theaters = g.activeTheaters.slice(0, 3).map((t) => escapeHtml(t)).join(', ');
    const moreTheaters = g.activeTheaters.length > 3 ? ` +${g.activeTheaters.length - 3}` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:7px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:700;font-size:12px;">${escapeHtml(g.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
            Sponsor: ${escapeHtml(g.sponsor)} &nbsp;·&nbsp;
            Strength: ${g.estimatedStrength.toLocaleString()} &nbsp;·&nbsp;
            Revenue: $${g.revenueMUSD}M
          </div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">
            Theaters: ${theaters}${escapeHtml(moreTheaters)}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;white-space:nowrap;">
          <div style="font-size:12px;font-weight:700;color:${color};font-family:ui-monospace,monospace;">T:${score}</div>
          <div style="font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;">${escapeHtml(g.status)}</div>
          <div style="font-size:10px;color:${g.humanRightsFlags >= 5 ? '#ff453a' : 'var(--text-secondary,#aaa)'};">HR ${g.humanRightsFlags}/10</div>
        </div>
      </div>
    </div>`;
  }

  private renderIncidents(incidents: PMCIncident[]): string {
    if (incidents.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No recent incidents on record.</div>
      </div>`;
    }
    const rows = incidents.map((i) => this.renderIncidentRow(i)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderIncidentRow(i: PMCIncident): string {
    const color = INCIDENT_TYPE_COLOR[i.type];
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="font-weight:600;font-size:11px;text-transform:capitalize;">${escapeHtml(i.type.replace('-', ' '))} · ${escapeHtml(i.country)}</div>
        <div style="font-size:10px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);white-space:nowrap;">${escapeHtml(i.date)}</div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(i.description)}</div>
    </div>`;
  }
}
