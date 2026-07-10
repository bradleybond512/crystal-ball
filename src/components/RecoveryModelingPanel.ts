/**
 * Recovery Modeling Panel (panel id: `recovery-modeling`).
 *
 * Lists active recovery profiles with phase badge, severity-vs-peak
 * progress bar, recovery rate, estimated resolution time. A second tab
 * shows recently-completed profiles, and a domain filter narrows both.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getRecoveryModelingEngine,
  type RecoveryPhase,
  type RecoveryProfile,
} from '@/services/intelligence/recovery-modeling';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const HISTORY_LIMIT = 20;

const PHASE_LABEL: Record<RecoveryPhase, string> = {
  acute: 'Acute',
  stabilizing: 'Stabilizing',
  recovering: 'Recovering',
  resolved: 'Resolved',
};

const PHASE_COLOR: Record<RecoveryPhase, string> = {
  acute: '#e94f37',
  stabilizing: '#f5a524',
  recovering: '#4a9eff',
  resolved: '#2ec27e',
};

const PHASE_PROGRESS: Record<RecoveryPhase, number> = {
  acute: 15,
  stabilizing: 45,
  recovering: 75,
  resolved: 100,
};

type Tab = 'active' | 'history';

interface PanelState {
  tab: Tab;
  domainFilter: string;
}

export class RecoveryModelingPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((profiles: RecoveryProfile[]) => void) | null = null;
  private state: PanelState = { tab: 'active', domainFilter: 'all' };

  constructor() {
    super({
      id: 'recovery-modeling',
      title: 'Recovery Modeling',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks post-event recovery curves per region/domain. Linear regression on the last 5 data points estimates the rate of improvement and projects resolution time.',
    });
    const svc = getRecoveryModelingEngine();
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
      getRecoveryModelingEngine().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getRecoveryModelingEngine();
    const active = svc.getActiveProfiles();
    const completed = svc.getCompletedProfiles(HISTORY_LIMIT);
    this.setCount(active.length);
    this.setContent(this.buildHtml(active, completed), () => this.wireHandlers());
  }

  private buildHtml(active: RecoveryProfile[], completed: RecoveryProfile[]): string {
    const showing = this.state.tab === 'active' ? active : completed;
    const filtered = this.state.domainFilter === 'all'
      ? showing
      : showing.filter((p) => p.domain === this.state.domainFilter);
    const domains = uniqueDomains([...active, ...completed]);

    return `<div class="rm-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(active.length, completed.length, domains)}
      ${this.renderTabs(active.length, completed.length)}
      ${filtered.length === 0
        ? renderEmptyState(this.state.tab)
        : `<div style="display:flex;flex-direction:column;gap:6px;">${filtered.map((p) => this.renderRow(p)).join('')}</div>`}
    </div>`;
  }

  private renderHeader(activeCount: number, completedCount: number, domains: string[]): string {
    const options = ['all', ...domains].map((d) =>
      `<option value="${escapeHtml(d)}"${d === this.state.domainFilter ? ' selected' : ''}>${escapeHtml(d === 'all' ? 'All domains' : d)}</option>`,
    ).join('');
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#bbb;">
        <span><strong style="color:#4a9eff;">${activeCount}</strong> active</span>
        <span><strong>${completedCount}</strong> resolved</span>
      </div>
      <select class="rm-domain" style="background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:3px 6px;font-size:11px;">${options}</select>
    </div>`;
  }

  private renderTabs(activeCount: number, completedCount: number): string {
    return `<div style="display:flex;gap:4px;">
      ${tabBtnHtml('active', this.state.tab, 'Active', activeCount)}
      ${tabBtnHtml('history', this.state.tab, 'Resolved', completedCount)}
    </div>`;
  }

  private renderRow(p: RecoveryProfile): string {
    const color = PHASE_COLOR[p.phase];
    const progress = PHASE_PROGRESS[p.phase];
    const elapsed = formatHours((Date.now() - p.startedAt) / 3_600_000);
    const rate = p.recoveryRate.toFixed(2);
    const eta = p.estimatedResolutionAt
      ? `in ${formatHours((p.estimatedResolutionAt - Date.now()) / 3_600_000)}`
      : '—';
    return `<div style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(PHASE_LABEL[p.phase])}</span>
          <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(p.domain)}</span>
          <span style="font-size:11px;color:#ddd;">${escapeHtml(p.region)}</span>
        </div>
        <span style="font-size:10px;opacity:0.55;font-family:ui-monospace,monospace;">peak ${escapeHtml(p.peakSeverity)} · ${p.dataPoints.length} pts · ${elapsed} elapsed</span>
      </div>
      <div style="margin-top:5px;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
        <div style="width:${progress}%;height:100%;background:${color};"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.65;margin-top:3px;">
        <span>rate ${rate}/h</span>
        <span>resolution ${escapeHtml(eta)}</span>
        <span>budget ${p.expectedDurationHours}h</span>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.rm-tab')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t === 'active' || t === 'history') {
          this.state.tab = t;
          this.render();
        }
      });
    }

    const sel = root.querySelector<HTMLSelectElement>('.rm-domain');
    sel?.addEventListener('change', () => {
      this.state.domainFilter = sel.value;
      this.render();
    });
  }
}

function tabBtnHtml(key: Tab, activeKey: Tab, label: string, count: number): string {
  const isActive = activeKey === key;
  const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
  const borderAlpha = isActive ? '0.4' : '0.15';
  return `<button class="rm-tab" data-tab="${key}" type="button"
    style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:3px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
}

function renderEmptyState(tab: Tab): string {
  const msg = tab === 'active'
    ? 'No active recovery profiles — no Situations are currently being tracked.'
    : 'No resolved recovery profiles yet.';
  return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">${msg}</div>`;
}

function uniqueDomains(profiles: readonly RecoveryProfile[]): string[] {
  return [...new Set(profiles.map((p) => p.domain))].sort((a, b) => a.localeCompare(b));
}

function formatHours(h: number): string {
  if (!Number.isFinite(h)) return '—';
  const abs = Math.abs(h);
  if (abs < 1) return `${Math.round(abs * 60)}m`;
  if (abs < 24) return `${abs.toFixed(1)}h`;
  return `${(abs / 24).toFixed(1)}d`;
}
