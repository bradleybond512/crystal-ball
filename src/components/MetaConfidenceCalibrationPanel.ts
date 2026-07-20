/**
 * MetaConfidenceCalibrationPanel — operator view of "how well-calibrated
 * is the system's confidence?". Each (domain, algorithm) pair shows a
 * reliability badge, calibration-error bar, meta-confidence score, and
 * an expandable 5-bin calibration histogram with predicted vs actual.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMetaConfidenceCalibrationService,
  type CalibrationBin,
  type CalibrationReliability,
  type MetaConfidenceCalibrationService,
  type MetaConfidenceSummary,
} from '@/services/intelligence/meta-confidence';

const REFRESH_MS = 30_000;

const RELIABILITY_COLOR: Record<CalibrationReliability, string> = {
  high:                'var(--severity-ok, #4ade80)',
  medium:              'var(--severity-medium, #facc15)',
  low:                 'var(--severity-critical, #ef4444)',
  'insufficient-data': 'var(--text-secondary, #888)',
};

export class MetaConfidenceCalibrationPanel extends Panel {
  private readonly service: MetaConfidenceCalibrationService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private expandedKey: string | null = null;

  constructor() {
    super({
      id: 'meta-confidence-calibration',
      title: 'Meta-Confidence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Confidence in the confidence score. "When the system says 0.8, how often is it actually right?" Lower calibration error = more reliable confidence numbers.',
    });
    this.service = getMetaConfidenceCalibrationService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.service.subscribeCalibration(() => this.render());
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
      const summaries = this.service.getAllSummaries();
      const totalRecords = this.service.getRecords().length;
      this.setCount(summaries.length);
      this.setContent(this.buildHtml(summaries, totalRecords), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Meta-confidence panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(summaries: readonly MetaConfidenceSummary[], totalRecords: number): string {
    const header = `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">(domain, algorithm) pairs</span>
      <span style="font-size:14px;font-weight:700;">${summaries.length}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">${totalRecords} prediction record${totalRecords === 1 ? '' : 's'} tracked</span>
    </div>`;
    if (summaries.length === 0) {
      return `${header}<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
        No prediction outcomes recorded yet. Reliability bands populate as record() calls accumulate.
      </div>`;
    }
    const sorted = [...summaries].sort((a, b) => b.meanCalibrationError - a.meanCalibrationError);
    const rows = sorted.map((s) => this.renderRow(s)).join('');
    return `${header}<div style="max-height:440px;overflow:auto;">${rows}</div>`;
  }

  private renderRow(summary: MetaConfidenceSummary): string {
    const key = `${summary.domain}|${summary.algorithmId}`;
    const isExpanded = key === this.expandedKey;
    const reliabilityColor = RELIABILITY_COLOR[summary.reliability];
    const score = summary.reliability === 'insufficient-data' ? 0.5 : 1 - summary.meanCalibrationError;
    const scorePct = Math.round(score * 100);
    const errorPct = Math.round(summary.meanCalibrationError * 100);
    const bins = isExpanded ? renderBins(summary.bins) : '';
    return `<div class="mcp-row" data-key="${escapeHtml(key)}" style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${reliabilityColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(summary.reliability)}</span>
        <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(summary.domain)}</span>
        <span style="font-size:12px;font-weight:600;">${escapeHtml(summary.algorithmId)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${summary.sampleCount} sample${summary.sampleCount === 1 ? '' : 's'}</span>
      </div>
      <div style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:10px;">
        <span style="min-width:90px;color:var(--text-secondary,#aaa);">calibration error</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${errorPct}%;background:${reliabilityColor};"></div>
        </div>
        <span style="min-width:40px;text-align:right;font-weight:700;color:${reliabilityColor};">${errorPct}%</span>
      </div>
      <div style="margin-top:4px;display:flex;align-items:center;gap:8px;font-size:10px;">
        <span style="min-width:90px;color:var(--text-secondary,#aaa);">meta-confidence</span>
        <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${scorePct}%;background:var(--severity-ok, #4ade80);"></div>
        </div>
        <span style="min-width:40px;text-align:right;font-weight:700;">${scorePct}%</span>
      </div>
      ${bins}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const row of root.querySelectorAll<HTMLElement>('.mcp-row')) {
      row.addEventListener('click', () => {
        const key = row.dataset.key ?? null;
        this.expandedKey = this.expandedKey === key ? null : key;
        this.render();
      });
    }
  }
}

function renderBins(bins: readonly CalibrationBin[]): string {
  const rows = bins.map((b) => renderBinRow(b)).join('');
  return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Calibration bins — predicted vs actual</div>
    ${rows}
  </div>`;
}

function binBarColor(predictedCount: number, errorPct: number): string {
  if (predictedCount === 0) return 'rgba(255,255,255,0.10)';
  if (errorPct < 10) return 'var(--severity-ok, #4ade80)';
  if (errorPct < 20) return 'var(--severity-medium, #facc15)';
  return 'var(--severity-critical, #ef4444)';
}

function renderBinRow(bin: CalibrationBin): string {
  const range = `${(bin.binMin * 100).toFixed(0)}–${(bin.binMax * 100).toFixed(0)}%`;
  const actual = bin.predictedCount === 0 ? '—' : `${Math.round((bin.correctCount / bin.predictedCount) * 100)}%`;
  const errorPct = Math.round(bin.calibrationError * 100);
  const color = binBarColor(bin.predictedCount, errorPct);
  const widthPct = bin.predictedCount === 0 ? 0 : Math.round((bin.correctCount / bin.predictedCount) * 100);
  return `<div style="display:flex;gap:6px;align-items:center;font-size:10px;margin-top:2px;">
    <span style="min-width:60px;color:var(--text-secondary,#bbb);font-family:ui-monospace,monospace;">${escapeHtml(range)}</span>
    <span style="min-width:40px;color:var(--text-secondary,#aaa);">n=${bin.predictedCount}</span>
    <div style="flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${widthPct}%;background:${color};"></div>
    </div>
    <span style="min-width:36px;text-align:right;font-weight:600;color:${color};">${escapeHtml(actual)}</span>
    <span style="min-width:48px;text-align:right;font-size:9px;color:var(--text-secondary,#aaa);">±${errorPct}%</span>
  </div>`;
}
