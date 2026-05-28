/**
 * GlobalConflictPanel - active armed conflicts ranked by severity.
 *
 * Gives civilians a ranked, human-readable view of active conflicts:
 * intensity, displacement, trend, and recent significant events.
 *
 * Refresh: every 30 minutes.
 */
import { Panel } from "./Panel";
import {
  buildRenderData,
  rankConflictsBySeverity,
  formatDisplaced,
  formatDeaths,
  trendIcon,
  type ActiveConflict,
  type ConflictEvent,
} from "./global-conflict-helpers";

const REFRESH_MS = 30 * 60_000;

const TOOLTIP =
  "Active armed conflicts ranked by intensity then monthly death toll. " +
  "Shows displacement, trend direction, and significant recent events. " +
  "Data sourced from ACLED, UNHCR, and UCDP estimates. Refreshes every 30 minutes.";

const INTENSITY_COLOR: Record<string, string> = {
  war: "#ef4444",
  "armed-conflict": "#f97316",
  crisis: "#eab308",
  tension: "#3b82f6",
  stable: "#22c55e",
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}

function safeText(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderConflictRow(c: ActiveConflict): string {
  const color = INTENSITY_COLOR[c.intensity] ?? "#888";
  const icon = trendIcon(c.trend);
  const trendLabel = icon === "up" ? "&#8593;" : icon === "down" ? "&#8595;" : "&#8594;";
  const trendClass = icon === "up" ? "trend-up" : icon === "down" ? "trend-down" : "trend-flat";
  return (
    "<div class="gc-row" data-intensity="" + safeText(c.intensity) + "">" +
    "<span class="gc-dot" style="background:" + color + ""></span>" +
    "<span class="gc-name">" + safeText(c.name) + "</span>" +
    "<span class="gc-trend " + trendClass + "">" + trendLabel + "</span>" +
    "<span class="gc-displaced">" + formatDisplaced(c.displaced) + "</span>" +
    "<span class="gc-deaths">" + formatDeaths(c.monthlyDeaths) + "/mo</span>" +
    "</div>"
  );
}

function renderEvent(ev: ConflictEvent): string {
  return (
    "<div class="gc-event">" +
    "<span class="gc-event-date">" + safeText(ev.date) + "</span>" +
    "<span class="gc-event-headline">" + safeText(ev.headline) + "</span>" +
    "</div>"
  );
}

function renderHtml(params: ReturnType<typeof buildRenderData>): string {
  const conflictRows = params.conflicts.map(renderConflictRow).join("");
  const eventItems = params.recentEvents.map(renderEvent).join("");
  return (
    "<div class="gc-root">" +
    "<div class="gc-stats">" +
    "<span class="gc-stat"><strong>" + String(params.activeWars) + "</strong> wars active</span>" +
    "<span class="gc-stat"><strong>" + String(params.escalatingCount) + "</strong> escalating</span>" +
    "<span class="gc-stat"><strong>" + formatDisplaced(params.totalDisplacedK) + "</strong> displaced</span>" +
    "</div>" +
    "<div class="gc-conflicts">" + conflictRows + "</div>" +
    "<div class="gc-events-header">Recent significant events</div>" +
    "<div class="gc-events">" + eventItems + "</div>" +
    "</div>"
  );
}

export class GlobalConflictPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private extraConflicts: ActiveConflict[] = [];

  constructor() {
    super({
      id: "global-conflict",
      title: "Global Conflicts",
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
    if (!base) { this.showError("Conflict data unavailable"); return; }
    const allConflicts = rankConflictsBySeverity([...base.conflicts, ...this.extraConflicts]);
    const data = { ...base, conflicts: allConflicts };
    this.setCount(data.activeWars);
    this.setContent(renderHtml(data));
  }
}
