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
`03e8dc442029cb54bace9896042163c11dfc08c9e67b02b416e5a7f55e1c8882`

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
✔ desktop dynamic handler serves the same strict local-logistics v2 route (192.93225ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Mutated output:

```text
[2026-08-29T21:17:14.949Z][stdout] [traffic] 21:17:14.949 POST /api/local-logistics → 413 1ms
✖ desktop dynamic handler serves the same strict local-logistics v2 route (80.286417ms)
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
