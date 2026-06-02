/**
 * GlobalConflictPanel - active armed conflicts ranked by severity.
 *
 * Gives civilians a ranked, human-readable view of active conflicts:
 * intensity, displacement, trend, and recent significant events.
 *
 * Refresh: every 30 minutes.
 */
import { Panel } from './Panel';
import {
  buildRenderData,
  rankConflictsBySeverity,
  formatDisplaced,
  formatDeaths,
  trendIcon,
  type ActiveConflict,
  type ConflictEvent,
} from './global-conflict-helpers';

const REFRESH_MS = 30 * 60_000;

const TOOLTIP =
  'Active armed conflicts ranked by intensity then monthly death toll. ' +
  'Shows displacement, trend direction, and significant recent events. ' +
  'Data sourced from ACLED, UNHCR, and UCDP estimates. Refreshes every 30 minutes.';

const INTENSITY_COLOR: Record<string, string> = {
  war: '#ef4444',
  'armed-conflict': '#f97316',
  crisis: '#eab308',
  tension: '#3b82f6',
  stable: '#22c55e',
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}

function safeText(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function trendLabel(icon: string): string {
  if (icon === 'up') return '&#8593;';
  if (icon === 'down') return '&#8595;';
  return '&#8594;';
}

function trendClass(icon: string): string {
  if (icon === 'up') return 'trend-up';
  if (icon === 'down') return 'trend-down';
  return 'trend-flat';
}

function renderConflictRow(c: ActiveConflict): string {
  const color = INTENSITY_COLOR[c.intensity] ?? '#888';
  const icon = trendIcon(c.trend);
  const label = trendLabel(icon);
  const cls = trendClass(icon);
  return `<div class="gc-row" data-intensity="${safeText(c.intensity)}" style="border-left:3px solid ${color};padding:6px 10px;margin-bottom:4px;border-radius:3px;border:1px solid var(--border-subtle,#333);">
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="gc-dot" style="width:8px;height:8px;border-radius:50%;background:${color};flex:0 0 auto;"></span>
      <span class="gc-name" style="font-size:12px;font-weight:600;flex:1;">${safeText(c.name)}</span>
      <span class="gc-trend ${cls}" style="font-size:13px;">${label}</span>
      <span class="gc-displaced" style="font-size:11px;color:var(--text-secondary,#aaa);">${formatDisplaced(c.displaced)}</span>
      <span class="gc-deaths" style="font-size:11px;color:var(--text-secondary,#aaa);">${formatDeaths(c.monthlyDeaths)}/mo</span>
    </div>
  </div>`;
}

function renderEvent(ev: ConflictEvent): string {
  return `<div class="gc-event" style="padding:5px 10px;border-bottom:1px solid var(--border-subtle,#1a1a1a);font-size:11px;">
    <span class="gc-event-date" style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);margin-right:8px;">${safeText(ev.date)}</span>
    <span class="gc-event-headline">${safeText(ev.headline)}</span>
  </div>`;
}

function renderHtml(params: ReturnType<typeof buildRenderData>): string {
  const conflictRows = params.conflicts.map((c) => renderConflictRow(c)).join('');
  const eventItems = params.recentEvents.map((ev) => renderEvent(ev)).join('');
  return `<div class="gc-root" style="padding:8px 0;">
    <div class="gc-stats" style="display:flex;gap:16px;padding:6px 10px;border-bottom:1px solid var(--border-subtle,#222);margin-bottom:8px;font-size:12px;">
      <span class="gc-stat"><strong>${String(params.activeWars)}</strong> wars active</span>
      <span class="gc-stat"><strong>${String(params.escalatingCount)}</strong> escalating</span>
      <span class="gc-stat"><strong>${formatDisplaced(params.totalDisplacedK)}</strong> displaced</span>
    </div>
    <div class="gc-conflicts" style="padding:0 4px;">${conflictRows}</div>
    <div class="gc-events-header" style="padding:6px 10px;font-size:10px;font-weight:700;color:var(--text-secondary,#666);letter-spacing:0.06em;border-top:1px solid var(--border-subtle,#222);margin-top:8px;">RECENT SIGNIFICANT EVENTS</div>
    <div class="gc-events">${eventItems}</div>
  </div>`;
}

export class GlobalConflictPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private extraConflicts: ActiveConflict[] = [];

  constructor() {
    super({
      id: 'global-conflict',
      title: 'Global Conflicts',
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public setExtraConflicts(conflicts: ActiveConflict[]): void {
    this.extraConflicts = conflicts;
    this.refresh();
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    const base = safe(() => buildRenderData(), null);
    if (!base) { this.showError('Conflict data unavailable'); return; }
    const allConflicts = rankConflictsBySeverity([...base.conflicts, ...this.extraConflicts]);
    const data = { ...base, conflicts: allConflicts };
    this.setCount(data.activeWars);
    this.setContent(renderHtml(data));
  }
}
