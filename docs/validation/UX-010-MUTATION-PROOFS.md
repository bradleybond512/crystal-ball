<!-- markdownlint-disable MD013 -- exact command output and diff transcripts cannot wrap -->

# UX-010 Mutation Proofs

Date: 2026-08-29

Every proof started with `git status --short --untracked-files=no` producing no
output. Mutations and restores used `apply_patch`; each mutation was confirmed
with `git diff -- <file>`. After restore, the original SHA-256 was reproduced,
`git diff --exit-code -- <file>` exited zero, and the status command again
produced no output. Compiler warnings and passing-test detail unrelated to the
mutated behavior are omitted; the test summaries and failing assertions below
are exact command-output excerpts.

## 1. Native one-shot deadline

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Confirmed mutation:

```diff
-pub const LOCATION_DEADLINE_MS: u64 = 15_000;
+pub const LOCATION_DEADLINE_MS: u64 = 10_000;
```

Command:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test current_location_contract
```

Green output:

```text
running 9 tests
test current_location::tests::the_native_deadline_is_exactly_fifteen_seconds ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Mutated output:

```text
test current_location::tests::the_native_deadline_is_exactly_fifteen_seconds ... FAILED

thread 'current_location::tests::the_native_deadline_is_exactly_fifteen_seconds' (210125) panicked at tests/../src/current_location.rs:828:9:
assertion `left == right` failed
  left: 10000
 right: 15000

test result: FAILED. 8 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 2. Browser uncached one-shot policy

File: `src/services/location.ts`

Baseline and restored SHA-256:
`0ec0394277cc3551a1272566c40d8933eded997b1fadbcb5ea4dcbea9df2871b`

Confirmed mutation:

```diff
-      { enableHighAccuracy: true, timeout: LOCATION_REQUEST_TIMEOUT_MS, maximumAge: 0 },
+      { enableHighAccuracy: true, timeout: LOCATION_REQUEST_TIMEOUT_MS, maximumAge: 1 },
```

Command:

```bash
npx tsx --test src/services/__tests__/location.test.mts
```

Green output:

```text
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Mutated output:

```text
✖ browser acquisition is one-shot, uncached, and uses the fixed platform policy (5.216ms)
ℹ tests 8
ℹ pass 7
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  [
    {
      enableHighAccuracy: true,
+     maximumAge: 1,
-     maximumAge: 0,
      timeout: 15000
    },
```

## 3. Renderer private POST transport

File: `src/services/local-logistics.ts`

Baseline and restored SHA-256:
`ab4a20bf45d2210e65bfc7d4ebc21f3badb0b961c8a5c8f5dfdf307cacae9bd1`

Confirmed mutation:

```diff
-      method: 'POST',
+      method: 'GET',
```

Command:

```bash
npx tsx --test tests/ux010-ephemeral-local-logistics.test.mts
```

Green output:

```text
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Mutated output:

```text
✖ ephemeral Lifelines uses an exact private POST and never touches shared persistence or events (186.48325ms)
✖ ephemeral Lifelines maps every HTTP failure class without retry, GET, or cache fallback (6.328791ms)
ℹ tests 11
ℹ pass 9
ℹ fail 2

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'GET' !== 'POST'
```

## 4. Sidecar streaming body ceiling

File: `src-tauri/sidecar/local-api-server.mjs`

Baseline and restored SHA-256:
`459887e4bb2d24a962562eb73f23be405f764c630be58264beea1f515e93aaf3`

Confirmed mutation:

```diff
-const LOCAL_LOGISTICS_REQUEST_BODY_MAX_BYTES = 2048;
+const LOCAL_LOGISTICS_REQUEST_BODY_MAX_BYTES = 128;
```

Command:

```bash
node --test --test-name-pattern='desktop dynamic handler serves the same strict local-logistics v2 route' src-tauri/sidecar/__tests__/local-logistics-route.test.mjs
```

Green output:

```text
✔ desktop dynamic handler serves the same strict local-logistics v2 route (75.845458ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
[2026-08-29T23:48:08.354Z][stdout] [traffic] 23:48:08.354 POST /api/local-logistics → 413 1ms
✖ desktop dynamic handler serves the same strict local-logistics v2 route (69.227042ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

413 !== 200
```

## 5. Panel destruction clears accepted session data

File: `src/components/LocalLogisticsPanel.ts`

Baseline and restored SHA-256:
`0460be64bc4b124ea81a852ff8bb8b3f2b4e4c7185b0acd2f0ddd3da77eaab93`

Confirmed mutation:

```diff
    this.currentLocationError = null;
    this.pendingCurrentLocationFocus = null;
    this.pendingRadiusFocusKm = null;
-   this.snapshot = null;
    this.snapshotPlaceSignature = null;
```

Command:

```bash
npx tsx --test --test-name-pattern='destroy clears every accepted current-location snapshot owner' src/components/__tests__/ux010-current-location-panel.test.mts
```

Green output:

```text
✔ destroy clears every accepted current-location snapshot owner (539.218625ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ destroy clears every accepted current-location snapshot owner (558.802542ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+   snapshot: {
+     placeId: 'session-current-location',
+     placeName: 'Current location',
+     queryFingerprint: 'session-lifelines',
+     source: 'network'
+   },
-   snapshot: null,
```

The exact failure contained the full retained snapshot, including sites,
observations, nodes, providers, and timestamps; the excerpt retains the
identity fields and expected `null` assertion without duplicating that object.

## 6. Ordinary saved-place radius isolation

File: `src/components/SavedPlaceModal.ts`

Baseline and restored SHA-256:
`22b57b7d7d0f85d580a1fd605bf7e62a265531530a84d28fa365c66aa2a00a12`

Confirmed mutation:

```diff
- const radiusPresets = this.currentLocationConversion
-   ? CURRENT_LOCATION_RADIUS_PRESETS
-   : LEGACY_RADIUS_PRESETS;
+ const radiusPresets = CURRENT_LOCATION_RADIUS_PRESETS;
```

Command:

```bash
npx tsx --test --test-name-pattern='ordinary create and edit keep the legacy alert-radius presets' tests/ux010-current-location-save.test.mts
```

Green output:

```text
✔ ordinary create and edit keep the legacy alert-radius presets (42.513791ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ ordinary create and edit keep the legacy alert-radius presets (18.5195ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  [
+   '5',
+   '10',
+   '25',
    '50',
    '250',
    '1000',
    '3000'
  ]
```

## 7. Cancel-time conversion scrub

File: `src/components/SavedPlaceModal.ts`

Baseline and restored SHA-256:
`22b57b7d7d0f85d580a1fd605bf7e62a265531530a84d28fa365c66aa2a00a12`

Confirmed mutation:

```diff
  public close(): void {
- const closingCurrentLocationConversion = this.currentLocationConversion;
  if (this.pickModeActive) this.exitPickMode();
  this.overlay.classList.remove('active');
  document.removeEventListener('keydown', this.escapeHandler);
  if (this.searchDebounce) clearTimeout(this.searchDebounce);
  this.searchDebounce = null;
- if (closingCurrentLocationConversion) {
-   this.editingPlace = null;
-   this.formState = this.defaultFormState();
-   this.geocodeResults = [];
-   this.confirmingDelete = false;
- }
  this.currentLocationConversion = false;
  this.onCurrentLocationConfirmed = null;
  this.overlay.setAttribute('aria-label', 'Save Place');
- if (closingCurrentLocationConversion) this.render();
  }
```

Command:

```bash
npx tsx --test --test-name-pattern='current-location prefill is memory-only' tests/ux010-current-location-save.test.mts
```

Green output before mutation:

```text
✔ current-location prefill is memory-only, disclosed, and cancel clears it without a write (37.397958ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ current-location prefill is memory-only, disclosed, and cancel clears it without a write (18.867125ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'0' !== ''

    at TestContext.<anonymous> (tests/ux010-current-location-save.test.mts:89:10)
```

Restored green output:

```text
✔ current-location prefill is memory-only, disclosed, and cancel clears it without a write (23.797458ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## Behavior coverage matrix

| Behavior group | Production mutation proofs |
| --- | --- |
| Startup stays coarse and permission-free | 15 |
| Native one-shot scope, deadline, controller lifecycle, and exit cleanup | 1, 8, 16, 19, 20 |
| Native/browser response validation and uncached policy | 2, 17 |
| Renderer private transport and exact response schema | 3, 10 |
| Sidecar request bound and local-only fail-closed routing | 4, 9 |
| API origin rejection, private caching, and truthful provider votes | 11, 12, 18 |
| Panel ownership, stale-completion rejection, and event isolation | 5, 13, 14 |
| Saved-place radius isolation and cancel-time coordinate scrub | 6, 7 |

## 8. Native main-window boundary

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Confirmed mutation:

```diff
 fn is_main_window(label: &str) -> bool {
-    label == "main"
+    label != "main"
 }
```

Command:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test current_location_contract
```

Green output:

```text
running 9 tests
test current_location::tests::only_the_main_window_is_allowed ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Mutated output:

```text
test current_location::tests::only_the_main_window_is_allowed ... FAILED

thread 'current_location::tests::only_the_main_window_is_allowed' (409022) panicked at tests/../src/current_location.rs:748:9:
assertion failed: is_main_window("main")

test result: FAILED. 8 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 9. Sidecar local-only cloud-fallback boundary

File: `src-tauri/sidecar/local-api-server.mjs`

Baseline and restored SHA-256:
`459887e4bb2d24a962562eb73f23be405f764c630be58264beea1f515e93aaf3`

Confirmed mutation:

```diff
 function isLocalOnlyApiTarget(pathname) {
-  return pathname.startsWith('/api/local-');
+  return false;
 }
```

Command:

```bash
node --test --test-name-pattern='local routes never cloud-fallback|local-route handler failures|cached cloud preference' src-tauri/sidecar/local-api-server.test.mjs
```

Green output:

```text
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

Mutated output:

```text
✖ local routes never cloud-fallback their body or local bearer when fallback is enabled (71.79625ms)
✖ local-route handler failures stay private, local, and coordinate-free (8.659125ms)
✖ a cached cloud preference cannot bypass a local-only route (5.959375ms)
ℹ tests 3
ℹ pass 0
ℹ fail 3

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

200 !== 500
```

## 10. Renderer exact-key response boundary

File: `src/services/local-logistics.ts`

Baseline and restored SHA-256:
`ab4a20bf45d2210e65bfc7d4ebc21f3badb0b961c8a5c8f5dfdf307cacae9bd1`

Confirmed mutation:

```diff
 function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
-  const allowed = new Set([...required, ...optional]);
-  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
-    && Object.keys(value).every((key) => allowed.has(key));
+  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
 }
```

Command:

```bash
npx tsx --test tests/ux010-ephemeral-local-logistics.test.mts
```

Green output:

```text
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Mutated output:

```text
✖ ephemeral Lifelines rejects coordinate-bearing response metadata and never falls back (3.367875ms)
✖ ephemeral Lifelines rejects coordinate-bearing or arbitrary top-level response metadata (0.380041ms)
ℹ tests 11
ℹ pass 9
ℹ fail 2

AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

## 11. Session response private no-store policy

File: `api/local-logistics.js`

Baseline and restored SHA-256:
`4073eb084eeefc1b09f460550606e6fbfd061642f283d2e0ea20492948508b70`

Confirmed mutation:

```diff
   return json(body, 200, cors, {
-    'Cache-Control': isSession ? 'private, no-store' : 'public, max-age=300',
+    'Cache-Control': 'public, max-age=300',
   });
```

Command:

```bash
node --test --test-name-pattern='session POST keeps coordinates|session POST gives ODIN|session POST strips anchor-derived distances|session POST reports ODIN failure' api/local-logistics.test.mjs
```

Green output:

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Mutated output:

```text
✖ session POST keeps coordinates in its bounded body and returns no-store facility plus outage evidence (40.897875ms)
ℹ tests 4
ℹ pass 3
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'public, max-age=300'
- 'private, no-store'
```

## 12. Provider contribution reconciliation

File: `api/local-logistics.js`

Baseline and restored SHA-256:
`4073eb084eeefc1b09f460550606e6fbfd061642f283d2e0ea20492948508b70`

Confirmed mutation:

```diff
   const limited = dedupeResources(accepted)
     .sort((a, b) => a.site.distanceKm - b.site.distanceKm)
     .filter((row, index, rows) => rows.slice(0, index).filter((prior) => prior.site.kind === row.site.kind).length < limitPerCategory);
-  reconcileProviderContributions(providers, limited);
```

Command:

```bash
node --test api/local-logistics.test.mjs
```

Green output:

```text
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Mutated output:

```text
✖ FEMA open shelter fields are allowlisted, live, bounded, and deduplicate nearby OSM shelter (6.347542ms)
ℹ tests 23
ℹ pass 22
ℹ fail 1

AssertionError [ERR_ASSERTION]: a normalized row removed by downstream dedupe must not cast a healthy provider vote
+ actual - expected

-     'error',
-     0,
-     'no_contributed_rows'
+     'ok',
+     1,
+     undefined
```

## 13. Late ephemeral completion rejection

File: `src/components/LocalLogisticsPanel.ts`

Baseline and restored SHA-256:
`0460be64bc4b124ea81a852ff8bb8b3f2b4e4c7185b0acd2f0ddd3da77eaab93`

Confirmed mutation:

```diff
-   if (controller.signal.aborted || generation !== this.currentLocationGeneration
-     || this.anchorMode !== 'ephemeral' || this.currentLocationFix !== fix
-     || this.activeRadiusKm !== radiusKm) return;
+   if (false) return;
```

Command:

```bash
npx tsx --test --test-name-pattern='saved-place selection and newer radius fetches make late ephemeral completions inert' src/components/__tests__/ux010-current-location-panel.test.mts
```

Green output:

```text
✔ saved-place selection and newer radius fetches make late ephemeral completions inert (1955.236833ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ saved-place selection and newer radius fetches make late ephemeral completions inert (1874.983375ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: older fetch A must not replace newer fetch B

false !== true
```

## 14. Ephemeral expiry event isolation

File: `src/components/LocalLogisticsPanel.ts`

Baseline and restored SHA-256:
`0460be64bc4b124ea81a852ff8bb8b3f2b4e4c7185b0acd2f0ddd3da77eaab93`

Confirmed mutation:

```diff
  if (this.anchorMode === 'ephemeral') {
    if (this.snapshot === snapshot) this.render();
+   document.dispatchEvent(new CustomEvent('wm:local-logistics-updated', { detail: snapshot }));
    return;
  }
```

Command:

```bash
npx tsx --test --test-name-pattern='ephemeral evidence expiry repaints panel-owned status without publishing document events' src/components/__tests__/ux010-current-location-panel.test.mts
```

Green output:

```text
✔ ephemeral evidence expiry repaints panel-owned status without publishing document events (1302.451875ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ ephemeral evidence expiry repaints panel-owned status without publishing document events (1298.238209ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: ephemeral expiry must repaint without publishing or clearing shared state
+ actual - expected

+ [
+   'wm:local-logistics-updated'
+ ]
- []
```

## 15. Startup location-acquisition prohibition

File: `src/utils/user-location.ts`

Baseline and restored SHA-256:
`c085f7cba3a8887bf2485b020c3742d4df7f299e457f6ef5352c11d0f28f1c53`

Confirmed mutation:

```diff
 export function resolveUserRegion(): Promise<MapView> {
+  navigator.geolocation.getCurrentPosition(() => {});
   let tzRegion: MapView = 'global';
```

Command:

```bash
node --test tests/ux010-location-startup.test.mjs
```

Green output:

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Mutated output:

```text
✖ startup resolves only a coarse timezone region and never acquires location (3.255375ms)
ℹ tests 5
ℹ pass 4
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /locationService|getLocation|geolocation|latitude|longitude|coordsToRegion/.
```

## 16. Synchronous native exit cleanup

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Confirmed mutation:

```diff
 pub fn cleanup_on_exit() {
-    #[cfg(target_os = "macos")]
-    unsafe {
-        macos::cleanup_all_sessions_on_main_thread();
-    }
 }
```

Command:

```bash
node --test tests/ux010-location-startup.test.mjs
```

Green output:

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Mutated output:

```text
✖ app-exit cleanup runs synchronously on the macOS event-loop thread (2.524208ms)
ℹ tests 5
ℹ pass 4
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression /pub fn cleanup_on_exit/.
```

## 17. Exact native response envelopes

File: `src/services/location.ts`

Baseline and restored SHA-256:
`0ec0394277cc3551a1272566c40d8933eded997b1fadbcb5ea4dcbea9df2871b`

Confirmed mutation:

```diff
-  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
+  return expected.every((key) => actual.includes(key));
```

Command:

```bash
npx tsx --test src/services/__tests__/location.test.mts
```

Green output:

```text
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Mutated output:

```text
✖ malformed native envelopes fail closed without echoing their payload (2.572875ms)
ℹ tests 8
ℹ pass 7
ℹ fail 1

AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

## 18. Session origin rejection

File: `api/local-logistics.js`

Baseline and restored SHA-256:
`4073eb084eeefc1b09f460550606e6fbfd061642f283d2e0ea20492948508b70`

Confirmed mutation:

```diff
-  if (isDisallowedOrigin(req)) return originErrorResponse(isSession, cors);
+  if (false) return originErrorResponse(isSession, cors);
```

Command:

```bash
node --test --test-name-pattern='session POST rejects a disallowed origin' api/local-logistics.test.mjs
```

Green output:

```text
✔ session POST rejects a disallowed origin with the exact private error envelope (40.660208ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ session POST rejects a disallowed origin with the exact private error envelope (2545.812916ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

502 !== 403
```

## 19. Native controller cleanup lifecycle

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Confirmed mutation:

```diff
-        if !self.backend.cleanup(session) {
-            in_flight.keep_busy();
-            return NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable);
-        }
+        drop(session);
```

Command:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test current_location_contract
```

Green output:

```text
running 9 tests
test current_location::tests::lifecycle_cleans_up_exactly_once_on_success ... ok
test current_location::tests::timeout_cleans_up_and_ignores_a_late_callback ... ok
test current_location::tests::unconfirmed_cleanup_keeps_the_controller_fail_closed ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Mutated output:

```text
test current_location::tests::concurrent_attempts_fail_busy_without_starting_a_second_session ... FAILED
test current_location::tests::lifecycle_cleans_up_exactly_once_on_success ... FAILED
test current_location::tests::unconfirmed_cleanup_keeps_the_controller_fail_closed ... FAILED
test current_location::tests::timeout_cleans_up_and_ignores_a_late_callback ... FAILED

thread 'current_location::tests::lifecycle_cleans_up_exactly_once_on_success' (492675) panicked at tests/../src/current_location.rs:849:9:
assertion `left == right` failed
  left: 0
 right: 1

test result: FAILED. 5 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 20. Native concurrent-request exclusion

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Confirmed mutation:

```diff
-            return NativeLocationResponse::failure(NativeLocationErrorCode::Busy);
+            return NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable);
```

Command:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test current_location_contract
```

Green output:

```text
running 9 tests
test current_location::tests::concurrent_attempts_fail_busy_without_starting_a_second_session ... ok
test current_location::tests::unconfirmed_cleanup_keeps_the_controller_fail_closed ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

Mutated output:

```text
test current_location::tests::concurrent_attempts_fail_busy_without_starting_a_second_session ... FAILED
test current_location::tests::unconfirmed_cleanup_keeps_the_controller_fail_closed ... FAILED

thread 'current_location::tests::concurrent_attempts_fail_busy_without_starting_a_second_session' (495539) panicked at tests/../src/current_location.rs:886:9:
assertion failed: matches!(controller.run(Duration::from_millis(1)),
    NativeLocationResponse::Failure
    {
        error: NativeLocationError { code: NativeLocationErrorCode::Busy }, ..
    })

test result: FAILED. 7 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 21. Native-controller targeted-test selection

File: `scripts/targeted-tests.mjs`

Baseline and restored SHA-256:
`b133d752859d927219275b0ccfd734eefe385d62f1a9353756d1c81087fd694f`

Confirmed mutation:

```diff
-  'src-tauri/src/current_location.rs': ['test:ux010-native'],
```

Command:

```bash
npm run test:agentic-pipeline
```

Green output:

```text
✔ the UX-010 native controller selects its focused wiring suite (0.098042ms)
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

Mutated output:

```text
✖ the UX-010 native controller selects its focused wiring suite (2.113459ms)
ℹ tests 40
ℹ pass 39
ℹ fail 1

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
actual: { scripts: [], unmapped: [ 'src-tauri/src/current_location.rs' ] }
expected: { scripts: [ 'test:ux010-native' ], unmapped: [] }
```

The original GitHub failure independently exercised the rollout boundary: the
trusted `main` selector rejected `src-tauri/src/current_location.rs` as a `NEW
GAP`. The same commit adds the temporary reviewed baseline bridge required until
the new override itself lands on `main`.

## 22. Mapped native gate executes lifecycle contracts

File: `src-tauri/src/current_location.rs`

Baseline and restored SHA-256:
`595ae275e5f81db0ca6b6996ab8bf779be24c9391adb0e87b8301f6ae71e8ff8`

Focused gate file SHA-256:
`80fc41efd5f82934db78b84eed7f9fe892cf62deb545399e25cf5457830d5eda`

Confirmed mutation:

```diff
-        if !self.backend.cleanup(session) {
-            in_flight.keep_busy();
-            return NativeLocationResponse::failure(NativeLocationErrorCode::Unavailable);
-        }
+        drop(session);
```

Command selected by the `src-tauri/src/current_location.rs` override:

```bash
npm run test:ux010-native
```

Green output:

```text
✔ focused native gate executes the current-location Rust contract (16088.350708ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Mutated output:

```text
✖ focused native gate executes the current-location Rust contract (15877.907667ms)
ℹ tests 6
ℹ pass 5
ℹ fail 1

test current_location::tests::concurrent_attempts_fail_busy_without_starting_a_second_session ... FAILED
test current_location::tests::lifecycle_cleans_up_exactly_once_on_success ... FAILED
test current_location::tests::timeout_cleans_up_and_ignores_a_late_callback ... FAILED
test current_location::tests::unconfirmed_cleanup_keeps_the_controller_fail_closed ... FAILED
test result: FAILED. 5 passed; 4 failed; 0 ignored; 0 measured; 0 filtered out
```

The mapped runner remains a single trusted `node --test` stage, while its
focused gate executes and verifies the exact Rust contract command. This keeps
the selector's command boundary intact and makes native lifecycle regressions
block the targeted gate.

## 23. Targeted CI pins the Rust toolchain

File: `.github/workflows/targeted-tests.yml`

Baseline and restored SHA-256:
`10d1c821b7bbba74fcd75fc512fe208484951dc2d59cb9a24efc8a43f1eff033`

Confirmed mutation:

```diff
-          toolchain: '1.93.1'
+          toolchain: stable
```

Command:

```bash
npx tsx --test --test-name-pattern='targeted CI provisions' tests/agentic-pipeline.test.mjs
```

Green output:

```text
✔ targeted CI provisions a pinned least-privilege Ubuntu Rust contract runner (3.619625ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ targeted CI provisions a pinned least-privilege Ubuntu Rust contract runner (3.576291ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/toolchain: '1\.93\.1'/.
```

## 24. Targeted CI provisions WebKitGTK headers

File: `.github/workflows/targeted-tests.yml`

Baseline and restored SHA-256:
`10d1c821b7bbba74fcd75fc512fe208484951dc2d59cb9a24efc8a43f1eff033`

Confirmed mutation:

```diff
-            libwebkit2gtk-4.1-dev \
```

Command:

```bash
npx tsx --test --test-name-pattern='targeted CI provisions' tests/agentic-pipeline.test.mjs
```

Green output:

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ targeted CI provisions a pinned least-privilege Ubuntu Rust contract runner (3.590792ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/libwebkit2gtk-4\.1-dev/.
```

## 25. Targeted CI retains the pinned Rust cache

File: `.github/workflows/targeted-tests.yml`

Baseline and restored SHA-256:
`10d1c821b7bbba74fcd75fc512fe208484951dc2d59cb9a24efc8a43f1eff033`

Confirmed mutation:

```diff
-      - name: Rust cache
-        uses: swatinem/rust-cache@ad397744b0d591a723ab90405b7247fac0e6b8db
-        with:
-          workspaces: './src-tauri -> target'
-          cache-on-failure: true
```

Command:

```bash
npx tsx --test --test-name-pattern='targeted CI provisions' tests/agentic-pipeline.test.mjs
```

Green output:

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ targeted CI provisions a pinned least-privilege Ubuntu Rust contract runner (2.990958ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the pinned
swatinem/rust-cache action and workspace configuration.
```

## 26. Targeted CI pins the Ubuntu runner family

File: `.github/workflows/targeted-tests.yml`

Baseline and restored SHA-256:
`10d1c821b7bbba74fcd75fc512fe208484951dc2d59cb9a24efc8a43f1eff033`

Confirmed mutation:

```diff
-    runs-on: ubuntu-24.04
+    runs-on: ubuntu-latest
```

Command:

```bash
npx tsx --test --test-name-pattern='targeted CI provisions' tests/agentic-pipeline.test.mjs
```

Green output:

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ targeted CI provisions a pinned least-privilege Ubuntu Rust contract runner (3.296583ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/runs-on: ubuntu-24\.04/.
```

## 27. Native gate generates the ignored Tauri resource before Cargo

File: `tests/ux010-native-gate.test.mjs`

Baseline and restored SHA-256:
`470c216185ab6bb0b8b4298873ff2a38fe939d6fd8a5728b535c033387ead402`

Confirmed mutation:

```diff
diff --git a/tests/ux010-native-gate.test.mjs b/tests/ux010-native-gate.test.mjs
index c163cf3a..a83cd101 100644
--- a/tests/ux010-native-gate.test.mjs
+++ b/tests/ux010-native-gate.test.mjs
@@ -6,21 +6,6 @@ import { fileURLToPath } from 'node:url';
 const root = fileURLToPath(new URL('..', import.meta.url));

 test('focused native gate executes the current-location Rust contract', () => {
-  const bundle = spawnSync(process.execPath, [
-    'scripts/build-sidecar-xmpp.mjs',
-  ], {
-    cwd: root,
-    encoding: 'utf8',
-    maxBuffer: 10 * 1024 * 1024,
-    timeout: 60_000,
-  });
-  const bundleOutput = `${bundle.stdout ?? ''}\n${bundle.stderr ?? ''}`;
-
-  assert.equal(bundle.error, undefined, bundleOutput);
-  assert.equal(bundle.signal, null, bundleOutput);
-  assert.equal(bundle.status, 0, bundleOutput);
-  assert.match(bundleOutput, /build:sidecar-xmpp\s+src-tauri\/sidecar\/s2u-xmpp\.bundle\.mjs/);
-
   const result = spawnSync('cargo', [
     'test',
     '--manifest-path',
```

Focused pipeline command:

```bash
npx tsx --test --test-name-pattern='native gate generates' tests/agentic-pipeline.test.mjs
```

Green output:

```text
✔ the UX-010 native gate generates its ignored Tauri resource before Cargo
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ the UX-010 native gate generates its ignored Tauri resource before Cargo
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/spawnSync\(process\.execPath, \[\s*'scripts\/build-sidecar-xmpp\.mjs',?\s*\]/.
```

With the ignored generated resource moved out of the worktree, the same
mutation also made the mapped native suite prove the clean-checkout failure:

```bash
npm run test:ux010-native
```

```text
ℹ tests 6
ℹ pass 5
ℹ fail 1

error: failed to run custom build command for `crystalball v2.25.147`
resource path `sidecar/s2u-xmpp.bundle.mjs` doesn't exist
```

The ignored resource was restored, the source checksum matched the baseline,
and the restored native suite returned `6 passed / 0 failed` with the nested
Rust contract returning `9 passed / 0 failed`.

## 28. Full UX-010 suite cannot bypass the self-contained native gate

File: `package.json`

Baseline and restored SHA-256:
`a47673d059076f0dfe8f5485d263619536a4a95592a634a34a617a08ff433631`

Confirmed mutation:

```diff
-    ... && npm run build:full && node --test tests/ux010-native-gate.test.mjs
+    ... && npm run build:full && cargo test --manifest-path src-tauri/Cargo.toml --test current_location_contract
```

Command:

```bash
npx tsx --test --test-name-pattern='native gate generates' tests/agentic-pipeline.test.mjs
```

Green output:

```text
✔ the UX-010 native gate generates its ignored Tauri resource before Cargo
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
✖ the UX-010 native gate generates its ignored Tauri resource before Cargo
ℹ tests 1
ℹ pass 0
ℹ fail 1

AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/&& node --test tests\/ux010-native-gate\.test\.mjs$/.
```

After restoration, the `package.json` checksum matched the baseline and the
tracked working tree was clean.
