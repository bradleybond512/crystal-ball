import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  healthClass,
  defectionClass,
  impactClass,
  rankByCohesion,
} from './coalition-dynamics-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class CoalitionDynamicsPanel extends Panel {
  static readonly panelId = 'coalition-dynamics';
  static readonly title = 'Coalition Dynamics';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: CoalitionDynamicsPanel.panelId,
      title: CoalitionDynamicsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks 10 major geopolitical coalitions (NATO, AUKUS, QUAD, Five Eyes, Ukraine Support, ' +
        'Axis of Resistance, SCO, Abraham Accords, G7, BRICS+) with cohesion scores, defection ' +
        'risks, fault lines, and recent events.',
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
      coalitions,
      events,
      globalCoalitionIndex,
      strengtheningCount,
      fracturingCount,
      criticalDefectionCount,
    } = data;

    this.setCount(fracturingCount + criticalDefectionCount);

    let idxClass: string;
    if (globalCoalitionIndex >= 70) {
      idxClass = 'health-strong';
    } else if (globalCoalitionIndex >= 50) {
      idxClass = 'health-stable';
    } else {
      idxClass = 'health-stressed';
    }

    const header = h('div', { className: 'cd-header' },
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Coalition Index'),
        h('span', { className: `cd-value ${idxClass}` }, `${globalCoalitionIndex}/100`),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Strengthening'),
        h('span', { className: 'cd-value health-strong' }, String(strengtheningCount)),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Stressed/Fracturing'),
        h('span', { className: 'cd-value health-stressed' }, String(fracturingCount)),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'High Defection Risk'),
        h('span', { className: 'cd-value def-high' }, String(criticalDefectionCount)),
      ),
    );

    const coalSection = h('div', { className: 'cd-coalitions' });
    for (const c of rankByCohesion(coalitions)) {
      const hc = healthClass(c.health);
      const dc = defectionClass(c.defectionRisk);
      const memberPreview = c.members.length > 6
        ? `${c.members.slice(0, 6).join(', ')}…`
        : c.members.join(', ');
      const row = h('div', { className: `cd-coal-row ${hc}` },
        h('div', { className: 'cd-coal-header' },
          h('span', { className: 'cd-coal-name' }, c.name),
          h('span', { className: `cd-health-badge ${hc}` }, c.health),
          h('span', { className: `cd-def-badge ${dc}` }, `Defection: ${c.defectionRisk}`),
          h('span', { className: 'cd-cohesion' }, `Cohesion: ${c.cohesionScore}/10`),
          h('span', { className: 'cd-type' }, c.type),
        ),
        h('div', { className: 'cd-members' },
          `${c.members.length} members: ${memberPreview}`,
        ),
        h('div', { className: 'cd-fault-line' }, `⚠ ${c.keyFaultLine}`),
        h('div', { className: 'cd-development' }, c.recentDevelopment),
      );
      coalSection.append(row);
    }

    const eventSection = h('div', { className: 'cd-events' },
      h('h3', { className: 'cd-section-title' }, 'Recent Coalition Events'),
    );
    const sortedEvents = [...events].sort((a, b) => b.severity - a.severity);
    for (const ev of sortedEvents) {
      const ic = impactClass(ev.impact);
      const row = h('div', { className: `cd-event-row ${ic}` },
        h('div', { className: 'cd-event-header' },
          h('span', { className: 'cd-event-coalition' }, ev.coalition),
          h('span', { className: 'cd-event-type' }, ev.eventType),
          h('span', { className: `cd-impact ${ic}` }, ev.impact),
          h('span', { className: 'cd-event-date' }, ev.date),
        ),
        h('div', { className: 'cd-event-desc' }, ev.description),
      );
      eventSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, coalSection, eventSection);
  }
}
