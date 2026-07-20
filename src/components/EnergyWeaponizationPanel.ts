/**
 * Energy Weaponization Panel — tracks state dependencies on energy supply,
 * historical coercion events, and ongoing pressure campaigns.
 *
 * Pure HTML-string render via setContent() — no DOM manipulation.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  rankBySeverity,
  actionClass,
  type EnergyDependency,
  type EnergyCoercionEvent,
  type DependencyRisk,
} from './energy-weaponization-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

const RISK_COLOR: Record<DependencyRisk, string> = {
  Critical: '#ff453a',
  High: '#ff9800',
  Medium: '#ffeb3b',
  Low: '#4caf50',
};

function riskColor(level: DependencyRisk): string {
  return RISK_COLOR[level] ?? '#9e9e9e';
}

function severityColor(score: number): string {
  if (score >= 9) return '#ff453a';
  if (score >= 7) return '#ff9800';
  if (score >= 5) return '#ffeb3b';
  return '#9e9e9e';
}

export class EnergyWeaponizationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'energy-weaponization',
      title: 'Energy Weaponization',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks state energy dependencies, historical coercion events (supply cuts, embargoes, infrastructure attacks), ongoing pressure campaigns, and a composite global energy risk index.',
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
    const ongoingCount = data.ongoingCoercionCount;
    this.setCount(ongoingCount + data.criticalDependencyCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const { dependencies, events, globalEnergyRiskIndex, ongoingCoercionCount, criticalDependencyCount, totalHistoricImpactBn } = data;
    let idxColor = '#ffeb3b';
    if (globalEnergyRiskIndex >= 60) {
      idxColor = '#ff453a';
    } else if (globalEnergyRiskIndex >= 40) {
      idxColor = '#ff9800';
    }
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderHeader(globalEnergyRiskIndex, idxColor, ongoingCoercionCount, criticalDependencyCount, totalHistoricImpactBn)}
      ${this.renderDependencies(dependencies)}
      ${this.renderEvents(events)}
    </div>`;
  }

  private renderHeader(
    riskIndex: number,
    idxColor: string,
    ongoingCount: number,
    criticalCount: number,
    impactBn: number,
  ): string {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Energy Risk Index</div>
        <div style="font-size:18px;font-weight:700;color:${idxColor};">${riskIndex}/100</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Ongoing Coercion</div>
        <div style="font-size:18px;font-weight:700;color:#ff453a;">${ongoingCount}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Critical Dependencies</div>
        <div style="font-size:18px;font-weight:700;color:#ff453a;">${criticalCount}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Historic Impact</div>
        <div style="font-size:18px;font-weight:700;color:#ff9800;">$${impactBn.toLocaleString()}B</div>
      </div>
    </div>`;
  }

  private renderDependencies(dependencies: EnergyDependency[]): string {
    const sorted = [...dependencies].sort((a, b) => b.dependencyPct - a.dependencyPct);
    const rows = sorted.map((dep) => this.renderDepRow(dep)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Energy Dependencies</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderDepRow(dep: EnergyDependency): string {
    const color = riskColor(dep.riskLevel);
    const altText = dep.alternativeExists ? '&#x2713; Alt available' : '&#x2717; No alternative';
    const altColor = dep.alternativeExists ? '#4caf50' : '#ff453a';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:600;">${escapeHtml(dep.importer)} &larr; ${escapeHtml(dep.exporter)}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
          <span style="font-family:ui-monospace,monospace;font-weight:700;">${dep.dependencyPct}%</span>
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;">${escapeHtml(dep.riskLevel)}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">
        <span>${escapeHtml(dep.commodity)} &middot; ${escapeHtml(dep.annualVolume)}</span>
        <span style="color:${altColor};">${altText}</span>
      </div>
    </div>`;
  }

  private renderEvents(events: EnergyCoercionEvent[]): string {
    const sorted = rankBySeverity(events);
    const rows = sorted.map((ev) => this.renderEventRow(ev)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Coercion Events (${events.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderEventRow(ev: EnergyCoercionEvent): string {
    const color = severityColor(ev.severityScore);
    const ongoingBadge = ev.ongoing
      ? `<span style="font-size:9px;font-weight:700;color:#ff453a;border:1px solid #ff453a;border-radius:3px;padding:0 4px;margin-left:6px;">ONGOING</span>`
      : '';
    const actionCls = actionClass(ev.action);
    const actionColorMap: Record<string, string> = {
      'action-cut': '#ff453a',
      'action-price': '#ff9800',
      'action-transit': '#ffeb3b',
      'action-attack': '#ff453a',
      'action-embargo': '#ff9800',
    };
    const actionColor = actionColorMap[actionCls] ?? '#9e9e9e';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="font-weight:600;">${escapeHtml(ev.actor)} &rarr; ${escapeHtml(ev.target)}${ongoingBadge}</div>
        <div style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;flex-shrink:0;">${escapeHtml(ev.date)}</div>
      </div>
      <div style="margin-top:2px;font-size:10px;">
        <span style="color:${actionColor};font-weight:600;">${escapeHtml(ev.action)}</span>
        <span style="color:var(--text-secondary,#aaa);margin-left:6px;">${escapeHtml(ev.commodity)}</span>
      </div>
      <div style="margin-top:3px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(ev.description)}</div>
      <div style="display:flex;gap:12px;margin-top:3px;font-size:10px;">
        <span style="color:${color};">Severity: ${ev.severityScore}/10</span>
        <span style="color:var(--text-secondary,#aaa);">Est. impact: $${ev.estimatedImpactBn}B</span>
      </div>
    </div>`;
  }
}
