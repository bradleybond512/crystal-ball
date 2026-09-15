# macOS UI adoption — system appearance repair brief

Status: historical September 14 design, reconciled September 15, 2026.
UX-031 is claimed and implemented in [PR #1720](https://github.com/bradleybond512/crystal-ball/pull/1720);
a second review/repair cycle is restoring the full variant’s attribute-free
identity before merge. Packaged acceptance remains open. Companion to
[the macOS 27 adoption plan](2026-09-14-macos27-adoption.md).

## Objective and classification

Make the app keep following system light/dark changes when no manual preference
exists, while preserving explicit user choices and the happy variant's light
default. Make desktop light selectors read the same theme owner as the app.
This is a Standard frontend behavior repair, medium QA risk; it introduces no
native bridge, permission, dependency, storage migration or new material effect.
It supports the existing native visual contract rather than claiming new OS APIs.

## Scope and invariants

- Full, tech and finance follow system appearance absent an explicit choice;
  happy retains its intentional light default.
- Manual light/dark remains authoritative across reloads and future OS changes.
- System events never create an explicit stored preference.
- Theme ownership remains `document.documentElement.dataset.theme`.
- Map color invalidation, metadata and existing theme-change subscribers continue
  to receive the same applied theme.
- Monitoring, alerts, evidence semantics, inference and UX-025 materials remain
  outside scope. No native packaging or deployment-floor change.

## Discovery evidence

Source inspected on canonical main `54a9b920094e562ec4ee159130a5d733503925f8`:

| Finding | Source | Implication |
|---|---|---|
| Main bootstrap applies stored theme but never calls the existing watcher | `src/main.ts:160`, `:285`; `src/utils/theme-manager.ts:97` | A system appearance change after launch is not connected through this path |
| Watcher invokes the persisting setter | `src/utils/theme-manager.ts` | Merely wiring it would store the first OS change as a manual override |
| Build-selected variant is assigned after initial theme application | `src/main.ts:285`, `:297` | Startup ordering must preserve happy's default when its variant comes from build configuration |
| Separate settings entry applies theme without watching | `src/settings-main.ts:33`, `:755` | Main-window repair alone leaves this entry inconsistent |
| Several light rules require a theme attribute on body | `src/styles/window-chrome.css:25`; `src/styles/macos-native.css:937`, `:1088`, `:1196`, `:1200` | They do not match the real html-owned light theme |
| Existing ancestor-aware `:where` rules already match html-owned theme | `src/styles/macos-native.css:61`, `:848`, `:1873` | Preserve these rules; do not perform blanket selector replacement |

The repository analyst ran the actual transpiled theme manager with controlled
DOM/storage/media-query substitutes. Observed output:

```text
initial light stored null
OS -> dark dark stored dark
OS -> light dark stored dark
```

This reproduces the latent watcher persistence problem. It is a module probe,
not a packaged test or a mutation proof for a completed fix.

## Installed-app observation

Read-only metadata inspection found installed version 2.25.147 and declared
`LSMinimumSystemVersion=10.13`; SDK/Xcode metadata fields were absent. This does
not verify a functional compatibility floor or identify its linked SDK.
Current host reports macOS 27.0 / 26A428.

Computer-use inspection covered Classic and Home, then restored Classic via its
visible navigation action. Screenshots and accessibility output are in this
conversation; no standalone screenshot artifact was saved. Native traffic
lights and system-style fonts are present. Home overlays dense readiness and
briefing content on the map; Classic presents a long panel sidebar and multiple
status strips. These observations inform later hierarchy work, not measured
contrast failures or proof that the proposed theme repair is installed.
No appearance, notification, privacy or monitoring preferences were changed.

## Proposed implementation boundary

Prepare the smallest internal separation between applying a resolved theme and
persisting an explicit choice. Keep the existing public manual setter's meaning.
Keep a manual choice authoritative for the current document even when storage
rejects or silently drops its write; record the session choice before attempting
persistence, including when `installLocalStoragePatch` swallows the error. Do
not let a subsequent OS event override that choice.
Connect the watcher after variant resolution and initial theme application in
both relevant entries. Standalone Settings currently has no variant initialization;
resolve its build-selected variant as well, preserving existing hostname/storage
precedence where applicable. Use a single listener per document with lifecycle handling
appropriate to current bootstrap, avoiding a new preference framework.

Correct only the directly mismatched native light selector groups. Preserve
specificity and existing dark styles; test computed styles with theme on html
and no synthetic body attribute. The fixture must reproduce production CSS
layer/import order: unlayered styles override normal layered declarations.
The existing alert chrome test instead sets body theme and imports main.css
directly, so it cannot serve as the only native appearance proof. Do not alter blur intensity, glass materials,
window dimensions, accent policy or animation performance in this task.

## Acceptance and proposed verification

1. No preference: startup resolves system appearance; two consecutive opposite
   system changes apply, emit expected events and leave storage absent.
2. Manual dark and manual light each survive system changes and reload. A manual
   choice made after one system change stops future automatic changes.
3. Happy remains light without preference and respects an explicit override.
   Build-selected variant is resolved before startup theme selection.
4. Missing media-query support retains the current dark fallback. Test both
   throwing and silently dropped storage writes. With
   unavailable storage, an explicit choice survives for the current document;
   persistence across reload remains unavailable. Invalid stored values count
   as no preference.
5. Main and standalone Settings entries connect appearance following. Browser
   tests must exercise bootstrap, not call the watcher only from the test.
6. Native root, toolbar, map header and scrollbar light rules match html-owned
   theme. Preserve existing correct ancestor-aware selectors and non-Mac styles.
7. Existing happy toggle behavior remains passing. Packaged OS appearance and
   unified Settings dialog checks remain required before native acceptance; browser
   emulation cannot establish system preference delivery through WKWebView.

Proposed new focused module test:
`src/utils/__tests__/theme-manager.test.mts`.
Proposed browser spec: `e2e/system-theme.spec.ts`; use controlled ui-only data
and a dedicated port. Final paths and commands are finalized by design before
implementation. Existing and proposed validation entry points:

```bash
node --import tsx --test src/utils/__tests__/theme-manager.test.mts
E2E_PORT=4287 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts
E2E_PORT=4288 VITE_VARIANT=happy npm run test:e2e:happy
npm run typecheck:all
bash scripts/agentic-validate.sh --tests 'test:renderer'
```

The proposed files now exist in PR #1720. Commands above remain the historical
design protocol, not final test results. The canonical implementation brief is
`docs/plans/2026-09-15-ux031-system-appearance.md`; final results belong in
`docs/validation/UX-031-SYSTEM-APPEARANCE.md` on that PR.
Use the all-variant cases in the module suite; add entry-point/browser coverage
where build-dependent behavior requires it. Existing `test:renderer` includes
`src/utils/__tests__/*.test.mts` once added.

Mutation proof must separately kill restored persistence in the watcher,
removed bootstrap subscription/variant ordering, removed session-choice
fallback, and restored wrong light selectors. Confirm each diff applied, record failing assertions/counts, then
restore checksums and the clean tree as required by AGENTS.md.

## Deferred initial-paint parity

`index.html` and `settings.html` inline startup scripts do not fully resolve
system appearance before module loading. This repair's acceptance begins at
application bootstrap; it does not claim flash-free initial paint. A follow-up
must deliberately cover both inline scripts with delayed-module first-paint
checks. Existing post-navigation happy tests do not establish that property.
Do not expand this bounded repair silently or erase stored values that might
have come from the old watcher: they are indistinguishable from manual choices.

## Claim, review and rollback

UX-031 claimed this scope through draft PR #1720 before implementation. The
live usability tracker remains authoritative; this historical design does not
create another task or claim completion. UX-025 remains deferred.

Repository analyst discovery and architect design precede production edits.
Implementation owner: UI/map specialist. Test owner: test specialist.
Independent review follows validation; the separate real Claude review pins the
final source tip before PR closeout. Preserve prior map and UX-026 closeout work.
Rollback reverts the bounded code/selector change; it must not clear user choices.
No data migration is planned.

## Discovery validation

Executed against the unchanged production source during design:

```text
node --import tsx --test src/components/__tests__/shell-a11y-contracts.test.mts
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

These four source/DOM contracts are baseline evidence, not a complete
accessibility audit or validation of an implemented theme repair.

The current production source also passed `npm run typecheck:all` (exit 0).
Documentation checks passed: `[lint:md] Checked 144 Markdown file(s).` and
`git diff --check` (exit 0).

Independent design review concluded: “No blocking findings in the
documentation/design reviewed.” This is design acceptance only. It is not
Claude's source review, native visual acceptance, or an implementation verdict.
The reviewer did not independently verify live Apple pages or installed-app
observations. Initial-paint parity and real packaged appearance switching remain
open. The canonical draft task claim was subsequently established in PR #1720.

Proposed commit for implementation: `Keep system appearance changes automatic`.
Draft PR summary: “Restore repeated system appearance changes in main and Settings
while preserving manual choices and happy's default. Correct affected Mac light
styles to use the app's html-owned theme. Validation and mutation results will
be added after implementation; native acceptance remains separately recorded.”

## Native Settings clarification

September 15 source discovery confirms the native Settings command opens the
unified dialog in the main window. The separate `settings.html` entry remains
browser-covered, but is not a currently reachable separate native Settings
window. Packaged acceptance must exercise main and its actual Settings dialog.
