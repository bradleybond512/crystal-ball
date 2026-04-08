# God's Eye Mode — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cesium + Three.js hybrid globe shell with God's Eye full-viewport mode, entry/exit transitions, and the rendering bridge that all subsequent features depend on.

**Architecture:** CesiumJS renders the base globe (WGS84, terrain, imagery). Three.js overlays custom effects into the same canvas via camera matrix sync. An HTML HUD layer composites on top. God's Eye mode is a full-viewport takeover activated by keyboard shortcut or button, with the existing dashboard preserved underneath.

**Tech Stack:** CesiumJS, Three.js 0.183, TypeScript (strict, `@/` path alias), node:test for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-04-05-gods-eye-3d-globe-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/components/GodsEyeView.ts` | Top-level orchestrator — lifecycle, entry/exit transitions, manages CesiumGlobe + ThreeOverlay + GlobeHUD |
| `src/components/CesiumGlobe.ts` | Cesium.Viewer wrapper — imagery provider, camera, terrain, resize handling, cleanup |
| `src/components/ThreeOverlay.ts` | Three.js scene synced to Cesium — post-processing pipeline (bloom, vignette), placeholder for future layers |
| `src/components/GlobeHUD.ts` | HTML overlay — status readouts, layer toggle bar, camera position display |
| `src/services/cesium-three-bridge.ts` | Pure functions: ECEF to Three.js coordinate transforms, Cesium to Three.js camera matrix extraction |
| `src/config/gods-eye-layers.ts` | Layer registry — boolean flags + metadata for all God's Eye layers (satellites, terrain, imagery, RF, etc.) |
| `tests/cesium-three-bridge.test.mts` | Unit tests for coordinate transforms + camera matrix extraction |
| `tests/gods-eye-layers.test.mts` | Unit tests for layer registry |
| `e2e/gods-eye-mode.spec.ts` | E2E: God's Eye button appears, mode activates, ESC exits |

---

### Task 1: Install Cesium + Configure Vite

**Files:**

- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Install cesium**

Run:

```bash
cd ~/developer/crystalball
npm install cesium@^1.125.0
```

- [ ] **Step 2: Configure Vite for Cesium static assets**

Cesium requires its Workers, Assets, and Widgets served as static files. Read `vite.config.ts` to find the existing plugin array, then add the Cesium copy plugin.

Add to `vite.config.ts` — import at top:

```typescript
import { viteStaticCopy } from 'vite-plugin-static-copy';
```

Add to the `plugins` array:

```typescript
viteStaticCopy({
  targets: [
 { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium' },
 { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium' },
 { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium' },
 { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium' },
  ],
}),
```

Install the copy plugin:

```bash
npm install -D vite-plugin-static-copy
```

- [ ] **Step 3: Add Cesium global config**

Create a Cesium initialization snippet. Add to `src/config/cesium-init.ts`:

```typescript
import { Ion, buildModuleUrl } from 'cesium';

export function initCesium(ionToken?: string): void {
  (window as Record<string, unknown>)['CESIUM_BASE_URL'] = '/cesium';
  buildModuleUrl.setBaseUrl('/cesium/');
  if (ionToken) {
 Ion.defaultAccessToken = ionToken;
  }
}
```

- [ ] **Step 4: Verify build works**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors (Cesium types should resolve).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/config/cesium-init.ts
git commit -m "$(cat <<'EOF'
build: add CesiumJS dependency and Vite static asset config

Foundation for God's Eye 3D globe mode. Configures Cesium
worker/asset copying and ion token initialization.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Coordinate Bridge — cesium-three-bridge.ts (TDD)

**Files:**

- Create: `src/services/cesium-three-bridge.ts`
- Create: `tests/cesium-three-bridge.test.mts`

- [ ] **Step 1: Write failing tests for coordinate transforms**

Create `tests/cesium-three-bridge.test.mts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('cesium-three-bridge', () => {
  describe('cartesian3ToThreeJS', () => {
 it('converts ECEF origin to Three.js origin', async () => {
 const { cartesian3ToThreeJS } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const result = cartesian3ToThreeJS({ x: 0, y: 0, z: 0 });
 assert.deepStrictEqual(result, { x: 0, y: 0, z: 0 });
 });

 it('swaps Y and Z axes (ECEF Z-up to Three.js Y-up)', async () => {
 const { cartesian3ToThreeJS } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 // ECEF: X=east, Y=north, Z=up -> Three.js: X=right, Y=up, Z=out
 const result = cartesian3ToThreeJS({ x: 1000, y: 2000, z: 3000 });
 assert.equal(result.x, 1000);
 assert.equal(result.y, 3000); // ECEF Z becomes Three.js Y
 assert.equal(result.z, -2000); // ECEF Y becomes Three.js -Z
 });
  });

  describe('threeJSToCartesian3', () => {
 it('round-trips through both transforms', async () => {
 const { cartesian3ToThreeJS, threeJSToCartesian3 } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const original = { x: 6378137, y: 0, z: 6356752 };
 const threePos = cartesian3ToThreeJS(original);
 const back = threeJSToCartesian3(threePos);
 assert.equal(back.x, original.x);
 assert.equal(back.y, original.y);
 assert.equal(back.z, original.z);
 });
  });

  describe('metersToSceneUnits', () => {
 it('scales Earth radius to manageable scene units', async () => {
 const { metersToSceneUnits, SCENE_SCALE } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const earthRadius = 6378137;
 const scaled = metersToSceneUnits(earthRadius);
 assert.equal(scaled, earthRadius * SCENE_SCALE);
 // Should be a reasonable Three.js scene size (not millions of units)
 assert(scaled < 10000, `Scaled value ${scaled} should be < 10000`);
 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx tsx --test tests/cesium-three-bridge.test.mts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cesium-three-bridge.ts**

Create `src/services/cesium-three-bridge.ts`:

```typescript
/**
 * Coordinate transforms between Cesium ECEF and Three.js scene space.
 * Cesium uses ECEF (Z-up), Three.js uses Y-up with -Z forward.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Scale factor: meters to Three.js scene units. Keeps the globe ~1 unit radius. */
export const SCENE_SCALE = 1 / 6378137;

/** Convert ECEF (Z-up) to Three.js (Y-up). */
export function cartesian3ToThreeJS(ecef: Vec3): Vec3 {
  return {
 x: ecef.x,
 y: ecef.z, // ECEF Z (up) -> Three.js Y (up)
 z: -ecef.y, // ECEF Y (north) -> Three.js -Z (into screen)
  };
}

/** Convert Three.js (Y-up) back to ECEF (Z-up). */
export function threeJSToCartesian3(three: Vec3): Vec3 {
  return {
 x: three.x,
 y: -three.z, // Three.js -Z -> ECEF Y
 z: three.y, // Three.js Y -> ECEF Z
  };
}

/** Scale meters to Three.js scene units. */
export function metersToSceneUnits(meters: number): number {
  return meters * SCENE_SCALE;
}

/** Scale Three.js scene units back to meters. */
export function sceneUnitsToMeters(units: number): number {
  return units / SCENE_SCALE;
}

/**
 * Extract a 4x4 model-view-projection matrix from a Cesium camera
 * for use by Three.js. Call each frame in the render loop.
 */
export function extractCameraMatrices(
  viewMatrix: ArrayLike<number>,
  projectionMatrix: ArrayLike<number>,
): { view: Float64Array; projection: Float64Array } {
  return {
 view: Float64Array.from(viewMatrix),
 projection: Float64Array.from(projectionMatrix),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx tsx --test tests/cesium-three-bridge.test.mts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/cesium-three-bridge.ts tests/cesium-three-bridge.test.mts
git commit -m "$(cat <<'EOF'
feat: add Cesium/Three.js coordinate bridge with tests

Pure functions for ECEF/Y-up transforms, scene scaling, and
camera matrix extraction. Foundation for the hybrid renderer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: God's Eye Layer Registry

**Files:**

- Create: `src/config/gods-eye-layers.ts`
- Create: `tests/gods-eye-layers.test.mts`

- [ ] **Step 1: Write failing test**

Create `tests/gods-eye-layers.test.mts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('gods-eye-layers', () => {
  it('exports default layer state with all layers disabled', async () => {
 const { DEFAULT_GODS_EYE_LAYERS } = await import(
 '../src/config/gods-eye-layers.ts'
 );
 const allDisabled = Object.values(DEFAULT_GODS_EYE_LAYERS).every(
 (layer) => !layer.enabled,
 );
 assert.equal(
 allDisabled,
 true,
 'All layers should default to disabled — user opts in',
 );
  });

  it('every layer has required metadata fields', async () => {
 const { DEFAULT_GODS_EYE_LAYERS } = await import(
 '../src/config/gods-eye-layers.ts'
 );
 for (const [key, layer] of Object.entries(DEFAULT_GODS_EYE_LAYERS)) {
 assert.ok(layer.name, `${key} missing name`);
 assert.ok(layer.category, `${key} missing category`);
 assert.equal(typeof layer.enabled, 'boolean', `${key} enabled not boolean`);
 }
  });

  it('has layers for all 8 planned features', async () => {
 const { DEFAULT_GODS_EYE_LAYERS } = await import(
 '../src/config/gods-eye-layers.ts'
 );
 const keys = Object.keys(DEFAULT_GODS_EYE_LAYERS);
 const required = [
 'satellites',
 'terrain',
 'buildings',
 'imagery',
 'hud',
 'entityGraph',
 'rfCoverage',
 'timeline',
 ];
 for (const r of required) {
 assert.ok(keys.includes(r), `Missing required layer: ${r}`);
 }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test tests/gods-eye-layers.test.mts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layer registry**

Create `src/config/gods-eye-layers.ts`:

```typescript
export interface GodsEyeLayerConfig {
  name: string;
  category: 'spatial' | 'intelligence' | 'aesthetic' | 'analytical';
  enabled: boolean;
  description: string;
}

export type GodsEyeLayers = Record<string, GodsEyeLayerConfig>;

export const DEFAULT_GODS_EYE_LAYERS: GodsEyeLayers = {
  satellites: {
 name: 'Satellite Tracking',
 category: 'spatial',
 enabled: false,
 description: 'Real-time satellite positions and orbital paths',
  },
  terrain: {
 name: '3D Terrain',
 category: 'spatial',
 enabled: false,
 description: 'Cesium World Terrain with elevation',
  },
  buildings: {
 name: '3D Buildings',
 category: 'spatial',
 enabled: false,
 description: 'Google Photorealistic 3D Tiles / OSM Buildings',
  },
  imagery: {
 name: 'Satellite Imagery',
 category: 'spatial',
 enabled: false,
 description: 'Sentinel-2, Landsat, MODIS overlays',
  },
  hud: {
 name: 'HUD Overlay',
 category: 'aesthetic',
 enabled: false,
 description: 'Threat brackets, status readouts, compass',
  },
  entityGraph: {
 name: 'Entity Graph',
 category: 'analytical',
 enabled: false,
 description: '3D force-directed entity link analysis',
  },
  rfCoverage: {
 name: 'RF/SIGINT',
 category: 'intelligence',
 enabled: false,
 description: 'GPS jamming domes, radar cones, EW hotspots',
  },
  timeline: {
 name: 'Timeline',
 category: 'analytical',
 enabled: false,
 description: 'Temporal playback with event scrubbing',
  },
  atmosphere: {
 name: 'Atmosphere Glow',
 category: 'aesthetic',
 enabled: false,
 description: 'Atmospheric scatter shader on globe edge',
  },
  scanlines: {
 name: 'Scanlines',
 category: 'aesthetic',
 enabled: false,
 description: 'Subtle CRT/tactical display effect',
  },
  bloom: {
 name: 'Bloom',
 category: 'aesthetic',
 enabled: false,
 description: 'Glow effect on bright elements',
  },
};

const STORAGE_KEY = 'crystalball-gods-eye-layers';

export function loadGodsEyeLayers(): GodsEyeLayers {
  try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (!stored) return structuredClone(DEFAULT_GODS_EYE_LAYERS);
 const parsed = JSON.parse(stored) as Record<string, boolean>;
 const layers = structuredClone(DEFAULT_GODS_EYE_LAYERS);
 for (const [key, enabled] of Object.entries(parsed)) {
 if (key in layers) {
 layers[key]!.enabled = enabled;
 }
 }
 return layers;
  } catch {
 return structuredClone(DEFAULT_GODS_EYE_LAYERS);
  }
}

export function saveGodsEyeLayers(layers: GodsEyeLayers): void {
  const simplified: Record<string, boolean> = {};
  for (const [key, config] of Object.entries(layers)) {
 simplified[key] = config.enabled;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(simplified));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx tsx --test tests/gods-eye-layers.test.mts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/gods-eye-layers.ts tests/gods-eye-layers.test.mts
git commit -m "$(cat <<'EOF'
feat: add God's Eye layer registry with persistence

Config-driven layer system for all God's Eye features (satellites,
terrain, buildings, imagery, HUD, entity graph, RF, timeline).
Persists to localStorage.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CesiumGlobe Component

**Files:**

- Create: `src/components/CesiumGlobe.ts`

- [ ] **Step 1: Create CesiumGlobe.ts**

Create `src/components/CesiumGlobe.ts`:

```typescript
import {
  Viewer,
  IonImageryProvider,
  SceneMode,
  Color,
  type Scene,
  type Camera,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { initCesium } from '@/config/cesium-init';

export interface CesiumGlobeOptions {
  container: HTMLElement;
  ionToken?: string;
}

export class CesiumGlobe {
  private viewer: Viewer | null = null;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly options: CesiumGlobeOptions) {
 this.container = options.container;
  }

  async initialize(): Promise<void> {
 initCesium(this.options.ionToken);

 const cesiumContainer = document.createElement('div');
 cesiumContainer.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;';
 this.container.appendChild(cesiumContainer);

 this.viewer = new Viewer(cesiumContainer, {
 sceneMode: SceneMode.SCENE3D,
 animation: false,
 baseLayerPicker: false,
 fullscreenButton: false,
 geocoder: false,
 homeButton: false,
 infoBox: false,
 navigationHelpButton: false,
 sceneModePicker: false,
 selectionIndicator: false,
 timeline: false,
 shadows: false,
 skyBox: false,
 skyAtmosphere: false,
 contextOptions: {
 webgl: { alpha: true },
 },
 });

 // Dark background
 this.viewer.scene.backgroundColor = Color.fromCssColorString('#0a0a0f');
 this.viewer.scene.globe.baseColor = Color.fromCssColorString('#0d1b2a');

 // Remove default imagery and add dark-styled layer
 this.viewer.imageryLayers.removeAll();
 const darkImagery = await IonImageryProvider.fromAssetId(3845, {});
 this.viewer.imageryLayers.addImageryProvider(darkImagery);

 // Globe settings
 this.viewer.scene.globe.enableLighting = false;
 this.viewer.scene.globe.showGroundAtmosphere = false;
 this.viewer.scene.fog.enabled = false;
 this.viewer.scene.screenSpaceCameraController.enableTilt = true;
 this.viewer.scene.screenSpaceCameraController.enableLook = true;

 // Handle resize
 this.resizeObserver = new ResizeObserver(() => {
 this.viewer?.resize();
 });
 this.resizeObserver.observe(this.container);
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

  destroy(): void {
 this.resizeObserver?.disconnect();
 this.resizeObserver = null;
 if (this.viewer && !this.viewer.isDestroyed()) {
 this.viewer.destroy();
 }
 this.viewer = null;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CesiumGlobe.ts
git commit -m "$(cat <<'EOF'
feat: add CesiumGlobe component — dark-styled 3D globe viewer

Wraps Cesium.Viewer with dark imagery, disabled UI chrome,
resize handling, and cleanup. Base layer for God's Eye mode.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ThreeOverlay Component

**Files:**

- Create: `src/components/ThreeOverlay.ts`

- [ ] **Step 1: Create ThreeOverlay.ts**

Create `src/components/ThreeOverlay.ts`:

```typescript
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface ThreeOverlayOptions {
  container: HTMLElement;
  enableBloom?: boolean;
}

export class ThreeOverlay {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private container: HTMLElement;

  constructor(private readonly options: ThreeOverlayOptions) {
 this.container = options.container;
 this.scene = new THREE.Scene();
 this.camera = new THREE.PerspectiveCamera(60, 1, 0.001, 100);
  }

  initialize(): void {
 const canvas = document.createElement('canvas');
 canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;width:100%;height:100%;';
 this.container.appendChild(canvas);

 this.renderer = new THREE.WebGLRenderer({
 canvas,
 alpha: true,
 antialias: true,
 powerPreference: 'high-performance',
 });
 this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
 this.renderer.setClearColor(0x000000, 0);
 this.updateSize();

 if (this.options.enableBloom) {
 this.setupPostProcessing();
 }
  }

  private setupPostProcessing(): void {
 if (!this.renderer) return;
 const size = this.renderer.getSize(new THREE.Vector2());
 this.composer = new EffectComposer(this.renderer);
 this.composer.addPass(new RenderPass(this.scene, this.camera));

 const bloomPass = new UnrealBloomPass(size, 0.8, 0.4, 0.85);
 this.composer.addPass(bloomPass);
  }

  /**
 * Sync Three.js camera to match Cesium's view.
 * Called each frame from GodsEyeView render loop.
 */
  syncCamera(
 viewMatrix: ArrayLike<number>,
 _projectionMatrix: ArrayLike<number>,
 fov: number,
 aspect: number,
 near: number,
 far: number,
  ): void {
 this.camera.fov = fov;
 this.camera.aspect = aspect;
 this.camera.near = near;
 this.camera.far = far;
 this.camera.updateProjectionMatrix();

 // Apply Cesium's inverse view matrix to Three.js camera
 // Cesium uses column-major, Three.js Matrix4.set() takes row-major
 const m = viewMatrix;
 this.camera.matrixAutoUpdate = false;
 this.camera.matrix.set(
 Number(m[0]), Number(m[4]), Number(m[8]), Number(m[12]),
 Number(m[1]), Number(m[5]), Number(m[9]), Number(m[13]),
 Number(m[2]), Number(m[6]), Number(m[10]), Number(m[14]),
 Number(m[3]), Number(m[7]), Number(m[11]), Number(m[15]),
 );
 this.camera.matrixWorldNeedsUpdate = true;
  }

  get threeScene(): THREE.Scene {
 return this.scene;
  }

  get threeCamera(): THREE.PerspectiveCamera {
 return this.camera;
  }

  render(): void {
 if (this.composer) {
 this.composer.render();
 } else {
 this.renderer?.render(this.scene, this.camera);
 }
  }

  updateSize(): void {
 if (!this.renderer) return;
 const { clientWidth, clientHeight } = this.container;
 this.renderer.setSize(clientWidth, clientHeight, false);
 this.camera.aspect = clientWidth / clientHeight;
 this.camera.updateProjectionMatrix();
 this.composer?.setSize(clientWidth, clientHeight);
  }

  addToScene(object: THREE.Object3D): void {
 this.scene.add(object);
  }

  removeFromScene(object: THREE.Object3D): void {
 this.scene.remove(object);
  }

  destroy(): void {
 this.scene.traverse((object) => {
 const mesh = object as THREE.Mesh;
 if (mesh.geometry) mesh.geometry.dispose();
 const material = mesh.material;
 if (Array.isArray(material)) {
 material.forEach((m: THREE.Material) => m.dispose());
 } else if (material) {
 (material as THREE.Material).dispose();
 }
 });
 this.composer?.dispose();
 this.renderer?.dispose();
 this.renderer = null;
 this.composer = null;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ThreeOverlay.ts
git commit -m "$(cat <<'EOF'
feat: add ThreeOverlay — Three.js scene synced to Cesium camera

Transparent WebGL canvas overlaying Cesium. Handles bloom
post-processing, camera sync via matrix injection, and cleanup.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: GlobeHUD Component

**Files:**

- Create: `src/components/GlobeHUD.ts`

- [ ] **Step 1: Create GlobeHUD.ts**

The HUD uses DOM manipulation via safe methods (textContent, classList) rather than string-based HTML injection. Create `src/components/GlobeHUD.ts`:

```typescript
import { loadGodsEyeLayers, saveGodsEyeLayers, type GodsEyeLayers } from '@/config/gods-eye-layers';

export interface HUDState {
  cameraAltitude: number;
  cameraLat: number;
  cameraLon: number;
  satelliteCount: number;
  activeHotspots: number;
  threatLevel: string;
}

export class GlobeHUD {
  private element: HTMLElement;
  private layers: GodsEyeLayers;
  private onLayerToggle: ((layerKey: string, enabled: boolean) => void) | null = null;
  private onExit: (() => void) | null = null;

  // Cached DOM references for efficient updates
  private threatEl: HTMLElement | null = null;
  private hotspotsEl: HTMLElement | null = null;
  private satsEl: HTMLElement | null = null;
  private altEl: HTMLElement | null = null;
  private coordsEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
 this.layers = loadGodsEyeLayers();
 this.element = document.createElement('div');
 this.element.className = 'gods-eye-hud';
 this.element.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;';
 container.appendChild(this.element);
 this.buildDOM();
  }

  private buildDOM(): void {
 // Top-left: threat info
 const topLeft = this.createPositioned('top:12px;left:12px;pointer-events:auto;');
 const card = this.createCard();
 this.appendLabel(card, 'THREAT LEVEL');
 this.threatEl = this.appendValue(card, 'NOMINAL', 'ge-hud-threat');
 this.hotspotsEl = this.appendStat(card, 'Hotspots: ', '0');
 this.satsEl = this.appendStat(card, 'Satellites: ', '0');
 topLeft.appendChild(card);
 this.element.appendChild(topLeft);

 // Top-right: exit button
 const topRight = this.createPositioned('top:12px;right:12px;pointer-events:auto;');
 const exitBtn = document.createElement('button');
 exitBtn.className = 'ge-exit-btn';
 exitBtn.id = 'geExitBtn';
 exitBtn.title = 'Exit God\'s Eye (ESC)';
 exitBtn.textContent = 'EXIT';
 exitBtn.addEventListener('click', () => this.onExit?.());
 topRight.appendChild(exitBtn);
 this.element.appendChild(topRight);

 // Bottom-center: layer bar
 const bottomCenter = this.createPositioned(
 'bottom:12px;left:50%;transform:translateX(-50%);pointer-events:auto;',
 );
 const layerBar = document.createElement('div');
 layerBar.className = 'ge-layer-bar';
 layerBar.id = 'geLayerBar';
 this.buildLayerButtons(layerBar);
 bottomCenter.appendChild(layerBar);
 this.element.appendChild(bottomCenter);

 // Bottom-right: camera readout
 const bottomRight = this.createPositioned('bottom:12px;right:12px;');
 const camCard = this.createCard();
 camCard.classList.add('ge-hud-camera');
 this.altEl = document.createElement('span');
 this.altEl.textContent = '0 km';
 this.coordsEl = document.createElement('span');
 this.coordsEl.textContent = '0.00\u00B0, 0.00\u00B0';
 camCard.appendChild(this.altEl);
 camCard.appendChild(document.createTextNode(' \u00B7 '));
 camCard.appendChild(this.coordsEl);
 bottomRight.appendChild(camCard);
 this.element.appendChild(bottomRight);
  }

  private createPositioned(style: string): HTMLElement {
 const el = document.createElement('div');
 el.style.cssText = `position:absolute;${style}`;
 return el;
  }

  private createCard(): HTMLElement {
 const card = document.createElement('div');
 card.className = 'ge-hud-card';
 return card;
  }

  private appendLabel(parent: HTMLElement, text: string): void {
 const el = document.createElement('div');
 el.className = 'ge-hud-label';
 el.textContent = text;
 parent.appendChild(el);
  }

  private appendValue(parent: HTMLElement, text: string, className: string): HTMLElement {
 const el = document.createElement('div');
 el.className = `ge-hud-value ${className}`;
 el.textContent = text;
 parent.appendChild(el);
 return el;
  }

  private appendStat(parent: HTMLElement, label: string, value: string): HTMLElement {
 const el = document.createElement('div');
 el.className = 'ge-hud-stat';
 const labelSpan = document.createElement('span');
 labelSpan.textContent = label;
 const valueSpan = document.createElement('span');
 valueSpan.textContent = value;
 el.appendChild(labelSpan);
 el.appendChild(valueSpan);
 parent.appendChild(el);
 return valueSpan;
  }

  private buildLayerButtons(bar: HTMLElement): void {
 for (const [key, config] of Object.entries(this.layers)) {
 if (config.category === 'aesthetic') continue;
 const btn = document.createElement('button');
 btn.className = `ge-layer-btn${config.enabled ? ' ge-layer-active' : ''}`;
 btn.dataset['layer'] = key;
 btn.title = config.description;
 btn.textContent = config.name;
 btn.addEventListener('click', () => {
 const layer = this.layers[key];
 if (!layer) return;
 layer.enabled = !layer.enabled;
 btn.classList.toggle('ge-layer-active', layer.enabled);
 saveGodsEyeLayers(this.layers);
 this.onLayerToggle?.(key, layer.enabled);
 });
 bar.appendChild(btn);
 }
  }

  updateState(state: Partial<HUDState>): void {
 if (state.threatLevel !== undefined && this.threatEl) {
 this.threatEl.textContent = state.threatLevel;
 }
 if (state.activeHotspots !== undefined && this.hotspotsEl) {
 this.hotspotsEl.textContent = String(state.activeHotspots);
 }
 if (state.satelliteCount !== undefined && this.satsEl) {
 this.satsEl.textContent = String(state.satelliteCount);
 }
 if (state.cameraAltitude !== undefined && this.altEl) {
 const km = Math.round(state.cameraAltitude / 1000);
 this.altEl.textContent = km > 1000 ? `${(km / 1000).toFixed(1)}k km` : `${km} km`;
 }
 if (state.cameraLat !== undefined && state.cameraLon !== undefined && this.coordsEl) {
 this.coordsEl.textContent = `${state.cameraLat.toFixed(2)}\u00B0, ${state.cameraLon.toFixed(2)}\u00B0`;
 }
  }

  setOnLayerToggle(cb: (layerKey: string, enabled: boolean) => void): void {
 this.onLayerToggle = cb;
  }

  setOnExit(cb: () => void): void {
 this.onExit = cb;
  }

  destroy(): void {
 this.element.remove();
 this.onLayerToggle = null;
 this.onExit = null;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GlobeHUD.ts
git commit -m "$(cat <<'EOF'
feat: add GlobeHUD — floating status cards and layer toggles

HTML overlay for God's Eye mode using safe DOM construction.
Threat level readout, camera coords, satellite count, layer
toggle bar, and exit button.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: God's Eye CSS

**Files:**

- Create: `src/styles/gods-eye.css`
- Modify: `src/styles/main.css` (import)

- [ ] **Step 1: Create gods-eye.css**

Create `src/styles/gods-eye.css`:

```css
/* God's Eye Mode — full-viewport 3D globe */

.gods-eye-container {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #0a0a0f;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.6s ease;
}

.gods-eye-container.gods-eye-active {
  opacity: 1;
  pointer-events: auto;
}

/* HUD cards */
.ge-hud-card {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: rgba(96, 165, 250, 0.9);
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 6px;
  padding: 8px 10px;
  line-height: 1.6;
}

.ge-hud-label {
  font-size: 9px;
  letter-spacing: 1.5px;
  color: rgba(96, 165, 250, 0.6);
  margin-bottom: 2px;
}

.ge-hud-value {
  font-size: 16px;
  font-weight: 700;
}

.ge-hud-threat {
  color: #34d399;
}

.ge-hud-stat {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

/* Exit button */
.ge-exit-btn {
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.ge-exit-btn:hover {
  color: #fff;
  border-color: rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.15);
}

/* Layer toggle bar */
.ge-layer-bar {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(59, 130, 246, 0.15);
  border-radius: 8px;
  padding: 4px;
}

.ge-layer-btn {
  font-family: 'SF Mono', monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.ge-layer-btn:hover {
  color: rgba(255, 255, 255, 0.6);
}

.ge-layer-btn.ge-layer-active {
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.3);
  background: rgba(96, 165, 250, 0.08);
}

/* Camera readout */
.ge-hud-camera {
  font-size: 10px;
  padding: 4px 8px;
  color: rgba(255, 255, 255, 0.4);
}
```

- [ ] **Step 2: Import in main.css**

Read `src/styles/main.css` to find the existing import section, then add at the end of any existing `@import` block:

```css
@import './gods-eye.css';
```

- [ ] **Step 3: Verify build**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/gods-eye.css src/styles/main.css
git commit -m "$(cat <<'EOF'
feat: add God's Eye HUD styles — dark tactical theme

Monospace fonts, glassmorphism cards, layer toggle bar,
threat readouts. Matches existing dark theme palette.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: GodsEyeView Orchestrator

**Files:**

- Create: `src/components/GodsEyeView.ts`

- [ ] **Step 1: Create GodsEyeView.ts**

Create `src/components/GodsEyeView.ts`:

```typescript
import { CesiumGlobe } from '@/components/CesiumGlobe';
import { ThreeOverlay } from '@/components/ThreeOverlay';
import { GlobeHUD, type HUDState } from '@/components/GlobeHUD';
import { Cartographic, Math as CesiumMath, Cartesian3 } from 'cesium';

export class GodsEyeView {
  private container: HTMLElement;
  private globe: CesiumGlobe | null = null;
  private threeOverlay: ThreeOverlay | null = null;
  private hud: GlobeHUD | null = null;
  private active = false;
  private renderLoopId: number | null = null;
  private ionToken: string | undefined;

  constructor(ionToken?: string) {
 this.ionToken = ionToken;
 this.container = document.createElement('div');
 this.container.className = 'gods-eye-container';
 document.body.appendChild(this.container);
  }

  get isActive(): boolean {
 return this.active;
  }

  async enter(centerLon?: number, centerLat?: number): Promise<void> {
 if (this.active) return;
 this.active = true;

 // Initialize Cesium globe
 this.globe = new CesiumGlobe({
 container: this.container,
 ionToken: this.ionToken,
 });
 await this.globe.initialize();

 // Initialize Three.js overlay
 this.threeOverlay = new ThreeOverlay({
 container: this.container,
 enableBloom: true,
 });
 this.threeOverlay.initialize();

 // Initialize HUD
 this.hud = new GlobeHUD(this.container);
 this.hud.setOnExit(() => this.exit());
 this.hud.setOnLayerToggle((key, enabled) => {
 this.handleLayerToggle(key, enabled);
 });

 // Fly to initial position or default orbital view
 const lon = centerLon ?? 0;
 const lat = centerLat ?? 20;
 this.globe.cesiumViewer?.camera.flyTo({
 destination: Cartesian3.fromDegrees(lon, lat, 20_000_000),
 duration: 2,
 });

 // Start render loop
 this.startRenderLoop();

 // Animate in
 requestAnimationFrame(() => {
 this.container.classList.add('gods-eye-active');
 });
  }

  exit(): void {
 if (!this.active) return;
 this.active = false;

 // Animate out
 this.container.classList.remove('gods-eye-active');

 // Cleanup after animation completes
 setTimeout(() => {
 this.stopRenderLoop();
 this.hud?.destroy();
 this.hud = null;
 this.threeOverlay?.destroy();
 this.threeOverlay = null;
 this.globe?.destroy();
 this.globe = null;
 }, 600);
  }

  toggle(centerLon?: number, centerLat?: number): void {
 if (this.active) {
 this.exit();
 } else {
 void this.enter(centerLon, centerLat);
 }
  }

  private startRenderLoop(): void {
 const loop = (): void => {
 if (!this.active) return;
 this.syncThreeToCamera();
 this.threeOverlay?.render();
 this.updateHUDState();
 this.renderLoopId = requestAnimationFrame(loop);
 };
 this.renderLoopId = requestAnimationFrame(loop);
  }

  private stopRenderLoop(): void {
 if (this.renderLoopId !== null) {
 cancelAnimationFrame(this.renderLoopId);
 this.renderLoopId = null;
 }
  }

  private syncThreeToCamera(): void {
 const camera = this.globe?.camera;
 if (!camera || !this.threeOverlay) return;

 const frustum = camera.frustum as {
 fov?: number;
 aspectRatio?: number;
 near?: number;
 far?: number;
 };
 this.threeOverlay.syncCamera(
 camera.viewMatrix,
 camera.frustum.projectionMatrix,
 CesiumMath.toDegrees(frustum.fov ?? 1.0),
 frustum.aspectRatio ?? 1.0,
 frustum.near ?? 0.1,
 frustum.far ?? 500000000,
 );
  }

  private updateHUDState(): void {
 const camera = this.globe?.camera;
 if (!camera || !this.hud) return;

 try {
 const carto = Cartographic.fromCartesian(camera.position);
 this.hud.updateState({
 cameraAltitude: carto.height,
 cameraLat: CesiumMath.toDegrees(carto.latitude),
 cameraLon: CesiumMath.toDegrees(carto.longitude),
 });
 } catch {
 // Camera position may not be convertible during transitions
 }
  }

  private handleLayerToggle(_key: string, _enabled: boolean): void {
 // Phase 2 layers will register handlers here
  }

  destroy(): void {
 this.exit();
 this.container.remove();
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GodsEyeView.ts
git commit -m "$(cat <<'EOF'
feat: add GodsEyeView orchestrator — full God's Eye lifecycle

Manages Cesium globe + Three.js overlay + HUD lifecycle.
Entry/exit transitions, render loop with camera sync,
altitude/coords HUD updates. Layer toggle hooks for Phase 2.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire God's Eye Into App

**Files:**

- Modify: `src/App.ts`
- Modify: `src/app/event-handlers.ts`
- Modify: `src/app/panel-layout.ts`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Read current files to find exact insertion points**

Read these files to locate the exact lines:

- `src/App.ts` lines 55-80 — manager property declarations and initialization
- `src/app/event-handlers.ts` lines 100-120, 325-340 — existing keyboard shortcuts (TV Mode, Ghost Mode)
- `src/app/panel-layout.ts` lines 460-475 — sidebar footer buttons (Ghost Mode button area)
- `src-tauri/src/main.rs` — find `SUPPORTED_SECRET_KEYS` array

- [ ] **Step 2: Add GodsEyeView to App.ts**

Add import at the top of `src/App.ts`:

```typescript
import { GodsEyeView } from '@/components/GodsEyeView';
```

Add property alongside other manager declarations (near line 63-70):

```typescript
private godsEyeView: GodsEyeView | null = null;
```

Add a public method to the App class:

```typescript
toggleGodsEye(): void {
  if (!this.godsEyeView) {
 const ionToken = this.getSecretSync?.('CESIUM_ION_TOKEN') ?? undefined;
 this.godsEyeView = new GodsEyeView(ionToken);
  }
  this.godsEyeView.toggle();
}
```

**Note:** Check how `getSecretSync` or equivalent secret retrieval works in App.ts. The method name may differ — search for existing secret access patterns like how `THREATFOX_API_KEY` is retrieved.

- [ ] **Step 3: Add keyboard shortcut in event-handlers.ts**

Find the keyboard handler function (around the Ghost Mode shortcut, line 331-336). Add nearby:

```typescript
// G key (no modifiers, not in text input) — toggle God's Eye mode
if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
  const target = e.target as HTMLElement;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
  e.preventDefault();
  this.app.toggleGodsEye();
}
```

**Note:** Check how `this.app` is referenced — it may be `this.context`, `this.appRef`, or passed via constructor. Match the existing pattern used by Ghost Mode toggle.

- [ ] **Step 4: Add sidebar button in panel-layout.ts**

Find the Ghost Mode button section (around line 465). Add a God's Eye button above it using the same button pattern:

```typescript
const godsEyeBtn = document.createElement('button');
godsEyeBtn.className = 'mac-ghost-mode-btn';
godsEyeBtn.id = 'godsEyeBtn';
godsEyeBtn.title = 'God\'s Eye \u2014 3D Globe Mode (G)';
godsEyeBtn.textContent = 'God\'s Eye';
```

Wire up the click handler using the same delegation pattern as Ghost Mode:

```typescript
godsEyeBtn.addEventListener('click', () => {
  this.app.toggleGodsEye();
});
```

Insert it into the sidebar footer before the Ghost Mode button.

**Note:** Read the actual DOM construction pattern — it may use template strings or `createElement`. Match whichever pattern exists.

- [ ] **Step 5: Add CESIUM_ION_TOKEN to secret keys**

In `src-tauri/src/main.rs`, find `SUPPORTED_SECRET_KEYS` and add `"CESIUM_ION_TOKEN"` to the array.

In `src/services/settings-constants.ts` or `runtime-config.ts`, add `CESIUM_ION_TOKEN` to the API key settings so it appears in the Settings modal. Follow the existing pattern for how other keys like `THREATFOX_API_KEY` are defined.

- [ ] **Step 6: Verify typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.ts src/app/event-handlers.ts src/app/panel-layout.ts src-tauri/src/main.rs
git commit -m "$(cat <<'EOF'
feat: wire God's Eye mode into app — sidebar button + G shortcut

God's Eye toggles via sidebar button or G key. Lazy-initializes
CesiumJS on first activation. Cesium ion token added to keychain.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: E2E Test — God's Eye Mode Toggle

**Files:**

- Create: `e2e/gods-eye-mode.spec.ts`

- [ ] **Step 1: Create e2e test**

Create `e2e/gods-eye-mode.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('God\'s Eye Mode', () => {
  test.beforeEach(async ({ page }) => {
 await page.goto('/');
 await page.waitForSelector('.mac-sidebar, .header', { timeout: 10000 });
  });

  test('God\'s Eye button exists in sidebar', async ({ page }) => {
 const btn = page.locator('#godsEyeBtn');
 await expect(btn).toBeVisible();
  });

  test('activates on button click and deactivates on ESC', async ({ page }) => {
 await page.click('#godsEyeBtn');

 const container = page.locator('.gods-eye-container');
 await expect(container).toHaveClass(/gods-eye-active/, { timeout: 5000 });

 await expect(page.locator('#geExitBtn')).toBeVisible();

 await page.keyboard.press('Escape');
 await expect(container).not.toHaveClass(/gods-eye-active/, { timeout: 2000 });
  });

  test('activates on G key press', async ({ page }) => {
 await page.keyboard.press('g');

 const container = page.locator('.gods-eye-container');
 await expect(container).toHaveClass(/gods-eye-active/, { timeout: 5000 });
  });

  test('HUD displays camera information', async ({ page }) => {
 await page.click('#godsEyeBtn');
 await page.waitForSelector('.gods-eye-active', { timeout: 5000 });

 await expect(page.locator('.ge-hud-threat')).toBeVisible();
 await expect(page.locator('.ge-hud-camera')).toBeVisible();
 await expect(page.locator('#geLayerBar')).toBeVisible();
  });

  test('layer toggle bar has expected layers', async ({ page }) => {
 await page.click('#godsEyeBtn');
 await page.waitForSelector('.gods-eye-active', { timeout: 5000 });

 const layerButtons = page.locator('.ge-layer-btn');
 const count = await layerButtons.count();
 expect(count).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run e2e test**

Run:

```bash
npx cross-env VITE_VARIANT=full playwright test e2e/gods-eye-mode.spec.ts
```

Expected: Tests should pass if the dev server is running. If WebGL is unavailable in headless mode, the God's Eye container will still mount (DOM-level tests pass).

- [ ] **Step 3: Commit**

```bash
git add e2e/gods-eye-mode.spec.ts
git commit -m "$(cat <<'EOF'
test: add God's Eye e2e tests — toggle, HUD, layer bar

Verifies sidebar button, G key shortcut, ESC exit, HUD
visibility, and layer toggle bar presence.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Build + Typecheck Validation

- [ ] **Step 1: Run full typecheck**

Run:

```bash
npm run typecheck:all
```

Expected: Zero errors.

- [ ] **Step 2: Run data tests**

Run:

```bash
npm run test:data
```

Expected: All existing tests still pass (plus new bridge + layer tests).

- [ ] **Step 3: Run production build**

Run:

```bash
npm run desktop:build:full
```

Expected: Build completes. Cesium assets copied to output directory.

- [ ] **Step 4: If any failures, fix and commit**

Fix typecheck or build issues. Commit each fix separately with descriptive messages.

---

## Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Install Cesium + Vite config | 3 modified, 1 created | build verification |
| 2 | Coordinate bridge (TDD) | 1 created | 4 unit tests |
| 3 | Layer registry (TDD) | 1 created | 3 unit tests |
| 4 | CesiumGlobe component | 1 created | typecheck |
| 5 | ThreeOverlay component | 1 created | typecheck |
| 6 | GlobeHUD component | 1 created | typecheck |
| 7 | God's Eye CSS | 1 created, 1 modified | build verification |
| 8 | GodsEyeView orchestrator | 1 created | typecheck |
| 9 | Wire into App (button, shortcut, secret) | 4 modified | typecheck |
| 10 | E2E tests | 1 created | 5 e2e tests |
| 11 | Full build validation | none | build + typecheck + data tests |

**Next plans after this foundation ships:**

- `2026-04-05-gods-eye-visual-track.md` — Satellites, Terrain, Imagery, HUD
- `2026-04-05-gods-eye-analytical-track.md` — Entity Graph, RF/SIGINT, Timeline
