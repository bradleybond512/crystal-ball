import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  stabilityClass,
  trendClass,
  trendArrow,
  outcomeClass,
} from './regime-stability-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class RegimeStabilityPanel extends Panel {
  static readonly panelId = 'regime-stability';
  static readonly title = 'Regime Stability';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: RegimeStabilityPanel.panelId,
      title: RegimeStabilityPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks government fragility across 15 states using FSI scores, coup risk, elite coherence, and economic grievance metrics. Includes recent regime change events.',
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
      states,
      events,
      globalInstabilityIndex,
      collapsedCount,
      crisisCount,
      fragileCount,
      highCoupRiskCount,
    } = data;

    this.setCount(collapsedCount + crisisCount);

    let idxClass: string;
    if (globalInstabilityIndex >= 60) {
      idxClass = 'stab-collapsed';
    } else if (globalInstabilityIndex >= 40) {
      idxClass = 'stab-crisis';
    } else {
      idxClass = 'stab-fragile';
    }

    const header = h('div', { className: 'rs-header' },
      h('div', { className: 'rs-metric' },
        h('span', { className: 'rs-label' }, 'Instability Index'),
        h('span', { className: `rs-value ${idxClass}` }, `${globalInstabilityIndex}/100`),
      ),
      h('div', { className: 'rs-metric' },
        h('span', { className: 'rs-label' }, 'Collapsed'),
        h('span', { className: 'rs-value stab-collapsed' }, String(collapsedCount)),
      ),
      h('div', { className: 'rs-metric' },
        h('span', { className: 'rs-label' }, 'Crisis'),
        h('span', { className: 'rs-value stab-crisis' }, String(crisisCount)),
      ),
      h('div', { className: 'rs-metric' },
        h('span', { className: 'rs-label' }, 'Fragile'),
        h('span', { className: 'rs-value stab-fragile' }, String(fragileCount)),
      ),
      h('div', { className: 'rs-metric' },
        h('span', { className: 'rs-label' }, 'High Coup Risk'),
        h('span', { className: 'rs-value stab-crisis' }, String(highCoupRiskCount)),
      ),
    );

    const stateSection = h('div', { className: 'rs-states' },
      h('h3', { className: 'rs-section-title' }, 'Regime Fragility Index'),
    );

    for (const s of [...states].sort((a, b) => b.fsiScore - a.fsiScore)) {
      const row = h('div', { className: `rs-state-row ${stabilityClass(s.stabilityCategory)}` },
        h('div', { className: 'rs-state-header' },
          h('span', { className: 'rs-country' }, s.country),
          h('span', { className: `rs-cat-badge ${stabilityClass(s.stabilityCategory)}` }, s.stabilityCategory),
          h('span', { className: `rs-trend ${trendClass(s.trend)}` }, trendArrow(s.trend)),
          h('span', { className: 'rs-fsi' }, `FSI: ${s.fsiScore}`),
          h('span', { className: 'rs-govt' }, s.governmentType),
        ),
        h('div', { className: 'rs-key-risk' }, s.keyRisk),
        h('div', { className: 'rs-scores' },
          h('span', {}, `Coup: ${s.coupRiskScore}/10`),
          h('span', {}, `Economy: ${s.economicGrievanceScore}/10`),
          h('span', {}, `External: ${s.externalInterventionRisk ? 'Yes' : 'No'}`),
        ),
      );
      stateSection.append(row);
    }

    const eventSection = h('div', { className: 'rs-events' },
      h('h3', { className: 'rs-section-title' }, 'Recent Regime Change Events'),
    );

    for (const ev of [...events].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { className: `rs-event-row ${outcomeClass(ev.outcome)}` },
        h('div', { className: 'rs-event-header' },
          h('span', { className: 'rs-event-country' }, ev.country),
          h('span', { className: 'rs-event-type' }, ev.eventType),
          h('span', { className: `rs-outcome-badge ${outcomeClass(ev.outcome)}` }, ev.outcome),
          h('span', { className: 'rs-event-date' }, ev.date),
        ),
        h('div', { className: 'rs-event-desc' }, ev.description),
      );
      eventSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, stateSection, eventSection);
  }
}
