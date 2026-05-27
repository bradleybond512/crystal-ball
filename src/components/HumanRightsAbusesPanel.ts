import { Panel } from '../app/Panel';
import { buildRenderData, CountryRiskProfile } from './human-rights-abuses-helpers';

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function safeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class HumanRightsAbusesPanel extends Panel {
  static panelId = 'human-rights-abuses';
  static title = 'Human Rights Abuses';

  constructor() {
    super(HumanRightsAbusesPanel.panelId, HumanRightsAbusesPanel.title, 300000);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) { this.showError('Data unavailable'); return; }

    const rows = data.profiles.slice(0, 12).map(p => this.renderRow(p));
    const summary = h('div', { class: 'hr-summary' },
      h('span', {}, `${data.totalIncidents} incidents tracked`),
      h('span', {}, `${data.systematicCount} systematic patterns`)
    );

    this.replaceChildren(summary, ...rows);
  }

  private renderRow(p: CountryRiskProfile): HTMLElement {
    const tier = p.abuseRiskScore >= 85 ? 'critical' : p.abuseRiskScore >= 70 ? 'high' : p.abuseRiskScore >= 50 ? 'medium' : 'low';
    const trendArrow = p.trend === 'worsening' ? '↑' : p.trend === 'improving' ? '↓' : '→';
    return h('div', { class: `hr-row tier-${tier}` },
      h('span', { class: 'country' }, safeHtml(p.country)),
      h('span', { class: 'score' }, String(p.abuseRiskScore)),
      h('span', { class: 'impunity' }, `${Math.round(p.impunityIndex * 100)}% impunity`),
      h('span', { class: 'trend' }, trendArrow),
      h('span', { class: 'category' }, safeHtml(p.dominantCategory))
    );
  }

  private showError(msg: string): void {
    this.replaceChildren(h('div', { class: 'hr-error' }, safeHtml(msg)));
  }
}
