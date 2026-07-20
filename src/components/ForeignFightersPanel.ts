/**
 * ForeignFightersPanel (panel id: `foreign-fighters`).
 *
 * Security / intelligence monitoring panel tracking transnational foreign
 * fighter flows across active conflict zones. Surfaces:
 *
 *   1. Global Foreign Fighter Index (headline metrics)
 *   2. Conflict Zone Flow Table (ranked by volume)
 *   3. Recruitment Network Incidents (2023-2024)
 *
 * Pure logic lives in `foreign-fighters-helpers.ts` so all data and
 * aggregation functions stay testable in isolation.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  statusLabel,
  statusClass,
  ideologyLabel,
  ideologyClass,
  travelBanLabel,
  travelBanColor,
  significanceLabel,
  significanceColor,
  recruitmentMethodLabel,
  trendLabel,
  trendColor,
  formatFighters,
  countHighSignificance,
  buildRenderData,
  CONFLICT_ZONES,
  RECRUITMENT_INCIDENTS,
  GLOBAL_INDEX,
} from './foreign-fighters-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

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

export class ForeignFightersPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'foreign-fighters',
      title: 'Foreign Fighters Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks transnational foreign fighter flows across active conflict zones: ' +
        'estimated combatant counts, major origin countries, ideological affiliation, ' +
        'recruitment network incidents, and travel ban effectiveness.',
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
    const data = safe(() =>
      buildRenderData(CONFLICT_ZONES, RECRUITMENT_INCIDENTS, GLOBAL_INDEX),
    );
    if (!data) return;

    // Badge: active zones + high-significance incidents
    const highSig = countHighSignificance(data.incidents);
    this.setCount(data.activeZones.length + highSig);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildIndexSection(data.index),
        this.buildConflictZonesSection(data.ranked),
        this.buildRecruitmentSection(data.incidents),
      ),
    );
  }

  // ── Section 1: Global Foreign Fighter Index ────────────────────────────────

  private buildIndexSection(index: typeof GLOBAL_INDEX): HTMLElement {
    const tColor = trendColor(index.trendDirection);
    const tLabel = trendLabel(index.trendDirection);

    const grid = h('div', {
      style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px',
    },
      this.metricCard('Est. Foreign Fighters', formatFighters(index.totalEstimated), '#facc15'),
      this.metricCard('Active Conflicts', `${index.activeConflicts}`, '#fb923c'),
      this.metricCard('Global Trend', tLabel, tColor),
    );

    const sourceLine = h('div', { style: 'font-size:11px;color:#9e9e9e;margin-top:4px' },
      `Major source regions: ${index.majorSourceRegions.join(', ')}`,
    );
    const highestLine = h('div', { style: 'font-size:11px;color:#9e9e9e' },
      `Highest-volume conflict: ${index.highestVolumeConflict} · Data as of ${index.asOf}`,
    );

    return h('div', { className: 'app-section' },
      sectionHeader('Global Foreign Fighter Index'),
      grid,
      sourceLine,
      highestLine,
    );
  }

  private metricCard(label: string, value: string, color: string): HTMLElement {
    return h('div', {
      style: 'background:rgba(255,255,255,0.04);border-radius:4px;padding:6px 8px',
    },
      h('div', { style: `font-size:18px;font-weight:700;color:${color}` }, value),
      h('div', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase;margin-top:2px' }, label),
    );
  }

  // ── Section 2: Conflict Zone Flow Table ────────────────────────────────────

  private buildConflictZonesSection(zones: typeof CONFLICT_ZONES): HTMLElement {
    const activeCount = zones.filter((z) => z.status === 'active').length;
    const badge = activeCount > 0 ? countBadge(activeCount, 'active') : undefined;

    const tbody = h('tbody');
    for (const z of zones) {
      const sColor = statusClass(z.status);
      const iColor = ideologyClass(z.ideology);
      const tbColor = travelBanColor(z.travelBanEffectiveness);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600` }, z.name),
          cell(z.region, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:14px;font-weight:700;color:#facc15;text-align:right` },
            formatFighters(z.estimatedFighters),
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${iColor}` },
            ideologyLabel(z.ideology),
          ),
          cell(z.majorOriginCountries.slice(0, 3).join(', '), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tbColor}` },
            `Ban: ${travelBanLabel(z.travelBanEffectiveness)}`,
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` },
            statusLabel(z.status),
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Conflict Zone Foreign Fighter Flows', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Conflict · region · est. fighters · ideology · major origin countries · travel ban · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Recruitment Network Incidents ───────────────────────────────

  private buildRecruitmentSection(incidents: typeof RECRUITMENT_INCIDENTS): HTMLElement {
    const critical = incidents.filter((i) => i.significance === 'critical').length;
    const badge = critical > 0 ? countBadge(critical, 'critical') : undefined;

    const tbody = h('tbody');
    for (const inc of incidents) {
      const sColor = significanceColor(inc.significance);
      const iColor = ideologyClass(inc.ideology);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${sColor}` },
            inc.title,
          ),
          cell(inc.date, 'color:#9e9e9e'),
          cell(inc.actor, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;color:${iColor}` },
            ideologyLabel(inc.ideology),
          ),
          cell(recruitmentMethodLabel(inc.method), 'color:#ccc'),
          cell(inc.targetRegion, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:#facc15;text-align:right` },
            `~${formatFighters(inc.estimatedRecruits)}`,
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` },
            significanceLabel(inc.significance),
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Recruitment Network Incidents (2023-2024)', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Incident · date · actor · ideology · method · target region · est. recruits · significance',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
