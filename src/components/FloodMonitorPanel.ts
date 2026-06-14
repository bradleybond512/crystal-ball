import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getSavedPlacesFilterService, isNearActivePlace } from '@/services/intelligence/saved-places-filter';

interface StateFloodEntry {
  state: string;
  count: number;
  maxSeverity?: string;
  maxSeverityRank?: number;
  maxStage?: string;
  events?: string[];
}

interface GaugeEntry {
  siteNo: string;
  siteName: string;
  state: string;
  stageVal: number;
  stage: string;
  lat: number | null;
  lon: number | null;
}

interface FloodAlert {
  id: string;
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  states: string[];
}

interface GaugeData {
  totalGauges: number;
  atFloodStage: number;
  atActionStage: number;
  byState: StateFloodEntry[];
  top10: GaugeEntry[];
  generatedAt: string;
  degraded?: boolean;
}

interface WarningData {
  total: number;
  byState: StateFloodEntry[];
  alerts: FloodAlert[];
  generatedAt: string;
  degraded?: boolean;
}

export class FloodMonitorPanel extends Panel {
  private gaugeData: GaugeData | null = null;
  private warningData: WarningData | null = null;
  private lastUpdated: Date | null = null;
  private filterUnsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'flood-monitor',
      title: 'Flood Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'USGS stream gauge readings at flood stage + NWS active flood watches and warnings.',
    });
    this.showLoading('Fetching flood data...');
    this.filterUnsub = getSavedPlacesFilterService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    this.filterUnsub?.();
    this.filterUnsub = null;
  }

  public updateGauges(data: GaugeData): void {
    this.gaugeData = data;
    this.lastUpdated = new Date();
    this.updateCount();
    this.render();
  }

  public updateWarnings(data: WarningData): void {
    this.warningData = data;
    this.lastUpdated = new Date();
    this.updateCount();
    this.render();
  }

  private updateCount(): void {
    const gaugeCount = this.gaugeData?.atFloodStage ?? 0;
    const warningCount = this.warningData?.total ?? 0;
    this.setCount(gaugeCount + warningCount);
  }

  private render(): void {
    if (!this.gaugeData && !this.warningData) {
      this.setContent('<div class="panel-empty">No flood data available.</div>');
      return;
    }

    const ctx = getSavedPlacesFilterService().getContext();
    const allTop10 = this.gaugeData?.top10 ?? [];
    const filteredTop10 = ctx.isActive
      ? allTop10.filter(g => g.lat != null && g.lon != null ? isNearActivePlace(g.lat!, g.lon!) : true)
      : allTop10;
    const hiddenGauges = allTop10.length - filteredTop10.length;

    const filterBanner = ctx.isActive
      ? `<div class="spf-proximity-banner">📍 ${escapeHtml(ctx.activePlaceName ?? '')} · ${ctx.radiusKm} km · ${hiddenGauges > 0 ? `${hiddenGauges} gauges hidden` : 'showing all'}</div>`
      : '';

    const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated) : 'never';
    const sections: string[] = [];
    if (filterBanner) sections.push(filterBanner);

    // Summary row
    const gaugeCount = this.gaugeData?.atFloodStage ?? '—';
    const warningCount = this.warningData?.total ?? '—';
    sections.push(`
      <div class="flood-summary-row">
        <div class="flood-stat">
          <span class="flood-stat-value ${this.gaugeData?.atFloodStage ? 'flood-stat-alert' : ''}">${gaugeCount}</span>
          <span class="flood-stat-label">Gauges at flood stage${ctx.isActive ? ' (US total)' : ''}</span>
        </div>
        <div class="flood-stat">
          <span class="flood-stat-value ${this.warningData?.total ? 'flood-stat-alert' : ''}">${warningCount}</span>
          <span class="flood-stat-label">NWS flood alerts${ctx.isActive ? ' (US total)' : ''}</span>
        </div>
      </div>
    `);

    // NWS warnings by state (state-level data — no per-alert coordinates, shown nationwide when filter active)
    if (this.warningData && this.warningData.byState.length > 0) {
      const rows = this.warningData.byState.slice(0, 10).map(s => {
        const badge = severityBadge(s.maxSeverity ?? 'Unknown');
        const events = (s.events ?? []).slice(0, 2).map(e => escapeHtml(e)).join(', ');
        return `<tr>
          <td class="flood-state">${escapeHtml(s.state)}</td>
          <td class="flood-count">${s.count}</td>
          <td>${badge}</td>
          <td class="flood-events">${events}</td>
        </tr>`;
      }).join('');

      const stateNote = ctx.isActive ? ' <span style="font-size:10px;opacity:0.5;font-weight:400;">(state-level, not proximity filtered)</span>' : '';
      sections.push(`
        <div class="flood-section">
          <div class="flood-section-header">NWS Active Alerts by State${stateNote}</div>
          <table class="flood-table">
            <thead><tr><th>State</th><th>#</th><th>Severity</th><th>Alert Type</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);
    } else if (this.warningData && !this.warningData.degraded) {
      sections.push('<div class="panel-empty flood-empty">No active NWS flood alerts.</div>');
    }

    // Top 10 gauges (proximity-filtered when filter is active)
    if (this.gaugeData && filteredTop10.length > 0) {
      const rows = filteredTop10.map(g => {
        const stageClass = stageRowClass(g.stage);
        return `<tr class="${stageClass}">
          <td class="flood-gauge-name">${escapeHtml(g.siteName)}</td>
          <td class="flood-state">${escapeHtml(g.state)}</td>
          <td class="flood-stage-val">${g.stageVal.toFixed(1)} ft</td>
          <td>${stageBadge(g.stage)}</td>
        </tr>`;
      }).join('');

      sections.push(`
        <div class="flood-section">
          <div class="flood-section-header">Top Flood-Stage Gauges</div>
          <table class="flood-table">
            <thead><tr><th>Site</th><th>State</th><th>Stage</th><th>Level</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);
    } else if (this.gaugeData && filteredTop10.length === 0 && allTop10.length > 0) {
      sections.push(`<div class="panel-empty flood-empty">No flood-stage gauges within ${ctx.radiusKm} km of ${escapeHtml(ctx.activePlaceName ?? 'saved place')}.</div>`);
    } else if (this.gaugeData && !this.gaugeData.degraded) {
      sections.push('<div class="panel-empty flood-empty">No gauges currently at flood stage.</div>');
    }

    this.setContent(`
      <div class="flood-panel-content">
        ${sections.join('')}
        <div class="fires-footer">
          <span class="fires-source">USGS Water Services · NWS · No API key</span>
          <span class="fires-updated">Updated ${updatedStr}</span>
        </div>
      </div>
    `);
  }
}

function severityBadge(severity: string): string {
  const cls = {
    Extreme: 'badge-extreme',
    Severe: 'badge-severe',
    Moderate: 'badge-moderate',
    Minor: 'badge-minor',
  }[severity] ?? 'badge-unknown';
  return `<span class="flood-badge ${cls}">${escapeHtml(severity)}</span>`;
}

function stageBadge(stage: string): string {
  const cls = {
    major: 'badge-extreme',
    moderate: 'badge-severe',
    minor: 'badge-moderate',
    action: 'badge-minor',
    flood: 'badge-moderate',
  }[stage] ?? 'badge-unknown';
  return `<span class="flood-badge ${cls}">${escapeHtml(stage)}</span>`;
}

function stageRowClass(stage: string): string {
  if (stage === 'major') return 'flood-row-major';
  if (stage === 'moderate') return 'flood-row-moderate';
  return '';
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
