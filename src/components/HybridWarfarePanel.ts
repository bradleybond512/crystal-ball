import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  type HybridOperation,
  type HybridIncident,
} from './hybrid-warfare-helpers';

const REFRESH_MS = 30 * 60 * 1000;

export class HybridWarfarePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'hybrid-warfare',
      title: 'Hybrid Warfare',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks state-sponsored hybrid warfare operations: cyber campaigns, information ops, proxy forces, economic coercion, sabotage, and political subversion. Displays a global hybrid index, active operations sorted by severity, and recent incidents.',
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
    this.setCount(data.criticalCount + data.escalatingCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const {
      operations,
      incidents,
      globalHybridIndex,
      activeOperationCount,
      escalatingCount,
      criticalCount,
      topActors,
    } = data;

    let indexColor: string;
    if (globalHybridIndex >= 70) {
      indexColor = '#d50000';
    } else if (globalHybridIndex >= 50) {
      indexColor = '#ff9800';
    } else {
      indexColor = '#ffeb3b';
    }

    const header = `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);margin-bottom:8px;">
      <div style="display:flex;flex-direction:column;align-items:center;min-width:80px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Hybrid Index</span>
        <span style="font-size:20px;font-weight:700;color:${indexColor};">${globalHybridIndex}/100</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Active Ops</span>
        <span style="font-size:16px;font-weight:700;color:#2196f3;">${activeOperationCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Escalating</span>
        <span style="font-size:16px;font-weight:700;color:#ff9800;">${escalatingCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Critical</span>
        <span style="font-size:16px;font-weight:700;color:#d50000;">${criticalCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;flex:1;min-width:120px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Top Actors</span>
        <span style="font-size:12px;font-weight:600;">${escapeHtml(topActors.slice(0, 3).join(', '))}</span>
      </div>
    </div>`;

    const sortedOps = [...operations].sort((a, b) => b.severityScore - a.severityScore);
    const opsRows = sortedOps.map((op) => this.renderOpRow(op)).join('');
    const opsSection = `<div style="padding:0 12px;margin-bottom:12px;">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Operations (${operations.length})</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${opsRows}</div>
    </div>`;

    const incRows = incidents.map((inc) => this.renderIncidentRow(inc)).join('');
    const incSection = `<div style="padding:0 12px;">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Incidents (${incidents.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${incRows}</div>
    </div>`;

    return `<div style="padding-bottom:12px;">${header}${opsSection}${incSection}</div>`;
  }

  private renderOpRow(op: HybridOperation): string {
    const sevColor = severityClassToColor(op.severity);
    const statusBadge = renderBadge(op.status, statusClassToColor(op.status));
    const sevBadge = renderBadge(op.severity, sevColor);
    const attrBadge = renderBadge(op.attribution, '#9e9e9e');
    const components = escapeHtml(op.components.join(' · '));
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;padding:8px 10px;">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-weight:700;font-size:12px;">${escapeHtml(op.actor)}</span>
        <span style="color:var(--text-secondary,#aaa);">→</span>
        <span style="font-weight:600;font-size:12px;">${escapeHtml(op.target)}</span>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-left:auto;">${statusBadge}${sevBadge}${attrBadge}</div>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-bottom:4px;">${components}</div>
      <div style="font-size:11px;">${escapeHtml(op.description)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">Last activity: ${escapeHtml(op.lastActivity)}</div>
    </div>`;
  }

  private renderIncidentRow(inc: HybridIncident): string {
    const sevColor = severityClassToColor(inc.severity);
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
          <span style="font-weight:600;">${escapeHtml(inc.actor)}</span>
          <span style="color:var(--text-secondary,#aaa);">→</span>
          <span style="font-weight:600;">${escapeHtml(inc.target)}</span>
          <span style="font-size:10px;padding:1px 5px;border:1px solid var(--border-subtle,#333);border-radius:8px;">${escapeHtml(inc.component)}</span>
          <span style="font-size:10px;font-weight:700;color:${sevColor};">${escapeHtml(inc.severity)}</span>
        </div>
        <div style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;white-space:nowrap;">${escapeHtml(inc.date)}</div>
      </div>
      <div style="margin-top:4px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(inc.description)}</div>
    </div>`;
  }
}

function severityClassToColor(s: string): string {
  if (s === 'Critical') return '#d50000';
  if (s === 'High') return '#ff9800';
  if (s === 'Medium') return '#ffeb3b';
  return '#9e9e9e';
}

function statusClassToColor(s: string): string {
  if (s === 'Active') return '#2196f3';
  if (s === 'Escalating') return '#ff9800';
  if (s === 'Dormant') return '#9e9e9e';
  return '#4caf50';
}

function renderBadge(label: string, color: string): string {
  return `<span style="display:inline-block;padding:1px 6px;border:1px solid ${color};border-radius:8px;font-size:10px;color:${color};">${escapeHtml(label)}</span>`;
}

export { severityClass, statusClass } from './hybrid-warfare-helpers';
