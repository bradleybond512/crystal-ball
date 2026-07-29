/**
 * SummaryStrip — slim one-line "at a glance" row docked above the panels
 * grid (below the banner stack; the scroll container's
 * --notification-stack-h padding keeps it clear of fixed banners, and
 * position:sticky pins it while the grid scrolls).
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
  private collapsed: boolean;
  private status: StatusBarState | null = null;
  private unsubStatus: (() => void) | null = null;
  private unsubAlerts: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onRegimeEvent = (): void => this.renderSegments();
  private readonly onToggleEvent = (): void => {
    this.applyEnabled();
    this.renderSegments();
  };

  constructor(private readonly deps: SummaryStripDeps) {
    this.collapsed = this.readCollapsed();
    this.el = document.createElement('div');
    this.el.className = 'cb-summary-strip';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'At a glance summary');
    this.segsEl = document.createElement('div');
    this.segsEl.className = 'cb-summary-strip-segs';
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'cb-summary-strip-chevron';
    chevron.dataset.seg = 'chevron';
    this.el.append(this.segsEl, chevron);

    // One delegated listener for every segment + the chevron.
    this.el.addEventListener('click', (e) => this.onClick(e));

    this.unsubStatus = deps.subscribeStatus((state) => {
      this.status = state;
      this.renderSegments();
    });
    this.unsubAlerts = unifiedAlertStore.subscribe(() => this.renderSegments());
    this.refreshTimer = setInterval(() => this.renderSegments(), REFRESH_MS);
    document.addEventListener(REGIME_SHIFT_EVENT, this.onRegimeEvent);
    document.addEventListener(SUMMARY_STRIP_TOGGLE_EVENT, this.onToggleEvent);

    this.applyEnabled();
    this.applyCollapsed();
    this.renderSegments();
  }

  public getElement(): HTMLElement {
    return this.el;
  }

  public destroy(): void {
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
    this.el.style.display = isSummaryStripEnabled() ? '' : 'none';
  }

  private applyCollapsed(): void {
    this.el.classList.toggle('is-collapsed', this.collapsed);
    const chevron = this.el.querySelector<HTMLElement>('.cb-summary-strip-chevron');
    if (chevron) {
      chevron.innerHTML = icon('chevron-down', { size: 12 });
      chevron.setAttribute('aria-expanded', String(!this.collapsed));
      chevron.setAttribute('aria-label', this.collapsed ? 'Expand summary strip' : 'Collapse summary strip');
      chevron.title = this.collapsed ? 'Expand' : 'Collapse';
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private renderSegments(): void {
    if (!isSummaryStripEnabled()) return;
    this.segsEl.innerHTML = this.collapsed
      ? this.statusSegHtml(true)
      : [
        this.statusSegHtml(false),
        this.alertsSegHtml(),
        this.freshnessSegHtml(),
        this.regimeSegHtml(),
      ].filter((s) => s.length > 0).join('');
  }

  private statusSegHtml(dotOnly: boolean): string {
    const state = this.status;
    const color = STATUS_COLOR_TOKEN[state?.color ?? 'gray'];
    // Before the first derived state arrives, stay non-committal ("—") rather
    // than asserting "ALL CLEAR" — the chip must never claim safety it hasn't
    // yet evaluated. Once state exists, the composite label (incl. weather) wins.
    const label = state?.label ?? '—';
    const dot = `<span class="cb-summary-strip-dot" style="background:${color};" aria-hidden="true"></span>`;
    const text = dotOnly ? '' : `<span class="cb-summary-strip-status" style="color:${color};">${escapeHtml(label)}</span>`;
    return `<button type="button" class="cb-summary-strip-seg" data-seg="status" title="System status — open Safety Case" aria-label="System status: ${escapeHtml(label)}. Open Safety Case panel.">${dot}${text}</button>`;
  }

  private alertsSegHtml(): string {
    const unacked = unifiedAlertStore.getAll().filter((a) => !a.acknowledged);
    const parts: string[] = [];
    for (const sev of ['critical', 'high', 'medium'] as const) {
      const n = unacked.filter((a) => a.severity === sev).length;
      if (n > 0) {
        const shortSeverity = sev === 'medium' ? 'med' : sev.slice(0, 4);
        parts.push(`<strong class="cb-stat-value" style="color:${ALERT_SEV_TOKEN[sev]};">${capCount(n)}</strong> ${shortSeverity}`);
      }
    }
    const body = parts.length > 0
      ? parts.join('<span class="cb-stat-sep" aria-hidden="true">·</span>')
      : '<span class="cb-summary-strip-muted">no open alerts</span>';
    return `<button type="button" class="cb-summary-strip-seg" data-seg="alerts" title="${unacked.length} unacknowledged alerts — open Alert Inbox" aria-description="${unacked.length} unacknowledged alerts. Open Alert Inbox.">${body}</button>`;
  }

  private freshnessSegHtml(): string {
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
    return `<button type="button" class="cb-summary-strip-seg" data-seg="fresh" title="${escapeHtml(detail)}" aria-description="${escapeHtml(detail)}">${body}</button>`;
  }

  private regimeSegHtml(): string {
    let count = 0;
    try {
      // Empty when the BOCPD kill-switch is off — segment self-gates.
      count = Object.keys(getActiveRegimeShifts()).length;
    } catch {
      count = 0;
    }
    if (count === 0) return '';
    const label = count === 1 ? 'regime shift' : 'regime shifts';
    return `<button type="button" class="cb-summary-strip-seg" data-seg="regime" title="${count} active ${label} — open Analyst HUD" aria-label="${count} active ${label}. Open Analyst HUD."><strong class="cb-stat-value" style="color:var(--sev-elevated, #fb923c);">${capCount(count)}</strong> ${label}</button>`;
  }

  // ── Events ────────────────────────────────────────────────────────────

  private onClick(event: MouseEvent): void {
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
        this.renderSegments();
        break;
      }
      case 'status': { this.deps.onStatusClick(); break; }
      case 'alerts': { this.deps.onAlertsClick(); break; }
      case 'fresh': { this.deps.onFreshnessClick(); break; }
      case 'regime': { this.deps.onRegimeClick(); break; }
      default: { break; }
    }
  }
}
