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
