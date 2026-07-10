import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  severityClass,
  trendClass,
  attackTypeClass,
} from './maritime-piracy-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class MaritimePiracyPanel extends Panel {
  static readonly panelId = 'maritime-piracy';
  static readonly title = 'Maritime Piracy';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: MaritimePiracyPanel.panelId,
      title: MaritimePiracyPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks maritime piracy, armed robbery at sea, and sea-based terrorism globally. Monitors 7 high-risk hotspots including the critical Red Sea/Houthi threat corridor.',
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

    const { hotspots, incidents, globalPiracyIndex, totalIncidentsYTD, highRiskRegions, crewsAtRisk } = data;

    this.setCount(highRiskRegions.length);

    let idxClass: string;
    if (globalPiracyIndex >= 70) {
      idxClass = 'sev-critical';
    } else if (globalPiracyIndex >= 50) {
      idxClass = 'sev-high';
    } else if (globalPiracyIndex >= 30) {
      idxClass = 'sev-medium';
    } else {
      idxClass = 'sev-low';
    }

    const header = h('div', { className: 'mp-header' },
      h('div', { className: 'mp-metric' },
        h('span', { className: 'mp-label' }, 'Piracy Index'),
        h('span', { className: 'mp-value ' + idxClass }, globalPiracyIndex + '/100'),
      ),
      h('div', { className: 'mp-metric' },
        h('span', { className: 'mp-label' }, 'Incidents/yr'),
        h('span', { className: 'mp-value sev-high' }, String(totalIncidentsYTD)),
      ),
      h('div', { className: 'mp-metric' },
        h('span', { className: 'mp-label' }, 'High-Risk Zones'),
        h('span', { className: 'mp-value sev-critical' }, String(highRiskRegions.length)),
      ),
      h('div', { className: 'mp-metric' },
        h('span', { className: 'mp-label' }, 'Crews at Risk'),
        h('span', { className: 'mp-value sev-high' }, String(crewsAtRisk)),
      ),
    );

    const hotspotSection = h('div', { className: 'mp-hotspots' },
      h('h3', { className: 'mp-section-title' }, 'Piracy Hotspots'),
    );

    const severityOrder: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
    for (const spot of [...hotspots].sort(
      (a, b) => (severityOrder[b.severityLevel] ?? 0) - (severityOrder[a.severityLevel] ?? 0),
    )) {
      const row = h('div', { className: 'mp-hotspot-row ' + severityClass(spot.severityLevel) },
        h('div', { className: 'mp-hotspot-header' },
          h('span', { className: 'mp-region' }, spot.region),
          h('span', { className: 'mp-sev-badge ' + severityClass(spot.severityLevel) }, spot.severityLevel),
          h('span', { className: 'mp-trend ' + trendClass(spot.trend) }, spot.trend),
          h('span', { className: 'mp-incidents' }, spot.annualIncidents + '/yr'),
        ),
        h('div', { className: 'mp-tactics' }, spot.primaryTactics.join(' | ')),
        h('div', { className: 'mp-groups' }, spot.primaryGroups.join(', ')),
        h('div', { className: 'mp-description' }, spot.description),
        h('div', { className: 'mp-impact' }, 'Economic impact: $' + spot.economicImpactBn + 'B/yr'),
      );
      hotspotSection.append(row);
    }

    const incidentSection = h('div', { className: 'mp-incidents-section' },
      h('h3', { className: 'mp-section-title' }, 'Notable Incidents (2023-2024)'),
    );

    for (const inc of [...incidents].sort((a, b) => b.significance - a.significance)) {
      const row = h('div', { className: 'mp-incident-row ' + attackTypeClass(inc.attackType) },
        h('div', { className: 'mp-incident-header' },
          h('span', { className: 'mp-ship-type' }, inc.shipType),
          h('span', { className: 'mp-attack-badge ' + attackTypeClass(inc.attackType) }, inc.attackType),
          h('span', { className: 'mp-outcome' }, inc.outcome),
          h('span', { className: 'mp-incident-date' }, inc.date),
          h('span', { className: 'mp-sig' }, 'Sig: ' + inc.significance + '/10'),
        ),
        h('div', { className: 'mp-incident-region' }, inc.region),
        h('div', { className: 'mp-incident-desc' }, inc.description),
      );
      incidentSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, hotspotSection, incidentSection);
  }
}
