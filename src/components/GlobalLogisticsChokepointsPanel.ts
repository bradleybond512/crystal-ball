import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  threatLevelClass,
  statusClass,
} from './global-logistics-chokepoints-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class GlobalLogisticsChokepointsPanel extends Panel {
  static readonly panelId = 'global-logistics-chokepoints';
  static readonly title = 'Global Logistics Chokepoints';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: GlobalLogisticsChokepointsPanel.panelId,
      title: GlobalLogisticsChokepointsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks 12 strategic maritime and land logistics chokepoints. Monitors threat levels, disruption status, controlling actors, and a criticality-weighted global disruption index.',
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
      chokepoints,
      globalDisruptionIndex,
      criticalCount,
      disruptedCount,
      mostThreatenedRegion,
    } = data;

    this.setCount(disruptedCount + criticalCount);

    let idxClass: string;
    if (globalDisruptionIndex >= 50) {
      idxClass = 'threat-critical';
    } else if (globalDisruptionIndex >= 30) {
      idxClass = 'threat-high';
    } else if (globalDisruptionIndex >= 15) {
      idxClass = 'threat-elevated';
    } else {
      idxClass = 'threat-low';
    }

    const header = h(
      'div',
      { className: 'glcp-header' },
      h(
        'div',
        { className: 'glcp-metric' },
        h('span', { className: 'glcp-label' }, 'Disruption Index'),
        h('span', { className: `glcp-value ${idxClass}` }, `${globalDisruptionIndex}/100`),
      ),
      h(
        'div',
        { className: 'glcp-metric' },
        h('span', { className: 'glcp-label' }, 'Critical'),
        h('span', { className: 'glcp-value threat-critical' }, String(criticalCount)),
      ),
      h(
        'div',
        { className: 'glcp-metric' },
        h('span', { className: 'glcp-label' }, 'Disrupted'),
        h('span', { className: 'glcp-value status-disrupted' }, String(disruptedCount)),
      ),
      h(
        'div',
        { className: 'glcp-metric' },
        h('span', { className: 'glcp-label' }, 'Most Threatened'),
        h('span', { className: 'glcp-value threat-high' }, mostThreatenedRegion),
      ),
    );

    const chokeSection = h(
      'div',
      { className: 'glcp-chokepoints' },
      h('h3', { className: 'glcp-section-title' }, 'Chokepoints by Criticality'),
    );

    const sorted = [...chokepoints].sort((a, b) => b.criticalityScore - a.criticalityScore);

    for (const c of sorted) {
      const actors = c.controllingActors.join(', ');
      const alts = c.alternatives.join(' / ');

      const rowChildren: Node[] = [
        h(
          'div',
          { className: 'glcp-row-header' },
          h('span', { className: 'glcp-name' }, c.name),
          h('span', { className: 'glcp-type' }, c.type),
          h('span', { className: `glcp-threat-badge ${threatLevelClass(c.threatLevel)}` }, c.threatLevel),
          h('span', { className: `glcp-status-badge ${statusClass(c.currentStatus)}` }, c.currentStatus),
          h('span', { className: 'glcp-criticality' }, `${c.criticalityScore}/10`),
        ),
        h('div', { className: 'glcp-throughput' }, c.throughputNote),
        h('div', { className: 'glcp-actors' }, `Actors: ${actors}`),
      ];

      if (c.currentIncident) {
        rowChildren.push(h('div', { className: 'glcp-incident' }, c.currentIncident));
      }

      rowChildren.push(h('div', { className: 'glcp-alternatives' }, `Alt: ${alts}`));

      const row = h('div', { className: `glcp-row ${threatLevelClass(c.threatLevel)}` }, ...rowChildren);
      chokeSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, chokeSection);
  }
}
