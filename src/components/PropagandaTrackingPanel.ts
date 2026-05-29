import { Panel } from "./Panel";
import {
  buildRenderData,
  rankOutletsByReach,
  severityClass,
  statusClass,
  type StateMediaOutlet,
  type PropagandaCampaign,
} from "./propaganda-tracking-helpers";

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class PropagandaTrackingPanel extends Panel {
  static panelId = "propaganda-tracking";
  static title = "Propaganda Tracking";

  constructor() {
    super(PropagandaTrackingPanel.panelId, PropagandaTrackingPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h("div", { class: "error" }, "Data unavailable"));
      return;
    }

    const { outlets, campaigns, globalInfoWarIndex, activeCampaignCount, totalReachM, topActors } = data;

    const header = h("div", { class: "pt-header" },
      h("div", { class: "pt-metric" },
        h("span", { class: "pt-label" }, "Info War Index"),
        h("span", { class: `pt-value ${globalInfoWarIndex >= 60 ? "sev-critical" : globalInfoWarIndex >= 40 ? "sev-high" : "sev-medium"}` }, `${globalInfoWarIndex}/100`),
      ),
      h("div", { class: "pt-metric" },
        h("span", { class: "pt-label" }, "Active Campaigns"),
        h("span", { class: "pt-value sev-critical" }, String(activeCampaignCount)),
      ),
      h("div", { class: "pt-metric" },
        h("span", { class: "pt-label" }, "Total Outlet Reach"),
        h("span", { class: "pt-value" }, `${totalReachM}M`),
      ),
      h("div", { class: "pt-metric" },
        h("span", { class: "pt-label" }, "Top Actors"),
        h("span", { class: "pt-value" }, safeHtml(topActors.slice(0, 3).join(", "))),
      ),
    );

    const campaignSection = h("div", { class: "pt-section" },
      h("h3", { class: "pt-section-title" }, "Active & Recent Campaigns"),
    );
    for (const c of campaigns) {
      const row = h("div", { class: `pt-campaign-row ${severityClass(c.severity)}` },
        h("div", { class: "pt-campaign-header" },
          h("span", { class: "pt-actor" }, safeHtml(c.actor)),
          h("span", { class: `pt-status-badge ${statusClass(c.status)}` }, safeHtml(c.status)),
          h("span", { class: `pt-sev-badge ${severityClass(c.severity)}` }, safeHtml(c.severity)),
          h("span", { class: "pt-date" }, safeHtml(c.startDate)),
        ),
        h("div", { class: "pt-narrative" }, safeHtml(c.primaryNarrative)),
        h("div", { class: "pt-description" }, safeHtml(c.description)),
        h("div", { class: "pt-campaign-meta" },
          h("span", { class: "pt-reach" }, `Reach: ${c.estimatedReachM}M`),
          h("span", { class: "pt-target" }, safeHtml(c.targetAudience)),
          h("span", { class: "pt-platforms" }, safeHtml(c.platforms.slice(0, 3).join(", "))),
        ),
      );
      campaignSection.appendChild(row);
    }

    const outletSection = h("div", { class: "pt-section" },
      h("h3", { class: "pt-section-title" }, "State Media Outlets"),
    );
    for (const o of rankOutletsByReach(outlets)) {
      const row = h("div", { class: "pt-outlet-row" },
        h("span", { class: "pt-outlet-name" }, safeHtml(o.name)),
        h("span", { class: "pt-outlet-country" }, safeHtml(o.country)),
        h("span", { class: "pt-outlet-reach" }, `${o.monthlyReachM}M/mo`),
        h("span", { class: `pt-factcheck ${o.factCheckScore < 30 ? "sev-critical" : o.factCheckScore < 50 ? "sev-high" : "sev-medium"}` }, `FC: ${o.factCheckScore}/100`),
        o.bannedIn.length > 0 ? h("span", { class: "pt-banned" }, `Banned: ${safeHtml(o.bannedIn.slice(0, 3).join(", "))}`) : h("span", {}),
      );
      outletSection.appendChild(row);
    }

    this.replaceChildren(header, campaignSection, outletSection);
  }
}
