/**
 * Migration/Refugee crisis domain superpower panel — deepest intelligence
 * view for global displacement and humanitarian crises.
 *
 * Five sections:
 *   1. Active Displacement Crises — ongoing mass displacement events.
 *   2. Border Pressure Monitor — major crossing pressure points.
 *   3. Camp & Settlement Status — camps at/near capacity.
 *   4. Repatriation & Resettlement — active return and resettlement programs.
 *   5. Regional Displacement Index — per-region composite 0-4 risk scores.
 *
 * All live-service calls are wrapped in safe(() => fn()) ?? fallback so the
 * panel renders from static data even before any data has loaded.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { h, safeHtml, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  migrationSeverityColor,
  causeLabel,
  causeIcon,
  trendArrow,
  trendColor,
  tensionColor,
  tensionTierLabel,
  capacityStatusLabel,
  capacityStatusColor,
  campCapacityColor,
  programStatusLabel,
  programStatusColor,
  formatDisplacedCount,
  formatBeneficiaries,
  criticalCampCount,
  activeBorderCrisisCount,
  DISPLACEMENT_CRISES,
  BORDER_PRESSURE_POINTS,
  CAMP_STATUSES,
  REPATRIATION_PROGRAMS,
  REGIONAL_DISPLACEMENT_INDEX,
  type DisplacementCrisis,
  type BorderPressurePoint,
  type CampStatus,
  type RepatriationProgram,
  type RegionalDisplacementScore,
} from './global-migration-crisis-helpers';

const REFRESH_MS = 5 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class GlobalMigrationCrisisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'global-migration-crisis',
      title: 'Migration Crisis Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for global migration and refugee crises: displacement events, border pressure, camp capacity, repatriation programs, and regional displacement index.',
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
    const liveEvents = safe(() => query({ domain: 'migration', limit: 50 })) ?? [];

    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      criticalCampCount(CAMP_STATUSES) +
      activeBorderCrisisCount(BORDER_PRESSURE_POINTS) +
      liveHighCount,
    );

    const root = h('div', { className: 'gmcp-root' },
      this.buildDisplacementSection(),
      this.buildBorderSection(),
      this.buildCampSection(),
      this.buildRepatriationSection(),
      this.buildRegionalSection(),
    );
    replaceChildren(this.content, root);
  }

  // ── Section 1: Active Displacement Crises ────────────────────────────

  private buildDisplacementSection(): HTMLElement {
    const rows = DISPLACEMENT_CRISES.map((crisis: DisplacementCrisis) => {
      const sevColor   = migrationSeverityColor(crisis.severity);
      const arrow      = trendArrow(crisis.trend);
      const arrowColor = trendColor(crisis.trend);
      const icon       = causeIcon(crisis.cause);
      const cause      = causeLabel(crisis.cause);
      const count      = formatDisplacedCount(crisis.displacedThousands);

      return h('tr', null,
        h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sevColor}` },
          escapeHtml(crisis.name),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' },
          escapeHtml(crisis.region),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right;color:#ccc' },
          escapeHtml(count),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' },
          `${icon} ${escapeHtml(cause)}`,
        ),
        h('td', { style: `padding:3px 6px;color:${arrowColor};font-size:14px;text-align:center` },
          arrow,
        ),
      );
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse' }, ...rows);

    return h('div', { className: 'gmcp-section' },
      h('div', { className: 'gmcp-section-header' }, 'Active Displacement Crises'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Ongoing mass displacement · displaced count · cause · trend',
      ),
      table,
    );
  }

  // ── Section 2: Border Pressure Monitor ───────────────────────────────

  private buildBorderSection(): HTMLElement {
    const rows = BORDER_PRESSURE_POINTS.map((bp: BorderPressurePoint) => {
      const tColor = tensionColor(bp.tensionLevel);
      const tLabel = tensionTierLabel(bp.tensionLevel);
      const sLabel = capacityStatusLabel(bp.capacityStatus);
      const sColor = capacityStatusColor(bp.capacityStatus);

      return h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px' },
          escapeHtml(bp.name),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right;color:#ccc' },
          `${bp.dailyCrossings.toLocaleString()}/day`,
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${sColor}` },
          escapeHtml(sLabel),
        ),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
          escapeHtml(tLabel),
        ),
      );
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse' }, ...rows);
    const crisisCount = activeBorderCrisisCount(BORDER_PRESSURE_POINTS);
    const badge = crisisCount > 0
      ? h('span', { style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px' },
          `${crisisCount} high/critical`,
        )
      : null;

    const header = h('div', { className: 'gmcp-section-header' }, 'Border Pressure Monitor');
    if (badge) header.append(badge);

    return h('div', { className: 'gmcp-section' },
      header,
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Daily crossing estimates · capacity status · tension level',
      ),
      table,
    );
  }

  // ── Section 3: Camp & Settlement Status ──────────────────────────────

  private buildCampSection(): HTMLElement {
    const rows = CAMP_STATUSES.map((camp: CampStatus) => {
      const capColor   = campCapacityColor(camp.capacityPct);
      const popStr     = formatDisplacedCount(camp.populationThousands);
      const needsHtml  = camp.criticalNeeds.slice(0, 3).map((n) => escapeHtml(n)).join(' · ');
      const overBadge  = camp.capacityPct > 100
        ? h('span', { style: 'font-size:9px;background:#b71c1c;color:#fff;border-radius:2px;padding:1px 3px;margin-left:3px' }, 'OVER')
        : null;

      const capCell = h('td', { style: `padding:3px 6px;font-size:12px;font-weight:bold;color:${capColor};text-align:right` },
        `${camp.capacityPct}%`,
      );
      if (overBadge) capCell.append(overBadge);

      return h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
          escapeHtml(camp.name),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' },
          escapeHtml(camp.country),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;text-align:right' },
          popStr,
        ),
        capCell,
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e' },
          ...safeHtml(needsHtml).childNodes,
        ),
      );
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse' }, ...rows);

    return h('div', { className: 'gmcp-section' },
      h('div', { className: 'gmcp-section-header' }, 'Camp & Settlement Status'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Major refugee camps · population · capacity % · critical needs',
      ),
      table,
    );
  }

  // ── Section 4: Repatriation & Resettlement ───────────────────────────

  private buildRepatriationSection(): HTMLElement {
    const rows = REPATRIATION_PROGRAMS.map((prog: RepatriationProgram) => {
      const sLabel = programStatusLabel(prog.status);
      const sColor = programStatusColor(prog.status);
      const bStr   = formatBeneficiaries(prog.beneficiariesPerMonth);

      return h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
          escapeHtml(prog.originCountry),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' },
          escapeHtml(prog.destination),
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${sColor}` },
          escapeHtml(sLabel),
        ),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;text-align:right' },
          escapeHtml(bStr),
        ),
      );
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse' }, ...rows);

    return h('div', { className: 'gmcp-section' },
      h('div', { className: 'gmcp-section-header' }, 'Repatriation & Resettlement'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Active return programs · status · beneficiaries per month',
      ),
      table,
    );
  }

  // ── Section 5: Regional Displacement Index ───────────────────────────

  private buildRegionalSection(): HTMLElement {
    const rows = REGIONAL_DISPLACEMENT_INDEX.map((r: RegionalDisplacementScore) => {
      const color    = tensionColor(r.score);
      const tier     = tensionTierLabel(r.score);
      const barWidth = Math.round((r.score / 4) * 100);

      const bar = h('div', { style: 'background:#333;border-radius:2px;height:6px' },
        h('div', { style: `background:${color};width:${barWidth}%;height:6px;border-radius:2px` }),
      );

      return h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px' },
          escapeHtml(r.region),
        ),
        h('td', { style: 'padding:3px 6px;width:80px' }, bar),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase` },
          escapeHtml(tier),
        ),
      );
    });

    const table = h('table', { style: 'width:100%;border-collapse:collapse' }, ...rows);

    return h('div', { className: 'gmcp-section' },
      h('div', { className: 'gmcp-section-header' }, 'Regional Displacement Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Composite displacement risk · 0 stable → 4 critical',
      ),
      table,
    );
  }
}
