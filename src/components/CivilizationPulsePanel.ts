/**
 * CivilizationPulsePanel — surface the latest CivilizationPulseEngine
 * reading. Large score, label badge, 24-bar SVG sparkline of recent
 * history, and a per-domain breakdown table with trend arrows. The
 * dominant stressor is highlighted in the table.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCivilizationPulseEngine,
  type CivilizationPulseEngine,
  type DomainPulse,
  type PulseLabel,
  type PulseReading,
  type PulseTrend,
} from '@/services/intelligence/civilization-pulse';

const REFRESH_MS = 30_000;

const LABEL_COLOR: Record<PulseLabel, string> = {
  nominal:  'var(--severity-ok, #4ade80)',
  elevated: 'var(--severity-medium, #facc15)',
  stressed: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const TREND_GLYPH: Record<PulseTrend, string> = {
  improving: '↑',
  stable:    '→',
  degrading: '↓',
};

const TREND_COLOR: Record<PulseTrend, string> = {
  improving: 'var(--severity-ok, #4ade80)',
  stable:    'var(--text-secondary, #aaa)',
  degrading: 'var(--severity-critical, #ef4444)',
};

const SPARKLINE_LIMIT = 24;
const SPARKLINE_W = 240;
const SPARKLINE_H = 36;

export class CivilizationPulsePanel extends Panel {
  private readonly engine: CivilizationPulseEngine;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'civilization-pulse',
      title: 'Civilization Pulse',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Composite global health score (0=critical, 100=nominal) aggregated across all observation domains. Lower domain weights count more — geopolitical, biosurv, earthquake, weather.',
    });
    this.engine = getCivilizationPulseEngine();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.engine.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const reading = this.engine.getLatestReading();
      const history = this.engine.getHistory(SPARKLINE_LIMIT);
      this.setCount(reading?.domainPulses.reduce((sum, dp) => sum + dp.activeAlerts, 0) ?? 0);
      this.setContent(this.buildHtml(reading, history));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Civilization-pulse panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(reading: PulseReading | undefined, history: readonly PulseReading[]): string {
    if (!reading) return renderEmptyState();
    return `${renderHero(reading)}${renderSparkline(history)}${renderTable(reading)}`;
  }
}

function renderEmptyState(): string {
  return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
    No pulse reading yet. The engine populates as observations stream in.
  </div>`;
}

function renderHero(reading: PulseReading): string {
  const color = LABEL_COLOR[reading.label];
  const stressorBadge = reading.dominantStressor
    ? `<span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">
        dominant stressor: <strong style="color:${LABEL_COLOR.critical};">${escapeHtml(reading.dominantStressor)}</strong>
      </span>`
    : '';
  return `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Pulse</div>
      <div style="display:flex;align-items:baseline;gap:6px;">
        <span style="font-size:42px;font-weight:700;line-height:1;color:${color};">${reading.overallScore}</span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">/ 100</span>
      </div>
    </div>
    <span style="font-size:11px;font-weight:700;padding:4px 10px;background:${color};color:#000;border-radius:4px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(reading.label)}</span>
    ${stressorBadge}
  </div>`;
}

function renderSparkline(history: readonly PulseReading[]): string {
  if (history.length === 0) {
    return `<div style="padding:8px 16px;font-size:10px;color:var(--text-secondary,#888);">No history yet.</div>`;
  }
  const barW = Math.max(1, Math.floor(SPARKLINE_W / Math.max(1, history.length)));
  const bars = history.map((r, i) => {
    const h = Math.max(2, Math.round((r.overallScore / 100) * (SPARKLINE_H - 2)));
    const x = i * barW;
    const y = SPARKLINE_H - h;
    return `<rect x="${x}" y="${y}" width="${barW - 1}" height="${h}" fill="${LABEL_COLOR[r.label]}" />`;
  }).join('');
  return `<div style="padding:8px 16px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">
      Last ${history.length} readings
    </div>
    <svg width="${SPARKLINE_W}" height="${SPARKLINE_H}" viewBox="0 0 ${SPARKLINE_W} ${SPARKLINE_H}" preserveAspectRatio="none" style="display:block;">${bars}</svg>
  </div>`;
}

function renderTable(reading: PulseReading): string {
  if (reading.domainPulses.length === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
      No active domain signals — pulse defaults to 100.
    </div>`;
  }
  const rows = [...reading.domainPulses]
    .sort((a, b) => a.score - b.score)
    .map((dp) => renderDomainRow(dp, dp.domain === reading.dominantStressor))
    .join('');
  return `<div style="max-height:400px;overflow:auto;">${rows}</div>`;
}

function renderDomainRow(dp: DomainPulse, isStressor: boolean): string {
  const trendColor = TREND_COLOR[dp.trend];
  const trendGlyph = TREND_GLYPH[dp.trend];
  const stressorBorder = isStressor ? `border-left:3px solid ${LABEL_COLOR.critical};` : '';
  const scoreColor = scoreColorFor(dp.score);
  return `<div style="padding:10px 16px;border-bottom:1px solid var(--border-subtle,#333);${stressorBorder}">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;font-weight:600;text-transform:capitalize;">${escapeHtml(dp.domain)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">weight ${dp.weight.toFixed(1)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${dp.activeAlerts} alert${dp.activeAlerts === 1 ? '' : 's'}</span>
      <span style="margin-left:auto;font-size:14px;font-weight:700;color:${scoreColor};">${dp.score}</span>
      <span style="font-size:13px;color:${trendColor};font-weight:600;">${trendGlyph}</span>
    </div>
    <div style="margin-top:4px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${dp.score}%;background:${scoreColor};"></div>
    </div>
  </div>`;
}

function scoreColorFor(score: number): string {
  if (score >= 75) return LABEL_COLOR.nominal;
  if (score >= 50) return LABEL_COLOR.elevated;
  if (score >= 25) return LABEL_COLOR.stressed;
  return LABEL_COLOR.critical;
}
