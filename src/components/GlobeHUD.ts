/* eslint-disable sonarjs/no-nested-conditional */
import { loadGodsVisionLayers, saveGodsVisionLayers, type GodsVisionLayers } from '@/config/gods-vision-layers';
import { getFusedForecast } from '@/services/forecast-fusion';
import type { FollowTarget } from '@/components/gods-vision/AutoFollowEngine';
import type { FlyModeStatus } from '@/components/gods-vision/FlyMode/FlyModeController';
import { FLY_SUB_MODE_NAMES } from '@/components/gods-vision/FlyMode/flyModeKeybinds';

export interface HUDState {
  cameraAltitude: number;
  cameraLat: number;
  cameraLon: number;
  satelliteCount: number;
  activeHotspots: number;
  threatLevel: string;
  topAlerts?: { name: string; type: string; severity: number; lat?: number; lon?: number }[];
  conflicts?: number;
  disasters?: number;
  nearestHotspot?: { name: string; distanceKm: number } | null;
  tickerItems?: string[];
  fourDActive?: boolean;
  fourDPlaybackMode?: 'documentary' | 'director' | 'heartbeat';
}

function fourDBadgeLabel(mode: 'documentary' | 'director' | 'heartbeat' | undefined): string {
  if (mode === 'director') return '4D · DIRECTOR';
  if (mode === 'heartbeat') return '4D · HEARTBEAT';
  return '4D';
}

function sunAltitudeDeg(lat: number, lon: number, date: Date): number {
  // Low-precision NOAA solar position — good enough for a phase badge.
  const rad = Math.PI / 180;
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const decl = 23.44 * rad * Math.sin(((360 / 365) * (dayOfYear - 81)) * rad);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarHour = utcHours + lon / 15;
  const hourAngle = (solarHour - 12) * 15 * rad;
  const latR = lat * rad;
  const sinAlt = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad;
}

function sunPhaseLabel(altDeg: number): { label: string; cls: string } {
  if (altDeg > 6) return { label: 'DAY', cls: 'ge-sun-day' };
  if (altDeg > -0.833) return { label: 'GOLDEN', cls: 'ge-sun-golden' };
  if (altDeg > -6)  return { label: 'CIVIL', cls: 'ge-sun-twilight' };
  if (altDeg > -12) return { label: 'NAUTICAL', cls: 'ge-sun-twilight' };
  if (altDeg > -18) return { label: 'ASTRO', cls: 'ge-sun-twilight' };
  return { label: 'NIGHT', cls: 'ge-sun-night' };
}

function threatFromHotspots(count: number): { label: string; cls: string } {
  if (count > 500) return { label: 'CRITICAL', cls: 'ge-threat-critical' };
  if (count > 200) return { label: 'ELEVATED', cls: 'ge-threat-elevated' };
  if (count > 50)  return { label: 'GUARDED', cls: 'ge-threat-guarded' };
  return { label: 'NOMINAL', cls: 'ge-threat-nominal' };
}

function formatCoord(deg: number, pos: string, neg: string): string {
  const dir = deg >= 0 ? pos : neg;
  return `${Math.abs(deg).toFixed(2)}\u00B0${dir}`;
}

const THEATER_HINTS = [
  ['1', 'Middle East'],
  ['2', 'Pacific'],
  ['3', 'Europe'],
  ['4', 'Arctic'],
  ['5', 'Africa'],
  ['6', 'Americas'],
  ['ESC', 'Exit'],
] as const;

export class GlobeHUD {
  private element: HTMLElement;
  private layers: GodsVisionLayers;
  private onLayerToggle: ((layerKey: string, enabled: boolean) => void) | null = null;
  private onExit: (() => void) | null = null;
  private onAutoFollowSkip: (() => void) | null = null;
  private onClusterToggle: ((enabled: boolean) => void) | null = null;
  private onTerminatorToggle: ((enabled: boolean) => void) | null = null;
  private onBuildingsToggle: ((enabled: boolean) => void) | null = null;
  private onArcsToggle: ((enabled: boolean) => void) | null = null;
  private onHeatmapToggle: ((enabled: boolean) => void) | null = null;
  private onSatellitesToggle: ((enabled: boolean) => void) | null = null;
  private onAudioToggle: ((enabled: boolean) => void) | null = null;
  private onSeismicWavesToggle: ((enabled: boolean) => void) | null = null;
  private onAlertClick: ((lat: number, lon: number, name: string) => void) | null = null;
  private onScreenshot: (() => void) | null = null;
  private onNavigationToggle: (() => void) | null = null;
  private terminatorBtn: HTMLButtonElement | null = null;
  private buildingsBtn: HTMLButtonElement | null = null;
  private arcsBtn: HTMLButtonElement | null = null;
  private heatmapBtn: HTMLButtonElement | null = null;
  private satBtn: HTMLButtonElement | null = null;
  private audioBtn: HTMLButtonElement | null = null;
  private seismicWavesBtn: HTMLButtonElement | null = null;
  private terminatorEnabled = false;
  private buildingsEnabled = false;
  private arcsEnabled = false;
  private heatmapEnabled = false;
  private satellitesEnabled = false;
  private audioEnabled = false;
  private seismicWavesEnabled = true;
  private clusteringEnabled = true;
  private clockId: number | null = null;
  private fourDBadgeEl: HTMLElement | null = null;

  // Cached DOM refs
  private threatEl: HTMLElement | null = null;
  private threatDetailEl: HTMLElement | null = null;
  private fusionEl: HTMLElement | null = null;
  private fusionTimer: number | null = null;
  private lastHotspotCount = 0;
  private lastTopAlerts: { name: string; type: string; severity: number }[] = [];
  private hotspotsEl: HTMLElement | null = null;
  private altEl: HTMLElement | null = null;
  private coordsEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private autoFollowCard: HTMLElement | null = null;
  private autoFollowTarget: HTMLElement | null = null;
  private autoFollowCounter: HTMLElement | null = null;
  private autoFollowSkipBtn: HTMLElement | null = null;
  private layerCountEls = new Map<string, HTMLElement>();
  private alertListEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private conflictsEl: HTMLElement | null = null;
  private disastersEl: HTMLElement | null = null;
  private nearestEl: HTMLElement | null = null;
  private localTimeEl: HTMLElement | null = null;
  private sunPhaseEl: HTMLElement | null = null;
  private tickerTrackEl: HTMLElement | null = null;
  private flyModeBarEl: HTMLElement | null = null;
  private flyModeSubEl: HTMLElement | null = null;
  private lastLat = 0;
  private lastLon = 0;
  private sparklineCanvas: HTMLCanvasElement | null = null;
  private sparklineBuffer: number[] = [];
  private readonly SPARKLINE_MAX = 30;

  constructor(container: HTMLElement) {
 this.layers = loadGodsVisionLayers();
 this.element = document.createElement('div');
 this.element.className = 'gods-vision-hud';
 this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;';
 container.append(this.element);
 this.buildDOM();
 this.startClock();
  }

  private buildDOM(): void {
 // ── Top-left: Threat card ──
 const topLeft = this.pos('top:16px;left:16px;pointer-events:auto;');
 const card = this.card('ge-hud-threat-card');
 this.clockEl = this.el('div', 'ge-hud-clock');
 card.append(this.clockEl);
 const threatLabel = this.el('div', 'ge-hud-micro-label', 'THREAT ASSESSMENT');
 card.append(threatLabel);
 this.fourDBadgeEl = document.createElement('div');
 this.fourDBadgeEl.className = 'ge-hud-4d-badge';
 this.fourDBadgeEl.textContent = '4D';
 this.fourDBadgeEl.style.display = 'none';
 card.append(this.fourDBadgeEl);
 this.threatEl = this.el('div', 'ge-hud-threat-value ge-threat-nominal', 'NOMINAL');
 card.append(this.threatEl);
 this.threatDetailEl = this.el('div', 'ge-hud-threat-detail', '');
 card.append(this.threatDetailEl);
 this.fusionEl = this.el('div', 'ge-hud-fusion', 'FUSION — / —');
 this.fusionEl.style.cssText = 'font:600 11px/1.3 -apple-system,system-ui;letter-spacing:0.06em;color:rgba(255,200,120,0.85);margin-top:4px;';
 card.append(this.fusionEl);
 const sparkCanvas = document.createElement('canvas');
 sparkCanvas.className = 'ge-hud-sparkline';
 sparkCanvas.width = 120;
 sparkCanvas.height = 24;
 card.append(sparkCanvas);
 this.sparklineCanvas = sparkCanvas;
 const statsRow = this.el('div', 'ge-hud-stats-row');
 this.hotspotsEl = this.statPill(statsRow, 'HOTSPOTS', '0');
 this.altEl = this.statPill(statsRow, 'ALT', '0 km');
 card.append(statsRow);
 const statsRow2 = this.el('div', 'ge-hud-stats-row');
 this.conflictsEl = this.statPill(statsRow2, 'CONFLICT', '—');
 this.disastersEl = this.statPill(statsRow2, 'DISASTER', '—');
 card.append(statsRow2);
 const coordRow = this.el('div', 'ge-hud-stats-row');
 this.coordsEl = this.el('span', 'ge-hud-coord', '0.00\u00B0N, 0.00\u00B0E');
 coordRow.append(this.coordsEl);
 card.append(coordRow);
 const ctxRow = this.el('div', 'ge-hud-stats-row');
 this.localTimeEl = this.el('span', 'ge-hud-ctx', '--:--');
 this.sunPhaseEl = this.el('span', 'ge-hud-sun ge-sun-day', 'DAY');
 ctxRow.append(this.localTimeEl, this.sunPhaseEl);
 card.append(ctxRow);
 this.nearestEl = this.el('div', 'ge-hud-nearest', 'Nearest: —');
 card.append(this.nearestEl);
 const alertSep = this.el('div', 'ge-hud-separator');
 card.append(alertSep);
 this.alertListEl = this.el('div', 'ge-hud-alert-list');
 card.append(this.alertListEl);
 topLeft.append(card);
 this.element.append(topLeft);

 // ── Top-center: Breaking news ticker ──
 const topCenter = this.pos('top:16px;left:50%;transform:translateX(-50%);pointer-events:auto;max-width:46%;');
 const ticker = this.el('div', 'ge-hud-ticker');
 const tickerLabel = this.el('span', 'ge-hud-ticker-label', 'LIVE');
 const tickerWin = this.el('div', 'ge-hud-ticker-window');
 this.tickerTrackEl = this.el('div', 'ge-hud-ticker-track', 'Awaiting feeds…');
 tickerWin.append(this.tickerTrackEl);
 ticker.append(tickerLabel, tickerWin);
 topCenter.append(ticker);
 this.element.append(topCenter);

 // ── Top-right: Exit + theater legend ──
 const topRight = this.pos('top:16px;right:16px;pointer-events:auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px;');
 const exitBtn = document.createElement('button');
 exitBtn.className = 'ge-exit-btn';
 exitBtn.id = 'geExitBtn';
 exitBtn.title = 'Exit God\'s Eye (ESC)';
 const exitIcon = this.el('span', 'ge-exit-icon', '\u2715');
 exitBtn.append(exitIcon, document.createTextNode(' EXIT'));
 exitBtn.addEventListener('click', () => this.onExit?.());
 topRight.append(exitBtn);

 // Theater preset hints
 const hints = this.card('ge-hud-hints');
 for (const [key, label] of THEATER_HINTS) {
 const row = document.createElement('div');
 row.className = 'ge-hint-row';
 const keyEl = this.el('span', 'ge-hint-key', key);
 row.append(keyEl, document.createTextNode(` ${label}`));
 hints.append(row);
 }
 topRight.append(hints);
 this.element.append(topRight);

 // ── Bottom-center: Layer toggle bar ──
 const bottomCenter = this.pos(
 'bottom:16px;left:16px;right:16px;pointer-events:auto;overflow-x:auto;',
 );
 const layerBar = document.createElement('div');
 layerBar.className = 'ge-layer-bar';
 layerBar.id = 'geLayerBar';
 this.buildClusterButton(layerBar);
 this.buildTerminatorButton(layerBar);
 this.buildBuildingsButton(layerBar);
 this.buildArcsButton(layerBar);
 this.buildHeatmapButton(layerBar);
 this.buildSatellitesButton(layerBar);
 this.buildSeismicWavesButton(layerBar);
 this.buildAudioButton(layerBar);
 this.buildScreenshotButton(layerBar);
 this.buildLayerButtons(layerBar);
 const navBtn = document.createElement('button');
 navBtn.textContent = 'NAV';
 navBtn.title = 'Toggle Navigation (N)';
 navBtn.style.cssText = `background: rgba(20,25,40,0.8); border: 1px solid rgba(100,140,255,0.3); color: #8ca8ff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px; font-family: 'SF Mono', monospace; font-weight: 600;`;
 navBtn.addEventListener('click', () => this.onNavigationToggle?.());
 layerBar.append(navBtn);
 bottomCenter.append(layerBar);
 this.element.append(bottomCenter);

 // ── Bottom-right: Auto-follow status ──
 const bottomRight = this.pos('bottom:80px;right:16px;pointer-events:auto;');
 this.autoFollowCard = this.card('ge-autofollow-card ge-hidden');
 const afHeader = this.el('div', 'ge-autofollow-header');
 const afLabel = this.el('span', 'ge-hud-micro-label', 'AUTO-FOLLOW');
 this.autoFollowCounter = this.el('span', 'ge-autofollow-counter', '0/0');
 afHeader.append(afLabel, this.autoFollowCounter);
 this.autoFollowCard.append(afHeader);
 this.autoFollowTarget = this.el('div', 'ge-autofollow-target', 'Scanning...');
 this.autoFollowCard.append(this.autoFollowTarget);
 this.autoFollowSkipBtn = document.createElement('button');
 this.autoFollowSkipBtn.className = 'ge-autofollow-skip';
 this.autoFollowSkipBtn.textContent = 'SKIP \u25B6';
 this.autoFollowSkipBtn.addEventListener('click', () => this.onAutoFollowSkip?.());
 this.autoFollowCard.append(this.autoFollowSkipBtn);
 bottomRight.append(this.autoFollowCard);
 this.element.append(bottomRight);

 // ── Overlays ──
 const scanlines = document.createElement('div');
 scanlines.className = 'ge-scanlines';
 this.element.append(scanlines);

 const vignette = document.createElement('div');
 vignette.className = 'ge-vignette';
 this.element.append(vignette);

 this.tooltipEl = document.createElement('div');
 this.tooltipEl.className = 'ge-tooltip ge-hidden';
 this.element.append(this.tooltipEl);

 // ── Fly Mode overlay bar (hidden until fly mode is active) ──
 const flyBar = this.pos('top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;');
 flyBar.className += ' ge-flymode-bar ge-hidden';
 this.flyModeBarEl = flyBar;
 const flyLabel = this.el('span', 'ge-flymode-label', 'FLY MODE');
 this.flyModeSubEl = this.el('span', 'ge-flymode-sub', 'FREE FLY');
 const flyHint = this.el('span', 'ge-flymode-hint', '[F] Exit  [1] Free  [2] Cinematic  [3] Chase  [4] City  [Shift] Boost  [Ctrl] Brake');
 flyBar.append(flyLabel, this.flyModeSubEl, flyHint);
 this.element.append(flyBar);
  }

  private pos(style: string): HTMLElement {
 const el = document.createElement('div');
 el.style.cssText = `position:absolute;${style}`;
 return el;
  }

  private card(cls: string): HTMLElement {
 const el = document.createElement('div');
 el.className = `ge-hud-card ${cls}`;
 return el;
  }

  private el(tag: string, cls: string, text?: string): HTMLElement {
 const el = document.createElement(tag);
 el.className = cls;
 if (text) el.textContent = text;
 return el;
  }

  private statPill(parent: HTMLElement, label: string, value: string): HTMLElement {
 const pill = this.el('div', 'ge-hud-stat-pill');
 const labelEl = this.el('span', 'ge-hud-stat-label', label);
 const valueEl = this.el('span', 'ge-hud-stat-value', value);
 pill.append(labelEl, valueEl);
 parent.append(pill);
 return valueEl;
  }

  private buildClusterButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.clusteringEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Auto-cluster dense event layers';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'CLUSTER';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.clusteringEnabled = !this.clusteringEnabled;
 btn.classList.toggle('ge-layer-active', this.clusteringEnabled);
 this.onClusterToggle?.(this.clusteringEnabled);
 });
 bar.append(btn);
  }

  private buildTerminatorButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.terminatorEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Toggle real-time day/night terminator (L)';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'TERMINATOR';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setTerminatorEnabled(!this.terminatorEnabled);
 this.onTerminatorToggle?.(this.terminatorEnabled);
 });
 this.terminatorBtn = btn;
 bar.append(btn);
  }

  setTerminatorEnabled(enabled: boolean): void {
 this.terminatorEnabled = enabled;
 this.terminatorBtn?.classList.toggle('ge-layer-active', enabled);
  }

  toggleTerminator(): boolean {
 this.setTerminatorEnabled(!this.terminatorEnabled);
 this.onTerminatorToggle?.(this.terminatorEnabled);
 return this.terminatorEnabled;
  }

  setOnBuildingsToggle(cb: (enabled: boolean) => void): void {
 this.onBuildingsToggle = cb;
  }

  setOnAlertClick(cb: (lat: number, lon: number, name: string) => void): void {
 this.onAlertClick = cb;
  }

  setOnScreenshot(cb: () => void): void {
 this.onScreenshot = cb;
  }

  setBuildingsEnabled(enabled: boolean): void {
 this.buildingsEnabled = enabled;
 this.buildingsBtn?.classList.toggle('ge-layer-active', enabled);
  }

  private buildBuildingsButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.buildingsEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Toggle 3D buildings (requires GOOGLE_MAPS_API_KEY or CESIUM_ION_TOKEN)';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = '3D BLDG';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setBuildingsEnabled(!this.buildingsEnabled);
 this.onBuildingsToggle?.(this.buildingsEnabled);
 });
 this.buildingsBtn = btn;
 bar.append(btn);
  }

  setOnArcsToggle(cb: (enabled: boolean) => void): void {
 this.onArcsToggle = cb;
  }

  setArcsEnabled(enabled: boolean): void {
 this.arcsEnabled = enabled;
 this.arcsBtn?.classList.toggle('ge-layer-active', enabled);
  }

  private buildArcsButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = 'ge-layer-btn';
 btn.title = 'Toggle arc lines connecting conflicts to nearby disasters';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'ARCS';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setArcsEnabled(!this.arcsEnabled);
 this.onArcsToggle?.(this.arcsEnabled);
 });
 this.arcsBtn = btn;
 bar.append(btn);
  }

  setOnHeatmapToggle(cb: (enabled: boolean) => void): void {
 this.onHeatmapToggle = cb;
  }

  setHeatmapEnabled(enabled: boolean): void {
 this.heatmapEnabled = enabled;
 this.heatmapBtn?.classList.toggle('ge-layer-active', enabled);
  }

  setOnSeismicWavesToggle(cb: (enabled: boolean) => void): void {
 this.onSeismicWavesToggle = cb;
  }

  setSeismicWavesEnabled(enabled: boolean): void {
 this.seismicWavesEnabled = enabled;
 this.seismicWavesBtn?.classList.toggle('ge-layer-active', enabled);
  }

  isSeismicWavesEnabled(): boolean {
 return this.seismicWavesEnabled;
  }

  private buildSeismicWavesButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.seismicWavesEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Toggle animated P/S-wave rings for fused seismic events (Layer 6)';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'P/S WAVES';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setSeismicWavesEnabled(!this.seismicWavesEnabled);
 this.onSeismicWavesToggle?.(this.seismicWavesEnabled);
 });
 this.seismicWavesBtn = btn;
 bar.append(btn);
  }

  private buildHeatmapButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = 'ge-layer-btn';
 btn.title = 'Toggle density heatmap overlay';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'HEAT';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setHeatmapEnabled(!this.heatmapEnabled);
 this.onHeatmapToggle?.(this.heatmapEnabled);
 });
 this.heatmapBtn = btn;
 bar.append(btn);
  }

  private buildSatellitesButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.satellitesEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Toggle ISS & station satellite positions';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'SAT';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setSatellitesEnabled(!this.satellitesEnabled);
 this.onSatellitesToggle?.(this.satellitesEnabled);
 });
 this.satBtn = btn;
 bar.append(btn);
  }

  setSatellitesEnabled(enabled: boolean): void {
 this.satellitesEnabled = enabled;
 this.satBtn?.classList.toggle('ge-layer-active', enabled);
  }

  setOnSatellitesToggle(cb: (enabled: boolean) => void): void {
 this.onSatellitesToggle = cb;
  }

  private buildAudioButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${this.audioEnabled ? ' ge-layer-active' : ''}`;
 btn.title = 'Toggle ambient audio (threat-reactive)';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'AUDIO';
 btn.append(nameSpan);
 btn.addEventListener('click', () => {
 this.setAudioEnabled(!this.audioEnabled);
 this.onAudioToggle?.(this.audioEnabled);
 });
 this.audioBtn = btn;
 bar.append(btn);
  }

  setAudioEnabled(enabled: boolean): void {
 this.audioEnabled = enabled;
 this.audioBtn?.classList.toggle('ge-layer-active', enabled);
  }

  setOnAudioToggle(cb: (enabled: boolean) => void): void {
 this.onAudioToggle = cb;
  }


  private buildLayerButtons(bar: HTMLElement): void {
 for (const [key, config] of Object.entries(this.layers)) {
 if (config.category === 'aesthetic') continue;
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${config.enabled ? ' ge-layer-active' : ''}`;
 btn.dataset.layer = key;
 btn.title = config.description;

 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = config.name;

 const countSpan = document.createElement('span');
 countSpan.className = 'ge-layer-count';
 this.layerCountEls.set(key, countSpan);

 btn.append(nameSpan, countSpan);
 btn.addEventListener('click', () => {
 const layer = this.layers[key];
 if (!layer) return;
 layer.enabled = !layer.enabled;
 btn.classList.toggle('ge-layer-active', layer.enabled);
 saveGodsVisionLayers(this.layers);
 this.onLayerToggle?.(key, layer.enabled);
 });
 bar.append(btn);
 }
  }

  private clockFmt = new Intl.DateTimeFormat(undefined, {
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit',
 hour12: false,
 timeZoneName: 'short',
  });

  private updateClock(): void {
 if (!this.clockEl) return;
 // Intl picks the OS-configured timezone — shows local time + abbrev (CST, PST, etc.)
 this.clockEl.textContent = this.clockFmt.format(new Date());
  }

  private startClock(): void {
 this.updateClock();
 this.updateCameraContext();
 this.clockId = window.setInterval(() => {
 this.updateClock();
 this.updateCameraContext();
 }, 1000);
 this.updateFusion();
 this.fusionTimer = window.setInterval(() => this.updateFusion(), 30_000);
  }

  private updateFusion(): void {
 if (!this.fusionEl) return;
 try {
 const f = getFusedForecast();
 const arrow = f.trend === 'up' ? '▲' : (f.trend === 'down' ? '▼' : '◆');
 this.fusionEl.textContent = `FUSION ${f.combined} ${arrow}  ${f.topDriver}`;
 } catch { /* noop */ }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  updateState(state: Partial<HUDState>): void {
 if (state.activeHotspots !== undefined) {
 this.lastHotspotCount = state.activeHotspots;
 if (this.hotspotsEl) this.hotspotsEl.textContent = String(state.activeHotspots);
 if (this.threatEl) {
 const { label, cls } = threatFromHotspots(state.activeHotspots);
 this.threatEl.textContent = label;
 this.threatEl.className = `ge-hud-threat-value ${cls}`;
 }
 this.updateThreatDetail();
 this.sparklineBuffer.push(state.activeHotspots);
 if (this.sparklineBuffer.length > this.SPARKLINE_MAX) {
 this.sparklineBuffer.shift();
 }
 this.drawSparkline();
 }
 if (state.cameraAltitude !== undefined && this.altEl) {
 const km = Math.round(state.cameraAltitude / 1000);
 this.altEl.textContent = km > 1000 ? `${(km / 1000).toFixed(1)}k km` : `${km} km`;
 }
 if (state.cameraLat !== undefined && state.cameraLon !== undefined && this.coordsEl) {
 this.lastLat = state.cameraLat;
 this.lastLon = state.cameraLon;
 this.coordsEl.textContent =
 `${formatCoord(state.cameraLat, 'N', 'S')}, ${formatCoord(state.cameraLon, 'E', 'W')}`;
 this.updateCameraContext();
 }
 if (state.topAlerts !== undefined) {
 this.lastTopAlerts = state.topAlerts;
 if (this.alertListEl) this.renderAlertList(this.alertListEl, state.topAlerts);
 this.updateThreatDetail();
 }
 if (state.conflicts !== undefined && this.conflictsEl) {
 this.conflictsEl.textContent = String(state.conflicts);
 }
 if (state.disasters !== undefined && this.disastersEl) {
 this.disastersEl.textContent = String(state.disasters);
 }
 if (state.nearestHotspot !== undefined && this.nearestEl) {
 const n = state.nearestHotspot;
 this.nearestEl.textContent = n
  
 ? `Nearest: ${n.name.length > 28 ? n.name.slice(0, 25) + '…' : n.name} · ${Math.round(n.distanceKm)} km`
 : 'Nearest: —';
 }
 if (state.tickerItems !== undefined && this.tickerTrackEl) {
 const items = state.tickerItems.length ? state.tickerItems : ['Awaiting feeds…'];
 this.tickerTrackEl.textContent = items.join(' • ') + ' • ' + items.join(' • ');
 }
 if (state.fourDActive !== undefined && this.fourDBadgeEl) {
 this.fourDBadgeEl.style.display = state.fourDActive ? 'inline-flex' : 'none';
 if (state.fourDActive) {
 this.fourDBadgeEl.textContent = fourDBadgeLabel(state.fourDPlaybackMode);
 }
 }
 if (state.fourDPlaybackMode !== undefined && this.fourDBadgeEl?.style.display !== 'none' && this.fourDBadgeEl) this.fourDBadgeEl.textContent = fourDBadgeLabel(state.fourDPlaybackMode);
  }

  private updateCameraContext(): void {
 const now = new Date();
 if (this.localTimeEl) {
 // Approximate local solar time at the camera point: UTC + lon/15 hours.
 const offsetMs = (this.lastLon / 15) * 3_600_000;
 const local = new Date(now.getTime() + offsetMs);
 const hh = String(local.getUTCHours()).padStart(2, '0');
 const mm = String(local.getUTCMinutes()).padStart(2, '0');
 this.localTimeEl.textContent = `LOCAL ${hh}:${mm}`;
 }
 if (this.sunPhaseEl) {
 const alt = sunAltitudeDeg(this.lastLat, this.lastLon, now);
 const { label, cls } = sunPhaseLabel(alt);
 this.sunPhaseEl.textContent = label;
 this.sunPhaseEl.className = `ge-hud-sun ${cls}`;
 }
  }

  private renderAlertList(
 el: HTMLElement,
 alerts: { name: string; type: string; severity: number; lat?: number; lon?: number }[],
  ): void {
 while (el.firstChild) el.firstChild.remove();
 if (alerts.length === 0) {
 el.textContent = 'No active alerts';
 return;
 }
 for (const alert of alerts) {
 const row = document.createElement('div');
 row.className = 'ge-alert-row';
 const hasPos = alert.lat !== undefined && alert.lon !== undefined;
 if (hasPos) {
 row.classList.add('ge-hud-alert-clickable');
 row.title = 'Click to fly to this event';
 row.addEventListener('click', () => {
 if (alert.lat !== undefined && alert.lon !== undefined) {
 this.onAlertClick?.(alert.lat, alert.lon, alert.name);
 }
 });
 }
 const dot = document.createElement('span');
 dot.className = this.alertDotClass(alert.severity);
 const text = document.createElement('span');
 text.className = 'ge-alert-text';
 text.textContent = alert.name.length > 48 ? alert.name.slice(0, 45) + '\u2026' : alert.name;
 text.title = `${alert.type}: ${alert.name}`;
 row.append(dot, text);
 el.append(row);
 }
  }

  private buildScreenshotButton(bar: HTMLElement): void {
 const btn = document.createElement('button');
 btn.className = 'ge-layer-btn';
 btn.title = 'Save screenshot to Downloads';
 const nameSpan = document.createElement('span');
 nameSpan.className = 'ge-layer-name';
 nameSpan.textContent = 'SNAP';
 btn.append(nameSpan);
 btn.addEventListener('click', () => this.onScreenshot?.());
 bar.append(btn);
  }

  private updateThreatDetail(): void {
 if (!this.threatDetailEl) return;
 const count = this.lastHotspotCount;
 const top = this.lastTopAlerts[0];
 const countStr = count > 0 ? `${count.toLocaleString()} events` : '';
 if (top) {
 const name = top.name.length > 30 ? top.name.slice(0, 27) + '…' : top.name;
 const type = top.type.replace(/_/g, ' ');
 this.threatDetailEl.textContent = countStr ? `${countStr} · ${name} (${type})` : `${name} (${type})`;
 } else {
 this.threatDetailEl.textContent = countStr;
 }
  }

  private drawSparkline(): void {
 const canvas = this.sparklineCanvas;
 if (!canvas || this.sparklineBuffer.length < 2) return;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 const w = canvas.width;
 const h = canvas.height;
 ctx.clearRect(0, 0, w, h);
 const max = Math.max(...this.sparklineBuffer, 1);
 const min = Math.min(...this.sparklineBuffer);
 const range = max - min || 1;
 const pts = this.sparklineBuffer.map((v, i) => ({
 x: (i / (this.sparklineBuffer.length - 1)) * w,
 y: h - ((v - min) / range) * (h - 4) - 2,
 }));
 ctx.beginPath();
 ctx.strokeStyle = 'rgba(96,165,250,0.7)';
 ctx.lineWidth = 1.5;
 const first = pts[0];
 if (!first) return;
 ctx.moveTo(first.x, first.y);
 for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
 ctx.stroke();
 ctx.lineTo(w, h);
 ctx.lineTo(0, h);
 ctx.closePath();
 ctx.fillStyle = 'rgba(96,165,250,0.08)';
 ctx.fill();
  }

  private alertDotClass(severity: number): string {
 if (severity >= 8) return 'ge-alert-dot-critical';
 if (severity >= 5) return 'ge-alert-dot-elevated';
 return 'ge-alert-dot-nominal';
  }

  updateLayerCounts(counts: Map<string, number>): void {
 for (const [key, el] of this.layerCountEls) {
 const n = counts.get(key);
 el.textContent = n != null && n > 0 ? String(n) : '';
 }
  }

  updateAutoFollowState(target: FollowTarget | null, index: number, total: number): void {
 if (!this.autoFollowCard) return;
 if (!target) {
 this.autoFollowCard.classList.add('ge-hidden');
 return;
 }
 this.autoFollowCard.classList.remove('ge-hidden');
 if (this.autoFollowTarget) {
 // Truncate long names
 const name = target.name.length > 60 ? target.name.slice(0, 57) + '...' : target.name;
 this.autoFollowTarget.textContent = name;
 }
 if (this.autoFollowCounter) {
 this.autoFollowCounter.textContent = `${index + 1}/${total}`;
 }
  }

  // Pre-measured constants eliminate forced layout reads after DOM writes
  // in the Cesium MOUSE_MOVE hot path (up to 60 Hz).
  private static readonly TOOLTIP_W = 220;
  private static readonly TOOLTIP_H = 80;

  showTooltip(x: number, y: number, title: string, body: string): void {
 if (!this.tooltipEl) return;
 this.tooltipEl.replaceChildren();
 const titleEl = document.createElement('div');
 titleEl.className = 'ge-tooltip-title';
 titleEl.textContent = title;
 const bodyEl = document.createElement('div');
 bodyEl.className = 'ge-tooltip-body';
 bodyEl.textContent = body;
 this.tooltipEl.append(titleEl, bodyEl);
 const pad = 12;
 const w = GlobeHUD.TOOLTIP_W;   // no forced layout read after DOM write
 const h = GlobeHUD.TOOLTIP_H;
 const left = Math.min(x + 16, window.innerWidth - w - pad);
 const top = Math.min(y + 16, window.innerHeight - h - pad);
 this.tooltipEl.style.left = `${left}px`;
 this.tooltipEl.style.top = `${top}px`;
 this.tooltipEl.classList.remove('ge-hidden');
  }

  hideTooltip(): void {
 this.tooltipEl?.classList.add('ge-hidden');
  }

  setOnLayerToggle(cb: (layerKey: string, enabled: boolean) => void): void {
 this.onLayerToggle = cb;
  }

  setOnClusterToggle(cb: (enabled: boolean) => void): void {
 this.onClusterToggle = cb;
  }

  setOnTerminatorToggle(cb: (enabled: boolean) => void): void {
 this.onTerminatorToggle = cb;
  }

  setOnAutoFollowSkip(cb: () => void): void {
 this.onAutoFollowSkip = cb;
  }

  setOnExit(cb: () => void): void {
 this.onExit = cb;
  }

  setOnNavigationToggle(fn: () => void): void {
 this.onNavigationToggle = fn;
  }

  updateFlyMode(status: FlyModeStatus): void {
 if (!this.flyModeBarEl) return;
 if (status.active) {
 this.flyModeBarEl.classList.remove('ge-hidden');
 if (this.flyModeSubEl) {
 let label = FLY_SUB_MODE_NAMES[status.subMode];
 if (status.subMode === 3 && status.chaseCockpit) label += ' · COCKPIT';
 this.flyModeSubEl.textContent = label;
 }
 } else {
 this.flyModeBarEl.classList.add('ge-hidden');
 }
  }

  destroy(): void {
 if (this.clockId != null) clearInterval(this.clockId);
 if (this.fusionTimer != null) clearInterval(this.fusionTimer);
 this.element.remove();
 this.onLayerToggle = null;
 this.onExit = null;
 this.fourDBadgeEl = null;
  }
}
