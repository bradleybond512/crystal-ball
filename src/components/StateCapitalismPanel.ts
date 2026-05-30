/**
 * StateCapitalismPanel (panel id: `state-capitalism`).
 *
 * Tracks state-owned enterprises (SOEs) as geopolitical instruments.
 * China's SOEs are explicitly weaponized for strategic goals; Russia uses
 * Gazprom and Rosneft as foreign policy tools; Gulf states deploy
 * Aramco/Mubadala strategically.
 *
 * Pure logic lives in `state-capitalism-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  functionClass,
  riskClass,
  type SOE,
  type SOEIncident,
  type StateCapitalismCountry,
} from './state-capitalism-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class StateCapitalismPanel extends Panel {
  static readonly panelId = 'state-capitalism';
  static readonly title   = 'State Capitalism';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: StateCapitalismPanel.panelId,
      title: StateCapitalismPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks state-owned enterprises (SOEs) as geopolitical instruments. ' +
        'Covers 12 strategic SOEs across China, Russia, Gulf states, and France ' +
        'with revenue data, strategic functions, risk ratings, and key incidents (2019–2024). ' +
        'Includes state capitalism index by country (0–100).',
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
      soes,
      incidents,
      stateCapitalismIndex,
      criticalCount,
      highRiskCount,
      totalRevenueTrillion,
      topCountryByControl,
    } = data;

    this.setCount(criticalCount + highRiskCount);

    // ── Header metrics ──────────────────────────────────────────────────────
    const header = h('div', { className: 'sc-header' },
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'Critical Risk'),
        h('span', { className: 'sc-value sc-risk-critical' }, String(criticalCount)),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'High Risk'),
        h('span', { className: 'sc-value sc-risk-high' }, String(highRiskCount)),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'Total Revenue'),
        h('span', { className: 'sc-value' }, `$${totalRevenueTrillion}T`),
      ),
      h('div', { className: 'sc-metric' },
        h('span', { className: 'sc-label' }, 'Highest Control'),
        h('span', { className: 'sc-value sc-risk-critical' }, topCountryByControl),
      ),
    );

    // ── SOE table ───────────────────────────────────────────────────────────
    const tableSection = sectionHeader('Strategic SOEs', countBadge(soes.length, 'entities'));

    const tableEl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;text-align:left;font-size:11px' }, 'Entity'),
      h('th', { style: 'padding:4px 6px;text-align:left;font-size:11px' }, 'Country'),
      h('th', { style: 'padding:4px 6px;text-align:left;font-size:11px' }, 'Sector'),
      h('th', { style: 'padding:4px 6px;text-align:right;font-size:11px' }, 'Rev $B'),
      h('th', { style: 'padding:4px 6px;text-align:left;font-size:11px' }, 'Function'),
      h('th', { style: 'padding:4px 6px;text-align:left;font-size:11px' }, 'Risk'),
    ));
    tableEl.append(thead);

    const tbody = h('tbody');
    const riskOrder: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    for (const soe of [...soes].sort(
      (a, b) => (riskOrder[a.geopoliticalRisk] ?? 4) - (riskOrder[b.geopoliticalRisk] ?? 4),
    )) {
      const tr = h('tr', { title: soe.description },
        cell(soe.name, 'font-weight:600'),
        cell(soe.country),
        cell(soe.sector),
        cell(`$${soe.revenueUSD}B`, 'text-align:right'),
        cell(soe.strategicFunction, 'color:var(--text-muted);font-size:11px'),
        h('td', { style: 'padding:3px 6px' },
          h('span', { className: `sc-risk-badge ${riskClass(soe.geopoliticalRisk)}` }, soe.geopoliticalRisk),
        ),
      );
      tbody.append(tr);
    }
    tableEl.append(tbody);

    // ── Incidents ───────────────────────────────────────────────────────────
    const incidentSection = sectionHeader('SOE Geopolitical Incidents', countBadge(incidents.length, 'events'));
    for (const inc of [...incidents].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { className: 'sc-incident-row' },
        h('div', { className: 'sc-incident-header' },
          h('span', { className: 'sc-incident-entity' }, inc.entity),
          h('span', { className: 'sc-incident-type' }, inc.incidentType),
          h('span', { className: 'sc-incident-country' }, inc.country),
          h('span', { className: 'sc-incident-date' }, inc.date),
          h('span', {
            className: `sc-severity sc-sev-${inc.severity >= 9 ? 'critical' : inc.severity >= 7 ? 'high' : 'medium'}`,
          }, `Sev ${inc.severity}/10`),
        ),
        h('div', { className: 'sc-incident-desc' }, inc.description),
      );
      incidentSection.append(row);
    }

    // ── State Capitalism Index ──────────────────────────────────────────────
    const indexSection = sectionHeader('State Capitalism Index by Country');
    const indexTable  = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' });
    const indexTbody  = h('tbody');
    for (const c of [...stateCapitalismIndex].sort((a, b) => b.index - a.index)) {
      const barColor =
        c.index >= 80 ? '#b71c1c' :
        c.index >= 60 ? '#e65100' :
        c.index >= 40 ? '#f9a825' : '#388e3c';
      const tr = h('tr', { title: c.description },
        cell(c.country, 'font-weight:600;width:100px'),
        h('td', { style: 'padding:3px 6px;width:100%' },
          h('div', {
            style: `background:${barColor};height:8px;width:${c.index}%;border-radius:2px;min-width:2px`,
          }),
        ),
        cell(String(c.index), 'text-align:right;width:36px;font-weight:600'),
      );
      indexTbody.append(tr);
    }
    indexTable.append(indexTbody);
    indexSection.append(indexTable);

    replaceChildren(
      this.getContentElement(),
      header,
      tableSection,
      tableEl,
      incidentSection,
      indexSection,
    );
  }
}
