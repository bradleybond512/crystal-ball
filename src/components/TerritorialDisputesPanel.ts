import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  phaseBadgeClass,
  trendArrow,
  severityClass,
} from './territorial-disputes-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class TerritorialDisputesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'territorial-disputes',
      title: 'Territorial Disputes',
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks active territorial disputes worldwide — phases, diplomatic trends, nuclear risk, and a global tension index.',
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
      disputes,
      globalTensionIndex,
      activeWarCount,
      frozenConflictCount,
      escalatingCount,
      nuclearRiskCount,
    } = data;

    this.setCount(activeWarCount + escalatingCount);

    const tensionCls =
      globalTensionIndex >= 60 ? 'sev-critical' :
      globalTensionIndex >= 40 ? 'sev-high' : 'sev-medium';

    // Header metrics row
    const header = h('div', { className: 'td-header' },
      h('div', { className: 'td-metric' },
        h('span', { className: 'td-metric-label' }, 'Global Tension'),
        h('span', { className: `td-metric-value ${tensionCls}` }, `${globalTensionIndex}/100`),
      ),
      h('div', { className: 'td-metric' },
        h('span', { className: 'td-metric-label' }, 'Active Wars'),
        h('span', { className: 'td-metric-value phase-war' }, String(activeWarCount)),
      ),
      h('div', { className: 'td-metric' },
        h('span', { className: 'td-metric-label' }, 'Escalating'),
        h('span', { className: 'td-metric-value phase-escalating' }, String(escalatingCount)),
      ),
      h('div', { className: 'td-metric' },
        h('span', { className: 'td-metric-label' }, '☢ Nuclear Risk'),
        h('span', { className: 'td-metric-value sev-critical' }, String(nuclearRiskCount)),
      ),
      h('div', { className: 'td-metric' },
        h('span', { className: 'td-metric-label' }, 'Frozen'),
        h('span', { className: 'td-metric-value phase-frozen' }, String(frozenConflictCount)),
      ),
    );

    // Dispute cards
    const cards = h('div', { className: 'td-disputes' });
    for (const d of disputes) {
      const nuclearEl = d.nuclearRisk
        ? h('span', { className: 'td-nuclear-badge' }, '☢')
        : h('span', {});

      const card = h('div', { className: `td-card ${severityClass(d.severityScore)}` },
        h('div', { className: 'td-card-header' },
          h('span', { className: 'td-dispute-name' }, d.name),
          h('span', { className: `td-phase-badge ${phaseBadgeClass(d.phase)}` }, d.phase),
          h('span', { className: 'td-trend' }, trendArrow(d.trend)),
          nuclearEl,
        ),
        h('div', { className: 'td-parties' }, d.parties.join(' · ')),
        h('div', { className: 'td-area' }, d.disputedArea),
        h('div', { className: 'td-development' }, d.keyDevelopment),
        h('div', { className: 'td-meta' },
          h('span', { className: 'td-region' }, d.region),
          h('span', { className: `td-sev ${severityClass(d.severityScore)}` }, `Severity: ${d.severityScore}/10`),
        ),
      );
      cards.appendChild(card);
    }

    replaceChildren(this.getContentElement(), header, cards);
  }
}
