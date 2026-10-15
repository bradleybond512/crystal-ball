# Map clarity cleanup — bounded local evidence

Date: 2026-10-15. Task: UX-061. Approved source baseline:
`5e1bfa00fd739723dfa08e166c6af0bada0e7c70`.

## Approved behavior and boundaries

Reported points must not acquire an invented 500 km geographic footprint.
Genuine supplied radii and regional EMA context remain distinct. New map
projection metadata retains every original source/member ID and its own center,
including situations associated with an EMA region by the existing merge.

Legacy scores, confidence, velocity, thresholds, ordering and EMA upward-merge
calculations remain unchanged. Original EMA values and situation confidence are
captured separately for display; the inherited mixed `riskScore` is not presented
as a validated risk measurement. Selection and clustering change presentation,
not source situation identities or alert state.

The approved presentation includes zoom-aware FAA clustering, complete member
access through a keyboard-reachable nonmodal details browser, stable source-ID
selection, collision-aware contextual labels, smaller routine marks and subdued
context fills. Existing urgent-warning geometry, styling and pickability remain
intact. No providers are disabled, and layer/basemap preferences are not reset.
No provider, native permission, alert acknowledgment/delivery, scoring engine,
Home/readiness layout, dependency, release or installation code is changed.

## Geography test-first evidence

The updated geography contract against unchanged production code reported
`# pass 16` / `# fail 6`, including the actual `500 !== 0` failure. After the
bounded projection repair, the geography suite reported `# pass 22` /
`# fail 0`; the full `npm run test:acc509` reported `# pass 124` /
`# fail 0`. Source ESLint and diff checks exited 0. Actual logs are retained
privately as `forecast-red.log`, `forecast-green.log`,
`forecast-acc509-host.log` and `forecast-eslint-final.log` in the control
workspace's `map-cleanup-oct15` directory.

The previous test named a reported point at zero coordinates, but its shared
fixture supplied a 500 km radius. The repaired test now explicitly supplies a
zero radius, and separate tests retain positive supplied-radius and EMA context
coverage. This is a deliberate geometry-contract repair, not deletion of the
zero-coordinate or area/display-centroid safeguards.

An initial full-suite attempt hit the sandbox's tsx IPC restriction; its actual
failure remains in `forecast-acc509.log`. The normal host-permission retry is
the passing 124/0 result. No provider requests were needed.

## Integration validation status

Initial `npm run test:map-clarity` integration reported `# pass 21` / `# fail 0`, followed by
`# pass 4` / `# fail 0` for the existing FAA popup contracts. The existing
`test:local-basemap`, `test:map-compatibility` and `test:agentic-pipeline` scripts
reported respectively `# pass 16` / `# fail 0`, `# pass 9` / `# fail 0` and
`# pass 75` / `# fail 0`.

The first local-basemap run reported `# pass 14` / `# fail 1`: its existing
constructor-free prototype fixture lacked the new constructor-owned caches.
Initializing those caches repaired the fixture; all existing assertions remain.
A further focused assertion preserves convergence source geography and the urgent
core while constraining the contextual fill; the suite then reported 16/0.
The raw failing and repaired outputs are retained.

Browser checks use the production cascade and renderer with API/external
requests blocked. An initial overbroad storage comparison included unrelated
seasonal forecast cache writes; the corrected assertion compares the actual
basemap and layer preference contract. The browser fixture now constructs the
actual Home stacking wrapper after the map, matching production DOM order.
That test exposed a real covered details panel (`0 passed`, `1 failed`); the
scoped panel now uses the existing raised modal layer. Screenshots contain
sanitized fixture data, not the user's live app or personal banner values.

Expanded real-renderer and explicit original-viewer integration each reported
`6 passed` / `0 failed`. Keyboard actions open the existing camera/data-centre
viewers above Home, restore entry focus, preserve camera/preferences and fetch no
images before explicit viewing. Camera bytes are fulfilled locally by the fixture.
Original source inputs remain unchanged; every 205-member camera/DC cluster is
reachable. All eight relevant source hashes remained stable through the viewer run.
Initial helper import failure is not behavior proof.

## Final affected validation and sampling preservation

Integration found a preservation issue before independent review: the new
presentation refresh called the forecast getter while its layer was hidden.
The inherited `forecastRegions()` records seasonal observations when called.
A two-line renderer guard restores the previous enabled-layer invocation
boundary; no engine, calibration or scoring code changes. Cached forecast
details remain readable with the layer marked hidden; enabling refreshes the
projection and an empty enabled snapshot removes stale members.

The test-first local-map run reported `# pass 16` / `# fail 1`, with expected
getter calls `0` versus actual `4`. The repaired run reported `# pass 17` /
`# fail 0`; clean reversion reported `# pass 16` / `# fail 1` and restored
exactly. Zero calls while hidden, cached IDs/selection, one reconciliation on
re-enable and no new calls on hiding again are asserted.

The final unmodified gate was run as:

```sh
bash scripts/agentic-validate.sh --tests "test:map-clarity test:acc509 test:local-basemap test:map-clarity-browser"
```

Actual output: `# pass 27` / `# fail 0`; `# pass 7` / `# fail 0`;
`# pass 124` / `# fail 0`; `# pass 17` / `# fail 0`; browser `6 passed`.
It printed `Agentic validation gate passed.` Lockfile, strict lint, both type
configs, secret scanning, local cross-agent configuration, docs, roadmap and
the standard web build all exited 0. Source hashes, HEAD/tree, staged entries
and empty status remained unchanged throughout that gate.

Before the final two-line guard, the full eight-script gate also passed:
map clarity `27/0` then `7/0`, ACC-509 `124/0`, local map `16/0`, compatibility
`9/0`, browser `6 passed`, agentic pipeline `75/0`, lifelines `33/0` then
`13/0`, and untrusted content `66/0`. Those unchanged regression paths were
not needlessly repeated after the guard. Raw output is retained as
`full-eight-suite-gate-before-hidden-boundary.log`; final affected output and
hash receipts are `final-agentic-gate.log/.json` in the private control directory.

The first gate correctly rejected the unsupported roadmap row status
`IN PROGRESS — LOCAL`. The row now uses supported `IN PROGRESS`, with the
local-only boundary in its evidence column. The controller was not weakened;
the rejected log is retained as `initial-agentic-gate-roadmap-rejected.log`.
All local checkpoints and the final evidence commit use normal Husky hooks.

Independent Sol results are kept privately against the frozen code-and-evidence
commit, separately from this document, so the reviewed SHA can be pinned.
No public cross-agent verdict is recorded at this stage.

## Clean mutation proofs

All 45 distinct mutations started from an empty status, saved a nonempty applied
git diff and original SHA-256 values, produced an actual failed assertion, then
restored HEAD, tree, staged entries, all frozen source hashes and empty status.
Raw diffs, failure logs, failed-test names and before/after receipts remain
privately under `map-cleanup-oct15/mutations/`; `all-mutation-results.json`
indexes them. Each row retains its own checkpoint and matching test scope.
The browser cases passed within the integrated six-case run; single-case
reversions reported `1 failed`. The accepted-production renderer/projection
reversion reported `3 failed` on actual urgent-warning picking and captured
the sanitized before images at all three sizes.

| Mutated behavior | Source file | Matching green | Actual red pass/fail |
| --- | --- | --- | --- |
| reported-radius-fallback | forecast-overlay.ts | 22/0 | 19/3 |
| original-ema-provenance | forecast-overlay.ts | 22/0 | 20/2 |
| contribution-own-center | map-clarity-model.ts | 10/0 | 8/2 |
| coincident-all-members | map-clarity-model.ts | 10/0 | 9/1 |
| meaningful-title | map-clarity-model.ts | 10/0 | 8/2 |
| camera-all-leaves | map-clarity-model.ts | 10/0 | 9/1 |
| zero-coordinates | map-clarity-model.ts | 10/0 | 7/3 |
| label-collision | map-clarity-model.ts | 10/0 | 8/2 |
| label-source-priority | map-clarity-model.ts | 10/0 | 9/1 |
| complete-details-pagination | MapFeatureList.ts | 17/0 | 15/2 |
| refresh-preserves-focus | MapFeatureList.ts | 17/0 | 16/1 |
| local-escape | MapFeatureList.ts | 17/0 | 15/2 |
| removed-source-action | MapFeatureList.ts | 17/0 | 16/1 |
| subdued-convergence-context | DeckGLMap.ts | 16/0 | 15/1 |
| explicit-viewer-close-order | MapFeatureList.ts | 17/0 | 13/4 |
| explicit-viewer-current-source | MapFeatureList.ts | 17/0 | 15/2 |
| explicit-viewer-no-auto-open | MapFeatureList.ts | 17/0 | 16/1 |
| explicit-viewer-hidden-layer | MapFeatureList.ts | 17/0 | 16/1 |
| viewer-scoped-elevation | MapPopup.ts | 7/0 | 6/1 |
| viewer-initial-focus | MapPopup.ts | 7/0 | 6/1 |
| viewer-return-focus | MapPopup.ts | 7/0 | 6/1 |
| owned-popup-teardown | DeckGLMap.ts | 16/0 | 15/1 |
| widget-owned-dom-teardown | MapFeatureList.ts | 17/0 | 15/2 |
| duplicate-source-identity | map-clarity-model.ts | 10/0 | 7/3 |
| bounded-label-count | map-clarity-model.ts | 10/0 | 9/1 |
| cluster-open-does-not-select | MapFeatureList.ts | 17/0 | 13/4 |
| hidden-layer-map-action | MapFeatureList.ts | 17/0 | 15/2 |
| selection-survives-refresh | MapFeatureList.ts | 17/0 | 13/4 |
| search-survives-refresh | MapFeatureList.ts | 17/0 | 16/1 |
| default-popup-keeps-focus | MapPopup.ts | 7/0 | 6/1 |
| viewer-focus-ownership | MapPopup.ts | 7/0 | 6/1 |
| untrusted-detail-text | MapFeatureList.ts | 17/0 | 16/1 |
| confidence-label-provenance | forecast-overlay.ts | 22/0 | 21/1 |
| hidden-forecast-sampling-boundary | DeckGLMap.ts | 17/0 | 16/1 |
| accepted-production-before | DeckGLMap.ts, forecast-overlay.ts | cases passed within 6/0 | 0/3 |
| home-panel-paint-order | map-feature-list.css | cases passed within 6/0 | 0/1 |
| row-selection-must-not-move-map | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| urgent-warning-paint-order | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| datacenter-all-leaves | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| restrained-context-style | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| restrained-climate-context | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| restrained-threat-context | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| viewer-home-paint-order | map-feature-list.css | cases passed within 6/0 | 0/1 |
| compact-datacenter-context | DeckGLMap.ts | cases passed within 6/0 | 0/1 |
| translucent-regional-context | DeckGLMap.ts | cases passed within 6/0 | 0/1 |

An initial focus mutation stalled while failed DOM identity diagnostics expanded
Happy DOM objects. Only two verified owned test processes were stopped; its
receipt proves exact restoration and is excluded from the 45 proofs. Replacing
node identity assertions with logically identical strict-equality boolean
assertions preserved every condition and produced the actual `16/1` focus red.
Original four FAA popup tests remain unchanged.

All 10 new model, 17 widget and 3 scoped popup focus tests failed under at least
one clean mutation. The unsafe detail-markup mutation used the installed Happy
DOM default `enableImageFileLoading: false`; it fetched no image bytes.
No behavior test was deleted. Routing additions preserve existing mappings;
dependencies and lockfile are unchanged. Sanitized fixture images and their
SHA-256 manifest are private; no live user screenshot is included.

## Delivery and acceptance boundary

Bradley authorized the focused cleanup, bounded disclosure of its relevant code
diff and test evidence to Anthropic through the existing Claude CLI for Sonnet
medium review (up to three actual passes, no Opus), protected publication/merge
and stable-signed Mac installation. At this code-and-evidence freeze no external
review, PR, merge or install result is claimed; actual SHA-pinned milestones are
recorded separately. The prior Settings fix remains a separate task.

Rollback is the bounded presentation/projection/test revert. No data migration
or user-preference restoration is required. Packaged macOS/WebKit and VoiceOver
acceptance remain separate until actual installation and verification.
