# UX-053 local dependency integration

Draft #1848 was reconciled on 2026-11-07 onto local pending #1847
`7cbe1f622b06b582be59b6741e31fdd5f855699f`, including pending #1844 and #1846.
This is not a merged-main acceptance checkpoint.

The combined bootstrap exposes its actual `appStartup` promise to the early
Ghost recovery entry while retaining `startWorkspace` and startup failure UI.
The warning loader retains the current operational snapshot and checks teardown
after ancillary acquisition; it does not restore the pre-refresh warning array.
Both startup and warning test mappings are preserved.

The startup fixtures were updated from the old raw-array warning interface to
the snapshot/lifecycle interface. Cancellation assertions still check store,
panel, warning context, predictions, storm events and prewarm effects. The old
fixtures reported 61/9; the repaired focused group reported 71/0, including a
new bootstrap promise wiring check. No failing behavior assertion was removed.

Two fresh integration mutations started from clean status and restored the
recorded source hashes. The combined baseline was 30/0. Removing the exported
boot-promise assignment gave 29/1, and removing the post-acquisition teardown
guard gave 29/1. [Applied diffs and failed assertions](UX-053-INTEGRATION-MUTATIONS.json).
The promise proof is source-wiring coverage; the teardown proof executes the
transpiled production loader. They do not establish native startup timing.

Under Node 22.23.1 and the canonical user temporary directory, the full gate ran:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux053 test:ux052 test:ux047 test:ux050 test:native-notify test:roadmap-controller"
```

Its actual concluding output was:

```text
Agentic validation gate passed.
Tests run: test:ux053 test:ux052 test:ux047 test:ux050 test:native-notify test:roadmap-controller
```

All targeted groups, lockfile, lint, application/API types, secrets,
documentation, roadmap checks and production build passed. Ghost startup still
reported `[pwa:budget] 468 entries, 21.93 MiB`.

UX-053 remains MONITOR, review after 2026-11-14. Final current-main reconciliation,
broad selection, exact-head Sonnet review, verdict and hosted checks remain.
Historical isolated timing/renderer receipts are not final integrated installed
app acceptance. Installation, release, tags, build dispatch and deployment remain
paused. Rollback must retain warning retirement and Ghost recovery semantics
while reverting workspace startup/lifecycle changes together.

## Refreshed pending dependency

This local checkpoint was replayed onto `ebc362760e5eeff52381e65010a7a0a661941f2c` while #1844 was still pending.
[Continuity hashes](UX-053-DEPENDENCY-CONTINUITY.json) confirm 15 feature source/test files and the complete
`src`, `src-tauri`, and `api` trees are unchanged from `83fa69ebf2142bfb5a5281f74df3271fb234c5ac`.
No new full test run is claimed for this history/metadata transition. The original
local tip is preserved on `codex/ux053-preserved-local-base-nov7`. Actual-main
reconciliation, live candidate snapshot and exact-head Sonnet review remain open.

## Conservative validation with the repaired main-owned selector

The earlier run on `7b5c2c3548d61a7882d062bf9f97510fd9148723` aborted before
UX050 because the old main-owned recipe contained an unsupported npm budget
alias. That run did not establish an aggregate pass or certify its unrun tail.
After repair #1860 landed, this branch retained its direct Node budget recipe
and was replayed onto explicitly pending local #1847 source
`ce44f2b1b8b0802513d2008af64d474aa27384ac`, not claimed as canonical main.

All **76 scripts genuinely passed** in a fresh conservative run on actual
execution `fed58f603631f6ec4b1a4faefc9e068c2348061b`. The trusted selector was
copied from actual main `2cf7670ca47e65fd3acf1dd0f61fcd54e76afa81`; Node 22 and
the canonical user TMPDIR were used. This includes complete trusted UX050 and
all suites beyond the formerly aborted stage. All tracked input hashes were
verified unchanged after execution. No production changes were needed.
[Selected list, root objects and hashes](UX-053-SUPERSET-CONTINUITY.json) retain
accurate execution provenance separately from later evidence commits.

This is a pending-dependency superset, not final-main acceptance. After #1847
lands, compare fresh actual-main required selection and relevant input hashes,
run any missing/changed coverage, obtain a fresh candidate snapshot and an
actual exact-head Sonnet review. Native MONITOR acceptance and all release /
installation holds remain open. No new full aggregate gate is claimed here.

## Actual-main publication reconciliation

After #1847 merged, this branch was replayed onto verified actual main
`e104ebfe7768ab814dccc145b1dd3412c4912d60` at
`b5f3eadebcdddeddef26fc0868907a77594a2971`. Every non-evidence root object and
tracked source/test/build byte matches actual 76-suite execution `fed58f603`.
Fresh actual-main selection requires 51 scripts, all in the executed superset.
The mapper bytes are identical, but command-path comparison correctly found
that quiet-hours gained a main-owned test and UX052 became main-owned. Both
complete commands were freshly executed through the actual-main trusted mapper
on **b5f3eade**, and passed. No fresh 51-suite or aggregate rerun is claimed.
[Required selection, effective command comparison and rerun hashes](UX-053-MAIN-CONTINUITY.json)
record this distinction. Main-owned UX050's complete direct Node recipe is
unchanged from the successfully executed conservative run.

[Mutation hash continuity](UX-053-MUTATION-CONTINUITY.json) explicitly separates
unchanged original files from historical files changed during integration.
The original 106-mutation certificate is historical, not a claim that its whole
source tree equals this one. Current integration mutation source hashes match
exactly, certifying the combined exported boot promise and teardown guard.
Snapshot/lifecycle fixture adaptations and their preserved assertions were
executed in the fresh conservative run. Native startup timing remains unproven.

A fresh live candidate #1848 snapshot reports zero blockers. Original worktree
`0ad225406542ca6e5a664261c6dcb27cc5e671cf` remains clean and unchanged under
`codex/ux053-preserved-nov7-before-main`; this active worktree now uses the
original PR branch `codex/ux053-boot-readiness`. MONITOR and release/install holds
remain intact. Exact-head Sonnet and hosted checks are still required.
