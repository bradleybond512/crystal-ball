# God's Vision Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 enhancements to the God's Vision globe view across four independent parallel tracks.

**Architecture:** Each track is self-contained. Tracks A–C only touch frontend TypeScript files. Track D adds one new sidecar endpoint (satellites) and two new frontend components. All tracks follow the existing GodsVisionView ↔ GlobeHUD callback pattern: GodsVisionView owns data/camera logic, GlobeHUD owns DOM.

**Tech Stack:** Cesium 1.x, TypeScript, Web Audio API (Track D), satellite.js (Track D), Nominatim geocoding API (Track B), existing `camera.flyTo()` / `Cartesian3.fromDegrees()` patterns.

**Branch naming:** `claude/gods-vision-<track>` per track, one PR per track.

---

## Key File Map

| File | Role |
|------|------|
| `src/components/GlobeHUD.ts` | DOM for HUD overlay; owns all button/ticker/alert rendering |
| `src/components/GodsVisionView.ts` | Orchestrator; wires HUD callbacks to camera/data |
| `src/components/GlobeDataManager.ts` | Entity layer data; `getTopAlerts()`, `getNearestHotspot()` |
| `src/components/gods-vision/FlyMode/FlyModeController.ts` | Sub-mode registry; `F` key cycles modes |
| `src/styles/gods-vision.css` | God's Vision component styles |
| `src/styles/macos-native.css` | Time machine + misc overlay styles |

---

## Track A — HUD Enhancements

### Task A1: Add lat/lon to TopAlert

**Files:**
- Modify: `src/components/GlobeDataManager.ts` (around line 1599)

- [ ] **Step 1: Update `getTopAlerts` to include position**

Replace the existing `getTopAlerts` return type and implementation:

```typescript
getTopAlerts(limit = 5): { name: string; type: string; severity: number; lat?: number; lon?: number }[] {
  const results: { name: string; type: string; severity: number; lat?: number; lon?: number }[] = [];
  const SEVERITY: Record<string, number> = {
    airstrikes: 10, conflicts: 8, cyber: 6, earthquakes: 5,
    gdacs: 7, cyclones: 6, fires: 4, gpsJamming: 5,
  };
  for (const [layerKey, layerData] of this.layers) {
    const sev = SEVERITY[layerKey] ?? 3;
    const entities = [...layerData.source.entities.values];
    for (const entity of entities) {
      if (!entity.name) continue;
      let lat: number | undefined;
      let lon: number | undefined;
      const pos = entity.position?.getValue(this.viewer.clock.currentTime);
      if (pos) {
        const carto = Ellipsoid.WGS84.cartesianToCartographic(pos);
        lat = CesiumMath.toDegrees(carto.latitude);
        lon = CesiumMath.toDegrees(carto.longitude);
      }
      results.push({ name: entity.name, type: layerKey, severity: sev, lat, lon });
    }
  }
  results.sort((a, b) => b.severity - a.severity);
  return results.slice(0, limit);
}
```

Add imports at the top of the file if not already present:
```typescript
import { ..., Ellipsoid, Math as CesiumMath } from 'cesium';
```

- [ ] **Step 2: Update HUDState type in GlobeHUD.ts**

In `GlobeHUD.ts`, update the `topAlerts` type:
```typescript
topAlerts?: { name: string; type: string; severity: number; lat?: number; lon?: number }[];
```

- [ ] **Step 3: Typecheck**
```bash
npm run typecheck:all
```
Expected: 0 errors

- [ ] **Step 4: Commit**
```bash
git add src/components/GlobeDataManager.ts src/components/GlobeHUD.ts
git commit -m "feat(A1): add lat/lon to TopAlert for fly-to support

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task A2: Alert fly-to (click alert list item → fly there + lock follow)

**Files:**
- Modify: `src/components/GlobeHUD.ts` (renderAlertList around line 461)
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Add `onAlertClick` callback to GlobeHUD**

In `GlobeHUD.ts` private fields section (around line 80):
```typescript
private onAlertClick: ((lat: number, lon: number, name: string) => void) | null = null;
```

Add public setter after `setOnBuildingsToggle`:
```typescript
setOnAlertClick(cb: (lat: number, lon: number, name: string) => void): void {
  this.onAlertClick = cb;
}
```

- [ ] **Step 2: Make alert list items clickable**

In `renderAlertList` (find the method around line 461), update each row element:
```typescript
private renderAlertList(
  el: HTMLElement,
  alerts: { name: string; type: string; severity: number; lat?: number; lon?: number }[],
): void {
  el.replaceChildren();
  for (const a of alerts.slice(0, 5)) {
    const row = this.el('div', 'ge-hud-alert-row');
    const hasPos = a.lat !== undefined && a.lon !== undefined;
    if (hasPos) {
      row.classList.add('ge-hud-alert-clickable');
      row.title = 'Click to fly to this event';
      row.addEventListener('click', () => {
        if (a.lat !== undefined && a.lon !== undefined) {
          this.onAlertClick?.(a.lat, a.lon, a.name);
        }
      });
    }
    const typeBadge = this.el('span', `ge-hud-alert-type ge-alert-type-${a.type}`, a.type.toUpperCase());
    const nameEl = this.el('span', 'ge-hud-alert-name', a.name);
    row.append(typeBadge, nameEl);
    el.append(row);
  }
}
```

- [ ] **Step 3: Wire in GodsVisionView**

In `GodsVisionView.ts`, after `this.hud.setOnBuildingsToggle(...)`:
```typescript
this.hud.setOnAlertClick((lat, lon, _name) => {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat, 300_000),
    duration: 2,
  });
  // Stop auto-follow so the camera doesn't immediately snap away
  this.autoFollow?.stop();
  this.hud?.updateAutoFollowState(null, 0, 0);
});
```

- [ ] **Step 4: Add CSS for clickable rows**

In `src/styles/gods-vision.css`, after `.ge-hud-alert-row`:
```css
.ge-hud-alert-row.ge-hud-alert-clickable {
  cursor: pointer;
  transition: background 0.15s;
}
.ge-hud-alert-row.ge-hud-alert-clickable:hover {
  background: rgba(var(--ge-blue), 0.12);
  border-radius: 4px;
}
```

- [ ] **Step 5: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/GlobeHUD.ts src/components/GodsVisionView.ts src/styles/gods-vision.css
git commit -m "feat(A2): click alert list row to fly to event

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task A3: Screenshot / export button

**Files:**
- Modify: `src/components/GlobeHUD.ts`
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Add screenshot callback and button to GlobeHUD**

In GlobeHUD private fields:
```typescript
private onScreenshot: (() => void) | null = null;
private screenshotBtn: HTMLButtonElement | null = null;
```

Add setter:
```typescript
setOnScreenshot(cb: () => void): void {
  this.onScreenshot = cb;
}
```

Add `buildScreenshotButton` method after `buildBuildingsButton`:
```typescript
private buildScreenshotButton(bar: HTMLElement): void {
  const btn = document.createElement('button');
  btn.className = 'ge-layer-btn';
  btn.title = 'Save screenshot to Downloads';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'ge-layer-name';
  nameSpan.textContent = 'SNAP';
  btn.append(nameSpan);
  btn.addEventListener('click', () => this.onScreenshot?.());
  this.screenshotBtn = btn;
  bar.append(btn);
}
```

Call it in the bar assembly (after `buildBuildingsButton`):
```typescript
this.buildScreenshotButton(layerBar);
```

- [ ] **Step 2: Implement screenshot capture in GodsVisionView**

In GodsVisionView, add a `takeScreenshot()` method:
```typescript
private async takeScreenshot(): Promise<void> {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;

  // Force Cesium to render one frame synchronously
  viewer.render();
  const cesiumCanvas = viewer.canvas;

  // Composite: Cesium canvas + HUD overlay
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
```

Wire in after `setOnBuildingsToggle`:
```typescript
this.hud.setOnScreenshot(() => { void this.takeScreenshot(); });
```

- [ ] **Step 3: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/GlobeHUD.ts src/components/GodsVisionView.ts
git commit -m "feat(A3): SNAP button saves globe screenshot to Downloads

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task A4: Threat trend sparkline

**Files:**
- Modify: `src/components/GlobeHUD.ts`

A 30-sample circular buffer of hotspot counts drawn as a tiny `<canvas>` sparkline inside the threat card.

- [ ] **Step 1: Add sparkline canvas and buffer to GlobeHUD**

In private fields:
```typescript
private sparklineCanvas: HTMLCanvasElement | null = null;
private sparklineBuffer: number[] = [];
private readonly SPARKLINE_MAX = 30;
```

In `buildDOM`, after `this.threatEl = ...`:
```typescript
const sparkCanvas = document.createElement('canvas');
sparkCanvas.className = 'ge-hud-sparkline';
sparkCanvas.width = 120;
sparkCanvas.height = 24;
card.append(sparkCanvas);
this.sparklineCanvas = sparkCanvas;
```

- [ ] **Step 2: Update sparkline when hotspot count changes**

In `updateState`, after updating `this.hotspotsEl`:
```typescript
if (state.activeHotspots !== undefined) {
  this.sparklineBuffer.push(state.activeHotspots);
  if (this.sparklineBuffer.length > this.SPARKLINE_MAX) {
    this.sparklineBuffer.shift();
  }
  this.drawSparkline();
}
```

Add `drawSparkline()` method:
```typescript
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
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
  ctx.stroke();
  // Trend indicator: fill under the line
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(96,165,250,0.08)';
  ctx.fill();
}
```

- [ ] **Step 3: Add CSS**

In `src/styles/gods-vision.css`:
```css
.ge-hud-sparkline {
  display: block;
  margin-top: 4px;
  border-radius: 4px;
  opacity: 0.85;
}
```

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/GlobeHUD.ts src/styles/gods-vision.css
git commit -m "feat(A4): threat trend sparkline in HUD threat card

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Track B — Camera & Navigation

### Task B1: Saved camera bookmarks (keys 1–5)

**Files:**
- Create: `src/services/camera-bookmarks.ts`
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Create `camera-bookmarks.ts`**

```typescript
// src/services/camera-bookmarks.ts
const STORAGE_KEY = 'crystalball-camera-bookmarks';

export interface CameraBookmark {
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  pitch: number;
  label?: string;
}

export function loadBookmarks(): Record<string, CameraBookmark> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, CameraBookmark>;
  } catch {
    return {};
  }
}

export function saveBookmark(slot: string, bm: CameraBookmark): void {
  const all = loadBookmarks();
  all[slot] = bm;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearBookmark(slot: string): void {
  const all = loadBookmarks();
  delete all[slot];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
```

- [ ] **Step 2: Wire bookmarks into GodsVisionView keyboard handler**

Find `attachKeyboardHandlers` in GodsVisionView.ts. Add after the existing keyboard cases:

```typescript
import { loadBookmarks, saveBookmark } from '@/services/camera-bookmarks';
import { Math as CesiumMath } from 'cesium';
// (CesiumMath may already be imported)
```

Inside the key handler:
```typescript
// Bookmark save: Cmd+1..5 saves current view
if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;
  const cam = viewer.camera;
  const carto = cam.positionCartographic;
  saveBookmark(e.key, {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    alt: carto.height,
    heading: CesiumMath.toDegrees(cam.heading),
    pitch: CesiumMath.toDegrees(cam.pitch),
  });
  e.preventDefault();
  return;
}

// Bookmark recall: 1..5 (no modifier) flies to saved view
if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '5') {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;
  const bm = loadBookmarks()[e.key];
  if (!bm) return;
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(bm.lon, bm.lat, bm.alt),
    orientation: {
      heading: CesiumMath.toRadians(bm.heading),
      pitch: CesiumMath.toRadians(bm.pitch),
      roll: 0,
    },
    duration: 2,
  });
  e.preventDefault();
  return;
}
```

- [ ] **Step 3: Typecheck and commit**
```bash
npm run typecheck:all
git add src/services/camera-bookmarks.ts src/components/GodsVisionView.ts
git commit -m "feat(B1): camera bookmarks — Cmd+1-5 save, 1-5 recall

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B2: Geocode search bar

**Files:**
- Create: `src/components/gods-vision/GlobeSearch.ts`
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/styles/gods-vision.css`

- [ ] **Step 1: Create `GlobeSearch.ts`**

```typescript
// src/components/gods-vision/GlobeSearch.ts
import type { Viewer } from 'cesium';
import { Cartesian3 } from 'cesium';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export class GlobeSearch {
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private results: HTMLDivElement | null = null;
  private debounceId: number | null = null;

  constructor(private viewer: Viewer, private container: HTMLElement) {}

  mount(): void {
    const root = document.createElement('div');
    root.className = 'ge-search-root';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ge-search-input';
    input.placeholder = 'Search location…';
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; this.clearResults(); }
    });

    const results = document.createElement('div');
    results.className = 'ge-search-results';

    root.append(input, results);
    this.container.append(root);
    this.root = root;
    this.input = input;
    this.results = results;
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }

  private onInput(): void {
    if (this.debounceId != null) clearTimeout(this.debounceId);
    const q = this.input?.value.trim() ?? '';
    if (q.length < 2) { this.clearResults(); return; }
    this.debounceId = window.setTimeout(() => void this.search(q), 400);
  }

  private async search(q: string): Promise<void> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json() as NominatimResult[];
      this.renderResults(data);
    } catch {
      this.clearResults();
    }
  }

  private renderResults(data: NominatimResult[]): void {
    if (!this.results) return;
    this.results.replaceChildren();
    for (const r of data) {
      const item = document.createElement('button');
      item.className = 'ge-search-result-item';
      item.textContent = r.display_name;
      item.addEventListener('click', () => {
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        this.viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, 300_000),
          duration: 2,
        });
        if (this.input) this.input.value = '';
        this.clearResults();
      });
      this.results.append(item);
    }
  }

  private clearResults(): void {
    this.results?.replaceChildren();
  }
}
```

- [ ] **Step 2: Mount in GodsVisionView**

Add import:
```typescript
import { GlobeSearch } from '@/components/gods-vision/GlobeSearch';
```

Add private field:
```typescript
private globeSearch: GlobeSearch | null = null;
```

After `this.hud = new GlobeHUD(...)`:
```typescript
const viewer = this.globe?.cesiumViewer;
if (viewer) {
  this.globeSearch = new GlobeSearch(viewer, this.container);
  this.globeSearch.mount();
  this.cleanupHandlers.push(() => { this.globeSearch?.destroy(); this.globeSearch = null; });
}
```

- [ ] **Step 3: Add CSS**

In `src/styles/gods-vision.css`:
```css
.ge-search-root {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: 280px;
  pointer-events: auto;
}
.ge-search-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--ge-glass);
  backdrop-filter: blur(var(--ge-blur));
  -webkit-backdrop-filter: blur(var(--ge-blur));
  border: 1px solid var(--ge-glass-border);
  border-radius: 10px;
  color: rgba(var(--ge-white), 0.9);
  font-family: var(--ge-font);
  font-size: 12px;
  padding: 7px 12px;
  outline: none;
}
.ge-search-input::placeholder { color: rgba(var(--ge-white), 0.35); }
.ge-search-results {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ge-search-result-item {
  background: var(--ge-glass);
  backdrop-filter: blur(var(--ge-blur));
  -webkit-backdrop-filter: blur(var(--ge-blur));
  border: 1px solid var(--ge-glass-border);
  border-radius: 8px;
  color: rgba(var(--ge-white), 0.85);
  font-family: var(--ge-font);
  font-size: 11px;
  padding: 6px 10px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
.ge-search-result-item:hover { background: rgba(var(--ge-blue), 0.15); }
```

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobeSearch.ts src/components/GodsVisionView.ts src/styles/gods-vision.css
git commit -m "feat(B2): geocode search bar — type city name, fly there

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B3: Orbit mode in Fly Mode

**Files:**
- Create: `src/components/gods-vision/FlyMode/OrbitMode.ts`
- Modify: `src/components/gods-vision/FlyMode/FlyModeController.ts`
- Modify: `src/components/gods-vision/FlyMode/flyModeKeybinds.ts`

- [ ] **Step 1: Create `OrbitMode.ts`**

```typescript
// src/components/gods-vision/FlyMode/OrbitMode.ts
import { Cartesian3, Math as CesiumMath, type Viewer } from 'cesium';

const DEFAULT_ALTITUDE_M = 50_000;
const ORBIT_SPEED_RAD_PER_S = 0.15; // ~one full orbit in ~42s

export class OrbitMode {
  private rafId: number | null = null;
  private orbitAngle = 0;
  private target: Cartesian3 | null = null;
  private orbitRadius = DEFAULT_ALTITUDE_M;
  private lastTime = 0;

  constructor(private viewer: Viewer) {}

  activate(targetPos?: Cartesian3): void {
    const cam = this.viewer.camera;
    // Use provided target or ground point below camera
    if (targetPos) {
      this.target = targetPos;
    } else {
      const carto = cam.positionCartographic;
      this.target = Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    }
    this.orbitRadius = Cartesian3.distance(cam.positionWC, this.target);
    this.orbitAngle = cam.heading;
    this.lastTime = performance.now();
    this.loop();
  }

  deactivate(): void {
    if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.target = null;
  }

  private loop(): void {
    this.rafId = requestAnimationFrame((now) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      if (!this.target) return;
      this.orbitAngle += ORBIT_SPEED_RAD_PER_S * dt;
      const target = this.target;
      const normal = Cartesian3.normalize(target, new Cartesian3());
      // Build position on the orbit circle
      const up = new Cartesian3(0, 0, 1);
      const east = Cartesian3.normalize(Cartesian3.cross(up, normal, new Cartesian3()), new Cartesian3());
      const north = Cartesian3.cross(normal, east, new Cartesian3());
      const camPos = Cartesian3.add(
        Cartesian3.add(
          Cartesian3.multiplyByScalar(east, Math.sin(this.orbitAngle) * this.orbitRadius, new Cartesian3()),
          Cartesian3.multiplyByScalar(north, Math.cos(this.orbitAngle) * this.orbitRadius, new Cartesian3()),
          new Cartesian3(),
        ),
        Cartesian3.multiplyByScalar(normal, this.orbitRadius * 0.4, new Cartesian3()),
        new Cartesian3(),
      );
      this.viewer.camera.lookAt(target, camPos);
      this.loop();
    });
  }

  update(_dt: number): void { /* driven by RAF */ }
}
```

- [ ] **Step 2: Register in FlyModeController**

Open `FlyModeController.ts`. Find where sub-modes are registered (the switch/case for mode names or the mode map). Add orbit:

```typescript
import { OrbitMode } from './OrbitMode';
```

In the mode map/registration (follow existing pattern for FreeFlyCamera, CinematicPath, etc.):
```typescript
private orbitMode: OrbitMode | null = null;
```

In `activateSubMode` (or equivalent), add case:
```typescript
case 'orbit':
  this.orbitMode = new OrbitMode(this.viewer);
  this.orbitMode.activate();
  break;
```

In `deactivateSubMode`:
```typescript
this.orbitMode?.deactivate();
this.orbitMode = null;
```

- [ ] **Step 3: Add keybind**

In `flyModeKeybinds.ts`, add orbit to the sub-mode list following existing pattern. Check the file for the exact constant name and add `['O', 'Orbit']` alongside the existing sub-mode hints.

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/FlyMode/OrbitMode.ts src/components/gods-vision/FlyMode/FlyModeController.ts src/components/gods-vision/FlyMode/flyModeKeybinds.ts
git commit -m "feat(B3): orbit sub-mode — smooth camera circle around current target

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task B4: Named waypoints (fly a saved route)

**Files:**
- Create: `src/services/globe-waypoints.ts`
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Create `globe-waypoints.ts`**

```typescript
// src/services/globe-waypoints.ts
import type { CameraBookmark } from './camera-bookmarks';

const STORAGE_KEY = 'crystalball-waypoints';

export interface Waypoint extends CameraBookmark {
  id: string;
  name: string;
}

export function loadWaypoints(): Waypoint[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Waypoint[];
  } catch { return []; }
}

export function saveWaypoint(wp: Waypoint): void {
  const all = loadWaypoints().filter(w => w.id !== wp.id);
  all.push(wp);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteWaypoint(id: string): void {
  const all = loadWaypoints().filter(w => w.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export class WaypointTour {
  private waypoints: Waypoint[];
  private idx = 0;
  private running = false;
  private timeoutId: number | null = null;

  constructor(private viewer: import('cesium').Viewer, private dwellMs = 5000) {
    this.waypoints = loadWaypoints();
  }

  start(): void {
    if (this.waypoints.length === 0) return;
    this.running = true;
    this.flyNext();
  }

  stop(): void {
    this.running = false;
    if (this.timeoutId != null) { clearTimeout(this.timeoutId); this.timeoutId = null; }
  }

  private flyNext(): void {
    if (!this.running || this.waypoints.length === 0) return;
    const wp = this.waypoints[this.idx % this.waypoints.length];
    const { Cartesian3, Math: CesiumMath } = await import('cesium');
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt),
      orientation: {
        heading: CesiumMath.toRadians(wp.heading),
        pitch: CesiumMath.toRadians(wp.pitch),
        roll: 0,
      },
      duration: 3,
      complete: () => {
        this.timeoutId = window.setTimeout(() => {
          this.idx++;
          this.flyNext();
        }, this.dwellMs);
      },
    });
  }
}
```

Note: The dynamic import in `flyNext` won't compile well. Use static import instead:

```typescript
// At top of file, add:
import { Cartesian3, Math as CesiumMath } from 'cesium';
// Remove the await import('cesium') call, use directly.
```

- [ ] **Step 2: Add `W` key shortcut to save current view as waypoint**

In `GodsVisionView.ts` keyboard handler:
```typescript
import { saveWaypoint, WaypointTour } from '@/services/globe-waypoints';
```

Private field:
```typescript
private waypointTour: WaypointTour | null = null;
```

In keyboard handler, add case:
```typescript
// W = save waypoint at current position
if (e.key === 'w' && !e.metaKey && !e.ctrlKey) {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;
  const cam = viewer.camera;
  const carto = cam.positionCartographic;
  const wps = (await import('@/services/globe-waypoints')).loadWaypoints();
  saveWaypoint({
    id: String(Date.now()),
    name: `Waypoint ${wps.length + 1}`,
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    alt: carto.height,
    heading: CesiumMath.toDegrees(cam.heading),
    pitch: CesiumMath.toDegrees(cam.pitch),
  });
  e.preventDefault();
  return;
}
// Shift+W = start/stop waypoint tour
if (e.key === 'W' && e.shiftKey) {
  const viewer = this.globe?.cesiumViewer;
  if (!viewer) return;
  if (this.waypointTour) {
    this.waypointTour.stop();
    this.waypointTour = null;
  } else {
    this.waypointTour = new WaypointTour(viewer);
    this.waypointTour.start();
  }
  e.preventDefault();
  return;
}
```

Note: avoid dynamic imports in the keyboard handler — use static imports at the file top instead.

- [ ] **Step 3: Typecheck and commit**
```bash
npm run typecheck:all
git add src/services/globe-waypoints.ts src/components/GodsVisionView.ts
git commit -m "feat(B4): named waypoints — W saves, Shift+W tours all waypoints

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Track C — Visual Effects

### Task C1: Pulse/ring animations on recent events

**Files:**
- Create: `src/components/gods-vision/GlobePulse.ts`
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Create `GlobePulse.ts`**

Adds a growing/fading `EllipseGraphics` ring around events fired in the last 30 minutes.

```typescript
// src/components/gods-vision/GlobePulse.ts
import {
  Cartesian3, Color, CustomDataSource, CallbackProperty,
  EllipseGraphics, ConstantPositionProperty, Entity,
  type Viewer, JulianDate,
} from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

const PULSE_DURATION_MS = 3000;
const PULSE_MAX_RADIUS_M = 80_000;
const FRESH_WINDOW_MS = 30 * 60 * 1000; // 30 min

interface PulseEntry { entityId: string; startMs: number; cesiumEntity: Entity }

export class GlobePulse {
  private source: CustomDataSource;
  private pulses: PulseEntry[] = [];
  private rafId: number | null = null;

  constructor(private viewer: Viewer, private dataManager: GlobeDataManager) {
    this.source = new CustomDataSource('pulses');
  }

  mount(): void {
    void this.viewer.dataSources.add(this.source);
    this.tick();
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    void this.viewer.dataSources.remove(this.source, true);
  }

  private tick(): void {
    this.rafId = requestAnimationFrame(() => {
      this.refreshPulses();
      this.tick();
    });
  }

  private refreshPulses(): void {
    const now = Date.now();
    const freshAlerts = this.dataManager.getTopAlerts(20).filter(
      a => a.lat !== undefined && a.lon !== undefined,
    );

    // Add new pulses for alerts not yet tracked
    const tracked = new Set(this.pulses.map(p => p.entityId));
    for (const alert of freshAlerts) {
      const id = `${alert.type}:${alert.name}`;
      if (tracked.has(id)) continue;
      if (alert.lat === undefined || alert.lon === undefined) continue;
      const pos = Cartesian3.fromDegrees(alert.lon, alert.lat, 0);
      const startMs = now;
      const pulse: PulseEntry = {
        entityId: id,
        startMs,
        cesiumEntity: this.source.entities.add(new Entity({
          position: new ConstantPositionProperty(pos),
          ellipse: new EllipseGraphics({
            semiMajorAxis: new CallbackProperty(() => {
              const t = (Date.now() - startMs) % PULSE_DURATION_MS;
              return (t / PULSE_DURATION_MS) * PULSE_MAX_RADIUS_M;
            }, false),
            semiMinorAxis: new CallbackProperty(() => {
              const t = (Date.now() - startMs) % PULSE_DURATION_MS;
              return (t / PULSE_DURATION_MS) * PULSE_MAX_RADIUS_M;
            }, false),
            material: new CallbackProperty(() => {
              const t = (Date.now() - startMs) % PULSE_DURATION_MS;
              const alpha = 0.5 * (1 - t / PULSE_DURATION_MS);
              return Color.fromCssColorString('#60a5fa').withAlpha(alpha);
            }, false) as unknown as import('cesium').MaterialProperty,
            outline: false,
            height: 0,
            heightReference: 1, // CLAMP_TO_GROUND
          }),
        })),
      };
      this.pulses.push(pulse);
    }

    // Remove pulses that are no longer in the fresh window
    const freshIds = new Set(freshAlerts.map(a => `${a.type}:${a.name}`));
    this.pulses = this.pulses.filter(p => {
      if (!freshIds.has(p.entityId)) {
        this.source.entities.remove(p.cesiumEntity);
        return false;
      }
      return true;
    });
  }
}
```

- [ ] **Step 2: Mount in GodsVisionView**

```typescript
import { GlobePulse } from '@/components/gods-vision/GlobePulse';
```

Private field:
```typescript
private globePulse: GlobePulse | null = null;
```

After `this.dataManager.initialize()`:
```typescript
this.globePulse = new GlobePulse(viewer, this.dataManager);
this.globePulse.mount();
this.cleanupHandlers.push(() => { this.globePulse?.destroy(); this.globePulse = null; });
```

- [ ] **Step 3: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobePulse.ts src/components/GodsVisionView.ts
git commit -m "feat(C1): pulse ring animations on recent events

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task C2: Arc lines between related events

**Files:**
- Create: `src/components/gods-vision/GlobeArcs.ts`
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeHUD.ts` (toggle button)

Arcs connect high-severity conflict events to nearest disaster event, showing geopolitical proximity.

- [ ] **Step 1: Create `GlobeArcs.ts`**

```typescript
// src/components/gods-vision/GlobeArcs.ts
import {
  Cartesian3, Color, CustomDataSource, Entity,
  PolylineGraphics, ArcType, ConstantProperty, type Viewer,
} from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class GlobeArcs {
  private source: CustomDataSource;
  private enabled = false;
  private refreshId: number | null = null;

  constructor(private viewer: Viewer, private dataManager: GlobeDataManager) {
    this.source = new CustomDataSource('arcs');
  }

  mount(): void { void this.viewer.dataSources.add(this.source); }
  destroy(): void {
    if (this.refreshId != null) clearInterval(this.refreshId);
    void this.viewer.dataSources.remove(this.source, true);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.source.show = on;
    if (on) {
      this.rebuild();
      this.refreshId = window.setInterval(() => this.rebuild(), 30_000);
    } else {
      if (this.refreshId != null) { clearInterval(this.refreshId); this.refreshId = null; }
      this.source.entities.removeAll();
    }
  }

  private rebuild(): void {
    this.source.entities.removeAll();
    const alerts = this.dataManager.getTopAlerts(40)
      .filter(a => a.lat !== undefined && a.lon !== undefined);
    const conflicts = alerts.filter(a => ['conflicts', 'airstrikes'].includes(a.type));
    const disasters = alerts.filter(a => ['earthquakes', 'gdacs', 'cyclones'].includes(a.type));

    for (const c of conflicts.slice(0, 10)) {
      if (c.lat === undefined || c.lon === undefined) continue;
      // Find nearest disaster within 2000km
      let nearest: (typeof disasters)[0] | null = null;
      let nearestDist = 2000;
      for (const d of disasters) {
        if (d.lat === undefined || d.lon === undefined) continue;
        const dist = haversineKm(c.lat, c.lon, d.lat, d.lon);
        if (dist < nearestDist) { nearest = d; nearestDist = dist; }
      }
      if (!nearest || nearest.lat === undefined || nearest.lon === undefined) continue;
      this.source.entities.add(new Entity({
        polyline: new PolylineGraphics({
          positions: new ConstantProperty([
            Cartesian3.fromDegrees(c.lon, c.lat, 10_000),
            Cartesian3.fromDegrees(nearest.lon, nearest.lat, 10_000),
          ]),
          width: new ConstantProperty(1.5),
          material: Color.fromCssColorString('#f87171').withAlpha(0.5),
          arcType: ArcType.GEODESIC,
          clampToGround: false,
        }),
      }));
    }
  }
}
```

- [ ] **Step 2: Mount in GodsVisionView and wire toggle**

```typescript
import { GlobeArcs } from '@/components/gods-vision/GlobeArcs';
```

Private field:
```typescript
private globeArcs: GlobeArcs | null = null;
```

After dataManager init:
```typescript
this.globeArcs = new GlobeArcs(viewer, this.dataManager);
this.globeArcs.mount();
this.cleanupHandlers.push(() => { this.globeArcs?.destroy(); this.globeArcs = null; });
```

After `setOnBuildingsToggle`:
```typescript
this.hud.setOnArcsToggle((enabled) => this.globeArcs?.setEnabled(enabled));
```

- [ ] **Step 3: Add `setOnArcsToggle` + ARCS button to GlobeHUD**

In GlobeHUD follow the exact same pattern as `buildBuildingsButton`:
- Private field: `private onArcsToggle: ((enabled: boolean) => void) | null = null; private arcsBtn: HTMLButtonElement | null = null; private arcsEnabled = false;`
- Setter: `setOnArcsToggle(cb: (enabled: boolean) => void): void { this.onArcsToggle = cb; }`
- `setArcsEnabled(enabled: boolean): void { this.arcsEnabled = enabled; this.arcsBtn?.classList.toggle('ge-layer-active', enabled); }`
- `buildArcsButton(bar)` with label `ARCS`, calls `setArcsEnabled` + `onArcsToggle`
- Call `buildArcsButton` in the bar assembly

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobeArcs.ts src/components/GodsVisionView.ts src/components/GlobeHUD.ts
git commit -m "feat(C2): arc lines connecting conflicts to nearby disasters

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task C3: Density heatmap toggle

**Files:**
- Create: `src/components/gods-vision/GlobeHeatmap.ts`
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeHUD.ts`

Renders a translucent canvas overlay (2D kernel density) on top of the Cesium globe.

- [ ] **Step 1: Create `GlobeHeatmap.ts`**

```typescript
// src/components/gods-vision/GlobeHeatmap.ts
import { Math as CesiumMath, type Viewer, SceneTransforms } from 'cesium';
import type { GlobeDataManager } from '@/components/GlobeDataManager';

export class GlobeHeatmap {
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private enabled = false;

  constructor(private viewer: Viewer, private container: HTMLElement, private dataManager: GlobeDataManager) {}

  mount(): void {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.3s;';
    canvas.width = this.container.clientWidth;
    canvas.height = this.container.clientHeight;
    this.container.append(canvas);
    this.canvas = canvas;

    new ResizeObserver(() => {
      if (!this.canvas) return;
      this.canvas.width = this.container.clientWidth;
      this.canvas.height = this.container.clientHeight;
    }).observe(this.container);
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.canvas?.remove();
    this.canvas = null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.canvas) this.canvas.style.opacity = on ? '1' : '0';
    if (on) this.loop();
    else if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private loop(): void {
    if (!this.enabled) return;
    this.rafId = requestAnimationFrame(() => { this.draw(); this.loop(); });
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const alerts = this.dataManager.getTopAlerts(100).filter(
      a => a.lat !== undefined && a.lon !== undefined,
    );

    for (const alert of alerts) {
      if (alert.lat === undefined || alert.lon === undefined) continue;
      const { Cartesian3 } = await import('cesium'); // use static import at top instead
      const worldPos = Cartesian3.fromDegrees(alert.lon, alert.lat, 0);
      const screenPos = SceneTransforms.worldToWindowCoordinates(
        this.viewer.scene, worldPos,
      );
      if (!screenPos) continue;
      const r = alert.severity * 6;
      const grad = ctx.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, r);
      grad.addColorStop(0, `rgba(248,113,113,0.35)`);
      grad.addColorStop(1, `rgba(248,113,113,0)`);
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
}
```

Note: replace `await import('cesium')` with a static `import { Cartesian3 } from 'cesium'` at the top.

- [ ] **Step 2: Mount in GodsVisionView, wire HEAT toggle**

Follow identical pattern as GlobeArcs (Task C2): mount after dataManager, add `setOnHeatmapToggle` callback, wire cleanup.

- [ ] **Step 3: Add HEAT toggle button to GlobeHUD**

Follow identical pattern as ARCS button (Task C2 Step 3), label `HEAT`.

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobeHeatmap.ts src/components/GodsVisionView.ts src/components/GlobeHUD.ts
git commit -m "feat(C3): density heatmap canvas overlay toggle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Track D — Data & Ambient Features

### Task D1: Satellite passes overlay

**Files:**
- Modify: `src-tauri/sidecar/local-api-server.mjs` (add `/api/tle` endpoint)
- Create: `src/components/gods-vision/GlobeSatellites.ts`
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeHUD.ts`

- [ ] **Step 1: Add `/api/tle` sidecar endpoint**

In `local-api-server.mjs`, add after existing routes:

```javascript
// ISS + 20 Starlink TLEs from CelesTrak (public, no key)
app.get('/api/tle', async (req, res) => {
  try {
    const [issRes, starlinkRes] = await Promise.all([
      fetch('https://celestrak.org/SOCRATES/query.php?catalog=25544&format=tle', { signal: AbortSignal.timeout(5000) }),
      fetch('https://celestrak.org/SOCRATES/query.php?catalog=STARLINK&format=tle&limit=20', { signal: AbortSignal.timeout(5000) }),
    ]);
    // CelesTrak has a simpler endpoint:
    const issText = await fetch('https://celestrak.org/satcat/tle.php?CATNR=25544', { signal: AbortSignal.timeout(5000) }).then(r => r.text());
    res.set('Content-Type', 'text/plain').send(issText);
  } catch (e) {
    res.status(503).json({ error: String(e) });
  }
});
```

Actually, use the correct CelesTrak v2 API:

```javascript
app.get('/api/tle', async (_req, res) => {
  try {
    // CelesTrak GP data API — returns TLE text for ISS + active satellites
    const r = await fetch(
      'https://celestrak.org/SOCRATES/query.php?catalog=active&format=tle&limit=30',
      { signal: AbortSignal.timeout(6000) }
    );
    // Simpler: use the stations endpoint
    const text = await fetch(
      'https://celestrak.org/SOCRATES/stations-tle.txt',
      { signal: AbortSignal.timeout(6000) }
    ).then(t => t.text()).catch(() => '');
    if (!text) return res.status(503).json({ error: 'TLE fetch failed' });
    res.set('Content-Type', 'text/plain').send(text);
  } catch (e) {
    res.status(503).json({ error: String(e) });
  }
});
```

Use the actual working endpoint: `https://celestrak.org/SOCRATES/stations-tle.txt` returns ISS + common station TLEs.

- [ ] **Step 2: Install satellite.js**

```bash
npm install satellite.js
npm install --save-dev @types/satellite.js
```

- [ ] **Step 3: Create `GlobeSatellites.ts`**

```typescript
// src/components/gods-vision/GlobeSatellites.ts
import { Cartesian3, Color, CustomDataSource, Entity,
  PointGraphics, ConstantProperty, LabelGraphics,
  Cartesian2, type Viewer } from 'cesium';
import * as satellite from 'satellite.js';
import { getApiBaseUrl } from '@/services/runtime';

interface TleEntry { name: string; line1: string; line2: string }

function parseTles(text: string): TleEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    result.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] });
  }
  return result;
}

export class GlobeSatellites {
  private source: CustomDataSource;
  private tles: TleEntry[] = [];
  private rafId: number | null = null;
  private enabled = false;

  constructor(private viewer: Viewer) {
    this.source = new CustomDataSource('satellites');
  }

  async mount(): Promise<void> {
    await this.viewer.dataSources.add(this.source);
    await this.fetchTles();
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    void this.viewer.dataSources.remove(this.source, true);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.source.show = on;
    if (on) this.propagateLoop();
    else if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private async fetchTles(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/tle`);
      const text = await res.text();
      this.tles = parseTles(text);
      this.rebuildEntities();
    } catch { /* silent */ }
  }

  private rebuildEntities(): void {
    this.source.entities.removeAll();
    for (const tle of this.tles) {
      this.source.entities.add(new Entity({
        id: tle.name,
        point: new PointGraphics({
          pixelSize: new ConstantProperty(4),
          color: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
          outlineColor: new ConstantProperty(Color.BLACK),
          outlineWidth: new ConstantProperty(1),
        }),
        label: new LabelGraphics({
          text: new ConstantProperty(tle.name.trim()),
          font: new ConstantProperty('10px monospace'),
          fillColor: new ConstantProperty(Color.fromCssColorString('#a78bfa')),
          pixelOffset: new ConstantProperty(new Cartesian2(8, 0)),
          show: new ConstantProperty(true),
        }),
      }));
    }
  }

  private propagateLoop(): void {
    if (!this.enabled) return;
    this.rafId = requestAnimationFrame(() => {
      this.propagate();
      this.propagateLoop();
    });
  }

  private propagate(): void {
    const now = new Date();
    for (const tle of this.tles) {
      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        const posVel = satellite.propagate(satrec, now);
        if (!posVel.position || posVel.position === true) continue;
        const gmst = satellite.gstime(now);
        const geo = satellite.eciToGeodetic(posVel.position as satellite.EciVec3<number>, gmst);
        const lat = satellite.degreesLat(geo.latitude);
        const lon = satellite.degreesLong(geo.longitude);
        const alt = geo.height * 1000; // km → m
        const entity = this.source.entities.getById(tle.name);
        if (entity) {
          entity.position = new ConstantProperty(Cartesian3.fromDegrees(lon, lat, alt));
        }
      } catch { /* bad TLE — skip */ }
    }
  }
}
```

- [ ] **Step 4: Mount in GodsVisionView, wire SAT toggle button**

Follow same pattern as GlobeArcs. Add `setOnSatellitesToggle` to GlobeHUD, button label `SAT`.

- [ ] **Step 5: Typecheck and commit**
```bash
npm run typecheck:all
git add src-tauri/sidecar/local-api-server.mjs src/components/gods-vision/GlobeSatellites.ts src/components/GodsVisionView.ts src/components/GlobeHUD.ts
git commit -m "feat(D1): satellite passes overlay (ISS + stations) via TLE propagation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task D2: Mini-map

**Files:**
- Create: `src/components/gods-vision/GlobeMiniMap.ts`
- Modify: `src/components/GodsVisionView.ts`

- [ ] **Step 1: Create `GlobeMiniMap.ts`**

A 120×80px canvas in the bottom-right corner showing a Mercator world outline with a dot at the current camera position.

```typescript
// src/components/gods-vision/GlobeMiniMap.ts
import { Math as CesiumMath, type Viewer } from 'cesium';

// Simplified world outline as line segments [lon1,lat1,lon2,lat2] — draw as SVG instead
export class GlobeMiniMap {
  private canvas: HTMLCanvasElement | null = null;
  private rafId: number | null = null;
  private img: HTMLImageElement | null = null;

  constructor(private viewer: Viewer, private container: HTMLElement) {}

  mount(): void {
    const wrap = document.createElement('div');
    wrap.className = 'ge-minimap-wrap';

    const canvas = document.createElement('canvas');
    canvas.className = 'ge-minimap-canvas';
    canvas.width = 160;
    canvas.height = 80;
    wrap.append(canvas);
    this.container.append(wrap);
    this.canvas = canvas;

    // Load a simple world map image from a public source
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/World_map_-_low_resolution.svg/320px-World_map_-_low_resolution.svg.png';
    img.addEventListener('load', () => { this.img = img; });

    this.loop();
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.canvas?.parentElement?.remove();
    this.canvas = null;
  }

  private loop(): void {
    this.rafId = requestAnimationFrame(() => { this.draw(); this.loop(); });
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,15,25,0.7)';
    ctx.fillRect(0, 0, w, h);

    if (this.img?.complete && this.img.naturalWidth > 0) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(this.img, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Camera position dot
    const cam = this.viewer.camera;
    const carto = cam.positionCartographic;
    const lon = CesiumMath.toDegrees(carto.longitude); // -180..180
    const lat = CesiumMath.toDegrees(carto.latitude);  // -90..90
    const px = ((lon + 180) / 360) * w;
    const py = ((90 - lat) / 180) * h;

    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.shadowColor = '#60a5fa';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // View frustum circle (approximate field of view on map)
    const altKm = carto.height / 1000;
    const radiusDeg = Math.min(altKm / 111, 40); // rough: 1° ≈ 111km
    const radiusPx = (radiusDeg / 180) * h;
    ctx.beginPath();
    ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(96,165,250,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
```

- [ ] **Step 2: Add CSS**

In `gods-vision.css`:
```css
.ge-minimap-wrap {
  position: absolute;
  bottom: 84px;
  right: 16px;
  border: 1px solid var(--ge-glass-border);
  border-radius: 8px;
  overflow: hidden;
  pointer-events: none;
  box-shadow: var(--ge-glow);
}
.ge-minimap-canvas { display: block; }
```

- [ ] **Step 3: Mount in GodsVisionView**

After HUD init:
```typescript
import { GlobeMiniMap } from '@/components/gods-vision/GlobeMiniMap';
```

```typescript
const miniMap = new GlobeMiniMap(viewer, this.container);
miniMap.mount();
this.cleanupHandlers.push(() => miniMap.destroy());
```

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobeMiniMap.ts src/components/GodsVisionView.ts src/styles/gods-vision.css
git commit -m "feat(D2): mini-map overlay showing camera position on world map

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task D3: Ambient audio (threat-reactive)

**Files:**
- Create: `src/components/gods-vision/GlobeAudio.ts`
- Modify: `src/components/GodsVisionView.ts`
- Modify: `src/components/GlobeHUD.ts` (AUDIO toggle button)

- [ ] **Step 1: Create `GlobeAudio.ts`**

Uses Web Audio API to generate mode-reactive ambient drone. No external audio files needed.

```typescript
// src/components/gods-vision/GlobeAudio.ts
import type { AppMode } from '@/services/mode-manager';

const MODE_CONFIG: Record<AppMode, { freq: number; gain: number; lfo: number }> = {
  peace:   { freq: 60,  gain: 0.04, lfo: 0.3 },
  finance: { freq: 80,  gain: 0.06, lfo: 0.5 },
  war:     { freq: 40,  gain: 0.10, lfo: 1.2 },
  disaster:{ freq: 50,  gain: 0.09, lfo: 0.9 },
  ghost:   { freq: 30,  gain: 0.05, lfo: 0.2 },
};

export class GlobeAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private lfoGain: GainNode | null = null;
  private enabled = false;

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.value = 60;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0;

    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.value = 0.3;

    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.01;

    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.gainNode.gain);
    this.osc.connect(this.gainNode);
    this.gainNode.connect(ctx.destination);

    this.osc.start();
    this.lfoOsc.start();

    // Fade in
    this.gainNode.gain.setTargetAtTime(0.04, ctx.currentTime, 1.5);
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
      window.setTimeout(() => {
        this.osc?.stop();
        this.lfoOsc?.stop();
        void this.ctx?.close();
        this.ctx = null;
        this.osc = null;
        this.lfoOsc = null;
        this.gainNode = null;
        this.lfoGain = null;
      }, 2000);
    }
  }

  setMode(mode: AppMode): void {
    if (!this.ctx || !this.osc || !this.gainNode || !this.lfoOsc) return;
    const cfg = MODE_CONFIG[mode];
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(cfg.freq, t, 2);
    this.gainNode.gain.setTargetAtTime(cfg.gain, t, 2);
    this.lfoOsc.frequency.setTargetAtTime(cfg.lfo, t, 2);
  }

  isEnabled(): boolean { return this.enabled; }
}
```

- [ ] **Step 2: Mount in GodsVisionView, connect to mode changes**

```typescript
import { GlobeAudio } from '@/components/gods-vision/GlobeAudio';
```

Private field:
```typescript
private globeAudio: GlobeAudio | null = null;
```

After HUD init:
```typescript
this.globeAudio = new GlobeAudio();
this.cleanupHandlers.push(() => { this.globeAudio?.stop(); this.globeAudio = null; });
```

In `applyModeTheme`:
```typescript
if (this.globeAudio?.isEnabled()) this.globeAudio.setMode(mode);
```

After `setOnBuildingsToggle`:
```typescript
this.hud.setOnAudioToggle((enabled) => {
  if (enabled) {
    this.globeAudio?.start();
    this.globeAudio?.setMode(this.currentMode);
  } else {
    this.globeAudio?.stop();
  }
});
```

- [ ] **Step 3: Add AUDIO toggle to GlobeHUD**

Follow identical pattern as ARCS/HEAT/SAT buttons, label `AUDIO`.

- [ ] **Step 4: Typecheck and commit**
```bash
npm run typecheck:all
git add src/components/gods-vision/GlobeAudio.ts src/components/GodsVisionView.ts src/components/GlobeHUD.ts
git commit -m "feat(D3): threat-reactive ambient audio via Web Audio API

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Track execution

Each track should be a separate branch + PR:
- `claude/gods-vision-track-a` — HUD enhancements (A1–A4)
- `claude/gods-vision-track-b` — Camera & nav (B1–B4)
- `claude/gods-vision-track-c` — Visual effects (C1–C3)
- `claude/gods-vision-track-d` — Data & ambient (D1–D3)

All tracks are independent. After all 4 PRs merge, run a full build and install.

```bash
npm run typecheck:all
npm run desktop:build:full
node scripts/install-built-app.mjs --relaunch
```
