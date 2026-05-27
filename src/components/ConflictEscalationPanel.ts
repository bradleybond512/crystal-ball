/**
 * Conflict Escalation Panel — global conflict zone tracker with escalation
 * phase scoring, threat vectors, actor profiles, and 30-day forecasts.
 *
 * Layout: sorted list by escalation score. Each row shows zone name, region,
 * phase badge, escalation score bar, and dominant threat vector. Clicking a
 * row expands an inline drill-down with full actor list, milestones timeline,
 * all threat vectors, and the 30-day forecast card.
 *
 * Data: static fixture data from conflict-escalation-helpers. Designed to
 * accept live data via setZones() for future API integration.
 */

import { Panel } from './Panel';
import {
  phaseLabel,
  phaseColor,
  phaseRank,
  escalationScoreColor,
  sortZonesByRisk,
  aggregateGlobalRisk,
  countZonesAtPhase,
  dominantThreat,
  latestMilestone,
  netEscalationDelta,
  avgActorCapability,
  milestoneLabel,
  domainLabel,
  trendColor,
  confidenceLabel,
  confidenceColor,
  formatRelativeTime,
  ACTIVE_CONFLICT_ZONES,
  ESCALATION_FORECASTS,
  type ConflictZone,
  type EscalationForecast,
} from '@/services/conflict/conflict-escalation-helpers';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5 * 60 * 1000;

export class ConflictEscalationPanel extends Panel {
  private zones: ConflictZone[] = ACTIVE_CONFLICT_ZONES;
  private forecasts: EscalationForecast[] = ESCALATION_FORECASTS;
  private expandedZoneId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'conflict-escalation',
      title: 'Conflict Escalation',
      showCount: true,
      infoTooltip:
        'Tracks global conflict zones by escalation phase (stable → war). ' +
        'Scores combine actor capability, threat vectors, and recent milestones. ' +
        'Forecasts show 30-day escalation probability and de-escalation pathways.',
    });

    this.render();
    this.startRefresh();
  }

  /** Inject live zone data (replaces static fixtures) */
  public setZones(zones: ConflictZone[]): void {
    this.zones = zones;
    this.render();
  }

  /** Inject live forecast data */
  public setForecasts(forecasts: EscalationForecast[]): void {
    this.forecasts = forecasts;
    this.render();
  }

  private startRefresh(): void {
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const sorted = sortZonesByRisk(this.zones);
    this.setCount(sorted.length);

    const globalRisk = aggregateGlobalRisk(this.zones);
    const warCount = countZonesAtPhase(this.zones, 'war');
    const activeCount = countZonesAtPhase(this.zones, 'active_conflict');
    const crisisCount = countZonesAtPhase(this.zones, 'crisis');

    const rows = sorted.map(z => this.renderZoneRow(z)).join('');

    const html = `
      <div class="conflict-escalation-panel">
        ${this.renderGlobalBanner(globalRisk, warCount, activeCount, crisisCount)}
        <div class="ce-zone-list" role="list">
          ${rows}
        </div>
      </div>
    `;
    this.setContent(html);
    this.markFresh();
    this.bindRowClicks();
  }

  private renderGlobalBanner(
    globalRisk: number,
    warCount: number,
    activeCount: number,
    crisisCount: number,
  ): string {
    const color = escalationScoreColor(globalRisk);
    return `
      <div class="ce-global-banner" style="
        display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
        padding: 8px 12px; margin-bottom: 8px;
        background: rgba(255,255,255,0.04); border-radius: 6px;
        border-left: 3px solid ${color};
      ">
        <div style="flex:1 1 120px">
          <div style="font-size:var(--text-xs);color:#888;">Global Risk Index</div>
          <div style="font-size:var(--text-xl);font-weight:700;color:${color};">${globalRisk}</div>
        </div>
        <div class="ce-pill" style="background:rgba(183,28,28,0.25);color:#ef5350;">
          ${warCount} War
        </div>
        <div class="ce-pill" style="background:rgba(239,68,68,0.2);color:#f87171;">
          ${activeCount} Active
        </div>
        <div class="ce-pill" style="background:rgba(251,146,60,0.2);color:#fb923c;">
          ${crisisCount} Crisis
        </div>
      </div>
    `;
  }

  private renderZoneRow(zone: ConflictZone): string {
    const color = phaseColor(zone.phase);
    const scoreColor = escalationScoreColor(zone.escalationScore);
    const isExpanded = this.expandedZoneId === zone.id;
    const threat = dominantThreat(zone.threatVectors);
    const age = formatRelativeTime(zone.updatedAt);

    const threatBadge = threat
      ? `<span style="font-size:var(--text-2xs);color:${trendColor(threat.trend)};margin-left:6px;">${domainLabel(threat.domain)} ${threat.severity}</span>`
      : '';

    const drill = isExpanded ? this.renderDrillDown(zone) : '';

    return `
      <div class="ce-zone-row ${isExpanded ? 'expanded' : ''}"
           role="listitem"
           data-zone-id="${escapeHtml(zone.id)}"
           tabindex="0"
           aria-expanded="${isExpanded}"
           style="
             padding: 10px 12px; margin-bottom: 4px; cursor: pointer;
             border-radius: 6px; border-left: 3px solid ${color};
             background: rgba(255,255,255,0.03);
             transition: background 0.15s;
           ">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="ce-phase-badge" style="
            font-size:var(--text-2xs); font-weight:600; padding:2px 6px;
            border-radius:4px; background:${color}22; color:${color};
            white-space:nowrap;
          ">${phaseLabel(zone.phase)}</span>
          <span style="font-size:var(--text-sm);font-weight:600;color:#e5e5e5;flex:1;">${escapeHtml(zone.name)}</span>
          <span style="font-size:var(--text-2xs);color:#666;">${escapeHtml(zone.region)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
          <div style="flex:1;background:#333;border-radius:3px;height:4px;overflow:hidden;">
            <div style="width:${zone.escalationScore}%;height:100%;background:${scoreColor};border-radius:3px;"></div>
          </div>
          <span style="font-size:var(--text-xs);font-weight:700;color:${scoreColor};min-width:28px;text-align:right;">${zone.escalationScore}</span>
          ${threatBadge}
          <span style="font-size:var(--text-2xs);color:#555;margin-left:auto;">${age}</span>
        </div>
        ${drill}
      </div>
    `;
  }

  private renderDrillDown(zone: ConflictZone): string {
    const forecast = this.forecasts.find(f => f.zoneId === zone.id);
    const netDelta = netEscalationDelta(zone.milestones);
    const avgCap = avgActorCapability(zone.actors);
    const latest = latestMilestone(zone.milestones);

    const actorsHtml = zone.actors.map(a => `
      <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:var(--text-xs);font-weight:600;color:#e5e5e5;">${escapeHtml(a.name)}</span>
          <span style="font-size:var(--text-2xs);color:#888;">${escapeHtml(a.country)}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:3px;">
          <span style="font-size:var(--text-2xs);color:#aaa;">Cap: <b style="color:#e5e5e5;">${a.capability}</b></span>
          <span style="font-size:var(--text-2xs);color:#aaa;">Mot: <b style="color:#e5e5e5;">${a.motivation}</b></span>
          ${a.externalSupport.length > 0 ? `<span style="font-size:var(--text-2xs);color:#888;">+${escapeHtml(a.externalSupport.join(', '))}</span>` : ''}
        </div>
      </div>
    `).join('');

    const vectorsHtml = zone.threatVectors.map(v => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <span style="font-size:var(--text-2xs);color:#aaa;min-width:56px;">${domainLabel(v.domain)}</span>
        <div style="flex:1;background:#333;border-radius:2px;height:3px;overflow:hidden;">
          <div style="width:${v.severity}%;height:100%;background:${trendColor(v.trend)};"></div>
        </div>
        <span style="font-size:var(--text-2xs);color:${trendColor(v.trend)};min-width:24px;text-align:right;">${v.severity}</span>
      </div>
    `).join('');

    const milestonesHtml = zone.milestones.slice().reverse().map(m => `
      <div style="padding:4px 0;font-size:var(--text-2xs);">
        <span style="color:${confidenceColor(m.confidence)};">[${milestoneLabel(m.type)}]</span>
        <span style="color:#ccc;margin-left:4px;">${escapeHtml(m.description)}</span>
        <span style="color:${m.escalationDelta >= 0 ? '#f44336' : '#4caf50'};margin-left:6px;">${m.escalationDelta >= 0 ? '+' : ''}${m.escalationDelta}</span>
        <span style="color:#888;margin-left:4px;">(${confidenceLabel(m.confidence)})</span>
      </div>
    `).join('');

    const forecastHtml = forecast ? `
      <div style="margin-top:8px;padding:8px;background:rgba(255,255,255,0.04);border-radius:4px;">
        <div style="font-size:var(--text-2xs);font-weight:700;color:#aaa;margin-bottom:4px;">30-DAY FORECAST</div>
        ${forecast.nextPhase ? `
          <div style="font-size:var(--text-xs);color:#e5e5e5;">
            Escalation to <b style="color:${phaseColor(forecast.nextPhase)};">${phaseLabel(forecast.nextPhase)}</b>:
            <b style="color:#fb923c;">${Math.round(forecast.probability30d * 100)}%</b>
          </div>
        ` : `<div style="font-size:var(--text-xs);color:#888;">At maximum phase — no further escalation tracked</div>`}
        <div style="font-size:var(--text-2xs);color:#888;margin-top:4px;">
          Key: ${forecast.keyDrivers.map(escapeHtml).join(' · ')}
        </div>
        ${forecast.deescalationPathways.length > 0 ? `
          <div style="font-size:var(--text-2xs);color:#4caf50;margin-top:4px;">
            De-esc: ${forecast.deescalationPathways.map(escapeHtml).join(' · ')}
          </div>
        ` : ''}
      </div>
    ` : '';

    return `
      <div class="ce-drill-down" style="
        margin-top:10px; padding-top:10px;
        border-top:1px solid rgba(255,255,255,0.08);
      ">
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
          <div><div style="font-size:var(--text-2xs);color:#888;">Net Delta</div>
               <div style="font-size:var(--text-base);font-weight:700;color:${netDelta >= 0 ? '#f44336' : '#4caf50'};">${netDelta >= 0 ? '+' : ''}${netDelta}</div></div>
          <div><div style="font-size:var(--text-2xs);color:#888;">Avg Capability</div>
               <div style="font-size:var(--text-base);font-weight:700;color:#e5e5e5;">${avgCap}</div></div>
          <div><div style="font-size:var(--text-2xs);color:#888;">Civilian Risk</div>
               <div style="font-size:var(--text-base);font-weight:700;color:${escalationScoreColor(zone.civilianRisk)};">${zone.civilianRisk}</div></div>
          <div><div style="font-size:var(--text-2xs);color:#888;">Actors</div>
               <div style="font-size:var(--text-base);font-weight:700;color:#e5e5e5;">${zone.actors.length}</div></div>
        </div>

        <div style="font-size:var(--text-2xs);font-weight:700;color:#aaa;margin-bottom:4px;">ACTORS</div>
        ${actorsHtml}

        <div style="font-size:var(--text-2xs);font-weight:700;color:#aaa;margin:8px 0 4px;">THREAT VECTORS</div>
        ${vectorsHtml}

        <div style="font-size:var(--text-2xs);font-weight:700;color:#aaa;margin:8px 0 4px;">MILESTONES</div>
        ${milestonesHtml}

        ${forecastHtml}
      </div>
    `;
  }

  private bindRowClicks(): void {
    const rows = this.content.querySelectorAll<HTMLElement>('.ce-zone-row');
    for (const row of rows) {
      const zoneId = row.dataset.zoneId;
      if (!zoneId) continue;

      const handler = (e: Event) => {
        e.stopPropagation();
        this.expandedZoneId = this.expandedZoneId === zoneId ? null : zoneId;
        this.render();
      };

      row.addEventListener('click', handler);
      row.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler(e);
        }
      });
    }
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
