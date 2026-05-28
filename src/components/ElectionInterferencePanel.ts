import { Panel } from '../app/Panel';
import { buildRenderData, classifyThreatLevel, computeNetRisk } from './election-interference-helpers';
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c);
  return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
export class ElectionInterferencePanel extends Panel {
  static panelId = 'election-interference';
  static title = 'Election Interference Tracker';
  constructor() { super(ElectionInterferencePanel.panelId, ElectionInterferencePanel.title, 1800000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div',{class:'ei-error'},'Data unavailable')); return; }
    const header = h('div',{class:'ei-header'},
      h('span',{},`Most active: ${safeHtml(data.mostActiveActor)}`),
      h('span',{},`${data.risks.length} elections at risk`)
    );
    const rows = data.risks.slice(0,7).map(r => {
      const tier = classifyThreatLevel(r.riskScore);
      return h('div',{class:`ei-row threat-${tier}`},
        h('span',{class:'country'},safeHtml(r.country)),
        h('span',{class:'risk'},String(r.riskScore)),
        h('span',{class:'net-risk'},String(computeNetRisk(r))),
        h('span',{class:'resilience'},String(r.resilienceScore)),
        h('span',{class:'threats'},safeHtml(r.primaryThreats.join(', ')))
      );
    });
    this.replaceChildren(header, ...rows);
  }
}
