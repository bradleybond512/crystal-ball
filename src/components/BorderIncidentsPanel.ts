/**
 * BorderIncidentsPanel (panel id: `border-incidents`)
 *
 * Tracks militarized interstate disputes (MIDs) across 12 active friction
 * zones as early-warning escalation signals. Refreshes every 30 minutes.
 *
 * Pure rendering logic — data and helpers live in border-incidents-helpers.ts.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  incidentTypeClass,
  intensityClass,
  type BorderFrictionZone,
  type IncidentType,
} from './border-incidents-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function trendArrow(trend: 'escalating' | 'stable' | 'de-escalating'): string {
  switch (trend) {
    case 'escalating': {    return '↑';
    }
    case 'de-escalating': { return '↓';
    }
    default: {              return '→';
    }
  }
}

function trendColor(trend: 'escalating' | 'stable' | 'de-escalating'): string {
  switch (trend) {
    case 'escalating': {    return 'var(--severity-critical, #ef4444)';
    }
    case 'de-escalating': { return 'var(--severity-low, #4caf50)';
    }
    default: {              return 'var(--severity-medium, #f59e0b)';
    }
  }
}

function indexColor(score: number): string {
  if (score >= 75) return 'var(--severity-critical, #ef4444)';
  if (score >= 55) return 'var(--severity-high, #f97316)';
  if (score >= 35) return 'var(--severity-medium, #f59e0b)';
  return 'var(--severity-low, #4caf50)';
}

function potentialColor(potential: number): string {
  if (potential >= 8) return 'var(--severity-critical, #ef4444)';
  if (potential >= 6) return 'var(--severity-high, #f97316)';
  if (potential >= 4) return 'var(--severity-medium, #f59e0b)';
  return 'var(--severity-low, #4caf50)';
}

function incidentTypeBadge(type: IncidentType): HTMLElement {
  return h('span', {
    className: incidentTypeClass(type),
    style: 'font-size:9px;padding:1px 4px;border-radius:3px;background:#1e293b;color:#cbd5e1;margin-right:2px',
  }, type.toUpperCase());
}

function statTile(value: string | number, label: string, color: string): HTMLElement {
  return h('div', { style: 'text-align:center;min-width:64px' },
    h('div', { style: `font-size:20px;font-weight:700;color:${color};line-height:1` }, String(value)),
    h('div', { style: 'font-size:10px;color:#9e9e9e;margin-top:2px' }, label),
  );
}

export class BorderIncidentsPanel extends Panel {
  static readonly panelId = 'border-incidents';
  static readonly title = 'Border Incidents';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: BorderIncidentsPanel.panelId,
      title: BorderIncidentsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks militarized interstate disputes (MIDs) across 12 active friction zones. Signals escalation potential, incident frequency, nuclear risk, and trend direction. Refreshes every 30 minutes.',
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

    const { zones, globalMIDIndex, highIntensityCount, escalatingCount, nuclearRiskCount } = data;
    this.setCount(highIntensityCount + escalatingCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildHeader(globalMIDIndex, highIntensityCount, escalatingCount, nuclearRiskCount),
        this.buildZoneList(zones),
      ),
    );
  }

  // ── Header — MID Index + aggregate stats ─────────────────────────────────

  private buildHeader(
    globalMIDIndex: number,
    highIntensityCount: number,
    escalatingCount: number,
    nuclearRiskCount: number,
  ): HTMLElement {
    const iColor = indexColor(globalMIDIndex);
    return h('div', { className: 'app-section' },
      h('div', { className: 'app-section-header' }, 'MID Global Index'),
      h('div', { style: 'display:flex;align-items:baseline;gap:4px;margin-bottom:10px' },
        h('div', { style: `font-size:36px;font-weight:700;color:${iColor};line-height:1` },
          String(globalMIDIndex)),
        h('div', { style: 'font-size:11px;color:#9e9e9e' }, '/ 100'),
      ),
      h('div', { style: 'display:flex;gap:16px;padding-top:6px;border-top:1px solid #2a2a2a' },
        statTile(highIntensityCount, 'High Intensity', 'var(--severity-high, #f97316)'),
        statTile(escalatingCount,    'Escalating',    'var(--severity-critical, #ef4444)'),
        statTile(nuclearRiskCount,   'Nuclear Risk',  '#a78bfa'),
      ),
    );
  }

  // ── Zone list ─────────────────────────────────────────────────────────────

  private buildZoneList(zones: BorderFrictionZone[]): HTMLElement {
    const section = h('div', { className: 'app-section' },
      h('div', { className: 'app-section-header' }, `Friction Zones (${zones.length})`),
    );
    for (const zone of zones) {
      section.append(this.buildZoneRow(zone));
    }
    return section;
  }

  private buildZoneRow(zone: BorderFrictionZone): HTMLElement {
    const trendCol   = trendColor(zone.trend);
    const intClass   = intensityClass(zone);
    const pColor     = potentialColor(zone.escalationPotential);
    const pct        = (zone.escalationPotential / 10) * 100;

    const typesDiv = h('div', { style: 'display:flex;align-items:center;gap:4px;margin-bottom:3px' });
    typesDiv.append(
      h('span', { style: 'font-size:10px;color:#6b7280;margin-right:2px' }, zone.region),
    );
    for (const t of zone.incidentType) {
      typesDiv.append(incidentTypeBadge(t));
    }

    return h('div', {
      className: `mid-zone ${intClass}`,
      style: 'padding:8px 0;border-bottom:1px solid #1e1e1e',
    },
      // Title row
      h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px' },
        h('div', { style: 'font-size:12px;font-weight:600;color:#e5e7eb' },
          zone.parties.join(' / ')),
        h('div', { style: 'display:flex;align-items:center;gap:5px' },
          h('span', { style: `font-size:11px;font-weight:700;color:${trendCol}` },
            `${trendArrow(zone.trend)} ${zone.trend}`),
          zone.nuclearRisk
            ? h('span', { style: 'font-size:9px;background:#4c1d95;color:#c4b5fd;border-radius:3px;padding:1px 4px' }, '☢ NUC')
            : h('span'),
        ),
      ),
      // Region + incident-type badges
      typesDiv,
      // Frequency + escalation-potential bar
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' },
        h('span', { style: 'font-size:10px;color:#9e9e9e;width:72px;flex-shrink:0' },
          `${zone.monthlyFrequency}/mo`),
        h('div', { style: 'flex:1;height:4px;background:#1e293b;border-radius:2px;overflow:hidden' },
          h('div', { style: `height:100%;width:${pct}%;background:${pColor};border-radius:2px` }),
        ),
        h('span', { style: `font-size:10px;font-weight:600;color:${pColor}` },
          `P${zone.escalationPotential}`),
      ),
      // Description
      h('div', { style: 'font-size:11px;color:#6b7280;line-height:1.4' },
        zone.description),
    );
  }
}
