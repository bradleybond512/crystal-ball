/* eslint-disable sonarjs/no-async-constructor, sonarjs/cognitive-complexity */
import { Panel } from './Panel';
import { fetchFAACameras, scoreCamerasAgainstAlerts } from '@/services/faa-cameras';
import type { ScoredFAACamera } from '@/services/faa-cameras';
import { fetchNWSAlerts } from '@/services/nws-alerts';
import { fetchGDACSEvents } from '@/services/gdacs';
import { getApiBaseUrl } from '@/services/runtime';

export class FAAWeatherCamsPanel extends Panel {
  private cameras: ScoredFAACamera[] = [];
  private alertOnly = false;
  private selectedCam: ScoredFAACamera | null = null;
  private digestText: string | null = null;

  constructor() {
 super({ id: 'faa-weather-cams', title: 'FAA Weather Cams', className: 'panel-wide' });
 void this.load();
  }

  private async load(): Promise<void> {
 const [raw, nws, gdacs] = await Promise.all([
 fetchFAACameras(),
 fetchNWSAlerts(),
 fetchGDACSEvents(),
 ]);
 this.cameras = scoreCamerasAgainstAlerts(raw, nws, gdacs);
 this.render();
  }

  public refresh(): void {
 void this.load();
  }

  private get displayed(): ScoredFAACamera[] {
 return this.alertOnly
 ? this.cameras.filter(c => c.alertProximityMi !== null)
 : this.cameras;
  }

  private render(): void {
 const el = this.getContentElement();
 while (el.firstChild) el.firstChild.remove();
 el.className = 'panel-content faa-cams-content';

 const alertCams = this.cameras.filter(c => c.alertProximityMi !== null);
 if (alertCams.length >= 2 && this.digestText) {
 const banner = document.createElement('div');
 banner.className = 'faa-digest-banner';
 banner.textContent = this.digestText;
 el.append(banner);
 }

 // Toolbar
 const toolbar = document.createElement('div');
 toolbar.className = 'faa-cams-toolbar';
 const label = document.createElement('label');
 label.className = 'faa-toggle-label';
 const cb = document.createElement('input');
 cb.type = 'checkbox';
 cb.checked = this.alertOnly;
 cb.addEventListener('change', () => { this.alertOnly = cb.checked; this.render(); });
 label.append(cb);
 label.append(document.createTextNode(' Alert-proximate only'));
 const countEl = document.createElement('span');
 countEl.className = 'faa-cam-count';
 countEl.textContent = `${this.displayed.length} cameras`;
 toolbar.append(label);
 toolbar.append(countEl);
 el.append(toolbar);

 if (this.selectedCam) el.append(this._buildViewer(this.selectedCam));

 // Table
 const table = document.createElement('table');
 table.className = 'faa-cams-table eq-table';

 const thead = document.createElement('thead');
 const headerRow = document.createElement('tr');
 for (const col of ['Camera', 'Location', 'Alert', 'Score', 'Updated']) {
 const th = document.createElement('th');
 th.textContent = col;
 headerRow.append(th);
 }
 thead.append(headerRow);
 table.append(thead);

 const tbody = document.createElement('tbody');
 for (const cam of this.displayed) {
 const tr = document.createElement('tr');
 tr.className = `eq-row${cam.alertProximityMi === null ? '' : ' eq-moderate'}`;
 if (this.selectedCam?.id === cam.id) tr.classList.add('faa-cam-selected');

 const tdName = document.createElement('td');
 tdName.textContent = cam.name;

 const tdLoc = document.createElement('td');
 tdLoc.textContent = cam.category === 'weather'
 ? cam.state
 : `${cam.state} · ${cam.category}`;

 const tdAlert = document.createElement('td');
 if (cam.alertLabel) {
 const badge = document.createElement('span');
 badge.className = 'faa-alert-badge';
 badge.textContent = cam.alertLabel;
 tdAlert.append(badge);
 } else {
 tdAlert.textContent = '—';
 }

 const tdScore = document.createElement('td');
 tdScore.textContent = String(cam.relevanceScore);

 const tdTime = document.createElement('td');
 tdTime.textContent = this._relativeTime(cam.lastUpdated);

 for (const td of [tdName, tdLoc, tdAlert, tdScore, tdTime]) tr.append(td);

 tr.addEventListener('click', () => {
 this.selectedCam = this.selectedCam?.id === cam.id ? null : cam;
 // The sidecar returns imageUrl='/api/faa-camera-image?...' as a
 // resolver pointer, not a direct CDN URL. Lazy-resolve here so
 // each click only spends one upstream call (the 927-camera
 // catalog has 4–8 images per site; pre-fetching them all is
 // wasteful + timeouts the catalog response).
 if (this.selectedCam?.imageUrl.startsWith('/api/faa-camera-image')) {
 void this._resolveImageUrl(this.selectedCam);
 }
 this.render();
 });
 tbody.append(tr);
 }
 table.append(tbody);
 el.append(table);

 if (this.displayed.length === 0) {
 const empty = document.createElement('p');
 empty.className = 'faa-empty';
 empty.textContent = this.alertOnly
 ? 'No cameras near active alerts.'
 : 'No camera data available.';
 el.append(empty);
 }
  }

  private _buildViewer(cam: ScoredFAACamera): HTMLElement {
 const div = document.createElement('div');
 div.className = 'faa-cam-viewer';

 const header = document.createElement('div');
 header.className = 'faa-cam-viewer-header';
 const nameEl = document.createElement('strong');
 nameEl.textContent = cam.name;
 header.append(nameEl);
 if (cam.alertLabel) {
 const badge = document.createElement('span');
 badge.className = 'faa-alert-badge';
 badge.textContent = cam.alertLabel;
 header.append(badge);
 }
 const updatedEl = document.createElement('span');
 updatedEl.className = 'faa-cam-updated';
 updatedEl.textContent = this._relativeTime(cam.lastUpdated);
 header.append(updatedEl);

 const img = document.createElement('img');
 img.className = 'faa-cam-image';
 const epoch = new Date(cam.lastUpdated).getTime();
 img.src = `${cam.imageUrl}${cam.imageUrl.includes('?') ? '&' : '?'}t=${epoch}`;
 img.alt = cam.name;
 img.loading = 'lazy';

 const analyzeBtn = document.createElement('button');
 analyzeBtn.className = 'faa-analyze-btn';
 analyzeBtn.textContent = cam.aiConditions ?? 'Analyze conditions';
 analyzeBtn.disabled = !!cam.aiConditions;
 analyzeBtn.addEventListener('click', () => { void this._analyzeCamera(cam, analyzeBtn); });

 div.append(header);
 div.append(img);
 div.append(analyzeBtn);
 return div;
  }

  private async _analyzeCamera(cam: ScoredFAACamera, btn: HTMLButtonElement): Promise<void> {
 btn.textContent = 'Analyzing…';
 btn.disabled = true;
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/faa-cam-analyze`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 imageUrl: cam.imageUrl,
 cameraName: cam.name,
 alertLabel: cam.alertLabel,
 }),
 signal: AbortSignal.timeout(30_000),
 });
 const data = await res.json() as { conditions?: string; error?: string };
 if (data.conditions) {
 const idx = this.cameras.findIndex(c => c.id === cam.id);
 if (idx !== -1) {
 this.cameras[idx]!.aiConditions = data.conditions;
 if (this.selectedCam?.id === cam.id) this.selectedCam = this.cameras[idx] ?? null;
 }
 this.render();
 } else {
 btn.textContent = data.error ?? 'Analysis failed — tap to retry';
 btn.disabled = false;
 setTimeout(() => {
 if (!btn.disabled) btn.textContent = 'Analyze conditions';
 }, 3000);
 }
 } catch {
 btn.textContent = 'Analysis unavailable';
 btn.disabled = false;
 return;
 }
  }

  /**
   * Replace the panel's `/api/faa-camera-image?cameraId=X` resolver
   * pointer with the actual CDN URL the FAA weathercams API returns.
   * Idempotent — second call short-circuits when the URL already
   * looks like a real CDN URL.
   */
  private async _resolveImageUrl(cam: ScoredFAACamera): Promise<void> {
 if (!cam.imageUrl.startsWith('/api/faa-camera-image')) return;
 try {
 const res = await fetch(`${getApiBaseUrl()}${cam.imageUrl}`, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) return;
 const data = await res.json() as { imageUrl?: string | null; imageDatetime?: string };
 if (!data.imageUrl) return;
 const idx = this.cameras.findIndex(c => c.id === cam.id);
 if (idx === -1) return;
 this.cameras[idx]!.imageUrl = data.imageUrl;
 if (data.imageDatetime) this.cameras[idx]!.lastUpdated = data.imageDatetime;
 if (this.selectedCam?.id === cam.id) this.selectedCam = this.cameras[idx] ?? null;
 this.render();
 } catch {
 // Silent failure leaves the resolver pointer in place; the
 // viewer's <img> will 404 and the analyze button stays
 // disabled, but the panel itself stays usable.
 }
  }

  private _relativeTime(iso: string): string {
 const diff = Date.now() - new Date(iso).getTime();
 const min = Math.floor(diff / 60_000);
 if (min < 1) return 'just now';
 if (min < 60) return `${min}m ago`;
 return `${Math.floor(min / 60)}h ago`;
  }

  public setDisasterMode(active: boolean, disasterCameras?: ScoredFAACamera[]): void {
 // Disaster-mode flips the alert-only filter on/off. It does NOT
 // overwrite this.cameras with just the disaster subset — that
 // used to leave the panel showing nothing when no severe weather
 // / GDACS events were active. The panel always loads the full
 // camera list and uses `alertOnly` to filter at render time.
 if (active && disasterCameras && disasterCameras.length > 0) {
 // Merge: keep the existing full list + ensure the disaster
 // subset is included with up-to-date alert proximity scores.
 const byId = new Map(this.cameras.map((c) => [c.id, c]));
 for (const cam of disasterCameras) byId.set(cam.id, cam);
 this.cameras = [...byId.values()];
 this.alertOnly = true;
 } else {
 // Either disaster mode is off, or active without any proximate
 // cameras — show the full list. Lazy-load if we don't have it yet.
 this.alertOnly = false;
 if (this.cameras.length === 0) void this.load();
 }
 this.render();
  }

  public setDigest(text: string): void {
 this.digestText = text;
 this.render();
  }
}
