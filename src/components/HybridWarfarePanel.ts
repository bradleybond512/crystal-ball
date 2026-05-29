import { Panel } from './Panel';
import { buildRenderData, severityClass, statusClass, type HybridOperation, type HybridIncident } from './hybrid-warfare-helpers';

const REFRESH_MS = 30 * 60 * 1000;
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement { const el=document.createElement(tag); for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); for(const c of ch) el.appendChild(typeof c==="string"?document.createTextNode(c):c); return el; }
function safeHtml(t: string): string { return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function safe<T>(fn:()=>T):T|null{try{return fn();}catch{return null;}}

export class HybridWarfarePanel extends Panel {
  static panelId = "hybrid-warfare";
  static title = "Hybrid Warfare";
  constructor() { super(HybridWarfarePanel.panelId, HybridWarfarePanel.title, REFRESH_MS); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h("div",{class:"error"},"Data unavailable")); return; }
    const { operations, incidents, globalHybridIndex, activeOperationCount, escalatingCount, criticalCount, topActors } = data;
    const header = h("div",{class:"hw-header"},
      h("div",{class:"hw-metric"},h("span",{class:"hw-label"},"Hybrid Index"),h("span",{class:`hw-value ${globalHybridIndex>=70?"sev-critical":globalHybridIndex>=50?"sev-high":"sev-medium"}`},`${globalHybridIndex}/100`)),
      h("div",{class:"hw-metric"},h("span",{class:"hw-label"},"Active Ops"),h("span",{class:"hw-value op-active"},String(activeOperationCount))),
      h("div",{class:"hw-metric"},h("span",{class:"hw-label"},"Escalating"),h("span",{class:"hw-value op-escalating"},String(escalatingCount))),
      h("div",{class:"hw-metric"},h("span",{class:"hw-label"},"Critical"),h("span",{class:"hw-value sev-critical"},String(criticalCount))),
      h("div",{class:"hw-metric"},h("span",{class:"hw-label"},"Top Actors"),h("span",{class:"hw-value"},safeHtml(topActors.slice(0,3).join(", ")))),
    );
    const opsSection = h("div",{class:"hw-ops"});
    for (const op of [...operations].sort((a,b)=>b.severityScore-a.severityScore)) {
      const row = h("div",{class:`hw-op-row ${severityClass(op.severity)}`},
        h("div",{class:"hw-op-header"},
          h("span",{class:"hw-actor"},safeHtml(op.actor)),h("span",{class:"hw-arrow"}," → "),h("span",{class:"hw-target"},safeHtml(op.target)),
          h("span",{class:`hw-status-badge ${statusClass(op.status)}`},safeHtml(op.status)),
          h("span",{class:`hw-sev-badge ${severityClass(op.severity)}`},safeHtml(op.severity)),
          h("span",{class:"hw-attr"},safeHtml(op.attribution)),
        ),
        h("div",{class:"hw-components"},safeHtml(op.components.join(" · "))),
        h("div",{class:"hw-desc"},safeHtml(op.description)),
      );
      opsSection.appendChild(row);
    }
    const incSection = h("div",{class:"hw-incidents"},h("h3",{class:"hw-section-title"},"Recent Incidents"));
    for (const inc of incidents) {
      const row = h("div",{class:`hw-inc-row ${severityClass(inc.severity)}`},
        h("div",{class:"hw-inc-header"},h("span",{class:"hw-actor"},safeHtml(inc.actor)),h("span",{class:"hw-arrow"}," → "),h("span",{class:"hw-target"},safeHtml(inc.target)),h("span",{class:"hw-comp"},safeHtml(inc.component)),h("span",{class:`hw-sev ${severityClass(inc.severity)}`},safeHtml(inc.severity)),h("span",{class:"hw-date"},safeHtml(inc.date))),
        h("div",{class:"hw-inc-desc"},safeHtml(inc.description)),
      );
      incSection.appendChild(row);
    }
    this.replaceChildren(header, opsSection, incSection);
  }
}
