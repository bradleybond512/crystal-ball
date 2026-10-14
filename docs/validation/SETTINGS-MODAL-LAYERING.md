# Settings modal layering and scroll containment

Date: 2026-10-14. Local candidate on `codex/settings-modal-layering`, based on
`d8385565d3ebf0a8a0da0640309efa6709c193ff`.

## Bounded behavior

The body-level Settings overlay inherited generic modal z-index 1000, below
NotificationStack 9001 and Home 10000. Its generic modal scrolled the title,
close button and tabs away, and left background scroll containers unlocked.

Only `src/styles/main.css` changes production behavior. Settings and its real
SavedPlaceModal handoff use existing `--z-modal-raised` (10001), below safety
notifications (10004) and the command palette (10005). Settings keeps its
existing div, manual focus and keyboard lifecycle. Its flex frame is bounded
by viewport gutters and dynamic viewport height; header and tabs stay fixed
while the active panel owns scrolling. Settings-owned Sources, Status, Help,
Thresholds and embedded runtime content relinquish nested scroll constraints.

Scoped `:has(> #unifiedSettingsModal.active)` rules lock document, body, classic
main content and Home scrolling. Their active-only important declarations cross
the production base-layer/unlayered-shell boundary. Closing, node removal and the existing Places
handoff release the rule without changing inline styles or scroll offsets.
Places receives only the raised layer, preserving its map-pick interaction.

Alert acquisition, acknowledgments, review, preference storage, notification
sending, cognition, providers and native behavior have no implementation diff.

## Initial fixture and tests-first evidence

The existing eight browser keyboard cases are retained. Six added cases mount
real NotificationStack, TriageBar, AttentionNavigator and paused-iMessage notice
components with sanitized deterministic boundary state. The Home surface uses
production Home CSS and a fixture scroll surface, rather than booting the live
application. All nonfixture API and external requests are fulfilled locally.
No real banner action, user hint, provider endpoint or native bridge is used.

The first tests-first run against unchanged CSS recorded `5 failed` (0 passed).
Four failures reproduced pointer interception, whole-dialog scrolling and
missing scroll locks. The fifth exposed an incomplete palette fixture sequence;
returning focus from its row to its input now matches the existing keyboard
case. The strengthened final baseline recorded `6 failed` (0 passed). Three failures
reached classic/Home hit targets and content scrolling; two stopped at a fixture
precondition because its flex child shrank instead of making classic content
scrollable, and the sixth reached real Places Edit interception. The fixture now
prevents that child from shrinking. Its visible invokers are viewport-fixed so
existing focus restoration does not scroll the synthetic document to an
offscreen button. Exact scroll-offset assertions remain in place. Original CSS SHA-256:
`d76590f39b315d6feb3f561baffd0db73de2bcb7f38537e16bfd55054fc5cb2b`.
The exact final-red test source was copied before subsequent coverage additions.

Logs and sanitized before/after fixture screenshots are kept privately under
`ui-fixes/settings-modal-layering/oct14` in the control workspace. They are not
repository image assets or Library uploads. Baseline evidence files:
`red-browser.log`, `red-final-browser.log`,
`red-final-settings-keyboard.spec.ts`, `red-final-classic-2048x1111.png`,
`red-final-home-2048x1111.png` and `red-final-scroll-general.png`.

The browser cases cover 2048×1111, 640×360 and 320×240 pointer ownership;
640×360 content scrolling; and 640×480 scroll lock/release. Existing keyboard
coverage also checks 1280×720 and 640×480. General, Sources, Status, API Keys,
Thresholds, Help and web Debug use real Settings rendering. Alert-store updates
and review-trail updates are asserted while Settings is still open; alert
acknowledged/pinned flags and injected action counters remain unchanged.

The first post-fix full browser run recorded `11 passed (19.0s)` / `3 failed`.
All original eight cases, both surface hit-target cases and all seven tab scroller
checks passed. Two failed the fixture's positive scroll precondition and the
third observed existing focus restoration scrolling to its offscreen invoker;
these led to the fixture corrections above. The actual run remains in
`green-browser.log`.

After those fixture corrections the full browser command recorded exactly
`14 passed (19.9s)` / 0 failed in `green-final-browser.log`. This includes all
eight original cases and six new regression cases, positive root/classic/Home
scroll positions, exact position/style restoration after close, Escape, backdrop,
destroy and Places handoff, and real palette and map-pick behavior.

Validation commands and actual outcomes:

- `npm run test:ux032`: node runner reported `pass 16`, `fail 0` (unchanged DOM
  keyboard suite, run by the owning agent with normal IPC escalation).
- `E2E_PORT=42819 SETTINGS_MODAL_PHASE=green-final npm run test:ux032-browser`:
  `14 passed (19.9s)`. The private `SETTINGS_MODAL_EVIDENCE_DIR` was also set.
- `npm run test:summary-strip-layout`: `RESULT 8 pass / 0 fail`.
- `npm run test:imessage`: the native-boundary runner reported `# pass 6` /
  `# fail 0`; the component/service runner reported `# pass 108` / `# fail 0`.
- `npm run test:agentic-pipeline`: `# pass 75` / `# fail 0`, with the physical
  macOS temporary path on `TMPDIR`. The first run reported `# pass 74` /
  `# fail 1` because its literal cwd assertion compared `/tmp` with
  `/private/tmp`, the same macOS directory. Source and assertions were unchanged
  for the passing rerun; both actual logs are retained.
- The added closed-state scroll guard requires all four inline overflow values
  to equal `auto` before opening Settings. Its focused classic/Home run recorded
  `2 passed`; this prevents an unconditional scroll lock from passing by comparing
  the mutated closed state with itself.
- `node node_modules/eslint/bin/eslint.js e2e/settings-keyboard.spec.ts`: exit 0,
  empty `focused-eslint.log`.
- `git diff --check`: exit 0.

All Node commands used `/opt/homebrew/opt/node@22/bin` first on PATH. Initial
commit `9e0284def8009170f72379b8a4ddcedff129c37d` passed the normal commit hooks:
conflict markers, staged secrets, JSON/Markdown checks, typecheck and staged lint.
The normal gate command was:

```bash
E2E_PORT=42819 bash scripts/agentic-validate.sh --tests "test:ux032 test:ux032-browser test:summary-strip-layout test:imessage test:agentic-pipeline"
```

It exited 0 and printed `Agentic validation gate passed.` on 2026-10-14.
It reran the named suites: `# pass 16` / `# fail 0`, `14 passed (16.3s)`,
`RESULT 8 pass / 0 fail`, `# pass 6` / `# fail 0`, `# pass 108` / `# fail 0`,
and `# pass 75` / `# fail 0`. Lockfile, strict lint, both typecheck projects,
secret scan, cross-agent configuration, docs, roadmap and production build all
completed. Build output includes import-extension and ineffective dynamic-import
warnings in unchanged modules. No validation rule was weakened. The actual log
and receipt are `normal-agentic-gate.log` and `normal-agentic-gate.json` in the
private evidence directory; all five candidate source hashes were unchanged by
the gate. Independent Sol review is recorded privately against the final commit;
this local candidate does not assert a published cross-agent verdict.

## Initial clean mutation proof

Each mutation started from clean commit
`9e0284def8009170f72379b8a4ddcedff129c37d`. The driver recorded source checksums,
the applied `git diff`, actual failing browser output, then restored and verified
all five candidate files, HEAD, staged index entries and empty status. Git's raw
index stat-cache bytes may refresh; staged content stayed identical.

| Applied CSS mutation | Actual browser result |
| --- | --- |
| Entire accepted-main stylesheet restored | `6 failed` / 0 passed |
| Settings layer reverted | `2 failed` / 0 passed |
| Places layer reverted independently | `1 failed` / 0 passed |
| Outer-frame scrolling restored | `1 failed` / 0 passed |
| Nested Sources scrolling restored | `1 failed` / 0 passed |
| Background scroll lock removed | `2 failed` / 0 passed |
| Background lock made unconditional | `2 failed` / 0 passed |

The entire accepted-main stylesheet mutation uses the corrected final fixture:
all six added cases now fail on actual behavior, including the two scroll-lock
cases that previously stopped at fixture preconditions. The restored focused
suite recorded `6 passed` / 0 failed. CSS SHA-256 before and after every restore:
`d8a4d80368f34d851b1900c89b1f60945ae7dbc8ff7e2bd9f34e91897d2fed67`.
Actual commands, counts, applied diffs and restoration checks are in the private
`clean-mutation-results.json` and `mutation-*.diff` / `mutation-*.log` files.
An initial driver tuple-unpacking error occurred before any mutation was
applied; its correction and restored source state are recorded separately in
`mutation-driver-preflight-correction.json`.

## Independent review repair: production cascade

The first private Sol review pinned commit
`e2923dcc0441537ad916c883cf0d7633c16eea98` and found one blocking P2: the fixture
imported `main.css` directly, but production imports it through
`base-layer.css` inside `@layer base`. Unlayered Home/native styles beat normal
declarations in that layer regardless of specificity. The initial green runs,
gate and seven mutation proofs above are retained as actual historical results;
they did not establish correct background locking under production precedence.

The fixture now imports the real base-layer wrapper followed by the unlayered
theme and shell styles in `src/main.ts` order. With the reviewed production CSS
unchanged, focused classic/Home cases recorded `2 failed` / 0 passed: all four
background overflow values stayed `auto` instead of `hidden`. The actual output
and source hashes are in `repair1-production-cascade-red.log` / `.json`.

The bounded repair gives only the active Settings background-lock declarations
`!important`, so the layered rule beats the unlayered native/Home declarations.
It preserves the same selectors and automatic release on all existing exits.
No global layer, stylesheet order or alert behavior changes. The repaired
production-cascade fixture recorded `14 passed (15.9s)` in
`repair1-green-browser.log`; unchanged DOM tests recorded `# pass 16` /
`# fail 0` in `repair1-unit.log`. Repaired CSS SHA-256:
`611c05e508995a699dbe61f4de7286b7f0ccba4e046993670a5b40114269fd13`.
Fixture SHA-256:
`59b3df890f063ce08d48551f566eb6975b27d0bf106011c315b2f33bf416cf1a`.
Fresh clean mutation proofs, normal gate and Sol review are recorded privately
against the repaired final candidate; prior source hashes remain historical.

Fresh mutation proofs started from clean repaired commit
`ecc77a7ea7c14fa31b10c501079723b3467b162b` and used the production-cascade
fixture. All eight applied mutations recorded 0 passed, with actual failure
counts: accepted-main CSS `6 failed`; Settings layer `2 failed`; Places layer
`1 failed`; outer-frame scrolling `1 failed`; nested Sources scrolling
`1 failed`; layer-priority removal `2 failed`; missing background lock
`2 failed`; unconditional lock `2 failed`. The restored focused suite recorded
`6 passed` / 0 failed. Each applied diff was captured, and all five source hashes,
HEAD, staged index entries and clean status were restored after every mutation.
The repaired CSS checksum above matched each restore. See private
`repair1/clean-mutation-results.json`, `repair1/mutation-*.diff` and corresponding
actual logs. Removing only the new important declarations now reproduces the
review finding in both surface tests.

The same full normal gate command above was rerun after the repair and fresh
mutations. It exited 0 on 2026-10-14 and printed
`Agentic validation gate passed.` The named suites again reported 16 DOM passes,
14 browser passes, `RESULT 8 pass / 0 fail`, iMessage `# pass 6` and `# pass 108`,
and pipeline `# pass 75`, with zero failures. All five source hashes remained
unchanged throughout that run. The actual final-cascade gate log and receipt are
`repair1/normal-agentic-gate.log` / `.json`. Subsequent validation-documentation
updates are frozen with normal commit hooks before fresh independent Sol review.

## Validation scope

Run browser validation on its own supported `E2E_PORT` with the repository's
`reuseExistingServer: false`; use `SETTINGS_MODAL_EVIDENCE_DIR` for private
screenshots and `SETTINGS_MODAL_PHASE` for distinct evidence names. The local
server and tsx IPC needed normal sandbox escalation. No dependency or browser
installation was performed.

`test:ux032` is the existing DOM keyboard contract suite. The additive stylesheet
routing runs it for compatibility. `test:ux032-browser` is explicit browser
validation: `scripts/targeted-tests.mjs` intentionally permits only node/tsx
runners, and the targeted unit CI job does not install browsers. No Playwright
runner was added to that gate.

Chromium is the available cached browser. Native macOS/WebKit and VoiceOver
acceptance remain separate; no packaged build was launched. UX-032 and UX-034
remain MONITOR. This bounded candidate does not complete the full rail inventory,
UX-033 stack-height work or UX-037 global stacking inventory.

Rollback is removal of the scoped CSS changes; Settings values and alerts need
no migration. Manual packaged verification should open Settings over populated
classic and Home surfaces, scroll each tab, use the foreground palette, hand off
to Places Edit/map pick, and close/reopen while confirming scroll positions and
warning continuity.
