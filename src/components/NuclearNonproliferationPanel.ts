/**
 * NuclearNonproliferationPanel (panel id: `nuclear-nonproliferation`).
 *
 * Analytical / security-intelligence monitoring panel. Frames seven
 * open-source surfaces commonly used by arms-control researchers and
 * OSINT desks:
 *
 *   1. NPT / Treaty Compliance Status
 *   2. Enrichment Program Activity
 *   3. IAEA Safeguards Access Events
 *   4. Proliferation Network Interdictions
 *   5. Dual-Use Technology Transfer Alerts
 *   6. Nuclear-Capable Delivery System Developments
 *   7. Radiological / Dirty-Bomb Material Security Events
 *
 * Pure logic lives in `nuclear-nonproliferation-helpers.ts` so all
 * classifiers and aggregations stay testable in isolation.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  severityLabel,
  confidenceLabel,
  treatyStatusColor,
  treatyStatusLabel,
  enrichmentLevelColor,
  enrichmentLevelLabel,
  iaeaAccessColor,
  iaeaAccessLabel,
  alertStatusColor,
  alertStatusLabel,
  programStageColor,
  programStageLabel,
  deliverySystemLabel,
  radiologicalMaterialLabel,
  networkRoleLabel,
  formatSWU,
  formatRangeKm,
  formatGrams,
  countNonCompliantTreaties,
  countCriticalEnrichmentPrograms,
  countSafeguardsGaps,
  countActiveNetworkThreats,
  countHighConcernDualUse,
  countCriticalDeliverySystems,
  countUnsecuredRadiologicalEvents,
  composeBadgeCount,
  TREATY_COMPLIANCE_RECORDS,
  ENRICHMENT_PROGRAMS,
  IAEA_ACCESS_EVENTS,
  PROLIFERATION_NETWORK_INTERDICTIONS,
  DUAL_USE_TECHNOLOGY_ALERTS,
  DELIVERY_SYSTEM_DEVELOPMENTS,
  RADIOLOGICAL_SECURITY_EVENTS,
} from './nuclear-nonproliferation-helpers';

const REFRESH_MS = 60 * 60 * 1000;

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

export class NuclearNonproliferationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'nuclear-nonproliferation',
      title: 'Nuclear Nonproliferation',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Analytical view of nuclear nonproliferation signals: NPT/treaty compliance, enrichment programs, IAEA safeguards access, proliferation network interdictions, dual-use technology transfers, delivery system developments, and radiological material security events.',
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
    const liveEvents = safe(() =>
      query({ domain: 'security', tag: 'nuclear-nonproliferation', limit: 50 }),
    ) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      composeBadgeCount(
        TREATY_COMPLIANCE_RECORDS,
        ENRICHMENT_PROGRAMS,
        IAEA_ACCESS_EVENTS,
        PROLIFERATION_NETWORK_INTERDICTIONS,
        DUAL_USE_TECHNOLOGY_ALERTS,
        DELIVERY_SYSTEM_DEVELOPMENTS,
        RADIOLOGICAL_SECURITY_EVENTS,
      ) + liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildTreatySection(),
        this.buildEnrichmentSection(),
        this.buildIaeaSection(),
        this.buildNetworkSection(),
        this.buildDualUseSection(),
        this.buildDeliverySection(),
        this.buildRadiologicalSection(),
      ),
    );
  }

  // ── Section 1: NPT / Treaty Compliance ────────────────────────────────

  private buildTreatySection(): HTMLElement {
    const nonCompliant = countNonCompliantTreaties(TREATY_COMPLIANCE_RECORDS);
    const badge = nonCompliant > 0 ? countBadge(nonCompliant, 'concern') : undefined;
    const tbody = h('tbody');

    for (const r of TREATY_COMPLIANCE_RECORDS) {
      const sColor = severityColor(r.concernScore);
      const tColor = treatyStatusColor(r.status);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, r.country),
          cell(r.treaty, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor}` },
            treatyStatusLabel(r.status),
          ),
          cell(String(r.lastReviewYear), 'color:#9e9e9e;text-align:right'),
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;max-width:220px' }, r.keyIssue),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('NPT / Treaty Compliance', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · treaty · compliance status · last review · key concern',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Enrichment Programs ────────────────────────────────────

  private buildEnrichmentSection(): HTMLElement {
    const critical = countCriticalEnrichmentPrograms(ENRICHMENT_PROGRAMS);
    const badge = critical > 0 ? countBadge(critical, 'critical/urgent') : undefined;
    const tbody = h('tbody');

    for (const p of ENRICHMENT_PROGRAMS) {
      const eColor = enrichmentLevelColor(p.enrichmentLevel);
      const aColor = alertStatusColor(p.alertStatus);
      const sColor = programStageColor(p.programStage);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${aColor}` }, p.country),
          cell(p.facility, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${eColor}` },
            enrichmentLevelLabel(p.enrichmentLevel),
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;color:${sColor}` },
            programStageLabel(p.programStage),
          ),
          cell(p.estimatedSWU > 0 ? formatSWU(p.estimatedSWU) : '—', 'color:#facc15;text-align:right'),
          cell(`conf: ${confidenceLabel(p.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${aColor};text-align:right` },
            alertStatusLabel(p.alertStatus),
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Enrichment Program Activity', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · facility · enrichment level · program stage · capacity · confidence · alert',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: IAEA Safeguards Access ─────────────────────────────────

  private buildIaeaSection(): HTMLElement {
    const gaps = countSafeguardsGaps(IAEA_ACCESS_EVENTS);
    const badge = gaps > 0 ? countBadge(gaps, 'critical gap') : undefined;
    const tbody = h('tbody');

    for (const e of IAEA_ACCESS_EVENTS) {
      const aColor = iaeaAccessColor(e.accessStatus);
      const sColor = severityColor(e.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, e.country),
          cell(e.facility, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${aColor}` },
            iaeaAccessLabel(e.accessStatus),
          ),
          cell(
            e.daysWithoutAccess > 0 ? `${e.daysWithoutAccess}d no access` : 'Current',
            'color:#facc15;text-align:right',
          ),
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;max-width:220px' }, e.notes),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('IAEA Safeguards Access', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · facility · access status · access gap · notes',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Proliferation Network Interdictions ────────────────────

  private buildNetworkSection(): HTMLElement {
    const active = countActiveNetworkThreats(PROLIFERATION_NETWORK_INTERDICTIONS);
    const badge = active > 0 ? countBadge(active, 'active threat') : undefined;
    const tbody = h('tbody');

    for (const n of PROLIFERATION_NETWORK_INTERDICTIONS) {
      const interdictColor = n.interdicted
        ? 'var(--severity-low,      #4caf50)'
        : 'var(--severity-critical, #ef4444)';
      const interdictText  = n.interdicted ? 'INTERDICTED' : 'ACTIVE';
      const sColor         = severityColor(n.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, n.networkName),
          cell(`${n.originCountry} → ${n.destinationCountry}`, 'color:#ccc'),
          cell(networkRoleLabel(n.role), 'color:#9e9e9e'),
          cell(n.materialOrTechnology, 'color:#ccc'),
          cell(`conf: ${confidenceLabel(n.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${interdictColor};text-align:right` },
            interdictText,
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Proliferation Network Interdictions', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Network · route · role · material/technology · confidence · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Dual-Use Technology Alerts ─────────────────────────────

  private buildDualUseSection(): HTMLElement {
    const highConcern = countHighConcernDualUse(DUAL_USE_TECHNOLOGY_ALERTS);
    const badge = highConcern > 0 ? countBadge(highConcern, 'high concern') : undefined;
    const tbody = h('tbody');

    for (const a of DUAL_USE_TECHNOLOGY_ALERTS) {
      const cColor = severityColor(a.concernLevel);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${cColor}` }, a.technology),
          cell(`${a.exportingCountry} → ${a.receivingCountry}`, 'color:#ccc'),
          cell(a.flaggedByRegime, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${a.underReview ? '#facc15' : '#9e9e9e'};text-align:right` },
            a.underReview ? 'UNDER REVIEW' : 'MONITORING',
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${cColor};text-align:right` },
            severityLabel(a.concernLevel),
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Dual-Use Technology Transfer Alerts', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Technology · exporter → receiver · flagging regime · review status · concern level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: Delivery System Developments ───────────────────────────

  private buildDeliverySection(): HTMLElement {
    const critical = countCriticalDeliverySystems(DELIVERY_SYSTEM_DEVELOPMENTS);
    const badge = critical > 0 ? countBadge(critical, 'critical/urgent') : undefined;
    const tbody = h('tbody');

    for (const d of DELIVERY_SYSTEM_DEVELOPMENTS) {
      const aColor = alertStatusColor(d.alertStatus);
      const sColor = programStageColor(d.stage);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${aColor}` }, d.country),
          cell(deliverySystemLabel(d.systemType), 'color:#ccc'),
          cell(d.programName, 'color:#9e9e9e'),
          cell(formatRangeKm(d.estimatedRangeKm), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;color:${sColor}` },
            programStageLabel(d.stage),
          ),
          cell(`conf: ${confidenceLabel(d.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${aColor};text-align:right` },
            alertStatusLabel(d.alertStatus),
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Nuclear-Capable Delivery Systems', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · system type · program · range · stage · confidence · alert',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 7: Radiological Material Security ─────────────────────────

  private buildRadiologicalSection(): HTMLElement {
    const unsecured = countUnsecuredRadiologicalEvents(RADIOLOGICAL_SECURITY_EVENTS);
    const badge = unsecured > 0 ? countBadge(unsecured, 'unsecured') : undefined;
    const tbody = h('tbody');

    for (const e of RADIOLOGICAL_SECURITY_EVENTS) {
      const sColor = severityColor(e.severity);
      const securedColor = e.secured
        ? 'var(--severity-low,      #4caf50)'
        : 'var(--severity-critical, #ef4444)';
      const securedText  = e.secured ? 'SECURED' : 'UNSECURED';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, e.location),
          cell(radiologicalMaterialLabel(e.materialType), 'color:#ccc'),
          cell(formatGrams(e.quantityGrams), 'color:#facc15;text-align:right'),
          cell(`conf: ${confidenceLabel(e.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${securedColor}` },
            securedText,
          ),
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;max-width:220px' }, e.notes),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Radiological Material Security Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Location · material · quantity · confidence · secured status · notes',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
