# Map security mutation evidence

Initial source snapshot: `536c17d37e76cf9037ebcc968e7aee6ef356f5db`.
Optimizer snapshot: `e80fd18246a9c556513759e85aee412da68c54ca`.

Proof worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/map-security-proofs-20260914`. Full logs, applied diffs, exact original bytes and machine-readable ledgers are retained in `/Users/bradleybond/.crystalball-diagnostics/map-security-20260914/proofs`. No delivery source was edited. Each mutation started with clean tracked status, changed only its nominated file, had an inspected nonempty applied diff, and restored the original SHA-256 with clean tracked status. Installed-module changes use `git diff --no-index` because node_modules is ignored.

## Commands and scope

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:map-compatibility
MAP_PROOF_WORKTREE=/Users/bradleybond/Developer/crystalball/.worktrees/map-security-proofs-20260914 PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test /Users/bradleybond/.crystalball-diagnostics/map-security-20260914/proofs/browser-sanitizer.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm ci
```

Initial Node baseline and all eleven restored runs: `# pass 7`, `# fail 0`, `# skipped 0`. Ten mutations produced assertion failures at 6 pass / 1 fail. The live-attributes mutation survived HappyDOM at 7 pass / 0 fail and is preserved as a survived result. Actual Chromium then killed the same installed-module mutation at 0 pass / 1 fail; browser baseline/restored were 1 pass / 0 fail.

Worker URL and constructor tests execute transpiled helper/method code with controlled MapLibre constructor dependencies. They do not prove production worker packaging or native WebGL behavior. Overlay and optimizer checks are source guards only. Provider selection executes the actual extracted selector. The sanitizer tests import the actual installed MapLibre 6.9.0 AttributionControl; no import/version downgrade or sanitizer mock is used. Real production map/browser coverage belongs to the separate integration report.

## Initial snapshot proofs

| Mutation | Coverage | Baseline → mutated → restored | Result |
|---|---|---|---|
| worker-emitted-url | runtime worker setter argument | 7/0 → 6/1 → 7/0 | killed |
| worker-bundle-query | runtime transpiled module import wiring | 7/0 → 6/1 → 7/0 | killed |
| main-worker-order | runtime extracted constructor method | 7/0 → 6/1 → 7/0 | killed |
| navigation-worker-order | runtime extracted constructor method | 7/0 → 6/1 → 7/0 | killed |
| supported-overlay | source guard only | 7/0 → 6/1 → 7/0 | killed |
| overlay-interleaving | source guard only | 7/0 → 6/1 → 7/0 | killed |
| style-precedence | runtime extracted provider selection | 7/0 → 6/1 → 7/0 | killed |
| keyless-fallback | runtime extracted fallback output | 7/0 → 6/1 → 7/0 | killed |
| sanitizer-bypass | actual installed AttributionControl implementation | 7/0 → 6/1 → 7/0 | killed |
| sanitizer-attribute-cleaning | actual installed AttributionControl implementation | 7/0 → 6/1 → 7/0 | killed |
| sanitizer-adjacent-attributes | actual installed AttributionControl implementation | 7/0 → 7/0 → 7/0 | survived |

### worker-emitted-url

File: `src/components/maplibre-worker.ts`. Original/restored SHA-256: `bdc8d629d57b80de8f7123b5cfc73fc7cf217eec5e4448375eaace1a136a1cc6`. Applied diff: `worker-emitted-url.diff`. Mutated SHA-256: `002c17343bc6df80b24bd05e826ffcadce6f3e13445516ffbf66b7d348a16db9`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 1 - worker initialization uses the emitted module worker URL through the supported API
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
      [
    +   '/unbundled-worker.mjs'
    -   '/assets/maplibre-gl-worker-test.mjs'
      ]
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: '/assets/maplibre-gl-worker-test.mjs'
  actual:
    0: '/unbundled-worker.mjs'
  operator: 'deepStrictEqual'
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/maplibre-worker.ts b/src/components/maplibre-worker.ts
index eb6d4f4d4..2e808777d 100644
--- a/src/components/maplibre-worker.ts
+++ b/src/components/maplibre-worker.ts
@@ -2,5 +2,5 @@ import { setWorkerUrl } from 'maplibre-gl';
 import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
 export function configureMapLibreWorker(): void {
-  setWorkerUrl(workerUrl);
+  setWorkerUrl('/unbundled-worker.mjs');
 }
```

### worker-bundle-query

File: `src/components/maplibre-worker.ts`. Original/restored SHA-256: `bdc8d629d57b80de8f7123b5cfc73fc7cf217eec5e4448375eaace1a136a1cc6`. Applied diff: `worker-bundle-query.diff`. Mutated SHA-256: `371f0784db4d0737e714a651e4995610b68c0f3921ffc9702168998e4648f131`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 1 - worker initialization uses the emitted module worker URL through the supported API
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
    - 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
  actual: 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
  operator: 'strictEqual'
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/maplibre-worker.ts b/src/components/maplibre-worker.ts
index eb6d4f4d4..10e5ba38a 100644
--- a/src/components/maplibre-worker.ts
+++ b/src/components/maplibre-worker.ts
@@ -1,5 +1,5 @@
 import { setWorkerUrl } from 'maplibre-gl';
-import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
+import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
 export function configureMapLibreWorker(): void {
   setWorkerUrl(workerUrl);
```

### main-worker-order

File: `src/components/DeckGLMap.ts`. Original/restored SHA-256: `927a8f2b1a4094384619ebe8e705917202d41cd08ace92ab9308c35f3c5cf7a2`. Applied diff: `main-worker-order.diff`. Mutated SHA-256: `629f635072beeaa3c8be4d6bde7563e842bef0e69e7520524e6f7ea873f86aad`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 2 - main map initializes its worker before construction and preserves context recovery
  error: 'worker URL must be configured before a map starts'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/DeckGLMap.ts b/src/components/DeckGLMap.ts
index d923c68ca..28d05da8f 100644
--- a/src/components/DeckGLMap.ts
+++ b/src/components/DeckGLMap.ts
@@ -836,7 +836,6 @@ export class DeckGLMap {
  registerEmergencyPackMapProtocolOnce(maplibregl.addProtocol, emergencyPackMapProtocolHandler);
- configureMapLibreWorker();
  this.maplibreMap = new maplibregl.Map({
  container: 'deckgl-basemap',
  style: getStyleUrl(this.activeBaseMap),
```

### navigation-worker-order

File: `src/components/NavigationPanel.ts`. Original/restored SHA-256: `958dd5ed05188992ad073f37db78f1ebc00f9fbb31df7f1723a3d772d943acd3`. Applied diff: `navigation-worker-order.diff`. Mutated SHA-256: `ebfcc4035aebec340730fd65f8237a2af3c39626fb48023b6ac46705a975957a`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 3 - navigation initializes the same worker and reuses its existing map when reopened
  error: 'worker URL must be configured before a map starts'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/NavigationPanel.ts b/src/components/NavigationPanel.ts
index 9532008d8..ebb41b4c6 100644
--- a/src/components/NavigationPanel.ts
+++ b/src/components/NavigationPanel.ts
@@ -130,7 +130,6 @@ export class NavigationPanel {
     this._visible = true;
     if (!this.map) {
-      configureMapLibreWorker();
       this.map = new maplibregl.Map({
         container: this.mapContainer,
         ...getMapStyleOptions(),
```

### supported-overlay

File: `src/components/DeckGLMap.ts`. Original/restored SHA-256: `927a8f2b1a4094384619ebe8e705917202d41cd08ace92ab9308c35f3c5cf7a2`. Applied diff: `supported-overlay.diff`. Mutated SHA-256: `26db66b7d2035ddb1a6bc10607343bd156c2066fdd9f1e765ae697f34d785c01`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 5 - deck integration uses the MapLibre overlay with interleaving and picking retained
  error: |-
    The input did not match the regular expression /import \{ MapLibreOverlay \} from '@deck.gl\/maplibre'/. Input:
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/DeckGLMap.ts b/src/components/DeckGLMap.ts
index d923c68ca..41df34eb8 100644
--- a/src/components/DeckGLMap.ts
+++ b/src/components/DeckGLMap.ts
@@ -3,7 +3,7 @@
  * Uses deck.gl for high-performance rendering of large datasets
  * Mobile devices gracefully degrade to the D3/SVG-based Map component
  */
-import { MapLibreOverlay } from '@deck.gl/maplibre';
+import { MapLibreOverlay } from '@deck.gl/mapbox';
 import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
 import { GeoJsonLayer, ScatterplotLayer, PathLayer, IconLayer, TextLayer, PolygonLayer } from '@deck.gl/layers';
 import { getSmokeSnapshots, subscribeSmoke } from '@/services/smoke/smoke-state';
```

### overlay-interleaving

File: `src/components/DeckGLMap.ts`. Original/restored SHA-256: `927a8f2b1a4094384619ebe8e705917202d41cd08ace92ab9308c35f3c5cf7a2`. Applied diff: `overlay-interleaving.diff`. Mutated SHA-256: `277aaf87c6352abddcc174c6c22acfe078952a222514748bf7d9328f78cc1d22`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 5 - deck integration uses the MapLibre overlay with interleaving and picking retained
  error: |-
    The input did not match the regular expression /new MapLibreOverlay\(\{\s*interleaved: true,/. Input:
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/DeckGLMap.ts b/src/components/DeckGLMap.ts
index d923c68ca..7e5357292 100644
--- a/src/components/DeckGLMap.ts
+++ b/src/components/DeckGLMap.ts
@@ -873,7 +873,7 @@ export class DeckGLMap {
  if (!this.maplibreMap) return;
  this.deckOverlay = new MapLibreOverlay({
- interleaved: true,
+ interleaved: false,
  layers: this.buildLayers(),
  getTooltip: (info: PickingInfo) => this.getTooltip(info),
  onClick: (info: PickingInfo) => this.handleClick(info),
```

### style-precedence

File: `src/components/NavigationPanel.ts`. Original/restored SHA-256: `958dd5ed05188992ad073f37db78f1ebc00f9fbb31df7f1723a3d772d943acd3`. Applied diff: `style-precedence.diff`. Mutated SHA-256: `fd72a04fc8684fa91c72c025bcbfcbcfaba8addd0b5ba1dd0fa51e1178122022`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 7 - navigation preserves style-provider precedence and the keyless raster fallback
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=maptiler'
    - 'https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=mapbox'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=mapbox'
  actual: 'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=maptiler'
  operator: 'strictEqual'
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/NavigationPanel.ts b/src/components/NavigationPanel.ts
index 9532008d8..e83396e22 100644
--- a/src/components/NavigationPanel.ts
+++ b/src/components/NavigationPanel.ts
@@ -21,7 +21,7 @@ function getMapStyleOptions(): Pick<maplibregl.MapOptions, 'style'> {
   const mapboxKey = cfg.secrets.MAPBOX_API_KEY?.value;
   const maptilerKey = cfg.secrets.MAPTILER_API_KEY?.value;
-  if (mapboxKey) {
+  if (mapboxKey && !maptilerKey) {
     return { style: `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${mapboxKey}` };
   }
   if (maptilerKey) {
```

### keyless-fallback

File: `src/components/NavigationPanel.ts`. Original/restored SHA-256: `958dd5ed05188992ad073f37db78f1ebc00f9fbb31df7f1723a3d772d943acd3`. Applied diff: `keyless-fallback.diff`. Mutated SHA-256: `5611707d63d51051bda5dbf86b93fd1282e0bbbc9f6c20cf54338582cd61bf7c`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 7 - navigation preserves style-provider precedence and the keyless raster fallback
  error: |-
    Expected values to be strictly equal:
    'missing' !== 'osm'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'osm'
  actual: 'missing'
  operator: 'strictEqual'
# pass 6
# fail 1
# skipped 0
```

Applied diff:

```diff
diff --git a/src/components/NavigationPanel.ts b/src/components/NavigationPanel.ts
index 9532008d8..f5297bae7 100644
--- a/src/components/NavigationPanel.ts
+++ b/src/components/NavigationPanel.ts
@@ -42,7 +42,7 @@ function getMapStyleOptions(): Pick<maplibregl.MapOptions, 'style'> {
       {
         id: 'osm-tiles',
         type: 'raster' as const,
-        source: 'osm',
+        source: 'missing',
       },
     ],
   } };
```

### sanitizer-bypass

File: `node_modules/maplibre-gl/dist/maplibre-gl.mjs`. Original/restored SHA-256: `0197eee4c6e8fd5d8b68f5f94a23e1c77e0c8fd054c377a280bcd08117aadfc4`. Applied diff: `sanitizer-bypass.diff`. Mutated SHA-256: `e8e57d44b1031ecd76acfc00918f2fe82c30610eca619ec9c93c550b05a078e7`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 6 - installed MapLibre removes active attribution content without losing safe credit links
  error: |-
    Expected values to be strictly equal:
    1 !== 0
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: 1
  operator: 'strictEqual'
# pass 6
# fail 1
# skipped 0
```

The full installed minified-module diff is retained privately; it is not reproduced as a many-hundred-kilobyte document block. The runner verifies the exact old/new sanitizer expression and a changed module checksum.

### sanitizer-attribute-cleaning

File: `node_modules/maplibre-gl/dist/maplibre-gl.mjs`. Original/restored SHA-256: `0197eee4c6e8fd5d8b68f5f94a23e1c77e0c8fd054c377a280bcd08117aadfc4`. Applied diff: `sanitizer-attribute-cleaning.diff`. Mutated SHA-256: `eb752463f92e777ad75a178a53ec02e3afd264b76486c5dc6c12fb982c4b1998`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
not ok 6 - installed MapLibre removes active attribution content without losing safe credit links
  error: |-
    The input was expected to not match the regular expression /javascript:/i. Input:
    'javascript:alert(1)'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'javascript:alert(1)'
  operator: 'doesNotMatch'
# pass 6
# fail 1
# skipped 0
```

The full installed minified-module diff is retained privately; it is not reproduced as a many-hundred-kilobyte document block. The runner verifies the exact old/new sanitizer expression and a changed module checksum.

### sanitizer-adjacent-attributes

File: `node_modules/maplibre-gl/dist/maplibre-gl.mjs`. Original/restored SHA-256: `0197eee4c6e8fd5d8b68f5f94a23e1c77e0c8fd054c377a280bcd08117aadfc4`. Applied diff: `sanitizer-adjacent-attributes.diff`. Mutated SHA-256: `fabdb398b61baeb0ef3095a9fd606f8b540603d6369ff813225b36837ef6eff9`.

Literal targeted output (whitespace-only lines omitted; full original log retained):

```text
# pass 7
# fail 0
# skipped 0
```

The full installed minified-module diff is retained privately; it is not reproduced as a many-hundred-kilobyte document block. The runner verifies the exact old/new sanitizer expression and a changed module checksum.

## Actual Chromium adjacent-attribute proof

The same attribution fixture and minimal map-control interface were used against the actual browser DOM. Each invocation launches a new browser context and serves installed dist modules with no-store headers. Alert calls are captured only to avoid dialog teardown interfering with the targeted DOM assertion; sanitizer and DOM behavior remain real. The initial uncaptured-dialog run is preserved as `browser-adjacent-initial-dialog-race.log` and excluded from mutation success.

Original/restored installed-module SHA-256: `0197eee4c6e8fd5d8b68f5f94a23e1c77e0c8fd054c377a280bcd08117aadfc4`. Applied full diff: `browser-adjacent.diff`. Restored clean status: `True`.

Mutation changes `of Array.from(t.attributes))` to `of t.attributes)` in the actual installed sanitizer.

Literal assertion output:

```text
not ok 1 - actual Chromium AttributionControl removes adjacent active attributes and retains safe credit
  error: |-
    actual Chromium DOM must contain no executable attribution attributes
    + actual - expected
    + [
    +   {
    +     name: 'onclick',
    +     value: 'alert(2)'
    +   },
    +   {
    +     name: 'ontoggle',
    +     value: 'alert(4)'
    +   }
    + ]
    - []
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual:
    0:
      name: 'onclick'
      value: 'alert(2)'
    1:
      name: 'ontoggle'
      value: 'alert(4)'
  operator: 'deepStrictEqual'
# pass 0
# fail 1
# skipped 0
```

Literal restored counts:

```text
# pass 1
# fail 0
# skipped 0
```

## Optimizer source guard

Snapshot `e80fd18246a9c556513759e85aee412da68c54ca`. File `vite.config.ts`. Original/restored SHA-256: `923b126cf6b1d7ef945746adbb6c1d866c55dd536af3c59858b0dfdc85a50ca4`. Baseline 8/0 → mutant 7/1 → restored 8/0. This proves the source guard detects the removed adapter entry, not optimizer runtime correctness.

```diff
diff --git a/vite.config.ts b/vite.config.ts
index d3cc94183..e18fd93d8 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -1318,7 +1318,7 @@ export default defineConfig({
  '@deck.gl/layers',
  '@deck.gl/geo-layers',
  '@deck.gl/aggregation-layers',
- '@deck.gl/maplibre',
+ '@deck.gl/mapbox',
  'papaparse',
  'posthog-js',
  'fast-xml-parser',
```

```text
not ok 8 - development prebundles the installed MapLibre adapter rather than resolving the removed adapter
  error: |-
    The input did not match the regular expression /'@deck.gl\/maplibre'/. Input:
    '  optimizeDeps: {\n' +
      ' // noDiscovery: prevent Vite from re-scanning for new deps at runtime.\n' +
      ' // Without this, every newly-discovered transitive dep triggers an\n' +
      ' // optimization re-run → "Outdated Optimize Dep" 504s in Tauri dev mode.\n' +
      ' noDiscovery: true,\n' +
      ' include: [\n' +
      " '@sentry/browser',\n" +
      " '@vercel/analytics',\n" +
      " 'i18next',\n" +
      " 'i18next-browser-languagedetector',\n" +
      " 'd3',\n" +
      " 'topojson-client',\n" +
      " 'maplibre-gl',\n" +
      " 'canvas-confetti',\n" +
      " 'h3-js',\n" +
      " 'supercluster',\n" +
      " '@deck.gl/core',\n" +
      " '@deck.gl/layers',\n" +
      " '@deck.gl/geo-layers',\n" +
      " '@deck.gl/aggregation-layers',\n" +
      " '@deck.gl/mapbox',\n" +
      " 'papaparse',\n" +
      " 'posthog-js',\n" +
      " 'fast-xml-parser',\n" +
      " 'lz-string',\n" +
      " 'cesium',\n" +
      " 'mersenne-twister',\n" +
# pass 7
# fail 1
# skipped 0
```

## Remaining boundaries

This proof set does not certify production build budgets, worker network/CSP behavior, rendered map layers, offline tiles, context recovery in a real GPU, or all future dependency source revisions. The HappyDOM adjacent-attribute gap is closed by a separate actual Chromium proof, not by claiming the Node test covers it. Any later optimizer edits need their own snapshot-specific validation.

## Typecheck and install outcomes

`PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run typecheck:all` exited 0 on e80fd1824. Literal output:

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

`PATH=/opt/homebrew/opt/node@22/bin:$PATH npm ci` exited 0. Literal outcome:

```text
added 949 packages, and audited 951 packages in 38s
found 0 vulnerabilities
```

## Final graphics optimization guards

Snapshot `16039e8beebe9a2ede8d61f05dcee6b8d32f7a27`. Command: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:map-compatibility`. File `vite.config.ts`. Original/restored SHA-256 for both isolated mutations: `9a3421482044c06df3a0601f1a97c62d360b15043fbeb43af8ee8a8534b05f76`. Baseline 9 pass / 0 fail; each removal 8 pass / 1 fail; each restoration 9 pass / 0 fail. Both mutations began and ended with clean tracked status. These remain source-configuration guards, not proof of browser graphics-instance behavior.

### extensions

Applied, inspected diff:

```diff
diff --git a/vite.config.ts b/vite.config.ts
index b79c44f02..f7bc9547a 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -1319,7 +1319,6 @@ export default defineConfig({
  '@deck.gl/geo-layers',
  '@deck.gl/aggregation-layers',
  '@deck.gl/maplibre',
- '@deck.gl/extensions',
  '@deck.gl/mesh-layers',
  'papaparse',
  'posthog-js',
```

Literal targeted failure and counts:

```text
not ok 9 - development keeps map extensions and mesh layers in the same optimized graphics graph
  ---
  duration_ms: 1.878125
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/map-security-proofs-20260914/tests/map-compatibility.test.mjs:194:1'
  failureType: 'testCodeFailure'
  error: '@deck.gl/extensions must be prebundled with deck core'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
# pass 8
# fail 1
# skipped 0
```

### mesh

Applied, inspected diff:

```diff
diff --git a/vite.config.ts b/vite.config.ts
index b79c44f02..ec76aa0e2 100644
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -1320,7 +1320,6 @@ export default defineConfig({
  '@deck.gl/aggregation-layers',
  '@deck.gl/maplibre',
  '@deck.gl/extensions',
- '@deck.gl/mesh-layers',
  'papaparse',
  'posthog-js',
  'fast-xml-parser',
```

Literal targeted failure and counts:

```text
not ok 9 - development keeps map extensions and mesh layers in the same optimized graphics graph
  ---
  duration_ms: 1.495459
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/map-security-proofs-20260914/tests/map-compatibility.test.mjs:194:1'
  failureType: 'testCodeFailure'
  error: '@deck.gl/mesh-layers must be prebundled with deck core'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
# pass 8
# fail 1
# skipped 0
```
