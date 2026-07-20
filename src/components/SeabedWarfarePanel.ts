import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  threatLevelClass,
  incidentTypeClass,
} from './seabed-warfare-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class SeabedWarfarePanel extends Panel {
  static readonly panelId = 'seabed-warfare';
  static readonly title = 'Seabed Warfare';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: SeabedWarfarePanel.panelId,
      title: SeabedWarfarePanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks critical seabed infrastructure vulnerability: submarine cables, pipelines, power cables, and sensor networks. Monitors sabotage incidents, threat actors, and seabed risk index.',
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
      assets,
      incidents,
      globalSeabedRiskIndex,
      criticalAssetCount,
      highThreatCount,
      recentIncidentCount,
    } = data;

    this.setCount(criticalAssetCount);

    let idxClass: string;
    if (globalSeabedRiskIndex >= 60) {
      idxClass = 'threat-critical';
    } else if (globalSeabedRiskIndex >= 40) {
      idxClass = 'threat-high';
    } else {
      idxClass = 'threat-elevated';
    }

    const header = h('div', { className: 'sw-header' },
      h('div', { className: 'sw-metric' },
        h('span', { className: 'sw-label' }, 'Seabed Risk'),
        h('span', { className: `sw-value ${idxClass}` }, `${globalSeabedRiskIndex}/100`),
      ),
      h('div', { className: 'sw-metric' },
        h('span', { className: 'sw-label' }, 'Critical Assets'),
        h('span', { className: 'sw-value threat-critical' }, String(criticalAssetCount)),
      ),
      h('div', { className: 'sw-metric' },
        h('span', { className: 'sw-label' }, 'High Threat'),
        h('span', { className: 'sw-value threat-high' }, String(highThreatCount)),
      ),
      h('div', { className: 'sw-metric' },
        h('span', { className: 'sw-label' }, 'Incidents'),
        h('span', { className: 'sw-value' }, String(recentIncidentCount)),
      ),
    );

    const assetSection = h('div', { className: 'sw-assets' },
      h('h3', { className: 'sw-section-title' }, 'Critical Seabed Infrastructure'),
    );

    for (const a of [...assets].sort((x, y) => y.criticalityScore - x.criticalityScore)) {
      const row = h('div', { className: `sw-asset-row ${threatLevelClass(a.threatLevel)}` },
        h('div', { className: 'sw-asset-header' },
          h('span', { className: 'sw-asset-name' }, a.name),
          h('span', { className: 'sw-asset-type' }, a.type),
          h('span', { className: `sw-threat-badge ${threatLevelClass(a.threatLevel)}` }, a.threatLevel),
          h('span', { className: 'sw-crit' }, `Crit: ${a.criticalityScore}/10`),
        ),
        h('div', { className: 'sw-route' }, a.route),
        h('div', { className: 'sw-capacity' }, a.capacityNote),
        h('div', { className: 'sw-actors' }, `Threat actors: ${a.threatActors.join(', ')}`),
      );
      assetSection.append(row);
    }

    const incSection = h('div', { className: 'sw-incidents' },
      h('h3', { className: 'sw-section-title' }, 'Incidents & Attacks'),
    );

    for (const inc of [...incidents].sort((a, b) => b.impactSeverity - a.impactSeverity)) {
      const resolvedEl = inc.resolved
        ? h('span', { className: 'sw-resolved' }, 'RESOLVED')
        : h('span', { className: 'sw-unresolved' }, 'UNRESOLVED');
      const row = h('div', { className: `sw-inc-row ${incidentTypeClass(inc.type)}` },
        h('div', { className: 'sw-inc-header' },
          h('span', { className: 'sw-inc-type' }, inc.type),
          h('span', { className: 'sw-inc-loc' }, inc.location),
          h('span', { className: 'sw-inc-attr' }, inc.attribution),
          h('span', { className: 'sw-inc-date' }, inc.date),
          resolvedEl,
        ),
        h('div', { className: 'sw-inc-actor' }, `Actor: ${inc.suspectedActor}`),
        h('div', { className: 'sw-inc-desc' }, inc.description),
      );
      incSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, assetSection, incSection);
  }
}
