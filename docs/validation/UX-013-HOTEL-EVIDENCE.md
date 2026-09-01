# UX-013 hotel operational evidence validation

## Scope

This change is presentation-only. It adds no provider, schema, route, cache,
health vote, sidecar, Tauri, settings, dependency, or CSS behavior.

The shared presentation boundary recognizes directory hotel evidence only when:

```ts
node.category === 'hotel'
  && (node.directoryOnly || node.verification === 'directory')
```

Directory hotels display the approved disclosure, project operational,
inventory, power, and access to `unknown`, expose a bounded valid phone as
`Call to confirm`, and explicitly disclose when no callable number is
published. Expired directory evidence composes the expiry warning with the
same disclosure. The panel shows the directory row's retrieval time from
`retrievedAt ?? observedAt`.

Future official hotels and all non-hotel rows keep the existing generic call,
evidence, and panel time presentation. Loading, empty, degraded, and error
states are unchanged. Existing click-only navigation, keyboard buttons and
links, focus restoration, live regions, and responsive/resized-window layout
are unchanged.

## Historical test-first evidence

The initial TDD red results were captured during implementation, before the
production code at this commit existed. They cannot be freshly reproduced
without reverting multiple production behaviors, so they are retained as
historical, unquoted evidence and are not counted as the auditable mutation
proofs below:

- helper suite: `11 pass / 3 fail`;
- panel component suite: `10 pass / 2 fail`;
- popup component suite: `5 pass / 2 fail`;
- future-official-hotel boundary: `0 pass / 1 fail` in each focused panel and
  popup run.

The previously observed `182 pass / 1 fail` run had no retained failing
assertion and was not reproducible. It is explicitly excluded from all
evidence and pass claims in this document.

## Fresh auditable mutation proofs

All five proofs were rerun on Node `v22.23.1` at exact clean commit
`de6835c4fb0b78f5de46735dcd5b398dfad73740`. Each proof began with an empty
`git status --short`, used `apply_patch` for only the stated production
mutation, captured the applied diff before testing, restored with
`apply_patch`, matched the starting checksum, reran the same focused command
green, and ended with another empty `git status --short`.

### 1. Exact hotel-directory disclosure and predicate

Pre-mutation commands and raw output:

```text
$ git status --short
<empty>
$ shasum -a 256 src/components/disaster-lifelines-map-helpers.ts
35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1  src/components/disaster-lifelines-map-helpers.ts
```

Applied mutation diff, captured before the test:

```diff
diff --git a/src/components/disaster-lifelines-map-helpers.ts b/src/components/disaster-lifelines-map-helpers.ts
index 6389b010..26fbbd0f 100644
--- a/src/components/disaster-lifelines-map-helpers.ts
+++ b/src/components/disaster-lifelines-map-helpers.ts
@@ -493,8 +493,7 @@ export function getLifelineMarkerPresentation(
   now = Date.now(),
 ): LifelineMarkerPresentation {
   const expired = node.expiresAt.getTime() <= now;
-  const isHotelDirectory = node.category === 'hotel'
-    && (node.directoryOnly || node.verification === 'directory');
+  const isHotelDirectory = false;
   let state: LifelineMarkerState;
   let evidenceLabel: string;
   if (expired) {
```

Exact focused command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --import ./tests/panels/register-hook.mjs --test --test-name-pattern='hotel presentation selects the shared directory disclosure and fails closed|expired hotel presentation composes expiry and projects all states to unknown' tests/lifelines-map.test.mts
```

Raw red failure excerpts and summary:

```text
# Subtest: hotel presentation selects the shared directory disclosure and fails closed
not ok 1 - hotel presentation selects the shared directory disclosure and fails closed
  error: |-
    Expected values to be strictly equal:

    false !== true
  expected: true
  actual: false
# Subtest: expired hotel presentation composes expiry and projects all states to unknown
not ok 2 - expired hotel presentation composes expiry and projects all states to unknown
  error: |-
    Expected values to be strictly equal:
    + actual - expected

    + 'Verification expired — status unknown'
    - 'Verification expired — status unknown. Directory listing only. Vacancy, current operation, power, and access are unknown. Confirm directly with the property before relying on it.'
  expected: 'Verification expired — status unknown. Directory listing only. Vacancy, current operation, power, and access are unknown. Confirm directly with the property before relying on it.'
  actual: 'Verification expired — status unknown'
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
```

Raw restored checksum, green summary, and status:

```text
$ shasum -a 256 src/components/disaster-lifelines-map-helpers.ts
35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1  src/components/disaster-lifelines-map-helpers.ts
$ PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --import ./tests/panels/register-hook.mjs --test --test-name-pattern='hotel presentation selects the shared directory disclosure and fails closed|expired hotel presentation composes expiry and projects all states to unknown' tests/lifelines-map.test.mts
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ git status --short
<empty>
```

### 2. Fail-closed state projection

Pre-mutation commands and raw output:

```text
$ git status --short
<empty>
$ shasum -a 256 src/components/disaster-lifelines-map-helpers.ts
35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1  src/components/disaster-lifelines-map-helpers.ts
```

Applied mutation diff, captured before the test:

```diff
diff --git a/src/components/disaster-lifelines-map-helpers.ts b/src/components/disaster-lifelines-map-helpers.ts
index 6389b010..246d0d54 100644
--- a/src/components/disaster-lifelines-map-helpers.ts
+++ b/src/components/disaster-lifelines-map-helpers.ts
@@ -520,7 +520,7 @@ export function getLifelineMarkerPresentation(
   }
   const category = CATEGORY_PRESENTATION[String(node.category)] ?? { label: 'Lifeline', glyph: 'L' };
   const style = STATE_PRESENTATION[state];
-  const failClosed = expired || isHotelDirectory;
+  const failClosed = expired;
   return {
     state,
     categoryLabel: category.label,
```

Exact focused command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --import ./tests/panels/register-hook.mjs --test --test-name-pattern='hotel presentation selects the shared directory disclosure and fails closed' tests/lifelines-map.test.mts
```

Raw red failure excerpt and summary:

```text
# Subtest: hotel presentation selects the shared directory disclosure and fails closed
not ok 1 - hotel presentation selects the shared directory disclosure and fails closed
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      {
    +   access: 'reachable',
    +   inventory: 'available',
    +   operational: 'open',
    +   power: 'grid'
    -   access: 'unknown',
    -   inventory: 'unknown',
    -   operational: 'unknown',
    -   power: 'unknown'
      }
  expected:
    operational: 'unknown'
    inventory: 'unknown'
    power: 'unknown'
    access: 'unknown'
  actual:
    operational: 'open'
    inventory: 'available'
    power: 'grid'
    access: 'reachable'
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
```

Raw restored checksum, green summary, and status:

```text
$ shasum -a 256 src/components/disaster-lifelines-map-helpers.ts
35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1  src/components/disaster-lifelines-map-helpers.ts
$ PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --import ./tests/panels/register-hook.mjs --test --test-name-pattern='hotel presentation selects the shared directory disclosure and fails closed' tests/lifelines-map.test.mts
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ git status --short
<empty>
```

### 3. Confirmation label and accessible name

Pre-mutation commands and raw output:

```text
$ git status --short
<empty>
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
```

Applied mutation diff, captured before the test:

```diff
diff --git a/src/components/LocalLogisticsPanel.ts b/src/components/LocalLogisticsPanel.ts
index 3d0ee848..de067984 100644
--- a/src/components/LocalLogisticsPanel.ts
+++ b/src/components/LocalLogisticsPanel.ts
@@ -138,7 +138,7 @@ function renderNodeCallAction(
   const escapedId = escapeHtml(node.id);
   const escapedName = escapeHtml(node.name);
   if (requiresHotelConfirmation) {
-    return `<button class="sa-refresh-btn" data-logistics-call="${escapedId}" type="button" aria-label="Call ${escapedName} to confirm vacancy, current operation, power, and access">Call to confirm</button>`;
+    return `<button class="sa-refresh-btn" data-logistics-call="${escapedId}" type="button" aria-label="Call ${escapedName}">Call</button>`;
   }
   return `<button class="sa-refresh-btn" data-logistics-call="${escapedId}" type="button" aria-label="Call ${escapedName}">Call</button>`;
 }
```

Exact focused command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='hotel card fails closed, discloses evidence, and labels a valid call as confirmation' src/components/__tests__/local-logistics-panel.test.mts
```

Raw red failure excerpt and summary:

```text
# Subtest: hotel card fails closed, discloses evidence, and labels a valid call as confirmation
not ok 1 - hotel card fails closed, discloses evidence, and labels a valid call as confirmation
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      {
    +   accessibleName: 'Call Directory Hotel',
    +   label: 'Call'
    -   accessibleName: 'Call Directory Hotel to confirm vacancy, current operation, power, and access',
    -   label: 'Call to confirm'
      }
  expected:
    label: 'Call to confirm'
    accessibleName: 'Call Directory Hotel to confirm vacancy, current operation, power, and access'
  actual:
    label: 'Call'
    accessibleName: 'Call Directory Hotel'
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
```

Raw restored checksum, green summary, and status:

```text
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
$ PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='hotel card fails closed, discloses evidence, and labels a valid call as confirmation' src/components/__tests__/local-logistics-panel.test.mts
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ git status --short
<empty>
```

### 4. Missing-phone disclosure

Pre-mutation commands and raw output:

```text
$ git status --short
<empty>
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
```

Applied mutation diff, captured before the test:

```diff
diff --git a/src/components/LocalLogisticsPanel.ts b/src/components/LocalLogisticsPanel.ts
index 3d0ee848..018f6082 100644
--- a/src/components/LocalLogisticsPanel.ts
+++ b/src/components/LocalLogisticsPanel.ts
@@ -117,7 +117,7 @@ function renderNodePhone(
   callHref: string | null,
 ): string {
   if (requiresHotelConfirmation) {
-    if (!callHref) return '<div class="watchlist-scenario">No callable public phone published.</div>';
+    if (!callHref) return '';
     return `<div class="watchlist-scenario">Public phone: ${escapeHtml(node.publicPhone ?? '')}</div>`;
   }
   if (!node.publicPhone) return '';
```

Exact focused command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='expired hotel card composes expiry and omits missing or malformed call controls' src/components/__tests__/local-logistics-panel.test.mts
```

Raw red failure excerpt and summary:

```text
# Subtest: expired hotel card composes expiry and omits missing or malformed call controls
not ok 1 - expired hotel card composes expiry and omits missing or malformed call controls
  error: |-
    The input did not match the regular expression /No callable public phone published\./. Input:

    '\n' +
      ' hotel hotel-no-phone\n' +
      ' HotelOperational: unknownInventory: unknownPower: unknownAccess: unknown\n' +
      ' Verification expired — status unknown. Directory listing only. Vacancy, current operation, power, and access are unknown. Confirm directly with the property before relying on it. • Verification expired 9:37 PM • OpenStreetMap\n' +
      ' Retrieved Aug 31, 9:37 PM\n' +
      ' Open in Maps\n' +
      ' Source\n'
  expected:
  operator: 'match'
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
```

The input excerpt above contains only verbatim lines selected from the longer
raw `actual` rendering; no value was normalized.

Raw restored checksum, green summary, and status:

```text
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
$ PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='expired hotel card composes expiry and omits missing or malformed call controls' src/components/__tests__/local-logistics-panel.test.mts
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ git status --short
<empty>
```

### 5. `retrievedAt` preference

Pre-mutation commands and raw output:

```text
$ git status --short
<empty>
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
```

Applied mutation diff, captured before the test:

```diff
diff --git a/src/components/LocalLogisticsPanel.ts b/src/components/LocalLogisticsPanel.ts
index 3d0ee848..5d91bc25 100644
--- a/src/components/LocalLogisticsPanel.ts
+++ b/src/components/LocalLogisticsPanel.ts
@@ -126,7 +126,7 @@ function renderNodePhone(

 function renderNodeRetrieval(node: LogisticsNode, requiresHotelConfirmation: boolean): string {
   if (!requiresHotelConfirmation) return '';
-  return `<div class="watchlist-scenario">Retrieved ${renderEvidenceTime(node.retrievedAt ?? node.observedAt, 'Unknown')}</div>`;
+  return `<div class="watchlist-scenario">Retrieved ${renderEvidenceTime(node.observedAt, 'Unknown')}</div>`;
 }

 function renderNodeCallAction(
```

Exact focused command:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='hotel card fails closed, discloses evidence, and labels a valid call as confirmation' src/components/__tests__/local-logistics-panel.test.mts
```

Raw red failure excerpt and summary:

```text
# Subtest: hotel card fails closed, discloses evidence, and labels a valid call as confirmation
not ok 1 - hotel card fails closed, discloses evidence, and labels a valid call as confirmation
  error: |-
    Expected values to be strictly equal:
    + actual - expected

    + '2026-08-14T12:00:00.000Z'
    - '2026-08-14T13:40:00.000Z'
                   ^
  expected: '2026-08-14T13:40:00.000Z'
  actual: '2026-08-14T12:00:00.000Z'
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
```

Raw restored checksum, green summary, and status:

```text
$ shasum -a 256 src/components/LocalLogisticsPanel.ts
cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8  src/components/LocalLogisticsPanel.ts
$ PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx --test --test-name-pattern='hotel card fails closed, discloses evidence, and labels a valid call as confirmation' src/components/__tests__/local-logistics-panel.test.mts
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
$ git status --short
<empty>
```

## Fresh final validation

All final commands used Node `v22.23.1`. The test commands were run in full;
only their raw TAP command and summary lines are reproduced here.

### Lifelines

Command: `npm run test:lifelines`

```text
> crystal-ball@2.25.147 test:lifelines
> node --test api/local-logistics.test.mjs api/grid-outages.test.mjs api/usgs-water-proxy.test.mjs api/__tests__/local-logistics.test.mjs src-tauri/sidecar/__tests__/bounded-provider-responses.test.mjs src-tauri/sidecar/__tests__/local-logistics-route.test.mjs src-tauri/sidecar/__tests__/intel-expansion-cluster3.test.mjs src-tauri/sidecar/__tests__/sidecar-ttl-cache-guards.test.mjs tests/local-logistics-panel.test.mjs tests/lifeline-runtime-wiring.test.mjs tests/place-briefs.test.mjs tests/saved-place-lifeline-pack-wiring.test.mjs tests/water-quality-wiring.test.mjs && tsx --test src/services/lifelines/__tests__/*.test.mts src/services/__tests__/offline-alert-cache.test.mts tests/comms-lifeline-context.test.mts tests/lifeline-evidence-expiry.test.mts tests/local-logistics.test.mts tests/local-logistics-prewarm.test.mts tests/place-briefs-lifelines.test.mts tests/saved-place-lifeline-pack.test.mts tests/saved-place-weather.test.mts tests/water-quality-truth.test.mts src/components/__tests__/feed-health-panel.test.mts src/components/__tests__/local-logistics-panel.test.mts src/components/__tests__/personal-storm-mode-shelf.test.mts src/services/diagnostics/__tests__/feed-catalog.test.mts
TAP version 13
# tests 155
# suites 0
# pass 155
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 819.357042
TAP version 13
# tests 183
# suites 0
# pass 183
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6620.79025
```

### Lifelines map

Command: `npm run test:lifelines-map`

```text
> crystal-ball@2.25.147 test:lifelines-map
> tsx --import ./tests/panels/register-hook.mjs --test tests/lifelines-map.test.mts tests/evacuation-routing.test.mts src/components/__tests__/map-popup-lifeline.test.mts && node --test api/osrm-route.test.mjs src-tauri/sidecar/__tests__/osrm-route.test.mjs tests/lifelines-map-wiring.test.mjs
TAP version 13
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2164.276333
TAP version 13
# tests 13
# suites 0
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 276.408667
```

### Type checking and lint

Command: `npm run typecheck:all`

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

Command: `npx eslint src/components/LocalLogisticsPanel.ts src/components/MapPopup.ts src/components/disaster-lifelines-map-helpers.ts`

```text
<empty; exit 0>
```

Command: `npm run lint:md`

```text
> crystal-ball@2.25.147 lint:md
> node scripts/lint-markdown.mjs

[lint:md] Checked 137 Markdown file(s).
```

### Documentation, roadmap, and secrets

Command: `npm run docs:check`

```text
> crystal-ball@2.25.147 docs:check
> node scripts/check-docs-freshness.mjs

[docs:check] Documentation appears fresh.
```

Command: `npm run roadmap:check`

```text
> crystal-ball@2.25.147 roadmap:check
> node scripts/roadmap-controller.mjs

<!-- crystal-ball-roadmap-controller:v1 -->
# Roadmap controller

Accuracy program: ACTIVE | Usability program: ACTIVE

BLOCKED: 1 | DONE: 44 | MONITOR: 1 | TODO: 10 | WAITING: 9

**Next eligible task:** UX-014 — Fuel operational evidence

## Blocking

- None.

## Advisory

- Next eligible task is UX-014: Fuel operational evidence
- UX-000 review overdue since 2026-08-31

<!-- roadmap-body-sha256:b8e7b92f951fe08292d78fb7c76593a824e365b3524ef2b322c497a253b2bfe4 -->
```

Command: `npm run secrets:scan`

```text
> crystal-ball@2.25.147 secrets:scan
> node scripts/secret-scan.mjs

Secret scan passed for 4727 file(s).
```

### Production build

Command: `npm run build`

```text
> crystal-ball@2.25.147 build
> tsc && vite build
```

The fresh command exited `0`. The full agentic gate was not rerun during this
evidence-only remediation. Its previously recorded pass remains historical;
the focused tests, type checks, lint, documentation, roadmap, secret scan, and
production build above are the fresh evidence for this cycle.

## Manual verification

1. Open Disaster Lifelines for a saved place with an OSM hotel result.
2. Confirm the panel card and map popup show the exact directory disclosure and
   four unknown states.
3. Confirm a valid number exposes `Call to confirm` only after a click and its
   accessible name names vacancy, current operation, power, and access.
4. Confirm a missing or malformed number shows the no-call disclosure and no
   call control while Maps and source context remain available.
5. Confirm an official shelter and a simulated future official hotel retain
   the generic call/evidence presentation.

## Rollback and remaining risk

Rollback is a normal revert of the presentation and focused tests; no data or
schema migration exists. The remaining risk is upstream directory staleness,
which is stated explicitly and cannot be resolved without a separately
approved, credentialed, license-compatible operational provider. The panel's
focused missing-phone test does not independently exercise a malformed phone;
the shared phone validator and popup malformed-phone path remain covered, but
this panel-specific coverage gap is nonblocking and unchanged in this
evidence-only cycle.
