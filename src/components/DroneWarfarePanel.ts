import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  proliferationClass,
  maturityClass,
  incidentTypeClass,
} from './drone-warfare-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function buildExportStr(destinations: string[]): string {
  const shown = destinations.slice(0, 5).join(', ');
  const extra = destinations.length > 5 ? ` +${destinations.length - 5} more` : '';
  return `Exporting to: ${shown}${extra}`;
}

export class DroneWarfarePanel extends Panel {
  static readonly panelId = 'drone-warfare';
  static readonly title = 'Drone Warfare';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: DroneWarfarePanel.panelId,
      title: DroneWarfarePanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks drone proliferation and combat use across 8 state and non-state actors. Covers key programs, platforms, export networks, and 12 significant drone incidents 2020\u20132024.',
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
      programs,
      incidents,
      globalDroneIndex,
      proliferationScore,
      combatUsageScore,
      topActors,
    } = data;

    this.setCount(incidents.filter(i => i.ongoing).length);

    let idxClass: string;
    if (globalDroneIndex >= 70) {
      idxClass = 'drone-advanced';
    } else if (globalDroneIndex >= 40) {
      idxClass = 'drone-developing';
    } else {
      idxClass = 'drone-nascent';
    }

    const header = h('div', { className: 'dw-header' },
      h('div', { className: 'dw-metric' },
        h('span', { className: 'dw-label' }, 'Drone Index'),
        h('span', { className: `dw-value ${idxClass}` }, `${globalDroneIndex}/100`),
      ),
      h('div', { className: 'dw-metric' },
        h('span', { className: 'dw-label' }, 'Proliferation'),
        h('span', { className: 'dw-value drone-advanced' }, `${proliferationScore}%`),
      ),
      h('div', { className: 'dw-metric' },
        h('span', { className: 'dw-label' }, 'Combat Use'),
        h('span', { className: 'dw-value drone-advanced' }, `${combatUsageScore}%`),
      ),
      h('div', { className: 'dw-metric' },
        h('span', { className: 'dw-label' }, 'Active Actors'),
        h('span', { className: 'dw-value' }, String(topActors.length)),
      ),
    );

    const programSection = h('div', { className: 'dw-programs' },
      h('h3', { className: 'dw-section-title' }, 'Drone Programs'),
    );

    const maturityOrder: Record<string, number> = { Advanced: 0, Developing: 1, Nascent: 2 };
    for (const p of [...programs].sort((a, b) => (maturityOrder[a.maturityLevel] ?? 2) - (maturityOrder[b.maturityLevel] ?? 2))) {
      const row = h('div', { className: `dw-program-row ${maturityClass(p.maturityLevel)}` },
        h('div', { className: 'dw-program-header' },
          h('span', { className: 'dw-country' }, p.country),
          h('span', { className: `dw-mat-badge ${proliferationClass(p.maturityLevel)}` }, p.maturityLevel),
          h('span', { className: 'dw-type-badge' }, p.type),
          p.combatExperience
            ? h('span', { className: 'dw-combat-badge' }, 'Combat \u2713')
            : h('span', { className: 'dw-no-combat-badge' }, 'No combat'),
        ),
        h('div', { className: 'dw-platforms' }, `Platforms: ${p.keyPlatforms.join(', ')}`),
        // eslint-disable-next-line sonarjs/no-nested-template-literals
        p.exportingTo.length === 0
          ? h('div', { className: 'dw-exports dw-no-export' }, 'Not exporting')
          : h('div', { className: 'dw-exports' }, buildExportStr(p.exportingTo)),
        h('div', { className: 'dw-description' }, p.description),
      );
      programSection.append(row);
    }

    const incidentSection = h('div', { className: 'dw-incidents' },
      h('h3', { className: 'dw-section-title' }, 'Significant Drone Incidents'),
    );

    for (const inc of [...incidents].sort((a, b) => b.significance - a.significance)) {
      const ongoingBadge = inc.ongoing
        ? h('span', { className: 'dw-ongoing-badge' }, 'Ongoing')
        : null;
      const children = [
        h('div', { className: 'dw-incident-header' },
          h('span', { className: 'dw-actor' }, inc.actor),
          h('span', { className: `dw-itype-badge ${incidentTypeClass(inc.type)}` }, inc.type),
          h('span', { className: 'dw-sig' }, `Sig: ${inc.significance}/10`),
          h('span', { className: 'dw-inc-date' }, inc.date),
        ),
        h('div', { className: 'dw-target' }, `Target: ${inc.target}`),
        h('div', { className: 'dw-inc-platform' }, `Platform: ${inc.platform}`),
        h('div', { className: 'dw-inc-desc' }, inc.description),
      ];
      if (ongoingBadge) children[0]!.append(ongoingBadge);
      const row = h('div', { className: `dw-incident-row ${incidentTypeClass(inc.type)}` }, ...children);
      incidentSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, programSection, incidentSection);
  }
}
