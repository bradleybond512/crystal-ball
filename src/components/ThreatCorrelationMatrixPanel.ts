/**
 * Threat Correlation Matrix Panel (panel id: `threat-correlation-matrix`).
 *
 * Visual N×N matrix grid where cell color intensity scales with the
 * correlation score for that domain pair. A "Record Window" button
 * lets operators manually tick the denominator. Below the grid a hot
 * pairs list shows the strongest current correlations with trend.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getThreatCorrelationMatrix,
  type CorrelationCell,
  type CorrelationTrend,
  type MatrixSnapshot,
} from '@/services/intelligence/threat-correlation-matrix';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const TREND_ICON: Record<CorrelationTrend, string> = {
  rising: '↑',
  stable: '→',
  falling: '↓',
};

const TREND_COLOR: Record<CorrelationTrend, string> = {
  rising: '#e94f37',
  stable: '#9ca3af',
  falling: '#2ec27e',
};

export class ThreatCorrelationMatrixPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((snapshot: MatrixSnapshot) => void) | null = null;

  constructor() {
    super({
      id: 'threat-correlation-matrix',
      title: 'Correlation Matrix',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'N×N domain correlation matrix. Cell intensity = co-elevation score. Hot pairs are those at score ≥ 0.5.',
    });
    const svc = getThreatCorrelationMatrix();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getThreatCorrelationMatrix().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getThreatCorrelationMatrix();
    const snapshot = svc.getSnapshot();
    this.setCount(snapshot.hotPairs.length);
    this.setContent(this.buildHtml(snapshot), () => this.wireHandlers());
  }

  private buildHtml(snapshot: MatrixSnapshot): string {
    return `<div class="tcm-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(snapshot)}
      ${this.renderMatrix(snapshot)}
      ${this.renderHotPairs()}
    </div>`;
  }

  private renderHeader(snapshot: MatrixSnapshot): string {
    const total = snapshot.cells.length;
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">${snapshot.domains.length} domains · ${total} pair${total === 1 ? '' : 's'} tracked · ${snapshot.hotPairs.length} hot</span>
      <button class="tcm-record-window" type="button" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">Record Window</button>
    </div>`;
  }

  private renderMatrix(snapshot: MatrixSnapshot): string {
    const domains = snapshot.domains;
    if (domains.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No domains yet.</div>`;
    }
    const cellLookup = new Map<string, CorrelationCell>();
    for (const c of snapshot.cells) {
      cellLookup.set(pairKey(c.domainA, c.domainB), c);
    }
    const colTemplate = `auto repeat(${domains.length}, 1fr)`;
    const rows: string[] = [this.renderHeaderRow(domains)];
    for (const rowDomain of domains) {
      rows.push(this.renderMatrixRow(rowDomain, domains, cellLookup));
    }
    return `<div style="display:grid;grid-template-columns:${colTemplate};gap:1px;background:rgba(255,255,255,0.05);padding:1px;border-radius:3px;">${rows.join('')}</div>`;
  }

  private renderHeaderRow(domains: readonly string[]): string {
    const corner = `<div style="background:rgba(0,0,0,0.3);"></div>`;
    const headers = domains.map((d) => `<div title="${escapeHtml(d)}" style="background:rgba(0,0,0,0.3);padding:3px 2px;font-size:8.5px;font-family:ui-monospace,monospace;text-align:center;writing-mode:vertical-rl;color:#aaa;min-height:48px;display:flex;align-items:center;justify-content:center;">${escapeHtml(d.slice(0, 8))}</div>`);
    return `${corner}${headers.join('')}`;
  }

  private renderMatrixRow(
    rowDomain: string,
    domains: readonly string[],
    cellLookup: Map<string, CorrelationCell>,
  ): string {
    const label = `<div title="${escapeHtml(rowDomain)}" style="background:rgba(0,0,0,0.3);padding:3px 6px;font-size:9px;font-family:ui-monospace,monospace;color:#aaa;display:flex;align-items:center;">${escapeHtml(rowDomain.slice(0, 10))}</div>`;
    const cells = domains.map((colDomain) => {
      if (rowDomain === colDomain) {
        return `<div style="background:rgba(255,255,255,0.04);"></div>`;
      }
      const cell = cellLookup.get(pairKey(rowDomain, colDomain));
      const score = cell?.correlationScore ?? 0;
      const bg = heatColor(score);
      const tooltip = cell
        ? `${rowDomain}↔${colDomain}: score=${score.toFixed(2)} (${cell.coElevatedCount} co-elev)`
        : `${rowDomain}↔${colDomain}: no data`;
      const fontColor = score >= 0.5 ? '#fff' : '#aaa';
      return `<div title="${escapeHtml(tooltip)}" style="background:${bg};padding:3px 0;text-align:center;font-size:9px;font-family:ui-monospace,monospace;color:${fontColor};min-height:22px;display:flex;align-items:center;justify-content:center;">${cell ? score.toFixed(2).replace(/^0/, '') : ''}</div>`;
    });
    return `${label}${cells.join('')}`;
  }

  private renderHotPairs(): string {
    const hot = getThreatCorrelationMatrix().getHotPairs();
    if (hot.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No hot pairs (score &lt; 0.3).</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:3px;">${hot.map((c) => this.renderHotPair(c)).join('')}</div>`;
  }

  private renderHotPair(c: CorrelationCell): string {
    const trendColor = TREND_COLOR[c.trend];
    const trendIcon = TREND_ICON[c.trend];
    const scoreColor = heatColor(c.correlationScore);
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:4px 8px;background:rgba(255,255,255,0.02);border-left:3px solid ${scoreColor};border-radius:0 3px 3px 0;font-size:11px;">
      <span style="font-family:ui-monospace,monospace;">${escapeHtml(c.domainA)} ↔ ${escapeHtml(c.domainB)}</span>
      <span style="display:flex;align-items:center;gap:8px;font-size:10px;opacity:0.85;">
        <span style="font-family:ui-monospace,monospace;">${c.correlationScore.toFixed(2)}</span>
        <span style="font-family:ui-monospace,monospace;opacity:0.65;">${c.coElevatedCount}×</span>
        <span style="color:${trendColor};font-size:12px;">${trendIcon}</span>
      </span>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getThreatCorrelationMatrix();
    root.querySelector<HTMLButtonElement>('.tcm-record-window')?.addEventListener('click', () => {
      svc.recordWindow();
    });
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function heatColor(score: number): string {
  // Score 0 → muted gray, 1 → vivid red. Lerp through orange.
  const clamped = Math.max(0, Math.min(1, score));
  if (clamped < 0.01) return 'rgba(255,255,255,0.02)';
  // Hue from gray (no hue) to red.
  const alpha = (0.15 + clamped * 0.7).toFixed(2);
  const r = Math.round(80 + clamped * 175);
  const g = Math.round(80 + (1 - clamped) * 90);
  const b = Math.round(80 + (1 - clamped) * 50);
  return `rgba(${r},${g},${b},${alpha})`;
}
