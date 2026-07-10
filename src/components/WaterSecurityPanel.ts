/**
 * WaterSecurityPanel (panel id: `water-security`).
 *
 * Deep-intelligence panel for water scarcity, conflict, and infrastructure threats.
 *
 * Sections:
 *   1. Water Stress Hotspots       — regions under acute water stress.
 *   2. Transboundary Water Conflicts — active disputes over shared resources.
 *   3. Dam & Reservoir Watch        — critical dam incidents + low reservoir levels.
 *   4. Water Infrastructure Attacks — deliberate attacks on water systems.
 *   5. Hydrological Risk Index      — per-region composite 0–4 risk score.
 *
 * Pure helpers live in `water-security-helpers.ts` so unit tests can import
 * them without pulling in the Panel base class or live services.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  stressColor,
  stressLabel,
  driverLabel,
  conflictTypeLabel,
  tensionColor,
  damTypeLabel,
  damSeverityColor,
  attackTypeLabel,
  attackTypeColor,
  hydroRiskColor,
  hydroRiskLabel,
  formatPopM,
  countCriticalStress,
  countArmedConflicts,
  STRESS_HOTSPOTS,
  TRANSBOUNDARY_CONFLICTS,
  DAM_WATCH,
  INFRA_ATTACKS,
  HYDRO_INDEX,
} from './water-security-helpers';

const REFRESH_MS = 10 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'wsp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class WaterSecurityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'water-security',
      title: 'Water Security Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for water security: stress hotspots, transboundary conflicts, dam watch, infrastructure attacks, and hydrological risk index.',
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
    const liveEvents = safe(() => query({ domain: 'resources', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(countCriticalStress(STRESS_HOTSPOTS) + countArmedConflicts(TRANSBOUNDARY_CONFLICTS) + liveHighCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'wsp-root' },
        this.buildStressSection(),
        this.buildConflictsSection(),
        this.buildDamSection(),
        this.buildAttacksSection(),
        this.buildHydroIndexSection(),
      ),
    );
  }

  // ── Section 1: Water Stress Hotspots ─────────────────────────────────

  private buildStressSection(): HTMLElement {
    const critical = countCriticalStress(STRESS_HOTSPOTS);
    const badge = critical > 0 ? countBadge(critical, 'critical/very high') : undefined;
    const tbody = h('tbody');

    for (const s of STRESS_HOTSPOTS) {
      const color = stressColor(s.stressLevel);
      const lvl   = stressLabel(s.stressLevel);
      const drv   = driverLabel(s.primaryDriver);
      const pop   = formatPopM(s.populationAffectedM);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, s.region),
          cell(drv, 'color:#ccc'),
          cell(pop, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, lvl),
        ),
      );
    }

    return h('div', { className: 'wsp-section' },
      sectionHeader('Water Stress Hotspots', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · primary driver · affected population · stress level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Transboundary Water Conflicts ──────────────────────────

  private buildConflictsSection(): HTMLElement {
    const armed = countArmedConflicts(TRANSBOUNDARY_CONFLICTS);
    const badge = armed > 0 ? countBadge(armed, 'armed/critical') : undefined;
    const tbody = h('tbody');

    for (const c of TRANSBOUNDARY_CONFLICTS) {
      const tColor  = tensionColor(c.tensionLevel);
      const ctLabel = conflictTypeLabel(c.conflictType);
      const pop     = formatPopM(c.downstreamPopM);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, c.waterBody),
          cell(c.countries, 'color:#ccc'),
          cell(ctLabel, 'color:#9e9e9e'),
          cell(pop, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, c.tensionLevel),
        ),
      );
    }

    return h('div', { className: 'wsp-section' },
      sectionHeader('Transboundary Water Conflicts', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Water body · countries · conflict type · downstream population · tension',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Dam & Reservoir Watch ─────────────────────────────────

  private buildDamSection(): HTMLElement {
    const tbody = h('tbody');

    for (const d of DAM_WATCH) {
      const color  = damSeverityColor(d.severity);
      const tLabel = damTypeLabel(d.type);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, d.facility),
          cell(d.country, 'color:#9e9e9e'),
          cell(tLabel, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, d.severity),
        ),
      );
    }

    return h('div', { className: 'wsp-section' },
      sectionHeader('Dam & Reservoir Watch'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Water Infrastructure Attacks ───────────────────────────

  private buildAttacksSection(): HTMLElement {
    const tbody = h('tbody');

    for (const a of INFRA_ATTACKS) {
      const color  = attackTypeColor(a.attackType);
      const aLabel = attackTypeLabel(a.attackType);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, a.location),
          cell(aLabel, 'color:#ccc'),
          cell(a.perpetrator, 'color:#9e9e9e'),
        ),
        h('tr',
          h('td', {
            colspan: '3',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, a.impact),
        ),
      );
    }

    return h('div', { className: 'wsp-section' },
      sectionHeader('Water Infrastructure Attacks'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Location · attack type · perpetrator · impact',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Hydrological Risk Index ───────────────────────────────

  private buildHydroIndexSection(): HTMLElement {
    const tbody = h('tbody');

    for (const r of HYDRO_INDEX) {
      const color    = hydroRiskColor(r.risk);
      const rLabel   = hydroRiskLabel(r.risk);
      const barWidth = Math.round((r.risk / 4) * 100);

      const bar = h('div', { style: 'background:#333;border-radius:2px;height:6px' },
        h('div', { style: `background:${color};width:${barWidth}%;height:6px;border-radius:2px` }),
      );

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px' }, r.region),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase` }, rLabel),
        ),
      );
    }

    return h('div', { className: 'wsp-section' },
      sectionHeader('Hydrological Risk Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Regional composite water security risk · 0 minimal → 4 severe',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
