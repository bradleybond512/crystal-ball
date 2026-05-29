import { Panel } from './Panel';
import {
  buildRenderData,
  healthClass,
  tierClass,
  getPositiveEvents,
  getCriticalEvents,
  type IntelPartner,
  type IntelSharingEvent,
} from './intelligence-cooperation-helpers';

const REFRESH_MS = 60 * 60 * 1000;

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

export class IntelligenceCooperationPanel extends Panel {
  static panelId = 'intelligence-cooperation';
  static title = 'Intelligence Cooperation';

  constructor() {
    super(IntelligenceCooperationPanel.panelId, IntelligenceCooperationPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const { partners, events, globalCoopIndex, tier1Count, tier2Count, strainedCount, suspendedCount, averageTrustScore } = data;

    const header = h('div', { class: 'ic-header' },
      h('div', { class: 'ic-metric' }, h('span', { class: 'ic-label' }, 'Coop Index'), h('span', { class: `ic-value ${globalCoopIndex >= 70 ? 'health-strong' : globalCoopIndex >= 50 ? 'health-rebuilding' : 'health-strained'}` }, `${globalCoopIndex}/100`)),
      h('div', { class: 'ic-metric' }, h('span', { class: 'ic-label' }, 'Five Eyes (T1)'), h('span', { class: 'ic-value tier-1' }, String(tier1Count))),
      h('div', { class: 'ic-metric' }, h('span', { class: 'ic-label' }, 'Enhanced (T2)'), h('span', { class: 'ic-value tier-2' }, String(tier2Count))),
      h('div', { class: 'ic-metric' }, h('span', { class: 'ic-label' }, 'Strained'), h('span', { class: 'ic-value health-strained' }, String(strainedCount))),
      h('div', { class: 'ic-metric' }, h('span', { class: 'ic-label' }, 'Avg Trust'), h('span', { class: 'ic-value' }, `${averageTrustScore}/10`)),
    );

    const partnerSection = h('div', { class: 'ic-partners' });
    for (const p of [...partners].sort((a, b) => {
      const tierOrder = { 'Tier 1 (Core)': 0, 'Tier 2 (Enhanced)': 1, 'Tier 3 (Liaison)': 2, 'Adversarial': 3 };
      return (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3) || b.trustScore - a.trustScore;
    })) {
      const row = h('div', { class: `ic-partner-row ${tierClass(p.tier)}` },
        h('div', { class: 'ic-partner-header' },
          h('span', { class: 'ic-country' }, safeHtml(p.country)),
          h('span', { class: `ic-tier-badge ${tierClass(p.tier)}` }, safeHtml(p.tier)),
          h('span', { class: `ic-health-badge ${healthClass(p.partnershipHealth)}` }, safeHtml(p.partnershipHealth)),
          p.trustScore > 0 ? h('span', { class: 'ic-trust' }, `Trust: ${p.trustScore}/10`) : h('span', {}),
        ),
        h('div', { class: 'ic-agency' }, safeHtml(p.primaryAgency)),
        h('div', { class: 'ic-domains' }, safeHtml(p.domainsShared.join(' · ') || 'Adversarial — no sharing')),
        h('div', { class: 'ic-development' }, safeHtml(p.recentDevelopment)),
      );
      partnerSection.appendChild(row);
    }

    const eventSection = h('div', { class: 'ic-events' },
      h('h3', { class: 'ic-section-title' }, 'Recent Intelligence Sharing Events'),
    );
    for (const ev of events) {
      const row = h('div', { class: `ic-event-row ${ev.significance === 'Critical' ? 'ev-critical' : ev.significance === 'Notable' ? 'ev-notable' : 'ev-routine'} ${ev.positive ? 'ev-positive' : 'ev-friction'}` },
        h('div', { class: 'ic-event-header' },
          h('span', { class: 'ic-event-actors' }, safeHtml(ev.actors.join(' + '))),
          h('span', { class: 'ic-event-domain' }, safeHtml(ev.domain)),
          h('span', { class: 'ic-event-sig' }, safeHtml(ev.significance)),
          h('span', { class: 'ic-event-date' }, safeHtml(ev.date)),
        ),
        h('div', { class: 'ic-event-desc' }, safeHtml(ev.description)),
      );
      eventSection.appendChild(row);
    }

    this.replaceChildren(header, partnerSection, eventSection);
  }
}
