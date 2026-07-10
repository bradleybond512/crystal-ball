import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  actionClass,
  tensionClass,
  outcomeClass,
  rankByTension,
} from './coercive-diplomacy-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class CoerciveDiplomacyPanel extends Panel {
  static readonly panelId = 'coercive-diplomacy';
  static readonly title = 'Coercive Diplomacy';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: CoerciveDiplomacyPanel.panelId,
      title: CoerciveDiplomacyPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks state-to-state diplomatic coercion: ambassador expulsions, consulate closures, travel bans, diplomatic downgrades, and economic threats linked to diplomatic pressure.',
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
      incidents,
      tensions,
      globalDiplomaticStabilityIndex,
      totalExpulsions,
      activeIncidents,
      highSeverityCount,
    } = data;

    this.setCount(activeIncidents);

    let idxClass: string;
    if (globalDiplomaticStabilityIndex < 30) {
      idxClass = 'cd-stability-critical';
    } else if (globalDiplomaticStabilityIndex < 60) {
      idxClass = 'cd-stability-strained';
    } else {
      idxClass = 'cd-stability-stable';
    }

    const header = h('div', { className: 'cd-header' },
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Stability Index'),
        h('span', { className: `cd-value ${idxClass}` }, `${globalDiplomaticStabilityIndex}/100`),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Active'),
        h('span', { className: 'cd-value cd-stability-critical' }, String(activeIncidents)),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'Expulsions'),
        h('span', { className: 'cd-value cd-stability-strained' }, String(totalExpulsions)),
      ),
      h('div', { className: 'cd-metric' },
        h('span', { className: 'cd-label' }, 'High Severity'),
        h('span', { className: 'cd-value cd-stability-critical' }, String(highSeverityCount)),
      ),
    );

    const incidentSection = h('div', { className: 'cd-incidents' },
      h('h3', { className: 'cd-section-title' }, 'Coercion Incidents'),
    );

    for (const inc of [...incidents].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { className: `cd-incident-row ${actionClass(inc.actionType)}` },
        h('div', { className: 'cd-incident-header' },
          h('span', { className: 'cd-actor' }, inc.actor),
          h('span', { className: 'cd-arrow' }, '\u2192'),
          h('span', { className: 'cd-target' }, inc.target),
          h('span', { className: `cd-action-badge ${actionClass(inc.actionType)}` }, inc.actionType),
          h('span', { className: `cd-outcome-badge ${outcomeClass(inc.outcome)}` }, inc.outcome),
          h('span', { className: 'cd-date' }, inc.date),
          h('span', { className: 'cd-severity' }, `Sev: ${inc.severity}`),
        ),
        h('div', { className: 'cd-incident-desc' }, inc.description),
      );
      incidentSection.append(row);
    }

    const tensionSection = h('div', { className: 'cd-tensions' },
      h('h3', { className: 'cd-section-title' }, 'Active Bilateral Tensions'),
    );

    for (const t of rankByTension(tensions)) {
      const row = h('div', { className: `cd-tension-row ${tensionClass(t.status)}` },
        h('div', { className: 'cd-tension-header' },
          h('span', { className: 'cd-parties' }, `${t.partyA} / ${t.partyB}`),
          h('span', { className: `cd-status-badge ${tensionClass(t.status)}` }, t.status),
          h('span', { className: 'cd-tension-score' }, `${t.tensionScore}/100`),
        ),
        h('div', { className: 'cd-grievance' }, t.primaryGrievance),
      );
      tensionSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, incidentSection, tensionSection);
  }
}
