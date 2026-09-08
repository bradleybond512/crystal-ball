# UX-027 implementation evidence — 2026-09-07

Status: implementation and six packaged-runtime scenarios validated; independent acceptance review passed. Exact-tip opposite-agent verdict and required CI govern PR closeout.

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

## Native build and packaged acceptance

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

Bradley explicitly authorized the temporary native test arrangement on 2026-09-07 ("yes"): pause automatic updates, install the reviewed build, restart for testing, then restore the current installation. The main-sync LaunchAgent was paused; the original app was backed up and the three WebKit, Application Support, and Caches profile directories were preserved by rename. The official installer installed the build above with `--relaunch`. Testing used a fresh profile and public test locations, without requesting location permission or exporting/editing keychain secrets.

| Packaged scenario | Observed result |
|---|---|
| Zero-place startup | “No saved places for a local assessment.” and “Add a place in Settings.”; unknown coverage remains visible. |
| Saved place | Public Reykjavik test location yields “No personal impacts identified in available reports.” |
| Unrelated worldwide context | 53 worldwide situations remain visible beside the empty Reykjavik personal band. A worldwide warning opens its matching dossier. |
| Nearby positive | Adding public Honolulu yields 7 personal impacts; the first four entries retain Tropical Storm Warning titles and protective action. These are app-reported warnings, not independently verified weather claims. |
| Offline restart | After fully quitting app and sidecar and applying verified connection denial, restart retains 7 cached personal impacts and 53 worldwide situations; all four keyless sources report degraded/latest refresh failed; evidence age remains unknown. |
| Failed refresh | “Retry all data” under the same verified denial leaves degraded sources and cached threats visible, with no all-clear or last-good freshness claim. A personal warning opens its matching dossier while offline. |

Native AX text and screenshots are retained locally in `/tmp/ux027-native-evidence/`: `zero-place`, `saved-place`, `positive`, `offline-restart`, `offline-failed-refresh`, `worldwide-dossier`, and `personal-dossier-offline` (`.txt`/`.png`). Initial offline attempts were ineffective because existing allowances took precedence; those attempts are excluded from offline evidence. The final attempt temporarily disabled the two overriding app/node allowances, then cold-restarted both processes. Little Snitch Network Monitor reported the Crystal Ball application group “connections are denied” with a current denial. Actual socket inspection of that sidecar recorded:

```json
{
  "sidecarPid": 49859,
  "establishedTcp": 8,
  "nonLoopbackEstablishedTcp": 0
}
```

The process socket result, application-group denial, and degraded native source statuses corroborate the offline condition; a shell-launched node probe was not treated as proof about the app.

Verbatim native accessibility lines after the failed refresh (leading indentation removed):

```text
300 text USGS Earthquakes degraded · latest refresh failed Retry all data or open Earthquakes.
302 text GDACS Disasters degraded · latest refresh failed Retry all data or open GDACS Disaster Alerts.
304 text Open-Meteo Weather degraded · latest refresh failed Add a saved place or retry all data.
306 text GDELT News degraded · latest refresh failed Retry all data or open Live Intelligence.
310 text Personal 7 personal impacts near you
315 text Available reports only · coverage unverified · evidence age unknown. Review source status before relying on this summary. What changed Change digest unavailable Recorded changes only · source coverage and evidence age unverified. Review source status before relying on this summary. Critical worldwide 53 situations worldwide
```

### Restoration evidence and limits

All original connection allowances were restored and temporary denial rules removed. Network Monitor then reported Crystal Ball “connections are allowed”. One existing rule's editor review marker changed from unapproved to approved; its original access scope and action were restored. Firewall metadata is therefore not claimed byte-identical.

The three original profile directories were restored before relaunch, with recursive filename/content fingerprints matching their backups: WebKit 39 files, Application Support 3 files, Caches 1774 files. Test profiles were retained separately under the private `/tmp/crystalball-ux027-native-restore` backup. Diagnostic/event logs are append-only and retain test-session entries; no claim is made that those logs were unchanged.

The official installer restored the original app. Actual executable verification:

```json
{
  "originalExecutableSha256": "6151f2b84425838b807a90d34ad9cf3f27052fdf75e9fe6e5f1d26eaa94a3066",
  "restoredExecutableSha256": "6151f2b84425838b807a90d34ad9cf3f27052fdf75e9fe6e5f1d26eaa94a3066",
  "match": true
}
```

The original app was relaunched. The same main-sync LaunchAgent was bootstrapped again; its subsequent status was `idle`, with target and installed SHA both `39b82aea5b89e96fa8406b22f3c903c715956f9f`. Private profile backups and full network inventory are not published.

### Separate usability observations

Native testing also exposed follow-up candidates outside these two production files: a map-load overlay requires “Use Emergency map” to reach Home, and fallback tiles display “API KEY REQUIRED”; stacked alert/setup banners obscure navigation; classic-view accessibility calls twice took approximately 95 seconds, which is tool-call duration rather than a measured UI latency benchmark. Saved Places was reachable through Settings → Places, while command-palette navigation did not visibly open the panel in this session. Record and reproduce these as separate roadmap tasks before implementation; none invalidates the observed Home wording, retained threats, or dossier links.

## Review, manual closeout, and rollback

Independent and actual Claude reviews of the prior tip found no blocking code findings; their remaining acceptance blocker was the six unrun native scenarios. Those scenarios are now recorded above. The independent reviewer inspected all six native AX captures, offline/retry screenshots, application-group denial, socket results, restoration records, and restored executable/main-sync status. Its conclusion: “Native acceptance blocker is resolved for UX027.” and “No new evidence blocker.” An exact-tip Claude verdict remains required before merge.

Manual reproduction: use an authorized temporary profile, compare zero places and public Reykjavik/Honolulu locations, inspect both dossier paths, then verify actual app/sidecar connection denial before cold restart and retry. Restore original installation, profile, connection allowances and update agent afterward.

Rollback involves no migration. Repair or revert a faulty rendering change while retaining conservative empty wording and evidence notes; do not reintroduce unsupported all-clear messaging.

Implementation commit: `Keep Home reassurance within available evidence`.
Draft PR description: Home previously treated empty matched reports and successful recalculation as reassurance. This change keeps three evidence-scoped bands visible, distinguishes no saved places from unavailable/empty reports, and preserves detected threats. Automated, mutation, browser, build and six packaged-runtime checks pass; independent acceptance review passed.

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
