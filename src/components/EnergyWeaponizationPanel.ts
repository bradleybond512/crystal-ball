import { Panel } from './Panel';
import {
  buildRenderData,
  rankBySeverity,
  getHighRiskDependencies,
  riskLevelClass,
  actionClass,
  type EnergyDependency,
  type EnergyCoercionEvent,
} from './energy-weaponization-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class EnergyWeaponizationPanel extends Panel {
  static panelId = 'energy-weaponization';
  static title = 'Energy Weaponization';

  constructor() {
    super(EnergyWeaponizationPanel.panelId, EnergyWeaponizationPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const { dependencies, events, globalEnergyRiskIndex, ongoingCoercionCount, criticalDependencyCount, totalHistoricImpactBn } = data;

    const header = h('div', { class: 'ew-header' },
      h('div', { class: 'ew-metric' },
        h('span', { class: 'ew-label' }, 'Energy Risk Index'),
        h('span', { class: `ew-value ${globalEnergyRiskIndex >= 60 ? 'risk-critical' : globalEnergyRiskIndex >= 40 ? 'risk-high' : 'risk-medium'}` }, `${globalEnergyRiskIndex}/100`),
      ),
      h('div', { class: 'ew-metric' },
        h('span', { class: 'ew-label' }, 'Ongoing Coercion'),
        h('span', { class: 'ew-value risk-critical' }, String(ongoingCoercionCount)),
      ),
      h('div', { class: 'ew-metric' },
        h('span', { class: 'ew-label' }, 'Critical Dependencies'),
        h('span', { class: 'ew-value risk-critical' }, String(criticalDependencyCount)),
      ),
      h('div', { class: 'ew-metric' },
        h('span', { class: 'ew-label' }, 'Historic Impact'),
        h('span', { class: 'ew-value risk-high' }, `$${totalHistoricImpactBn.toLocaleString()}B`),
      ),
    );

    const depSection = h('div', { class: 'ew-section' },
      h('h3', { class: 'ew-section-title' }, 'Energy Dependencies'),
    );
    for (const dep of [...dependencies].sort((a, b) => b.dependencyPct - a.dependencyPct)) {
      const row = h('div', { class: `ew-dep-row ${riskLevelClass(dep.riskLevel)}` },
        h('span', { class: 'ew-dep-pair' }, `${safeHtml(dep.importer)} ← ${safeHtml(dep.exporter)}`),
        h('span', { class: 'ew-dep-commodity' }, safeHtml(dep.commodity)),
        h('span', { class: 'ew-dep-pct' }, `${dep.dependencyPct}%`),
        h('span', { class: `ew-dep-risk ${riskLevelClass(dep.riskLevel)}` }, safeHtml(dep.riskLevel)),
        h('span', { class: 'ew-dep-alt' }, dep.alternativeExists ? '✓ Alt available' : '✗ No alternative'),
      );
      depSection.appendChild(row);
    }

    const eventSection = h('div', { class: 'ew-section' },
      h('h3', { class: 'ew-section-title' }, 'Coercion Events'),
    );
    for (const ev of rankBySeverity(events)) {
      const row = h('div', { class: `ew-event-row ${ev.ongoing ? 'ew-ongoing' : ''}` },
        h('div', { class: 'ew-event-header' },
          h('span', { class: 'ew-event-actor' }, safeHtml(ev.actor)),
          h('span', { class: 'ew-arrow' }, ' → '),
          h('span', { class: 'ew-event-target' }, safeHtml(ev.target)),
          h('span', { class: `ew-action-badge ${actionClass(ev.action)}` }, safeHtml(ev.action)),
          ev.ongoing ? h('span', { class: 'ew-ongoing-badge' }, 'ONGOING') : h('span', {}),
          h('span', { class: 'ew-event-date' }, safeHtml(ev.date)),
        ),
        h('div', { class: 'ew-event-desc' }, safeHtml(ev.description)),
        h('div', { class: 'ew-event-meta' },
          h('span', { class: 'ew-severity' }, `Severity: ${ev.severityScore}/10`),
          h('span', { class: 'ew-impact' }, `Est. impact: $${ev.estimatedImpactBn}B`),
        ),
      );
      eventSection.appendChild(row);
    }

    this.replaceChildren(header, depSection, eventSection);
  }
}
