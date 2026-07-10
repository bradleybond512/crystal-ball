/**
 * SpaceMilitarizationPanel (panel id: `space-militarization`).
 *
 * Analytical / space-domain monitoring panel. Frames seven open-source
 * surfaces commonly used by space-policy desks and arms-control analysts:
 *
 *   1. ASAT Test Events
 *   2. Co-Orbital Inspection / Shadowing Incidents
 *   3. Dual-Use Satellite Tracking
 *   4. Orbital Debris Hazards (weapon-potential)
 *   5. Space Treaty Compliance (Outer Space Treaty, Moon Agreement, etc.)
 *   6. GPS / GNSS Jamming Events
 *   7. Directed Energy Weapon Tests
 *
 * Pure logic lives in `space-militarization-helpers.ts` so all classifiers
 * and aggregations stay testable in isolation.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  severityLabel,
  confidenceLabel,
  asatModalityLabel,
  orbitLabel,
  coOrbitalBehaviorLabel,
  dualUseClassLabel,
  debrisRiskClassLabel,
  complianceStatusColor,
  complianceStatusLabel,
  jammingBandLabel,
  dewClassLabel,
  testOutcomeColor,
  formatPieces,
  formatKm,
  formatDays,
  formatPowerKw,
  countSevereAsatEvents,
  countCriticalCoOrbital,
  countMilitaryAttributedDualUse,
  countDebrisHazards,
  countApparentViolations,
  countActiveJamming,
  countDewTests,
  totalAsatDebrisGenerated,
  composeBadgeCount,
  ASAT_TESTS,
  CO_ORBITAL_INCIDENTS,
  DUAL_USE_SATELLITES,
  DEBRIS_HAZARDS,
  TREATY_FLAGS,
  GNSS_JAMMING,
  DEW_TESTS,
} from './space-militarization-helpers';

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

export class SpaceMilitarizationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'space-militarization',
      title: 'Space Militarization Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Analytical view of open-source space-domain signals: ASAT test events, co-orbital inspection/shadowing incidents, dual-use satellite tracking, orbital debris hazards, space-treaty compliance, GPS/GNSS jamming, and directed-energy weapon tests.',
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
    const liveEvents = safe(() => query({ domain: 'space', tag: 'militarization', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      composeBadgeCount(
        ASAT_TESTS,
        CO_ORBITAL_INCIDENTS,
        DUAL_USE_SATELLITES,
        DEBRIS_HAZARDS,
        TREATY_FLAGS,
        GNSS_JAMMING,
        DEW_TESTS,
      ) + liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildAsatSection(),
        this.buildCoOrbitalSection(),
        this.buildDualUseSection(),
        this.buildDebrisSection(),
        this.buildTreatySection(),
        this.buildJammingSection(),
        this.buildDewSection(),
      ),
    );
  }

  // ── Section 1: ASAT Test Events ───────────────────────────────────────

  private buildAsatSection(): HTMLElement {
    const severe = countSevereAsatEvents(ASAT_TESTS);
    const totalDebris = totalAsatDebrisGenerated(ASAT_TESTS);
    const badge = severe > 0 ? countBadge(severe, 'severe') : undefined;
    const tbody = h('tbody');

    for (const a of ASAT_TESTS) {
      const sColor = severityColor(a.severity);
      const oColor = testOutcomeColor(a.outcome);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, a.actor),
          cell(asatModalityLabel(a.modality), 'color:#ccc'),
          cell(orbitLabel(a.targetOrbit), 'color:#9e9e9e'),
          cell(a.debrisGenerated > 0 ? `${formatPieces(a.debrisGenerated)} pcs` : '—', 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${oColor};text-align:right` }, a.outcome),
          cell(`conf: ${confidenceLabel(a.confidence)}`, 'color:#9e9e9e;text-align:right'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('ASAT Test Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        `Actor · modality · target orbit · debris generated · outcome · confidence · total tracked debris: ${formatPieces(totalDebris)} pcs`,
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Co-Orbital Inspection / Shadowing Incidents ────────────

  private buildCoOrbitalSection(): HTMLElement {
    const critical = countCriticalCoOrbital(CO_ORBITAL_INCIDENTS);
    const badge = critical > 0 ? countBadge(critical, 'critical') : undefined;
    const tbody = h('tbody');

    for (const c of CO_ORBITAL_INCIDENTS) {
      const sColor = severityColor(c.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, c.inspectorActor),
          cell(c.targetOperator, 'color:#ccc'),
          cell(orbitLabel(c.targetOrbit), 'color:#9e9e9e'),
          cell(coOrbitalBehaviorLabel(c.behavior), 'color:#ccc'),
          cell(`${formatKm(c.closestApproachKm)} / ${formatDays(c.durationDays)}`, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(c.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Co-Orbital Inspection / Shadowing', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Inspector · target operator · orbit · behavior · closest approach / duration · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Dual-Use Satellite Tracking ────────────────────────────

  private buildDualUseSection(): HTMLElement {
    const attributed = countMilitaryAttributedDualUse(DUAL_USE_SATELLITES);
    const badge = attributed > 0 ? countBadge(attributed, 'mil-attributed') : undefined;
    const tbody = h('tbody');

    for (const d of DUAL_USE_SATELLITES) {
      const sColor = severityColor(d.severity);
      const attrColor = d.militaryAttributed ? '#ef4444' : '#9e9e9e';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, d.actor),
          cell(d.designation, 'color:#ccc'),
          cell(dualUseClassLabel(d.classification), 'color:#ccc'),
          cell(orbitLabel(d.orbit), 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${attrColor};text-align:right` }, d.militaryAttributed ? 'MIL' : 'CIV'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(d.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Dual-Use Satellite Tracking', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actor · designation · classification · orbit · attribution · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Orbital Debris Hazards ─────────────────────────────────

  private buildDebrisSection(): HTMLElement {
    const hazards = countDebrisHazards(DEBRIS_HAZARDS);
    const badge = hazards > 0 ? countBadge(hazards, 'high-hazard') : undefined;
    const tbody = h('tbody');

    for (const d of DEBRIS_HAZARDS) {
      const sColor = severityColor(d.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, d.fragmentationEventName),
          cell(orbitLabel(d.orbit), 'color:#9e9e9e'),
          cell(`${formatPieces(d.trackedPieces)} pcs`, 'color:#facc15;text-align:right'),
          cell(debrisRiskClassLabel(d.riskClass), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${d.forcedManeuver ? '#ef4444' : '#9e9e9e'};text-align:right` }, d.forcedManeuver ? 'MANEUVER' : '—'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(d.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Orbital Debris Hazards', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Fragmentation event · orbit · tracked pieces · risk class · forced-maneuver flag · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Space Treaty Compliance ────────────────────────────────

  private buildTreatySection(): HTMLElement {
    const violations = countApparentViolations(TREATY_FLAGS);
    const badge = violations > 0 ? countBadge(violations, 'apparent-violation') : undefined;
    const tbody = h('tbody');

    for (const t of TREATY_FLAGS) {
      const sColor   = severityColor(t.severity);
      const stColor  = complianceStatusColor(t.status);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, t.treaty),
          cell(t.article, 'color:#9e9e9e'),
          cell(t.actor, 'color:#ccc'),
          cell(t.concern, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${stColor};text-align:right` }, complianceStatusLabel(t.status)),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(t.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Space Treaty Compliance', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Treaty · article · actor · analytical concern · status · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: GPS / GNSS Jamming Events ──────────────────────────────

  private buildJammingSection(): HTMLElement {
    const active = countActiveJamming(GNSS_JAMMING);
    const badge = active > 0 ? countBadge(active, 'active') : undefined;
    const tbody = h('tbody');

    for (const j of GNSS_JAMMING) {
      const sColor = severityColor(j.severity);
      const exColor = j.exerciseLinked ? '#fb923c' : '#9e9e9e';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, j.region),
          cell(jammingBandLabel(j.band), 'color:#ccc'),
          cell(`${formatPieces(j.reportsCount)} reports`, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${exColor};text-align:right` }, j.exerciseLinked ? 'EXERCISE' : '—'),
          cell(`conf: ${confidenceLabel(j.confidence)}`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(j.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('GPS / GNSS Jamming Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · band · reports · exercise correlation · confidence · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 7: Directed Energy Weapon Tests ───────────────────────────

  private buildDewSection(): HTMLElement {
    const tests = countDewTests(DEW_TESTS);
    const badge = tests > 0 ? countBadge(tests, 'observed') : undefined;
    const tbody = h('tbody');

    for (const d of DEW_TESTS) {
      const sColor = severityColor(d.severity);
      const oColor = testOutcomeColor(d.outcome);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` }, d.actor),
          cell(dewClassLabel(d.type), 'color:#ccc'),
          cell(d.targetClass, 'color:#ccc'),
          cell(formatPowerKw(d.powerKw), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${oColor};text-align:right` }, d.outcome),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, severityLabel(d.severity)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Directed Energy Weapon Tests', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actor · class · target · disclosed peak power · outcome · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
