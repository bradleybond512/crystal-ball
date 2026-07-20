/* eslint-disable sonarjs/no-nested-conditional */
import { Panel } from './Panel';
import {
  buildRenderData,
  scoreDeceptionThreat,
  type DeceptionOperation,
  type DeceptionIndicator,
  type OperationalDomain,
} from './strategic-deception-helpers';

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DOMAIN_COLOR: Record<OperationalDomain, string> = {
  military: '#ff453a',
  hybrid: '#ff5722',
  diplomatic: '#ff9800',
  information: '#ffeb3b',
  cyber: '#2196f3',
  economic: '#4caf50',
};

function threatColor(score: number): string {
  if (score >= 75) return '#ff453a';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#9e9e9e';
}

function renderOperationRow(op: DeceptionOperation): string {
  const score = scoreDeceptionThreat(op);
  const color = threatColor(score);
  const domainColor = DOMAIN_COLOR[op.domain];
  const activeTag = op.active
    ? `<span style="font-size:10px;font-weight:700;color:#ff453a;text-transform:uppercase;">ACTIVE</span>`
    : `<span style="font-size:10px;color:var(--text-secondary,#aaa);">historical</span>`;
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
      <div style="font-weight:600;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeHtml(op.name)}</div>
      <div style="font-family:ui-monospace,monospace;font-weight:700;color:${color};">${score}</div>
    </div>
    <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${safeHtml(op.actor)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">&middot;</span>
      <span style="font-size:10px;color:${domainColor};text-transform:uppercase;">${safeHtml(op.domain)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">&middot;</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${safeHtml(op.type)}</span>
      <span style="margin-left:auto;">${activeTag}</span>
    </div>
    <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">
      ${safeHtml(op.strategicObjective)}
    </div>
  </div>`;
}

function renderIndicatorRow(ind: DeceptionIndicator): string {
  const confColor = ind.confidence >= 80 ? '#ff453a' : (ind.confidence >= 65 ? '#ff9800' : '#ffeb3b');
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${confColor};border-radius:3px;padding:5px 8px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">${safeHtml(ind.type)}</span>
      <span style="font-family:ui-monospace,monospace;font-size:10px;font-weight:700;color:${confColor};">${ind.confidence}%</span>
    </div>
    <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${safeHtml(ind.description)}</div>
    <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${safeHtml(ind.detectedDate)}</div>
  </div>`;
}

const REFRESH_MS = 60 * 60 * 1000; // 1 hour — static data, no live feed

export class StrategicDeceptionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'strategic-deception',
      title: 'Strategic Deception Tracker',
      showCount: true,
      trackActivity: true,
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
    try {
      const data = buildRenderData();
      this.setCount(data.activeCount);
      this.setContent(this.buildHtml(data));
    } catch (error) {
      this.showError(`Strategic Deception Tracker failed to render: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const summaryBlock = this.renderSummary(data);
    const opsBlock = this.renderOperations(data.operations);
    const indBlock = this.renderIndicators(data.recentIndicators);
    const distBlock = this.renderTypeDistribution(data);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${summaryBlock}
      ${opsBlock}
      ${indBlock}
      ${distBlock}
    </div>`;
  }

  private renderSummary(data: ReturnType<typeof buildRenderData>): string {
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;padding:8px 12px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Active Operations</div>
        <div style="font-size:20px;font-weight:700;color:#ff453a;">${data.activeCount}</div>
      </div>
      <div style="flex:1;min-width:120px;padding:8px 12px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Most Active Actor</div>
        <div style="font-size:14px;font-weight:700;">${safeHtml(data.mostActiveActor)}</div>
      </div>
      <div style="flex:1;min-width:120px;padding:8px 12px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">High-Confidence Indicators</div>
        <div style="font-size:20px;font-weight:700;color:#ff9800;">${data.recentIndicators.length}</div>
      </div>
    </div>`;
  }

  private renderOperations(ops: DeceptionOperation[]): string {
    const rows = ops.slice(0, 8).map((op) => renderOperationRow(op)).join('');
    const more = ops.length > 8
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${ops.length - 8} more operations</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Operations (${ops.length}) — ranked by threat score</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderIndicators(indicators: DeceptionIndicator[]): string {
    if (indicators.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">High-Confidence Indicators</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No high-confidence indicators detected.</div>
      </div>`;
    }
    const rows = indicators.map((ind) => renderIndicatorRow(ind)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">High-Confidence Indicators (&ge;75%)</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderTypeDistribution(data: ReturnType<typeof buildRenderData>): string {
    const dist = data.typeDistribution;
    const entries = Object.entries(dist).filter(([, count]) => count > 0);
    if (entries.length === 0) return '';
    const sortedEntries = [...entries].sort(([, a], [, b]) => b - a);
    const chips = sortedEntries
      .map(([type, count]) =>
        `<span style="display:inline-block;padding:2px 8px;border:1px solid var(--border-subtle,#333);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${safeHtml(type)} <strong>${count}</strong></span>`
      )
      .join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Type Distribution</div>
      <div>${chips}</div>
    </div>`;
  }
}
