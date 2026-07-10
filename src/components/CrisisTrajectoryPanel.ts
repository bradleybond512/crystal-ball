/**
 * Crisis Trajectory Panel (panel id: `crisis-trajectory`).
 *
 * Per-situation 6h / 24h / 72h projections. Each card shows the basis
 * (signature-matched / recovery-model / extrapolation / historical-
 * average), current severity, three horizon bars with confidence
 * decay, worst-case time, and expected resolution time.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getCrisisTrajectoryProjector,
  type CrisisTrajectory,
  type ProjectionBasis,
  type TrajectoryPoint,
} from '@/services/intelligence/crisis-trajectory';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const BASIS_LABEL: Record<ProjectionBasis, string> = {
  'signature-matched': 'Signature',
  'recovery-model': 'Recovery model',
  'extrapolation': 'Extrapolation',
  'historical-average': 'Historical avg',
};
const BASIS_COLOR: Record<ProjectionBasis, string> = {
  'signature-matched': '#a626a4',
  'recovery-model': '#4a9eff',
  'extrapolation': '#f5a524',
  'historical-average': '#9ca3af',
};

const SEVERITY_COLOR = ['#9ca3af', '#9ca3af', '#f5a524', '#e94f37', '#a626a4'];

export class CrisisTrajectoryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((trajectories: CrisisTrajectory[]) => void) | null = null;

  constructor() {
    super({
      id: 'crisis-trajectory',
      title: 'Crisis Trajectory',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '6h / 24h / 72h severity projections per active Situation. Uses crisis signatures, recovery models, observation extrapolation, or historical-average fallback.',
    });
    const svc = getCrisisTrajectoryProjector();
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
      getCrisisTrajectoryProjector().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getCrisisTrajectoryProjector();
    const trajectories = svc.getActiveTrajectories();
    this.setCount(trajectories.length);
    this.setContent(this.buildHtml(trajectories));
  }

  private buildHtml(trajectories: CrisisTrajectory[]): string {
    if (trajectories.length === 0) {
      return `<div class="ct-panel" style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No active trajectories — call project(situation, observations) to record one.</div>`;
    }
    const sorted = [...trajectories].sort(
      (a, b) => b.currentSeverityNum - a.currentSeverityNum
        || b.generatedAt - a.generatedAt,
    );
    return `<div class="ct-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${sorted.map((t) => this.renderCard(t)).join('')}
    </div>`;
  }

  private renderCard(t: CrisisTrajectory): string {
    const basisColor = BASIS_COLOR[t.projectionBasis];
    const basisLabel = BASIS_LABEL[t.projectionBasis];
    const currentColor = SEVERITY_COLOR[Math.round(t.currentSeverityNum)] ?? '#9ca3af';
    const worst = t.worstCaseAt
      ? `worst at ${formatRelative(t.worstCaseAt, Date.now())}` : 'worst at —';
    const resolution = t.expectedResolutionAt
      ? `resolves ${formatRelative(t.expectedResolutionAt, Date.now())}` : 'no resolution projected';
    const sigChip = t.matchedSignatureId
      ? `<span style="font-size:9px;opacity:0.6;font-family:ui-monospace,monospace;">${escapeHtml(t.matchedSignatureId)}</span>` : '';

    return `<div style="border-left:3px solid ${basisColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="background:${basisColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(basisLabel)}</span>
          <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(t.domain)}</span>
          <span style="font-size:11px;color:#ddd;">${escapeHtml(t.situationId)}</span>
          ${sigChip}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;opacity:0.55;text-transform:uppercase;letter-spacing:0.04em;">now</span>
          <span style="background:${currentColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(severityLabel(t.currentSeverityNum))}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-top:6px;">
        ${t.trajectoryPoints.map((p) => this.renderHorizon(p)).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.65;margin-top:4px;">
        <span>${escapeHtml(worst)}</span>
        <span>${escapeHtml(resolution)}</span>
      </div>
    </div>`;
  }

  private renderHorizon(p: TrajectoryPoint): string {
    const color = SEVERITY_COLOR[Math.round(p.projectedSeverityNum)] ?? '#9ca3af';
    return `<div style="display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#bbb;">
        <span>+${p.hoursFromNow}h</span>
        <span style="opacity:0.65;">conf ${(p.confidence * 100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(p.projectedSeverityLabel)}</span>
        <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${(p.confidence * 100).toFixed(0)}%;height:100%;background:${color};opacity:0.7;"></div>
        </div>
      </div>
    </div>`;
  }
}

function severityLabel(severityNum: number): string {
  const rounded = Math.max(0, Math.min(4, Math.round(severityNum)));
  return ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][rounded] ?? 'INFO';
}

function formatRelative(ts: number, now: number): string {
  const ms = ts - now;
  if (Math.abs(ms) < 60_000) return 'now';
  const direction = ms >= 0 ? 'in' : 'ago';
  const abs = Math.abs(ms);
  if (abs < 60 * 60_000) return `${direction} ${Math.round(abs / 60_000)}m`;
  if (abs < 24 * 60 * 60_000) return `${direction} ${Math.round(abs / (60 * 60_000))}h`;
  return `${direction} ${Math.round(abs / (24 * 60 * 60_000))}d`;
}
