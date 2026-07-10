/**
 * ArcticMonitoringPanel (panel id: `arctic-monitoring`).
 *
 * Deep-intelligence panel for Arctic geopolitical competition,
 * environment, and shipping intelligence.
 *
 * Sections:
 *   1. Ice & Environment       — sea ice extent, temperature anomaly, permafrost.
 *   2. Arctic Shipping Routes  — NSR / NWP / Transpolar status + transit stats.
 *   3. Territorial Claims      — continental shelf and waters disputes.
 *   4. Military Posture        — per-nation exercise + basing activity trends.
 *   5. Resource Competition    — oil, gas, minerals, fishing, wind projects.
 *
 * Pure helpers live in `arctic-monitoring-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  iceTrendColor,
  iceTrendLabel,
  anomalyColor,
  routeStatusColor,
  routeStatusLabel,
  legalStatusLabel,
  tensionColor,
  tensionLabel,
  activityTrendColor,
  activityTrendLabel,
  resourceTypeLabel,
  devStatusColor,
  devStatusLabel,
  envConcernColor,
  envConcernLabel,
  countHighTensionClaims,
  countIncreasingMilitary,
  ICE_ENVIRONMENT,
  SHIPPING_ROUTES,
  TERRITORIAL_CLAIMS,
  MILITARY_POSTURE,
  RESOURCE_PROJECTS,
} from './arctic-monitoring-helpers';

const REFRESH_MS = 15 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'amp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class ArcticMonitoringPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'arctic-monitoring',
      title: 'Arctic Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for the Arctic: sea ice & environment, shipping routes, territorial claims, military posture, and resource competition.',
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
    const liveEvents = safe(() => query({ domain: 'geopolitical', limit: 50 })) ?? [];
    const arcticEvents = liveEvents.filter((e) => {
      const text = (e.title + ' ' + e.tags.join(' ')).toLowerCase();
      return text.includes('arctic') || text.includes('polar') || text.includes('svalbard')
        || text.includes('greenland') || text.includes('northwest passage');
    });
    const liveHighCount = arcticEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      countHighTensionClaims(TERRITORIAL_CLAIMS) +
      countIncreasingMilitary(MILITARY_POSTURE) +
      liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'amp-root' },
        this.buildIceSection(),
        this.buildRoutesSection(),
        this.buildClaimsSection(),
        this.buildMilitarySection(),
        this.buildResourceSection(),
      ),
    );
  }

  // ── Section 1: Ice & Environment ─────────────────────────────────────

  private buildIceSection(): HTMLElement {
    const tbody = h('tbody');

    for (const env of ICE_ENVIRONMENT) {
      const color  = anomalyColor(env.anomalyScore);
      const tColor = iceTrendColor(env.trend);
      const tLabel = iceTrendLabel(env.trend);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, env.parameter),
          cell(env.currentValue, `color:${color};font-weight:600`),
          cell(env.deviation, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, tLabel),
        ),
      );
    }

    return h('div', { className: 'amp-section' },
      sectionHeader('Ice & Environment'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Parameter · current reading · deviation from baseline · trend',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Arctic Shipping Routes ────────────────────────────────

  private buildRoutesSection(): HTMLElement {
    const tbody = h('tbody');

    for (const r of SHIPPING_ROUTES) {
      const color  = routeStatusColor(r.status);
      const sLabel = routeStatusLabel(r.status);
      const transits = r.transitCountYTD > 0 ? `${r.transitCountYTD} transits YTD` : 'No transits';
      const avgDays  = r.avgTransitDays > 0 ? `${r.avgTransitDays}d avg` : '—';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, r.name),
          cell(transits, 'color:#facc15'),
          cell(avgDays, 'color:#ccc;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, r.iceConditions),
        ),
      );
    }

    return h('div', { className: 'amp-section' },
      sectionHeader('Arctic Shipping Routes'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Route · transits YTD · avg transit time · status · ice conditions',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Territorial Claims & Disputes ─────────────────────────

  private buildClaimsSection(): HTMLElement {
    const highTension = countHighTensionClaims(TERRITORIAL_CLAIMS);
    const badge = highTension > 0 ? countBadge(highTension, 'high/critical') : undefined;
    const tbody = h('tbody');

    for (const c of TERRITORIAL_CLAIMS) {
      const tColor = tensionColor(c.tensionLevel);
      const tLabel = tensionLabel(c.tensionLevel);
      const lLabel = legalStatusLabel(c.legalStatus);
      let area: string;
      if (c.areaKm2 >= 1_000_000) {
        area = `${(c.areaKm2 / 1_000_000).toFixed(1)}M km²`;
      } else if (c.areaKm2 >= 1000) {
        area = `${Math.round(c.areaKm2 / 1000)}K km²`;
      } else {
        area = `${c.areaKm2} km²`;
      }

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` }, c.area),
          cell(c.claimants, 'color:#ccc'),
          cell(lLabel, 'color:#9e9e9e'),
          cell(area, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, tLabel),
        ),
      );
    }

    return h('div', { className: 'amp-section' },
      sectionHeader('Territorial Claims & Disputes', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Area · claimants · legal framework · disputed area · tension',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Military Posture ───────────────────────────────────────

  private buildMilitarySection(): HTMLElement {
    const increasing = countIncreasingMilitary(MILITARY_POSTURE);
    const badge = increasing > 0 ? countBadge(increasing, 'increasing') : undefined;
    const tbody = h('tbody');

    for (const m of MILITARY_POSTURE) {
      const tColor = activityTrendColor(m.trend);
      const tLabel = activityTrendLabel(m.trend);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, m.country),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, tLabel),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 2px 6px;font-size:10px;color:#ccc',
          }, m.recentActivity),
        ),
        h('tr',
          h('td', {
            colspan: '2',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, m.basingActivity),
        ),
      );
    }

    return h('div', { className: 'amp-section' },
      sectionHeader('Military Posture', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · trend · recent exercises/deployments · basing activity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Resource Competition ──────────────────────────────────

  private buildResourceSection(): HTMLElement {
    const tbody = h('tbody');

    for (const r of RESOURCE_PROJECTS) {
      const dColor = devStatusColor(r.devStatus);
      const dLabel = devStatusLabel(r.devStatus);
      const eColor = envConcernColor(r.envConcern);
      const eLabel = envConcernLabel(r.envConcern);
      const rLabel = resourceTypeLabel(r.resourceType);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${dColor}` }, r.project),
          cell(rLabel, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${dColor}` }, dLabel),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${eColor};text-align:right` }, `${eLabel} env`),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, r.countries),
        ),
      );
    }

    return h('div', { className: 'amp-section' },
      sectionHeader('Resource Competition'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Project · resource type · development status · environmental concern · countries',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
