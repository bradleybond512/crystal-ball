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
