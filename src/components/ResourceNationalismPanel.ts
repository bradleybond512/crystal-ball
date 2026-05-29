import { Panel } from "./Panel";
import { h, replaceChildren } from "@/utils/dom-utils";
import {
  buildRenderData,
  nationalismClass,
  eventTypeClass,
  outcomeClass,
  volatilityClass,
  resourceConcentrationScore,
} from "./resource-nationalism-helpers";

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class ResourceNationalismPanel extends Panel {
  static readonly panelId = "resource-nationalism";
  static readonly title = "Resource Nationalism";
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ResourceNationalismPanel.panelId,
      title: ResourceNationalismPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        "Tracks state seizures, nationalizations, and weaponization of critical natural resources (minerals, energy, water). Covers 12+ countries and 8 strategic commodities with supply-concentration risk scores.",
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

    const {
      events,
      resources,
      countries,
      globalNationalismIndex,
      criticalEventCount,
      highRiskResourceCount,
      highRiskCountryCount,
    } = data;

    this.setCount(criticalEventCount);

    let idxClass: string;
    if (globalNationalismIndex >= 75) {
      idxClass = "nm-critical";
    } else if (globalNationalismIndex >= 55) {
      idxClass = "nm-high";
    } else if (globalNationalismIndex >= 35) {
      idxClass = "nm-moderate";
    } else {
      idxClass = "nm-low";
    }

    const header = h("div", { className: "rn-header" },
      h("div", { className: "rn-metric" },
        h("span", { className: "rn-label" }, "Nationalism Index"),
        h("span", { className:  }, ),
      ),
      h("div", { className: "rn-metric" },
        h("span", { className: "rn-label" }, "Critical Events"),
        h("span", { className: "rn-value nm-critical" }, String(criticalEventCount)),
      ),
      h("div", { className: "rn-metric" },
        h("span", { className: "rn-label" }, "High-Risk Resources"),
        h("span", { className: "rn-value nm-high" }, String(highRiskResourceCount)),
      ),
      h("div", { className: "rn-metric" },
        h("span", { className: "rn-label" }, "High-Risk Countries"),
        h("span", { className: "rn-value nm-high" }, String(highRiskCountryCount)),
      ),
    );

    // ── Resources section ────────────────────────────────────────────────────
    const resourceSection = h("div", { className: "rn-resources" },
      h("h3", { className: "rn-section-title" }, "Critical Resource Concentration"),
    );

    for (const r of [...resources].sort((a, b) => resourceConcentrationScore(b) - resourceConcentrationScore(a))) {
      const concScore = resourceConcentrationScore(r);
      const row = h("div", { className:  },
        h("div", { className: "rn-resource-header" },
          h("span", { className: "rn-resource-name" }, r.name),
          h("span", { className:  }, r.weaponizationRisk),
          h("span", { className:  }, r.priceVolatility),
          h("span", { className: "rn-conc-score" }, ),
        ),
        h("div", { className: "rn-producers" }, ),
        h("div", { className: "rn-strategic-use" }, r.strategicUse),
        h("div", { className: "rn-hhi" }, ),
      );
      resourceSection.append(row);
    }

    // ── Country risk section ─────────────────────────────────────────────────
    const countrySection = h("div", { className: "rn-countries" },
      h("h3", { className: "rn-section-title" }, "Country Nationalism Risk"),
    );

    for (const c of [...countries].sort((a, b) => b.nationalismScore - a.nationalismScore)) {
      const row = h("div", { className:  },
        h("div", { className: "rn-country-header" },
          h("span", { className: "rn-country-name" }, c.country),
          h("span", { className:  }, c.riskLevel),
          h("span", { className: "rn-trend" }, c.trend),
          h("span", { className: "rn-score" }, ),
        ),
        h("div", { className: "rn-country-resources" }, ),
        h("div", { className: "rn-country-notes" }, c.notes),
      );
      countrySection.append(row);
    }

    // ── Events section ───────────────────────────────────────────────────────
    const eventSection = h("div", { className: "rn-events" },
      h("h3", { className: "rn-section-title" }, "Nationalization & Seizure Events"),
    );

    for (const ev of [...events].sort((a, b) => b.severity - a.severity)) {
      const row = h("div", { className:  },
        h("div", { className: "rn-event-header" },
          h("span", { className: "rn-event-country" }, ev.country),
          h("span", { className: "rn-event-resource" }, ev.resource),
          h("span", { className:  }, ev.eventType),
          h("span", { className:  }, ev.outcome),
          h("span", { className: "rn-event-date" }, ev.date),
        ),
        h("div", { className: "rn-event-desc" }, ev.description),
        h("div", { className: "rn-event-meta" },
          h("span", {}, ),
          h("span", {}, ),
          h("span", {}, ),
        ),
      );
      eventSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, resourceSection, countrySection, eventSection);
  }
}
