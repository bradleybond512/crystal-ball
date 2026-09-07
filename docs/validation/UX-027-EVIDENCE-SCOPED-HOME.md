# UX-027 implementation evidence — 2026-09-07

Status: implementation validated; packaged-runtime acceptance pending. Draft PR #1707 remains IN PROGRESS.

## Outcome and scope

Home always retains Personal, What changed, and Critical worldwide bands. Empty results describe available reports; they do not claim safety, complete coverage, or fresh source evidence. Explicit zero saved places gets a Settings next step. Missing reports remain unavailable. Positive threats, actions, IDs, severity thresholds, sorting, deduplication and four-entry limits remain intact.

Production changes are confined to `src/services/home-shell/briefing-view.ts` and `src/components/HomeShellOverlay.ts`. Two behavioral test files and an explicit `test:home-reassurance` package alias cover the change. No provider, scoring, storage, CSS, permission, dependency, or polling changes.

Source/build commit: `6a4b1d0ad08eaf746a46c10e8a8df5d29da445e2`.
All commands used Node 22 via `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.

## Automated validation

Command: `bash scripts/agentic-validate.sh --tests 'test:home-reassurance test:homeshell test:survival test:renderer'` (exit 0).
Actual summary lines, in suite order (homeshell invokes two runners):

```text
# tests 27
# pass 27
# fail 0
# tests 135
# pass 135
# fail 0
# tests 2
# pass 2
# fail 0
# tests 658
# pass 658
# fail 0
# tests 14725
# pass 14725
# fail 0
Agentic validation gate passed.
Tests run: test:home-reassurance test:homeshell test:survival test:renderer
```

The gate also ran lockfile checks, strict lint, both TypeScript configurations, secret scanning, cross-agent tool availability, roadmap/docs checks and build. TypeScript command exited 0:

```text
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

Separate raw ESLint checks of the changed production/test files exited 0 with no diagnostics. `git diff --check` passed. Cross-agent tool availability is not a review verdict.

`npm run build:full` and `npm run bundle:check` exited 0. Actual bundle output:

```text
chunks: 108
  total:  4.91 MB / 6.00 MB
  top 10:
    panels-cOn_mD5b.js  raw=3.85 MB  gzip=1.07 MB
    GodsVisionView-Cj60hnA2.js  raw=4.02 MB  gzip=1.06 MB
    main-BquyKcuW.js  raw=1.60 MB  gzip=455.0 KB
    maplibre-r9ENGGh0.js  raw=1003.7 KB  gzip=263.8 KB
    deck-stack-ClGkUBIA.js  raw=916.9 KB  gzip=262.2 KB
    panels-analysis-CclURPql.js  raw=760.2 KB  gzip=201.8 KB
    ml.worker-BmhyH2uD.js  raw=793.0 KB  gzip=185.3 KB
    jspdf.es.min-EE8HFQZZ.js  raw=390.1 KB  gzip=124.5 KB
    panels-alerts-Qaa8e5Hd.js  raw=375.2 KB  gzip=98.2 KB
    panels-security-cIxZ5wjP.js  raw=249.5 KB  gzip=68.4 KB

✓ All bundle-size policies satisfied.
```

The main limit remains 460.0 KB; no budget or baseline was changed. Derived targeted-test selection against canonical `macos/main` includes the new dedicated suite and reports no unmapped source paths. This is mapping evidence, not a claim that every selected alias was separately executed locally.

## Mutation proofs

Before implementation the projection tests produced 6 pass / 14 fail. Final baseline and restored combined projection/DOM suite:

```text
# tests 27
# pass 27
# fail 0
```

Proofs ran in a detached worktree at the source commit. Before every mutation, `git -c core.excludesFile=/tmp/ux027-mutation-ignore status --short` was empty; that temporary ignore contained only `node_modules` for the dependency symlink. Each applied `git diff` was inspected before running `npm run test:home-reassurance`. After each run the original bytes and SHA256 were restored and the same status command was empty. After all runs the symlink was removed; ordinary `git status --short` was also empty.

Restored SHA256 values:

- Projection: `1067a50a34050036857cc4cdf0837499f495ffa2b51b1444eaeff2348501aef7`
- Overlay: `594faf1cbd383c959711abfc1afb572b47d38567ea66158abe12d8bbaa2465f0`

DOM tests were first run after implementation; the removed-note red below supplies the required regression proof rather than claiming an earlier DOM red.

### wording mutation

First raw failing assertion:

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      [
        'No saved places for a local assessment.',
        'Change digest unavailable',
    +   'Nothing critical worldwide.'
    -   'No critical items in available reports.'
      ]

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: 'No saved places for a local assessment.'
    1: 'Change digest unavailable'
    2: 'No critical items in available reports.'
  actual:
    0: 'No saved places for a local assessment.'
    1: 'Change digest unavailable'
    2: 'Nothing critical worldwide.'
  operator: 'deepStrictEqual'
```

```diff
diff --git a/src/services/home-shell/briefing-view.ts b/src/services/home-shell/briefing-view.ts
index 77ea11a56..81de52fc6 100644
--- a/src/services/home-shell/briefing-view.ts
+++ b/src/services/home-shell/briefing-view.ts
@@ -108,7 +108,7 @@ function buildPersonalBand(input: BriefingInput): BriefingBandView {
   const tone = personalTone(active);
   const impactWord = active.length === 1 ? 'impact' : 'impacts';
   const headline = active.length === 0
-    ? 'No personal impacts identified in available reports.'
+    ? 'All clear near your places.'
     : `${active.length} personal ${impactWord} near you`;
   const entries = active
     .slice(0, MAX_LINES)
@@ -147,7 +147,7 @@ function buildChangedBand(input: BriefingInput): BriefingBandView {
       kind: 'changed',
       label: 'What changed',
       tone: 'info',
-      headline: 'No changes recorded in the available digest.',
+      headline: 'Nothing changed.',
       entries: [],
       evidenceNote: `${DIGEST_NOTE} ${SOURCE_NEXT_STEP}`,
     };
@@ -185,7 +185,7 @@ function buildCriticalBand(input: BriefingInput): BriefingBandView {
   const situationWord = count === 1 ? 'situation' : 'situations';
   let headline = input.recentEvents === undefined
     ? 'Critical reports unavailable.'
-    : 'No critical items in available reports.';
+    : 'Nothing critical worldwide.';
   if (count > 0) headline = `${count} ${situationWord} worldwide`;
   const missingReports = input.recentEvents === undefined && count > 0
     ? ' Other critical reports unavailable.'
```

Actual failing test names and counts:

```text
not ok 1 - cold Home keeps zero-place, unavailable digest and worldwide notes visible
not ok 2 - healthy sources, recalculation, errors and offline reopening cannot refresh unknown evidence age
not ok 3 - a failed personal refresh stays unavailable without suppressing a known worldwide event
not ok 5 - a committed plan lowers modeled posture without upgrading empty-report reassurance
not ok 7 - empty available reports retain three neutral evidence-scoped bands
not ok 9 - an unknown saved-place count cannot assert that no places are saved
not ok 21 - singular change and one saved place retain scoped descriptions
not ok 23 - critical impact with zero exposures is not counted as personal
# tests 27
# pass 19
# fail 8
```

### notes mutation

First raw failing assertion:

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      [
    +   undefined,
    +   undefined,
    +   undefined
    -   'Available reports only · coverage unverified · evidence age unknown.',
    -   'Recorded changes only · source coverage and evidence age unverified. Review source status before relying on this summary.',
    -   'Available reports only · coverage unverified · evidence age unknown. Review source status before relying on this summary.'
      ]

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: 'Available reports only · coverage unverified · evidence age unknown.'
    1: 'Recorded changes only · source coverage and evidence age unverified. Review source status before relying on this summary.'
    2: 'Available reports only · coverage unverified · evidence age unknown. Review source status before relying on this summary.'
  actual:
  operator: 'deepStrictEqual'
```

```diff
diff --git a/src/components/HomeShellOverlay.ts b/src/components/HomeShellOverlay.ts
index 1188c4e36..293fa1fc4 100644
--- a/src/components/HomeShellOverlay.ts
+++ b/src/components/HomeShellOverlay.ts
@@ -888,7 +888,7 @@ function renderBand(b: BriefingBandView): HTMLElement {
       band.append(el('div', 'hs-band-line', entry.text));
     }
   }
-  band.append(el('div', 'hs-band-stale', b.evidenceNote));
+
   return band;
 }
```

Actual failing test names and counts:

```text
not ok 1 - cold Home keeps zero-place, unavailable digest and worldwide notes visible
not ok 2 - healthy sources, recalculation, errors and offline reopening cannot refresh unknown evidence age
not ok 3 - a failed personal refresh stays unavailable without suppressing a known worldwide event
not ok 4 - dependency threats retain their real action and dossier link without saved places
not ok 5 - a committed plan lowers modeled posture without upgrading empty-report reassurance
not ok 6 - removing a saved place invalidates its previous personal match while preserving worldwide context
# tests 27
# pass 21
# fail 6
```

### age mutation

First raw failing assertion:

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      [
    +   'Last good: 1788782400000',
    +   'Last good: 1788782400000',
    +   'Last good: 1788782400000'
    -   'Available reports only · coverage unverified · evidence age unknown.',
    -   'Recorded changes only · source coverage and evidence age unverified. Review source status before relying on this summary.',
    -   'Available reports only · coverage unverified · evidence age unknown. Review source status before relying on this summary.'
      ]

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: 'Available reports only · coverage unverified · evidence age unknown.'
    1: 'Recorded changes only · source coverage and evidence age unverified. Review source status before relying on this summary.'
    2: 'Available reports only · coverage unverified · evidence age unknown. Review source status before relying on this summary.'
  actual:
    0: 'Last good: 1788782400000'
    1: 'Last good: 1788782400000'
    2: 'Last good: 1788782400000'
  operator: 'deepStrictEqual'
```

```diff
diff --git a/src/services/home-shell/briefing-view.ts b/src/services/home-shell/briefing-view.ts
index 77ea11a56..5762bab25 100644
--- a/src/services/home-shell/briefing-view.ts
+++ b/src/services/home-shell/briefing-view.ts
@@ -79,6 +79,7 @@ export function buildBriefingView(input: BriefingInput, now: number): BriefingVi
     buildChangedBand(input),
     buildCriticalBand(input),
   ];
+  for (const band of bands) band.evidenceNote = `Last good: ${now}`;
   return { bands, generatedAt: now };
 }
```

Actual failing test names and counts:

```text
not ok 1 - cold Home keeps zero-place, unavailable digest and worldwide notes visible
not ok 2 - healthy sources, recalculation, errors and offline reopening cannot refresh unknown evidence age
not ok 3 - a failed personal refresh stays unavailable without suppressing a known worldwide event
not ok 4 - dependency threats retain their real action and dossier link without saved places
not ok 5 - a committed plan lowers modeled posture without upgrading empty-report reassurance
not ok 6 - removing a saved place invalidates its previous personal match while preserving worldwide context
not ok 7 - empty available reports retain three neutral evidence-scoped bands
not ok 8 - zero saved places is distinct from an empty local assessment
not ok 9 - an unknown saved-place count cannot assert that no places are saved
not ok 10 - fresh calculation timestamps never establish source evidence age
not ok 11 - critical personal impact drives band tone and lines
not ok 12 - low/none impacts stay filtered while empty coverage remains unverified
not ok 13 - missing personal report takes precedence over zero saved places
not ok 15 - undefined changed digest is unavailable, not empty
not ok 19 - missing critical reports do not become an empty worldwide assessment
not ok 20 - an active situation remains visible when other critical reports are unavailable
not ok 23 - critical impact with zero exposures is not counted as personal
not ok 26 - positive dependency impacts preserve order, action text, IDs and cap with no saved places
not ok 27 - critical threshold, descending event order, deduplication and four-entry cap remain intact
# tests 27
# pass 8
# fail 19
```

### places mutation

First raw failing assertion:

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      [
    +   'No personal impacts identified in available reports.',
    -   'No saved places for a local assessment.',
        'Change digest unavailable',
        'No critical items in available reports.'
      ]

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: 'No saved places for a local assessment.'
    1: 'Change digest unavailable'
    2: 'No critical items in available reports.'
  actual:
    0: 'No personal impacts identified in available reports.'
    1: 'Change digest unavailable'
    2: 'No critical items in available reports.'
  operator: 'deepStrictEqual'
```

```diff
diff --git a/src/services/home-shell/briefing-view.ts b/src/services/home-shell/briefing-view.ts
index 77ea11a56..6d6333b88 100644
--- a/src/services/home-shell/briefing-view.ts
+++ b/src/services/home-shell/briefing-view.ts
@@ -95,7 +95,7 @@ function buildPersonalBand(input: BriefingInput): BriefingBandView {
     };
   }
   const active = personal.impacts.filter((i): i is ActiveImpact => isActiveImpact(i));
-  if (active.length === 0 && input.savedPlacesCount === 0) {
+  if (active.length === 0 && false) {
     return {
       kind: 'personal',
       label: 'Personal',
```

Actual failing test names and counts:

```text
not ok 1 - cold Home keeps zero-place, unavailable digest and worldwide notes visible
not ok 6 - removing a saved place invalidates its previous personal match while preserving worldwide context
not ok 8 - zero saved places is distinct from an empty local assessment
# tests 27
# pass 24
# fail 3
```

## Browser evidence

Command: `E2E_PORT=4307 VITE_VARIANT=full npx playwright test e2e/home-shell-boot.spec.ts` (exit 0).
Actual result: `5 passed (1.3m)`.

Additional browser fixture command: `node /tmp/ux027-browser-verify.cjs` (exit 0). Ten rendered states exercised the actual Home component, production CSS and stores at 1280×900 and 390×844: zero places, saved-place empty reports, offline reopen, positive nearby/worldwide threats, and failed personal computation. Browser assertions checked visible unverified notes, retained links, and horizontal bounds/overflow. Exact note equality and neutral empty tones are established by DOM tests, not by this browser script. The fixture used the existing contextual-snapshot injection seam to avoid live-provider races.

Compact empty and positive screenshots were visually inspected; notes wrap and links remain readable. Evidence is at `/tmp/ux027-browser-evidence.json`, `/tmp/ux027-home-playwright.log`, and `/tmp/ux027-{1280,390}-{zero-place,saved-place-empty,offline-reopen,positive,failed-personal}.png`. These are browser fixtures, not packaged-native or cold offline restart evidence.

## Native build and outstanding acceptance

Build-only command: `npm run desktop:build:app:full` (exit 0). Version: `2.25.147`.
Artifact: `src-tauri/target/release/bundle/macos/Crystal Ball.app` under the UX027 worktree. Executable SHA256: `bb03d5a050ddf6b302ada286f90f8a79ffc45b2a1a56ac935dbe1ddd008df5b1`.
Actual build output:

```text
    Finished `release` profile [optimized] target(s) in 2m 03s
    Finished 1 bundle at:
```

`codesign --verify --deep --strict --verbose=2` exited 0:

```text
src-tauri/target/release/bundle/macos/Crystal Ball.app: valid on disk
src-tauri/target/release/bundle/macos/Crystal Ball.app: satisfies its Designated Requirement
```

No install or native launch occurred. The approved design requires packaged zero-place startup, saved-place, offline restart, failed refresh, nearby positive and unrelated worldwide scenarios before acceptance. These remain NOT RUN.

A second native instance is not isolated by changing its bundle identifier: native code uses the fixed `crystal-ball` keychain service and legacy migration, and startup can terminate other listeners on sidecar port 46123. No isolated running VM was available (`vmrun list`: `Total running VMs: 0`). Do not claim a browser fixture satisfies this native gate. No weaker native path was implemented.

## Review, manual closeout, and rollback

Independent reviewer inspected the source commit, tests, applied mutation diffs, raw results and compact positive screenshot: **no blocking code findings**. One acceptance finding remains: execute packaged scenarios in an isolated environment or obtain an explicit acceptance-requirement revision. Actual opposite-agent Claude review and a SHA-pinned verdict remain required before merge; tool-availability checks do not replace them.

To complete native acceptance, use an approved isolated macOS environment or an explicitly authorized native test arrangement. Record the exact build, verify the six scenarios above, redact personal coordinates, and preserve the existing installed app/profile. Keep the PR draft until acceptance and required review/CI gates are satisfied.

Rollback involves no migration. Repair or revert a faulty rendering change while retaining conservative empty wording and evidence notes; do not reintroduce unsupported all-clear messaging.

Implementation commit: `Keep Home reassurance within available evidence`.
Draft PR description: Home previously treated empty matched reports and successful recalculation as reassurance. This change keeps three evidence-scoped bands visible, distinguishes no saved places from unavailable/empty reports, and preserves detected threats. Automated, mutation, browser and build checks pass; packaged-runtime acceptance remains pending.

## Targeted-test mapping transcript

Executed with `node --input-type=module` from the worktree:

```javascript
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {deriveScriptIndex,selectScripts} from './scripts/targeted-tests.mjs';
const files=execFileSync('git',['diff','--name-only','macos/main...HEAD'],{encoding:'utf8'}).trim().split('\n');
const main=JSON.parse(execFileSync('git',['show','macos/main:package.json'],{encoding:'utf8'}));
const pr=JSON.parse(readFileSync('package.json','utf8'));
const a=selectScripts(files,deriveScriptIndex(main.scripts));
const b=selectScripts(files,deriveScriptIndex(pr.scripts));
console.log(JSON.stringify({scripts:[...new Set([...a.scripts,...b.scripts])].sort(),unmapped:a.unmapped.filter(x=>b.unmapped.includes(x))},null,2));
```

Actual output:

```json
{
  "scripts": [
    "test:algorithms",
    "test:components",
    "test:emergency-pack",
    "test:emergency-readiness",
    "test:event-store",
    "test:feed-health",
    "test:feed-health-dashboard",
    "test:firms",
    "test:home-reassurance",
    "test:insights",
    "test:lifelines",
    "test:lifelines-grid",
    "test:lifelines-map",
    "test:little-snitch",
    "test:maritime",
    "test:notification-history",
    "test:notifications",
    "test:openaq",
    "test:reasoning",
    "test:review-trail",
    "test:roadmap-controller",
    "test:rules-engine",
    "test:satellite",
    "test:security",
    "test:settings",
    "test:situations",
    "test:survival",
    "test:ucdp-provider",
    "test:ux010",
    "test:ux011",
    "test:watchboard",
    "test:weather",
    "test:webcams",
    "test:wildfire"
  ],
  "unmapped": []
}
```
