import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  classifyIntensity,
  type GrayZoneOperation,
  type GrayIncident,
  type IntensityLevel,
  type GrayTactic,
} from './gray-zone-conflict-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour — static data

const INTENSITY_COLOR: Record<IntensityLevel, string> = {
  extreme: '#ff453a',
  high:    '#ff9800',
  moderate:'#ffeb3b',
  low:     '#9e9e9e',
};

export class GrayZoneConflictPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'gray-zone-conflict',
      title: 'Gray Zone Conflict Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks active gray zone operations and incidents across Russia, China, Iran, and North Korea. Ranks by escalation potential and deniability score. Data is static analytical fixtures — no live feed required.',
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
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
    this.setCount(data.activeCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const summaryBlock = this.renderSummary(data);
    const operationsBlock = this.renderOperations(data.operations);
    const incidentsBlock = this.renderIncidents(data.recentIncidents);
    const tacticsBlock = this.renderTactics(data.tacticDistribution);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${summaryBlock}
      ${operationsBlock}
      ${incidentsBlock}
      ${tacticsBlock}
    </div>`;
  }

  private renderSummary(data: ReturnType<typeof buildRenderData>): string {
    let gziColor: string;
    if (data.globalGrayZoneIndex >= 70) {
      gziColor = '#ff453a';
    } else if (data.globalGrayZoneIndex >= 50) {
      gziColor = '#ff9800';
    } else if (data.globalGrayZoneIndex >= 30) {
      gziColor = '#ffeb3b';
    } else {
      gziColor = '#4caf50';
    }
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:100px;text-align:center;padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:22px;font-weight:700;color:${gziColor};">${data.globalGrayZoneIndex}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Gray Zone Index</div>
      </div>
      <div style="flex:1;min-width:100px;text-align:center;padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:22px;font-weight:700;color:#ff9800;">${data.activeCount}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Active Operations</div>
      </div>
      <div style="flex:1;min-width:120px;text-align:center;padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:14px;font-weight:700;color:#ef4444;">${escapeHtml(data.mostDangerousActor)}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Most Dangerous Actor</div>
      </div>
    </div>`;
  }

  private renderOperations(operations: GrayZoneOperation[]): string {
    if (operations.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Operations</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No operations data available.</div>
      </div>`;
    }
    const rows = operations.map(op => this.renderOperationRow(op)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Operations (${operations.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderOperationRow(op: GrayZoneOperation): string {
    const level = classifyIntensity(op.escalationPotential);
    const color = INTENSITY_COLOR[level];
    const tactics = op.tactics.slice(0, 3).map(t => escapeHtml(t)).join(' · ');
    const moreCount = op.tactics.length > 3 ? op.tactics.length - 3 : 0;
    const tacticStr = moreCount > 0 ? `${tactics} +${moreCount}` : tactics;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:7px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(op.name)}</div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(op.actor)} → ${escapeHtml(op.targetNation)} · ${escapeHtml(op.domain)}</div>
          <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(tacticStr)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;">${escapeHtml(level)}</span>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);">esc ${op.escalationPotential}</span>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);">den ${op.deniabilityScore}</span>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;line-height:1.4;">${escapeHtml(op.responseConstraint)}</div>
    </div>`;
  }

  private renderIncidents(incidents: GrayIncident[]): string {
    if (incidents.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents (180d)</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No incidents in the last 180 days.</div>
      </div>`;
    }
    const rows = incidents.slice(0, 8).map(i => this.renderIncidentRow(i)).join('');
    const more = incidents.length > 8
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${incidents.length - 8} more</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents (180d · ${incidents.length})</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderIncidentRow(i: GrayIncident): string {
    let deltaColor: string;
    if (i.escalationDelta >= 7) {
      deltaColor = '#ff453a';
    } else if (i.escalationDelta >= 5) {
      deltaColor = '#ff9800';
    } else if (i.escalationDelta >= 3) {
      deltaColor = '#ffeb3b';
    } else {
      deltaColor = '#9e9e9e';
    }
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${deltaColor};border-radius:3px;padding:5px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div>
          <span style="font-weight:600;">${escapeHtml(i.actor)}</span>
          <span style="color:var(--text-secondary,#aaa);margin-left:4px;">→ ${escapeHtml(i.targetNation)}</span>
          <span style="color:var(--text-secondary,#aaa);margin-left:4px;">· ${escapeHtml(i.tactic)}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
          <span style="color:${deltaColor};font-weight:700;font-family:ui-monospace,monospace;">+${i.escalationDelta}</span>
          <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(i.date)}</span>
        </div>
      </div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;margin-top:2px;line-height:1.4;">${escapeHtml(i.description)}</div>
    </div>`;
  }

  private renderTactics(dist: Record<GrayTactic, number>): string {
    const sorted = (Object.entries(dist) as [GrayTactic, number][])
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
    if (sorted.length === 0) {
      return '';
    }
    const maxCount = sorted[0]?.[1] ?? 1;
    const bars = sorted.map(([tactic, count]) => {
      const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:3px;">
        <div style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary,#aaa);">${escapeHtml(tactic)}</div>
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;">
          <div style="height:100%;width:${pct}%;background:#607d8b;border-radius:3px;"></div>
        </div>
        <div style="width:16px;text-align:right;color:var(--text-secondary,#aaa);">${count}</div>
      </div>`;
    }).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Tactic Distribution</div>
      ${bars}
    </div>`;
  }
}
