# UX-058 local dependency integration

Draft #1852 was reconciled on 2026-11-07 onto local pending #1848
`83fa69ebf2142bfb5a5281f74df3271fb234c5ac`, including pending #1844, #1846 and
PR #1847. This is a local dependency checkpoint, not current-main or installed-app
acceptance. The historical combined tree `f0eb8a9a3c3a7927e87da3b5b5632b6a43705388`
was inspected as an integration reference, not treated as current validation.

The integration retains complete national snapshots, current observation times,
warning retirement, single Ghost suppression state/counting, unknown-mode holds,
derived notification preferences, startup cancellation and ACC-510 provenance.
Shared CAP validation now retains the 1,024-character identity bound that the
standalone UX-058 validator lacked. Removing that bound makes the unchanged
renderer and web boundary assertions fail: baseline/restored 66/0, mutant 64/2.
The mutation started and finished clean with identical restored source hashes.
[Actual applied diff and failed assertions](UX-058-INTEGRATION-MUTATIONS.json).

The standalone fixtures were reconciled with snapshot envelopes, loader session
teardown, and explicit browser permission state. Mode suppression is asserted as
suppression with no native delivery attempt, rather than as a failed attempt.
The sidecar recovery fixture now supplies complete CAP fields and advances beyond
the provider cache TTL; its failed-refresh assertion is retained. Focused UX-058
is 89/0 and UX-047 is 124/0; the sidecar route suite is 175/0. The initial full
chain gate exposed the permission fixture mismatch and was rerun after repair.

Under Node 22.23.1 and the canonical user temporary directory, the full gate ran:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux058 test:ux047 test:ux052 test:ux053 test:ux050 test:quiet-hours test:notifications test:acc509 test:roadmap-controller"
```

Its actual concluding output was:

```text
Agentic validation gate passed.
Tests run: test:ux058 test:ux047 test:ux052 test:ux053 test:ux050 test:quiet-hours test:notifications test:acc509 test:roadmap-controller
```

All nine targeted groups, lockfile, lint, application/API types, secrets,
documentation, roadmap checks and production build passed. Counts were 89, 124,
117, 1+71, 89+4+2, 150, 227, 126 and 126 respectively, all zero failures.
Ghost bundle budget reported 468 entries, 21.94 MiB. The separate domain-retirement
suite passed 2/0. Validation logs are local `/tmp/ux058-nov7/`; no hosted results
are claimed for this unpublished checkpoint.

Final current-main reconciliation, broad selection, exact-head Sonnet review,
verdict and hosted checks remain. UX-058 remains MONITOR, review after 2026-11-14.
Historical isolated rendering/mutation receipts are not final integrated packaged
acceptance. Installation, release, tags, build dispatch and deployment remain
paused. Rollback should revert warning-session/dispatch integration together,
without regressing national warning retirement or Ghost fail-closed behavior.

## Refreshed pending dependency

This local checkpoint was replayed onto `37f68658d0b4e34e7b48f3d83937fcd4d98f9b79` while #1844 was still pending.
[Continuity hashes](UX-058-DEPENDENCY-CONTINUITY.json) confirm 31 feature source/test files and the complete
`src`, `src-tauri`, and `api` trees are unchanged from `3b3958b091ccae22fb118320a10d47c23e5e5c7a`.
No new full test run is claimed for this history/metadata transition. The original
local tip is preserved on `codex/ux058-preserved-local-base-nov7`. Actual-main
reconciliation, live candidate snapshot and exact-head Sonnet review remain open.

## Repaired-selector conservative pending-dependency run

On explicit pending #1848 `ad9b7a29d05046ba522dcb69cb7348adc6624b33`, all
**92 selected scripts passed** on actual execution
`1886a48c40f8c1aba58ecd809565a02df7f90574`, using the main-owned selector from
`2cf7670ca47e65fd3acf1dd0f61fcd54e76afa81`, Node 22 and canonical user TMPDIR.
The inherited direct Node budget recipe and corrected upstream mutation evidence
are preserved. Product source is unchanged from frozen `6adfee49`; tracked input
hashes were verified unchanged after execution. This run includes complete
trusted UX050. [Exact selected list and hashes](UX-058-SUPERSET-CONTINUITY.json)
retain execution provenance. No new aggregate gate is claimed by this receipt.

This is not final-main or native acceptance. Fresh actual-main selection/command
comparison, live candidate snapshot, exact-head Sonnet and hosted checks remain
required. MONITOR and all release/installation holds remain open.

## Actual-main publication reconciliation

After #1848 merged, this branch was replayed onto verified actual main
`6dec686846bcf9f12a6de3062ac1b46697d49259` at
`48a7a6fd83d527ae0c3d524864a3bc2d25c71e2c`. All non-evidence root objects and
tracked source/test/build bytes match actual 92-suite execution `1886a48c`.
Fresh actual-main selection requires 90 scripts, all in the executed superset.
Mapper bytes match exactly. Effective-command comparison found quiet-hours
expansion and UX052/UX053 becoming main-owned; all three complete commands were
freshly executed through actual-main's trusted mapper on **48a7a6fd** and passed
(150, 117, and 1+71 respectively, zero failures). No fresh full90 or aggregate
rerun is claimed. [Required list and command/hash proof](UX-058-MAIN-CONTINUITY.json)
records accurate execution provenance; the complete trusted UX050 recipe is
unchanged from the successful conservative run.

[Historical/current mutation hash comparison](UX-058-MUTATION-CONTINUITY.json)
separates the original 95 code reversals and packaging reversal from integrated
source. It does not claim whole-tree identity with that historical certificate.
The current shared-validator identity-cap mutation hash matches exactly. The
fresh conservative run covers the adapted snapshot/lifecycle/permission fixtures
and preserves upstream Ghost, derived and startup guards. Historical isolated
renderer receipts are not current native or installed-app acceptance.

A fresh live candidate #1852 snapshot returned zero blockers. Original clean
worktree `064b0cc72d8836e2eb5ba8f31eabdd9990155f22` remains unchanged under
`codex/ux058-preserved-nov7-before-main`; this active worktree now owns original
PR branch `codex/ux058-deferred-warnings`. MONITOR and all release/install holds
remain intact. Exact-head Sonnet review and hosted checks remain required.
