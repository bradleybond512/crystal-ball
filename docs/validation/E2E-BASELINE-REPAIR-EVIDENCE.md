# E2E Baseline Repair Evidence

## MapContainer early-camera replay

### Behavior

- An early `setCenter()` call is retained while the selected DeckGL or SVG delegate is not ready.
- Latitude or longitude `0` remains valid; non-finite and out-of-range coordinates do not replace the last valid pending camera.
- `getCenter()` and `getState().zoom` expose the pending camera before renderer readiness.
- Renderer initialization replays the camera once and clears it. SVG preserves the established center-then-zoom call order.

### Mutation proof

The proof was repeated from committed tip `085017c67` with an empty `git status --short`. Before checksum:

```text
cf178b49d8b3e3dbe9b60afa30e59d63bcf2493f8b0f619e2a169a704c058268  src/components/MapContainer.ts
```

Applied diff:

```diff
@@ -257,8 +257,7 @@ export class MapContainer {
   private isValidCenter(lat: number, lon: number): boolean {
- return Number.isFinite(lat) && lat >= -90 && lat <= 90
-   && Number.isFinite(lon) && lon >= -180 && lon <= 180;
+ return false;
   }
```

Verbatim red summary and first failing assertion from `npx tsx --test src/components/__tests__/map-container-pending-center.test.mts`:

```text
✖ DeckGL startup retains a zero-coordinate camera until the delegate is ready
✖ SVG fallback replays an early camera with the established center-then-zoom order
✖ invalid early coordinates cannot replace the last valid pending camera
✖ pending camera state does not mutate the initial state object
ℹ tests 4
ℹ suites 0
ℹ pass 0
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
+ null
- {
-   lat: 0,
-   lon: 0
- }
```

After restoration, the checksum again matched and `git status --short` again emitted no output. Verbatim green summary:

```text
✔ DeckGL startup retains a zero-coordinate camera until the delegate is ready
✔ SVG fallback replays an early camera with the established center-then-zoom order
✔ invalid early coordinates cannot replace the last valid pending camera
✔ pending camera state does not mutate the initial state object
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## E2E fixture and variant isolation

### Behavior

- Runtime fallback mocks normalize relative and absolute request inputs, identify the sidecar only by loopback host plus port `46123`, and treat every other origin as the configurable remote. The assertions verify the local attempt, remote fallback, response payload, query preservation, and `X-CrystalBall-Key` forwarding without assuming a deployment hostname.
- Happy-theme checks run only with the happy CSS bundle through `test:e2e:happy`, which is part of the aggregate E2E command. They boot with the UI-only fixture, deterministic onboarding/analytics state, and the visible theme button selected by semantic role and accessible name while retaining the exact active-token assertions.
- God's Eye checks use the UI-only fixture with deterministic onboarding and declined/seen analytics consent. Their selectors and default-theme assertion match the current HUD contract.
- Persistent circuit-breaker checks reflect stale-while-revalidate behavior: usable stale data is returned immediately as `cached`, a background refresh updates persistent data and state to `live`, and a failed refresh retains the stale `cached` state.

### Test-first and regression evidence

The diagnosed baseline failures were stale fixture assumptions: runtime mocks classified URLs by a deployment hostname, theme checks ran against the wrong compiled variant and raced consent UI, God's Eye checks depended on live startup and retired selectors, and the circuit-breaker check expected a background refresh synchronously. The repaired suites produced these verbatim summaries:

```text
12 passed (8.6s)
7 passed (4.9s)
8 passed (2.9m)
8 passed (31.7s)
```

Those lines are respectively the runtime, circuit-breaker, God's Eye, and Happy-theme Playwright summaries. `npx tsc --noEmit` and focused ESLint both exited `0` with no diagnostics. The standalone Full-variant run ended with:

```text
9 skipped
80 passed (11.3m)
```

### Mutation proofs

Runtime URL classification:

The proof started from committed tip `085017c67` with an empty `git status --short`. Before checksum:

```text
765106178cfcea662085f2c1a2e57632a45b9b6c5cbabf117dbcb22f2b8831e3  e2e/runtime-fetch.spec.ts
```

Applied diff:

```diff
@@ -106,7 +106,7 @@ test.describe('desktop runtime routing guardrails', () => {
-\t  const isLocal = url.hostname === '127.0.0.1' && url.port === '46123';
+\t  const isLocal = url.hostname === '127.0.0.1';
```

Verbatim red output from `E2E_PORT=4267 VITE_VARIANT=full npx playwright test e2e/runtime-fetch.spec.ts -g "runtime fetch patch falls back to cloud for local failures"`:

```text
Running 1 test using 1 worker
✘  1 [chromium] › e2e/runtime-fetch.spec.ts:79:3 › desktop runtime routing guardrails › runtime fetch patch falls back to cloud for local failures
Expected: 200
Received: 500
> 171 |  expect(result.fredStatus).toBe(200);
1 failed
  [chromium] › e2e/runtime-fetch.spec.ts:79:3 › desktop runtime routing guardrails › runtime fetch patch falls back to cloud for local failures
```

After restoration, the checksum again matched and `git status --short` again emitted no output. Verbatim green output:

```text
Running 1 test using 1 worker
✓  1 [chromium] › e2e/runtime-fetch.spec.ts:79:3 › desktop runtime routing guardrails › runtime fetch patch falls back to cloud for local failures
1 passed (3.0s)
```

Circuit-breaker stale-first contract:

The proof started with an empty `git status --short`. Before checksum:

```text
0fa45944f046c7db47635ef1423b574b627c3eae7cd39548f0713920fa7c825c  e2e/circuit-breaker-persistence.spec.ts
```

Applied diff:

```diff
@@ -166,7 +166,7 @@ test.describe('circuit breaker persistent cache', () => {
- expect(result.result).toBe(111);
+ expect(result.result).toBe(222);
```

Verbatim red output from `E2E_PORT=4269 VITE_VARIANT=full npx playwright test e2e/circuit-breaker-persistence.spec.ts -g "expired persistent entry triggers fresh fetch"`:

```text
Running 1 test using 1 worker
✘  1 [chromium] › e2e/circuit-breaker-persistence.spec.ts:92:3 › circuit breaker persistent cache › expired persistent entry triggers fresh fetch (TTL respected)
Expected: 222
Received: 111
> 169 |  expect(result.result).toBe(222);
1 failed
  [chromium] › e2e/circuit-breaker-persistence.spec.ts:92:3 › circuit breaker persistent cache › expired persistent entry triggers fresh fetch (TTL respected)
```

After restoration, the checksum again matched and `git status --short` again emitted no output. Verbatim green output:

```text
Running 1 test using 1 worker
✓  1 [chromium] › e2e/circuit-breaker-persistence.spec.ts:92:3 › circuit breaker persistent cache › expired persistent entry triggers fresh fetch (TTL respected)
1 passed (3.6s)
```

The fixture-only UI isolation and selector changes do not alter production behavior. Attempts to remove only the visibility filter or only the consent/onboarding seeds remained green under the UI-only harness, so they are not presented as mutation proofs.

## Final validation

The first aggregate gate exposed a full-suite timing miss in the expired-hotel assertion. Verbatim output:

```text
ℹ tests 14710
ℹ suites 1110
ℹ pass 14709
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
✖ expired hotel card composes expiry and omits missing or malformed call controls
AssertionError [ERR_ASSERTION]: [data-logistics-node-card="hotel-no-phone"] should be rendered
```

The assertion now polls for that specific card for at most two seconds instead of treating the shared 180 ms settle delay as proof that rendering completed. Verbatim focused rerun summary:

```text
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npx tsc --noEmit` and focused ESLint each exited `0` with no diagnostics.

The final required gate passed:

```text
bash scripts/agentic-validate.sh --tests "test:renderer test:e2e:runtime test:e2e:full test:e2e:happy"
```

Verbatim final gate excerpts:

```text
ℹ tests 14710
ℹ suites 1110
ℹ pass 14710
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

12 passed (8.6s)

8 passed (31.7s)

Agentic validation gate passed.
Tests run: test:renderer test:e2e:runtime test:e2e:full test:e2e:happy
```

The gate then passed lockfile validation, strict lint, both TypeScript projects, secret scanning, cross-agent readiness, documentation freshness, roadmap integrity, and the production build. The Full-variant run recovered one initial map-harness readiness miss on its configured retry; the retry and all remaining tests passed.
