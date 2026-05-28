import { Panel } from '../app/Panel';
import { buildRenderData, scoreCampaignThreat } from './psychological-operations-helpers';

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

export class PsychologicalOperationsPanel extends Panel {
  static panelId = 'psychological-operations';
  static title = 'Psychological Operations Monitor';

  constructor() {
    super(PsychologicalOperationsPanel.panelId, PsychologicalOperationsPanel.title, 3600000);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'psyop-error' }, 'Data unavailable'));
      return;
    }

    const header = h('div', { class: 'psyop-header' },
      h('span', {}, 'Most active: ' + data.mostActiveActor),
      h('span', {}, 'Total reach: ' + data.totalReachMillions + 'M'),
      h('span', {}, 'Active campaigns: ' + data.campaigns.filter(c => c.phase === 'active').length)
    );

    const rows = data.campaigns.slice(0, 8).map(c =>
      h('div', { class: 'psyop-row actor-' + c.actor.replace(/\s/g, '-').toLowerCase() },
        h('span', { class: 'name' }, safeHtml(c.name)),
        h('span', { class: 'actor' }, safeHtml(c.actor)),
        h('span', { class: 'threat' }, String(scoreCampaignThreat(c))),
        h('span', { class: 'reach' }, c.estimatedReach + 'M'),
        h('span', { class: 'phase' }, safeHtml(c.phase))
      )
    );

    this.replaceChildren(header, ...rows);
  }
}
