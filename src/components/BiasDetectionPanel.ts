/**
 * Bias Detection Panel (panel id: `bias-detection`).
 *
 * Surfaces the BiasDetectorService's active signals with a top-line
 * "overall bias risk" badge, dominant-bias label, and per-signal cards
 * with severity badge, time-ago, evidence, and an Acknowledge button.
 * A history tab lists previously-acknowledged signals.
 */

import { Panel } from './Panel';
import {
  getBiasDetectorService,
  computeOverallRisk,
  computeDominantBias,
  type BiasSignal,
  type BiasSeverity,
  type BiasType,
  type BiasRisk,
} from '@/services/intelligence/bias-detector';
import { escapeHtml } from '@/utils/sanitize';
import { dejargonProse, installEntityIdCopyHandler } from './ui/entityRef';

const REFRESH_MS = 30_000;

const SEVERITY_COLOR: Record<BiasSeverity, string> = {
  advisory: '#9ca3af',
  warning: '#f5a524',
  alert: '#e94f37',
};

const TYPE_LABEL: Record<BiasType, string> = {
  anchoring: 'Anchoring',
  availability: 'Availability',
  confirmation: 'Confirmation',
  recency: 'Recency drift',
  'domain-neglect': 'Domain neglect',
  overconfidence: 'Overconfidence',
};

const RISK_COLOR: Record<BiasRisk, string> = {
  low: '#2ec27e', medium: '#f5a524', high: '#e94f37',
};

type Tab = 'active' | 'history';

function renderEmptyState(tab: Tab): string {
  const msg = tab === 'active'
    ? 'No active bias signals — model output looks balanced.'
    : 'No acknowledged signals yet.';
  return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">${msg}</div>`;
}

function tabBtnHtml(key: Tab, activeKey: Tab, label: string, count: number): string {
  const isActive = activeKey === key;
  const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
  const borderAlpha = isActive ? '0.4' : '0.15';
  return `<button class="bd-tab" data-tab="${key}" type="button"
    style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:3px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
}

function renderAckOrButton(s: BiasSignal): string {
  if (!s.acknowledged) {
    return `<button class="bd-ack" data-id="${escapeHtml(s.id)}" type="button" style="padding:2px 8px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Acknowledge</button>`;
  }
  const when = s.acknowledgedAt ? ` ${ageLabel(s.acknowledgedAt, Date.now())}` : '';
  return `<span style="font-size:10px;opacity:0.55;">acknowledged${when}</span>`;
}

export class BiasDetectionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private tab: Tab = 'active';

  constructor() {
    super({
      id: 'bias-detection',
      title: 'Bias Detection',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Scans Crystal Ball\'s own output patterns for anchoring, availability, confirmation, recency drift, domain neglect, and overconfidence. Active signals come with a one-line recommendation and an acknowledge workflow.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsubscribe = getBiasDetectorService().subscribe(() => this.render());
    installEntityIdCopyHandler();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    super.destroy();
  }

  private render(): void {
    const svc = getBiasDetectorService();
    const active = svc.getActive();
    this.setCount(active.length);
    this.setContent(this.buildHtml(active, svc.getHistory()), () => this.wireHandlers());
  }

  private buildHtml(active: BiasSignal[], history: BiasSignal[]): string {
    const risk = computeOverallRisk(active);
    const dominant = computeDominantBias(active);
    const showing = this.tab === 'active'
      ? active
      : history.filter((s) => s.acknowledged)
        .sort((a, b) => (b.acknowledgedAt?.getTime() ?? 0) - (a.acknowledgedAt?.getTime() ?? 0));

    return `<div class="bd-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(risk, dominant)}
      ${this.renderTabs(active.length, history.filter((s) => s.acknowledged).length)}
      ${dominant && risk !== 'low' ? this.renderRecommendation(dominant) : ''}
      ${showing.length === 0
        ? renderEmptyState(this.tab)
        : `<div style="display:flex;flex-direction:column;gap:6px;">${showing.map((s) => this.renderRow(s)).join('')}</div>`}
    </div>`;
  }

  private renderHeader(risk: BiasRisk, dominant: BiasType | null): string {
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Bias risk</span>
        <span style="background:${RISK_COLOR[risk]};color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${risk}</span>
      </div>
      ${dominant
        ? `<span style="font-size:11px;opacity:0.75;">Dominant: <strong>${escapeHtml(TYPE_LABEL[dominant])}</strong></span>`
        : '<span style="font-size:11px;opacity:0.55;">No dominant bias</span>'}
    </div>`;
  }

  private renderTabs(activeCount: number, ackCount: number): string {
    return `<div style="display:flex;gap:4px;">${tabBtnHtml('active', this.tab, 'Active', activeCount)}${tabBtnHtml('history', this.tab, 'History', ackCount)}</div>`;
  }

  private renderRecommendation(dominant: BiasType): string {
    const tips: Record<BiasType, string> = {
      anchoring: 'Down-weight or re-run analysis without the first observation.',
      availability: 'Apply a recency discount to the dominant domain.',
      confirmation: 'Run the skeptic prompt to surface counter-evidence.',
      recency: 'Decay confidence on time alone; require fresh observations.',
      'domain-neglect': 'Either tighten weights or stop surfacing medium-and-higher alerts for the affected domain.',
      overconfidence: 'Recalibrate meta-confidence; trust its self-assessment less for now.',
    };
    return `<div style="padding:6px 10px;background:rgba(245,165,36,0.10);border-left:3px solid #f5a524;border-radius:2px;font-size:11px;color:#ddd;">
      <strong>Recommendation:</strong> ${escapeHtml(tips[dominant])}
    </div>`;
  }

  private renderRow(s: BiasSignal): string {
    const color = SEVERITY_COLOR[s.severity];
    const ts = ageLabel(s.detectedAt, Date.now());
    const ackBtn = renderAckOrButton(s);

    return `<div style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${s.severity}</span>
            <span style="font-weight:600;color:#ddd;">${escapeHtml(TYPE_LABEL[s.type])}</span>
            <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(s.domain)}</span>
            <span style="font-size:10px;opacity:0.55;">${ts}</span>
          </div>
          <div style="font-size:12px;color:#ddd;margin-top:3px;">${dejargonProse(s.description)}</div>
          <div style="font-size:11px;opacity:0.6;margin-top:2px;">${dejargonProse(s.evidence)}</div>
          <div style="font-size:11px;opacity:0.75;margin-top:2px;color:#9b59b6;">${escapeHtml(s.recommendation)}</div>
        </div>
        ${ackBtn}
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getBiasDetectorService();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.bd-tab')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t === 'active' || t === 'history') {
          this.tab = t;
          this.render();
        }
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.bd-ack')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id) svc.acknowledge(id);
      });
    }
  }
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
