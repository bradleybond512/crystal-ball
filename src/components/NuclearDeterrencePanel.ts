import { Panel } from "../app/Panel";
import { buildRenderData, computeGlobalEscalationIndex } from "./nuclear-deterrence-helpers";
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === "string" ? el.appendChild(document.createTextNode(c)) : el.appendChild(c); return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
export class NuclearDeterrencePanel extends Panel {
  static panelId = "nuclear-deterrence";
  static title = "Nuclear Deterrence Monitor";
  constructor() { super(NuclearDeterrencePanel.panelId, NuclearDeterrencePanel.title, 3600000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h("div",{class:"nd-error"},"Data unavailable")); return; }
    const health = data.treatyHealth;
    const header = h("div",{class:"nd-header"},
      h("span",{},),
      h("span",{},),
      h("span",{},)
    );
    const rows = data.postures.slice(0,9).map(p => h("div",{class:},
      h("span",{class:"nation"},safeHtml(p.nation)),
      h("span",{class:"alert"},safeHtml(p.alertLevel)),
      h("span",{class:"doctrine"},safeHtml(p.doctrine)),
      h("span",{class:"escalation"},String(p.escalationRisk)),
      h("span",{class:"warheads"},)
    ));
    this.replaceChildren(header, ...rows);
  }
}
