import { Panel } from '../app/Panel';
import { buildRenderData } from './migration-crisis-helpers';

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}
function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c);
  return el;
}
function safeHtml(t: string): string { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export class MigrationCrisisPanel extends Panel {
  static panelId = 'migration-crisis';
  static title = 'Migration Crisis Monitor';
  constructor() { super(MigrationCrisisPanel.panelId, MigrationCrisisPanel.title, 300000); }
  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.replaceChildren(h('div', { class: 'mc-error' }, 'Data unavailable')); return; }
    const header = h('div', { class: 'mc-header' },
      h('span', {}, `${(data.totalDisplaced / 1e6).toFixed(1)}M displaced`),
      h('span', {}, `${data.hotspots.length} hotspot corridors`)
    );
    const routeRows = data.routes.slice(0, 6).map(r =>
      h('div', { class: `mc-route risk-${r.routeRiskLevel >= 75 ? 'high' : r.routeRiskLevel >= 50 ? 'med' : 'low'}` },
        h('span', { class: 'route-id' }, safeHtml(r.id)),
        h('span', { class: 'flow' }, `${(r.monthlyFlow/1000).toFixed(1)}k/mo`),
        h('span', { class: 'factor' }, safeHtml(r.primaryPushFactor)),
        h('span', { class: 'risk' }, String(r.routeRiskLevel))
      )
    );
    this.replaceChildren(header, ...routeRows);
  }
}
