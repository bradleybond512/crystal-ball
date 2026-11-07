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
