/**
 * PrivateMilitaryPanel (panel id: `private-military`).
 *
 * Analytical monitoring surface for publicly reported indicators about
 * private military contractor (PMC) and mercenary group activity. This
 * panel exists to surface patterns that already appear in open-source
 * reporting — UN panel of experts findings, sanctions designations,
 * OSINT flight tracking, port AIS, and government contract notices.
 *
 * Framing invariant: every section presents "indicators observed",
 * "events reported", or "patterns to monitor". The panel does not
 * generate recruitment guidance, recommended contracting strategies,
 * or operational mercenary playbooks. A regex-based framing audit in
 * `tests/components/private-military-panel.test.mts` guards this.
 *
 * Six sections:
 *   1. PMC/mercenary deployment tracker by region.
 *   2. State sponsorship mapping with a 4-tier confidence ladder.
 *   3. Reported operational casualty events.
 *   4. Publicly reported contract awards.
 *   5. Regulatory action / ban events.
 *   6. Proxy warfare logistics indicators.
 *
 * All scoring + classification lives in `private-military-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  // Section 1
  countSignificantDeployments,
  deploymentsByRegion,
  activityScaleColor,
  activityScaleLabel,
  // Section 2
  countHighConfidenceSponsorships,
  sponsorConfidenceColor,
  sponsorConfidenceLabel,
  // Section 3
  classifyCasualtySeverity,
  casualtyKindLabel,
  casualtySeverityColor,
  casualtySeverityLabel,
  countRecentCasualties,
  totalRecentReportedCount,
  // Section 4
  contractTypeLabel,
  totalContractValueUsdM,
  // Section 5
  regulatoryActionLabel,
  regulatoryActionColor,
  countRecentActions,
  // Section 6
  logisticsIndicatorLabel,
  logisticsConfidenceLabel,
  logisticsConfidenceColor,
  highConfidenceLogisticsCount,
  // Aggregate
  totalAlertCount,
  PMC_DEPLOYMENTS,
  SPONSORSHIP_LINKS,
  CASUALTY_EVENTS,
  CONTRACT_AWARDS,
  REGULATORY_ACTIONS,
  LOGISTICS_OBSERVATIONS,
  REFERENCE_NOW_MS,
  type PmcDeployment,
  type SponsorshipLink,
  type CasualtyEvent,
  type ContractAward,
  type RegulatoryAction,
  type LogisticsObservation,
} from './private-military-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, count?: number): HTMLElement {
  const header = h('div', { className: 'pmp-section-header', style: 'font-weight:600;font-size:13px;margin:10px 0 4px 0' }, title);
  if (typeof count === 'number' && count > 0) {
    header.append(h('span', {
      style: 'margin-left:6px;font-size:10px;background:#b91c1c;color:#fff;border-radius:10px;padding:1px 6px',
    }, String(count)));
  }
  return header;
}

function tierBadge(text: string, bg: string): HTMLElement {
  return h('span', {
    style: `display:inline-block;background:${bg};color:#fff;padding:1px 6px;border-radius:3px;font-size:11px`,
  }, text);
}

function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export class PrivateMilitaryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'private-military',
      title: 'Private Military Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Analytical monitoring of publicly reported indicators about private military contractor and mercenary group activity: deployment patterns by region, state-sponsorship mapping, reported casualty events, publicly disclosed contracts, regulatory actions, and proxy-warfare logistics indicators.',
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
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    const deployments = PMC_DEPLOYMENTS;
    const sponsorships = SPONSORSHIP_LINKS;
    const casualties = CASUALTY_EVENTS;
    const contracts = CONTRACT_AWARDS;
    const actions = REGULATORY_ACTIONS;
    const logistics = LOGISTICS_OBSERVATIONS;
    const nowMs = Date.now() || REFERENCE_NOW_MS;

    this.setCount(totalAlertCount({ deployments, casualties, actions, logistics, nowMs }));

    const root = h('div', { className: 'pmp' });
    root.append(this.renderHeader(deployments, sponsorships, casualties, actions, logistics, nowMs));
    root.append(this.renderFramingNote());
    root.append(this.renderDeployments(deployments));
    root.append(this.renderSponsorships(sponsorships));
    root.append(this.renderCasualties(casualties, nowMs));
    root.append(this.renderContracts(contracts));
    root.append(this.renderActions(actions, nowMs));
    root.append(this.renderLogistics(logistics));

    replaceChildren(this.getContentElement(), root);
  }

  private renderHeader(
    deployments: readonly PmcDeployment[],
    sponsorships: readonly SponsorshipLink[],
    casualties: readonly CasualtyEvent[],
    actions: readonly RegulatoryAction[],
    logistics: readonly LogisticsObservation[],
    nowMs: number,
  ): HTMLElement {
    return h('div', {
      style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:baseline;font-size:11px;opacity:0.85;margin-bottom:4px',
    },
      h('span', {}, `${countSignificantDeployments(deployments)} significant deployments reported`),
      h('span', {}, `· ${countHighConfidenceSponsorships(sponsorships)} confirmed/likely sponsorships`),
      h('span', {}, `· ${countRecentCasualties(casualties, nowMs)} casualty events in 90d`),
      h('span', {}, `· ${countRecentActions(actions, nowMs)} regulatory actions in 365d`),
      h('span', {}, `· ${highConfidenceLogisticsCount(logistics)} strong logistics observations`),
    );
  }

  private renderFramingNote(): HTMLElement {
    return h('div', {
      style: 'font-size:11px;opacity:0.7;font-style:italic;margin:2px 0 6px 0;line-height:1.4',
    }, 'Defensive analytical monitoring only. All entries summarise indicators that have been reported in open-source intelligence (OSINT), government notices, UN panels, and verified press. Severity tiers reflect the scale of reported activity; they are not endorsements or operational guidance.');
  }

  private renderDeployments(rows: PmcDeployment[]): HTMLElement {
    const section = h('section', { 'data-section': 'deployments' });
    section.append(sectionHeader('Reported Deployments by Region', countSignificantDeployments(rows)));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No deployment indicators reported.'));
      return section;
    }
    const byRegion = deploymentsByRegion(rows);
    const container = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    for (const [region, list] of byRegion) {
      const regionBlock = h('div', { style: 'border-left:2px solid #374151;padding-left:8px' });
      regionBlock.append(h('div', { style: 'font-weight:600;font-size:12px;opacity:0.9' }, region));
      for (const d of list) {
        const row = h('div', { style: 'display:flex;gap:8px;align-items:baseline;font-size:12px;margin:2px 0;flex-wrap:wrap' });
        row.append(tierBadge(activityScaleLabel(d.scale), activityScaleColor(d.scale)));
        row.append(h('span', { style: 'font-weight:600' }, d.formation));
        row.append(h('span', { style: 'opacity:0.75' }, `→ ${d.reportedAreas.join(', ')}`));
        row.append(h('span', { style: 'opacity:0.55;font-size:11px' }, `first reported ${d.firstReportedYear} · last seen ${fmtDate(d.lastObservedAt)}`));
        regionBlock.append(row);
        regionBlock.append(h('div', { style: 'opacity:0.65;font-size:11px;margin-left:4px' }, d.observerNote));
      }
      container.append(regionBlock);
    }
    section.append(container);
    return section;
  }

  private renderSponsorships(rows: SponsorshipLink[]): HTMLElement {
    const section = h('section', { 'data-section': 'sponsorships' });
    section.append(sectionHeader('Reported State Sponsorship', countHighConfidenceSponsorships(rows)));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No sponsorship indicators reported.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr');
      tr.append(cell(r.formation, 'font-weight:600'));
      tr.append(cell(r.sponsorState, 'opacity:0.85'));
      const confCell = h('td', { style: 'padding:3px 6px' });
      confCell.append(tierBadge(sponsorConfidenceLabel(r.confidence), sponsorConfidenceColor(r.confidence)));
      tr.append(confCell);
      tr.append(cell(r.basis, 'opacity:0.65;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderCasualties(events: CasualtyEvent[], nowMs: number): HTMLElement {
    const section = h('section', { 'data-section': 'casualties' });
    section.append(sectionHeader('Reported Operational Casualty Events', countRecentCasualties(events, nowMs)));
    if (events.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No casualty events reported in window.'));
      return section;
    }
    section.append(h('div', {
      style: 'opacity:0.7;font-size:11px;margin:2px 0',
    }, `Recent reported total: ${totalRecentReportedCount(events, nowMs).toLocaleString()} (across casualty events within 90 days)`));
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const e of events) {
      const sev = classifyCasualtySeverity(e.reportedCount);
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(casualtySeverityLabel(sev), casualtySeverityColor(sev)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, e.formation));
      li.append(h('span', { style: 'opacity:0.7;margin-left:6px' }, `${casualtyKindLabel(e.kind)} · ${e.region}`));
      li.append(h('span', { style: 'opacity:0.6;margin-left:6px;font-size:11px' }, `${fmtDate(e.occurredAt)} · ${e.reportedCount} reported`));
      li.append(h('div', { style: 'opacity:0.65;font-size:11px;margin-left:4px' }, e.summary));
      list.append(li);
    }
    section.append(list);
    return section;
  }

  private renderContracts(rows: ContractAward[]): HTMLElement {
    const section = h('section', { 'data-section': 'contracts' });
    section.append(sectionHeader('Publicly Reported Contract Awards'));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No contract notices on file.'));
      return section;
    }
    section.append(h('div', {
      style: 'opacity:0.7;font-size:11px;margin:2px 0',
    }, `Total disclosed value: $${totalContractValueUsdM(rows).toLocaleString()}M`));
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    const sorted = [...rows].sort((a, b) => b.valueUsdM - a.valueUsdM);
    for (const c of sorted) {
      const tr = h('tr');
      tr.append(cell(c.formation, 'font-weight:600'));
      tr.append(cell(c.awardingBody, 'opacity:0.85'));
      tr.append(cell(contractTypeLabel(c.contractType), 'opacity:0.75'));
      tr.append(cell(`$${c.valueUsdM.toLocaleString()}M`, 'opacity:0.85'));
      tr.append(cell(fmtDate(c.awardedAt), 'opacity:0.6;font-size:11px'));
      tr.append(cell(c.publicSource, 'opacity:0.55;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderActions(rows: RegulatoryAction[], nowMs: number): HTMLElement {
    const section = h('section', { 'data-section': 'regulatory-actions' });
    section.append(sectionHeader('Regulatory Actions & Bans', countRecentActions(rows, nowMs)));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No regulatory actions on file.'));
      return section;
    }
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const a of rows) {
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(regulatoryActionLabel(a.actionType), regulatoryActionColor(a.actionType)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, a.formation));
      li.append(h('span', { style: 'opacity:0.75;margin-left:6px' }, `· ${a.body}`));
      li.append(h('span', { style: 'opacity:0.6;margin-left:6px;font-size:11px' }, fmtDate(a.effectiveAt)));
      li.append(h('div', { style: 'opacity:0.7;font-size:11px;margin-left:4px' }, a.citation));
      li.append(h('div', { style: 'opacity:0.6;font-size:11px;margin-left:4px' }, a.notes));
      list.append(li);
    }
    section.append(list);
    return section;
  }

  private renderLogistics(rows: LogisticsObservation[]): HTMLElement {
    const section = h('section', { 'data-section': 'logistics' });
    section.append(sectionHeader('Proxy Warfare Logistics Indicators', highConfidenceLogisticsCount(rows)));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No logistics indicators reported.'));
      return section;
    }
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const o of rows) {
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(logisticsConfidenceLabel(o.confidence), logisticsConfidenceColor(o.confidence)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, logisticsIndicatorLabel(o.indicator)));
      li.append(h('span', { style: 'opacity:0.75;margin-left:6px' }, `${o.origin} → ${o.destination}`));
      li.append(h('span', { style: 'opacity:0.6;margin-left:6px;font-size:11px' }, o.associatedFormation));
      li.append(h('div', { style: 'opacity:0.65;font-size:11px;margin-left:4px' }, o.observerNote));
      list.append(li);
    }
    section.append(list);
    return section;
  }
}
