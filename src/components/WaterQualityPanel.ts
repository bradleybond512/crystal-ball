import { Panel } from './Panel';
import type {
  SurfaceWaterMeasurement,
  WaterQualityData,
  WaterAlert,
  WaterAlertType,
  WaterSystem,
  WaterAlertSeverity,
} from '@/services/water-quality';
import { fetchWaterQuality, selectWaterQualityLocation } from '@/services/water-quality';
import { getSavedPlaces, subscribeSavedPlaces } from '@/services/saved-places';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';
import { locationBannerHtml, wireLocationBanner } from '@/components/location-gate';

export class WaterQualityPanel extends Panel {
  private data: WaterQualityData | null = null;
  private unsubscribePlaces: (() => void) | null = null;
  private refreshSequence = 0;

  constructor() {
 super({
 id: 'water-quality',
 title: 'Water Quality',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Water evidence with strict source semantics. EPA rows are compliance history; USGS rows are surface-water measurements. Neither establishes current tap-water safety.',
 });
 this.showLoading('Fetching water quality data...');
 this.unsubscribePlaces = subscribeSavedPlaces((places) => {
 void this.refreshForPlaces(places);
 });
 void this.refreshForPlaces(getSavedPlaces());
  }

 public override destroy(): void {
 this.refreshSequence += 1;
 this.unsubscribePlaces?.();
 this.unsubscribePlaces = null;
 super.destroy();
 }

 private async refreshForPlaces(places: ReturnType<typeof getSavedPlaces>): Promise<void> {
 const sequence = ++this.refreshSequence;
 const location = selectWaterQualityLocation(places);
 // A saved-place switch is an immediate evidence boundary. Do not leave the
 // previous location's measurements rendered while the new bounded request is
 // pending (up to its network timeout).
 this.data = null;
 this.setCount(0);
 this.showLoading(location
   ? 'Fetching water evidence for the current saved place…'
   : 'Fetching water evidence…');
 try {
 const data = await fetchWaterQuality(location);
 if (sequence === this.refreshSequence) this.update(data);
 } catch {
 if (sequence !== this.refreshSequence) return;
 this.data = null;
 this.setCount(0);
 this.setContent('<div class="panel-empty">Water evidence sources are currently unavailable.</div>');
 }
 }

 public update(data: WaterQualityData): void {
 this.data = data;
 this.setCount(data.potableAdvisories.length + data.complianceRecords.length);
 this.render();
  }

  private render(): void {
 if (!this.data) {
 this.setContent('<div class="panel-empty">Water quality data unavailable.</div>');
 return;
 }

 const { potableAdvisories, complianceRecords, surfaceMeasurements, systems } = this.data;
 const locBanner = locationBannerHtml();

 // Summary bar
 const summaryHtml = `
 <div class="wq-summary">
 <span class="wq-badge wq-advisory">Potable status: ${escapeHtml(this.data.potableStatus)}</span>
 <span class="wq-badge">${complianceRecords.length} EPA compliance records</span>
 <span class="wq-badge">${surfaceMeasurements.length} USGS surface readings</span>
 </div>
 `;

 // Explicit potable advisories only. EPA and USGS evidence never enters this list.
 let alertsHtml = '';
 if (potableAdvisories.length > 0) {
 const alertRows = potableAdvisories.slice(0, 20).map(a => renderAlert(a)).join('');
 alertsHtml = `
 <div class="wq-section">
 <h4 class="wq-section-title">Official Potable-Water Advisories (${potableAdvisories.length})</h4>
 <div class="wq-alerts">${alertRows}</div>
 </div>
 `;
 }

 const complianceHtml = complianceRecords.length === 0 ? '' : `
 <div class="wq-section">
 <h4 class="wq-section-title">EPA Compliance History (${complianceRecords.length})</h4>
 <div class="wq-alerts">${complianceRecords.slice(0, 20).map(renderComplianceRecord).join('')}</div>
 </div>`;

 const measurementsHtml = surfaceMeasurements.length === 0 ? '' : `
 <div class="wq-section">
 <h4 class="wq-section-title">USGS Surface-Water Measurements (${surfaceMeasurements.length})</h4>
 <div class="wq-alerts">${surfaceMeasurements.slice(0, 20).map(renderSurfaceMeasurement).join('')}</div>
 </div>`;

 // Water systems table
 const systemRows = systems.slice(0, 25).map(s => renderSystem(s)).join('');
 const systemsHtml = `
 <div class="wq-section">
 <h4 class="wq-section-title">Systems in EPA Compliance Results (${systems.length})</h4>
 <table class="eq-table">
 <thead>
 <tr>
 <th>System</th>
 <th>State</th>
 <th>Status</th>
 <th>Violations</th>
 <th>Distance</th>
 </tr>
 </thead>
 <tbody>${systemRows}</tbody>
 </table>
 </div>
 `;

 const updatedStr = formatTime(this.data.retrievedAt);
 const limitationsHtml = `<div class="panel-empty" style="margin-bottom:10px;">${escapeHtml(this.data.limitations.join(' '))}</div>`;
 const coverageHtml = `<div class="watchlist-scenario">EPA compliance: ${escapeHtml(this.data.sourceCoverage.epaCompliance)} · USGS surface water: ${escapeHtml(this.data.sourceCoverage.usgsSurfaceWater)} · Live potable advisories: not configured</div>`;

 this.setContent(`
 <div class="wq-panel-content">
 ${locBanner}
 ${limitationsHtml}
 ${summaryHtml}
 ${alertsHtml}
 ${complianceHtml}
 ${measurementsHtml}
 ${systemsHtml}
 ${coverageHtml}
 <div class="fires-footer">
 <span class="fires-source">EPA SDWIS compliance · USGS surface-water telemetry</span>
 <span class="fires-updated">Retrieved ${updatedStr}</span>
 </div>
 </div>
 `);
 wireLocationBanner(this.getContentElement(), () => { this.render(); });
  }
}

function renderComplianceRecord(record: WaterAlert): string {
  const date = record.sourceObservedAt && record.sourceObservedAt.getTime() > 0
    ? record.sourceObservedAt.toLocaleDateString()
    : 'date unavailable';
  return `
 <div class="wq-alert wq-alert-info">
 <span class="wq-alert-icon">ℹ️</span>
 <div class="wq-alert-body">
 <div class="wq-alert-title">${escapeHtml(record.title)}</div>
 <div class="wq-alert-desc">${escapeHtml(record.description)}</div>
 <div class="wq-alert-meta">${escapeHtml(record.state || 'State unavailable')} · source date ${escapeHtml(date)}</div>
 </div>
 </div>`;
}

function renderSurfaceMeasurement(measurement: SurfaceWaterMeasurement): string {
  const sourceTime = measurement.sourceObservedAt
    ? measurement.sourceObservedAt.toLocaleString()
    : 'source time unavailable';
  return `
 <div class="wq-alert wq-alert-info">
 <span class="wq-alert-icon">🌊</span>
 <div class="wq-alert-body">
 <div class="wq-alert-title">${escapeHtml(measurement.siteName)}</div>
 <div class="wq-alert-desc">${escapeHtml(measurement.parameterName)}: ${measurement.value.toLocaleString()}${measurement.unit ? ` ${escapeHtml(measurement.unit)}` : ''}</div>
 <div class="wq-alert-meta">Surface-water sensor · ${escapeHtml(sourceTime)} · no potable-water inference</div>
 </div>
 </div>`;
}

function renderAlert(alert: WaterAlert): string {
  const sevClass = severityClass(alert.severity);
  const alertIcons: Record<WaterAlertType, string> = {
 'boil-water': '🔥',
 'do-not-use': '🚫',
 contamination: '⚠️',
 'treatment-outage': '🔧',
 general: 'ℹ️',
  };
  const icon = alertIcons[alert.type] ?? 'ℹ️';

  const dateStr = alert.issuedAt.toLocaleDateString();

  return `
 <div class="wq-alert ${sevClass}">
 <span class="wq-alert-icon">${icon}</span>
 <div class="wq-alert-body">
 <div class="wq-alert-title">${escapeHtml(alert.title)}</div>
 <div class="wq-alert-desc">${escapeHtml(alert.description)}</div>
 <div class="wq-alert-meta">${escapeHtml(alert.state)} · ${dateStr}</div>
 </div>
 </div>
  `;
}

function renderSystem(sys: WaterSystem): string {
  const statusClsMap: Record<WaterAlertSeverity, string> = {
 'do-not-use': 'eq-row eq-major',
 advisory: 'eq-row eq-moderate',
 safe: 'eq-row',
 unknown: 'eq-row',
  };
  const cls = statusClsMap[sys.status];

  const statusBadge = `<span class="wq-status-dot wq-status-${sys.status}">${statusLabel(sys.status)}</span>`;
  const distStr = sys.distanceKm === null ? '—' : `${Math.round(sys.distanceKm)} km`;

  return `<tr class="${cls}">
 <td>${escapeHtml(sys.name)}</td>
 <td>${escapeHtml(sys.state)}</td>
 <td>${statusBadge}</td>
 <td>${sys.violations}</td>
 <td>${distStr}</td>
  </tr>`;
}

function statusLabel(status: WaterAlertSeverity): string {
  const labels: Record<WaterAlertSeverity, string> = {
 safe: 'Safe',
 advisory: 'Advisory',
 'do-not-use': 'Do Not Use',
 unknown: 'Unknown',
  };
  return labels[status];
}

function severityClass(severity: WaterAlertSeverity): string {
  if (severity === 'do-not-use') return 'wq-alert-critical';
  if (severity === 'advisory') return 'wq-alert-warning';
  return 'wq-alert-info';
}
