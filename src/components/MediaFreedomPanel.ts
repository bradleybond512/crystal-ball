import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  freedomClass,
  trendClass,
  trendArrow,
  incidentStatusClass,
} from './media-freedom-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class MediaFreedomPanel extends Panel {
  static readonly panelId = 'media-freedom';
  static readonly title = 'Media Freedom';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: MediaFreedomPanel.panelId,
      title: MediaFreedomPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks press freedom across 17 countries using RSF index scores, CPJ journalist imprisonment data, and major media incidents. Includes trend analysis and high-risk country identification.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(
        this.getContentElement(),
        h('div', { className: 'panel-empty' }, 'Data unavailable'),
      );
      return;
    }

    const {
      countries,
      incidents,
      globalFreedomIndex,
      freeCount,
      goodCount,
      difficultCount,
      verySeriousCount,
      totalJailed,
      decliningCount,
    } = data;

    // Badge count = countries rated Difficult or Very Serious
    this.setCount(difficultCount + verySeriousCount);

    let idxClass: string;
    if (globalFreedomIndex < 30) {
      idxClass = 'mf-very-serious';
    } else if (globalFreedomIndex < 50) {
      idxClass = 'mf-difficult';
    } else if (globalFreedomIndex < 65) {
      idxClass = 'mf-problematic';
    } else {
      idxClass = 'mf-satisfactory';
    }

    const header = h('div', { className: 'mf-header' },
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'Global Index'),
        h('span', { className: `mf-value ${idxClass}` }, `${globalFreedomIndex}/100`),
      ),
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'Free/Good'),
        h('span', { className: 'mf-value mf-free' }, String(freeCount + goodCount)),
      ),
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'At Risk'),
        h('span', { className: 'mf-value mf-difficult' }, String(difficultCount)),
      ),
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'Very Serious'),
        h('span', { className: 'mf-value mf-very-serious' }, String(verySeriousCount)),
      ),
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'Jailed'),
        h('span', { className: 'mf-value mf-very-serious' }, String(totalJailed)),
      ),
      h('div', { className: 'mf-metric' },
        h('span', { className: 'mf-label' }, 'Declining'),
        h('span', { className: 'mf-value mf-difficult' }, String(decliningCount)),
      ),
    );

    const countrySection = h('div', { className: 'mf-countries' },
      h('h3', { className: 'mf-section-title' }, 'Press Freedom Index by Country'),
    );

    for (const c of [...countries].sort((a, b) => b.rsfScore - a.rsfScore)) {
      const jailEl = c.journalistsJailed > 0
        ? h('span', { className: 'mf-jailed' }, `⚠ ${c.journalistsJailed} jailed`)
        : h('span', {});
      const row = h('div', { className: `mf-country-row ${freedomClass(c.category)}` },
        h('div', { className: 'mf-country-header' },
          h('span', { className: 'mf-country' }, c.country),
          h('span', { className: `mf-cat-badge ${freedomClass(c.category)}` }, c.category),
          h('span', { className: `mf-trend ${trendClass(c.trend)}` }, trendArrow(c.trend)),
          h('span', { className: 'mf-score' }, `${c.rsfScore}/100`),
          jailEl,
        ),
        h('div', { className: 'mf-notes' }, c.notes),
      );
      countrySection.append(row);
    }

    const incidentSection = h('div', { className: 'mf-incidents' },
      h('h3', { className: 'mf-section-title' }, 'Major Press Freedom Incidents (2022–2024)'),
    );

    for (const inc of [...incidents].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { className: `mf-incident-row ${incidentStatusClass(inc.status)}` },
        h('div', { className: 'mf-incident-header' },
          h('span', { className: 'mf-incident-country' }, inc.country),
          h('span', { className: 'mf-incident-subject' }, inc.subject),
          h('span', { className: `mf-status-badge ${incidentStatusClass(inc.status)}` }, inc.status),
          h('span', { className: 'mf-incident-date' }, inc.date),
        ),
        h('div', { className: 'mf-incident-desc' }, inc.description),
      );
      incidentSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, countrySection, incidentSection);
  }
}
