# UX-073 — isolate DeckGL icon drawing and cache ownership

Approved High Assurance architecture design, November 27, 2026. Discovery and
design were delegated read-only. Documentation draft publication and local
implementation are authorized.

## Evidence and decision

At baseline `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`, measured modules are:

| Module | Lines | Bytes |
| --- | ---: | ---: |
| DeckGLMap | 7,241 | 277,441 |
| data-loader | 5,149 | 230,641 |
| panel-layout | 3,878 | 186,068 |
| Map | 3,811 | 122,092 |
| GlobeDataManager | 3,308 | 118,860 |
| MapPopup | 2,885 | 114,836 |

Choose only DeckGLMap's 73-line, 8,292-byte canvas-atlas block: 22 drawing
functions, constants, shared caches and two accessors. Its 21 paired layer
consumers remain in DeckGLMap. This isolates graphics asset lifecycle from
provider/map orchestration and enables direct tests without WebGL. File length
alone is not an acceptance gate or evidence of a performance improvement.

The complete current open-main-PR snapshot contains 40 PRs. Their paginated file
lists contain no changes to `DeckGLMap.ts`, `deckgl-icon-atlas.ts` or
`tests/map-compatibility.test.mjs`. This is a point-in-time overlap check, not a
reservation or permission to overwrite later work. Recheck before committing.

MapContainer dynamically loads DeckGLMap when WebGL2 is suitable, with a separate
SVG fallback. Notification routing also lazily imports DeckGLMap for optional
marker hooks. App separately loads GodsVisionView and Cesium GlobeDataManager.
These are distinct callers; no map consolidation is proposed.

## Bounded change

Move the atlas block literally to `src/components/deckgl-icon-atlas.ts` and export
only `getIconAtlas()` and `getIconMapping()` for the existing layer call sites.
Keep signatures and mapping shape; add one static import beneath the existing
lazy DeckGLMap boundary. Preserve the type-only component barrel and all layer
IDs, selectors and provider imports. No compatibility shim or helper framework.

Preserve exact drawing operations/order, 704 by 32 canvas, 32-pixel cells,
white fill/stroke, center anchors `(16,16)`, mask flags and save/translate/restore
isolation. Keep lazy singleton allocation, mapping-first access and returned
object identity. Import alone must not access `document` or allocate a canvas.
Keep existing canvas-initialization failure behavior; add no fallback policy.

No external inputs, requests, storage, permissions, dependencies or application
settings change. No provider, forecast, notification or native behavior changes.

## Owners and proof

| Owner | Allowed files / task | Dependency |
| --- | --- | --- |
| Test specialist | `tests/map-compatibility.test.mjs`; frozen fixture under `tests/fixtures/` | Approved claim; characterize original before extraction |
| UI/map specialist | `DeckGLMap.ts`, new `deckgl-icon-atlas.ts` only | Frozen baseline expectations |
| Parent | Brief/design, tracker, QA; additive test mapping if required | Actual evidence and independent review |

Use the existing TypeScript/VM test convention to capture independently reviewed
pre-extraction draw transcripts and mappings. Keep these expectations frozen after
moving code; never regenerate them to obtain a pass. Test all 22 symbols, both
accessor orders, lazy import, stable object identity, one initial allocation and
zero extra drawing/allocation across repeated calls. Verify every existing layer
consumer uses the imported accessors.

Mutation proofs must catch geometry changes, missing state restoration, changed
anchors/masks, changed order/cell placement, eager allocation, bypassed caching
and a disconnected caller. Record applied diffs, actual red counts and restored
checksums from a clean committed tree.

## Comparison and acceptance

Run `test:map-compatibility`, relevant map tests and `typecheck:all`, followed by
the named full validation gate. Compare baseline/candidate `build:full` and
`bundle:check` using identical Node, installed dependencies, variant and build
environment. Record entry/eager-preload, DeckGL and total raw/gzip sizes. Preserve
current budgets and lazy loading; investigate differences without inventing an
arbitrary line or byte threshold.

Use the existing fixture map harness for boot, nonempty layer rendering and
absence of a standing repaint loop. Compare the same browser, viewport and
fixtures; preserve existing golden expectations. Allocation/draw counts prove
deterministic work continuity, not startup speed. Timings are supporting evidence.
Record unavailable browser/native evidence honestly; no installed-app launch or
live profile is required or authorized.

Suggested checks (planned, not results): `test:map-compatibility`,
`test:local-basemap`, `test:map-clarity`, `typecheck:all`, `build:full`,
`bundle:check` and the three existing focused map-harness cases. Existing source
tests alone do not establish pixel or browser behavior.

Acceptance requires measurable isolation/testability, preserved rendering/cache
behavior, import/selector continuity, comparable bundle/work evidence and both
independent reviews. Broader module extraction remains outside this bounded task.

## Approval and rollback

Approved November 27: this design, documentation-only draft claim and local implementation,
including isolated fixture browser checks. Final code publication remains a
separate approval. No new package, CI policy or approval label is proposed.

No migration is needed. Rollback reunites the block and removes its import/module,
retaining characterization coverage. Merging, auto-merge, releases, deployment,
installation, cleanup and live-profile access remain paused. #1920 keeps its
existing workflow.
