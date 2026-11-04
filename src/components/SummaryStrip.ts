/**
 * SummaryStrip — slim one-line "at a glance" row docked above the panels
 * grid (below the banner stack; the scroll container's
 * --notification-stack-h padding keeps it clear of fixed banners, and
 * position:sticky; top:0 pins it at that padding edge while the grid scrolls).
 *
 * Content comes from EXISTING stores only:
 *   - composite status chip — the EEW status bar's derived state
 *     (worst-of EEW / Safety Case / readiness), injected by panel-layout
 *     via EEWStatusBar.subscribeState so both surfaces always agree
 *   - unacknowledged triage counts by severity (unifiedAlertStore)
 *   - global data freshness — worst + median source age (dataFreshness)
 *   - active regime-shift count (regime-monitor; empty when the BOCPD
 *     kill-switch is off, so the segment self-gates)
 *
 * Every segment clicks through to its owning surface (delegated handler).
 * Collapsible via a chevron persisted in localStorage; a settings toggle
 * (Settings → General → Overview) can remove it entirely.
 */

import { criticalAnnouncementsSuppressed, watchCriticalAnnouncementSuppression } from '@/utils/critical-ui-announcements';
import { escapeHtml } from '@/utils/sanitize';
import { icon } from './ui/icons';
import { unifiedAlertStore, type AlertSeverity } from '@/services/unified-alerts';
import { dataFreshness } from '@/services/data-freshness';
import { getActiveRegimeShifts, REGIME_SHIFT_EVENT } from '@/services/cognition/regime-monitor';
import { formatDurationMinutes } from '@/utils/format-duration';
import type { StatusBarState } from '@/services/seismic/eew-status-bar-helpers';

// ── Feature flag (Settings → General → Overview) ────────────────────────

const ENABLED_KEY = 'crystalball-summary-strip-enabled';
const COLLAPSED_KEY = 'crystalball-summary-strip-collapsed';
export const SUMMARY_STRIP_TOGGLE_EVENT = 'cb:summary-strip-toggled';

/** Default ON; only an explicit '0' disables. Fail-safe on storage errors. */
export function isSummaryStripEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSummaryStripEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch { /* private-mode storage — the event still updates this session */ }
  try {
    document.dispatchEvent(new CustomEvent(SUMMARY_STRIP_TOGGLE_EVENT, { detail: { enabled } }));
  } catch { /* non-browser */ }
}

// ── Component ───────────────────────────────────────────────────────────

export interface SummaryStripDeps {
  /** Subscribe to the EEW status bar's derived composite state. */
  subscribeStatus: (cb: (state: StatusBarState) => void) => () => void;
  /** Status chip → Safety Case panel. */
  onStatusClick: () => void;
  /** Alert counts → alert triage/ack surface. */
  onAlertsClick: () => void;
  /** Freshness → Settings → System Status. */
  onFreshnessClick: () => void;
  /** Regime shifts → Analyst HUD. */
  onRegimeClick: () => void;
}

const REFRESH_MS = 30_000;

/** StatusBarColor → severity token (chip dot + label tint). */
const STATUS_COLOR_TOKEN: Record<StatusBarState['color'], string> = {
  gray: 'var(--sev-low, #22c55e)',
  blue: 'var(--sev-info, #60a5fa)',
  yellow: 'var(--sev-moderate, #facc15)',
  orange: 'var(--sev-elevated, #fb923c)',
  red: 'var(--sev-high, #ef4444)',
  crimson: 'var(--sev-critical, #ff453a)',
};

const ALERT_SEV_TOKEN: Partial<Record<AlertSeverity, string>> = {
  critical: 'var(--sev-critical, #ff453a)',
  high: 'var(--sev-high, #ef4444)',
  medium: 'var(--sev-moderate, #facc15)',
};

function capCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export class SummaryStrip {
  private readonly el: HTMLElement;
  private readonly segsEl: HTMLElement;
  private readonly live: HTMLElement;
  private readonly stopWatchingSuppression: () => void;
  private previousTriage?: string;
  private readonly bodies = new WeakMap<HTMLButtonElement, string>();
  private enabled = isSummaryStripEnabled();
  private collapsed: boolean;
  private status: StatusBarState | null = null;
  private unsubStatus: (() => void) | null = null;
  private unsubAlerts: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onRegimeEvent = (): void => this.renderSegments();
  private readonly rebaseline = (): void => {
    this.previousTriage = undefined;
    if (this.live.textContent) this.live.textContent = '';
    this.renderSegments();
  };

  private readonly onToggleEvent = (event: Event): void => {
    this.enabled = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled ?? isSummaryStripEnabled();
    this.applyEnabled();
    this.rebaseline();
  };

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== ENABLED_KEY && event.key !== COLLAPSED_KEY) return;
    this.enabled = isSummaryStripEnabled();
    this.collapsed = this.readCollapsed();
    this.applyEnabled();
    this.applyCollapsed();
    this.rebaseline();
  };

  constructor(private readonly deps: SummaryStripDeps) {
    this.collapsed = this.readCollapsed();
    this.el = document.createElement('div');
    this.el.className = 'cb-summary-strip';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'At a glance summary');
    this.segsEl = document.createElement('div');
    this.segsEl.className = 'cb-summary-strip-segs';
    this.segsEl.innerHTML = `
      <button type="button" class="cb-summary-strip-seg" data-seg="status" title="System status — open Safety Case"></button>
      <button type="button" class="cb-summary-strip-seg" data-seg="alerts" aria-description="Open Alert Inbox."></button>
      <button type="button" class="cb-summary-strip-seg" data-seg="fresh" aria-description="Open System Status."></button>
      <button type="button" class="cb-summary-strip-seg" data-seg="regime"></button>`;
    this.live = document.createElement('span');
    this.live.className = 'critical-ui-announcer';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'cb-summary-strip-chevron';
    chevron.dataset.seg = 'chevron';
    chevron.innerHTML = icon('chevron-down', { size: 12 });
    this.el.append(this.segsEl, chevron, this.live);

    // One delegated listener for every segment + the chevron.
    this.el.addEventListener('click', this.onClick);

    this.stopWatchingSuppression = watchCriticalAnnouncementSuppression(this.rebaseline);
    this.unsubStatus = deps.subscribeStatus((state) => {
      this.status = state;
      this.renderSegments();
    });
    this.unsubAlerts = unifiedAlertStore.subscribe(() => this.renderSegments());
    this.refreshTimer = setInterval(() => this.renderSegments(), REFRESH_MS);
    document.addEventListener(REGIME_SHIFT_EVENT, this.onRegimeEvent);
    document.addEventListener(SUMMARY_STRIP_TOGGLE_EVENT, this.onToggleEvent);
    window.addEventListener('storage', this.onStorage);

    this.applyEnabled();
    this.applyCollapsed();
    this.renderSegments();
  }

  public getElement(): HTMLElement {
    return this.el;
  }

  public destroy(): void {
    this.stopWatchingSuppression();
    this.unsubStatus?.();
    this.unsubStatus = null;
    this.unsubAlerts?.();
    this.unsubAlerts = null;
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    document.removeEventListener(REGIME_SHIFT_EVENT, this.onRegimeEvent);
    document.removeEventListener(SUMMARY_STRIP_TOGGLE_EVENT, this.onToggleEvent);
    window.removeEventListener('storage', this.onStorage);
    this.el.removeEventListener('click', this.onClick);
    this.el.remove();
  }

  // ── State ─────────────────────────────────────────────────────────────

  private readCollapsed(): boolean {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private applyEnabled(): void {
    this.el.style.display = this.enabled ? '' : 'none';
  }

  private applyCollapsed(): void {
    this.el.classList.toggle('is-collapsed', this.collapsed);
    if (this.collapsed) {
      for (const segment of this.segsEl.querySelectorAll<HTMLButtonElement>('button:not([data-seg="status"])')) {
        this.setSegmentDisplay(segment, 'none', 'chevron');
      }
    }
    const chevron = this.el.querySelector<HTMLElement>('.cb-summary-strip-chevron');
    if (chevron) {
      chevron.setAttribute('aria-expanded', String(!this.collapsed));
      chevron.setAttribute('aria-label', this.collapsed ? 'Expand summary strip' : 'Collapse summary strip');
      chevron.title = this.collapsed ? 'Expand' : 'Collapse';
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private renderSegments(): void {
    if (!this.enabled) return;
    this.renderStatus();
    if (this.collapsed) return;
    this.renderAlerts();
    this.renderFreshness();
    this.renderRegime();
  }

  private setSegmentDisplay(button: HTMLButtonElement, display: string, fallback: 'fresh' | 'chevron'): void {
    if (button.style.display === display) return;
    if (display === 'none' && button.matches(':focus')) {
      this.el.querySelector<HTMLButtonElement>(`[data-seg="${fallback}"]`)?.focus({ preventScroll: true });
    }
    button.style.display = display;
  }

  private updateSegment(key: string, body: string, title: string, attr: 'aria-label' | 'aria-description', name: string): void {
    const button = this.segsEl.querySelector<HTMLButtonElement>(`[data-seg="${key}"]`)!;
    const display = body ? '' : 'none';
    this.setSegmentDisplay(button, display, 'fresh');
    if (this.bodies.get(button) !== body) {
      button.innerHTML = body;
      this.bodies.set(button, body);
    }
    if (button.title !== title) button.title = title;
    if (button.getAttribute(attr) !== name) button.setAttribute(attr, name);
  }

  private renderStatus(): void {
    const state = this.status;
    const color = STATUS_COLOR_TOKEN[state?.color ?? 'gray'];
    // Before the first derived state arrives, stay non-committal ("—") rather
    // than asserting "ALL CLEAR" — the chip must never claim safety it hasn't
    // yet evaluated. Once state exists, the composite label (incl. weather) wins.
    const label = state?.label ?? '—';
    const dot = `<span class="cb-summary-strip-dot" style="background:${color};" aria-hidden="true"></span>`;
    const text = this.collapsed ? '' : `<span class="cb-summary-strip-status" style="color:${color};">${escapeHtml(label)}</span>`;
    this.updateSegment('status', dot + text, 'System status — open Safety Case', 'aria-label', `System status: ${label}. Open Safety Case panel.`);
  }

  private renderAlerts(): void {
    const counts = { critical: 0, high: 0, medium: 0 };
    let total = 0;
    for (const alert of unifiedAlertStore.getAll()) {
      if (alert.acknowledged) continue;
      total++;
      if (alert.severity === 'critical' || alert.severity === 'high' || alert.severity === 'medium') counts[alert.severity]++;
    }
    const parts: string[] = [];
    const triage: string[] = [];
    for (const severity of ['critical', 'high', 'medium'] as const) {
      const count = capCount(counts[severity]);
      triage.push(`${count} ${severity}`);
      if (counts[severity]) {
        const short = severity === 'medium' ? 'med' : severity.slice(0, 4);
        parts.push(`<strong class="cb-stat-value" style="color:${ALERT_SEV_TOKEN[severity]};">${count}</strong> ${short}`);
      }
    }
    const empty = total ? 'no critical, high or medium alerts' : 'no open alerts';
    const body = parts.length ? parts.join('<span class="cb-stat-sep" aria-hidden="true">·</span>')
      : `<span class="cb-summary-strip-muted">${empty}</span>`;
    this.updateSegment('alerts', body, `${total} unacknowledged alerts — open Alert Inbox`, 'aria-description', `${total} unacknowledged alerts. Open Alert Inbox.`);

    this.announceTriage('Unacknowledged alerts: ' + triage.join(', ') + '.');
  }

  private announceTriage(message: string): void {
    if (criticalAnnouncementsSuppressed()) {
      if (this.live.textContent) this.live.textContent = '';
      this.previousTriage = undefined;
    } else {
      if (this.previousTriage !== undefined && message !== this.previousTriage && this.el.isConnected) this.live.textContent = message;
      this.previousTriage = message;
    }
  }

  private renderFreshness(): void {
    let body = '<span class="cb-summary-strip-muted">no data yet</span>';
    let detail = 'Data freshness — open System Status';
    try {
      const ages = dataFreshness.getAllSources()
        .filter((s) => s.enabled && s.lastUpdate !== null)
        .map((s) => Date.now() - (s.lastUpdate as Date).getTime())
        .sort((a, b) => a - b);
      if (ages.length > 0) {
        const worst = formatDurationMinutes((ages[ages.length - 1] ?? 0) / 60_000);
        const median = formatDurationMinutes((ages[Math.floor(ages.length / 2)] ?? 0) / 60_000);
        body = `data <strong class="cb-stat-value">${escapeHtml(median)}</strong> median` +
          '<span class="cb-stat-sep" aria-hidden="true">·</span>' +
          `<strong class="cb-stat-value">${escapeHtml(worst)}</strong> worst`;
        detail = `Data freshness across ${ages.length} sources — median ${median}, worst ${worst}. Open System Status.`;
      }
    } catch { /* freshness registry unavailable — keep the muted fallback */ }
    this.updateSegment('fresh', body, detail, 'aria-description', detail);
  }

  private renderRegime(): void {
    let count = 0;
    try {
      // Empty when the BOCPD kill-switch is off — segment self-gates.
      count = Object.keys(getActiveRegimeShifts()).length;
    } catch {
      count = 0;
    }
    const label = count === 1 ? 'regime shift' : 'regime shifts';
    const detail = `${count} active ${label}`;
    const body = count ? `<strong class="cb-stat-value" style="color:var(--sev-elevated, #fb923c);">${capCount(count)}</strong> ${label}` : '';
    this.updateSegment('regime', body, detail + ' — open Analyst HUD', 'aria-label', detail + '. Open Analyst HUD.');
  }

  // ── Events ────────────────────────────────────────────────────────────

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const seg = target?.closest<HTMLElement>('[data-seg]');
    if (!seg) return;
    event.stopPropagation();
    switch (seg.dataset.seg) {
      case 'chevron': {
        this.collapsed = !this.collapsed;
        try {
          localStorage.setItem(COLLAPSED_KEY, this.collapsed ? '1' : '0');
        } catch { /* non-persistent is fine */ }
        this.applyCollapsed();
        this.rebaseline();
        break;
      }
      case 'status': { this.deps.onStatusClick(); break; }
      case 'alerts': { this.deps.onAlertsClick(); break; }
      case 'fresh': { this.deps.onFreshnessClick(); break; }
      case 'regime': { this.deps.onRegimeClick(); break; }
      default: { break; }
    }
  };
}
