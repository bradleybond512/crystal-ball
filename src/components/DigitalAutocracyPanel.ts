import { Panel } from './Panel';
import {
  buildRenderData,
  getMostRestrictive,
  getWorseningCountries,
  categoryCssClass,
  incidentSeverityClass,
  trendIcon,
  type CountryCensorship,
  type CensorshipIncident,
} from './digital-autocracy-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class DigitalAutocracyPanel extends Panel {
  static panelId = 'digital-autocracy';
  static title = 'Digital Autocracy';

  constructor() {
    super(DigitalAutocracyPanel.panelId, DigitalAutocracyPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const { countries, incidents, globalFreedomIndex, notFreeCount, partlyFreeCount, freeCount, totalBlockedPlatforms, populationUnderRepression } = data;

    const header = h('div', { class: 'da-header' },
      h('div', { class: 'da-metric' },
        h('span', { class: 'da-label' }, 'Global Freedom'),
        h('span', { class: `da-value ${globalFreedomIndex < 40 ? 'sev-critical' : globalFreedomIndex < 60 ? 'sev-high' : 'sev-low'}` }, `${globalFreedomIndex}/100`),
      ),
      h('div', { class: 'da-metric' },
        h('span', { class: 'da-label' }, 'Not Free'),
        h('span', { class: 'da-value cat-not-free' }, String(notFreeCount)),
      ),
      h('div', { class: 'da-metric' },
        h('span', { class: 'da-label' }, 'Partly Free'),
        h('span', { class: 'da-value cat-partly' }, String(partlyFreeCount)),
      ),
      h('div', { class: 'da-metric' },
        h('span', { class: 'da-label' }, 'Blocked Platforms'),
        h('span', { class: 'da-value sev-high' }, String(totalBlockedPlatforms)),
      ),
      h('div', { class: 'da-metric' },
        h('span', { class: 'da-label' }, 'Population Repressed'),
        h('span', { class: 'da-value sev-critical' }, `${populationUnderRepression.toLocaleString()}M`),
      ),
    );

    const countrySection = h('div', { class: 'da-countries' });
    for (const c of [...countries].sort((a, b) => a.freedomScore - b.freedomScore)) {
      const row = h('div', { class: `da-country-row ${categoryCssClass(c.category)}` },
        h('span', { class: 'da-country-name' }, safeHtml(c.country)),
        h('span', { class: `da-category ${categoryCssClass(c.category)}` }, safeHtml(c.category)),
        h('span', { class: 'da-score' }, `${c.freedomScore}/100`),
        h('span', { class: 'da-trend' }, trendIcon(c.trend)),
        c.socialCredit ? h('span', { class: 'da-sc-badge' }, 'Social Credit') : h('span', {}),
        h('span', { class: 'da-vpn' }, `VPN: ${safeHtml(c.vpnUsage)}`),
      );
      countrySection.appendChild(row);
    }

    const incidentSection = h('div', { class: 'da-incidents' },
      h('h3', { class: 'da-section-title' }, 'Recent Censorship Incidents'),
    );
    for (const inc of incidents) {
      const row = h('div', { class: `da-incident-row ${incidentSeverityClass(inc.severity)}` },
        h('div', { class: 'da-incident-header' },
          h('span', { class: 'da-incident-country' }, safeHtml(inc.country)),
          h('span', { class: `da-incident-type` }, safeHtml(inc.type)),
          h('span', { class: `da-sev-badge ${incidentSeverityClass(inc.severity)}` }, safeHtml(inc.severity)),
          h('span', { class: 'da-date' }, safeHtml(inc.date)),
        ),
        h('div', { class: 'da-incident-desc' }, safeHtml(inc.description)),
      );
      incidentSection.appendChild(row);
    }

    this.replaceChildren(header, countrySection, incidentSection);
  }
}
