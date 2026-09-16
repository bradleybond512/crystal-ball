# UX-032 — Settings keyboard containment

Status: source and automated validation complete; packaged verification pending. PR #1723.
Risk: Standard frontend repair, medium QA risk.

## Behavior and architecture

Settings now focuses its named close button, contains Tab among usable controls,
and consumes Escape before Home or other document handlers. It restores a usable
invoker and recovers focus when dynamic content removes the focused control.
Places add/edit closes Settings before opening the editor; reopening Settings
retains the Places tab. The place editor consumes Escape and preserves map-pick
cancellation; Edit now focuses its name field just like Create.

Production scope: UnifiedSettings.ts focus lifecycle and SavedPlaceModal.ts
Escape ownership plus Edit initial focus. No native command, provider, dependency,
preference format or data migration changed. No full editor accessibility rewrite.

## Packaged baseline

On macOS 27.0 / 26A428, installed app v2.25.147 full identified commit
`ee2a7aaac9be`, timestamp `2026-09-15T23:47:25.751Z`. Background main sync had
installed that build. Strict deep codesign verification exited 0. Executable
SHA-256: `47d42b4546fb3800746969bfa6f5ec64a2ba12ac4c50ae3adf3c0fcf0d632cde`.

Native menu Settings opened the unified dialog but focus stayed on HTML. Tab
focused the background Safety review banner. Escape closed Settings and switched
Home to Classic. Cmd+Shift+O restored Home. No preference values, permissions,
notifications or saved-place records were changed. Opening Settings did write
and remove its normal open-state marker.

## Test-first evidence and review repair

Initial DOM assertions: `# pass 2` / `# fail 7`; initial browser: `4 failed`.
First implementation: `# pass 9` / `# fail 0`; browser `4 passed (6.7s)`.

Independent review found one P2: Edit handoff restored background focus because
the actual place editor did not focus on Edit. Actual callback regression:
`# pass 9` / `# fail 1`; targeted browser `1 failed`. The repair adds the existing
name-field focus call to openEdit, with no other production change.

Final candidate `5013e8b80f6fd3b7a266d7bc0a264c984738c37c`:

```text
# tests 14
# pass 14
# fail 0
6 passed (8.1s)
```

Commands: `npm run test:ux032` and
`npm run test:ux032-browser` with an isolated per-run browser port. All type checks and targeted
ESLint exited 0. Browser tests use actual components and stylesheet in a controlled
fixture, not the entire production bootstrap or packaged WKWebView.

A disabled-fieldset DOM case exposed Happy DOM's missing inherited disabled
semantics (14 pass / 1 fail); the assertion is retained in real Chromium coverage,
which passes. Direct disabled controls remain tested in both environments.

## Verification boundaries

Initial named gate passed 283 tests: UX032 9, Home 135+2, appearance 22 and UX026
115, plus all type checks, lint, secrets, documentation and build. Initial broader
renderer run: `# pass 14847` / `# fail 0`. Final repaired gate and mutation proof
are recorded below when complete. Earlier results identify their source version;
they are not a substitute for the final candidate's evidence.

## Risks, manual checks and rollback

Packaged verification of this new fix and VoiceOver remain unclaimed until the
identified installed app contains it. Appearance profile matrices and UX026
expiry/cache/partial-source scenarios remain separate acceptance tasks. No safe
packaged disposable-profile flag is established; user storage must not be cleared
for testing. Full accessibility of the existing place editor is outside this fix.

Manual acceptance: in Home, open native Settings, Tab/Shift-Tab through the dialog,
Escape once and verify Home remains; reopen Places, open Edit on an existing item,
verify name-field focus, then cancel without saving. Preserve user data and view.

Rollback the two production changes together; old keyboard defects return but
stored settings remain valid. No migration reversal or app-data deletion needed.

Raw evidence: `~/.crystalball-diagnostics/ux032-settings-20260915/`.

## Final repair: foreground command palette ownership

Review of the first repair found a second P2: Settings and SavedPlace window
capture could steal Escape from the real CommandPalettePanel opened above them.
Both now follow the existing Library/PanelFocus/Dossier convention and defer
owned keys while `.cmdk-v2-overlay:not([hidden])` exists. Transitional Escape calls
preventDefault without stopping propagation, protecting Home while allowing the
palette input to handle dismissal. No global modal framework or palette focus
restoration behavior is introduced. Post-hide Tab recovery is tested explicitly.

Actual palette/shortcut-route test-first DOM: `# pass 14` / `# fail 2`.
The initial palette browser attempt had a fixture setup error and is not claimed
as behavioral red evidence. Final actual-component browser result:
`8 passed (9.9s)`. Tests cover preserved place drafts and map-pick state.

Final production/test source is `b4edf5ee5a81c3d486dd7df500c418879661c51b`.
These are the second and final automatic review repairs under AGENTS.md.

```text
bash scripts/agentic-validate.sh --tests 'test:ux032 test:homeshell test:system-theme test:ux026'
# pass 16
# fail 0
# pass 135
# fail 0
# pass 2
# fail 0
# pass 22
# fail 0
# pass 115
# fail 0
Secret scan passed for 4779 file(s).
✓ built in 12.70s
Agentic validation gate passed.

npm run test:renderer
# tests 14854
# pass 14854
# fail 0

npm run bundle:check
✓ All bundle-size policies satisfied.
```

All commands exited 0. Named gate total: 290 tests. Main gzip 445.3 KB / 460 KB;
total gzip 5.10 MB / 6 MB. No budget or assertion was weakened. Logs:
`repair2-gate.log`, `repair2-renderer.log`, `repair2-bundle.log`, and `palette-*`.

## Independent final source review

The reviewer did not implement these changes. It reran the focused suite with
16 pass / 0 fail and checked the complete committed diff. Actual conclusion:

> Approved: zero blocking findings in the UX-032 diff at exact SHA
> b4edf5ee5a81c3d486dd7df500c418879661c51b.

Both confirmed P2 findings were repaired. No additional confirmed nonblocking
findings. Evidence documentation and the required real Claude exact-tip review
remain separate from this source approval.

## Final mutation proof

The clean detached candidate completed 35 applied mutations: 34 killed and one
disclosed survivor. All seven palette guard/transition/Tab/hidden-state mutations
failed their relevant assertions. The inactive SavedPlace handler guard survives
because the tested public close lifecycle removes the listener; no independent
behavior coverage is claimed for that extra guard. This is not a 100% mutation
claim. Every mutation's before/after tree was clean and restored SHA-256 matched.
See [literal mutation evidence](UX-032-MUTATION-PROOFS.md).

The initial candidate had four meaningful surviving mutants (hidden/inert,
disabled, repeated-open invoker and observer external-focus protection). Tests
were strengthened; all four now fail when mutated. Historical raw failures and
intermediate proof are retained separately, not overwritten by the final result.

Draft PR summary: Restore Settings keyboard ownership in the packaged UI flow.
Focus enters the named close control, Tab stays among usable controls, Escape
preserves the view underneath, and closing restores the invoking control. Places
uses a sequential handoff with actual Edit focus. Foreground command palette
keeps keyboard ownership without discarding edits. Automated and mutation proof
pass within stated limits; packaged/VoiceOver acceptance remains open.
