import {
  Math as CesiumMath,
  Cartesian2,
  Cartesian3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from 'cesium';
import { CesiumGlobe } from '@/components/CesiumGlobe';
import { GlobeDataManager } from '@/components/GlobeDataManager';
import { GlobeHUD } from '@/components/GlobeHUD';
import { TimeScrubberHud } from '@/components/TimeScrubberHud';
import { GlobeTimeMachine } from '@/components/GlobeTimeMachine';
import { AutoFollowEngine } from '@/components/gods-vision/AutoFollowEngine';
import { Globe4DManager } from '@/components/gods-vision/Globe4DManager';
import { GlobePulse } from '@/components/gods-vision/GlobePulse';
import { GlobeArcs } from '@/components/gods-vision/GlobeArcs';
import { GlobeHeatmap } from '@/components/gods-vision/GlobeHeatmap';
import { GlobeReactorBeacons } from '@/components/GlobeReactorBeacons';
import { GlobeSeismicWaves } from '@/components/GlobeSeismicWaves';
import { GlobeWebcamLayer } from '@/services/webcams/webcam-globe-layer';
import { fetchUnifiedWebcams } from '@/services/webcams/fetcher';
import { buildSnapshotViewerCard, type SnapshotViewerHandle } from '@/services/webcams/webcam-viewer';
import { resolveFrameUrl, needsFrameResolve } from '@/services/webcams/frame-resolver';
import type { WebcamFeed } from '@/services/webcams/webcam-types';
import { openExternalSafe } from '@/utils/safe-open';
import { FlyModeController } from '@/components/gods-vision/FlyMode/FlyModeController';
import { BuildingTileManager } from '@/services/building-tiles';
import type { FlySubMode } from '@/components/gods-vision/FlyMode/flyModeKeybinds';
import type { CustomDataSource } from 'cesium';
import { getMode, type AppMode, type ModeChangedDetail } from '@/services/mode-manager';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { loadBookmarks, saveBookmark } from '@/services/camera-bookmarks';
import { saveWaypoint, WaypointTour, loadWaypoints } from '@/services/globe-waypoints';
import { GlobeSearch } from '@/components/gods-vision/GlobeSearch';
import { GlobeSatellites } from '@/components/gods-vision/GlobeSatellites';
import { GlobeMiniMap } from '@/components/gods-vision/GlobeMiniMap';
import { GlobeAudio } from '@/components/gods-vision/GlobeAudio';
import { GlobeAlertClusters } from '@/components/gods-vision/GlobeAlertClusters';
import { GlobeTimelineSync } from '@/components/gods-vision/GlobeTimelineSync';
import { GlobeHeatmapToggle } from '@/components/gods-vision/GlobeHeatmapToggle';
import { StreetTileManager } from '@/services/street-tiles';
import { GpsTracker, type GpsPosition } from '@/services/gps-tracker';
import { computeRoute, type RouteResult, type RouteCoord } from '@/services/routing-engine';
import { NavigationHUD } from '@/components/NavigationHUD';
import { NavigationPanel } from '@/components/NavigationPanel';

// ── Theater camera presets (lat, lon, altitude meters, pitch degrees) ──
const THEATERS = {
  middleEast: { lon: 44, lat: 30, alt: 4e6, pitch: -35 },
  pacific: { lon: 135, lat: 20, alt: 8e6, pitch: -30 },
  europe: { lon: 15, lat: 50, alt: 5e6, pitch: -35 },
  arctic: { lon: 0, lat: 80, alt: 6e6, pitch: -50 },
  africa: { lon: 20, lat: 5, alt: 6e6, pitch: -30 },
  americas: { lon: -80, lat: 20, alt: 8e6, pitch: -30 },
} as const;

const THEATER_KEYS: Record<string, keyof typeof THEATERS> = {
  '1': 'middleEast',
  '2': 'pacific',
  '3': 'europe',
  '4': 'arctic',
  '5': 'africa',
  '6': 'americas',
};

function addListener<K extends string>(
  el: EventTarget,
  event: K,
  handler: (e: Event) => void,
  opts?: AddEventListenerOptions,
): () => void {
  el.addEventListener(event, handler, opts);
  return () => el.removeEventListener(event, handler, opts);
}

export class GodsVisionView {
  private container: HTMLElement;
  private globe: CesiumGlobe | null = null;
  private dataManager: GlobeDataManager | null = null;
  private hud: GlobeHUD | null = null;
  private timeScrubber: TimeScrubberHud | null = null;
  private timeMachine: GlobeTimeMachine | null = null;
  private timelineSync: GlobeTimelineSync | null = null;
  private heatmapToggle: GlobeHeatmapToggle | null = null;
  private autoFollow: AutoFollowEngine | null = null;
  private fourD: Globe4DManager | null = null;
  private reactorBeacons: GlobeReactorBeacons | null = null;
  private seismicWaves: GlobeSeismicWaves | null = null;
  private webcamLayer: GlobeWebcamLayer | null = null;
  private webcamViewer: SnapshotViewerHandle | null = null;
  private webcamViewerHost: HTMLElement | null = null;
  private globePulse: GlobePulse | null = null;
  private globeArcs: GlobeArcs | null = null;
  private globeHeatmap: GlobeHeatmap | null = null;
  private flyMode: FlyModeController | null = null;
  private buildingTiles: BuildingTileManager | null = null;
  private globeSearch: GlobeSearch | null = null;
  private globeSatellites: GlobeSatellites | null = null;
  private globeMiniMap: GlobeMiniMap | null = null;
  private globeAudio: GlobeAudio | null = null;
  private globeAlertClusters: GlobeAlertClusters | null = null;
  private waypointTour: WaypointTour | null = null;
  private hudTickId: number | null = null;
  private eventHandler: ScreenSpaceEventHandler | null = null;
  private active = false;
  private ionToken: string | undefined;
  private cleanupHandlers: (() => void)[] = [];
  private currentMode: AppMode | null = null;
  private streetTiles: StreetTileManager | null = null;
  private gpsTracker: GpsTracker | null = null;
  private navHud: NavigationHUD | null = null;
  private navPanel: NavigationPanel | null = null;
  private navigationActive = false;
  private _currentRoute: RouteResult | null = null;
  private gpsCleanup: (() => void) | null = null;

  constructor(ionToken?: string) {
 this.ionToken = ionToken;
 this.container = document.createElement('div');
 this.container.className = 'gods-vision-container';
 document.body.append(this.container);
  }

  get isActive(): boolean {
 return this.active;
  }

  get activeRoute(): RouteResult | null {
 return this._currentRoute;
  }

  async enter(): Promise<void> {
 if (this.active) return;
 this.active = true;

 this.container.classList.add('gods-vision-active');
 document.body.classList.add('gods-vision-lock');

 try {
 this.globe = new CesiumGlobe({
 container: this.container,
 ionToken: this.ionToken,
 });
 await this.globe.initialize();
 } catch (error) {

 console.error('[GodsVisionView] WebGL initialization failed:', error);
 this.globe?.destroy();
 this.globe = null;
 this.active = false;
 this.container.classList.remove('gods-vision-active');
 document.body.classList.remove('gods-vision-lock');
 return;
 }

 // Thin drag strip at the top of the overlay for window dragging
 const dragStrip = document.createElement('div');
 dragStrip.className = 'ge-drag-strip';
 dragStrip.addEventListener('mousedown', (e) => {
 if (e.button !== 0) return;
 tryInvokeTauri('plugin:window|start_dragging').catch(() => {/* silent */});
 });
 this.container.append(dragStrip);
 this.cleanupHandlers.push(() => dragStrip.remove());

 this.attachZoomHandlers();
 this.attachKeyboardHandlers();
 this.attachClickToFly();

 // Load data layers onto the globe
 const viewer = this.globe.cesiumViewer;
 if (viewer) {
 this.dataManager = new GlobeDataManager(viewer);
 this.dataManager.initialize();
 this.globePulse = new GlobePulse(viewer, this.dataManager);
 this.globePulse.mount();
 this.cleanupHandlers.push(() => { this.globePulse?.destroy(); this.globePulse = null; });
 this.globeArcs = new GlobeArcs(viewer, this.dataManager);
 this.globeArcs.mount();
 this.cleanupHandlers.push(() => { this.globeArcs?.destroy(); this.globeArcs = null; });
 this.globeHeatmap = new GlobeHeatmap(viewer, this.container, this.dataManager);
 this.globeHeatmap.mount();
 this.cleanupHandlers.push(() => { this.globeHeatmap?.destroy(); this.globeHeatmap = null; });
 this.globeAlertClusters = new GlobeAlertClusters(viewer);
 this.globeAlertClusters.mount();
 this.cleanupHandlers.push(() => { this.globeAlertClusters?.destroy(); this.globeAlertClusters = null; });
 this.reactorBeacons = new GlobeReactorBeacons(viewer);
 this.reactorBeacons.mount();
 this.seismicWaves = new GlobeSeismicWaves(viewer);
 this.seismicWaves.mount();
 this.webcamLayer = new GlobeWebcamLayer(viewer, {
 fetchFeeds: async () => {
 const cat = await fetchUnifiedWebcams();
 return cat.feeds;
 },
 salientOnly: false,
 });
 void this.webcamLayer.mount();
 this.cleanupHandlers.push(() => { this.webcamLayer?.destroy(); this.webcamLayer = null; });
 // The Webcams panel isn't visible over the fullscreen globe, so clicking a
 // cam here must surface its viewer IN this view — otherwise the click only
 // reads as a zoom. Listen for the layer's webcam:select and open an overlay.
 const onWebcamSelect = (e: Event): void => {
 const feed = (e as CustomEvent<{ feed?: WebcamFeed }>).detail?.feed;
 if (feed) this.openWebcamViewer(feed);
 };
 window.addEventListener('webcam:select', onWebcamSelect as EventListener);
 this.cleanupHandlers.push(() => {
 window.removeEventListener('webcam:select', onWebcamSelect as EventListener);
 this.closeWebcamViewer();
 this.webcamViewerHost?.remove();
 this.webcamViewerHost = null;
 });
 }

 // Auto-follow engine
 if (viewer) {
 this.autoFollow = new AutoFollowEngine(
 viewer,
 () => this.dataManager?.getDataSources() ?? new Map<string, CustomDataSource>(),
 );
 this.autoFollow.setOnTargetChange((target, index, total) => {
 this.hud?.updateAutoFollowState(target, index, total);
 });
 }

 // Fly Mode controller
 if (viewer && this.globe.canvas) {
 this.buildingTiles = new BuildingTileManager(viewer);
 this.flyMode = new FlyModeController(
 viewer,
 this.globe.canvas,
 this.buildingTiles,
 (n) => this.autoFollow?.getPriorityTargets(n) ?? [],
 );
 this.flyMode.setOnStatusChange((status) => {
 this.hud?.updateFlyMode(status);
 });
 this.cleanupHandlers.push(() => {
 this.flyMode?.destroy();
 this.flyMode = null;
 this.buildingTiles?.destroy();
 this.buildingTiles = null;
 });
 }

 // Time Machine scrubber (24h replay)
 if (viewer && this.dataManager) {
 this.timeMachine = new GlobeTimeMachine(viewer, this.dataManager, this.container);
 this.timeMachine.mount();

 // Bridge cursor → timeline-cursor visibility helper. Renders a
 // small "N events @ cursor" badge above the scrubber + dispatches
 // `wm:globe-timeline-cursor` events for layer managers to react.
 this.timelineSync = new GlobeTimelineSync(this.timeMachine, this.container);
 this.timelineSync.mount();
 this.cleanupHandlers.push(() => { this.timelineSync?.destroy(); this.timelineSync = null; });
 }

 // Per-domain heatmap toggle row (seismic / fire / cyber / conflict).
 // The toggle owns selection + opacity state and dispatches
 // `wm:globe-heatmap-changed` with deck.gl HexagonLayer configs;
 // the deck.gl-on-Cesium overlay that consumes those configs is a
 // follow-up. Visible UI lands now so users see the controls.
 this.heatmapToggle = new GlobeHeatmapToggle(this.container);
 this.heatmapToggle.mount();
 this.cleanupHandlers.push(() => { this.heatmapToggle?.destroy(); this.heatmapToggle = null; });

 // Geocode search bar
 if (viewer) {
 this.globeSearch = new GlobeSearch(viewer, this.container);
 this.globeSearch.mount();
 this.cleanupHandlers.push(() => { this.globeSearch?.destroy(); this.globeSearch = null; });
 }

 // HUD overlay
 this.hud = new GlobeHUD(this.container);
 // World Stage time scrubber (E4): replay ⟵ now ⟶ projected, render-gated.
 this.timeScrubber = new TimeScrubberHud(this.container);
 this.hud.setOnExit(() => this.exit());
 this.hud.setOnLayerToggle((key, enabled) => {
 if (key === 'autoFollow') {
 if (enabled) this.autoFollow?.start();
 else this.autoFollow?.stop();
 return;
 }
 this.dataManager?.setLayerVisible(key, enabled);
 });
 this.hud.setOnAutoFollowSkip(() => this.autoFollow?.skipToNext());
 this.hud.setOnClusterToggle((enabled) => this.dataManager?.setClusteringEnabled(enabled));
 this.hud.setOnTerminatorToggle((enabled) => this.globe?.setLightingEnabled(enabled));
 this.hud.setOnBuildingsToggle((enabled) => {
 if (enabled) {
 this.buildingTiles?.initialize().then((loaded) => {
 if (!loaded) this.hud?.setBuildingsEnabled(false);
 }).catch(() => { this.hud?.setBuildingsEnabled(false); });
 } else {
 this.buildingTiles?.destroy();
 }
 });
 this.hud.setOnAlertClick((lat, lon, _name) => {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;
 viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(lon, lat, 300_000),
 duration: 2,
 });
 this.autoFollow?.stop();
 this.hud?.updateAutoFollowState(null, 0, 0);
 });
 this.hud.setOnScreenshot(() => { void this.takeScreenshot(); });
 this.hud.setOnArcsToggle((enabled) => this.globeArcs?.setEnabled(enabled));
 this.hud.setOnHeatmapToggle((enabled) => this.globeHeatmap?.setEnabled(enabled));
 this.hud.setOnSeismicWavesToggle((enabled) => this.seismicWaves?.setEnabled(enabled));
 if (this.seismicWaves) this.hud.setSeismicWavesEnabled(this.seismicWaves.isEnabled());
 this.hud.setOnNavigationToggle(() => void this.toggleNavigation());

 // 4D mode orchestrator (T toggles; D/I/H pick playback mode; Tab/[/]/Esc cycle UI).
 this.fourD = new Globe4DManager({
 hud: this.hud,
 timeMachine: this.timeMachine,
 dataManager: this.dataManager,
 autoFollow: this.autoFollow,
 viewer: this.globe?.cesiumViewer ?? null,
 overlayContainer: this.container,
 });
 this.fourD.onChange((state) => {
 this.hud?.updateState({
 fourDActive: state.active,
 fourDPlaybackMode: state.playbackMode,
 });
 });

 // Navigation HUD + Panel
 this.navHud = new NavigationHUD(this.container);
 this.navHud.mount();
 this.cleanupHandlers.push(() => { this.navHud?.destroy(); this.navHud = null; });

 this.navPanel = new NavigationPanel(this.container);
 this.navPanel.mount();
 this.navPanel.setOnClose(() => this.deactivateNavigation());
 this.cleanupHandlers.push(() => { this.navPanel?.destroy(); this.navPanel = null; });

 // Initialize street tiles and GPS tracker
 if (viewer) {
 this.streetTiles = new StreetTileManager(viewer);
 void this.streetTiles.initialize();
 this.cleanupHandlers.push(() => { this.streetTiles?.destroy(); this.streetTiles = null; });
 }
 this.gpsTracker = new GpsTracker();
 this.cleanupHandlers.push(() => { this.gpsTracker?.destroy(); this.gpsTracker = null; });

 // Satellite overlay
 if (viewer) {
 this.globeSatellites = new GlobeSatellites(viewer);
 void this.globeSatellites.mount();
 this.cleanupHandlers.push(() => { this.globeSatellites?.destroy(); this.globeSatellites = null; });
 }
 this.hud.setOnSatellitesToggle((enabled) => this.globeSatellites?.setEnabled(enabled));

 // Mini-map overlay
 if (viewer) {
 this.globeMiniMap = new GlobeMiniMap(viewer, this.container);
 this.globeMiniMap.mount();
 this.cleanupHandlers.push(() => { this.globeMiniMap?.destroy(); this.globeMiniMap = null; });
 }

 // Ambient audio
 this.globeAudio = new GlobeAudio();
 this.cleanupHandlers.push(() => { this.globeAudio?.stop(); this.globeAudio = null; });
 this.hud.setOnAudioToggle((enabled) => {
 if (enabled) {
 this.globeAudio?.start();
 this.globeAudio?.setMode(this.currentMode);
 } else {
 this.globeAudio?.stop();
 }
 });

 // Update HUD at ~10fps
 this.hudTickId = window.setInterval(() => {
 const camera = this.globe?.camera;
 if (!camera || !this.hud) return;
 const carto = camera.positionCartographic;
 const lat = CesiumMath.toDegrees(carto.latitude);
 const lon = CesiumMath.toDegrees(carto.longitude);
 const dm = this.dataManager;
 const cats = dm?.getCategoryCounts();
 const alerts = dm?.getTopAlerts(8) ?? [];
 this.hud.updateState({
 cameraAltitude: carto.height,
 cameraLat: lat,
 cameraLon: lon,
 activeHotspots: dm?.getEntityCount() ?? 0,
 topAlerts: alerts.slice(0, 5),
 conflicts: cats?.conflicts ?? 0,
 disasters: cats?.disasters ?? 0,
 nearestHotspot: dm?.getNearestHotspot(lat, lon) ?? null,
 tickerItems: alerts.map(a => `[${a.type.toUpperCase()}] ${a.name}`),
 });
 if (this.dataManager) {
 this.hud.updateLayerCounts(this.dataManager.getLayerCounts());
 }
 }, 100);

 // Mode tracking
 this.currentMode = getMode();
 this.applyModeTheme(this.currentMode);
 const handler = this.handleModeChange.bind(this);
 document.addEventListener('wm:mode-changed', handler);
 this.cleanupHandlers.push(() => document.removeEventListener('wm:mode-changed', handler));
  }

  exit(): void {
 if (!this.active) return;
 this.active = false;

 for (const fn of this.cleanupHandlers) fn();
 this.cleanupHandlers = [];

 this.container.classList.remove('gods-vision-active');
 document.body.classList.remove('gods-vision-lock');

 if (this.hudTickId != null) { clearInterval(this.hudTickId); this.hudTickId = null; }

 this.waypointTour?.stop();
 this.waypointTour = null;

 this.deactivateNavigation();

 this.autoFollow?.destroy();
 this.autoFollow = null;

 this.eventHandler?.destroy();
 this.eventHandler = null;

 this.timeMachine?.destroy();
 this.timeMachine = null;

 this.fourD?.destroy();
 this.fourD = null;

 this.reactorBeacons?.destroy();
 this.reactorBeacons = null;

 this.seismicWaves?.destroy();
 this.seismicWaves = null;

 this.hud?.destroy();
 this.hud = null;
 this.timeScrubber?.destroy();
 this.timeScrubber = null;
 this.dataManager?.destroy();
 this.dataManager = null;
 this.globe?.destroy();
 this.globe = null;
  }


  destroy(): void {
 this.exit();
 this.container.remove();
  }

  private async takeScreenshot(): Promise<void> {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;

 viewer.render();
 const cesiumCanvas = viewer.canvas;

 const out = document.createElement('canvas');
 out.width = cesiumCanvas.width;
 out.height = cesiumCanvas.height;
 const ctx = out.getContext('2d');
 if (!ctx) return;
 ctx.drawImage(cesiumCanvas, 0, 0);

 const dataUrl = out.toDataURL('image/png');
 const a = document.createElement('a');
 a.href = dataUrl;
 const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
 a.download = `crystalball-${ts}.png`;
 a.click();
  }

  flyToReactorAlert(alertId: string): boolean {
 return this.reactorBeacons?.flyTo(alertId) ?? false;
  }

  // ── Navigation ──────────────────────────────────────

  async toggleNavigation(): Promise<void> {
 if (this.navigationActive) {
 this.deactivateNavigation();
 } else {
 await this.activateNavigation();
 }
  }

  private async activateNavigation(): Promise<void> {
 this.navigationActive = true;
 this.streetTiles?.setVisible(true);

 if (this.gpsTracker) {
 await this.gpsTracker.start();
 this.gpsCleanup = this.gpsTracker.addListener((pos: GpsPosition) => {
 this.navHud?.updateFromGps(pos);
 this.navPanel?.updateGpsPosition(pos);

 const cameraHeight = this.globe?.cesiumViewer?.camera.positionCartographic.height;
 if (cameraHeight !== undefined && cameraHeight < 5000 && !this.navPanel?.visible) {
   this.navPanel?.show({ lat: pos.lat, lon: pos.lon });
 } else if (cameraHeight !== undefined && cameraHeight >= 5000 && this.navPanel?.visible) {
   this.navPanel?.hide();
 }
 });
 }

 this.navHud?.show();
  }

  private deactivateNavigation(): void {
 this.navigationActive = false;
 this.streetTiles?.setVisible(false);
 this.gpsCleanup?.();
 this.gpsCleanup = null;
 this.gpsTracker?.stop();
 this.navHud?.hide();
 this.navPanel?.hide();
 this._currentRoute = null;
  }

  async navigateTo(destination: RouteCoord): Promise<void> {
 const pos = this.gpsTracker?.lastPosition;
 if (!pos) return;

 const from: RouteCoord = { lat: pos.lat, lon: pos.lon };
 const route = await computeRoute(from, destination);
 if (!route) return;

 this._currentRoute = route;
 this.navHud?.update({
 active: true,
 currentStep: route.steps[0] ?? null,
 nextStep: route.steps[1] ?? null,
 distanceToTurn: route.steps[0]?.distance ?? 0,
 totalRemaining: route.distance,
 routingProvider: route.provider,
 eta: new Date(Date.now() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
 });
 this.navPanel?.displayRoute(route);
  }

  // ── Mode theming ─────────────────────────────────────

  private handleModeChange(e: Event): void {
 const detail = (e as CustomEvent<ModeChangedDetail>).detail;
 this.currentMode = detail.mode;
 // AutoFollow no longer reprioritizes by mode — single-mode design.
 // Mode here drives theming and audio cues only.
 this.applyModeTheme(detail.mode);
  }

  /** Open (or replace) the in-view webcam snapshot viewer for a clicked cam. */
  private openWebcamViewer(feed: WebcamFeed): void {
 this.closeWebcamViewer();
 if (!this.webcamViewerHost) {
 const host = document.createElement('div');
 host.className = 'gods-vision-webcam-viewer';
 this.container.append(host);
 this.webcamViewerHost = host;
 }
 this.webcamViewer = buildSnapshotViewerCard(feed, {
 onClose: () => this.closeWebcamViewer(),
 openExternal: (url) => openExternalSafe(url),
 // FAA and similar feeds carry a /api/ resolver URL; resolve it to a real
 // image so their globe click-through shows a frame, not an empty overlay.
 resolveFrame: (url) => (needsFrameResolve(url) ? resolveFrameUrl(url) : Promise.resolve(url)),
 });
 this.webcamViewerHost.append(this.webcamViewer.el);
  }

  private closeWebcamViewer(): void {
 if (this.webcamViewer) {
 this.webcamViewer.destroy();
 this.webcamViewer.el.remove();
 this.webcamViewer = null;
 }
  }

  private applyModeTheme(mode: AppMode | null): void {
 const modeClasses = ['ge-mode-ghost', 'ge-mode-gods-vision'];
 for (const cls of modeClasses) this.container.classList.remove(cls);
 if (mode) this.container.classList.add(`ge-mode-${mode}`);
 if (this.globeAudio?.isEnabled()) this.globeAudio.setMode(mode);
  }

  // ── Click to fly ─────────────────────────────────────

  private attachClickToFly(): void {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;

 this.eventHandler = new ScreenSpaceEventHandler(viewer.canvas);
 this.eventHandler.setInputAction((click: { position: Cartesian2 }) => {
 const picked = viewer.scene.pick(click.position) as
 { id?: { position?: { getValue: (t: unknown) => Cartesian3 | undefined } } } | undefined;

 // Chase mode: attach camera to the clicked entity
 if (this.flyMode?.isActive && this.flyMode.currentSubMode === 3 && picked?.id) {
 this.flyMode.attachChaseTarget(picked.id as import('cesium').Entity);
 return;
 }

 if (picked?.id?.position) {
 const pos = picked.id.position.getValue(viewer.clock.currentTime);
 if (pos) {
 const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(pos);
 viewer.camera.flyTo({
 destination: Cartesian3.fromRadians(
 carto.longitude,
 carto.latitude,
 Math.max(carto.height + 500_000, 800_000),
 ),
 duration: 2,
 });
 }
 }
 }, ScreenSpaceEventType.LEFT_CLICK);

 this.eventHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer || !this.hud) return;

 const picked = viewer.scene.pick(movement.endPosition) as
 { id?: { description?: { getValue: (t: unknown) => string | undefined }; label?: { text?: { getValue: (t: unknown) => string | undefined } } } } | undefined;

 if (!picked?.id) {
 this.hud.hideTooltip();
 return;
 }

 const desc = picked.id.description?.getValue(viewer.clock.currentTime) ?? '';
 const label = picked.id.label?.text?.getValue(viewer.clock.currentTime) ?? '';
 const title = label === '' ? (desc.split('—')[0]?.trim() ?? 'Entity') : label;
 const body = desc.length > 200 ? desc.slice(0, 197) + '…' : desc;

 if (!desc && !label) {
 this.hud.hideTooltip();
 return;
 }

 this.hud.showTooltip(movement.endPosition.x, movement.endPosition.y, title, body);
 }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── Keyboard ─────────────────────────────────────────

  private attachKeyboardHandlers(): void {
 this.cleanupHandlers.push(
 addListener(document, 'keydown', (e: Event) => {
 if (!this.active) return;
 const ke = e as KeyboardEvent;

 // ── Fly Mode key intercept ────────────────────────
 if (this.flyMode?.isActive) {
 if (ke.key === 'Escape' || ke.key === 'f' || ke.key === 'F') {
 this.flyMode.exit();
 this.hud?.updateFlyMode({ active: false, subMode: 1, subModeName: 'FREE FLY' });
 return;
 }
 const flySubMap: Record<string, FlySubMode> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
 const flySubMode = flySubMap[ke.key];
 if (flySubMode !== undefined) {
 this.flyMode.switchSubMode(flySubMode);
 return;
 }
 if (ke.key === 'c' || ke.key === 'C') {
 this.flyMode.toggleCockpit();
 return;
 }
 // Block all other shortcuts (theater, zoom, etc.) while flying
 return;
 }

 // ── Normal mode keys ──────────────────────────────

 // Esc clears any active Tier 2 overlay before the existing Esc-exits handler runs.
 if (ke.key === 'Escape' && this.fourD?.hasActiveTier2()) {
 this.fourD.clearTier2();
 ke.stopPropagation();
 return;
 }

 // ESC exits God's Eye
 if (ke.key === 'Escape') {
 this.exit();
 return;
 }

 // F enters Fly Mode
 if (ke.key === 'f' || ke.key === 'F') {
 this.flyMode?.enter(1);
 return;
 }

 // Space toggles Time Machine play/pause
 if (ke.key === ' ' || ke.code === 'Space') {
 ke.preventDefault();
 this.timeMachine?.togglePlay();
 return;
 }

 // L toggles day/night terminator
 if (ke.key === 'l' || ke.key === 'L') {
 this.hud?.toggleTerminator();
 return;
 }

 // N toggles navigation mode
 if (ke.key === 'n' || ke.key === 'N') {
 void this.toggleNavigation();
 return;
 }

 // T toggles 4D mode. Avoid stealing Cmd+T (open new tab in browsers).
 if (ke.key === 't' || ke.key === 'T') {
 if (ke.metaKey || ke.ctrlKey || ke.altKey) return;
 this.fourD?.toggle();
 return;
 }

 // 4D-only shortcuts: D/I/H playback, Tab collapse, [/] zoom.
 if (this.fourD?.isActive() && !ke.metaKey && !ke.ctrlKey && !ke.altKey) {
 if (ke.key === 'd' || ke.key === 'D') { this.fourD.setPlaybackMode('documentary'); return; }
 if (ke.key === 'i' || ke.key === 'I') { this.fourD.setPlaybackMode('director'); return; }
 if (ke.key === 'h' || ke.key === 'H') { this.fourD.setPlaybackMode('heartbeat'); return; }
 if (ke.key === 'Tab') { ke.preventDefault(); this.fourD.toggleSwimlaneCollapse(); return; }
 if (ke.key === '[') { this.fourD.swimlaneZoomIn(); return; }
 if (ke.key === ']') { this.fourD.swimlaneZoomOut(); return; }
 }

 // Bookmark save: Cmd+1-5
 if ((ke.metaKey || ke.ctrlKey) && ke.key >= '1' && ke.key <= '5') {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;
 const cam = viewer.camera;
 const carto = cam.positionCartographic;
 saveBookmark(ke.key, {
 lon: CesiumMath.toDegrees(carto.longitude),
 lat: CesiumMath.toDegrees(carto.latitude),
 alt: carto.height,
 heading: CesiumMath.toDegrees(cam.heading),
 pitch: CesiumMath.toDegrees(cam.pitch),
 });
 ke.preventDefault();
 return;
 }

 // W = save waypoint, Shift+W = start/stop tour
 if ((ke.key === 'w' || ke.key === 'W') && !ke.metaKey && !ke.ctrlKey) {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;
 const cam = viewer.camera;
 const carto = cam.positionCartographic;
 if (ke.shiftKey) {
 if (this.waypointTour) {
 this.waypointTour.stop();
 this.waypointTour = null;
 } else {
 this.waypointTour = new WaypointTour(viewer);
 this.waypointTour.start();
 }
 } else {
 const wps = loadWaypoints();
 saveWaypoint({
 id: String(Date.now()),
 name: `Waypoint ${wps.length + 1}`,
 lon: CesiumMath.toDegrees(carto.longitude),
 lat: CesiumMath.toDegrees(carto.latitude),
 alt: carto.height,
 heading: CesiumMath.toDegrees(cam.heading),
 pitch: CesiumMath.toDegrees(cam.pitch),
 });
 }
 ke.preventDefault();
 return;
 }

 // Keys 1-6: bookmark recall if saved, else theater preset
 if (!ke.metaKey && !ke.ctrlKey && !ke.altKey) {
 const theater = THEATER_KEYS[ke.key];
 const bm = (ke.key >= '1' && ke.key <= '5') ? loadBookmarks()[ke.key] : undefined;
 if (bm) {
 const viewer = this.globe?.cesiumViewer;
 if (viewer) {
 viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(bm.lon, bm.lat, bm.alt),
 orientation: {
 heading: CesiumMath.toRadians(bm.heading),
 pitch: CesiumMath.toRadians(bm.pitch),
 roll: 0,
 },
 duration: 2,
 });
 ke.preventDefault();
 return;
 }
 }
 if (theater) {
 this.flyToTheater(theater);
 return;
 }
 }

 // +/- zoom
 const camera = this.globe?.camera;
 if (!camera) return;
 const alt = camera.positionCartographic.height;
 if (ke.key === '=' || ke.key === '+') {
 camera.zoomIn(alt * 0.4);
 } else if (ke.key === '-' || ke.key === '_') {
 camera.zoomOut(alt * 0.4);
 }
 }),
 );
  }

  private flyToTheater(name: keyof typeof THEATERS): void {
 const viewer = this.globe?.cesiumViewer;
 if (!viewer) return;
 const t = THEATERS[name];
 viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(t.lon, t.lat, t.alt),
 orientation: {
 heading: 0,
 pitch: CesiumMath.toRadians(t.pitch),
 roll: 0,
 },
 duration: 2.5,
 });
  }

  // ── Zoom handlers ────────────────────────────────────

  private attachZoomHandlers(): void {
 this.cleanupHandlers.push(
 // 1. wheel on document (capture phase)
 addListener(document, 'wheel', (e: Event) => {
 if (!this.active) return;
 const we = e as WheelEvent;
 if (!this.container.contains(we.target as Node)) return;
 we.preventDefault();

 const camera = this.globe?.camera;
 if (!camera) return;
 const delta = we.deltaY * 500;
 if (delta > 0) camera.zoomOut(delta);
 else if (delta < 0) camera.zoomIn(-delta);
 }, { passive: false, capture: true }),

 // 2. wheel on container (bubble)
 addListener(this.container, 'wheel', (e: Event) => {
 const we = e as WheelEvent;
 we.preventDefault();

 const camera = this.globe?.camera;
 if (!camera) return;
 if (we.deltaY > 0) camera.zoomOut(we.deltaY * 500);
 else if (we.deltaY < 0) camera.zoomIn(-we.deltaY * 500);
 }, { passive: false }),

 // 3. Legacy mousewheel
 addListener(this.container, 'mousewheel', (e: Event) => {
 e.preventDefault();

 const camera = this.globe?.camera;
 if (!camera) return;
 const delta = ((e as WheelEvent).deltaY ?? 0) * 500;
 if (delta > 0) camera.zoomOut(delta);
 else if (delta < 0) camera.zoomIn(-delta);
 }, { passive: false }),

 // 4. Safari gesturechange — trackpad pinch
 addListener(this.container, 'gesturestart', (e: Event) => {
 e.preventDefault();
 }),
 addListener(this.container, 'gesturechange', (e: Event) => {
 e.preventDefault();

 const ge = e as Event & { scale?: number };
 if (ge.scale == null) return;
 const camera = this.globe?.camera;
 if (!camera) return;
 const alt = camera.positionCartographic.height;
 if (ge.scale > 1) camera.zoomIn(alt * (ge.scale - 1) * 3);
 else if (ge.scale < 1) camera.zoomOut(alt * (1 - ge.scale) * 3);
 }),

 // 5. Mouse drag / touch — mark as user interaction
 );
  }
}
