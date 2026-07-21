import { escapeHtml } from "@/utils/sanitize";
import { Panel } from './Panel';
import {
  buildRenderData,
  getByRiskLevel,
  getDarkOrSpoofing,
  riskLevelClass,
  aisStatusClass,
} from './shadow-fleet-helpers';
import type { ShadowVessel, ShadowFleetStat, AisStatus, RiskLevel } from './shadow-fleet-helpers';

const REFRESH_MS = 24 * 60 * 60_000; // 24h

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ff453a',
  high: '#ff9800',
  medium: '#ffeb3b',
};

const AIS_LABEL: Record<AisStatus, string> = {
  spoofing: 'Spoofing',
  dark: 'Dark',
  intermittent: 'Intermittent',
  active: 'Active',
};

const AIS_COLOR: Record<AisStatus, string> = {
  spoofing: '#ff453a',
  dark: '#b71c1c',
  intermittent: '#ff9800',
  active: '#4caf50',
};



function h(tag: string, attrs: Record<string, string>, ...children: string[]): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<${tag}${attrStr ? ' ' + attrStr : ''}>${children.join('')}</${tag}>`;
}

function fmtMbpd(bpd: number): string {
  return `${(bpd / 1e6).toFixed(2)} Mbpd`;
}

function statCard(label: string, value: string, color: string): string {
  return h(
    'div',
    { style: 'flex:1;min-width:0;padding:8px 10px;background:var(--surface-raised,#1a1a1a);border-radius:4px;border-left:3px solid ' + color + ';' },
    h('div', { style: 'font-size:15px;font-weight:700;font-family:ui-monospace,monospace;white-space:nowrap;' }, escapeHtml(value)),
    h('div', { style: 'font-size:9px;text-transform:uppercase;color:var(--text-secondary,#aaa);letter-spacing:0.04em;margin-top:2px;' }, escapeHtml(label)),
  );
}

function statRow(s: ShadowFleetStat): string {
  return `<tr style="border-bottom:1px solid var(--border-subtle,#2a2a2a);font-size:11px;">
    <td style="padding:4px 6px;font-weight:600;">${escapeHtml(s.sanctionTarget)}</td>
    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${s.estimatedVessels}</td>
    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${fmtMbpd(s.estimatedBpdCapacity)}</td>
    <td style="padding:4px 6px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(s.primaryFlagStates.slice(0, 3).join(', '))}</td>
  </tr>`;
}

function vesselRow(v: ShadowVessel): string {
  const riskColor = RISK_COLOR[v.riskLevel];
  const aisColor = AIS_COLOR[v.aisStatus];
  const riskBadge = h(
    'span',
    { class: riskLevelClass(v.riskLevel), style: `display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;background:${riskColor};color:#000;` },
    escapeHtml(v.riskLevel),
  );
  const aisBadge = h(
    'span',
    { class: aisStatusClass(v.aisStatus), style: `color:${aisColor};font-weight:600;` },
    escapeHtml(AIS_LABEL[v.aisStatus]),
  );
  return `<tr style="border-bottom:1px solid var(--border-subtle,#2a2a2a);font-size:11px;">
    <td style="padding:4px 6px;font-weight:600;">${escapeHtml(v.name)}</td>
    <td style="padding:4px 6px;color:var(--text-secondary,#aaa);">${escapeHtml(v.flagState)}</td>
    <td style="padding:4px 6px;color:var(--text-secondary,#aaa);">${escapeHtml(v.sanctionTarget)}</td>
    <td style="padding:4px 6px;">${aisBadge}</td>
    <td style="padding:4px 6px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(v.estimatedCargoType)}</td>
    <td style="padding:4px 6px;text-align:right;font-family:ui-monospace,monospace;">${v.detectionEvents}</td>
    <td style="padding:4px 6px;text-align:right;">${riskBadge}</td>
  </tr>`;
}

export class ShadowFleetPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'shadow-fleet',
      title: 'Shadow Fleet Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks the ~535-vessel shadow/dark fleet used to evade sanctions on Russian, Iranian, Venezuelan, and North Korean oil exports. Covers AIS spoofing, flag-of-convenience registration, ship-to-ship transfers, and key transshipment chokepoints.',
    });
    this.start();
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  public override destroy(): void {
    this.dispose();
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = buildRenderData();
    this.setCount(data.totalEstimatedFleetSize);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    const data = buildRenderData();
    const criticalCount = getByRiskLevel(data.vessels, 'critical').length;
    const darkSpoofCount = getDarkOrSpoofing(data.vessels).length;
    const totalBpd = data.stats.reduce((s, st) => s + st.estimatedBpdCapacity, 0);

    const header = h(
      'div',
      { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
      statCard('Est. Fleet', String(data.totalEstimatedFleetSize), '#888'),
      statCard('Critical Risk', String(criticalCount), RISK_COLOR.critical),
      statCard('Dark / Spoofing', String(darkSpoofCount), AIS_COLOR.dark),
      statCard('Daily Capacity', fmtMbpd(totalBpd), '#ff9800'),
    );

    const evasionBar = h(
      'div',
      { style: 'display:flex;align-items:center;gap:8px;font-size:11px;' },
      h('div', { style: 'text-transform:uppercase;color:var(--text-secondary,#aaa);white-space:nowrap;' }, 'Global Evasion Risk'),
      h('div', { style: 'flex:1;background:var(--border-subtle,#333);border-radius:2px;height:7px;' },
        h('div', { style: `width:${data.globalEvasionRiskIndex}%;background:#ff453a;height:7px;border-radius:2px;` }, '')),
      h('div', { style: 'font-family:ui-monospace,monospace;font-weight:700;width:34px;text-align:right;' }, String(data.globalEvasionRiskIndex)),
    );

    const statsTable = `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Fleet by Sanction Target</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="font-size:9px;text-transform:uppercase;color:var(--text-secondary,#888);text-align:left;">
          <th style="padding:4px 6px;">Target</th>
          <th style="padding:4px 6px;text-align:right;">Vessels</th>
          <th style="padding:4px 6px;text-align:right;">Capacity</th>
          <th style="padding:4px 6px;">Flag States</th>
        </tr></thead>
        <tbody>${data.stats.map((s) => statRow(s)).join('')}</tbody>
      </table>
    </div>`;

    const sortedVessels = [...data.vessels].sort((a, b) => b.detectionEvents - a.detectionEvents);
    const vesselsTable = `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Notable Vessels (by detection events)</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="font-size:9px;text-transform:uppercase;color:var(--text-secondary,#888);text-align:left;">
          <th style="padding:4px 6px;">Name</th>
          <th style="padding:4px 6px;">Flag</th>
          <th style="padding:4px 6px;">Target</th>
          <th style="padding:4px 6px;">AIS</th>
          <th style="padding:4px 6px;">Cargo</th>
          <th style="padding:4px 6px;text-align:right;">Det.</th>
          <th style="padding:4px 6px;text-align:right;">Risk</th>
        </tr></thead>
        <tbody>${sortedVessels.map((v) => vesselRow(v)).join('')}</tbody>
      </table>
    </div>`;

    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${header}
      ${evasionBar}
      ${statsTable}
      ${vesselsTable}
    </div>`;
  }
}
