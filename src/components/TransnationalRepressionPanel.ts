import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  methodClass,
  severityClass,
  tierClass,
  trendClass,
  getSeverityCategory,
} from './transnational-repression-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class TransnationalRepressionPanel extends Panel {
  static readonly panelId = 'transnational-repression';
  static readonly title = 'Transnational Repression';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: TransnationalRepressionPanel.panelId,
      title: TransnationalRepressionPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks states targeting their own citizens abroad via assassination, poisoning, rendition, digital surveillance, and harassment. Covers 12 major incidents (2018-2024) across 10 actor states.',
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
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
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
      incidents,
      actors,
      globalRepressionIndex,
      criticalCount,
      highCount,
      activeActorCount,
    } = data;

    this.setCount(criticalCount + highCount);

    let idxClass: string;
    if (globalRepressionIndex >= 80) {
      idxClass = 'sev-critical';
    } else if (globalRepressionIndex >= 60) {
      idxClass = 'sev-high';
    } else if (globalRepressionIndex >= 40) {
      idxClass = 'sev-medium';
    } else {
      idxClass = 'sev-low';
    }

    const header = h('div', { className: 'tr-header' },
      h('div', { className: 'tr-metric' },
        h('span', { className: 'tr-label' }, 'Repression Index'),
        h('span', { className: `tr-value ${idxClass}` }, `${globalRepressionIndex}/100`),
      ),
      h('div', { className: 'tr-metric' },
        h('span', { className: 'tr-label' }, 'Critical'),
        h('span', { className: 'tr-value sev-critical' }, String(criticalCount)),
      ),
      h('div', { className: 'tr-metric' },
        h('span', { className: 'tr-label' }, 'High'),
        h('span', { className: 'tr-value sev-high' }, String(highCount)),
      ),
      h('div', { className: 'tr-metric' },
        h('span', { className: 'tr-label' }, 'Active Actors'),
        h('span', { className: 'tr-value sev-medium' }, String(activeActorCount)),
      ),
    );

    const actorSection = h('div', { className: 'tr-actors' },
      h('h3', { className: 'tr-section-title' }, 'Actor Profiles'),
    );

    for (const actor of [...actors].sort((a, b) => b.reintensityScore - a.reintensityScore)) {
      const row = h('div', { className: `tr-actor-row ${tierClass(actor.tier)}` },
        h('div', { className: 'tr-actor-header' },
          h('span', { className: 'tr-country' }, actor.country),
          h('span', { className: `tr-tier-badge ${tierClass(actor.tier)}` }, actor.tier),
          h('span', { className: `tr-trend ${trendClass(actor.trend)}` },
            actor.trend === 'escalating' ? '↑' : actor.trend === 'declining' ? '↓' : '→',
          ),
          h('span', { className: 'tr-score' }, `Score: ${actor.reintensityScore}/100`),
          h('span', { className: 'tr-fh' }, actor.freedomHouseRating),
        ),
        h('div', { className: 'tr-methods' }, `Methods: ${actor.knownMethods.join(', ')}`),
        h('div', { className: 'tr-reach' }, `Reach: ${actor.operationalReach.join(', ')}`),
      );
      actorSection.append(row);
    }

    const incidentSection = h('div', { className: 'tr-incidents' },
      h('h3', { className: 'tr-section-title' }, 'Documented Incidents'),
    );

    for (const inc of [...incidents].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { className: `tr-incident-row ${severityClass(inc.severity)}` },
        h('div', { className: 'tr-incident-header' },
          h('span', { className: 'tr-actor' }, inc.actor),
          h('span', { className: `tr-method-badge ${methodClass(inc.method)}` }, inc.method),
          h('span', { className: `tr-sev-badge ${severityClass(inc.severity)}` },
            getSeverityCategory(inc.severity),
          ),
          h('span', { className: 'tr-date' }, inc.date),
          h('span', { className: 'tr-loc' }, inc.location),
        ),
        h('div', { className: 'tr-target' }, `Target: ${inc.target}`),
        h('div', { className: 'tr-desc' }, inc.description),
        h('div', { className: 'tr-outcome' }, `Outcome: ${inc.outcome}`),
      );
      incidentSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, actorSection, incidentSection);
  }
}
