import { Panel } from './Panel';
import type {
  NuclearMonitorData,
  RadNetStation,
  NuclearFacility,
  SeismicAnomaly,
  RadiationLevel,
  FacilityStatus,
} from '@/services/nuclear-monitor';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';
import { locationBannerHtml, wireLocationBanner } from '@/components/location-gate';

export class NuclearMonitorPanel extends Panel {
  private data: NuclearMonitorData | null = null;
  private lastUpdated: Date | null = null;

  constructor() {
 super({
 id: 'nuclear-monitor',
 title: 'Nuclear Monitor',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Radiation monitoring from EPA RadNet stations, nuclear facility status, and USGS seismic data filtered for potential nuclear test signatures (shallow depth &lt; 5km).',
 });
 this.showLoading('Fetching nuclear monitoring data...');
  }

  public update(data: NuclearMonitorData): void {
 this.data = data;
 this.lastUpdated = new Date();
 // Count = elevated+ stations + test-signature anomalies
 const alertCount = data.summary.elevatedStations + data.summary.highStations
 + data.summary.criticalStations + data.summary.anomalyCount;
 this.setCount(alertCount);
 this.render();
  }

  private render(): void {
 if (!this.data) {
 this.setContent('<div class="panel-empty">Nuclear monitoring data unavailable.</div>');
 return;
 }

 const { stations, facilities, seismicAnomalies, summary } = this.data;
 const locBanner = locationBannerHtml();

 // Summary bar
 const summaryHtml = `
 <div class="nm-summary">
 <span class="nm-badge nm-normal">${summary.normalStations} Normal</span>
 ${summary.elevatedStations > 0 ? `<span class="nm-badge nm-elevated">${summary.elevatedStations} Elevated</span>` : ''}
 ${summary.highStations > 0 ? `<span class="nm-badge nm-high">${summary.highStations} High</span>` : ''}
 ${summary.criticalStations > 0 ? `<span class="nm-badge nm-critical">${summary.criticalStations} Critical</span>` : ''}
 <span class="nm-badge nm-reactors">${summary.activeReactors} Reactors Online</span>
 ${summary.anomalyCount > 0 ? `<span class="nm-badge nm-anomaly">${summary.anomalyCount} Seismic Anomalies</span>` : ''}
 </div>
 `;

 // Seismic anomalies (test signatures first)
 let anomalyHtml = '';
 const testSigs = seismicAnomalies.filter(a => a.isTestSignature);
 if (testSigs.length > 0) {
 const anomRows = testSigs.slice(0, 10).map(a => renderAnomaly(a)).join('');
 anomalyHtml = `
 <div class="nm-section">
 <h4 class="nm-section-title">Seismic Anomalies — Potential Test Signatures</h4>
 <div class="nm-anomalies">${anomRows}</div>
 </div>
 `;
 }

 // Radiation stations table
 const stationRows = stations.slice(0, 20).map(s => renderStation(s)).join('');
 const stationsHtml = `
 <div class="nm-section">
 <h4 class="nm-section-title">RadNet Stations (${stations.length})</h4>
 <table class="eq-table">
 <thead>
 <tr>
 <th>Station</th>
 <th>State</th>
 <th>Level</th>
 <th>Gamma CPM</th>
 <th>vs Baseline</th>
 <th>Distance</th>
 </tr>
 </thead>
 <tbody>${stationRows}</tbody>
 </table>
 </div>
 `;

 // Nuclear facilities
 const operationalFacilities = facilities
 .filter(f => f.type === 'power')
 .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
 .slice(0, 15);
 const facilityRows = operationalFacilities.map(f => renderFacility(f)).join('');
 const facilitiesHtml = `
 <div class="nm-section">
 <h4 class="nm-section-title">Nuclear Facilities</h4>
 <table class="eq-table">
 <thead>
 <tr>
 <th>Facility</th>
 <th>Country</th>
 <th>Status</th>
 <th>Capacity</th>
 <th>Distance</th>
 </tr>
 </thead>
 <tbody>${facilityRows}</tbody>
 </table>
 </div>
 `;

 const updatedStr = this.lastUpdated ? formatTime(this.lastUpdated) : 'never';

 this.setContent(`
 <div class="nm-panel-content">
 ${locBanner}
 ${summaryHtml}
 ${anomalyHtml}
 ${stationsHtml}
 ${facilitiesHtml}
 <div class="fires-footer">
 <span class="fires-source">EPA RadNet · USGS Earthquake API · NRC</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>
 `);
 wireLocationBanner(this.getContentElement(), () => { this.render(); });
  }
}

function renderStation(station: RadNetStation): string {
  const cls = station.level === 'critical' ? 'eq-row eq-major'
 : station.level === 'high' ? 'eq-row eq-strong'
 : station.level === 'elevated' ? 'eq-row eq-moderate'
 : 'eq-row';

  const levelBadge = `<span class="nm-level-dot nm-level-${station.level}">${levelLabel(station.level)}</span>`;
  const cpmStr = station.gammaGrossCount === null ? '—' : `${station.gammaGrossCount}`;
  const devStr = station.gammaGrossCount === null
 ? '—'
 : `${station.deviationPercent > 0 ? '+' : ''}${station.deviationPercent}%`;
  const distStr = station.distanceKm === null ? '—' : `${Math.round(station.distanceKm)} km`;

  return `<tr class="${cls}">
 <td>${escapeHtml(station.city)}</td>
 <td>${escapeHtml(station.state)}</td>
 <td>${levelBadge}</td>
 <td>${cpmStr}</td>
 <td>${devStr}</td>
 <td>${distStr}</td>
  </tr>`;
}

function renderFacility(facility: NuclearFacility): string {
  const cls = facility.status === 'operational' ? 'eq-row'
 : (facility.status === 'shutdown' || facility.status === 'decommissioned' ? 'eq-row eq-moderate'
 : 'eq-row');

  const statusBadge = `<span class="nm-facility-status nm-fs-${facility.status}">${statusLabel(facility.status)}</span>`;
  const capStr = facility.capacity_mw !== null && facility.capacity_mw > 0 ? `${facility.capacity_mw} MW` : '—';
  const distStr = facility.distanceKm === null ? '—' : `${Math.round(facility.distanceKm)} km`;

  return `<tr class="${cls}">
 <td>${escapeHtml(facility.name)}</td>
 <td>${escapeHtml(facility.country)}${facility.state ? ` (${escapeHtml(facility.state)})` : ''}</td>
 <td>${statusBadge}</td>
 <td>${capStr}</td>
 <td>${distStr}</td>
  </tr>`;
}

function renderAnomaly(anomaly: SeismicAnomaly): string {
  const dateStr = anomaly.time.toLocaleString();
  const facilityInfo = anomaly.nearestFacility
 ? `Near: ${escapeHtml(anomaly.nearestFacility)} (${anomaly.distanceToFacility_km ?? '?'} km)`
 : '';

  return `
 <div class="nm-anomaly ${anomaly.isTestSignature ? 'nm-anomaly-test' : ''}">
 <div class="nm-anomaly-header">
 <span class="nm-anomaly-mag">M${anomaly.magnitude.toFixed(1)}</span>
 <span class="nm-anomaly-depth">Depth: ${anomaly.depth_km.toFixed(1)} km</span>
 </div>
 <div class="nm-anomaly-place">${escapeHtml(anomaly.place)}</div>
 <div class="nm-anomaly-meta">${dateStr} ${facilityInfo ? `· ${facilityInfo}` : ''}</div>
 </div>
  `;
}

function levelLabel(level: RadiationLevel): string {
  const labels: Record<RadiationLevel, string> = {
 normal: 'Normal',
 elevated: 'Elevated',
 high: 'High',
 critical: 'Critical',
  };
  return labels[level];
}

function statusLabel(status: FacilityStatus): string {
  const labels: Record<FacilityStatus, string> = {
 operational: 'Online',
 maintenance: 'Maintenance',
 shutdown: 'Shutdown',
 decommissioned: 'Decommissioned',
 unknown: 'Unknown',
  };
  return labels[status];
}

