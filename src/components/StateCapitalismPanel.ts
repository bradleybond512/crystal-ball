import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  functionClass,
  riskClass,
  type StrategicSOE,
  type SOEIncident,
} from './state-capitalism-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

const RISK_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const COUNTRY_INDEX: [string, number][] = [
  ['China', 92], ['Russia', 88], ['Saudi Arabia', 75], ['UAE', 65],
  ['France', 45], ['South Korea', 35], ['Germany', 25], ['USA', 20],
];

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function scoreClass(score: number): string {
  if (score >= 75) return 'risk-critical';
  if (score >= 50) return 'risk-high';
  return 'risk-medium';
}

function severityClass(severity: number): string {
  if (severity >= 9) return 'risk-critical';
  if (severity >= 7) return 'risk-high';
  return 'risk-medium';
}

function renderIndexSection(): HTMLElement {
  const section = h('div', { className: 'sc-index-section' },
    h('h3', { className: 'sc-section-title' }, 'State Capitalism Index by Country'),
  );
  for (const [country, score] of COUNTRY_INDEX) {
    const cls = scoreClass(score);
    section.append(
      h('div', { className: 'sc-index-row' },
        h('span', { className: 'sc-idx-country' }, country),
        h('div', { className: 'sc-bar-track' },
          h('div', { className: `sc-bar-fill ${cls}`, style: `width:${score}%` }),
        ),
        h('span', { className: `sc-idx-score ${cls}` }, String(score)),
      ),
    );
  }
  return section;
}

function renderSoeSection(soes: StrategicSOE[]): HTMLElement {
  const section = h('div', { className: 'sc-soe-section' },
    h('h3', { className: 'sc-section-title' }, 'Strategic State-Owned Enterprises'),
  );
  for (const soe of [...soes].sort(
    (a, b) => (RISK_ORDER[a.geopoliticalRiskLevel] ?? 9) - (RISK_ORDER[b.geopoliticalRiskLevel] ?? 9),
  )) {
    section.append(
      h('div', { className: `sc-soe-row ${riskClass(soe.geopoliticalRiskLevel)}` },
        h('div', { className: 'sc-soe-header' },
          h('span', { className: 'sc-soe-name' }, soe.name),
          h('span', { className: `sc-risk-badge ${riskClass(soe.geopoliticalRiskLevel)}` }, soe.geopoliticalRiskLevel),
          h('span', { className: `sc-fn-badge ${functionClass(soe.strategicFunction)}` }, soe.strategicFunction),
          h('span', { className: 'sc-country' }, soe.country),
          h('span', { className: 'sc-sector' }, soe.sector),
          h('span', { className: 'sc-revenue' }, `$${soe.annualRevenueBn}B`),
        ),
        h('div', { className: 'sc-soe-desc' }, soe.description),
        h('div', { className: 'sc-incident-note' }, soe.recentIncident),
      ),
    );
  }
  return section;
}

function renderIncidentSection(incidents: SOEIncident[]): HTMLElement {
  const section = h('div', { className: 'sc-incident-section' },
    h('h3', { className: 'sc-section-title' }, 'SOE Incident Log'),
  );
  for (const inc of [...incidents].sort((a, b) => b.severity - a.severity)) {
    const cls = severityClass(inc.severity);
    section.append(
      h('div', { className: `sc-inc-row ${cls}` },
        h('div', { className: 'sc-inc-header' },
          h('span', { className: 'sc-inc-soe' }, inc.soe),
          h('span', { className: 'sc-inc-type' }, inc.incidentType),
          h('span', { className: `sc-sev-badge ${cls}` }, `Sev ${inc.severity}`),
          h('span', { className: 'sc-inc-date' }, inc.date),
        ),
        h('div', { className: 'sc-inc-desc' }, inc.description),
      ),
    );
  }
  return section;
}

export class StateCapitalismPanel extends Panel {
  static readonly panelId = 'state-capitalism';
  static readonly title = 'State Capitalism';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: StateCapitalismPanel.panelId,
      title: StateCapitalismPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks state-owned enterprises as geopolitical instruments across 8 countries. Maps 12 strategic SOEs by function (energy leverage, port access, tech espionage, sanctions evasion, market dominance, defense export), risk level, and recent incidents.',
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

    const { soes, incidents, stateCapIndex, criticalRiskCount, highRiskCount, topCountryByControl } = data;
    this.setCount(criticalRiskCount + highRiskCount);

    const idxClass = scoreClass(stateCapIndex);
    const header = h('div', { className: 'sc-header' },
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'State Cap Index'),
        h('span', { className: `sc-value ${idxClass}` }, `${stateCapIndex}/100`),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'Critical Risk'),
        h('span', { className: 'sc-value risk-critical' }, String(criticalRiskCount)),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'High Risk'),
        h('span', { className: 'sc-value risk-high' }, String(highRiskCount)),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'Top Actor'),
        h('span', { className: 'sc-value' }, topCountryByControl),
      ),
    );

    replaceChildren(
      this.getContentElement(),
      header,
      renderIndexSection(),
      renderSoeSection(soes),
      renderIncidentSection(incidents),
    );
  }
}
