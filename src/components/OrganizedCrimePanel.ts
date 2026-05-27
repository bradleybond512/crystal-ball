import { Panel } from '../app/Panel';
import { buildRenderData } from './organized-crime-helpers';

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }
function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c);
  return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export class OrganizedCrimePanel extends Panel {
  static panelId = 'organized-crime';
  static title = 'Organized Crime Networks';
  constructor() { super(OrganizedCrimePanel.panelId, OrganizedCrimePanel.title, 300000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div', { class: 'oc-error' }, 'Data unavailable')); return; }
    const header = h('div', { class: 'oc-header' },
      h('span', {}, `$${(data.totalRevenue / 1e9).toFixed(1)}B annual revenue`),
      h('span', {}, `${data.highIntensityConflicts} active territory wars`)
    );
    const rows = data.orgs.slice(0, 8).map(org =>
      h('div', { class: `oc-org type-${org.networkType}` },
        h('span', { class: 'name' }, safeHtml(org.name)),
        h('span', { class: 'type' }, safeHtml(org.networkType)),
        h('span', { class: 'strength' }, String(org.strengthScore)),
        h('span', { class: 'penetration' }, String(org.statePenetration) + '%'),
        h('span', { class: 'revenue' }, `$${(org.annualRevenueUSD/1e9).toFixed(1)}B`)
      )
    );
    this.replaceChildren(header, ...rows);
  }
}
