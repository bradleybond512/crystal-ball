import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  impactClass,
  eventTypeClass,
  getImpactCategory,
} from './foreign-aid-weaponization-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class ForeignAidWeaponizationPanel extends Panel {
  static readonly panelId = 'foreign-aid-weaponization';
  static readonly title = 'Foreign Aid Weaponization';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ForeignAidWeaponizationPanel.panelId,
      title: ForeignAidWeaponizationPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks foreign aid as a geopolitical weapon: cuts, conditions, redirections, and weaponization by major donor states. ' +
        'Covers 12 major events (2021-2025) across USA USAID freeze, China BRI conditionality, ' +
        'EU migration conditionality, Gulf state leverage, Russia grain weaponization, and more.',
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
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
      events,
      donors,
      weaponizationIndex,
      highImpactCount,
      activeConditionCount,
    } = data;

    this.setCount(highImpactCount);

    let idxClass: string;
    if (weaponizationIndex >= 80) {
      idxClass = 'imp-critical';
    } else if (weaponizationIndex >= 60) {
      idxClass = 'imp-high';
    } else if (weaponizationIndex >= 40) {
      idxClass = 'imp-medium';
    } else {
      idxClass = 'imp-low';
    }

    const header = h('div', { className: 'faw-header' },
      h('div', { className: 'faw-metric' },
        h('span', { className: 'faw-label' }, 'Weaponization Index'),
        h('span', { className: 'faw-value ' + idxClass }, weaponizationIndex + '/100'),
      ),
      h('div', { className: 'faw-metric' },
        h('span', { className: 'faw-label' }, 'High Impact Events'),
        h('span', { className: 'faw-value imp-high' }, String(highImpactCount)),
      ),
      h('div', { className: 'faw-metric' },
        h('span', { className: 'faw-label' }, 'Active Conditions'),
        h('span', { className: 'faw-value imp-medium' }, String(activeConditionCount)),
      ),
      h('div', { className: 'faw-metric' },
        h('span', { className: 'faw-label' }, 'Donors Tracked'),
        h('span', { className: 'faw-value' }, String(donors.length)),
      ),
    );

    const donorSection = h('div', { className: 'faw-donors' },
      h('h3', { className: 'faw-section-title' }, 'Major Donor Profiles'),
    );

    for (const donor of [...donors].sort((a, b) => b.annualAidBillionUSD - a.annualAidBillionUSD)) {
      let trendArrow = '\u2192';
      let trendCls = 'trend-flat';
      if (donor.trend === 'escalating') { trendArrow = '\u2191'; trendCls = 'trend-up'; }
      else if (donor.trend === 'declining') { trendArrow = '\u2193'; trendCls = 'trend-down'; }

      const row = h('div', { className: 'faw-donor-row' },
        h('div', { className: 'faw-donor-header' },
          h('span', { className: 'faw-donor-name' }, donor.name),
          h('span', { className: 'faw-category-badge' }, donor.category),
          h('span', { className: 'faw-trend ' + trendCls }, trendArrow),
          h('span', { className: 'faw-amount' }, '$' + donor.annualAidBillionUSD + 'B/yr'),
        ),
        h('div', { className: 'faw-leverage' }, 'Leverage: ' + donor.leverageTypes.join(', ')),
        h('div', { className: 'faw-instruments' }, 'Instruments: ' + donor.keyInstruments.join(', ')),
        h('div', { className: 'faw-conditionality' }, donor.conditionality),
      );
      donorSection.append(row);
    }

    const eventSection = h('div', { className: 'faw-events' },
      h('h3', { className: 'faw-section-title' }, 'Aid Weaponization Events'),
    );

    for (const evt of [...events].sort((a, b) => b.impactScore - a.impactScore)) {
      const row = h('div', { className: 'faw-event-row ' + impactClass(evt.impactScore) },
        h('div', { className: 'faw-event-header' },
          h('span', { className: 'faw-donor-tag' }, evt.donor),
          h('span', { className: 'faw-event-type ' + eventTypeClass(evt.eventType) }, evt.eventType),
          h('span', { className: 'faw-impact-badge ' + impactClass(evt.impactScore) },
            getImpactCategory(evt.impactScore),
          ),
          h('span', { className: 'faw-date' }, evt.date),
          evt.active ? h('span', { className: 'faw-active-badge' }, 'ACTIVE') : h('span', {}),
        ),
        h('div', { className: 'faw-recipient' }, 'Target: ' + evt.recipient),
        h('div', { className: 'faw-desc' }, evt.description),
        h('div', { className: 'faw-geo-effect' }, 'Geopolitical Effect: ' + evt.geopoliticalEffect),
      );
      eventSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, donorSection, eventSection);
  }
}
