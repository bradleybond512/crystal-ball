/**
 * Geospatial Clustering Panel (panel id: `geospatial-clustering`).
 *
 * Summary stats (total clusters + hotspot count + avg points/cluster)
 * over a hotspot list. Each card shows centroid coordinates, point
 * count, dominant severity, domain badge, and a click-to-expand
 * detail listing the constituent points. A "Nearby Search" row at
 * the bottom queries clusters within a custom lat/lon/radius.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getGeospatialClusteringService,
  type ClusterSummary,
  type GeoCluster,
} from '@/services/intelligence/geospatial-clustering';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const SEVERITY_COLOR: Record<string, string> = {
  low: '#9ca3af',
  medium: '#f5a524',
  high: '#e07b30',
  critical: '#e94f37',
};

export class GeospatialClusteringPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((clusters: GeoCluster[]) => void) | null = null;
  private expanded: string | null = null;
  private nearbyResults: GeoCluster[] | null = null;
  private nearbyMessage: string | null = null;

  constructor() {
    super({
      id: 'geospatial-clustering',
      title: 'Geo Clusters',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Groups observations within a haversine radius into hotspot clusters. Centroid, dominant severity, and domain shown per cluster.',
    });
    const svc = getGeospatialClusteringService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getGeospatialClusteringService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getGeospatialClusteringService();
    const summary = svc.getSummary();
    this.setCount(summary.hotspots.length);
    this.setContent(this.buildHtml(summary), () => this.wireHandlers());
  }

  private buildHtml(summary: ClusterSummary): string {
    return `<div class="geo-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(summary)}
      ${this.renderHotspots(summary.hotspots)}
      ${this.renderNearbyForm()}
      ${this.renderNearbyResults()}
    </div>`;
  }

  private renderHeader(summary: ClusterSummary): string {
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">
      <span>${summary.totalClusters} cluster${summary.totalClusters === 1 ? '' : 's'} · ${summary.hotspots.length} hotspot${summary.hotspots.length === 1 ? '' : 's'}</span>
      <span style="font-family:ui-monospace,monospace;opacity:0.85;">${summary.avgPointsPerCluster.toFixed(1)} pts/cluster avg</span>
    </div>`;
  }

  private renderHotspots(hotspots: readonly GeoCluster[]): string {
    if (hotspots.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No hotspots — clusters need ≥ 3 points or high/critical severity.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">${hotspots.map((c) => this.renderClusterCard(c)).join('')}</div>`;
  }

  private renderClusterCard(c: GeoCluster): string {
    const sevColor = SEVERITY_COLOR[c.dominantSeverity] ?? '#9ca3af';
    const isExpanded = this.expanded === c.id;
    const latStr = c.centroidLat.toFixed(2);
    const lonStr = c.centroidLon.toFixed(2);
    return `<div class="geo-card" data-cluster-id="${escapeHtml(c.id)}" style="border-left:3px solid ${sevColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;display:flex;flex-direction:column;gap:4px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#ddd;">${escapeHtml(latStr)}°, ${escapeHtml(lonStr)}°</span>
        <span style="font-size:10px;color:${sevColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(c.dominantSeverity)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;opacity:0.75;">
        <span style="background:rgba(74,158,255,0.15);color:#9ec5ff;padding:1px 6px;border-radius:2px;font-family:ui-monospace,monospace;">${escapeHtml(c.domain)}</span>
        <span style="font-family:ui-monospace,monospace;">${c.pointCount} point${c.pointCount === 1 ? '' : 's'}</span>
      </div>
      ${isExpanded ? this.renderClusterDetail(c) : ''}
    </div>`;
  }

  private renderClusterDetail(c: GeoCluster): string {
    if (c.points.length === 0) return '';
    const rows = c.points.map((p) => {
      const sevColor = SEVERITY_COLOR[p.severity] ?? '#9ca3af';
      return `<div style="display:flex;justify-content:space-between;gap:4px;font-size:10px;padding:2px 0;">
        <span style="font-family:ui-monospace,monospace;opacity:0.7;">${escapeHtml(p.id)}</span>
        <span style="font-family:ui-monospace,monospace;color:${sevColor};">${escapeHtml(p.domain)} · ${escapeHtml(p.severity)}</span>
      </div>`;
    }).join('');
    return `<div style="margin-top:3px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:1px;">${rows}</div>`;
  }

  private renderNearbyForm(): string {
    return `<form class="geo-nearby-form" style="display:flex;gap:4px;align-items:center;padding:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:3px;font-size:10px;">
      <input class="geo-nearby-lat" type="number" step="0.01" placeholder="Lat" style="width:60px;padding:3px 5px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:2px;font-family:ui-monospace,monospace;font-size:10px;" />
      <input class="geo-nearby-lon" type="number" step="0.01" placeholder="Lon" style="width:60px;padding:3px 5px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:2px;font-family:ui-monospace,monospace;font-size:10px;" />
      <input class="geo-nearby-radius" type="number" min="1" placeholder="km" value="500" style="width:60px;padding:3px 5px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:2px;font-family:ui-monospace,monospace;font-size:10px;" />
      <button type="submit" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">Search</button>
    </form>`;
  }

  private renderNearbyResults(): string {
    if (this.nearbyMessage) {
      return `<div style="font-size:10px;opacity:0.7;text-align:center;padding:4px 0;">${escapeHtml(this.nearbyMessage)}</div>`;
    }
    if (this.nearbyResults === null) return '';
    if (this.nearbyResults.length === 0) {
      return `<div style="font-size:10px;opacity:0.55;text-align:center;padding:4px 0;">No clusters in that search.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:3px;">${this.nearbyResults.map((c) => this.renderClusterCard(c)).join('')}</div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    for (const card of root.querySelectorAll<HTMLElement>('.geo-card')) {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-cluster-id');
        if (!id) return;
        this.expanded = this.expanded === id ? null : id;
        this.render();
      });
    }

    const form = root.querySelector<HTMLFormElement>('.geo-nearby-form');
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const lat = Number(form.querySelector<HTMLInputElement>('.geo-nearby-lat')?.value ?? 'NaN');
      const lon = Number(form.querySelector<HTMLInputElement>('.geo-nearby-lon')?.value ?? 'NaN');
      const radius = Number(form.querySelector<HTMLInputElement>('.geo-nearby-radius')?.value ?? 'NaN');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius) || radius <= 0) {
        this.nearbyMessage = 'Enter valid lat, lon, and radius (km).';
        this.nearbyResults = null;
      } else {
        this.nearbyMessage = null;
        this.nearbyResults = getGeospatialClusteringService().getNearby(lat, lon, radius);
      }
      this.render();
    });
  }
}
