/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Threat Horizon Panel — Phase 4 24/48/72 h forward view.
 *
 * Horizon tabs at top, threats sorted by probability per horizon with
 * probability bar, basis chips, early-warning signals list, recommended
 * actions, and dismiss / escalate buttons. Shows an "All clear" empty
 * state when the selected horizon has no live threats.
 */

import { Panel } from './Panel';
import {
  getThreatHorizonScanner,
  type HorizonThreat,
  type ThreatBasis,
  type ThreatHorizon,
  type ThreatStatus,
} from '@/services/intelligence/threat-horizon';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const HORIZONS: ThreatHorizon[] = ['24h', '48h', '72h'];

const BASIS_LABEL: Record<ThreatBasis, string> = {
  'failure-prediction': 'failure prediction',
  'global-rhythm': 'rhythm anomaly',
  'crisis-trajectory': 'trajectory',
  'crisis-signature': 'pattern match',
};

const STATUS_COLOR: Record<ThreatStatus, string> = {
  watching: '#ffb74d',
  escalating: '#ff453a',
  dismissed: '#9e9e9e',
};

interface PanelState {
  horizon: ThreatHorizon;
}

export class ThreatHorizonPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = { horizon: '24h' };

  constructor() {
    super({
      id: 'threat-horizon',
      title: 'Threat Horizon',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 forward scan. Fuses failure-prediction risks, rhythm anomalies, trajectory projections, and crisis-signature matches into a single 24 h / 48 h / 72 h horizon view. Dedup by (domain, region, horizon). Operator-applied dismiss / escalate states survive subsequent scans.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getThreatHorizonScanner().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const scanner = getThreatHorizonScanner();
    const threats = scanner.getByHorizon(this.state.horizon);
    const active = threats.filter((t) => t.status !== 'dismissed');
    this.setCount(active.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${this.renderTabs(scanner)}
      ${renderThreatList(active)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderTabs(scanner: ReturnType<typeof getThreatHorizonScanner>): string {
    const tabs = HORIZONS.map((h) => {
      const count = scanner.getByHorizon(h).filter((t) => t.status !== 'dismissed').length;
      const active = this.state.horizon === h;
      const bg = active ? 'var(--accent,#4a9eff)26' : 'transparent';
      const border = active ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
      return `<button data-horizon-tab="${h}" style="padding:6px 12px;font-size:12px;border:1px solid ${border};border-radius:3px;background:${bg};color:inherit;cursor:pointer;display:flex;align-items:center;gap:6px;">
        <span style="font-weight:600;">${h}</span>
        <span style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--surface-2,#1a1a1a);">${count}</span>
      </button>`;
    }).join('');
    return `<div style="display:flex;gap:8px;align-items:center;">${tabs}</div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      root.querySelectorAll<HTMLButtonElement>('[data-horizon-tab]').forEach((el) => {
        el.addEventListener('click', () => {
          const v = el.dataset.horizonTab as ThreatHorizon | undefined;
          if (v) {
            this.state.horizon = v;
            this.render();
          }
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-threat-dismiss]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.threatDismiss;
          if (id) getThreatHorizonScanner().dismiss(id, 'operator dismissed');
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-threat-escalate]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.threatEscalate;
          if (id) getThreatHorizonScanner().markEscalating(id);
        });
      });
    }, 0);
  }
}

function renderThreatList(threats: readonly HorizonThreat[]): string {
  if (threats.length === 0) {
    return `<div style="padding:24px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">
      <div style="font-size:14px;font-weight:600;color:#4caf50;">ALL CLEAR</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">No emerging threats on this horizon.</div>
    </div>`;
  }
  const items = threats.map((t) => renderThreatRow(t)).join('');
  return `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;">${items}</ul>`;
}

function renderThreatRow(t: HorizonThreat): string {
  const statusColor = STATUS_COLOR[t.status];
  const probPct = Math.min(100, Math.max(0, t.probability * 100));
  const basisChips = t.basis.map((b) =>
    `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--surface-3,#222);color:var(--text-secondary,#aaa);">${escapeHtml(BASIS_LABEL[b])}</span>`,
  ).join(' ');
  const warningItems = t.earlyWarningSignals.slice(0, 5).map((s) =>
    `<li style="font-size:11px;line-height:1.5;">${escapeHtml(s)}</li>`,
  ).join('');
  const actionItems = t.recommendedActions.map((a) =>
    `<li style="font-size:11px;line-height:1.5;color:var(--text-primary,#fff);">${escapeHtml(a)}</li>`,
  ).join('');
  return `<li style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${statusColor};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:10px;display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="font-size:10px;font-weight:700;letter-spacing:0.05em;padding:2px 6px;border-radius:3px;background:${statusColor}26;color:${statusColor};text-transform:uppercase;">${t.status}</span>
      <span style="font-weight:600;flex:1;">${escapeHtml(t.domain)} · ${escapeHtml(t.region)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(t.currentSeverity)} → ${escapeHtml(t.projectedSeverity)}</span>
    </div>
    <div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:8px;background:var(--surface-3,#222);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${probPct.toFixed(1)}%;background:${statusColor};"></div>
        </div>
        <span style="font-size:11px;font-family:ui-monospace,monospace;width:42px;text-align:right;">${probPct.toFixed(0)}%</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">${basisChips}</div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Early warning signals</div>
      <ul style="margin:0;padding-left:18px;">${warningItems}</ul>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">Recommended actions</div>
      <ul style="margin:0;padding-left:18px;">${actionItems}</ul>
    </div>
    <div style="display:flex;gap:8px;">
      <button data-threat-escalate="${escapeHtml(t.id)}" style="padding:4px 10px;font-size:11px;background:#ff453a26;color:#ff453a;border:1px solid #ff453a55;border-radius:3px;cursor:pointer;">Escalate</button>
      <button data-threat-dismiss="${escapeHtml(t.id)}" style="padding:4px 10px;font-size:11px;background:transparent;color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Dismiss</button>
    </div>
  </li>`;
}
