import { Panel } from '../app/Panel';
import { buildRenderData, classifyIntensity } from './gray-zone-conflict-helpers';

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

function h(tag: string, attrs: Record<string,string>, ...ch: (string|Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export class GrayZoneConflictPanel extends Panel {
  static panelId = 'gray-zone-conflict';
  static title = 'Gray Zone Conflict Tracker';

  constructor() { super(GrayZoneConflictPanel.panelId, GrayZoneConflictPanel.title, 3600000); }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div',{class:'gz-error'},'Data unavailable')); return; }

    const header = h('div',{class:'gz-header'},
      h('span',{},`Gray zone index: ${data.globalGrayZoneIndex}`),
      h('span',{},`Active operations: ${data.activeCount}`),
      h('span',{},`Most dangerous actor: ${safeHtml(data.mostDangerousActor)}`)
    );

    const rows = data.operations.map(op => h('div',{class:`gz-row intensity-${classifyIntensity(op.escalationPotential)}`},
      h('span',{class:'name'},safeHtml(op.name)),
      h('span',{class:'actor'},safeHtml(op.actor)),
      h('span',{class:'target'},safeHtml(op.targetNation)),
      h('span',{class:'escalation'},String(op.escalationPotential)),
      h('span',{class:'deniability'},String(op.deniabilityScore))
    ));

    this.replaceChildren(header, ...rows);
  }
}
