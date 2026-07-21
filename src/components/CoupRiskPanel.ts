import { escapeHtml } from "@/utils/sanitize";
import { Panel } from './Panel';
import {
  buildRenderData,
  getCriticalRisk,
  getRisingTrend,
  riskLevelClass,
  trendArrow,
  trendClass,
  type CoupRiskCountry,
  type RecentCoup,
} from './coup-risk-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24h

const RISK_COLOR: Record<CoupRiskCountry['riskLevel'], string> = {
  critical: '#ff453a',
  high: '#ff5722',
  medium: '#ff9800',
  low: '#4caf50',
};

const TREND_COLOR: Record<CoupRiskCountry['trend'], string> = {
  rising: '#ff453a',
  stable: '#ffeb3b',
  falling: '#4caf50',
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

export class CoupRiskPanel extends Panel {
  static readonly panelId = 'coup-risk';
  static readonly title = 'Coup Risk Monitor';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: CoupRiskPanel.panelId,
      title: CoupRiskPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Composite coup-risk scoring across 12 high-risk states using military influence, economic crisis, protest intensity, and civil-military tension. Tracks 8 recent coups (2020–2024) and a weighted Global Coup Risk Index.',
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

    const criticalCount = getCriticalRisk(data.countries).length;
    const risingCount = getRisingTrend(data.countries).length;
    this.setCount(criticalCount);

    this.setContent(
      `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderHeader(data.globalCoupRiskIndex, criticalCount, data.recentCoups.length, risingCount)}
        ${this.renderTable(data.countries)}
        ${this.renderRecentCoups(data.recentCoups)}
      </div>`,
    );
  }

  private renderHeader(index: number, criticalCount: number, coupCount: number, risingCount: number): string {
    let idxColor = RISK_COLOR.medium;
    if (index >= 70) idxColor = RISK_COLOR.critical;
    else if (index >= 50) idxColor = RISK_COLOR.high;
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
      metric('Global Coup Risk Index', `${index}/100`, idxColor),
      metric('Critical Risk', String(criticalCount), RISK_COLOR.critical),
      metric('Recent Coups (2020–2024)', String(coupCount), 'var(--text-primary,#eee)'),
      metric('Rising Trend', String(risingCount), RISK_COLOR.high),
    );
  }

  private renderTable(countries: CoupRiskCountry[]): string {
    const rows = [...countries]
      .sort((a, b) => b.riskScore - a.riskScore)
      .map((c) => this.renderRow(c))
      .join('');
    return h(
      'div',
      {},
      h(
        'div',
        { style: 'font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;' },
        `Coup Risk Index (${countries.length})`,
      ),
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;' }, rows),
    );
  }

  private renderRow(c: CoupRiskCountry): string {
    const color = RISK_COLOR[c.riskLevel];
    const tColor = TREND_COLOR[c.trend];
    return `<div class="${riskLevelClass(c.riskLevel)}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.country)}</div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(c.region)}</div>
      </div>
      <span style="font-size:9px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(c.riskLevel)}</span>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-weight:700;color:${color};font-family:ui-monospace,monospace;">${c.riskScore}</div>
        <div style="font-size:9px;color:var(--text-secondary,#aaa);">Mil ${c.militaryInfluence} · Econ ${c.economicCrisis}</div>
      </div>
      <span class="${trendClass(c.trend)}" style="font-weight:700;color:${tColor};font-size:13px;width:14px;text-align:center;">${trendArrow(c.trend)}</span>
    </div>`;
  }

  private renderRecentCoups(coups: RecentCoup[]): string {
    const recent = [...coups].sort((a, b) => b.year - a.year).slice(0, 5);
    const rows = recent.map((c) => this.renderCoupRow(c)).join('');
    return h(
      'div',
      {},
      h(
        'div',
        { style: 'font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;' },
        'Recent Coups',
      ),
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;' }, rows),
    );
  }

  private renderCoupRow(c: RecentCoup): string {
    const typeColor = c.type === 'attempted' ? RISK_COLOR.medium : RISK_COLOR.critical;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${typeColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:600;">${escapeHtml(c.country)} · ${c.year}</div>
        <div style="font-size:9px;font-weight:700;color:${typeColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(c.type)}</div>
      </div>
      <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(c.outcome)}</div>
    </div>`;
  }
}
