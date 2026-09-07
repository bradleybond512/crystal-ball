# UX-025 Smoked Liquid Glass Desktop System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement
> this plan task by task. Use the Crystal Ball feature workflow and maximum QA/QC
> gates throughout.

**Status:** Approved; roadmap claim and implementation in progress

**Goal:** Give Crystal Ball's macOS desktop experience a darker, calmer, more
professional Liquid Glass-inspired hierarchy while preserving the current data,
navigation, semantic colors, map behavior, light theme, and performance.

**Architecture:** Extend the existing CSS token system with new UX-025-specific,
fail-closed material names and a small set of Full-dark-desktop translucent
recipes. Do not change shared `--mat-*` or `--hs-*` values consumed by excluded
modes. Assign glass only to declared navigation and grouped chrome selectors.
Keep dense information surfaces opaque. Override the redundant viewport-sized
CSS blur only in the target Full dark desktop selector while retaining the
packaged app's existing native vibrancy. Add one presentation-neutral Home
wrapper; do not add a theme manager, dependency, Rust change, or native shell
rewrite.

**Tech stack:** TypeScript, CSS custom properties, Vite, node:test via `tsx`,
Playwright, axe, Tauri 2 packaged verification.

**Worktree:**
`/Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass`

**Branch:** `codex/ux-025-smoked-liquid-glass`

**Base:** canonical `macos/main` at `702dc5b0`

---

## Feature brief

### Objective

Create a dark desktop visual system that feels native to modern macOS without
claiming to reproduce Apple's private Liquid Glass renderer. The system should
feel like smoked graphite glass: darker diffusion, low saturation, bright but
subtle specular edges, dark perimeter shading, concentric rounded geometry, and
restrained physical feedback on controls.

### User value

- Crystal Ball reads as a serious professional desktop instrument.
- Navigation and controls remain distinct from high-density intelligence content.
- Map imagery can show through chrome without making text or state ambiguous.
- Accessibility preferences degrade to a deliberate solid design, not a broken
  approximation of glass.

### Classification and risk

- Crystal Ball workflow: **Standard**.
- QA/QC risk tier: **Medium** and performance-sensitive.
- No prediction, provider, persistence, network, security-boundary, Rust, Tauri
  capability, or native window behavior changes are authorized.
- A future native AppKit or SwiftUI shell would be a separate high-assurance
  architecture project.

### Acceptance criteria

- The full dark desktop shell uses the material taxonomy in this plan.
- Home has exactly three persistent glass nodes: topbar, intelligence island,
  and status ribbon.
- Classic view has no more than five persistent glass nodes.
- Each defined UX-025 audit scenario has no more than eight active target glass
  nodes, and no target glass node is nested inside another target glass node.
- Within the targeted Home, classic shell, map-control, and sheet surfaces,
  `.app-root`, information cards, readiness wells, briefing bands, panels,
  panel headers, panel bodies, tables, charts, and individual control buttons
  never blur the backdrop.
- Text remains at least 4.5:1; meaningful controls, focus, icons, and boundaries
  remain at least 3:1 over both dark and satellite backdrops.
- Reduce Transparency, Increase Contrast, Reduce Motion, unsupported filters,
  and forced colors all retain readable hierarchy and operability.
- The target is the Full variant in dark desktop mode, including both Home and
  its classic view. Web, light, Tech, Finance, Happy, and mobile rendering remain
  visually unchanged and functional.
- No new runtime dependency and no unexplained JavaScript bundle increase.
- The candidate meets the performance gates below on the same Mac and build
  configuration as its baseline.
- A packaged Crystal Ball build is manually verified before completion.

### Constraints

- Start from `docs/USABILITY_UPLIFT_FOR_CODEX.md` and claim one roadmap task
  through a draft PR before production implementation.
- The next available task is UX-025. UX-022 already shipped OpenAQ reliability.
- `main` is read-only. Rebase on freshly fetched canonical `main` immediately
  before the first commit.
- Do not push, open a PR, install, publish, or alter production data without the
  corresponding explicit approval.
- All behavior tests require the repository's mutation-proof procedure.
- Use the existing install script; never copy an application bundle manually.

### Non-goals

- Native Liquid Glass equivalence or a SwiftUI/AppKit rewrite.
- Glass on every card, panel, table, chart, alert body, or safety surface.
- A shader, noise texture, refraction engine, animated blur, or perpetual motion.
- A full redesign of every panel interior.
- Restyling specialist modes outside the standard Full shell: God's Vision,
  EEW, crisis triage, attention navigation, and diagnostic/inline map HUDs.
- Changing semantic severity colors, map marker colors, basemap colors, or data
  visualization palettes.
- Re-exposing map controls inside Home.
- Changing map camera, layers, provider boot, polling, panel registration,
  navigation, settings behavior, persistence, or APIs.
- Restoring reachability of the standalone settings window.
- A light-theme redesign, new icon system, or mobile redesign.

### Open evidence boundary

This direction is informed by Apple's public macOS design guidance, but the
result must be described as **Liquid Glass-inspired**. Compatibility with macOS
27 remains unverified until it is tested on that OS. macOS 26.5 is the available
local packaged-test target at plan time.

Official design references:

- [Human Interface Guidelines: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [WWDC26 Platforms State of the Union](https://developer.apple.com/videos/play/wwdc2026/112/?time=173)
- [WWDC26: Modernize your AppKit app](https://developer.apple.com/videos/play/wwdc2026/289/?time=838)

### Target variants and audit states

The new appearance is intentionally limited to `VITE_VARIANT=full` with
`body.is-desktop-macos` in dark mode. The Full variant's classic view is part of
scope. Light mode, web mode, Happy, Tech, Finance, and mobile keep their current
appearance; their gates prove non-regression rather than visual adoption.

The blur budget applies to the elements assigned by UX-025 in these explicit
states:

| State | Target glass nodes | Budget |
| --- | --- | ---: |
| Home baseline | topbar, intelligence island, ribbon | 3 |
| Home plus one foreground sheet | baseline plus dossier/focus or one global sheet | At most 5 |
| Home supported stacked state | baseline plus compatible open sheets | At most 7 |
| Classic baseline | sidebar and toolbar | 2 |
| Classic with map chrome | baseline plus grouped controls and one palette | At most 5 |
| Classic plus one foreground sheet | classic/map state plus one raised sheet | At most 6 |

Mutually exclusive sheets are not opened together merely to manufacture a count.
God's Vision, EEW, crisis triage, attention navigation, and legacy diagnostic or
inline map HUDs have pre-existing material behavior outside UX-025. Task 0 records
their blur sites as exclusions; UX-025 neither increases nor certifies them. A
source-diff contract fails if this PR adds or modifies a backdrop filter outside
the declared target files and selectors. Computed-style contracts also prove that
representative excluded consumers, including EEW's use of
`--mat-blur-chrome`, retain their baseline values.

---

## Locked visual direction

### Material taxonomy

| Material | Role | Blur | Assigned surfaces |
| --- | --- | ---: | --- |
| Canvas | Window and map-adjacent background | No | Home root, classic content, panel grid |
| Solid content | Reading and operational data | No | Cards, bands, panels, tables, alert prose |
| Smoked chrome | Persistent navigation/grouped chrome | Yes | Topbars, Home island, ribbon, sidebar, toolbar, grouped map controls |
| Raised smoke | Temporary foreground chrome | Yes | Dossier frame, focus frame, Library, command palette, reachable modals |
| Thin control | Controls inside a material | No | Buttons, tabs, pills, fields, sidebar rows |
| Safety surface | Critical state independent of backdrop | No | Error, critical, stale, and unavailable content |

Glass belongs to a container boundary. Its children use solid or thin fills. A
family of briefing bands becomes one glass island with solid inner wells, not a
stack of independently blurred bubbles.

### Starting token recipe

These are review starting points, not values to propagate blindly. The installed
visual checkpoint in Task 5 decides the final opacity and blur within the stated
bounds.

```css
:root[data-theme="dark"]:not([data-variant="tech"]):not([data-variant="finance"]):not([data-variant="happy"]) body.is-desktop-macos {
  --ux025-canvas: #05070b;

  --ux025-solid-1: #0b0e13;
  --ux025-solid-2: #11151b;
  --ux025-solid-3: #181d25;

  --ux025-chrome-bg: rgba(8, 11, 16, 0.78);
  --ux025-raised-bg: rgba(10, 14, 20, 0.84);
  --ux025-chrome-fallback: #0d1117;
  --ux025-raised-fallback: #121821;

  --ux025-blur-chrome: blur(28px) saturate(1.12);
  --ux025-blur-raised: blur(34px) saturate(1.10);

  --ux025-edge-specular:
    inset 0 1px 0 rgba(255, 255, 255, 0.13),
    inset 1px 0 0 rgba(255, 255, 255, 0.035);
  --ux025-edge-perimeter:
    inset 0 -1px 0 rgba(0, 0, 0, 0.62),
    inset -1px 0 0 rgba(0, 0, 0, 0.32);

  --ux025-control-press-scale: 0.98;
}
```

The production selector should be formatted compactly but must express the same
gate: Full dark desktop means dark root theme, desktop body, and no Tech,
Finance, or Happy variant. The Full build may have no `data-variant` attribute or
an explicit `data-variant="full"`; both are accepted. New UX-025 names are
consumed only by declared target selectors. Shared `--mat-*`, `--hs-*`, semantic,
and variant tokens remain byte-for-byte unchanged.

Solid UX-025 values are the defaults. A target-scoped `@supports` path activates
translucent fills and filters. Accessibility and unsupported-renderer paths
resolve the same UX-025 names back to solid backgrounds and `none` filters.

### Geometry

- Outer sheets and islands: `--r-xl` at 22px.
- Inner wells inset by about 8px: `--r-md` at 14px.
- Panel and card shells: `--r-md` or `--r-lg`.
- Interactive capsules: `--r-pill`.
- Preserve traffic-light clearance and draggable window regions.

### Interaction

- Only explicit shell controls may press to `scale(0.98)`.
- Use the existing fast duration and ease-out curve, about 100–150ms.
- Do not animate `backdrop-filter`, blur radius, filter, or box shadow.
- Disabled controls, drag regions, cards, and reduced-motion mode do not scale.
- Do not add hover lift or spring motion to content cards.

### Scope checkpoint

UX-025 proves the system on the entire shell and its reachable chrome, but does
not special-case hundreds of panel interiors. Task 5 is a mandatory installed
visual checkpoint after Home and classic shell integration. If the hierarchy is
not approved there, adjust tokens and shell assignments before applying them to
map controls and overlays.

---

## Repository execution path

- `src/main.ts` imports layered base styles, then unlayered window, Home, and
  Library styles. It adds `body.is-desktop-macos` for packaged or forced-desktop
  builds.
- `src/app/layout/html.ts` owns the classic `.mac-shell` structure.
- `src/components/Panel.ts` supplies the common panel DOM contract.
- `src/components/HomeShellOverlay.ts` mounts Home and adopts/releases the
  existing map without replacing it.
- `src/components/LibraryOverlay.ts`, `CommandPalettePanel.ts`, and
  `UnifiedSettings.ts` own the reachable foreground sheets.
- The packaged Tauri window already applies native `HudWindow` vibrancy. CSS
  currently adds a second viewport-sized blur on `.app-root`; this plan removes
  only that redundant CSS blur in the target Full dark desktop selector.

### Important cascade boundary

`main.css` is inside `@layer base`; `window-chrome.css`, `home-shell.css`, and
`library.css` are imported later without a layer. Preserve existing `!important`
rules that intentionally cross this boundary. Do not create a global override
stylesheet.

---

## Baseline evidence already collected

On canonical `macos/main` at `ace93818`:

- Focused Home/unit discovery command: `112 pass / 0 fail`.
- Existing `home-shell-boot.spec.ts`: `1 pass / 4 fail`.
- The first live-provider failure terminated Vite with an Undici HTTP/2
  `UND_ERR_SOCKET`; the remaining tests received `ERR_CONNECTION_REFUSED`.
- The current Home E2E is therefore not an acceptable visual gate for this
  styling task. Task 1 adds a deterministic, fixture-only harness that blocks
  all external requests.
- Repository discovery found 69 unprefixed and 46 prefixed
  `backdrop-filter` declarations plus inline sites. UX-025 does not rewrite all
  of them; it audits and consolidates the surfaces reachable in this scope.

These results are discovery evidence, not implementation sign-off.

---

## Dependency graph and ownership

```text
T0 Claim UX-025 and record baselines
  -> T1 Add deterministic red tests
    -> T2 Build material foundation
      -> T3 Home shell -------\
      -> T4 Classic shell -----+-> T5 Installed visual checkpoint
                               |     -> T6 Map controls
                               |     -> T7 Reachable overlays/settings
                               |       -> T8 Cross-surface audit
                               |         -> T9 Final validation/review
```

- Root/integrator owns T0, T5, and T9.
- `test_engineer` owns T1 and T8.
- `ui_map_engineer` owns production styling in T2–T4 and T6–T7.
- An `independent_reviewer`, who did not implement the change, owns final review.
- After T2, T3 and T4 may run in parallel because their production files do not
  overlap. T6 and T7 must serialize where both touch `main.css`.

---

## Task 0: Claim UX-025 and record the true baseline

**Owner:** root/integrator

**Files:**

- Modify: `docs/USABILITY_UPLIFT_FOR_CODEX.md`
- Use: this implementation plan
- Add: a narrow baseline evidence document under `docs/validation/` if the
  roadmap format cannot hold the evidence cleanly

### Steps

- [ ] Fetch the canonical remote and confirm UX-025 is still the next unclaimed
  task.
- [ ] Rebase this branch on the freshly fetched canonical `main` before the
  first commit.
- [ ] Add `UX-025 — Smoked Liquid Glass desktop visual system` with goals,
  acceptance criteria, dependencies, evidence requirements, and a Progress
  Tracker row marked `IN PROGRESS`.
- [ ] Keep the roadmap claim and this plan in the first commit.
- [ ] Push the branch and open a draft PR only after explicit publication
  approval. That draft PR is the required task claim.
- [ ] Inventory current backdrop-filter sites in the declared target files and
  record the specialist-mode exclusions without expanding UX-025 into them.
- [ ] Record baseline CSS/JS bundle sizes. Task 1 captures deterministic visual,
  DOM, and browser-performance baselines after the fixture exists but before
  production styling.
- [ ] Capture packaged CPU/memory evidence only if app installation has been
  explicitly approved.

### Acceptance

- Branch is `codex/ux-025-smoked-liquid-glass`.
- The roadmap and draft PR claim exactly one task.
- The brief locks Full dark desktop scope, a hard cap of eight target blurs in
  the declared audit states, no semantic/map color changes, no new dependency,
  and no native rewrite.
- Baselines include commands, machine/build context, and real output.

### Validation

```bash
git branch --show-current
npm run test:roadmap-controller
npm run lint:md
git diff --check
```

### Commit

```text
docs(ux): claim smoked glass desktop system
```

---

## Task 1: Add deterministic tests before production styling

**Owner:** `test_engineer`

**Files:**

- Add: `tests/smoked-liquid-glass-contract.test.mts`
- Add: `e2e/smoked-liquid-glass.spec.ts`
- Add: narrow frozen assets and fixture adapters under
  `e2e/fixtures/smoked-glass/`
- Add: `scripts/measure-ux025-browser.mjs`
- Add: `scripts/measure-ux025-packaged.mjs`
- Add: `scripts/check-ux025-css-budget.mjs`
- Add: focused script tests under `tests/scripts/`
- Modify: `package.json` only for `test:smoked-glass`,
  `test:e2e:smoked-glass`, `measure:ux025:browser`,
  `measure:ux025:packaged`, and `check:ux025:css`

### Steps

- [ ] Build a fixture route that invokes production renderers with frozen view
  models and stubbed services without starting providers or polling. Do not
  duplicate production shell markup in static HTML.
- [ ] Where an owning component cannot be safely instantiated, pair its fixture
  adapter with a source/DOM contract proving that each audited selector is used
  by the reachable production runtime.
- [ ] Freeze locale to `en-US`, time zone to UTC, time, viewport, and device
  scale; wait for fonts; disable caret and animations for screenshots.
- [ ] Use local dark-map and satellite-map backdrops. Reject every external
  request and fail the test if one occurs.
- [ ] Add source contracts for the token interface, desktop scoping, material
  opacity/saturation bounds, filter pairing, protected solid surfaces, and
  accessibility fallbacks.
- [ ] Snapshot shared `--mat-*`, `--hs-*`, semantic, and variant token values and
  assert they remain byte-for-byte unchanged. Add computed-style non-regression
  coverage for EEW and one other excluded specialist surface.
- [ ] Add computed-style assertions for Home, classic, map controls, Library,
  command palette, and reachable settings.
- [ ] Count target blur elements and ancestor/descendant target blur pairs only
  in the explicit audit states. Add a source-diff guard against new or modified
  filters outside the declared target selectors.
- [ ] Assert unchanged semantic and map tokens and no dark leakage into light,
  Tech, Finance, or Happy variants.
- [ ] Cover 1024x640, 1280x720, and 1440x900 plus 200% zoom/long labels.
- [ ] Add stable accessible-name, focus-indicator, and hit-target checks.
- [ ] Capture the untouched deterministic dark/satellite screenshots, target
  blur counts, DOM snapshots, and browser-performance JSON before production
  styling.
- [ ] Implement `measure-ux025-browser.mjs` with the existing Playwright runtime:
  three warm runs, fixed fixture scenario, requestAnimationFrame intervals,
  long-task entries, scenario metadata, and JSON output.
- [ ] Implement `measure-ux025-packaged.mjs` with Node built-ins. Require an
  explicit root PID, checkpoint state-file path, and expected local SHA. Verify
  the state file's `localBuildSha`, verify the root command is the canonical
  installed Crystal Ball executable, recursively select its child process tree,
  sample summed CPU/RSS once per second for 60 seconds across three runs, and
  emit raw samples plus median/p95 JSON.
- [ ] Implement `check-ux025-css-budget.mjs` with Node's `zlib.gzipSync`. Capture
  the sum of sorted built CSS assets for baseline/candidate manifests and fail a
  comparison above 10,240 added gzip bytes.
- [ ] Write focused tests for process-sample aggregation, percentile math, CSS
  asset discovery/gzip totals, argument validation, and JSON schema stability.
- [ ] Run the tests before production edits and record named red failures and
  exact pass/fail counts.

### Acceptance

- The fixture cannot access the network.
- Fixture DOM comes from production renderers or has an explicit source/DOM
  reachability contract; copied class-name markup is not accepted.
- Initial failures prove the missing material interface and Home wrapper.
- Baseline and candidate scripts produce reviewable JSON under
  `docs/validation/ux-025/performance/` with commit, scenario, OS, viewport,
  duration, cadence, process selection, and raw/summary values.
- Packaged measurement fails if the isolated checkpoint marker does not equal the
  exact expected SHA or the selected process is not running from
  `/Users/bradleybond/Applications/Crystal Ball.app/Contents/MacOS/crystalball`.
- No snapshot is accepted merely because it was regenerated.
- New locator screenshots use `threshold: 0.2` and
  `maxDiffPixelRatio: 0.005` only after repeat runs prove stability.

### Validation

```bash
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass
npm run measure:ux025:browser -- \
  --label baseline \
  --output docs/validation/ux-025/performance/browser-baseline.json
npm run check:ux025:css -- capture \
  --dist dist \
  --output docs/validation/ux-025/performance/css-baseline.json
```

Expected at this stage: deterministic red results with recorded counts.

### Commit

```text
test(ux): define smoked glass contracts
```

---

## Task 2: Establish the material foundation

**Owner:** `ui_map_engineer`

**Files:**

- Modify: `src/styles/tokens.css`
- Modify: `src/styles/window-chrome.css`

### Steps

- [ ] Add new `--ux025-*` solid, chrome, raised, specular, perimeter, and
  press-response names under the Full dark desktop gate. Do not change shared
  `--mat-*`, `--hs-*`, semantic, or variant token values.
- [ ] Make solid colors and `filter: none` the fail-closed defaults.
- [ ] Activate translucent recipes only for supported Full dark desktop
  rendering and only on declared target selectors.
- [ ] Add Reduce Transparency, Increase Contrast, Reduce Motion, and forced
  colors resolutions.
- [ ] Add a Full dark desktop override that resolves `.app-root` to no CSS
  `backdrop-filter` while retaining root tint, native vibrancy show-through,
  transparent Tauri body behavior, and drag safe zones. Preserve the existing
  shared rule for non-target variants and themes.
- [ ] Keep glass saturation between 1.05 and 1.20 and chrome opacity between
  0.72 and 0.80 until the Task 5 checkpoint.
- [ ] Do not animate blur, filter, or box shadow.
- [ ] Confirm light, Tech, Finance, Happy, semantic, domain, and map values are
  unchanged.
- [ ] Confirm representative excluded consumers, especially the EEW status bar,
  retain their baseline computed background and `--mat-blur-chrome` filter.

### Acceptance

- Every glass recipe has an opaque fallback.
- Target Full dark desktop `.app-root` has no CSS backdrop filter; non-target
  computed styles remain unchanged.
- New `--ux025-*` names are the sole material interface for target surfaces; no
  TypeScript material state or dependency is introduced.
- The focused contracts turn green without broadening the test exemptions.

### Validation

```bash
npm run test:smoked-glass
npm run lint:colors
npm run typecheck:all
```

### Mutation proof

- Record the checksum of the committed target file.
- Restore target `.app-root` blur or remove one UX-025 solid fallback with
  `apply_patch`.
- Confirm the mutation in `git diff`.
- Run the focused contract and record exact green-to-red counts and assertion.
- Restore with `apply_patch`, verify the original checksum, and confirm a clean
  tree.

### Commit

```text
feat(ux): establish smoked glass materials
```

---

## Task 3: Apply the system to Home

**Owner:** `ui_map_engineer`

**Files:**

- Modify: `src/components/HomeShellOverlay.ts`
- Modify: `src/styles/home-shell.css`
- Modify: `src/components/__tests__/home-shell-startup-readiness.test.mts`
- Modify: `src/components/HomeShellStartupReadiness.ts` only if the existing
  markup cannot express the approved grouping

### Steps

- [ ] Add a presentation-neutral `.home-shell-intel-island` wrapper around
  readiness and briefing. Do not change view models, refresh, copy, or data.
- [ ] Assign smoked chrome to the topbar, intelligence island, and ribbon.
- [ ] Consume only target-scoped `--ux025-*` material names under the Full dark
  desktop gate; do not repoint shared Home/material tokens.
- [ ] Make readiness, each `.hs-band`, Deck cards, contextual cards, and status
  detail solid inner wells with concentric radii.
- [ ] Keep critical/elevated washes opaque and semantically unchanged.
- [ ] Use raised smoke only for the open dossier and focus frame; keep the
  hosted panel solid.
- [ ] Apply the restrained press response only to explicit Home controls.
- [ ] Preserve traffic-light clearance, drag regions, Escape, map adoption and
  release, focus behavior, and hidden Home map controls.

### Acceptance

- Home has exactly three persistent UX-025 target blur nodes.
- Home's worst plausible stacked state remains at or below seven.
- Readiness and briefing content never depend on the backdrop for legibility.
- No card or band has a backdrop filter.
- Existing Home behavior and content tests remain green.

### Validation

```bash
npm run test:homeshell
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass -- --grep "Home"
```

### Mutation proof

Remove the wrapper or restore per-band blur, confirm the applied diff, run the
focused suite, record the named red assertion and exact counts, then restore the
checksum and clean tree.

### Commit

```text
feat(ux): group Home intelligence in smoked glass
```

---

## Task 4: Apply the system to the classic shell

**Owner:** `ui_map_engineer`

**Files:**

- Modify: `src/styles/macos-native.css`
- Modify: `src/app/layout/html.ts` only if a grouping wrapper proves essential
- Add or modify: one focused classic shell DOM contract test if markup changes

### Steps

- [ ] Assign smoked chrome to the sidebar and content toolbar only under the Full
  dark desktop gate, using `--ux025-*` material names.
- [ ] Keep sidebar rows and toolbar controls non-blurred with concentric radii.
- [ ] Make `.mac-content`, `.panels-grid`, panels, panel headers, and panel
  bodies solid.
- [ ] Remove map-header and diagnostic-panel-header blur.
- [ ] Use Command Center as the representative classic panel without changing
  its data renderer.
- [ ] Resolve setup-wizard sheets through raised/fallback tokens with an
  unblurred scrim and no nested blur.
- [ ] Preserve light overrides, traffic-light clearance, drag regions, sidebar
  collapse, update controls, variants, alerts, and status meaning.

### Acceptance

- Sidebar and toolbar are the only persistent classic shell glass planes before
  map controls are opened.
- Classic persistent blur count is no more than five after Task 6.
- Panel content remains opaque and readable.
- No component-specific data path changes.

### Validation

```bash
npm run test:renderer
npm run test:smoked-glass
npm run typecheck:all
npm run build:full
npm run build:tech
npm run build:finance
npm run build:happy
```

### Mutation proof

Restore blur to a panel header or representative panel body, confirm the diff,
record the contract's exact red result, and restore the checksum/clean tree.

### Commit

```text
feat(ux): unify classic shell chrome
```

---

## Task 5: Fail-closed packaged shell checkpoint

**Owner:** root/integrator with the user

**Dependencies:** Tasks 1–4 green and explicit installation approval

The checkpoint temporarily replaces the canonical installed app. The installer's
successful swap does not retain its own backup, so UX-025 must preserve a tested
baseline build and prove the restore path before installing the candidate. The
periodic main-sync agent must be quiesced for the entire baseline/candidate window
so it cannot invalidate the installed SHA during screenshots or sampling.

Use this isolated checkpoint marker for every Task 5 install and measurement:

```text
/Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json
```

The default `/Users/bradleybond/.crystalball-main-sync/state.json` remains
untouched by checkpoint installs.

### Quiesce and record main-sync

- [ ] Require a clean, committed candidate tree and record the exact candidate
  code SHA. Never use a dirty-tree pseudo-SHA for installation evidence.
- [ ] Record the existing LaunchAgent loaded state and the contents/checksums of
  main-sync `state.json` and `status.json` without editing them.
- [ ] If `/Users/bradleybond/.crystalball-main-sync/sync.lock` exists or the sync
  process is running, wait for that run to finish. Do not delete its lock.
- [ ] If the LaunchAgent was loaded, boot it out using its existing plist and
  verify `launchctl print` no longer finds the service.
- [ ] Keep the service unloaded until the known-good baseline is restored and
  the isolated checkpoint marker has been removed.

```bash
/bin/launchctl print gui/<UID>/com.bradleybond.crystalball.main-sync
/bin/launchctl bootout \
  gui/<UID> \
  /Users/bradleybond/Library/LaunchAgents/com.bradleybond.crystalball.main-sync.plist
/bin/launchctl print gui/<UID>/com.bradleybond.crystalball.main-sync
```

Resolve `<UID>` with the read-only `id -u` command and record it. If the service
or plist was absent initially, record that and do not create one during cleanup.

### Preserve and measure a recoverable baseline

- [ ] Use the post-rebase SHA recorded in Task 0 as `<UX025_BASE_SHA>`.
- [ ] Create a detached baseline worktree at
  `.worktrees/ux-025-packaged-baseline` from that exact SHA.
- [ ] In the baseline worktree, run lockfile, secret, type, build, and packaged
  build gates. Keep its built app intact until UX-025 is accepted or rolled back.
- [ ] With explicit installation approval, install the baseline through its own
  `install-built-app.mjs` with the exact baseline SHA and isolated state file,
  then capture screenshots and packaged CPU/RSS JSON.
- [ ] From the candidate worktree, capture a CSS-gzip manifest from the baseline
  worktree's `dist` directory.
- [ ] Prove the baseline can be reinstalled with the same installer command
  before the candidate install. If it cannot, stop; do not replace the app.

```bash
git worktree add --detach \
  /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-packaged-baseline \
  <UX025_BASE_SHA>

npm run lockfile:check
npm ci
npm run secrets:scan
npm run typecheck:all
npm run build
npm run desktop:build:app:full
node scripts/install-built-app.mjs \
  --relaunch \
  --local-sha <UX025_BASE_SHA> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json
```

The commands after `git worktree add` run from the baseline worktree. Packaged
measurement runs from the UX-025 worktree after the baseline is installed:

```bash
npm run measure:ux025:packaged -- \
  --root-pid <BASELINE_ROOT_PID> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json \
  --expected-local-sha <UX025_BASE_SHA> \
  --label baseline \
  --scenario home-idle \
  --duration-seconds 60 \
  --runs 3 \
  --output docs/validation/ux-025/performance/packaged-home-baseline.json

npm run check:ux025:css -- capture \
  --dist /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-packaged-baseline/dist \
  --output docs/validation/ux-025/performance/css-baseline.json
```

Record how `<BASELINE_ROOT_PID>` was resolved. The measurement script must verify
both the isolated marker and the canonical executable path before sampling.

### Interim candidate gate before installation

Run from the UX-025 worktree:

```bash
npm run lockfile:check
npm run secrets:scan
npm run typecheck:all
npm run lint:strict
npm run test:homeshell
npm run test:renderer
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass
npm run build:full
E2E_PORT=4187 bash scripts/agentic-validate.sh \
  --tests "test:homeshell test:renderer test:smoked-glass test:e2e:smoked-glass"
npm run desktop:build:app:full
```

Any failure blocks the checkpoint install. Do not weaken or waive a gate because
the candidate is visually incomplete.

### Install, inspect, and restore

- [ ] Install only with Crystal Ball's installer script.
- [ ] Record commit, app version, `sw_vers`, display scale, and appearance
  settings.
- [ ] Capture paired Home and classic screenshots over dark and satellite map
  views in normal, Reduce Transparency, Increase Contrast, Reduce Motion, and
  combined accessibility settings.
- [ ] Inspect traffic-light clearance, dragging, resizing, fullscreen, focus,
  one dossier, and one Command Center panel.
- [ ] Capture candidate CPU/RSS with the same script, duration, cadence, process
  selection, and scenario used for baseline.
- [ ] Count only the declared UX-025 target blur nodes in each audit state.
- [ ] Present the side-by-side evidence and decide whether shared UX-025
  opacity/blur/radius values need adjustment within the locked bounds.
- [ ] Reinstall the preserved baseline at the end of the checkpoint. Do not
  leave an unmerged candidate installed after evidence capture.
- [ ] If the candidate crashes or fails inspection, immediately reinstall the
  preserved baseline using its worktree's installer.
- [ ] After baseline restoration, remove only the exact isolated checkpoint
  marker, reload the LaunchAgent only if it was loaded initially, and verify the
  main-sync agent reconciles the canonical install and reaches `idle` or
  `installed` with `installedSha === targetSha`.
- [ ] Verify the final running executable is the canonical Crystal Ball path and
  that the default sync state contains no UX-025 checkpoint marker.
- [ ] Do not continue to Tasks 6–7 until the shell hierarchy is accepted.

```bash
node scripts/install-built-app.mjs \
  --relaunch \
  --local-sha <UX025_CANDIDATE_SHA> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json

npm run measure:ux025:packaged -- \
  --root-pid <CANDIDATE_ROOT_PID> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json \
  --expected-local-sha <UX025_CANDIDATE_SHA> \
  --label candidate-shell \
  --scenario home-idle \
  --duration-seconds 60 \
  --runs 3 \
  --output docs/validation/ux-025/performance/packaged-home-candidate-shell.json
```

Baseline restoration runs from the baseline worktree:

```bash
node scripts/install-built-app.mjs \
  --relaunch \
  --local-sha <UX025_BASE_SHA> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json

rm -f /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json

/bin/launchctl bootstrap \
  gui/<UID> \
  /Users/bradleybond/Library/LaunchAgents/com.bradleybond.crystalball.main-sync.plist
/bin/launchctl enable gui/<UID>/com.bradleybond.crystalball.main-sync
/bin/launchctl kickstart -k gui/<UID>/com.bradleybond.crystalball.main-sync
```

The three `launchctl` resume commands run only if the service was loaded before
the checkpoint. Keep the baseline worktree and built artifact until final UX-025
packaged verification is complete.

Never use `cp -R` to install or restore the app.

### Checkpoint questions

- Does the chrome read as dark graphite rather than muddy blue-gray?
- Is the glass clearly distinct from solid intelligence content?
- Are the specular edges visible without looking glossy or toy-like?
- Does satellite imagery remain legible but subdued beneath chrome?
- Do the grouped bubbles feel intentional rather than over-rounded?
- Is the result calmer and more professional than the baseline?

If not, tune only the shared UX-025 tokens and surface assignment before
propagation.

---

## Task 6: Group the map controls

**Owner:** `ui_map_engineer`

**Files:**

- Modify: map-control sections of `src/styles/main.css`
- Modify: `src/components/Map.ts` only for accessibility-neutral attributes
- Modify: `src/components/DeckGLMap.ts` only for accessibility-neutral
  attributes or an indispensable grouping class
- Add or modify: focused map-control accessibility contracts

### Steps

- [ ] Give basic `.map-controls` and DeckGL `.zoom-controls` one parent material
  each under the Full dark desktop gate; never blur their individual buttons.
- [ ] Let the time slider and layer palette consume at most one material each.
- [ ] Keep the legend solid or heavily tinted.
- [ ] Add stable accessible names, `type="button"`, and group labels where
  missing, without changing handlers.
- [ ] Maintain at least 28x28 desktop targets and existing 44x44 mobile targets.
- [ ] Preserve camera, layers, renderer, hit testing, Home's hidden controls,
  basemap, marker colors, and data.
- [ ] Inspect any affected map golden individually; do not bulk-update snapshots.

### Acceptance

- No individual map control has a backdrop filter.
- No map behavior or semantic color changes.
- Existing map repaint and visual contracts remain green.

### Validation

```bash
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass -- --grep "map controls"
E2E_PORT=4190 npm run test:e2e:visual:full
E2E_PORT=4191 npm run test:e2e:visual:tech
```

### Mutation proof

Move blur to an individual map button, confirm the diff, record the nested or
per-button assertion's exact red result, and restore the checksum/clean tree.

### Commit

```text
feat(ux): group desktop map controls
```

---

## Task 7: Unify reachable overlays and settings

**Owner:** `ui_map_engineer`

**Files:**

- Modify: `src/styles/library.css`
- Modify: `src/components/CommandPalettePanel.ts`
- Modify: `src/styles/alerts.css` only for reachable overlay chrome
- Modify: generic modal and Unified Settings sections of `src/styles/main.css`
- Modify: `src/components/LibraryOverlay.ts` only for presentation-neutral
  classes
- Modify: `src/components/UnifiedSettings.ts` only for presentation-neutral
  classes
- Modify: focused Library, command-palette, and settings tests as required

### Steps

- [ ] Make every targeted Full dark desktop scrim dark and unblurred without
  changing the same overlay in non-target variants or light mode.
- [ ] Give each visible foreground sheet no more than one raised material.
- [ ] Keep Library cards, command results, settings cards, inputs, alert prose,
  and all nested content wells solid.
- [ ] Move command-palette presentation CSS out of runtime TypeScript injection
  only if the focused tests prove the move preserves ordering and behavior.
- [ ] Resolve tabs, fields, pills, buttons, and sidebar rows through target-scoped
  UX-025 material/control names and existing radius tokens without child blur.
- [ ] Preserve overlay z-order, Escape, focus return, search/filtering, settings
  persistence, API-key behavior, actions, privacy blur on coordinates, and data.
- [ ] Do not treat pre-existing focus-trap work or standalone settings
  reachability as part of UX-025.

### Acceptance

- Library, command palette, Help/Digest chrome, generic modal, and Unified
  Settings match the accepted material hierarchy.
- No nested blur and no dark leakage into light mode.
- Alert and settings content remains opaque.
- Overlay behavior is unchanged.
- `settings-window.css` is untouched because its standalone surface is not
  reachable in the current application path.

### Validation

```bash
npm run test:homeshell
npm run test:renderer
npm run test:settings
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass -- --grep "Library|command palette|settings|modal"
npm run typecheck:all
npm run build:full
```

### Mutation proofs

- Restore scrim blur or nest sheet/scrim blur and prove the focused overlay
  contract turns red.
- Add blur to a settings content card or remove its solid fallback and prove the
  settings contract turns red.
- For each mutation, confirm the diff, record exact counts/assertions, and
  restore the checksum/clean tree.

### Commit

```text
feat(ux): align desktop sheets and settings
```

---

## Task 8: Cross-surface accessibility and performance audit

**Owner:** `test_engineer`; repairs return to the owning production task

**Evidence files:**

- Add: JSON summaries under `docs/validation/ux-025/performance/`
- Add: accessibility and material summary under
  `docs/validation/UX-025-SMOKED-GLASS-VALIDATION.md`

### Automated material gates

- [ ] Home persistent target blur count equals three.
- [ ] Home supported stacked target count is no more than seven.
- [ ] Classic persistent/map target count is no more than five.
- [ ] No declared UX-025 audit state exceeds eight target nodes.
- [ ] No target blur element has a target blurred ancestor or descendant.
- [ ] No protected content selector in the target roots has a backdrop filter.
- [ ] The source-diff guard reports no new or modified filters in excluded
  specialist modes or undeclared selectors.
- [ ] Every filter has an opaque unsupported/reduced-transparency fallback.
- [ ] Prefixed and unprefixed filter declarations remain paired.

### Accessibility gates

- [ ] On touched classic surfaces, axe reports no new violation type, node,
  count, or impact increase and zero `color-contrast` findings.
- [ ] The deterministic Home fixture has zero serious/critical and zero
  color-contrast findings.
- [ ] Normal text is at least 4.5:1 over dark and satellite backdrops.
- [ ] Large text, meaningful controls, focus, icons, and boundaries are at
  least 3:1.
- [ ] Focus is at least 2 CSS pixels and 3:1 against adjacent colors.
- [ ] Desktop compact targets are at least 28x28 where feasible and never below
  24x24; primary capsules are at least 32px high.
- [ ] Reduced Motion removes every new scale/translation and resolves effective
  transition time to no more than 10ms.
- [ ] Reduce Transparency resolves all target surfaces to `filter: none` and an
  opaque/effectively opaque background.
- [ ] Increased Contrast and forced colors preserve boundaries, focus, and
  status meaning without relying on custom color alone.

### Performance gates

Measure baseline and candidate on the same Mac, display, viewport, fixture/map
state, and build mode using three warm runs. The scripts added in Task 1 are the
measurement authority; hand-calculated summaries are not accepted.

### Executable measurement protocol

- `measure-ux025-browser.mjs` launches the deterministic fixture, waits for
  fonts and a settled frame, performs three warm runs, records every
  requestAnimationFrame interval and PerformanceObserver long task during the
  fixed 10-second pan, and emits raw samples plus median/p95/over-budget counts.
- `measure-ux025-packaged.mjs` accepts a verified numeric root PID, recursively
  resolves its process tree, samples summed `%CPU` and RSS every second for 60
  seconds, and emits all 60 samples plus median/p95/peak values. Run it three
  times for each baseline/candidate scenario.
- `check-ux025-css-budget.mjs` recursively finds sorted `.css` files under the
  built directory, records each raw and `gzipSync` size, totals them, and compares
  candidate to baseline with a 10,240-byte maximum gzip delta.
- Existing `bundle:check` remains the JavaScript budget authority; the new CSS
  script does not replace it.
- JSON output includes schema version, commit, label, OS, architecture, app/build
  version, command, root PID and selected commands where applicable, scenario,
  viewport/display scale, warm-run index, duration, cadence, and raw/summary data.
- Commit compact JSON summaries. Attach large traces/screenshots to the draft PR
  rather than bloating the repository.

- [ ] Idle 60-second median CPU is no more than baseline +1 percentage point and
  no more than 10% relative regression.
- [ ] Idle p95 CPU is no more than baseline +2 percentage points.
- [ ] Scripted 10-second map pan has median frame interval no more than 16.7ms,
  p95 no more than 33.3ms, no more than 5% of frames over 33.3ms, and no task
  over 100ms.
- [ ] Candidate median frame cost regresses no more than 10%; candidate p95
  regresses no more than 15%.
- [ ] Packaged summed RSS is within 10% or 50MiB of baseline, whichever allowance
  is larger; browser JS heap is reported where the runtime exposes it.
- [ ] One minute after panning, packaged summed RSS is within 20MiB of its settled
  pre-pan value.
- [ ] Existing map harness remains at zero standing and zero paused repaints.
- [ ] Added stylesheet gzip is below 10KB.
- [ ] Main JS gzip remains at or below 460KB, no non-entry chunk exceeds 1.2MB,
  and total JS gzip remains at or below 6MB.
- [ ] Any JavaScript delta is explained; no dependency delta is permitted.

Thresholds are provisional until Tasks 1 and 5 record comparable baselines. A
pre-existing miss does not become a silent waiver: require non-regression and
report the repository target as still unmet.

### Validation

```bash
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass
npm run measure:ux025:browser -- \
  --label candidate \
  --output docs/validation/ux-025/performance/browser-candidate.json
npm run check:ux025:css -- capture \
  --dist dist \
  --output docs/validation/ux-025/performance/css-candidate.json
npm run check:ux025:css -- compare \
  --baseline docs/validation/ux-025/performance/css-baseline.json \
  --candidate docs/validation/ux-025/performance/css-candidate.json \
  --max-delta-bytes 10240
E2E_PORT=4193 npx cross-env VITE_VARIANT=full \
  playwright test e2e/map-harness.spec.ts
npm run lint:strict
npm run bundle:check
npm run smoke:offline
```

---

## Task 9: Final validation, independent and cross-agent review, and evidence

**Owner:** root/integrator, then `independent_reviewer`, then Claude as the
required opposite-agent reviewer for this `codex/*` branch

### Targeted and full gates

Run targeted tests first, then the repository gate:

```bash
npm run test:homeshell
npm run test:renderer
npm run test:settings
npm run test:smoked-glass
E2E_PORT=4187 npm run test:e2e:smoked-glass
npm run typecheck:all
npm run lint:strict
npm run build:full
npm run build:tech
npm run build:finance
npm run build:happy
npm run bundle:check
npm run smoke:offline
E2E_PORT=4187 bash scripts/agentic-validate.sh \
  --tests "test:homeshell test:renderer test:settings test:smoked-glass test:e2e:smoked-glass"
```

Run the existing full variant suites when the focused gate is stable:

```bash
npm run test:e2e:full
npm run test:e2e:tech
npm run test:e2e:finance
```

### Packaged verification

With explicit installation approval, repeat Task 5's main-sync quiesce,
isolated-marker, exact-SHA verification, baseline restore, marker removal, and
LaunchAgent resume procedure. Require a clean committed code tree and record
`<FINAL_CODE_SHA>` before building.

```bash
npm run desktop:build:app:full
node scripts/install-built-app.mjs \
  --relaunch \
  --local-sha <FINAL_CODE_SHA> \
  --state-file /Users/bradleybond/Developer/crystalball/.worktrees/ux-025-smoked-liquid-glass/test-results/ux-025/install-state.json
```

Record dark/satellite screenshots, traffic-light clearance, dragging, resize,
fullscreen, Library, command palette, dossier, map pan, focus restoration, OS
appearance settings, active blur counts, CPU median/p95, frame observations, and
memory evidence. Count only the declared UX-025 target nodes. Record macOS 27 as
unverified unless it is actually tested.

Capture final packaged CPU/RSS with the same root-PID verification, scenario,
cadence, and three-run protocol used for baseline. Reinstall the preserved
baseline immediately if final packaged verification fails. Do not leave the
unmerged final candidate installed after evidence capture.

### Mutation-proof ledger

For every behavior change:

1. Start from a clean committed tree and record `shasum -a 256` of the target.
2. Revert only the behavior under test using `apply_patch`.
3. Inspect `git diff` and confirm the mutation applied.
4. Run the targeted suite and record exact green and red pass/fail counts plus
   the failing assertion.
5. Restore with `apply_patch`, verify the original checksum, and confirm an
   empty `git status --short`.

Minimum proof set:

| Behavior | Mutation |
| --- | --- |
| Material values | Restore the old material token recipe |
| Content protection | Remove one no-blur guard |
| Reduce Transparency | Remove the solid accessibility fallback |
| Contrast/forced colors | Remove one boundary/focus fallback |
| Reduced Motion | Remove the transform cancellation |
| Controls/focus | Shrink one target or remove one focus rule |
| Home grouping | Remove the intelligence-island wrapper |
| Map grouping | Move parent blur to an individual map button |

### Independent review and required Claude verdict

- [ ] Give the complete diff and evidence to an `independent_reviewer` who did
  not implement it.
- [ ] Repair confirmed findings and rerun affected checks.
- [ ] Allow no more than two automatic review/repair cycles.
- [ ] If a finding survives the second cycle, stop and escalate with both
  attempted repairs and why they failed.
- [ ] After independent review is green and all repairs are committed, run
  `npm run cross-check` and use its generated prompt for a real Claude review of
  the final code tip.
- [ ] If Claude finds an issue, repair it, rerun affected gates and independent
  review, then request a fresh Claude review of the new code tip.
- [ ] Save Claude's actual concluding output to an evidence file. A PR-body
  marker is not accepted by the current repository protocol.
- [ ] When Claude reports zero blocking findings, record the SHA-pinned verdict:

```bash
node scripts/verify-review-verdict.mjs \
  --record \
  --reviewer claude \
  --evidence-file <CLAUDE_CONCLUSION_FILE>
```

- [ ] Verify that the resulting tip is a verdict-only commit whose parent is the
  exact Claude-reviewed code SHA. Do not change code after this commit.
- [ ] With explicit publication/PR-closeout approval, push the verdict tip and
  finish with `bash scripts/pr-closeout.sh`; do not arm auto-merge by hand.

### Completion documentation

Update the UX-025 roadmap row and add validation evidence covering:

- user-visible behavior and architecture changed;
- exact validation commands and actual output;
- all mutation proofs with checksums and red/green counts;
- accessibility and contrast evidence;
- blur counts and performance evidence;
- installed-app screenshots and manual verification;
- independent review result;
- Claude cross-agent review, reviewed code SHA, and verdict-commit SHA;
- unresolved risks, especially macOS 27 if untested;
- rollback instructions and proposed release stance.

### Proposed final commit

```text
docs(ux): record smoked glass validation
```

---

## Release failure gates

Do not mark UX-025 done with any of the following:

- a new accessibility violation or contrast failure;
- more than eight target blurs in a declared audit state, nested target blur,
  blur on protected target content, or a new/modified filter in an excluded mode;
- missing solid, reduced-transparency, increased-contrast, reduced-motion, or
  forced-colors behavior;
- unexplained variant or light-theme bleed;
- an unstable deterministic E2E harness;
- a performance result beyond the locked non-regression limits;
- an unreviewed golden update;
- packaged crash, traffic-light overlap, clipped focus, stale blur during map
  motion, or broken window dragging;
- a behavior change without mutation proof;
- an unresolved independent-review finding;
- a missing, stale, or non-Claude SHA-pinned cross-agent verdict;
- a claim of macOS 27 compatibility without macOS 27 evidence.

---

## Rollout and rollback

- Roll out the token/foundation and shell prototype first.
- Stop at Task 5 for installed visual acceptance before propagating the style.
- Retain the known-good baseline worktree and built app until packaged candidate
  verification completes; use its installer for recovery.
- Keep the entire change behind existing desktop/dark CSS gates; do not add a
  new persisted preference in UX-025.
- If performance regresses, first reduce blur radius, then make raised full-screen
  surfaces solid, then set active filters to `none` while retaining the darker
  palette and geometry.
- A full rollback is a normal PR revert. There are no data migrations, schema
  changes, cache changes, or persisted-state changes.

---

## Draft PR outline

**Title:** `UX-025: Smoked Liquid Glass desktop system`

**Summary:**

- Introduces a fail-closed smoked-glass material hierarchy for the Full dark
  macOS desktop variant.
- Consolidates Home and classic chrome while keeping intelligence content solid.
- Groups map controls and aligns reachable sheets/settings after visual approval.
- Adds deterministic material, accessibility, blur-budget, and variant tests.

**Risk:** Medium; CSS compositing, contrast, and cross-variant presentation.

**Rollback:** Revert the PR or disable the active filters through the scoped
`--ux025-*` names; no data or persistence rollback is required.

**Not included:** Native shell rewrite, semantic/map color changes, provider or
prediction work, light/mobile/Tech/Finance/Happy redesign, specialist modes, or
every panel interior.

---

## Publication boundary

This plan itself is safe to prepare locally. The next required workflow action is
to update the UX roadmap, push this branch, and open the UX-025 draft PR to claim
the task. Do not cross that publication boundary until the user explicitly
authorizes the push and draft PR.
