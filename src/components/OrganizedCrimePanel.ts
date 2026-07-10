 
import { Panel } from './Panel';
import {
  buildRenderData,
  assessStatePenetration,
  type CriminalOrg,
  type TerritoryConflict,
  type NetworkType,
} from './organized-crime-helpers';

const REFRESH_MS = 300_000;

const NETWORK_TYPE_COLOR: Record<NetworkType, string> = {
  cartel: '#d50000',
  mafia: '#e65100',
  triad: '#1565c0',
  gang: '#4a148c',
  hybrid: '#ff6f00',
};

const NETWORK_TYPE_LABEL: Record<NetworkType, string> = {
  cartel: 'Cartel',
  mafia: 'Mafia',
  triad: 'Triad',
  gang: 'Gang',
  hybrid: 'Hybrid',
};

const PENETRATION_COLOR: Record<ReturnType<typeof assessStatePenetration>, string> = {
  critical: '#d50000',
  high: '#ff5722',
  medium: '#ff9800',
  low: '#4caf50',
};

function escHtml(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderOrgRow(org: CriminalOrg): string {
  const typeColor = NETWORK_TYPE_COLOR[org.networkType];
  const typeLabel = NETWORK_TYPE_LABEL[org.networkType];
  const penetrationLevel = assessStatePenetration(org.statePenetration);
  const penetrationColor = PENETRATION_COLOR[penetrationLevel];
  const revenueB = (org.annualRevenueUSD / 1e9).toFixed(1);
  const activities = org.primaryActivities.slice(0, 3).map(a => escHtml(a)).join(' · ');
  const territories = org.territory.slice(0, 3).map(t => escHtml(t)).join(', ');
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${typeColor};border-radius:3px;padding:8px 10px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
      <div style="font-weight:700;font-size:12px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(org.name)}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
        <span style="font-size:10px;font-weight:700;color:${typeColor};text-transform:uppercase;letter-spacing:0.05em;">${escHtml(typeLabel)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">str ${org.strengthScore}</span>
      </div>
    </div>
    <div style="margin-top:3px;font-size:10px;color:var(--text-secondary,#aaa);">${territories}</div>
    <div style="margin-top:3px;display:flex;gap:12px;font-size:10px;">
      <span>Revenue <strong>$${escHtml(revenueB)}B</strong></span>
      <span>Reach <strong>${org.transnationalReach}</strong></span>
      <span style="color:${penetrationColor};">State penetration <strong>${escHtml(penetrationLevel)}</strong></span>
    </div>
    <div style="margin-top:3px;font-size:10px;color:var(--text-secondary,#aaa);">${activities}</div>
  </div>`;
}

function intensityColor(intensity: TerritoryConflict['intensity']): string {
  if (intensity === 'high') return '#d50000';
  if (intensity === 'medium') return '#ff9800';
  return '#4caf50';
}

function renderConflictRow(c: TerritoryConflict): string {
  const color = intensityColor(c.intensity);
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;">
    <div>
      <div style="font-weight:600;">${escHtml(c.region)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">${c.orgs.map(o => escHtml(o)).join(' vs ')}</div>
    </div>
    <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;">${escHtml(c.intensity)}</div>
  </div>`;
}

export class OrganizedCrimePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'organized-crime',
      title: 'Organized Crime Networks',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Ranked criminal organizations by composite strength score — network type, state penetration, transnational reach, and estimated annual revenue. Territory conflict intensity and high-intensity active wars.',
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
    const data = buildRenderData();
    this.setCount(data.highIntensityConflicts);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const revenueB = (data.totalRevenue / 1e9).toFixed(1);
    const orgRows = data.orgs.slice(0, 8).map(org => renderOrgRow(org)).join('');
    const conflictRows = data.highIntensityConflicts > 0
      ? data.conflicts.filter(c => c.intensity === 'high').map(c => renderConflictRow(c)).join('')
      : `<div style="font-size:11px;color:var(--text-secondary,#aaa);">No high-intensity territory wars active.</div>`;
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Organizations (${data.orgs.length})</div>
        <div style="font-size:12px;font-weight:700;">$${escHtml(revenueB)}B annual revenue</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${orgRows}</div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Active Territory Wars (${data.highIntensityConflicts})</div>
        <div style="display:flex;flex-direction:column;gap:4px;">${conflictRows}</div>
      </div>
    </div>`;
  }
}
