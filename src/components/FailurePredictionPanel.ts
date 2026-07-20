/**
 * FailurePredictionPanel — surfaces the most recent FailurePrediction
 * batch. Shows a heat strip (critical/high/moderate counts), a top-10
 * risk table sorted by probability, and a Refresh button.
 *
 * The panel itself is read-only; the engine populates via predict()
 * calls from elsewhere in the app (typically the observation-ingest
 * pipeline) — Refresh re-renders the latest state.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  FailurePredictionEngine,
  getFailurePredictionEngine,
  type EscalationHorizon,
  type EscalationRisk,
} from '@/services/intelligence/failure-prediction';

const REFRESH_MS = 30_000;

type Band = 'critical' | 'high' | 'moderate' | 'low';

const BAND_COLOR: Record<Band, string> = {
  critical: 'var(--severity-critical, #ef4444)',
  high:     'var(--severity-high, #fb923c)',
  moderate: 'var(--severity-medium, #facc15)',
  low:      'var(--severity-ok, #4ade80)',
};

const HORIZON_LABEL: Record<EscalationHorizon, string> = {
  '1h':  '1h',
  '6h':  '6h',
  '24h': '24h',
};

function bandFor(p: number): Band {
  if (p > 0.8) return 'critical';
  if (p > 0.6) return 'high';
  if (p >= 0.3) return 'moderate';
  return 'low';
}

export class FailurePredictionPanel extends Panel {
  private readonly engine: FailurePredictionEngine;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'failure-prediction',
      title: 'Failure Prediction',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Predicted-escalation risks scored per observation. Higher probability + shorter horizon = more urgent.',
    });
    this.engine = getFailurePredictionEngine();
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
      const risks = [...this.engine.getAll()].sort((a, b) => b.probability - a.probability);
      const top = risks.slice(0, 10);
      const counts = countByBand(risks);
      this.setCount(counts.critical + counts.high);
      this.setContent(this.buildHtml(counts, top, risks.length), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Failure-prediction panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(counts: Record<Band, number>, top: readonly EscalationRisk[], totalCount: number): string {
    return `${renderHeatStrip(counts, totalCount)}${renderTable(top)}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const refresh = root.querySelector<HTMLButtonElement>('.fpp-refresh');
    refresh?.addEventListener('click', () => this.render());
  }
}

function countByBand(risks: readonly EscalationRisk[]): Record<Band, number> {
  const counts: Record<Band, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const r of risks) counts[bandFor(r.probability)]++;
  return counts;
}

function renderHeatStrip(counts: Record<Band, number>, totalCount: number): string {
  const cell = (band: Band, label: string): string => `
    <div style="flex:1;padding:8px 10px;text-align:center;background:${BAND_COLOR[band]};color:#fff;">
      <div style="font-size:18px;font-weight:700;line-height:1;">${counts[band]}</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;">${escapeHtml(label)}</div>
    </div>`;
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${totalCount} prediction${totalCount === 1 ? '' : 's'} tracked</span>
      <button class="fpp-refresh" style="font-size:11px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Refresh</button>
    </div>
    <div style="display:flex;gap:2px;border-radius:4px;overflow:hidden;">
      ${cell('critical', 'Critical')}
      ${cell('high', 'High')}
      ${cell('moderate', 'Moderate')}
      ${cell('low', 'Low')}
    </div>
  </div>`;
}

function renderTable(top: readonly EscalationRisk[]): string {
  if (top.length === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
      No predictions yet — the engine populates as observations are scored.
    </div>`;
  }
  const rows = top.map((r) => renderRow(r)).join('');
  return `<div style="max-height:420px;overflow:auto;">${rows}</div>`;
}

function renderRow(r: EscalationRisk): string {
  const band = bandFor(r.probability);
  const color = BAND_COLOR[band];
  const pct = Math.round(r.probability * 100);
  const escalationNote = r.currentSeverity === r.predictedSeverity
    ? ''
    : `<span style="color:${color};font-weight:600;">→ ${escapeHtml(r.predictedSeverity)}</span>`;
  const factors = r.factors.slice(0, 3).map((f) => escapeHtml(f)).join(' · ');
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${color};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(band)}</span>
      <span style="font-size:11px;font-weight:600;text-transform:capitalize;">${escapeHtml(r.domain)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(r.currentSeverity)} ${escalationNote}</span>
      <span style="margin-left:auto;font-size:10px;font-weight:600;color:var(--text-secondary,#ccc);">${escapeHtml(HORIZON_LABEL[r.horizon])}</span>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
      <div style="flex:1;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};"></div>
      </div>
      <span style="font-size:11px;font-weight:700;color:${color};min-width:36px;text-align:right;">${pct}%</span>
    </div>
    <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#aaa);font-style:italic;">${factors}</div>
    <div style="margin-top:2px;font-size:9px;color:var(--text-secondary,#666);">${escapeHtml(r.observationId)}</div>
  </div>`;
}
