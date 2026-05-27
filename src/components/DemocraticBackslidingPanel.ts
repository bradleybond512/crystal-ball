import { Panel } from './Panel';
import {
  buildRenderData,
  regimeClass,
  trendClass,
  trendArrow,
  rankByScore,
  type CountryDemocracy,
} from './democratic-backsliding-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function h(tag: string, attrs: Record<string, string>, ...ch: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of ch) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class DemocraticBackslidingPanel extends Panel {
  static panelId = 'democratic-backsliding';
  static title = 'Democratic Backsliding';

  constructor() {
    super(DemocraticBackslidingPanel.panelId, DemocraticBackslidingPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const {
      countries,
      events,
      globalDemocracyIndex,
      liberalCount,
      electoralDemCount,
      electoralAutocCount,
      closedAutocCount,
      erodingCount,
      populationUnderAutocracy,
    } = data;

    const header = h(
      'div',
      { class: 'db-header' },
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Democracy Index'),
        h('span', {
          class: `db-value ${globalDemocracyIndex < 40 ? 'regime-closed' : globalDemocracyIndex < 60 ? 'regime-autoc' : 'regime-electoral'}`,
        }, `${globalDemocracyIndex}/100`),
      ),
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Liberal Dem'),
        h('span', { class: 'db-value regime-liberal' }, String(liberalCount)),
      ),
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Electoral Dem'),
        h('span', { class: 'db-value regime-electoral' }, String(electoralDemCount)),
      ),
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Autocracy'),
        h('span', { class: 'db-value regime-autoc' }, String(electoralAutocCount + closedAutocCount)),
      ),
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Eroding'),
        h('span', { class: 'db-value trend-down' }, String(erodingCount)),
      ),
      h('div', { class: 'db-metric' },
        h('span', { class: 'db-label' }, 'Pop. Under Autoc.'),
        h('span', { class: 'db-value regime-closed' }, `${populationUnderAutocracy}M`),
      ),
    );

    const countrySection = h('div', { class: 'db-countries' });
    for (const c of rankByScore(countries)) {
      const row = h(
        'div',
        { class: `db-country-row ${regimeClass(c.regime)}` },
        h(
          'div',
          { class: 'db-country-header' },
          h('span', { class: 'db-country' }, safeHtml(c.country)),
          h('span', { class: `db-regime-badge ${regimeClass(c.regime)}` }, safeHtml(c.regime)),
          h('span', { class: `db-trend ${trendClass(c.trend)}` }, trendArrow(c.trend)),
          h('span', { class: 'db-score' }, `${(c.vdemScore * 100).toFixed(0)}/100`),
          h(
            'span',
            {
              class: 'db-delta',
              style: c.trendDeltaYr < 0 ? 'color:var(--sev-high)' : 'color:var(--sev-ok)',
            },
            `${c.trendDeltaYr >= 0 ? '+' : ''}${(c.trendDeltaYr * 100).toFixed(1)}pts/3yr`,
          ),
        ),
        h('div', { class: 'db-erosion' }, safeHtml(c.keyErosionEvent)),
      );
      countrySection.appendChild(row);
    }

    const eventSection = h('div', { class: 'db-events' },
      h('h3', { class: 'db-section-title' }, 'Recent Backsliding Events'),
    );
    for (const ev of [...events].sort((a, b) => b.severity - a.severity)) {
      const row = h(
        'div',
        { class: 'db-event-row' },
        h(
          'div',
          { class: 'db-event-header' },
          h('span', { class: 'db-event-country' }, safeHtml(ev.country)),
          h('span', { class: 'db-event-cat' }, safeHtml(ev.category)),
          h('span', { class: 'db-event-date' }, safeHtml(ev.date)),
          ev.ongoing ? h('span', { class: 'db-ongoing' }, 'ONGOING') : h('span', {}),
        ),
        h('div', { class: 'db-event-desc' }, safeHtml(ev.description)),
      );
      eventSection.appendChild(row);
    }

    this.replaceChildren(header, countrySection, eventSection);
  }
}
