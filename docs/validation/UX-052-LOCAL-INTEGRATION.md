# UX-052 local dependency integration

On 2026-11-07, draft #1847 was reconciled onto local pending #1846
`bb4055611754fc1f07bd212fe1175541f3fad051`, which includes pending #1844.
This is a local dependency checkpoint, not canonical-main acceptance.

The dispatcher retains one shared Ghost hold, unknown-preference fail-closed
behavior and one suppression count. Critical reminders require both operational
warning membership and a non-derived source. The original derived cooldown,
quiet policy, bounded title accounting and silent banner behavior are retained.

The derived test fixture originally left shared unknown-mode state latched
between tests: 116/1 became 117/0 after an explicit fixture mode reset. Additional
assertions prove one Ghost count, no unknown-state count, and no recovery until
an explicit mode choice. The Ghost analyst fixture needed browser storage before
strict preference initialization and a deterministic noon clock for an eligible
derived delivery. Its original assertions were retained: 8/1 became 9/0.

## Executed proof

The combined derived/reaction/operational-consumer baseline reported `# pass 31`
and `# fail 0`. Four independently applied reversals each reported `# pass 30`
and `# fail 1`: remove operational reminder eligibility, remove derived reminder
exclusion, remove Ghost accounting, and remove the unknown-mode hold. Every
reversal began with clean Git status, produced a checked diff and was restored
to the recorded SHA-256 with clean status. [Diffs, failed assertions and restored
hashes](UX-052-INTEGRATION-MUTATIONS.json).

A transport reset interrupted an earlier gate at build. The entire gate was
rerun successfully under Node 22.23.1 using the canonical user temp directory:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux052 test:ux047 test:ux050 test:quiet-hours test:notifications test:acc509 test:native-notify test:roadmap-controller"
```

Actual output:

```text
Agentic validation gate passed.
Tests run: test:ux052 test:ux047 test:ux050 test:quiet-hours test:notifications test:acc509 test:native-notify test:roadmap-controller
[pwa:budget] 468 entries, 21.93 MiB
```

All groups reported zero failures: UX-052 117, UX-047 124, UX-050 65/4/2,
quiet-hours 126, notifications 227, ACC-509 126, native-notify 5/77 and
roadmap-controller 126. Lockfile, lint, types, secrets, documentation, roadmap
and production build passed.

## Remaining gates

The tracker is MONITOR with review after 2026-11-14. Final canonical-main
reconciliation, changed-path testing, fresh exact-head Sonnet review, verdict
and hosted checks remain required. Original isolated renderer receipts do not
prove final integrated installed-app acceptance. Installation, release, tags,
build dispatch and deployment remain paused. No new OS notification recipient
or installed profile was exercised.

Rollback must preserve the shared Ghost state and warning retirement guards
when removing derived interruption policy; do not restore either old competing
mode reader or reminders for retired warning history.

## Refreshed pending dependency

This local checkpoint was replayed onto `142069b7046b435b7dbc8b9e01245b50f28f5aca` while #1844 was still pending.
[Continuity hashes](UX-052-DEPENDENCY-CONTINUITY.json) confirm 17 feature source/test files and the complete
`src`, `src-tauri`, and `api` trees are unchanged from `7cbe1f622b06b582be59b6741e31fdd5f855699f`.
No new full test run is claimed for this history/metadata transition. The original
local tip is preserved on `codex/ux052-preserved-local-base-nov7`. Actual-main
reconciliation, live candidate snapshot and exact-head Sonnet review remain open.

## Hosted-CI-time conservative validation

While #1846 was still pending at `31baf59433a9cc6dc136a58e72dd0a1c01b18fe3`, this local branch
was replayed onto it without source/test changes. The selector copied from actual
main `4b047a1288291fd4f030985b26878c28b28b38d5` selected and passed 74 scripts on
`8021f76453d6225b04393d519830a993e56d95c9` under Node 22 and the canonical user temporary directory.
This selection conservatively includes both pending Ghost and derived changes.
[Selected list, trees and input hashes](UX-052-SUPERSET-CONTINUITY.json) preserve
what actually ran; the complete 4,013-file hash manifest and log remain local in
`/tmp/ux052-superset/`. No current-main-only pass or new full gate is claimed here.

After #1846 lands, compare the fresh main-owned required selection and all relevant
source/test/build bytes against this receipt, rerunning new or changed coverage.
A final live candidate snapshot, exact-head Sonnet review and hosted checks remain
required. Native acceptance and installation/release holds are unchanged.

The subsequent metadata-only rebase at `54038130340bf6b8443dc376fe1b1de3df01196d` onto corrected pending #1846
`e7fd299d9b624e7c1d41d13bffae66264d8b29c3` preserved every non-evidence root object
and all 42 relevant file hashes in the superset receipt. The 74-script execution
head remains `8021f76453d6225b04393d519830a993e56d95c9`; no rerun is claimed.

## Actual-main publication candidate

After #1846 merged, the prepared branch was replayed onto actual main
`ef4e1f8fe475405fec712aabfb4d05c4cdc967b3`. Fresh main-owned selection requires
65 scripts, all contained in the 74 scripts actually executed on
`8021f76453d6225b04393d519830a993e56d95c9`. Every non-evidence root Git object
and all 42 relevant file hashes match that execution receipt, including tests,
source and build configuration. [Selection comparison](UX-052-MAIN-CONTINUITY.json)
records the actual execution head separately from later evidence and rebase heads.
No fresh test run is claimed for this metadata/history-only transition.

A fresh live GitHub snapshot explicitly naming candidate PR #1847 returned zero
roadmap blockers. MONITOR, final packaged acceptance and installation/release
holds remain unchanged. The original clean worktree at
`16d2c73aa85e80cb551b08a5900f7c348d305787` was reversibly preserved on
`codex/ux052-preserved-nov7-before-main`; the reconciled worktree now owns the
original PR branch name. Final exact-head Sonnet review and hosted checks are
still required, not claimed as already passed by this document.

## Repaired trusted execution path: supersedes publication coverage conclusion

Hosted targeted-tests on the prior candidate failed before UX050 execution:
the newly main-owned recipe contained `npm run pwa:budget`, which the trusted
mapper correctly refused. The earlier 74-script run remains genuine, but its
selection-name subset and byte-continuity comparison did not prove the changed
main-owned execution path. It must not be used alone to certify this candidate.

After compatibility PR #1860 landed, this branch was replayed onto actual main
`2cf7670ca47e65fd3acf1dd0f61fcd54e76afa81`, retaining the identical direct Node
budget check and unchanged fail-closed mapper. Production source is unchanged
from the prior candidate. Pending-base `ff47fbc63366db0f630c7542b540ac684ee7be54`
and actual-main execution `8d176013589f2411a201ec880556bbdd73d637b0` have identical
complete Git trees. Both fresh commands below actually ran on **8d176013** under
Node 22 and the canonical user TMPDIR, not on a later evidence/verdict commit:

- Main-owned `targeted-tests.mjs` copied from actual main: **65 scripts passed**,
  including the complete UX050 trusted stage expansion, full build, direct
  precache budget check and bundle test. This is not a retry on the stale base.
- `VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:agentic-pipeline test:ux052 test:ux050"`:
  **passed**, including lint, typecheck, secrets, documentation and full build.

[Execution receipt](UX-052-REPAIRED-MAIN-VALIDATION.json) records the selected list,
non-evidence root objects and log/complete input-manifest hashes. Every tracked
input hash was verified unchanged after both runs. Existing integration mutation
proofs remain applicable because the product/test implementation is unchanged
since the integrated 74-suite checkpoint, not since the original feature head;
PR #1860 carries its own focused recipe/mapper fail-closed regression mutations.
A fresh live candidate #1847 snapshot returned zero blockers. MONITOR and final
integrated native acceptance remain open; no release or installation occurred.
A new exact-head Sonnet review and hosted checks are still required.

## Mutation evidence provenance clarification

`UX-052-MUTATIONS.json` is historical proof for original implementation
`92259e7f2f415c551ffb05751c934d47c23ce871`. Its dispatcher hash `1c77ed78...`
and old `modeHoldForDispatch` / `isWindowInGhostMode` patches do **not** describe
or certify the current shared Ghost implementation. Do not apply those original
mode-reader mutations to this integrated dispatcher. The integration receipt
instead certifies `holdNotificationForMode` and its restored current dispatcher
SHA-256 `417257e01d22289d96137b4617a6d01de9c579447eda4c31828ff4f93d01d631`.

To remove ambiguity after review, five focused mutations were genuinely rerun
on clean source/evidence commit `050f449008cca991a982818582b929d07360393a`.
[Current-source diffs and failed assertions](UX-052-REPAIRED-MAIN-MUTATIONS.json)
record a 31/0 baseline, four reversals each 30/1, and a Ghost-hold reversal 29/2.
The last reversal fails both saved-Ghost suppression and the explicit live Ghost
choice after a failed storage write. Unknown-preference hold and suppression
accounting are independently reversed. Original bytes and clean Git status were
verified after every restoration. No production or test code changed. These
current-source proofs supersede the old mode-reader proofs for this integration.
