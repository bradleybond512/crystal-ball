/**
 * ExtremismTrackingPanel — overview of 12 major extremist groups across
 * ideologies, 8 recent significant attacks (2023-2024), and a composite
 * Global Extremism Threat Index.
 *
 * Header: threat index, critical-group count, growing-group count, and the
 * number of major attacks in the dataset. Groups table: sorted by threat
 * level (critical first) then 12-month attack count desc. Recent events:
 * sorted by fatalities desc.
 *
 * Refresh: every 24 hours. The data is a static, deterministic model
 * (extremism-tracking-helpers.ts) so the panel is a pure render of it.
 */

import { escapeHtml } from "@/utils/sanitize";
import { Panel } from './Panel';
import {
  buildRenderData,
  getByThreatLevel,
  getGrowingGroups,
  getMajorEvents,
  threatLevelClass,
  ideologyClass,
  type ExtremistGroup,
  type ExtremismEvent,
} from './extremism-tracking-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24h

const THREAT_COLOR: Record<ExtremistGroup['threatLevel'], string> = {
  critical: '#ff453a',
  high: '#ff5722',
  medium: '#ff9800',
  low: '#4caf50',
};

const THREAT_RANK: Record<ExtremistGroup['threatLevel'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TREND_COLOR: Record<ExtremistGroup['trend'], string> = {
  growing: '#ff453a',
  stable: '#ffeb3b',
  declining: '#4caf50',
};

const TREND_ARROW: Record<ExtremistGroup['trend'], string> = {
  growing: '↑',
  stable: '→',
  declining: '↓',
};

const IDEOLOGY_LABEL: Record<ExtremistGroup['ideology'], string> = {
  'jihadist-salafi': 'Jihadist',
  'far-right': 'Far-Right',
  'far-left': 'Far-Left',
  ethnonationalist: 'Ethnonationalist',
  'eco-terrorist': 'Eco',
  'religious-cult': 'Cult',
  anarchist: 'Anarchist',
};


function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function h(tag: string, attrs: Record<string, string>, ...children: string[]): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<${tag}${attrStr ? ' ' + attrStr : ''}>${children.join('')}</${tag}>`;
}

function formatThousands(n: number): string {
  return n.toLocaleString('en-US');
}

export class ExtremismTrackingPanel extends Panel {
  static readonly panelId = 'extremism-tracking';
  static readonly title = 'Extremism Tracking';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ExtremismTrackingPanel.panelId,
      title: ExtremismTrackingPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        '12 major extremist groups across ideologies (jihadist-salafi, far-right, far-left, ethnonationalist, eco-terrorist) with threat level, membership, financing, and 12-month attack counts. Tracks 8 recent major attacks (2023-2024) and a weighted Global Extremism Threat Index.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.setContent(
        '<div style="padding:12px;color:var(--text-secondary,#aaa);font-size:11px;">Data unavailable</div>',
      );
      return;
    }

    const criticalCount = getByThreatLevel(data.groups, 'critical').length;
    const growingCount = getGrowingGroups(data.groups).length;
    const majorCount = getMajorEvents(data.recentEvents).length;
    this.setCount(criticalCount);

    this.setContent(
      `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderHeader(data.globalExtremismThreatIndex, criticalCount, growingCount, majorCount)}
        ${this.renderGroups(data.groups)}
        ${this.renderEvents(data.recentEvents)}
      </div>`,
    );
  }

  private renderHeader(
    index: number,
    criticalCount: number,
    growingCount: number,
    majorCount: number,
  ): string {
    let idxColor = THREAT_COLOR.medium;
    if (index >= 70) idxColor = THREAT_COLOR.critical;
    else if (index >= 50) idxColor = THREAT_COLOR.high;
    const metric = (label: string, value: string, color: string): string =>
      h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:2px;' },
        h('span', { style: 'font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);' }, escapeHtml(label)),
        h('span', { style: `font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:${color};` }, escapeHtml(value)),
      );
    return h(
      'div',
      { style: 'display:flex;gap:18px;flex-wrap:wrap;' },
      metric('Global Extremism Threat Index', `${index}/100`, idxColor),
      metric('Critical Groups', String(criticalCount), THREAT_COLOR.critical),
      metric('Growing', String(growingCount), THREAT_COLOR.high),
      metric('Major Attacks', String(majorCount), 'var(--text-primary,#eee)'),
    );
  }

  private renderGroups(groups: ExtremistGroup[]): string {
    const rows = [...groups]
      .sort((a, b) => {
        const rank = THREAT_RANK[a.threatLevel] - THREAT_RANK[b.threatLevel];
        if (rank !== 0) return rank;
        return b.recentAttacks12Mo - a.recentAttacks12Mo;
      })
      .map((g) => this.renderGroupRow(g))
      .join('');
    return h(
      'div',
      {},
      h(
        'div',
        { style: 'font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;' },
        `Extremist Groups (${groups.length})`,
      ),
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;' }, rows),
    );
  }

  private renderGroupRow(g: ExtremistGroup): string {
    const color = THREAT_COLOR[g.threatLevel];
    const tColor = TREND_COLOR[g.trend];
    return `<div class="${threatLevelClass(g.threatLevel)}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(g.name)}</div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;">
          <span class="${ideologyClass(g.ideology)}">${escapeHtml(IDEOLOGY_LABEL[g.ideology])}</span> · ${escapeHtml(g.primaryRegion)}
        </div>
      </div>
      <span style="font-size:9px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(g.threatLevel)}</span>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-weight:700;color:${color};font-family:ui-monospace,monospace;">${g.recentAttacks12Mo} atk/12mo</div>
        <div style="font-size:9px;color:var(--text-secondary,#aaa);">~${formatThousands(g.estimatedMembers)} members</div>
      </div>
      <span style="font-weight:700;color:${tColor};font-size:13px;width:14px;text-align:center;">${TREND_ARROW[g.trend]}</span>
    </div>`;
  }

  private renderEvents(events: ExtremismEvent[]): string {
    const rows = [...events]
      .sort((a, b) => b.fatalities - a.fatalities)
      .map((e) => this.renderEventRow(e))
      .join('');
    return h(
      'div',
      {},
      h(
        'div',
        { style: 'font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;' },
        'Recent Attacks',
      ),
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;' }, rows),
    );
  }

  private renderEventRow(e: ExtremismEvent): string {
    const sigColor = e.significance === 'major' ? THREAT_COLOR.critical : THREAT_COLOR.high;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sigColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.country)} · ${escapeHtml(e.group)} · ${escapeHtml(e.date)}</div>
        <div style="font-size:9px;font-weight:700;color:${sigColor};text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;">${e.fatalities} killed</div>
      </div>
      <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(e.attackType)} · ${e.injured} injured · ${escapeHtml(e.description)}</div>
    </div>`;
  }
}
