import { Panel } from '../app/Panel';
import { buildRenderData, scoreProgramThreat, classifyThreatTier } from './space-weaponization-helpers';
function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c); return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
export class SpaceWeaponizationPanel extends Panel {
  static panelId = 'space-weaponization';
  static title = 'Space Weaponization Tracker';
  constructor() { super(SpaceWeaponizationPanel.panelId, SpaceWeaponizationPanel.title, 3600000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div',{class:'sw-error'},'Data unavailable')); return; }
    const header = h('div',{class:'sw-header'},
      h('span',{},`Leading nation: ${safeHtml(data.leadingNation)}`),
      h('span',{},`Total debris objects: ${data.totalDebrisObjects.toLocaleString()}`),
      h('span',{},`Operational programs: ${data.programs.filter(p=>p.developmentStage==='operational').length}`)
    );
    const rows = data.programs.slice(0,8).map(p => {
      const score = scoreProgramThreat(p);
      return h('div',{class:`sw-row tier-${classifyThreatTier(score)}`},
        h('span',{class:'name'},safeHtml(p.name)),
        h('span',{class:'nation'},safeHtml(p.nation)),
        h('span',{class:'category'},safeHtml(p.category)),
        h('span',{class:'stage'},safeHtml(p.developmentStage)),
        h('span',{class:'score'},String(score))
      );
    });
    this.replaceChildren(header, ...rows);
  }
}
