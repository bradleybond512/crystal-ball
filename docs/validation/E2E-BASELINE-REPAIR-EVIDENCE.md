# E2E Baseline Repair Evidence

## MapContainer early-camera replay

### Behavior

- An early `setCenter()` call is retained while the selected DeckGL or SVG delegate is not ready.
- Latitude or longitude `0` remains valid; non-finite and out-of-range coordinates do not replace the last valid pending camera.
- `getCenter()` and `getState().zoom` expose the pending camera before renderer readiness.
- Renderer initialization replays the camera once and clears it. SVG preserves the established center-then-zoom call order.

### Test-first evidence

Command:

```text
npx tsx --import ./tests/panels/register-hook.mjs --test src/components/__tests__/map-container-pending-center.test.mts
```

Before implementation: `0 pass / 4 fail`. Failures reported a null center, a missing `replayPendingCenter()` method, no SVG replay events, and the unchanged initial-state reference.

After implementation: `4 pass / 0 fail`.

Original end-to-end reproduction:

```text
E2E_PORT=4210 npx playwright test e2e/mobile-map-native.spec.ts --grep "zero-degree coordinates"
```

Result: `1 passed / 0 failed`. The existing zero-coordinate assertion was unchanged.

### Mutation proof

- Mutated file: `src/components/MapContainer.ts`
- Before checksum: `cf178b49d8b3e3dbe9b60afa30e59d63bcf2493f8b0f619e2a169a704c058268`
- Confirmed mutation: changed `isValidCenter()` from `return Number.isFinite(lat)` to `return false && Number.isFinite(lat)`, disabling only early-camera retention.
- Red result: `0 pass / 4 fail`. The assertions failed for DeckGL pending center, SVG replay, retained valid center, and non-mutating pending state.
- Restored checksum: `cf178b49d8b3e3dbe9b60afa30e59d63bcf2493f8b0f619e2a169a704c058268`
- Restored result: `4 pass / 0 fail`.

The shared prerequisite worktree already contained uncommitted circuit-breaker and God's Vision E2E repairs before this scoped change, so a globally empty `git status --short` was unavailable. The identical before/restored checksum and confirmed one-line mutation establish restoration of the owned production file; unrelated edits were not touched.

### Validation

- `npm run test:renderer`: `14710 pass / 0 fail`.
- `bash scripts/agentic-validate.sh --tests "test:renderer"`: passed. The gate reran `14710 pass / 0 fail`, then passed lockfile validation, strict lint, all TypeScript checks, secret scanning, cross-agent readiness, documentation freshness, roadmap integrity, and the production build.
- Build completed with existing chunk-size and ineffective-dynamic-import warnings; no error was reported.

## E2E fixture and variant isolation

### Behavior

- Runtime fallback mocks normalize relative and absolute request inputs, identify the sidecar only by loopback host plus port `46123`, and treat every other origin as the configurable remote. The assertions verify the local attempt, remote fallback, response payload, query preservation, and `X-CrystalBall-Key` forwarding without assuming a deployment hostname.
- Happy-theme checks run only with the happy CSS bundle through `test:e2e:happy`, which is part of the aggregate E2E command. They boot with the UI-only fixture, deterministic onboarding/analytics state, and the visible theme button selected by semantic role and accessible name while retaining the exact active-token assertions.
- God's Eye checks use the UI-only fixture with deterministic onboarding and declined/seen analytics consent. Their selectors and default-theme assertion match the current HUD contract.
- Persistent circuit-breaker checks reflect stale-while-revalidate behavior: usable stale data is returned immediately as `cached`, a background refresh updates persistent data and state to `live`, and a failed refresh retains the stale `cached` state.

### Test-first and regression evidence

Runtime baseline command:

```text
E2E_PORT=4241 VITE_VARIANT=full npx playwright test e2e/runtime-fetch.spec.ts -g 'falls back to cloud for local failures|cloud fallback is allowed with a valid CrystalBall API key'
```

Baseline result: `0 pass / 1 fail`; the fallback response was the mock's generic body, so FRED `observations[0].value` was `null` instead of `321.5`. The second grep alternative did not match because the test name includes the word `allowed`.

Theme baseline command:

```text
E2E_PORT=4243 VITE_VARIANT=full npx playwright test e2e/theme-toggle.spec.ts -g 'dark mode persists across page reload'
```

Baseline result: `0 pass / 1 fail`; the test timed out after the analytics `.cb-backdrop` intercepted the raw `#headerThemeToggle` click while full data startup continued.

Green commands:

```text
E2E_PORT=4244 VITE_VARIANT=full npx playwright test e2e/runtime-fetch.spec.ts
E2E_PORT=4245 npm run test:e2e:happy
E2E_PORT=4247 VITE_VARIANT=full npx playwright test e2e/circuit-breaker-persistence.spec.ts
npx tsc --noEmit
npx eslint e2e/circuit-breaker-persistence.spec.ts e2e/gods-vision-mode.spec.ts e2e/runtime-fetch.spec.ts e2e/theme-toggle.spec.ts
```

Results: runtime `12 pass / 0 fail`; happy theme `8 pass / 0 fail`; circuit breaker `7 pass / 0 fail`; TypeScript and ESLint exited `0` with no diagnostics.

The first God's Eye repair run reached `3 pass / 2 fail / 3 not run`; two later tests missed the 5-second activation wait while Cesium and external feed startup continued. A focused HUD rerun before deterministic network isolation also failed `0 pass / 1 fail`: `.gods-vision-active` did not become visible within 5 seconds and the run took 19.0 seconds. The fixture now preloads the view module and intercepts API/external requests while continuing same-origin application assets. The unchanged full spec then passed:

```text
E2E_PORT=4264 VITE_VARIANT=full npx playwright test e2e/gods-vision-mode.spec.ts
```

Result: `8 pass / 0 fail` in 2.2 minutes.

The aggregate validation rerun exposed one remaining timing race: the neutral-theme case still used the former 5-second selector wait and reported `0 pass / 1 fail` for that case while the same locator became visible just after the deadline. All activation checks now share Playwright's class assertion with a 15-second bound. TypeScript and ESLint again exited `0` with no diagnostics, and the complete isolated spec passed:

```text
E2E_PORT=4266 VITE_VARIANT=full npx playwright test e2e/gods-vision-mode.spec.ts
```

Result: `8 pass / 0 fail` in 2.9 minutes.

The complete Full-variant E2E baseline then passed:

```text
E2E_PORT=4265 npm run test:e2e:full
```

Result: `80 pass / 0 fail / 9 skipped` in 11.3 minutes. The skips are the eight happy-only theme checks plus the existing finance-only GCC layer check.

### Mutation proofs

Runtime URL classification:

- Mutated file: `e2e/runtime-fetch.spec.ts`
- Before checksum: `765106178cfcea662085f2c1a2e57632a45b9b6c5cbabf117dbcb22f2b8831e3`
- Confirmed mutation: removed the `url.port === '46123'` condition from the first fallback mock so the Playwright server origin was misclassified as the sidecar.
- Red command: `E2E_PORT=4251 VITE_VARIANT=full npx playwright test e2e/runtime-fetch.spec.ts -g 'runtime fetch patch falls back to cloud for local failures'`
- Red result: `0 pass / 1 fail`; expected fallback HTTP `200`, received local-mock HTTP `500`.
- Restored checksum: `765106178cfcea662085f2c1a2e57632a45b9b6c5cbabf117dbcb22f2b8831e3`.

Circuit-breaker stale-first contract:

- Mutated file: `e2e/circuit-breaker-persistence.spec.ts`
- Before checksum: `0fa45944f046c7db47635ef1423b574b627c3eae7cd39548f0713920fa7c825c`
- Confirmed mutation: restored the obsolete immediate-result expectation from stale `111` to refreshed `222`.
- Red command: `E2E_PORT=4248 VITE_VARIANT=full npx playwright test e2e/circuit-breaker-persistence.spec.ts -g 'expired persistent entry triggers fresh fetch'`
- Red result: `0 pass / 1 fail`; expected `222`, received the intentionally immediate stale value `111`.
- Restored checksum: `0fa45944f046c7db47635ef1423b574b627c3eae7cd39548f0713920fa7c825c`.
- Restored command result: `E2E_PORT=4249 VITE_VARIANT=full npx playwright test e2e/circuit-breaker-persistence.spec.ts -g 'expired persistent entry triggers fresh fetch'` reported `1 pass / 0 fail`.

The fixture-only UI isolation and selector changes do not alter production behavior. Attempts to remove only the visibility filter or only the consent/onboarding seeds remained green under the UI-only harness, so they are not presented as mutation proofs.

## Final validation

The first aggregate gate attempt stopped in the renderer suite at `14709 pass / 1 fail`: under full-suite load, the expired-hotel assertion checked the DOM before its asynchronous panel render completed. The same file immediately passed in isolation at `13 pass / 0 fail`. The assertion now polls for the specific card for at most two seconds instead of treating the shared 180 ms settle delay as proof that rendering completed. The focused file again passed `13 pass / 0 fail`, and TypeScript plus focused ESLint exited `0` with no diagnostics.

The final required gate passed:

```text
bash scripts/agentic-validate.sh --tests "test:renderer test:e2e:runtime test:e2e:full test:e2e:happy"
```

The gate reported `Agentic validation gate passed.` after the renderer suite, runtime E2E, Full-variant E2E, Happy-theme E2E, lockfile validation, strict lint, both TypeScript projects, secret scanning, cross-agent readiness, documentation freshness, roadmap integrity, and the production build. The Full-variant run recovered one initial map-harness readiness miss on its configured retry; the retry and all remaining tests passed.
