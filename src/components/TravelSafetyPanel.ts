/**
 * TravelSafetyPanel - country travel advisories ranked by risk level.
 *
 * Gives civilians a clear, actionable view of where is safe or unsafe to
 * travel: State Dept-style 1-4 advisory levels, evacuation status, entry
 * restrictions, and recent safety alerts.
 *
 * Refresh: every 60 minutes.
 */
import { Panel } from "./Panel";
import {
  buildRenderData,
  advisoryLabel,
  advisoryColor,
  type CountryAdvisory,
  type SafetyAlert,
} from "./travel-safety-helpers";

const REFRESH_MS = 60 * 60_000;

const TOOLTIP =
  "Country travel advisories on a 1-4 scale mirroring US State Dept and UK FCDO standards. " +
  "Level 4 = Do Not Travel. Shows evacuation orders, entry restrictions, and recent safety alerts. " +
  "Refreshes every 60 minutes.";

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}

function safeText(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderAdvisoryRow(a: CountryAdvisory): string {
  const color = advisoryColor(a.advisoryLevel);
  const label = advisoryLabel(a.advisoryLevel);
  const evac = a.evacuationStatus !== "none"
    ? "<span class="ts-evac ts-evac-" + a.evacuationStatus + "">" + (a.evacuationStatus === "ordered" ? "EVAC" : "vol. evac") + "</span>"
    : "";
  const restr = a.entryRestrictions ? "<span class="ts-restricted">Entry restricted</span>" : "";
  return (
    "<div class="ts-row" data-level="" + String(a.advisoryLevel) + "">" +
    "<span class="ts-level-dot" style="background:" + color + ""></span>" +
    "<span class="ts-country">" + safeText(a.country) + "</span>" +
    "<span class="ts-label" style="color:" + color + "">" + label + "</span>" +
    evac + restr +
    "</div>"
  );
}

function renderAlert(al: SafetyAlert): string {
  return (
    "<div class="ts-alert ts-alert-" + al.severity + "">" +
    "<span class="ts-alert-country">" + safeText(al.country) + "</span>" +
    "<span class="ts-alert-title">" + safeText(al.title) + "</span>" +
    "</div>"
  );
}

function renderHtml(params: ReturnType<typeof buildRenderData>): string {
  const levelBar = ([4, 3, 2, 1] as const)
    .map((l) => {
      const count = params.levelCounts[l];
      return (
        "<span class="ts-bar-cell ts-lvl-" + String(l) + "" style="border-color:" + advisoryColor(l) + "">" +
        "<strong>" + String(count) + "</strong> L" + String(l) +
        "</span>"
      );
    })
    .join("");

  const rowHtml = params.advisories.map(renderAdvisoryRow).join("");
  const alertHtml = params.criticalAlerts.map(renderAlert).join("");
  const evacList = params.evacuationCountries
    .map((c) => safeText(c.country))
    .join(", ");

  return (
    "<div class="ts-root">" +
    "<div class="ts-summary-bar">" + levelBar + "</div>" +
    (params.evacuationCountries.length > 0
      ? "<div class="ts-evac-banner">Evacuation advisories: " + safeText(evacList) + "</div>"
      : "") +
    "<div class="ts-advisories">" + rowHtml + "</div>" +
    (alertHtml
      ? "<div class="ts-alerts-header">Critical alerts</div><div class="ts-alerts">" + alertHtml + "</div>"
      : "") +
    "</div>"
  );
}

export class TravelSafetyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: "travel-safety",
      title: "Travel Safety",
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    const data = safe(() => buildRenderData(), null);
    if (!data) { this.showError("Travel advisory data unavailable"); return; }
    // Count = number of Do Not Travel (L4) countries
    this.setCount(data.levelCounts[4]);
    this.setContent(renderHtml(data));
  }
}
