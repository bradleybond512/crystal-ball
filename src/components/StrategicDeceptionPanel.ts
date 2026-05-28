import { Panel } from '../app/Panel';
import { buildRenderData, scoreDeceptionThreat } from './strategic-deception-helpers';
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c); return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
export class StrategicDeceptionPanel extends Panel {
  static panelId = 'strategic-deception';
  static title = 'Strategic Deception Tracker';
  constructor() { super(StrategicDeceptionPanel.panelId, StrategicDeceptionPanel.title, 3600000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div',{class:'sd-error'},'Data unavailable')); return; }
    const header = h('div',{class:'sd-header'},
      h('span',{},`Active operations: ${data.activeCount}`),
      h('span',{},`Most active actor: ${safeHtml(data.mostActiveActor)}`),
      h('span',{},`High-confidence indicators: ${data.recentIndicators.length}`)
    );
    const rows = data.operations.slice(0,8).map(op => h('div',{class:`sd-row domain-${op.domain}${op.active?' active':''}`},
      h('span',{class:'name'},safeHtml(op.name)),
      h('span',{class:'actor'},safeHtml(op.actor)),
      h('span',{class:'type'},safeHtml(op.type)),
      h('span',{class:'threat'},String(scoreDeceptionThreat(op))),
      h('span',{class:'status'},op.active ? 'ACTIVE' : 'historical')
    ));
    this.replaceChildren(header, ...rows);
  }
}
