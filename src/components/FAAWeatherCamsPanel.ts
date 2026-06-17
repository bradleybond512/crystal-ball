/* eslint-disable sonarjs/no-async-constructor, sonarjs/cognitive-complexity */
import { Panel } from './Panel';
import { fetchFAACameras, scoreCamerasAgainstAlerts } from '@/services/faa-cameras';
import type { ScoredFAACamera } from '@/services/faa-cameras';
import { fetchNWSAlerts } from '@/services/nws-alerts';
import { fetchGDACSEvents } from '@/services/gdacs';
import { getApiBaseUrl } from '@/services/runtime';
import { flightRuleColor } from '@/services/webcams/flight-rule';
import type { MetarData } from '@/services/webcams/metar-types';

export class FAAWeatherCamsPanel extends Panel {
  private cameras: ScoredFAACamera[] = [];
  private alertOnly = false;
  private selectedCam: ScoredFAACamera | null = null;
  private digestText: string | null = null;
  // Timelapse / "video" playback state — frames pulled lazily when
  // user clicks Play loop on the selected camera. Frames are
  // ordered oldest → newest so we can step forward through them.
  private loopFrames: { imageUrl: string; imageDatetime?: string }[] = [];
  private loopIndex = 0;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private loopCameraId: string | null = null;

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
 if (cam.flightRule) {
 const fr = document.createElement('span');
 fr.className = 'faa-flight-rule-badge';
 fr.textContent = cam.flightRule;
 fr.style.background = flightRuleColor(cam.flightRule);
 fr.style.color = '#fff';
 fr.style.padding = '1px 6px';
 fr.style.borderRadius = '3px';
 fr.style.fontSize = '11px';
 fr.style.marginLeft = '6px';
 tdName.append(fr);
 }
 const metarLine = this._formatMetarLine(cam.currentMetar);
 if (metarLine) {
 const sub = document.createElement('div');
 sub.className = 'faa-metar-line';
 sub.style.fontSize = '11px';
 sub.style.opacity = '0.7';
 sub.textContent = metarLine;
 tdName.append(sub);
 }
 if (typeof cam.adsbCount === 'number' && cam.adsbCount > 0) {
 const chip = document.createElement('span');
 chip.className = 'faa-adsb-chip';
 chip.textContent = `✈ ${cam.adsbCount}`;
 chip.style.marginLeft = '6px';
 chip.style.fontSize = '11px';
 chip.style.opacity = '0.75';
 tdName.append(chip);
 }

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
 const newSelection = this.selectedCam?.id === cam.id ? null : cam;
 // Pause any running loop when the user changes selection /
 // closes the viewer. Reset frames so a fresh selection starts
 // from a clean state.
 const newSelectionId = newSelection ? newSelection.id : null;
 if (newSelectionId !== this.loopCameraId) {
 this._pauseLoop();
 this.loopCameraId = null;
 this.loopFrames = [];
 this.loopIndex = 0;
 }
 this.selectedCam = newSelection;
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
 // When the loop is playing for this camera, src is the current
 // frame; otherwise it's the latest single image with a cache
 // buster so reopening the panel shows fresh data.
 if (this.loopCameraId === cam.id && this.loopFrames.length > 0) {
 const frame = this.loopFrames[this.loopIndex];
 if (frame) img.src = frame.imageUrl;
 } else {
 const epoch = new Date(cam.lastUpdated).getTime();
 img.src = `${cam.imageUrl}${cam.imageUrl.includes('?') ? '&' : '?'}t=${epoch}`;
 }
 img.alt = cam.name;
 img.loading = 'lazy';

 // Frame indicator (shown only while a loop is playing).
 const frameLabel = document.createElement('div');
 frameLabel.className = 'faa-cam-frame-label';
 if (this.loopCameraId === cam.id && this.loopFrames.length > 0) {
 const total = this.loopFrames.length;
 const frame = this.loopFrames[this.loopIndex];
 const ts = frame?.imageDatetime ? new Date(frame.imageDatetime).toLocaleTimeString() : '';
 frameLabel.textContent = `Frame ${this.loopIndex + 1} / ${total}${ts ? ' · ' + ts : ''}`;
 }

 // Controls row: Play loop / Pause + Analyze conditions.
 const controls = document.createElement('div');
 controls.className = 'faa-cam-controls';

 const loopBtn = document.createElement('button');
 loopBtn.className = 'faa-loop-btn';
 const isPlayingThisCam = this.loopCameraId === cam.id && this.loopTimer !== null;
 const hasPausedLoopForThisCam = this.loopCameraId === cam.id && this.loopFrames.length > 0;
 if (isPlayingThisCam) {
 loopBtn.textContent = '⏸ Pause loop';
 } else if (hasPausedLoopForThisCam) {
 loopBtn.textContent = '▶ Resume loop';
 } else {
 loopBtn.textContent = '▶ Play recent loop';
 }
 loopBtn.addEventListener('click', () => {
 if (isPlayingThisCam) this._pauseLoop();
 else void this._playLoop(cam);
 });

 const analyzeBtn = document.createElement('button');
 analyzeBtn.className = 'faa-analyze-btn';
 analyzeBtn.textContent = cam.aiConditions ?? 'Analyze conditions';
 analyzeBtn.disabled = !!cam.aiConditions;
 analyzeBtn.addEventListener('click', () => { void this._analyzeCamera(cam, analyzeBtn); });

 controls.append(loopBtn);
 controls.append(analyzeBtn);

 div.append(header);
 div.append(img);
 if (frameLabel.textContent) div.append(frameLabel);
 div.append(controls);
 return div;
  }

  /** Fetch the last 12 frames for the camera and start a 1-second
   *  cycle through them. Reuses already-loaded frames if the user
   *  clicks Play / Pause / Play. */
  private async _playLoop(cam: ScoredFAACamera): Promise<void> {
 // Different camera → reset state.
 if (this.loopCameraId !== cam.id) {
 this._pauseLoop();
 this.loopFrames = [];
 this.loopIndex = 0;
 this.loopCameraId = cam.id;
 }
 // Lazy-fetch frames the first time.
 if (this.loopFrames.length === 0) {
 try {
 // Strip leading `/api/` and the resolver pointer so we hit
 // the count=12 path against the canonical sidecar route.
 const url = `${getApiBaseUrl()}/api/faa-camera-image?cameraId=${encodeURIComponent(cam.id)}&count=12`;
 const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json() as {
 frames?: { imageUrl: string; imageDatetime?: string }[];
 imageUrl?: string;
 degraded?: boolean;
 reason?: string;
 };
 if (!data || typeof data !== 'object') return;
 if (data.degraded || !data.frames || data.frames.length === 0) {
 // Fall back to the single latest image — at least the user
 // sees something change rather than a silent no-op.
 if (data.imageUrl) {
 this.loopFrames = [{ imageUrl: data.imageUrl }];
 } else {
 return;
 }
 } else {
 this.loopFrames = data.frames;
 }
 } catch {
 return;
 }
 }
 this.loopIndex = 0;
 this.render();
 // 1-second cadence works well for FAA's typical 5-min image
 // interval — 12 frames cover roughly an hour.
 this.loopTimer = setInterval(() => {
 if (this.loopFrames.length === 0) return;
 this.loopIndex = (this.loopIndex + 1) % this.loopFrames.length;
 this.render();
 }, 1000);
  }

  private _pauseLoop(): void {
 if (this.loopTimer !== null) {
 clearInterval(this.loopTimer);
 this.loopTimer = null;
 }
  }

  public destroy(): void {
    super.destroy();
    this._pauseLoop();
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
 if (!data || typeof data !== 'object') {
 btn.textContent = 'Analysis failed — tap to retry';
 btn.disabled = false;
 setTimeout(() => {
 if (!btn.disabled) btn.textContent = 'Analyze conditions';
 }, 3000);
 return;
 }
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
 if (!data || typeof data !== 'object' || !data.imageUrl) return;
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

  private _formatMetarLine(metar: MetarData | null | undefined): string {
 if (!metar) return '';
 const parts: string[] = [];
 if (metar.windSpeedKt !== null && metar.windDirDeg !== null) {
 const dir = String(Math.round(metar.windDirDeg)).padStart(3, '0');
 const spd = Math.round(metar.windSpeedKt);
 const gust = metar.windGustKt === null ? '' : `G${Math.round(metar.windGustKt)}`;
 parts.push(`${dir}°/${spd}${gust}kt`);
 } else if (metar.windSpeedKt !== null) {
 parts.push(`${Math.round(metar.windSpeedKt)}kt`);
 }
 if (metar.visibilityMi !== null) parts.push(`${metar.visibilityMi}sm`);
 if (metar.weather) parts.push(metar.weather);
 if (metar.observedAtSec) {
 const ageMin = Math.floor((Date.now() / 1000 - metar.observedAtSec) / 60);
 if (ageMin >= 0 && ageMin < 360) parts.push(`${ageMin}m old`);
 }
 return parts.join(' · ');
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
