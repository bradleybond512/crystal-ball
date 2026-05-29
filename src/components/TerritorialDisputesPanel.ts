import { Panel } from '../app/Panel';
import { buildRenderData, scoreDisputeSeverity } from './territorial-disputes-helpers';

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

function h(tag: string, attrs: Record<string, string>, ...ch: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of ch) typeof c === 'string' ? el.appendChild(document.createTextNode(c)) : el.appendChild(c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class TerritorialDisputesPanel extends Panel {
  static panelId = 'territorial-disputes';
  static title = 'Territorial Disputes Tracker';

  constructor() {
    super(TerritorialDisputesPanel.panelId, TerritorialDisputesPanel.title, 3600000);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'td-error' }, 'Data unavailable'));
      return;
    }

    const header = h('div', { class: 'td-header' },
      h('span', {}, `Global tension index: ${data.globalTensionIndex}`),
      h('span', {}, `Escalating: ${data.escalatingCount}`),
      h('span', {}, `Armed conflict: ${data.armedConflictCount}`)
    );

    const rows = data.disputes.map(d => h('div', { class: `td-row phase-${d.phase} trend-${d.escalationTrend}` },
      h('span', { class: 'name' }, safeHtml(d.name.length > 28 ? d.name.slice(0, 28) + '…' : d.name)),
      h('span', { class: 'phase' }, safeHtml(d.phase)),
      h('span', { class: 'trend' }, safeHtml(d.escalationTrend)),
      h('span', { class: 'severity' }, String(scoreDisputeSeverity(d))),
      h('span', { class: 'region' }, safeHtml(d.region))
    ));

    this.replaceChildren(header, ...rows);
  }
}
