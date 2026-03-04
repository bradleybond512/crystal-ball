import { Panel } from './Panel';
import type { Earthquake } from '@/services/earthquakes';
import type { WeatherAlert } from '@/services/weather';
import type { SocialUnrestEvent, InternetOutage, MilitaryFlight, MilitaryVessel, CyberThreat } from '@/types';
import type { AirportDelayAlert } from '@/services/aviation';
import type { FireRegionStats } from '@/services/wildfires';
import { escapeHtml } from '@/utils/sanitize';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertType =
  | 'earthquake'
  | 'weather'
  | 'protest'
  | 'outage'
  | 'military'
  | 'cyber'
  | 'delay'
  | 'wildfire';

export interface UnifiedAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  location: string;
  description: string;
  source: string;
  timestamp: Date;
  lat?: number;
  lon?: number;
}

const TYPE_ICONS: Record<AlertType, string> = {
  earthquake: '🌍',
  weather: '⛈️',
  protest: '✊',
  outage: '📡',
  military: '✈️',
  cyber: '🛡️',
  delay: '✈',
  wildfire: '🔥',
};

const TYPE_LABELS: Record<AlertType, string> = {
  earthquake: 'Earthquake',
  weather: 'Weather',
  protest: 'Protest',
  outage: 'Outage',
  military: 'Military',
  cyber: 'Cyber',
  delay: 'Airport',
  wildfire: 'Wildfire',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SEVERITY_ICONS: Record<AlertSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

export class AlertAggregatorPanel extends Panel {
  private allAlerts: UnifiedAlert[] = [];
  private severityFilter: AlertSeverity | 'all' = 'all';
  private typeFilter: AlertType | 'all' = 'all';

  constructor() {
    super({
      id: 'alert-aggregator',
      title: 'Alert Aggregator',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Unified view of critical alerts from all data sources — earthquakes, weather, protests, outages, military, cyber, airport delays, and wildfires.',
    });
    this.showLoading('Aggregating alerts...');
    this.bindControls();
  }

  // ── Public update methods ──────────────────────────────────────────────────

  public updateEarthquakes(earthquakes: Earthquake[]): void {
    const alerts = earthquakes
      .filter(eq => eq.magnitude >= 4.5)
      .map((eq): UnifiedAlert => ({
        id: `eq-${eq.id}`,
        type: 'earthquake',
        severity: eq.magnitude >= 7 ? 'critical' : eq.magnitude >= 6 ? 'high' : eq.magnitude >= 5 ? 'medium' : 'low',
        title: `M${eq.magnitude.toFixed(1)} Earthquake`,
        location: eq.place,
        description: `Magnitude ${eq.magnitude.toFixed(1)} · Depth ${eq.depthKm != null ? `${Math.round(eq.depthKm)} km` : '—'}`,
        source: 'USGS',
        timestamp: new Date(eq.occurredAt * 1000),
        lat: eq.location?.latitude,
        lon: eq.location?.longitude,
      }));
    this.mergeAlerts('earthquake', alerts);
  }

  public updateWeather(alerts: WeatherAlert[]): void {
    const unified = alerts
      .filter(a => a.severity === 'Extreme' || a.severity === 'Severe')
      .map((a): UnifiedAlert => ({
        id: `wx-${a.id}`,
        type: 'weather',
        severity: a.severity === 'Extreme' ? 'critical' : 'high',
        title: a.event,
        location: a.areaDesc,
        description: a.headline || a.description.slice(0, 120),
        source: 'NWS',
        timestamp: a.onset,
        lat: a.centroid?.[1],
        lon: a.centroid?.[0],
      }));
    this.mergeAlerts('weather', unified);
  }

  public updateProtests(events: SocialUnrestEvent[]): void {
    const alerts = events.map((e): UnifiedAlert => ({
      id: `pr-${e.id}`,
      type: 'protest',
      severity: e.severity === 'high' ? 'high' : e.severity === 'medium' ? 'medium' : 'low',
      title: e.title,
      location: [e.city, e.country].filter(Boolean).join(', '),
      description: e.summary ?? `${e.eventType.replace(/_/g, ' ')} · ${e.fatalities ? `${e.fatalities} casualties` : 'No casualties reported'}`,
      source: e.sourceType.toUpperCase(),
      timestamp: e.time,
      lat: e.lat,
      lon: e.lon,
    }));
    this.mergeAlerts('protest', alerts);
  }

  public updateOutages(outages: InternetOutage[]): void {
    const alerts = outages.map((o): UnifiedAlert => ({
      id: `out-${o.id}`,
      type: 'outage',
      severity: o.severity === 'total' ? 'critical' : o.severity === 'major' ? 'high' : 'medium',
      title: o.title,
      location: [o.region, o.country].filter(Boolean).join(', '),
      description: o.description.slice(0, 150),
      source: 'NetBlocks',
      timestamp: o.pubDate,
      lat: o.lat,
      lon: o.lon,
    }));
    this.mergeAlerts('outage', alerts);
  }

  public updateMilitary(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
    const flightAlerts = flights
      .filter(f => f.isInteresting || f.confidence === 'high')
      .map((f): UnifiedAlert => ({
        id: `mil-f-${f.id}`,
        type: 'military',
        severity: f.isInteresting ? 'high' : 'medium',
        title: `${f.aircraftType.replace(/_/g, ' ')} — ${f.callsign}`,
        location: f.operatorCountry,
        description: `${f.operatorCountry} · Alt ${f.altitude.toLocaleString()} ft · ${f.speed} kts`,
        source: 'OpenSky',
        timestamp: f.lastSeen,
        lat: f.lat,
        lon: f.lon,
      }));

    const vesselAlerts = vessels
      .filter(v => v.isDark || v.nearChokepoint)
      .map((v): UnifiedAlert => ({
        id: `mil-v-${v.id}`,
        type: 'military',
        severity: v.isDark ? 'high' : 'medium',
        title: `${v.vesselType.replace(/_/g, ' ')} — ${v.name}`,
        location: v.nearChokepoint ?? v.operatorCountry,
        description: `${v.operatorCountry} · ${v.isDark ? 'AIS dark' : `Near ${v.nearChokepoint}`} · ${v.speed} kts`,
        source: 'AIS',
        timestamp: v.lastAisUpdate,
        lat: v.lat,
        lon: v.lon,
      }));

    this.mergeAlerts('military', [...flightAlerts, ...vesselAlerts]);
  }

  public updateCyberThreats(threats: CyberThreat[]): void {
    const alerts = threats
      .filter(t => t.severity === 'critical' || t.severity === 'high')
      .slice(0, 50)
      .map((t): UnifiedAlert => ({
        id: `cy-${t.id}`,
        type: 'cyber',
        severity: t.severity === 'critical' ? 'critical' : 'high',
        title: `${t.type.replace(/_/g, ' ')} — ${t.indicator.length > 40 ? `${t.indicator.slice(0, 38)}…` : t.indicator}`,
        location: t.country ?? '—',
        description: `Source: ${t.source} · Type: ${t.indicatorType}`,
        source: t.source,
        timestamp: t.lastSeen ? new Date(t.lastSeen) : new Date(),
        lat: undefined,
        lon: undefined,
      }));
    this.mergeAlerts('cyber', alerts);
  }

  public updateFlightDelays(delays: AirportDelayAlert[]): void {
    const alerts = delays
      .filter(d => d.severity === 'major' || d.severity === 'severe' || d.delayType === 'closure')
      .map((d): UnifiedAlert => ({
        id: `dl-${d.id}`,
        type: 'delay',
        severity: d.delayType === 'closure' ? 'critical' : d.severity === 'severe' ? 'high' : 'medium',
        title: `${d.iata} — ${d.delayType.replace(/_/g, ' ')}`,
        location: `${d.city}, ${d.country}`,
        description: `${d.name} · Avg delay ${d.avgDelayMinutes} min${d.reason ? ` · ${d.reason}` : ''}`,
        source: d.source.toUpperCase(),
        timestamp: d.updatedAt,
        lat: d.lat,
        lon: d.lon,
      }));
    this.mergeAlerts('delay', alerts);
  }

  public updateFires(stats: FireRegionStats[], _total: number): void {
    const alerts = stats
      .filter(s => s.highIntensityCount > 0 || s.fireCount >= 10)
      .map((s): UnifiedAlert => ({
        id: `fire-${s.region.replace(/\s+/g, '-').toLowerCase()}`,
        type: 'wildfire',
        severity: s.highIntensityCount >= 5 ? 'critical' : s.highIntensityCount > 0 ? 'high' : 'medium',
        title: `Active Wildfires — ${s.region}`,
        location: s.region,
        description: `${s.fireCount} fires · ${s.highIntensityCount} high-intensity · FRP ${Math.round(s.totalFrp)}`,
        source: 'NASA FIRMS',
        timestamp: new Date(),
        lat: undefined,
        lon: undefined,
      }));
    this.mergeAlerts('wildfire', alerts);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private mergeAlerts(type: AlertType, incoming: UnifiedAlert[]): void {
    // Remove old alerts of this type and replace with new ones
    this.allAlerts = this.allAlerts.filter(a => a.type !== type);
    this.allAlerts.push(...incoming);
    this.setCount(this.filteredAlerts().length);
    this.render();
  }

  private filteredAlerts(): UnifiedAlert[] {
    return this.allAlerts
      .filter(a => this.severityFilter === 'all' || a.severity === this.severityFilter)
      .filter(a => this.typeFilter === 'all' || a.type === this.typeFilter)
      .sort((a, b) => {
        const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (rankDiff !== 0) return rankDiff;
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
  }

  private bindControls(): void {
    this.element.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.dataset.aggFilter === 'severity') {
        this.severityFilter = target.value as AlertSeverity | 'all';
        this.setCount(this.filteredAlerts().length);
        this.render();
      } else if (target.dataset.aggFilter === 'type') {
        this.typeFilter = target.value as AlertType | 'all';
        this.setCount(this.filteredAlerts().length);
        this.render();
      }
    });

    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.aggAction === 'export') {
        this.exportCsv();
      }
    });
  }

  private render(): void {
    const alerts = this.filteredAlerts();

    const controls = `
      <div class="agg-controls">
        <select class="agg-select" data-agg-filter="severity" aria-label="Filter by severity">
          <option value="all"${this.severityFilter === 'all' ? ' selected' : ''}>All Severities</option>
          <option value="critical"${this.severityFilter === 'critical' ? ' selected' : ''}>🔴 Critical</option>
          <option value="high"${this.severityFilter === 'high' ? ' selected' : ''}>🟠 High</option>
          <option value="medium"${this.severityFilter === 'medium' ? ' selected' : ''}>🟡 Medium</option>
          <option value="low"${this.severityFilter === 'low' ? ' selected' : ''}>⚪ Low</option>
        </select>
        <select class="agg-select" data-agg-filter="type" aria-label="Filter by type">
          <option value="all"${this.typeFilter === 'all' ? ' selected' : ''}>All Types</option>
          <option value="earthquake"${this.typeFilter === 'earthquake' ? ' selected' : ''}>🌍 Earthquakes</option>
          <option value="weather"${this.typeFilter === 'weather' ? ' selected' : ''}>⛈️ Weather</option>
          <option value="protest"${this.typeFilter === 'protest' ? ' selected' : ''}>✊ Protests</option>
          <option value="outage"${this.typeFilter === 'outage' ? ' selected' : ''}>📡 Outages</option>
          <option value="military"${this.typeFilter === 'military' ? ' selected' : ''}>✈️ Military</option>
          <option value="cyber"${this.typeFilter === 'cyber' ? ' selected' : ''}>🛡️ Cyber</option>
          <option value="delay"${this.typeFilter === 'delay' ? ' selected' : ''}>✈ Delays</option>
          <option value="wildfire"${this.typeFilter === 'wildfire' ? ' selected' : ''}>🔥 Wildfires</option>
        </select>
        <button class="agg-export-btn" data-agg-action="export" aria-label="Export alerts to CSV">⬇ CSV</button>
      </div>`;

    if (alerts.length === 0) {
      this.setContent(`${controls}<div class="panel-empty">No alerts matching current filters.</div>`);
      return;
    }

    const rows = alerts.map(a => {
      const icon = escapeHtml(TYPE_ICONS[a.type]);
      const typeLabel = escapeHtml(TYPE_LABELS[a.type]);
      const sevIcon = escapeHtml(SEVERITY_ICONS[a.severity]);
      const ago = timeAgo(a.timestamp);
      const coords = a.lat != null && a.lon != null
        ? `<span class="agg-coords">${a.lat.toFixed(2)},${a.lon.toFixed(2)}</span>`
        : '';
      return `<div class="agg-item agg-sev-${a.severity}" role="listitem">
        <div class="agg-item-header">
          <span class="agg-sev-icon" aria-label="${escapeHtml(a.severity)}">${sevIcon}</span>
          <span class="agg-type-badge">${icon} ${typeLabel}</span>
          <span class="agg-title">${escapeHtml(a.title)}</span>
          <span class="agg-age">${ago}</span>
        </div>
        <div class="agg-item-body">
          <span class="agg-location">📍 ${escapeHtml(a.location)}</span>
          <span class="agg-desc">${escapeHtml(a.description)}</span>
          <span class="agg-source">· ${escapeHtml(a.source)}</span>
          ${coords}
        </div>
      </div>`;
    }).join('');

    this.setContent(`
      ${controls}
      <div class="agg-list" role="list" aria-label="Alert list">
        ${rows}
      </div>
      <div class="fires-footer">
        <span class="fires-source">Earthquakes · Weather · Protests · Outages · Military · Cyber · Delays · Wildfires</span>
        <span class="fires-updated">${alerts.length} alert${alerts.length !== 1 ? 's' : ''}</span>
      </div>
    `);
  }

  private exportCsv(): void {
    const alerts = this.filteredAlerts();
    const header = 'Severity,Type,Title,Location,Description,Source,Timestamp,Lat,Lon\n';
    const rows = alerts.map(a => [
      a.severity,
      a.type,
      csvEscape(a.title),
      csvEscape(a.location),
      csvEscape(a.description),
      a.source,
      a.timestamp.toISOString(),
      a.lat ?? '',
      a.lon ?? '',
    ].join(',')).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function timeAgo(d: Date): string {
  try {
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 0) return 'now';
    if (secs < 60) return 'Just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '—';
  }
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
