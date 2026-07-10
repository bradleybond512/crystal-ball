/**
 * ArmsProliferationPanel (panel id: `arms-proliferation`).
 *
 * Analytical / security-intelligence monitoring panel. Frames seven open-
 * source surfaces commonly used by arms-control researchers and OSINT
 * desks:
 *
 *   1. UN Arms Embargo Violations
 *   2. Illicit Weapons Transfer Events
 *   3. MANPADS Proliferation Indicators
 *   4. Small Arms Flow Hotspots (by region)
 *   5. Non-State Armed Group Acquisition Events
 *   6. State-Actor Arms Deal Announcements
 *   7. ITAR / EAR / Dual-Use Export-Control Cases
 *
 * Pure logic lives in `arms-proliferation-helpers.ts` so all classifiers
 * and aggregations stay testable in isolation.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  severityLabel,
  confidenceLabel,
  weaponCategoryLabel,
  actorTypeLabel,
  embargoStatusColor,
  violationStatusColor,
  routeLabel,
  manpadsThreatColor,
  dealStatusColor,
  controlRegimeLabel,
  caseStageColor,
  formatUnits,
  formatUsdBn,
  formatUsdM,
  formatKm,
  countConfirmedEmbargoViolations,
  countNonInterdictedTransfers,
  countCriticalManpads,
  countHighFlowHotspots,
  countHighConfidenceAcquisitions,
  countFlaggedDeals,
  countActiveCases,
  totalDealValueUsdBn,
  totalEnforcementPenaltyUsdM,
  composeBadgeCount,
  EMBARGO_VIOLATIONS,
  ILLICIT_TRANSFERS,
  MANPADS_INDICATORS,
  SMALL_ARMS_HOTSPOTS,
  NON_STATE_ACQUISITIONS,
  ARMS_DEALS,
  EXPORT_CONTROL_CASES,
} from './arms-proliferation-helpers';

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

export class ArmsProliferationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'arms-proliferation',
      title: 'Arms Proliferation Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Analytical view of open-source arms-control signals: UN embargo violations, illicit transfer events, MANPADS indicators, small-arms hotspots, non-state acquisitions, state arms deal announcements, and ITAR/EAR/dual-use enforcement cases.',
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
    const liveEvents = safe(() => query({ domain: 'security', tag: 'arms-control', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      composeBadgeCount(
        EMBARGO_VIOLATIONS,
        ILLICIT_TRANSFERS,
        MANPADS_INDICATORS,
        SMALL_ARMS_HOTSPOTS,
        NON_STATE_ACQUISITIONS,
        EXPORT_CONTROL_CASES,
      ) + liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildEmbargoSection(),
        this.buildTransferSection(),
        this.buildManpadsSection(),
        this.buildHotspotSection(),
        this.buildAcquisitionSection(),
        this.buildDealSection(),
        this.buildEnforcementSection(),
      ),
    );
  }

  // ── Section 1: UN Embargo Violations ──────────────────────────────────

  private buildEmbargoSection(): HTMLElement {
    const confirmed = countConfirmedEmbargoViolations(EMBARGO_VIOLATIONS);
    const badge = confirmed > 0 ? countBadge(confirmed, 'confirmed') : undefined;
    const tbody = h('tbody');

    for (const v of EMBARGO_VIOLATIONS) {
      const sColor  = severityColor(v.severity);
      const vColor  = violationStatusColor(v.violationStatus);
      const eColor  = embargoStatusColor(v.status);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, v.embargoTarget),
          cell(v.unResolution, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${eColor}` }, v.status),
          cell(weaponCategoryLabel(v.weaponCategory), 'color:#ccc'),
          cell(actorTypeLabel(v.actorType), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${vColor};text-align:right` }, v.violationStatus),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('UN Arms Embargo Violations', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Target · UN resolution · embargo status · weapon category · actor type · violation status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Illicit Weapons Transfer Events ────────────────────────

  private buildTransferSection(): HTMLElement {
    const evading = countNonInterdictedTransfers(ILLICIT_TRANSFERS);
    const badge = evading > 0 ? countBadge(evading, 'in transit') : undefined;
    const tbody = h('tbody');

    for (const t of ILLICIT_TRANSFERS) {
      const interdictColor = t.interdicted
        ? 'var(--severity-low,      #4caf50)'
        : 'var(--severity-critical, #ef4444)';
      const interdictText  = t.interdicted ? 'INTERDICTED' : 'IN TRANSIT';

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, `${t.origin} → ${t.destination}`),
          cell(routeLabel(t.route), 'color:#ccc'),
          cell(weaponCategoryLabel(t.weaponCategory), 'color:#ccc'),
          cell(formatUnits(t.quantity), 'color:#facc15;text-align:right'),
          cell(`conf: ${confidenceLabel(t.confidence)}`, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${interdictColor};text-align:right` }, interdictText),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Illicit Weapons Transfer Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Origin → destination · route · category · estimated units · confidence · interdiction status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: MANPADS Proliferation Indicators ───────────────────────

  private buildManpadsSection(): HTMLElement {
    const critical = countCriticalManpads(MANPADS_INDICATORS);
    const badge = critical > 0 ? countBadge(critical, 'critical') : undefined;
    const tbody = h('tbody');

    for (const m of MANPADS_INDICATORS) {
      const tColor = manpadsThreatColor(m.threatLevel);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` }, m.region),
          cell(m.systemFamily, 'color:#ccc'),
          cell(`~${formatUnits(m.unaccountedSystems)} systems`, 'color:#facc15;text-align:right'),
          cell(`${formatKm(m.proximityToAirRoutesKm)} from air routes`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, m.threatLevel),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('MANPADS Proliferation Indicators', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · system family · unaccounted stock · proximity to commercial air routes · threat level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Small Arms Flow Hotspots ───────────────────────────────

  private buildHotspotSection(): HTMLElement {
    const high = countHighFlowHotspots(SMALL_ARMS_HOTSPOTS);
    const badge = high > 0 ? countBadge(high, 'high flow') : undefined;
    const tbody = h('tbody');

    for (const s of SMALL_ARMS_HOTSPOTS) {
      const color = severityColor(s.flowDensity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, s.region),
          cell(s.primarySource, 'color:#ccc'),
          cell(`→ ${s.primaryDestination}`, 'color:#ccc'),
          cell(`~${formatUnits(s.estimatedAnnualUnits)} /yr`, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, severityLabel(s.flowDensity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Small Arms Flow Hotspots', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · primary source · primary destination · annual units · flow density',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Non-State Armed Group Acquisitions ─────────────────────

  private buildAcquisitionSection(): HTMLElement {
    const highConf = countHighConfidenceAcquisitions(NON_STATE_ACQUISITIONS);
    const badge = highConf > 0 ? countBadge(highConf, 'high-confidence') : undefined;
    const tbody = h('tbody');

    for (const a of NON_STATE_ACQUISITIONS) {
      const color = severityColor(a.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, a.group),
          cell(a.region, 'color:#9e9e9e'),
          cell(weaponCategoryLabel(a.weaponCategory), 'color:#ccc'),
          cell(a.acquisitionPath, 'color:#ccc'),
          cell(`conf: ${confidenceLabel(a.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, severityLabel(a.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Non-State Armed Group Acquisitions', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Group · region · category · acquisition path · confidence · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: State-Actor Arms Deal Announcements ────────────────────

  private buildDealSection(): HTMLElement {
    const flagged = countFlaggedDeals(ARMS_DEALS);
    const total   = totalDealValueUsdBn(ARMS_DEALS);
    const badge   = flagged > 0 ? countBadge(flagged, 'flagged') : undefined;
    const tbody = h('tbody');

    for (const d of ARMS_DEALS) {
      const sColor = dealStatusColor(d.status);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, `${d.seller} → ${d.buyer}`),
          cell(weaponCategoryLabel(d.weaponCategory), 'color:#ccc'),
          cell(formatUsdBn(d.valueUsdBn), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, d.status),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${d.flagged ? '#ef4444' : '#9e9e9e'};text-align:right` }, d.flagged ? 'FLAGGED' : '—'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('State-Actor Arms Deal Announcements', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        `Seller → buyer · category · value · status · monitor flag · total non-cancelled: ${formatUsdBn(total)}`,
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 7: ITAR / EAR / Dual-Use Cases ────────────────────────────

  private buildEnforcementSection(): HTMLElement {
    const active = countActiveCases(EXPORT_CONTROL_CASES);
    const totalPenalty = totalEnforcementPenaltyUsdM(EXPORT_CONTROL_CASES);
    const badge = active > 0 ? countBadge(active, 'active') : undefined;
    const tbody = h('tbody');

    for (const c of EXPORT_CONTROL_CASES) {
      const sColor  = severityColor(c.severity);
      const stColor = caseStageColor(c.stage);
      const penalty = c.penaltyUsdM > 0 ? formatUsdM(c.penaltyUsdM) : '—';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, c.caseName),
          cell(c.jurisdiction, 'color:#9e9e9e'),
          cell(controlRegimeLabel(c.regime), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${stColor};text-align:right` }, c.stage),
          cell(penalty, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(c.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Export-Control Enforcement Cases', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        `Case · jurisdiction · regime · stage · penalty · severity · total resolved penalties: ${formatUsdM(totalPenalty)}`,
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
