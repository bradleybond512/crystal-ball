# UX-071 — verified CI acceptance

Acceptance evidence closed November 16, 2026. Delivery remains held: draft
[#1904](https://github.com/bradleybond512/crystal-ball/pull/1904) is unmerged and
auto-merge is disabled. Merging, releases, deployment and installation remain
paused. The tracker retains IN PROGRESS while its evidence PR is open; this
does not mean native CI acceptance is still pending.

## Source and successful checks

Approved head `46ecea15e00aa8ba19e76e9691820ce4d098536d` was tested as merge
source `b66bc7ecec7aed97dff616098cf8fa6c5c223d96` in
[Native run 43922472743](https://github.com/bradleybond512/crystal-ball/actions/runs/43922472743).
All 16 workflows succeeded: 33 successful checks and one intentionally skipped
watchdog check. Targeted tests, Typecheck, Security Audit, signature verification,
cross-agent review and the aggregate native evidence gate passed.

All eight native harnesses ran without ignored or filtered cases:

| Harness | Linux pass/fail | macOS ARM64 pass/fail |
| --- | --- | --- |
| current_location_contract | 10/0 | 10/0 |
| imessage_contract | 44/0 | 44/0 |
| notify_policy_contract | 7/0 | 7/0 |
| sidecar_supervisor_contract | 26/0 | 26/0 |
| updater_identity_contract | 1/0 | 1/0 |
| vault_coordinator_contract | 47/0 | 47/0 |
| watchdog_contract | 9/0 | 9/0 |
| crystalball | 125/0 | 128/0 |
| Total, summed from receipts | 269/0 | 272/0 |

Actual binary-harness output includes `test result: ok. 125 passed; 0 failed;`
on Linux and `test result: ok. 128 passed; 0 failed;` on macOS. Strict locked
Clippy passed both platforms; warnings were not suppressed. The corrected
ten-case location wrapper passed in the hosted targeted suite.

## Deliberate failure and restoration proof

Each entry is actual red pass/fail → full restored-green pass/fail. Every
applied diff, source hash, exact failing-name set, restored checksum and clean
restoration was independently audited against the raw artifacts. Control
definitions and source/failure-name bindings remain in the
[fixed proof contract](../plans/2026-11-15-ux071-native-proof-contract.md).

| Control | Linux | macOS ARM64 |
| --- | --- | --- |
| watchdog | 8/1 → 9/0 | 8/1 → 9/0 |
| crypto-nonce-rejection | 124/1 → 125/0 | 127/1 → 128/0 |
| crypto-auth-rejection | 121/4 → 125/0 | 124/4 → 128/0 |
| updater-dto-required-fields | 124/1 → 125/0 | 127/1 → 128/0 |
| updater-serialization | 123/2 → 125/0 | 126/2 → 128/0 |
| native-outcome-serialization | 124/1 → 125/0 | 127/1 → 128/0 |
| location-error-serialization | 8/2 → 10/0 | 8/2 → 10/0 |
| vault-accessor-authority | 123/2 → 125/0 | 126/2 → 128/0 |
| updater-lock-nontruncation | Not applicable | 127/1 → 128/0 |

All eight Linux and nine macOS controls were required and detected their exact
intended failures. The native evidence gate accepted both complete receipts.
Driver stages totaled 239,141 ms Linux and 318,733 ms macOS (3.99/5.31
minutes), within existing limits. These are not full billed-job durations.

Raw artifacts are named `native-linux-x64` and `native-darwin-arm64` on the
linked run. A retained session copy is under
`next-nov15/remaining-gates/hosted-46ece/`: receipts and raw command output in
`linux/` and `darwin/`; `summary.json`, `workflow-results.json`, `pr-checks.json`
and `independent-review.txt` preserve the audit trail.

## Review and acceptance boundary

Both final source reviewers found zero blockers for
`1fbd47de8b269b3d7ad3b13bd8d06e349a764c99`; the published verdict pins that
source. Independent hosted-evidence review found no blocking findings and
verified every target, control, hash and raw red/restored-green output.

This satisfies UX-071's approved CI acceptance: passing platform jobs and
deliberately failing fixture controls without secrets or real native user-state
access. It does not establish GUI, permission, real-Keychain, Windows or Intel
runtime acceptance. No local native execution, app launch or installation ran.
Moderate/low dependency findings and the separately disclosed intermittent
400 ms portable fixture risk remain outside this acceptance.

This report supersedes pending-hosted-verification statements in the
[repair report](UX-071-HOSTED-GATE-REPAIR.md) and
[earlier validation](UX-071-REMAINING-GATES.md). This closeout changes
documentation only. Rollback is a reviewed documentation revert; it neither
changes native source nor erases the recorded passing results. No new manual
app check is required for this CI-only acceptance, and delivery holds remain.
