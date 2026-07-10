import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  sectorRiskClass,
  caseStatusClass,
  riskLevelClass,
  complianceClass,
  rankByRisk,
} from './tech-transfer-risk-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class TechTransferRiskPanel extends Panel {
  static readonly panelId = 'tech-transfer-risk';
  static readonly title = 'Tech Transfer Risk';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: TechTransferRiskPanel.panelId,
      title: TechTransferRiskPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks technology transfer risk, export control enforcement, and state-sponsored acquisition of sensitive technologies including semiconductors, AI/ML, quantum, biotech, hypersonics, radar/DEW, nuclear, and space systems. Covers BIS Entity List additions, acquisition cases, and export compliance scores.',
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
      cases,
      bisEntries,
      sectors,
      exportScores,
      globalRiskIndex,
      activeCases,
      criticalCases,
      sanctionedEntities,
      highRiskSectors,
    } = data;

    this.setCount(activeCases + criticalCases);

    let idxClass: string;
    if (globalRiskIndex >= 80) {
      idxClass = 'ttr-risk-critical';
    } else if (globalRiskIndex >= 60) {
      idxClass = 'ttr-risk-high';
    } else if (globalRiskIndex >= 40) {
      idxClass = 'ttr-risk-medium';
    } else {
      idxClass = 'ttr-risk-low';
    }

    const header = h('div', { className: 'ttr-header' },
      h('div', { className: 'ttr-metric' },
        h('span', { className: 'ttr-label' }, 'Global Risk Index'),
        h('span', { className: `ttr-value ${idxClass}` }, `${globalRiskIndex}/100`),
      ),
      h('div', { className: 'ttr-metric' },
        h('span', { className: 'ttr-label' }, 'Active/Investigating'),
        h('span', { className: 'ttr-value ttr-risk-high' }, String(activeCases)),
      ),
      h('div', { className: 'ttr-metric' },
        h('span', { className: 'ttr-label' }, 'Critical Cases'),
        h('span', { className: 'ttr-value ttr-risk-critical' }, String(criticalCases)),
      ),
      h('div', { className: 'ttr-metric' },
        h('span', { className: 'ttr-label' }, 'BIS Entities'),
        h('span', { className: 'ttr-value ttr-status-sanctioned' }, String(sanctionedEntities)),
      ),
      h('div', { className: 'ttr-metric' },
        h('span', { className: 'ttr-label' }, 'High-Risk Sectors'),
        h('span', { className: 'ttr-value ttr-risk-high' }, String(highRiskSectors.length)),
      ),
    );

    const sectorSection = h('div', { className: 'ttr-sectors' },
      h('h3', { className: 'ttr-section-title' }, 'Sensitive Tech Sector Leakage Risk'),
    );
    for (const sec of [...sectors].sort((a, b) => b.leakageRisk - a.leakageRisk)) {
      const row = h('div', { className: `ttr-sector-row ${sectorRiskClass(sec.leakageRisk)}` },
        h('div', { className: 'ttr-sector-header' },
          h('span', { className: 'ttr-sector-name' }, sec.name),
          h('span', { className: `ttr-sector-risk ${sectorRiskClass(sec.leakageRisk)}` }, `${sec.leakageRisk}%`),
          h('span', { className: 'ttr-sector-incidents' }, `${sec.recentIncidents} incidents`),
          h('span', { className: 'ttr-sector-crit' }, `Crit: ${sec.criticalityScore}/10`),
        ),
        h('div', { className: 'ttr-sector-threats' }, sec.primaryThreats.join(' · ')),
        h('div', { className: 'ttr-sector-ctrl' }, `Controlled by: ${sec.controlledBy.join(', ')}`),
      );
      sectorSection.append(row);
    }

    const caseSection = h('div', { className: 'ttr-cases' },
      h('h3', { className: 'ttr-section-title' }, 'Tech Transfer Cases & Enforcement Actions'),
    );
    for (const c of rankByRisk(cases)) {
      const techTags = c.targetTech.map(t =>
        h('span', { className: 'ttr-tech-tag' }, t),
      );
      const row = h('div', { className: `ttr-case-row ${riskLevelClass(c.riskLevel)}` },
        h('div', { className: 'ttr-case-header' },
          h('span', { className: `ttr-risk-badge ${riskLevelClass(c.riskLevel)}` }, c.riskLevel),
          h('span', { className: 'ttr-case-country' }, c.actorCountry),
          h('span', { className: `ttr-status-badge ${caseStatusClass(c.status)}` }, c.status),
          h('span', { className: 'ttr-case-date' }, c.date),
          h('span', { className: 'ttr-actor-type' }, c.actorType),
        ),
        h('div', { className: 'ttr-case-title' }, c.title),
        h('div', { className: 'ttr-case-desc' }, c.description),
        h('div', { className: 'ttr-tech-tags' }, ...techTags),
        h('div', { className: 'ttr-method' }, `Method: ${c.transferMethod}`),
        h('div', { className: 'ttr-impact' }, `Impact: ${c.estimatedImpact}`),
      );
      caseSection.append(row);
    }

    const bisSection = h('div', { className: 'ttr-bis' },
      h('h3', { className: 'ttr-section-title' }, 'BIS Entity List — Key Additions 2019–2024'),
    );
    for (const entry of bisEntries) {
      const row = h('div', { className: 'ttr-bis-row' },
        h('div', { className: 'ttr-bis-header' },
          h('span', { className: 'ttr-bis-entity' }, entry.entity),
          h('span', { className: 'ttr-bis-country' }, entry.country),
          h('span', { className: 'ttr-bis-date' }, entry.addedDate),
        ),
        h('div', { className: 'ttr-bis-reason' }, entry.reason),
        h('div', { className: 'ttr-bis-cats' }, entry.techCategory.join(', ')),
      );
      bisSection.append(row);
    }

    const exportSection = h('div', { className: 'ttr-export' },
      h('h3', { className: 'ttr-section-title' }, 'Export Control Compliance Scores'),
    );
    for (const score of [...exportScores].sort((a, b) => b.complianceScore - a.complianceScore)) {
      const row = h('div', { className: `ttr-export-row ${complianceClass(score.complianceScore)}` },
        h('div', { className: 'ttr-export-header' },
          h('span', { className: 'ttr-export-country' }, score.country),
          h('span', { className: `ttr-comply-badge ${complianceClass(score.complianceScore)}` }, `${score.complianceScore}/100`),
          h('span', { className: 'ttr-export-violations' }, `Violations '24: ${score.violations2024}`),
        ),
        h('div', { className: 'ttr-export-memberships' }, score.multilateralMemberships.length
          ? score.multilateralMemberships.join(', ')
          : 'No multilateral memberships',
        ),
      );
      exportSection.append(row);
    }

    replaceChildren(
      this.getContentElement(),
      header,
      sectorSection,
      caseSection,
      bisSection,
      exportSection,
    );
  }
}
