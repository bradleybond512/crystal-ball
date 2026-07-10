import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  gdpPercentClass,
  trendClass,
  trendArrow,
} from './global-military-spending-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class GlobalMilitarySpendingPanel extends Panel {
  static readonly panelId = 'global-military-spending';
  static readonly title = 'Global Military Spending';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: GlobalMilitarySpendingPanel.panelId,
      title: GlobalMilitarySpendingPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks global defense expenditure across 15 major powers with SIPRI-inspired 2024 data. Includes rearmament index, arms race hotspots, NATO 2% compliance, and key procurement events.',
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
      countries,
      hotspots,
      events,
      globalRearmamentIndex,
      rearmingCount,
      natoComplianceRate,
      totalGlobalSpendingBn,
    } = data;

    this.setCount(rearmingCount);

    let idxClass: string;
    if (globalRearmamentIndex >= 70) {
      idxClass = 'mil-critical';
    } else if (globalRearmamentIndex >= 40) {
      idxClass = 'mil-high';
    } else {
      idxClass = 'mil-moderate';
    }

    const header = h('div', { className: 'gms-header' },
      h('div', { className: 'gms-metric' },
        h('span', { className: 'gms-label' }, 'Rearmament Index'),
        h('span', { className: `gms-value ${idxClass}` }, `${globalRearmamentIndex}/100`),
      ),
      h('div', { className: 'gms-metric' },
        h('span', { className: 'gms-label' }, 'Global Spending'),
        h('span', { className: 'gms-value' }, `$${Math.round(totalGlobalSpendingBn)}B`),
      ),
      h('div', { className: 'gms-metric' },
        h('span', { className: 'gms-label' }, 'Surging (\u226510% YoY)'),
        h('span', { className: 'gms-value mil-critical' }, String(rearmingCount)),
      ),
      h('div', { className: 'gms-metric' },
        h('span', { className: 'gms-label' }, 'NATO 2% Compliance'),
        h('span', { className: `gms-value ${natoComplianceRate >= 80 ? 'mil-moderate' : 'mil-high'}` }, `${natoComplianceRate}%`),
      ),
    );

    const countrySection = h('div', { className: 'gms-countries' },
      h('h3', { className: 'gms-section-title' }, 'Defense Budgets by Country'),
    );

    for (const c of [...countries].sort((a, b) => b.budgetBn - a.budgetBn)) {
      const row = h('div', { className: `gms-country-row ${gdpPercentClass(c.gdpPercent)}` },
        h('div', { className: 'gms-country-header' },
          h('span', { className: 'gms-country' }, c.country),
          h('span', { className: 'gms-budget' }, `$${c.budgetBn}B`),
          h('span', { className: `gms-gdp ${gdpPercentClass(c.gdpPercent)}` }, `${c.gdpPercent}% GDP`),
          h('span', { className: `gms-trend ${trendClass(c.trend)}` },
            `${trendArrow(c.trend)} ${c.yoyChangePct > 0 ? '+' : ''}${c.yoyChangePct}% YoY`,
          ),
          ...(c.natoMember ? [h('span', { className: 'gms-nato-badge' }, 'NATO')] : []),
        ),
        h('div', { className: 'gms-focus' }, c.procurementFocus.slice(0, 3).join(' \u00B7 ')),
        h('div', { className: 'gms-notes' }, c.notes),
      );
      countrySection.append(row);
    }

    const hotspotSection = h('div', { className: 'gms-hotspots' },
      h('h3', { className: 'gms-section-title' }, 'Arms Race Hotspots'),
    );

    for (const hs of [...hotspots].sort((a, b) => b.severity - a.severity)) {
      let sevClass = 'mil-moderate';
      if (hs.severity >= 9) sevClass = 'mil-critical';
      else if (hs.severity >= 7) sevClass = 'mil-high';
      const row = h('div', { className: `gms-hotspot-row ${sevClass}` },
        h('div', { className: 'gms-hotspot-header' },
          h('span', { className: 'gms-hotspot-region' }, hs.region),
          h('span', { className: `gms-severity ${sevClass}` }, `Severity: ${hs.severity}/10`),
        ),
        h('div', { className: 'gms-hotspot-desc' }, hs.description),
        h('div', { className: 'gms-hotspot-driver' }, `Driver: ${hs.drivingForce}`),
      );
      hotspotSection.append(row);
    }

    const eventSection = h('div', { className: 'gms-events' },
      h('h3', { className: 'gms-section-title' }, 'Key Procurement Events'),
    );

    for (const ev of [...events].sort((a, b) => b.valueUsdBn - a.valueUsdBn)) {
      const row = h('div', { className: 'gms-event-row' },
        h('div', { className: 'gms-event-header' },
          h('span', { className: 'gms-event-program' }, ev.program),
          h('span', { className: 'gms-event-value' }, `$${ev.valueUsdBn}B`),
          h('span', { className: 'gms-event-cat' }, ev.category),
          h('span', { className: 'gms-event-date' }, ev.date),
        ),
        h('div', { className: 'gms-event-countries' }, ev.countries.join(', ')),
        h('div', { className: 'gms-event-desc' }, ev.description),
      );
      eventSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, countrySection, hotspotSection, eventSection);
  }
}
