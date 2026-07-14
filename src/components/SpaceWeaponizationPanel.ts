import { Panel } from './Panel';
import {
  buildRenderData,
  scoreProgramThreat,
  classifyThreatTier,
  type SpaceWeaponProgram,
  type SpaceIncident,
  type ThreatTier,
} from './space-weaponization-helpers';

function safeHtml(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TIER_COLOR: Record<ThreatTier, string> = {
  critical: '#ff453a',
  high: '#ff5722',
  medium: '#ff9800',
  low: '#4caf50',
};

function renderProgramRow(p: SpaceWeaponProgram): string {
  const score = scoreProgramThreat(p);
  const tier = classifyThreatTier(score);
  const color = TIER_COLOR[tier];
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
    <div style="min-width:0;flex:1;">
      <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeHtml(p.name)}</div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;">${safeHtml(p.nation)} &middot; ${safeHtml(p.category)} &middot; ${safeHtml(p.developmentStage)}</div>
    </div>
    <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${safeHtml(tier)} &middot; ${score}</div>
  </div>`;
}

function renderIncidentRow(inc: SpaceIncident): string {
  const tierColor = TIER_COLOR[inc.severity];
  const debrisNote = inc.debrisGenerated > 0
    ? `<span style="color:${tierColor};margin-left:6px;">${inc.debrisGenerated.toLocaleString()} debris objs</span>`
    : '';
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${tierColor};border-radius:3px;padding:6px 8px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <div style="font-weight:600;">${safeHtml(inc.nation)} &middot; ${safeHtml(inc.category)}</div>
      <div style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${safeHtml(inc.date)}</div>
    </div>
    <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${safeHtml(inc.description)}${debrisNote}</div>
  </div>`;
}

export class SpaceWeaponizationPanel extends Panel {
  constructor() {
    super({
      id: 'space-weaponization',
      title: 'Space Weaponization Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks space weapon programs by nation and category (ASAT-KE, ASAT-DEW, co-orbital, jamming, spoofing, cyber-space, hypersonic). Scores each program by strategic impact, deterrence value, and debris risk. Shows recent kinetic test incidents and orbital debris totals.',
    });
    this.render();
  }

  private render(): void {
    const data = buildRenderData();
    const operationalCount = data.programs.filter(
      (p) => p.developmentStage === 'operational',
    ).length;
    this.setCount(operationalCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const summaryBlock = this.renderSummary(data);
    const programsBlock = this.renderPrograms(data.programs);
    const incidentsBlock = this.renderIncidents(data.recentIncidents);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${summaryBlock}
      ${programsBlock}
      ${incidentsBlock}
    </div>`;
  }

  private renderSummary(data: ReturnType<typeof buildRenderData>): string {
    const catEntries = Object.entries(data.categoryDistribution)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const catBadges = catEntries
      .map(
        ([cat, count]) =>
          `<span style="display:inline-block;padding:2px 8px;border:1px solid var(--border-subtle,#333);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${safeHtml(cat)} <strong>${count}</strong></span>`,
      )
      .join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Summary</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;margin-bottom:8px;">
        <div>Leading nation: <strong>${safeHtml(data.leadingNation)}</strong></div>
        <div>Total tracked debris: <strong>${data.totalDebrisObjects.toLocaleString()}</strong> objects</div>
        <div>Programs tracked: <strong>${data.programs.length}</strong></div>
      </div>
      <div>${catBadges}</div>
    </div>`;
  }

  private renderPrograms(programs: SpaceWeaponProgram[]): string {
    const rows = programs.slice(0, 10).map((p) => renderProgramRow(p)).join('');
    const more =
      programs.length > 10
        ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${programs.length - 10} more programs</div>`
        : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Programs by Threat Score (${programs.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderIncidents(incidents: SpaceIncident[]): string {
    if (incidents.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No recent incidents on record.</div>
      </div>`;
    }
    const rows = incidents.map((inc) => renderIncidentRow(inc)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents (${incidents.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }
}
