/**
 * BehavioralResponsePanel — surfaces active behavioral-response
 * profiles with 5-phase timeline bars, stress/mobilization gauges,
 * and the model's most-resilient regions ranking.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getBehavioralResponseModel,
  type BehavioralProfile,
  type ResponsePhase,
  type BehavioralResponseModel,
} from '@/services/intelligence/behavioral-response';

const REFRESH_MS = 30_000;

const PHASE_ORDER: ResponsePhase[] = ['shock', 'mobilization', 'adaptation', 'normalization', 'resilience'];

const PHASE_COLOR: Record<ResponsePhase, string> = {
  shock:         'var(--severity-critical, #ef4444)',
  mobilization:  'var(--severity-high, #fb923c)',
  adaptation:    'var(--severity-medium, #facc15)',
  normalization: 'var(--severity-info, #60a5fa)',
  resilience:    'var(--severity-ok, #4ade80)',
};

const PHASE_LABEL: Record<ResponsePhase, string> = {
  shock:         'Shock',
  mobilization:  'Mobilization',
  adaptation:    'Adaptation',
  normalization: 'Normalization',
  resilience:    'Resilience',
};

export class BehavioralResponsePanel extends Panel {
  private readonly model: BehavioralResponseModel;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'behavioral-response',
      title: 'Behavioral Response',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks the 5-phase response curve (shock → mobilization → adaptation → normalization → resilience) per region and domain. Driven by observation severity + cadence.',
    });
    this.model = getBehavioralResponseModel();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.model.subscribe(() => this.render());
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
      const active = this.model.getActiveProfiles();
      const all = this.model.getProfiles();
      const stats = this.model.stats();
      this.setCount(active.length);
      this.setContent(this.buildHtml(active, all, stats));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Behavioral-response panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    active: readonly BehavioralProfile[],
    all: readonly BehavioralProfile[],
    stats: ReturnType<BehavioralResponseModel['stats']>,
  ): string {
    const header = `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Active profiles</span>
      <span style="font-size:14px;font-weight:700;">${active.length}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${all.length} tracked total</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">avg shock duration ${stats.avgShockDurationHours.toFixed(1)}h</span>
    </div>`;

    const profilesHtml = active.length === 0
      ? renderEmptyState(all.length)
      : `<div style="max-height:380px;overflow:auto;">${active.map((p) => renderProfile(p)).join('')}</div>`;

    return `${header}${profilesHtml}${renderResilientRegions(stats.mostResilientRegions)}`;
  }
}

function renderEmptyState(totalTracked: number): string {
  if (totalTracked === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
      No behavioral profiles yet. The model populates as observations stream in.
    </div>`;
  }
  return `<div style="padding:18px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
    All ${totalTracked} tracked profile${totalTracked === 1 ? '' : 's'} have reached normalization or resilience.
  </div>`;
}

function renderProfile(profile: BehavioralProfile): string {
  const phaseColor = PHASE_COLOR[profile.phase];
  const stressPct = Math.round(profile.stressScore * 100);
  const mobPct = Math.round(profile.mobilizationScore * 100);
  const adapt = (profile.adaptationRate * 100).toFixed(3);
  const etaLabel = profile.estimatedNormalizationAt
    ? new Date(profile.estimatedNormalizationAt).toISOString().slice(0, 10)
    : '—';
  return `<div style="padding:12px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${phaseColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(PHASE_LABEL[profile.phase])}</span>
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(profile.domain)}</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(profile.region)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">est. normalize ${escapeHtml(etaLabel)}</span>
    </div>
    ${renderPhaseTimeline(profile.phase)}
    <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:10px;">
      ${renderGauge('Stress', stressPct, 'var(--severity-critical, #ef4444)')}
      ${renderGauge('Mobilization', mobPct, 'var(--severity-high, #fb923c)')}
      ${renderGauge('Adaptation rate', Math.min(100, Math.round(profile.adaptationRate * 100 * 10)), 'var(--severity-ok, #4ade80)', `${adapt}/h`)}
    </div>
    <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">${profile.dataPoints.length} data points · event <code>${escapeHtml(profile.eventId)}</code></div>
  </div>`;
}

function renderPhaseTimeline(currentPhase: ResponsePhase): string {
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const cells = PHASE_ORDER.map((phase, idx) => {
    const isPast = idx < currentIdx;
    const isCurrent = idx === currentIdx;
    const color = isCurrent || isPast ? PHASE_COLOR[phase] : 'rgba(255,255,255,0.06)';
    const textColor = isCurrent || isPast ? '#fff' : 'var(--text-secondary,#aaa)';
    const fontWeight = isCurrent ? '700' : '500';
    return `<div style="flex:1;padding:4px 4px;text-align:center;background:${color};color:${textColor};font-size:9px;font-weight:${fontWeight};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(PHASE_LABEL[phase])}</div>`;
  }).join('');
  return `<div style="margin-top:8px;display:flex;gap:1px;border-radius:3px;overflow:hidden;">${cells}</div>`;
}

function renderGauge(label: string, pct: number, color: string, valueOverride?: string): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const displayValue = valueOverride ?? `${clamped}%`;
  return `<div>
    <div style="display:flex;justify-content:space-between;color:var(--text-secondary,#aaa);">
      <span>${escapeHtml(label)}</span>
      <span style="color:var(--text-primary,#ddd);font-weight:600;">${escapeHtml(displayValue)}</span>
    </div>
    <div style="margin-top:2px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${clamped}%;background:${color};"></div>
    </div>
  </div>`;
}

function renderResilientRegions(regions: { region: string; adaptationRate: number }[]): string {
  if (regions.length === 0) {
    return `<div style="padding:8px 12px;border-top:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.02);font-size:10px;color:var(--text-secondary,#888);">
      No resilient regions ranked yet — adaptation rate emerges in adaptation phase.
    </div>`;
  }
  const items = regions.map((r) => `<li><strong>${escapeHtml(r.region)}</strong> · rate ${r.adaptationRate.toFixed(3)}/h</li>`).join('');
  return `<div style="padding:8px 12px;border-top:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.02);">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Most resilient regions</div>
    <ul style="margin:0;padding:0 0 0 16px;font-size:11px;line-height:1.5;">${items}</ul>
  </div>`;
}
