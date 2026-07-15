import {
  Viewer,
  IonImageryProvider,
  ImageryLayer,
  UrlTemplateImageryProvider,
  EllipsoidTerrainProvider,
  SceneMode,
  Color,
  Cartesian3,
  Cartographic,
  HeadingPitchRange,
  Matrix4,
  Math as CesiumMath,
  type Scene,
  type Camera,
  type ImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { initCesium } from '@/config/cesium-init';

export interface CesiumGlobeOptions {
  container: HTMLElement;
  ionToken?: string;
}

/** DataSource names whose entities are intentionally above the ellipsoid, so the
 *  floating-entity auditor must not flag them. Flights/aircraft/satellites carry
 *  real altitude; arc and 4d-* layers are trajectory curves through the air. The
 *  military-flight layer's dataSource is named `aviationIntel` (GlobeDataManager
 *  registerLayer id), so `aviation` must be in the allowlist too — `aircraft`
 *  alone does not match it. */
const ALTITUDE_EXPECTED_SOURCE = /flight|aircraft|aviation|satellite|orbit|reentry|arcs?|^4d-|trajector/i;

export class CesiumGlobe {
  private viewer: Viewer | null = null;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private fallbackAdded = false;

  constructor(private readonly options: CesiumGlobeOptions) {
 this.container = options.container;
  }

  async initialize(): Promise<void> {
 initCesium(this.options.ionToken);

 const cesiumContainer = document.createElement('div');
 cesiumContainer.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
 this.container.append(cesiumContainer);

 const hasToken = Boolean(this.options.ionToken);

 this.viewer = new Viewer(cesiumContainer, {
 sceneMode: SceneMode.SCENE3D,
 animation: false,
 baseLayerPicker: false,
 baseLayer: false,
 // Explicit EllipsoidTerrainProvider — gives clampToGround a surface to
 // drape onto without real terrain data (which triggers pink-globe on Mac GPUs).
 // Setting terrain: undefined killed the default provider, making ground
 // polylines float at arbitrary heights.
 terrainProvider: new EllipsoidTerrainProvider(),
 fullscreenButton: false,
 geocoder: false,
 homeButton: false,
 infoBox: false,
 navigationHelpButton: false,
 sceneModePicker: false,
 selectionIndicator: false,
 timeline: false,
 shadows: false,
 contextOptions: {
 webgl: {
 alpha: true,
 antialias: true,
 powerPreference: 'high-performance',
 },
 },
 msaaSamples: 4,
 useBrowserRecommendedResolution: false,
 });

 const scene = this.viewer.scene;
 const globe = scene.globe;

 // ── Resolution ──────────────────────────────────────
 this.viewer.resolutionScale = Math.min(window.devicePixelRatio, 2);

 // ── Sky & Space ────────────────────────────────────
 scene.backgroundColor = Color.fromCssColorString('#050510');
 // Dark charcoal — visually distinct from Cesium's pink missing-tile fallback
 globe.baseColor = Color.fromCssColorString('#1a1a1a');

 // Sun and moon
 if (scene.sun) scene.sun.show = true;
 if (scene.moon) scene.moon.show = true;

 // ── Globe Lighting ─────────────────────────────────
 globe.enableLighting = false;
 globe.showGroundAtmosphere = true;

 // Sky atmosphere
 if (scene.skyAtmosphere) {
 scene.skyAtmosphere.show = true;
 scene.skyAtmosphere.hueShift = -0.05;
 scene.skyAtmosphere.saturationShift = 0.15;
 scene.skyAtmosphere.brightnessShift = -0.05;
 }

 // ── Terrain ────────────────────────────────────────
 // verticalExaggeration removed — with terrain disabled, it causes
 // ground-clamped entities (cables, arcs, dots) to float above the
 // rendered ellipsoid surface.
 scene.verticalExaggeration = 1;
 scene.verticalExaggerationRelativeHeight = 0;

 // ── Fog & Depth ────────────────────────────────────
 scene.fog.enabled = true;
 scene.fog.density = 2e-4;
 scene.fog.minimumBrightness = 0.03;

 // ── Post-Processing ────────────────────────────────
 scene.postProcessStages.fxaa.enabled = true;
 scene.postProcessStages.bloom.enabled = false;
 scene.postProcessStages.ambientOcclusion.enabled = false;
 // HDR causes pink globe on some Mac GPUs — keep disabled.
 scene.highDynamicRange = false;

 // ── Camera Controls ────────────────────────────────
 const controller = scene.screenSpaceCameraController;
 controller.enableZoom = true;
 controller.enableRotate = true;
 controller.enableTilt = true;
 controller.enableLook = true;
 // 1500m floor — below this, terrain + imagery render breaks to pink on Mac GPUs.
 controller.minimumZoomDistance = 1500;
 controller.maximumZoomDistance = 5e7;

 // Clamp camera pitch so the globe can't go more sideways than 45° from vertical.
 // Cesium pitch: -π/2 = straight down, 0 = horizontal. Cap at -π/4 (-45°).
 // IMPORTANT: camera.setView() with only orientation rotates in camera-local space,
 // decoupling it from the globe and causing a black-screen on next scroll. Instead,
 // use lookAt() targeting the ground point below the camera so the orbit is preserved.
 const MAX_PITCH = CesiumMath.toRadians(-45);
 scene.postUpdate.addEventListener(() => {
 const viewer = this.viewer;
 if (!viewer) return;
 const camera = viewer.camera;
 if (camera.pitch <= MAX_PITCH) return;

 const carto = camera.positionCartographic;
 const groundPos = Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
 const range = Cartesian3.distance(camera.positionWC, groundPos);
 camera.lookAt(groundPos, new HeadingPitchRange(camera.heading, MAX_PITCH, range));
 camera.lookAtTransform(Matrix4.IDENTITY);
 });

 // ── Imagery Layers ─────────────────────────────────
 this.viewer.imageryLayers.removeAll();

 if (hasToken) {
 await this.addPrimaryIonImagery();
 } else {
 this.log('INFO', '[globe] no Ion token — using ArcGIS imagery directly');
 this.addFallbackImagery('no-token');
 }

 // Safety net: if nothing got added (both paths somehow silent-failed), force ArcGIS
 if (this.viewer.imageryLayers.length === 0) {
 this.log('ERROR', '[globe] no imagery layers after init — falling back to ArcGIS');
 this.addFallbackImagery('post-init-safety');
 }

 // Transparent labels overlay — country/state/city names on top of satellite imagery.
 this.addLabelsOverlay();

 // ── Pink-Globe Pixel Sentinel ──────────────────────────
 // 3 s after init, sample a pixel near the globe's center. If it's in the
 // hot-magenta range, log diagnostics and force ArcGIS fallback so the user
 // sees something rather than a pink sphere. Next session we'll have the data.
 setTimeout(() => {
 if (!this.viewer) return;
 const sentinelCanvas = this.viewer.canvas;
 const w = sentinelCanvas.width, h = sentinelCanvas.height;
 const gl = sentinelCanvas.getContext('webgl2') ?? sentinelCanvas.getContext('webgl');
 if (!gl) return;
 const px = new Uint8Array(4);
 try {
 // Sample at ~1/3 from top, center — likely to hit globe, not space
 gl.readPixels(Math.floor(w / 2), Math.floor(h * 2 / 3), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
 const r = px[0] ?? 0, g = px[1] ?? 0, b = px[2] ?? 0;
 if (r > 200 && g < 80 && b > 150) {
 const layerCount = this.viewer.imageryLayers.length;
 this.log('ERROR', `[globe] pink-globe detected via pixel sample rgb=(${r},${g},${b}) — ionToken=${hasToken} terrain=false layers=${layerCount} — forcing ArcGIS fallback`);
 this.addFallbackImagery('pixel-sentinel');
 } else {
 this.log('INFO', `[globe] pixel sample ok rgb=(${r},${g},${b})`);
 }
 } catch (error) {
 this.log('WARN', `[globe] pixel sentinel readPixels failed: ${String(error)}`);
 }
 }, 3000);

 // ── Pink-Globe Camera moveEnd Sentinel ────────────────
 // Sample a pixel after each camera move to catch pink-screen at close zoom.
 // Debounced to at most once per 500ms so it doesn't spam on continuous scrolling.
 let moveEndDebounceTimer: ReturnType<typeof setTimeout> | null = null;
 this.viewer.camera.moveEnd.addEventListener(() => {
 if (!this.viewer) return;
 if (moveEndDebounceTimer !== null) return;
 moveEndDebounceTimer = setTimeout(() => {
 moveEndDebounceTimer = null;
 if (!this.viewer) return;
 const height = this.viewer.camera.positionCartographic?.height ?? -1;
 const moveCanvas = this.viewer.canvas;
 const mw = moveCanvas.width, mh = moveCanvas.height;
 const mgl = moveCanvas.getContext('webgl2') ?? moveCanvas.getContext('webgl');
 if (!mgl) return;
 const mpx = new Uint8Array(4);
 try {
 mgl.readPixels(Math.floor(mw / 2), Math.floor(mh * 2 / 3), 1, 1, mgl.RGBA, mgl.UNSIGNED_BYTE, mpx);
 const r = mpx[0] ?? 0, g = mpx[1] ?? 0, b = mpx[2] ?? 0;
 if (r > 200 && g < 80 && b > 150) {
 this.log('ERROR', `[globe] pink detected after camera move height=${Math.round(height)}m rgb=(${r},${g},${b}) — forcing ArcGIS fallback`);
 this.addFallbackImagery('moveend-pink-sentinel');
 }
 } catch (error) {
 this.log('WARN', `[globe] moveEnd pixel sentinel readPixels failed: ${String(error)}`);
 }
 }, 500);
 });

 // ── Resize Observer ────────────────────────────────
 this.resizeObserver = new ResizeObserver(() => {
 this.viewer?.resize();
 });
 this.resizeObserver.observe(this.container);

 // ── WebGL context loss handlers ────────────────────
 // macOS reclaims GPU resources from background apps; without these,
 // a context loss looks identical to an app crash (black globe).
 const canvas = this.viewer.canvas;
 canvas.addEventListener('webglcontextlost', (e) => {
 e.preventDefault();
 this.log('WARN', 'CesiumGlobe webglcontextlost — GPU context dropped');
 }, false);
 canvas.addEventListener('webglcontextrestored', () => {
 this.log('INFO', 'CesiumGlobe webglcontextrestored — reloading imagery layers');
 // Re-add imagery layers — textures are lost on context restore.
 const layers = this.viewer?.imageryLayers;
 if (layers && layers.length > 0) {
 const existing: ImageryLayer[] = [];
 for (let i = 0; i < layers.length; i++) existing.push(layers.get(i));
 layers.removeAll(false);
 for (const l of existing) layers.add(l);
 }
 this.viewer?.scene.requestRender();
 }, false);

 // ── Entity Height Auditor ────────────────────────────
 // After data loads, sample entity positions across all dataSources and
 // log any polyline/point that sits above the ellipsoid. This catches
 // "floating cable" regressions at runtime instead of waiting for user reports.
 setTimeout(() => this.auditEntityHeights(), 10_000);
  }

   
  private auditEntityHeights(): void {
 const viewer = this.viewer;
 if (!viewer) return;
 const now = viewer.clock.currentTime;
 const stats = { total: 0, floating: 0, details: [] as string[] };

 for (let ds = 0; ds < viewer.dataSources.length; ds++) {
 const source = viewer.dataSources.get(ds);
 // Skip layers whose entities are INTENTIONALLY airborne — flights, aircraft
 // and satellites carry real altitude (fromDegrees(lon,lat,altMeters)), and
 // 4d/arc trajectories arc through the air by design. The auditor exists to
 // catch ground-clamped regressions (cables, markers floating off terrain),
 // so flagging cruising aircraft at h=4846m was a false-positive ERROR spam.
 if (ALTITUDE_EXPECTED_SOURCE.test(source.name ?? '')) continue;
 for (const entity of source.entities.values) {
 this.auditPoint(entity, source.name, now, stats);
 this.auditPolyline(entity, source.name, now, stats);
 }
 }

 if (stats.floating > 0) {
 this.log('ERROR',
 `[globe-audit] ${stats.floating}/${stats.total} entities floating: ${stats.details.join('; ')}`,
 );
 } else {
 this.log('INFO', `[globe-audit] ${stats.total} entities checked — none floating`);
 }
 this.log('INFO',
 `[globe-audit] terrainProvider=${viewer.terrainProvider?.constructor?.name ?? 'none'}`,
 );
  }
   

  private auditPoint(
 entity: import('cesium').Entity, sourceName: string,
 now: import('cesium').JulianDate, stats: { total: number; floating: number; details: string[] },
  ): void {
 const pos = entity.position?.getValue(now);
 if (!pos) return;
 stats.total++;
 const carto = Cartographic.fromCartesian(pos);
 if (carto && carto.height > 100 && stats.details.length < 5) {
 stats.floating++;
 stats.details.push(`${sourceName}/${entity.id}: h=${Math.round(carto.height)}m`);
 }
  }

  private auditPolyline(
 entity: import('cesium').Entity, sourceName: string,
 now: import('cesium').JulianDate, stats: { total: number; floating: number; details: string[] },
  ): void {
 const raw = entity.polyline?.positions?.getValue(now) as Cartesian3[] | undefined;
 if (!raw || raw.length === 0) return;
 const first = raw[0];
 if (!first) return;
 stats.total++;
 const carto = Cartographic.fromCartesian(first);
 if (carto && carto.height > 100 && stats.details.length < 5) {
 stats.floating++;
 stats.details.push(`${sourceName}/${entity.id} polyline: h=${Math.round(carto.height)}m`);
 }
  }

  private async addPrimaryIonImagery(): Promise<void> {
 if (!this.viewer) return;

 let layer: ImageryLayer;
 try {
 // Use fromProviderAsync so Cesium manages the async load internally and
 // exposes errorEvent/readyEvent on the layer itself — the older pattern of
 // awaiting fromAssetId and then calling addImageryProvider only catches the
 // provider-creation error, not per-tile fetch failures.
 layer = ImageryLayer.fromProviderAsync(
 IonImageryProvider.fromAssetId(2, {}),
 );
 this.viewer.imageryLayers.add(layer);
 } catch (error) {
 this.log('WARN', `[globe] Ion imagery provider construction threw synchronously: ${String(error)} — falling back to ArcGIS`);
 this.addFallbackImagery('sync-throw');
 return;
 }

 // Style the layer
 layer.alpha = 1;
 layer.brightness = 1.1;
 layer.contrast = 1.15;
 layer.saturation = 1.2;

 // Track whether ready arrived within the sentinel window
 let providerReady = false;

 // layer.errorEvent fires if the async provider creation fails (e.g. Ion
 // returns 401/403 on the asset-metadata request).
 layer.errorEvent.addEventListener((err: Error) => {
 this.log('WARN', `[globe] Ion imagery layer errorEvent: ${err?.message ?? String(err)} — falling back to ArcGIS`);
 this.addFallbackImagery('layer-error-event');
 });

 // layer.readyEvent fires once the provider is live. At that point we can
 // subscribe to per-tile errors on the underlying imageryProvider.
 layer.readyEvent.addEventListener((provider: ImageryProvider) => {
 providerReady = true;
 this.log('INFO', '[globe] Ion imagery layer ready — subscribing to tile error events');

 provider.errorEvent.addEventListener((tileErr: unknown) => {
 const msg = tileErr instanceof Error ? tileErr.message : String(tileErr);
 this.log('WARN', `[globe] Ion tile load error: ${msg} — switching to ArcGIS fallback`);
 this.addFallbackImagery('tile-error');
 });
 });

 // Sentinel: if the layer isn't ready within 5 s, assume the token is bad
 // or the network is blocking Ion, and switch to ArcGIS.
 await new Promise<void>((resolve) => {
 const timer = setTimeout(() => {
 if (!providerReady) {
 this.log('WARN', '[globe] Ion imagery layer not ready after 5 s — falling back to ArcGIS');
 this.addFallbackImagery('sentinel-timeout');
 }
 resolve();
 }, 5000);

 layer.readyEvent.addEventListener(() => {
 clearTimeout(timer);
 resolve();
 });
 });
  }

  private addFallbackImagery(reason: string): void {
 if (!this.viewer) return;

 // Only add the fallback once per session — tile errors fire per-tile, so
 // without this guard we'd stack dozens of ArcGIS layers.
 if (this.fallbackAdded) return;
 this.fallbackAdded = true;

 this.log('INFO', `[globe] adding ArcGIS fallback imagery (reason=${reason})`);

 const satImagery = new UrlTemplateImageryProvider({
 url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
 credit: 'Esri, Maxar, Earthstar Geographics',
 maximumLevel: 19,
 });
 const layer = this.viewer.imageryLayers.addImageryProvider(satImagery);
 layer.alpha = 1;
 layer.brightness = 1.1;
 layer.contrast = 1.1;
 layer.saturation = 1.15;
  }

  private addLabelsOverlay(): void {
 if (!this.viewer) return;
 // Esri World Boundaries and Places — white text with dark outlines on a transparent
 // background, purpose-built as a satellite imagery overlay. No brightness hacks needed.
 // Note: Esri tile URL uses {z}/{y}/{x} (row/col order), not {z}/{x}/{y}.
 const labelsImagery = new UrlTemplateImageryProvider({
 url: 'https://server.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
 credit: 'Esri',
 maximumLevel: 13,
 minimumLevel: 1,
 });
 const labelsLayer = this.viewer.imageryLayers.addImageryProvider(labelsImagery);
 labelsLayer.alpha = 1;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
 void import('@/services/log-bridge').then((m) => {
 m.logToDesktop(level, msg);
 });
  }

  get scene(): Scene | undefined {
 return this.viewer?.scene;
  }

  get camera(): Camera | undefined {
 return this.viewer?.camera;
  }

  get cesiumViewer(): Viewer | undefined {
 return this.viewer ?? undefined;
  }

  get canvas(): HTMLCanvasElement | undefined {
 return this.viewer?.canvas;
  }

  setLightingEnabled(enabled: boolean): void {
 const scene = this.viewer?.scene;
 if (!scene) return;
 scene.globe.enableLighting = enabled;
 scene.globe.dynamicAtmosphereLighting = enabled;
 scene.globe.dynamicAtmosphereLightingFromSun = enabled;
 if (scene.skyAtmosphere) {
 scene.skyAtmosphere.brightnessShift = enabled ? 0 : -0.05;
 }
 scene.requestRender();
  }

  getLightingEnabled(): boolean {
 return this.viewer?.scene.globe.enableLighting ?? false;
  }

  destroy(): void {
 this.resizeObserver?.disconnect();
 this.resizeObserver = null;
 if (this.viewer && !this.viewer.isDestroyed()) {
 this.viewer.destroy();
 }
 this.viewer = null;
  }
}
