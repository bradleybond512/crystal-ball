/**
 * SpaceDebrisPanel (panel id: `space-debris`).
 *
 * Tracks the orbital debris crisis as a geopolitical security issue:
 * ASAT tests creating debris fields, Kessler syndrome risk, satellite
 * collision warnings, mega-constellation buildup, active debris removal
 * missions, and the emerging space governance crisis.
 *
 * Pure logic lives in `space-debris-helpers.ts`.
 * Data is curated open-source intelligence; refreshes every 24 hours.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  type DebrisEvent,
  type OrbitStats,
  type ASATNation,
  type DebrisRemovalMission,
  type MegaConstellation,
  type GovernanceGap,
  type GlobalDebrisStats,
  buildRenderData,
  kesslerRiskLabel,
  severityColor,
  formatFragments,
  asatStatusLabel,
  missionStatusLabel,
  constellationStatusLabel,
  getHighRiskEvents,
  riskClass,
  DEBRIS_EVENTS,
} from './space-debris-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

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

const RISK_COLORS: Record<string, string> = {
  'risk-low':      '#4caf50',
  'risk-moderate': '#ff9800',
  'risk-elevated': '#ff5722',
  'risk-critical': '#d50000',
};

export class SpaceDebrisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'space-debris',
      title: 'Space Debris Crisis',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Orbital debris crisis as a geopolitical security issue: ASAT test events, Kessler syndrome risk index, mega-constellation conjunction threats, active debris removal missions, and space governance gaps. Data is curated open-source intelligence; 24-hour refresh.',
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
    const data = buildRenderData();
    const highRiskCount = getHighRiskEvents(DEBRIS_EVENTS).length;
    this.setCount(highRiskCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildGlobalStatsSection(data.globalStats, data.kesslerRiskIndex),
        this.buildKesslerGaugeSection(data.kesslerRiskIndex),
        this.buildDebrisEventsSection(data.events),
        this.buildOrbitRegimesSection(data.orbitStats),
        this.buildASATNationsSection(data.asatNations),
        this.buildMegaConstellationsSection(data.megaConstellations),
        this.buildRemovalMissionsSection(data.removalMissions),
        this.buildGovernanceGapsSection(data.governanceGaps),
      ),
    );
  }

  // ── Section 1: Global Debris Statistics ────────────────────────────────
  private buildGlobalStatsSection(stats: GlobalDebrisStats, kesslerIdx: number): HTMLElement {
    const kRisk = kesslerRiskLabel(kesslerIdx);
    const kColor = RISK_COLORS[riskClass(kRisk)] ?? '#9e9e9e';

    return h('div', { className: 'app-section' },
      sectionHeader('Global Debris Statistics'),
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px' },
        this.buildStatCard('Tracked >10cm', stats.trackedObjectsAbove10cm.toLocaleString(), '#ef4444'),
        this.buildStatCard('Estimated 1-10cm', stats.estimatedObjects1to10cm.toLocaleString(), '#fb923c'),
        this.buildStatCard(
          'Estimated <1cm',
          `${Math.round(stats.estimatedObjectsBelow1cm / 1_000_000)}M+`,
          '#facc15',
        ),
        this.buildStatCard('Active Satellites', stats.activeSatellites.toLocaleString(), '#4caf50'),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-top:2px' },
        `Growth rate: ${stats.debrisGrowthRateYoY} YoY · Kessler Risk: `,
        h('span', { style: `color:${kColor};font-weight:600` },
          `${kesslerIdx}/100 (${kRisk.toUpperCase()})`,
        ),
      ),
    );
  }

  private buildStatCard(label: string, value: string, color: string): HTMLElement {
    return h('div', {
      style: 'background:rgba(255,255,255,0.04);border-radius:4px;padding:6px 8px',
    },
      h('div', { style: `font-size:16px;font-weight:700;color:${color}` }, value),
      h('div', { style: 'font-size:10px;color:#9e9e9e;margin-top:2px' }, label),
    );
  }

  // ── Section 2: Kessler Syndrome Risk Gauge ─────────────────────────────
  private buildKesslerGaugeSection(index: number): HTMLElement {
    const risk = kesslerRiskLabel(index);
    const color = RISK_COLORS[riskClass(risk)] ?? '#9e9e9e';

    return h('div', { className: 'app-section' },
      sectionHeader('Kessler Syndrome Risk Index'),
      h('div', { style: 'margin:6px 0 2px' },
        h('div', {
          style: 'display:flex;justify-content:space-between;font-size:10px;color:#9e9e9e;margin-bottom:3px',
        },
          h('span', {}, 'Low'),
          h('span', {}, 'Moderate'),
          h('span', {}, 'Elevated'),
          h('span', {}, 'Critical'),
        ),
        h('div', { style: 'background:#1e1e1e;border-radius:4px;height:10px;overflow:hidden' },
          h('div', {
            style: `width:${index}%;height:100%;background:linear-gradient(90deg,#4caf50,${color});border-radius:4px`,
          }),
        ),
        h('div', { style: `color:${color};font-size:13px;font-weight:600;margin-top:4px` },
          `${index}/100 — ${risk.charAt(0).toUpperCase() + risk.slice(1)} risk`,
        ),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-top:3px' },
        'Composite of LEO density, high-severity events in orbit, fragment count, and recent ASAT activity.',
      ),
    );
  }

  // ── Section 3: Debris-Generating Events ────────────────────────────────
  private buildDebrisEventsSection(events: DebrisEvent[]): HTMLElement {
    const highRisk = getHighRiskEvents(events);
    const badge = highRisk.length > 0 ? countBadge(highRisk.length, 'high-risk') : undefined;

    const tbody = h('tbody');
    for (const ev of events) {
      const color = severityColor(ev.severity);
      const fragStr = ev.trackedFragments > 0
        ? `${formatFragments(ev.trackedFragments)} frags`
        : '—';
      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:11px;font-weight:600;color:${color}` },
            String(ev.year),
          ),
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, ev.name),
          cell(ev.orbit, 'color:#9e9e9e'),
          cell(fragStr, 'color:#facc15;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-align:right;color:${ev.stillInOrbit ? '#ef4444' : '#4caf50'}`,
          }, ev.stillInOrbit ? 'IN ORBIT' : 'DECAYED'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-align:right;color:${ev.forcedISSManeuver ? '#d50000' : '#9e9e9e'}`,
          }, ev.forcedISSManeuver ? 'ISS ⚠' : '—'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Debris-Generating Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Year · event · orbit · fragments · status · ISS impact',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Orbital Regime Breakdown ────────────────────────────────
  private buildOrbitRegimesSection(stats: OrbitStats[]): HTMLElement {
    const criticalCount = stats.filter((s) => s.kesslerRisk === 'critical').length;
    const badge = criticalCount > 0 ? countBadge(criticalCount, 'critical') : undefined;

    const tbody = h('tbody');
    for (const s of stats) {
      const rColor = RISK_COLORS[riskClass(s.kesslerRisk)] ?? '#9e9e9e';
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#ccc' }, s.regime),
          cell(s.altitudeKmRange, 'color:#9e9e9e'),
          cell(s.trackedObjects.toLocaleString(), 'color:#facc15;text-align:right'),
          cell(s.activeSatellites.toLocaleString(), 'color:#4caf50;text-align:right'),
          cell(s.debrisFragments.toLocaleString(), 'color:#ef4444;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${rColor};text-align:right`,
          }, s.kesslerRisk),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Orbital Regime Breakdown', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Regime · altitude · tracked objects · active sats · debris · Kessler risk',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: ASAT-Capable Nations ────────────────────────────────────
  private buildASATNationsSection(nations: ASATNation[]): HTMLElement {
    const demonstrated = nations.filter((n) => n.status === 'demonstrated').length;
    const badge = demonstrated > 0 ? countBadge(demonstrated, 'demonstrated') : undefined;

    const tbody = h('tbody');
    for (const n of nations) {
      let statusColor = '#9e9e9e';
      if (n.status === 'demonstrated') statusColor = '#ef4444';
      else if (n.status === 'suspected') statusColor = '#fb923c';
      else if (n.status === 'developing') statusColor = '#facc15';

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#ccc' }, n.name),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${statusColor}`,
          }, asatStatusLabel(n.status)),
          cell(String(n.testsPerformed), 'color:#facc15;text-align:right'),
          cell(n.latestTestYear === null ? '—' : String(n.latestTestYear), 'color:#9e9e9e;text-align:right'),
          cell(formatFragments(n.totalDebrisGenerated), 'color:#ef4444;text-align:right'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('ASAT Capabilities by Nation', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · status · tests · latest year · debris generated',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: Mega-Constellation Buildup ──────────────────────────────
  private buildMegaConstellationsSection(constellations: MegaConstellation[]): HTMLElement {
    const badge = countBadge(constellations.length, 'constellations');

    const tbody = h('tbody');
    for (const c of constellations) {
      const fillPct =
        c.plannedCount > 0
          ? Math.round((c.deployedCount / c.plannedCount) * 100)
          : 0;
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#ccc' }, c.operator),
          cell(c.country, 'color:#9e9e9e'),
          cell(c.deployedCount.toLocaleString(), 'color:#4caf50;text-align:right'),
          cell(c.plannedCount.toLocaleString(), 'color:#facc15;text-align:right'),
          cell(`${fillPct}%`, 'color:#ccc;text-align:right'),
          cell(constellationStatusLabel(c.status), 'color:#fb923c;text-align:right'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Mega-Constellation Buildup', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Operator · country · deployed · planned · fill% · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 7: Active Debris Removal Missions ───────────────────────────
  private buildRemovalMissionsSection(missions: DebrisRemovalMission[]): HTMLElement {
    const operational = missions.filter((m) => m.status === 'operational').length;
    const badge = operational > 0 ? countBadge(operational, 'operational') : undefined;

    const STATUS_COLORS: Record<string, string> = {
      operational: '#4caf50',
      planned:     '#fb923c',
      development: '#facc15',
      cancelled:   '#9e9e9e',
    };

    const tbody = h('tbody');
    for (const m of missions) {
      const sColor = STATUS_COLORS[m.status] ?? '#9e9e9e';
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#ccc' }, m.name),
          cell(m.agency, 'color:#9e9e9e'),
          cell(String(m.targetYear), 'color:#9e9e9e;text-align:right'),
          h('td', {
            style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right`,
          }, missionStatusLabel(m.status)),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Active Debris Removal Missions', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Mission · agency · target year · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 8: Space Governance Gaps ───────────────────────────────────
  private buildGovernanceGapsSection(gaps: GovernanceGap[]): HTMLElement {
    const criticalGaps = gaps.filter((g) => g.severity >= 4).length;
    const badge = criticalGaps > 0 ? countBadge(criticalGaps, 'critical') : undefined;

    const items = gaps.map((g) => {
      const color = severityColor(g.severity);
      return h('div', { style: 'margin-bottom:8px' },
        h('div', { style: `font-size:12px;font-weight:600;color:${color}` }, g.title),
        h('div', { style: 'font-size:11px;color:#9e9e9e;margin-top:2px;line-height:1.4' },
          g.description,
        ),
      );
    });

    return h('div', { className: 'app-section' },
      sectionHeader('Space Governance Gaps', badge),
      ...items,
    );
  }
}
