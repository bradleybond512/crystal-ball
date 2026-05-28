import { Panel } from '../app/Panel';
import { buildRenderData, scorePMCThreat } from './mercenary-ecosystem-helpers';
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c); return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
export class MercenaryEcosystemPanel extends Panel {
  static panelId = 'mercenary-ecosystem';
  static title = 'Mercenary Ecosystem Tracker';
  constructor() { super(MercenaryEcosystemPanel.panelId, MercenaryEcosystemPanel.title, 3600000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div',{class:'merc-error'},'Data unavailable')); return; }
    const header = h('div',{class:'merc-header'},
      h('span',{},`Total estimated strength: ${data.totalStrength.toLocaleString()}`),
      h('span',{},`Most active theater: ${safeHtml(data.mostActiveTheater)}`),
      h('span',{},`HR violators: ${data.humanRightsViolators.length}`)
    );
    const rows = data.groups.slice(0,8).map(g => h('div',{class:`merc-row status-${g.status}`},
      h('span',{class:'name'},safeHtml(g.name)),
      h('span',{class:'sponsor'},safeHtml(g.sponsor)),
      h('span',{class:'threat'},String(scorePMCThreat(g))),
      h('span',{class:'strength'},g.estimatedStrength.toLocaleString()),
      h('span',{class:'hr-flags'},String(g.humanRightsFlags))
    ));
    this.replaceChildren(header, ...rows);
  }
}
