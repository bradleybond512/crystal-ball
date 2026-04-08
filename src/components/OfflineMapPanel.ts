/**
 * Offline Maps Panel
 *
 * Lets users pre-cache CartoDB dark basemap tiles around saved places
 * (or manual coordinates) for grid-down / offline scenarios.
 */

import { Panel } from '@/components/Panel';
import { h } from '@/utils/dom-utils';
import { getSavedPlaces } from '@/services/saved-places';
import {
  downloadRegion,
  deleteRegion,
  getDownloadedRegions,
  getTotalCacheStats,
  estimateTileCount,
  estimateSizeMB,
  DEFAULT_ZOOM_LEVELS,
  MAX_RADIUS_KM,
  type DownloadProgress,
  type OfflineMapRegion,
} from '@/services/offline-map-cache';

export class OfflineMapPanel extends Panel {
  private _downloading = false;

  constructor() {
 super({
 id: 'offline-maps',
 title: 'Offline Maps',
 infoTooltip:
 'Pre-cache map tiles around your saved places so the basemap works offline. ' +
 'Uses the CartoDB dark basemap and the browser Cache API.',
 });
 this._render();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private _render(): void {
 const regions = getDownloadedRegions();
 const stats = getTotalCacheStats();

 const container = h('div', { className: 'offline-maps-container' });

 // ---- Storage summary ----
 const summary = h('div', { className: 'offline-maps-summary' });
 summary.innerHTML = `
 <div style="display:flex;justify-content:space-between;padding:6px 0;opacity:0.7;font-size:12px">
 <span>Cached tiles: <strong>${stats.totalTiles.toLocaleString()}</strong></span>
 <span>Total size: <strong>${stats.totalSizeMB} MB</strong></span>
 </div>
 `;
 container.append(summary);

 // ---- Saved regions list ----
 if (regions.length > 0) {
 const listHeader = h('div', { style: 'font-weight:600;margin:10px 0 6px;font-size:13px' });
 listHeader.textContent = 'Saved Regions';
 container.append(listHeader);

 for (const region of regions) {
 container.append(this._renderRegionRow(region));
 }
 } else {
 const empty = h('div', { style: 'opacity:0.5;font-size:12px;padding:8px 0' });
 empty.textContent = 'No offline map regions cached yet.';
 container.append(empty);
 }

 // ---- Download around saved places ----
 const savedPlaces = getSavedPlaces();
 if (savedPlaces.length > 0) {
 const bulkSection = h('div', { style: 'margin-top:14px' });
 const bulkBtn = h('button', {
 className: 'offline-maps-btn',
 style: 'width:100%;padding:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:inherit;border-radius:4px;font-size:12px',
 });
 bulkBtn.textContent = `Download around ${savedPlaces.length} saved place${savedPlaces.length > 1 ? 's' : ''} (25 km)`;
 bulkBtn.addEventListener('click', () => {
 if (this._downloading) return;
 void this._downloadAroundSavedPlaces(bulkBtn);
 });
 bulkSection.append(bulkBtn);
 container.append(bulkSection);
 }

 // ---- Manual download form ----
 container.append(this._renderManualForm());

 this.content.innerHTML = '';
 this.content.append(container);
  }

  // -------------------------------------------------------------------------
  // Region row
  // -------------------------------------------------------------------------

  private _renderRegionRow(region: OfflineMapRegion): HTMLElement {
 const row = h('div', {
 style:
 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px',
 });

 const info = h('div');
 const dateStr = new Date(region.cachedAt).toLocaleDateString();
 info.innerHTML = `
 <div style="font-weight:500">${this._esc(region.label)}</div>
 <div style="opacity:0.5;font-size:11px">
 ${region.tileCount.toLocaleString()} tiles &middot; ${region.sizeMB} MB &middot; ${dateStr}
 </div>
 `;

 const delBtn = h('button', {
 style:
 'background:none;border:1px solid rgba(255,80,80,0.4);color:#ff5050;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px',
 });
 delBtn.textContent = 'Delete';
 delBtn.addEventListener('click', () => {
 void deleteRegion(region.id).then(() => this._render());
 });

 row.append(info, delBtn);
 return row;
  }

  // -------------------------------------------------------------------------
  // Manual download form
  // -------------------------------------------------------------------------

  private _renderManualForm(): HTMLElement {
 const section = h('div', { style: 'margin-top:14px' });

 const header = h('div', { style: 'font-weight:600;margin-bottom:8px;font-size:13px' });
 header.textContent = 'Download New Region';
 section.append(header);

 const labelStyle =
 'display:block;font-size:11px;opacity:0.6;margin-bottom:2px;margin-top:8px';
 const inputStyle =
 'width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:inherit;border-radius:3px;font-size:12px';

 // Lat
 const latLabel = h('label', { style: labelStyle });
 latLabel.textContent = 'Latitude';
 const latInput = h('input', { style: inputStyle }) as HTMLInputElement;
 latInput.type = 'number';
 latInput.step = 'any';
 latInput.placeholder = '37.7749';
 latInput.value = '';

 // Lon
 const lonLabel = h('label', { style: labelStyle });
 lonLabel.textContent = 'Longitude';
 const lonInput = h('input', { style: inputStyle }) as HTMLInputElement;
 lonInput.type = 'number';
 lonInput.step = 'any';
 lonInput.placeholder = '-122.4194';
 lonInput.value = '';

 // Radius slider
 const radiusLabel = h('label', { style: labelStyle });
 radiusLabel.textContent = 'Radius: 25 km';
 const radiusSlider = h('input', {
 style: 'width:100%;margin-top:2px',
 }) as HTMLInputElement;
 radiusSlider.type = 'range';
 radiusSlider.min = '10';
 radiusSlider.max = String(MAX_RADIUS_KM);
 radiusSlider.value = '25';
 radiusSlider.addEventListener('input', () => {
 radiusLabel.textContent = `Radius: ${radiusSlider.value} km`;
 updateEstimate();
 });

 // Zoom checkboxes
 const zoomLabel = h('div', { style: labelStyle });
 zoomLabel.textContent = 'Zoom levels';
 const zoomContainer = h('div', {
 style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px',
 });
 const zoomCheckboxes: HTMLInputElement[] = [];

 for (const z of [2, 4, 6, 8, 10, 12, 14]) {
 const wrap = h('label', { style: 'font-size:11px;display:flex;align-items:center;gap:2px' });
 const cb = document.createElement('input');
 cb.type = 'checkbox';
 cb.checked = DEFAULT_ZOOM_LEVELS.includes(z);
 cb.dataset.zoom = String(z);
 cb.addEventListener('change', () => updateEstimate());
 zoomCheckboxes.push(cb);
 const span = document.createElement('span');
 span.textContent = `z${z}`;
 wrap.append(cb, span);
 zoomContainer.append(wrap);
 }

 // Estimate display
 const estimateEl = h('div', {
 style: 'font-size:11px;opacity:0.6;margin-top:8px',
 });

 const updateEstimate = () => {
 const zoomLevels = zoomCheckboxes
 .filter((cb) => cb.checked)
 .map((cb) => Number(cb.dataset.zoom));
 const radius = Number(radiusSlider.value) || 25;
 const count = estimateTileCount(radius, zoomLevels);
 const size = estimateSizeMB(count);
 estimateEl.textContent = `Estimated: ${count.toLocaleString()} tiles (~${size} MB)`;
 };
 updateEstimate();

 // Progress bar
 const progressWrap = h('div', {
 style: 'display:none;margin-top:8px',
 });
 const progressBar = h('div', {
 style:
 'height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden',
 });
 const progressFill = h('div', {
 style: 'height:100%;width:0%;background:#4488ff;transition:width 0.2s',
 });
 progressBar.append(progressFill);
 const progressText = h('div', { style: 'font-size:11px;opacity:0.6;margin-top:4px' });
 progressWrap.append(progressBar, progressText);

 // Download button
 const dlBtn = h('button', {
 style:
 'width:100%;margin-top:10px;padding:8px;cursor:pointer;border:1px solid rgba(68,136,255,0.4);background:rgba(68,136,255,0.12);color:inherit;border-radius:4px;font-size:12px',
 });
 dlBtn.textContent = 'Download Region';
 dlBtn.addEventListener('click', () => {
 if (this._downloading) return;
 const lat = Number(latInput.value);
 const lon = Number(lonInput.value);
 if (Number.isNaN(lat) || Number.isNaN(lon) || lat === 0 && lon === 0 && !latInput.value) {
 estimateEl.textContent = 'Enter valid latitude and longitude.';
 return;
 }
 const radius = Number(radiusSlider.value) || 25;
 const zoomLevels = zoomCheckboxes
 .filter((cb) => cb.checked)
 .map((cb) => Number(cb.dataset.zoom));
 if (zoomLevels.length === 0) {
 estimateEl.textContent = 'Select at least one zoom level.';
 return;
 }

 this._downloading = true;
 dlBtn.textContent = 'Downloading...';
 dlBtn.setAttribute('disabled', 'true');
 progressWrap.style.display = 'block';

 void downloadRegion(lat, lon, radius, zoomLevels, `Manual (${lat.toFixed(2)}, ${lon.toFixed(2)})`, (p: DownloadProgress) => {
 const pct = p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : 0;
 progressFill.style.width = `${pct}%`;
 progressText.textContent = `${p.downloaded}/${p.total} tiles — ${p.sizeMB} MB`;
 }).then(() => {
 this._downloading = false;
 this._render();
 }).catch(() => {
 this._downloading = false;
 dlBtn.textContent = 'Download Region';
 dlBtn.removeAttribute('disabled');
 progressWrap.style.display = 'none';
 estimateEl.textContent = 'Download failed. Please try again.';
 });
 });

 section.append(
 latLabel, latInput,
 lonLabel, lonInput,
 radiusLabel, radiusSlider,
 zoomLabel, zoomContainer,
 estimateEl,
 progressWrap,
 dlBtn,
 );
 return section;
  }

  // -------------------------------------------------------------------------
  // Bulk download around saved places
  // -------------------------------------------------------------------------

  private async _downloadAroundSavedPlaces(btn: HTMLElement): Promise<void> {
 const places = getSavedPlaces();
 if (places.length === 0) return;

 this._downloading = true;
 const originalText = btn.textContent;
 btn.setAttribute('disabled', 'true');

 for (let i = 0; i < places.length; i++) {
 const place = places[i]!;
 btn.textContent = `Downloading ${i + 1}/${places.length}: ${place.name}...`;
 await downloadRegion(
 place.lat,
 place.lon,
 25,
 DEFAULT_ZOOM_LEVELS,
 place.name,
 );
 }

 this._downloading = false;
 btn.textContent = originalText;
 btn.removeAttribute('disabled');
 this._render();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _esc(str: string): string {
 const el = document.createElement('span');
 el.textContent = str;
 return el.innerHTML;
  }
}
