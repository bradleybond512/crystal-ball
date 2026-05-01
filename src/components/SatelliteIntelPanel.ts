import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { satellitePropagator, type SatellitePosition } from '@/services/satellite-propagator';
import { type SatelliteTLE, getClassificationLabel } from '@/services/satellite-catalog';
import { getUpcomingPasses, getOverheadNow, computePasses, onPassesUpdated } from '@/services/satellite-passes';
import { getSavedPlaces } from '@/services/saved-places';

const BADGE_COLORS: Record<string, string> = {
  notable: '#ef3232',
  military: '#f97316',
  constellation: '#60a5fa',
  normal: '#9ca3af',
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  return String(Math.round(ms / 60_000));
}

export class SatelliteIntelPanel extends Panel {
  private selectedSat: SatelliteTLE | null = null;
  private selectedNoradId: number | null = null;
  private unsubPositions: (() => void) | null = null;
  private unsubPasses: (() => void) | null = null;
  private latestPositions: SatellitePosition[] = [];
  private lastRenderedLat = 0;
  private lastRenderedLon = 0;
  private lastRenderedAlt = 0;

  private readonly onSatSelected = (e: Event) => {
    const detail = (e as CustomEvent<{ satellite: SatelliteTLE; noradId: number }>).detail;
    this.selectedSat = detail.satellite;
    this.selectedNoradId = detail.noradId;
    this.render();
  };

  constructor() {
    super({
      id: 'satellite-intel',
      title: 'Satellite Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Live satellite tracking with pass predictions over your saved locations.',
    });

    window.addEventListener('satellite-selected', this.onSatSelected);

    this.unsubPasses = onPassesUpdated(() => {
      this.render();
    });

    this.unsubPositions = satellitePropagator.onPositions((positions) => {
      this.latestPositions = positions;
      if (this.selectedNoradId !== null) {
        const pos = positions.find(p => p.noradId === this.selectedNoradId);
        if (pos) {
          const latChanged = Math.abs(pos.lat - this.lastRenderedLat) > 0.01;
          const lonChanged = Math.abs(pos.lon - this.lastRenderedLon) > 0.01;
          const altChanged = Math.abs(pos.altKm - this.lastRenderedAlt) > 1;
          if (latChanged || lonChanged || altChanged) {
            this.render();
          }
        }
      }
    });

    this.render();
    this.triggerComputePasses();
  }

  private triggerComputePasses(): void {
    const places = getSavedPlaces().map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }));
    void computePasses(places);
  }

  private classificationBadge(classification: string): string {
    const color = BADGE_COLORS[classification] ?? BADGE_COLORS.normal;
    const label = getClassificationLabel(classification as Parameters<typeof getClassificationLabel>[0]);
    return `<span style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;letter-spacing:.05em">${escapeHtml(label)}</span>`;
  }

  private renderDetailCard(): string {
    if (!this.selectedSat) {
      return `<div class="panel-empty" style="padding:12px 0">Click a satellite on the map to view details</div>`;
    }

    const sat = this.selectedSat;
    const pos = this.selectedNoradId === null
      ? undefined
      : this.latestPositions.find(p => p.noradId === this.selectedNoradId);

    // TLE Line 2 columns 9-16 = inclination (degrees)
    const inclination = Number.parseFloat(sat.line2.slice(8, 16).trim());
    const incStr = Number.isNaN(inclination) ? '—' : `${inclination.toFixed(2)}°`;

    const latStr = pos ? `${pos.lat.toFixed(3)}°` : '—';
    const lonStr = pos ? `${pos.lon.toFixed(3)}°` : '—';
    const altStr = pos ? `${pos.altKm.toFixed(0)} km` : '—';

    if (pos) {
      this.lastRenderedLat = pos.lat;
      this.lastRenderedLon = pos.lon;
      this.lastRenderedAlt = pos.altKm;
    }

    return `
      <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-weight:700;font-size:13px">${escapeHtml(sat.name)}</span>
          ${this.classificationBadge(sat.classification)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;font-size:11px;opacity:0.8">
          <div><div style="opacity:0.55;font-size:10px">NORAD ID</div>${escapeHtml(String(sat.noradId))}</div>
          <div><div style="opacity:0.55;font-size:10px">INCL</div>${escapeHtml(incStr)}</div>
          <div><div style="opacity:0.55;font-size:10px">LAT/LON</div>${escapeHtml(latStr)} / ${escapeHtml(lonStr)}</div>
          <div><div style="opacity:0.55;font-size:10px">ALT</div>${escapeHtml(altStr)}</div>
        </div>
      </div>`;
  }

  private renderOverhead(): string {
    const overhead = getOverheadNow();
    if (overhead.length === 0) {
      return `<div class="panel-empty" style="padding:8px 0;font-size:12px">No tracked satellites overhead</div>`;
    }
    const rows = overhead.map(p => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px">
        <div style="flex:1;font-weight:600">${escapeHtml(p.satelliteName)}</div>
        <div style="opacity:0.7;font-size:11px">${escapeHtml(p.locationName)}</div>
        <div style="opacity:0.7;font-size:11px;white-space:nowrap">${p.maxElevation.toFixed(0)}° el</div>
      </div>`).join('');
    return rows;
  }

  private renderPasses(): string {
    const passes = getUpcomingPasses().slice(0, 20);
    if (passes.length === 0) {
      return `<div class="panel-empty" style="padding:8px 0;font-size:12px">No upcoming passes — add saved places to enable tracking</div>`;
    }
    const rows = passes.map(p => `
      <tr>
        <td style="font-weight:600;padding:4px 6px 4px 0;font-size:11px">${escapeHtml(p.satelliteName)}</td>
        <td style="padding:4px 6px;font-size:11px;opacity:0.7">${escapeHtml(p.locationName)}</td>
        <td style="padding:4px 6px;font-size:11px;white-space:nowrap">${escapeHtml(formatTime(p.riseTime))}</td>
        <td style="padding:4px 6px;font-size:11px;text-align:right">${p.maxElevation.toFixed(0)}°</td>
        <td style="padding:4px 6px 4px 0;font-size:11px;text-align:right">${escapeHtml(formatDuration(p.setTime - p.riseTime))} min</td>
      </tr>`).join('');

    return `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="opacity:0.45;font-size:10px;text-transform:uppercase;letter-spacing:.05em">
            <th style="text-align:left;padding:2px 6px 4px 0;font-weight:600">Satellite</th>
            <th style="text-align:left;padding:2px 6px;font-weight:600">Location</th>
            <th style="text-align:left;padding:2px 6px;font-weight:600">Rise</th>
            <th style="text-align:right;padding:2px 6px;font-weight:600">Max El</th>
            <th style="text-align:right;padding:2px 6px 4px 0;font-weight:600">Duration</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  private render(): void {
    const overhead = getOverheadNow();
    this.setCount(overhead.length);

    this.setContent(`
      <div style="padding:4px 0">
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;opacity:0.45;text-transform:uppercase;margin-bottom:6px">Selected Satellite</div>
        ${this.renderDetailCard()}
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;opacity:0.45;text-transform:uppercase;margin:10px 0 6px">Overhead Now</div>
        ${this.renderOverhead()}
        <div style="font-size:10px;font-weight:700;letter-spacing:.08em;opacity:0.45;text-transform:uppercase;margin:10px 0 6px">Upcoming Recon Passes</div>
        ${this.renderPasses()}
      </div>`);
  }

  override destroy(): void {
    window.removeEventListener('satellite-selected', this.onSatSelected);
    this.unsubPositions?.();
    this.unsubPasses?.();
    super.destroy();
  }
}
