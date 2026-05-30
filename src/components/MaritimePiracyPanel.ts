import { Panel } from "./Panel";
import { h, replaceChildren } from "@/utils/dom-utils";
import {
  buildRenderData,
  severityClass,
  trendClass,
  attackTypeClass,
} from "./maritime-piracy-helpers";

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export class MaritimePiracyPanel extends Panel {
  static readonly panelId = "maritime-piracy";
  static readonly title = "Maritime Piracy";
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: MaritimePiracyPanel.panelId,
      title: MaritimePiracyPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        "Tracks maritime piracy, armed robbery at sea, and sea-based terrorism across global hotspots. Distinct from state-actor seabed warfare and maritime sovereignty disputes.",
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(
        this.getContentElement(),
        h("div", { className: "panel-empty" }, "Data unavailable"),
      );
      return;
    }

    const { hotspots, incidents, globalPiracyIndex, totalIncidentsYTD, highRiskRegions, crewsAtRisk } =
      data;

    this.setCount(
      hotspots.filter(hs => hs.severityLevel === "Critical" || hs.severityLevel === "High").length,
    );

    let idxClass: string;
    if (globalPiracyIndex >= 70) {
      idxClass = "piracy-critical";
    } else if (globalPiracyIndex >= 50) {
      idxClass = "piracy-high";
    } else if (globalPiracyIndex >= 30) {
      idxClass = "piracy-medium";
    } else {
      idxClass = "piracy-low";
    }

    const header = h(
      "div",
      { className: "mp-header" },
      h(
        "div",
        { className: "mp-metric" },
        h("span", { className: "mp-label" }, "Piracy Index"),
        h("span", { className:  }, ),
      ),
      h(
        "div",
        { className: "mp-metric" },
        h("span", { className: "mp-label" }, "Annual Incidents"),
        h("span", { className: "mp-value" }, String(totalIncidentsYTD)),
      ),
      h(
        "div",
        { className: "mp-metric" },
        h("span", { className: "mp-label" }, "High-Risk Zones"),
        h("span", { className: "mp-value piracy-high" }, String(highRiskRegions.length)),
      ),
      h(
        "div",
        { className: "mp-metric" },
        h("span", { className: "mp-label" }, "Crews at Risk"),
        h("span", { className: "mp-value piracy-medium" }, String(crewsAtRisk)),
      ),
    );

    const hotspotSection = h(
      "div",
      { className: "mp-hotspots" },
      h("h3", { className: "mp-section-title" }, "Piracy Hotspots"),
    );

    for (const spot of [...hotspots].sort((a, b) => b.annualIncidents - a.annualIncidents)) {
      const row = h(
        "div",
        { className:  },
        h(
          "div",
          { className: "mp-hotspot-header" },
          h("span", { className: "mp-region" }, spot.region),
          h("span", { className:  }, spot.severityLevel),
          h("span", { className:  }, spot.trend),
          h("span", { className: "mp-incidents" }, ),
          h("span", { className: "mp-impact" }, ),
        ),
        h("div", { className: "mp-description" }, spot.description),
        h(
          "div",
          { className: "mp-tactics" },
          h("span", { className: "mp-tactics-label" }, "Tactics: "),
          spot.primaryTactics.join(" · "),
        ),
        h(
          "div",
          { className: "mp-groups" },
          h("span", { className: "mp-groups-label" }, "Groups: "),
          spot.primaryGroups.join(", "),
        ),
      );
      hotspotSection.append(row);
    }

    const incidentSection = h(
      "div",
      { className: "mp-incidents-log" },
      h("h3", { className: "mp-section-title" }, "Notable Incidents (2022–2024)"),
    );

    for (const inc of [...incidents].sort((a, b) => b.significance - a.significance)) {
      const row = h(
        "div",
        { className:  },
        h(
          "div",
          { className: "mp-incident-header" },
          h("span", { className: "mp-incident-region" }, inc.region),
          h("span", { className:  }, inc.attackType),
          h("span", { className: "mp-outcome" }, inc.outcome),
          h("span", { className: "mp-sig" }, ),
          h("span", { className: "mp-date" }, inc.date),
        ),
        h("div", { className: "mp-ship-type" }, ),
        h("div", { className: "mp-incident-desc" }, inc.description),
      );
      incidentSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, hotspotSection, incidentSection);
  }
}
