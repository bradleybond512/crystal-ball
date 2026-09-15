<!-- markdownlint-disable MD013 -- literal diffs and test output -->

# UX-026 Cached-GDACS Correction: Literal Mutation Evidence

Candidate: `f977aee1f289014746442d6cf4c7973014ad7747`. Isolated detached worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/ux026-fifth-proofs-20260914`.

All three new mutations produced real assertion failures. Baseline and restored runtime suite: **21 pass / 0 fail / 0 skipped**. No dependency install or heavy test overlapped the parent’s native WKWebView quiet run; execution began after its explicit release.

The prior fourth-cycle 57-proof ledger is historical and unchanged. Its cached-GDACS exclusion proof (case 52) does not establish the corrected product requirement; the three proofs here replace that behavior claim. Unchanged prior proofs were not rerun.

## Command and restoration

`PATH=/opt/homebrew/opt/node@22/bin:$PATH node --import tsx --test --test-reporter=spec tests/ux026-fourth-cycle-runtime.test.mjs`

Each mutation started with empty `git status --short`; original file bytes and SHA-256 were recorded using Python hashlib. Its nonempty applied Git diff was captured before the test. The file was restored byte-for-byte with matching SHA-256 and empty status before the next mutation. No delivery source or tests were edited.

[Baseline output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/baseline-runtime.log) · [Restored output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/restored-runtime.log)

## 01-cached-gdacs-retention

File: `src/components/FAAWeatherCamsPanel.ts`. Baseline 21 pass/0 fail → mutation 18 pass/3 fail, exit 1 → restored 21 pass/0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/FAAWeatherCamsPanel.ts b/src/components/FAAWeatherCamsPanel.ts
index 237c448e6..c849b7108 100644
--- a/src/components/FAAWeatherCamsPanel.ts
+++ b/src/components/FAAWeatherCamsPanel.ts
@@ -54,7 +54,7 @@ export class FAAWeatherCamsPanel extends Panel {
  if (raw.status === 'fulfilled' && (!this.cameraUnavailable || raw.value.cameras.length > 0)) {
  this.cameras = scoreCamerasAgainstAlerts(raw.value.cameras,
  nws.status === 'fulfilled' ? nws.value : [],
- gdacs.status === 'fulfilled' && (gdacs.value.dataState.mode === 'live' || gdacs.value.dataState.mode === 'cached')
+ gdacs.status === 'fulfilled' && gdacs.value.dataState.mode === 'live'
  ? gdacs.value.events : []).map(cam => this.gdacsCached && cam.alertLabel?.startsWith('GDACS ')
  ? { ...cam, alertLabel: `${cam.alertLabel} (cached context)` }
  : cam);
```

Literal failure excerpt:

```text
✖ GDACS tracked unavailable and cached results qualify the alert-only view (20.644833ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + []
  - [
  -   {
  -     id: 'old-flood'
  -   }
  - ]

```

Literal counts:

```text
ℹ tests 21
ℹ pass 18
ℹ fail 3
ℹ skipped 0
```

Original/restored SHA-256: `d7ac9d985c5ced22f32061b6e33016eb67323aee1f83bab0291847098a054f47`. Restored Git status: empty.

[Complete literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/01-cached-gdacs-retention.log)

## 02-cached-label-qualification

File: `src/components/FAAWeatherCamsPanel.ts`. Baseline 21 pass/0 fail → mutation 19 pass/2 fail, exit 1 → restored 21 pass/0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/FAAWeatherCamsPanel.ts b/src/components/FAAWeatherCamsPanel.ts
index 237c448e6..93dedc42c 100644
--- a/src/components/FAAWeatherCamsPanel.ts
+++ b/src/components/FAAWeatherCamsPanel.ts
@@ -56,7 +56,7 @@ export class FAAWeatherCamsPanel extends Panel {
  nws.status === 'fulfilled' ? nws.value : [],
  gdacs.status === 'fulfilled' && (gdacs.value.dataState.mode === 'live' || gdacs.value.dataState.mode === 'cached')
  ? gdacs.value.events : []).map(cam => this.gdacsCached && cam.alertLabel?.startsWith('GDACS ')
- ? { ...cam, alertLabel: `${cam.alertLabel} (cached context)` }
+ ? { ...cam, alertLabel: cam.alertLabel }
  : cam);
  if (this.selectedCam) this.selectedCam = this.cameras.find(cam => cam.id === this.selectedCam?.id) ?? null;
  }
```

Literal failure excerpt:

```text
✖ actual healthy GDACS TTL cache retains the flood camera and qualifies row and viewer context (38.883625ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /GDACS FL — Nearby flood.*cached context/. Input:

  'Working cameraILGDACS FL — Nearby flood5013h ago'

```

Literal counts:

```text
ℹ tests 21
ℹ pass 19
ℹ fail 2
ℹ skipped 0
```

Original/restored SHA-256: `d7ac9d985c5ced22f32061b6e33016eb67323aee1f83bab0291847098a054f47`. Restored Git status: empty.

[Complete literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/02-cached-label-qualification.log)

## 03-preserve-nws-label

File: `src/components/FAAWeatherCamsPanel.ts`. Baseline 21 pass/0 fail → mutation 20 pass/1 fail, exit 1 → restored 21 pass/0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/FAAWeatherCamsPanel.ts b/src/components/FAAWeatherCamsPanel.ts
index 237c448e6..96afc5a4e 100644
--- a/src/components/FAAWeatherCamsPanel.ts
+++ b/src/components/FAAWeatherCamsPanel.ts
@@ -55,7 +55,7 @@ export class FAAWeatherCamsPanel extends Panel {
  this.cameras = scoreCamerasAgainstAlerts(raw.value.cameras,
  nws.status === 'fulfilled' ? nws.value : [],
  gdacs.status === 'fulfilled' && (gdacs.value.dataState.mode === 'live' || gdacs.value.dataState.mode === 'cached')
- ? gdacs.value.events : []).map(cam => this.gdacsCached && cam.alertLabel?.startsWith('GDACS ')
+ ? gdacs.value.events : []).map(cam => this.gdacsCached
  ? { ...cam, alertLabel: `${cam.alertLabel} (cached context)` }
  : cam);
  if (this.selectedCam) this.selectedCam = this.cameras.find(cam => cam.id === this.selectedCam?.id) ?? null;
```

Literal failure excerpt:

```text
✖ cached GDACS qualification does not relabel a closer NWS match or change scoring (34.35525ms)
  AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /cached context/. Input:

  'Working cameraILNWS Tornado Warning (cached context)5013h ago'

```

Literal counts:

```text
ℹ tests 21
ℹ pass 20
ℹ fail 1
ℹ skipped 0
```

Original/restored SHA-256: `d7ac9d985c5ced22f32061b6e33016eb67323aee1f83bab0291847098a054f47`. Restored Git status: empty.

[Complete literal output](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/03-preserve-nws-label.log)

## Scope

The runtime suite executes the actual FAA panel class, FAA scoring service, GDACS tracked service, and circuit-breaker cache logic through extracted/transpiled production source. Network, time, DOM, and the base panel are controlled fixtures. It verifies healthy TTL-cache retention, stale fallback retention, cached row/viewer wording, live recovery, and preservation of a closer NWS match. This is not a packaged-browser or live-provider test.

[Machine ledger](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/fifth-proofs/ledger.json)
