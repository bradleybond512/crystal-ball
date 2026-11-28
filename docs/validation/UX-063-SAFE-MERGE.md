# UX-063 — safe merge reconciliation

November 28, 2026. The approved retained-local-Sonnet decision from #1890 is
reapplied to the reviewed native/security candidate `1fb3d0d344`. The three
original design, report and JSON certificate files are byte-identical to
`869526a50bcacbdba51d3c4a471eb44ab4a3941e`; their observations, sample model
versions, counts and delivery holds are historical. No old verdict is replayed.
Only UX-063's task section and row are transplanted; other tasks and all runtime,
workflow, dependency and policy files remain unchanged.

The user now authorizes safe protected merging and a verified Mac build/install.
Public releases, deployment and destructive cleanup remain paused. The retained
review path is still in use; no CI runner, credential, permission or spending
change is introduced. Full baseline-comparison work elsewhere stays open.

Current local validation passed as quoted below. Fresh reviews, actual-main
reconciliation and hosted checks remain pending at this preparation checkpoint. This documentation-only
decision adds no behavior, so no new mutation proof applies. Historical control
proofs do not become fresh execution merely by copying them. Rollback reverts
this decision documentation and tracker entry; no data or runtime rollback.

## Current validation

Node 22.23.1 with canonical macOS TMPDIR; exact command:

```sh
bash scripts/agentic-validate.sh --tests "test:agentic-pipeline test:roadmap-controller"
```

Actual output (pipeline, roadmap, gate), exit 0:

```text
# tests 85
# pass 85
# fail 0
# tests 135
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:agentic-pipeline test:roadmap-controller
```

The gate also ran typecheck:all, lint, secrets, documentation and ordinary build.
No new behavior or dependency execution policy was added. Raw log:
`/tmp/ux063-safe-gate.log`. No application installation or private-state test ran.

## Actual main reconciliation

The documentation-only delta was replayed without conflicts onto merged main
`bda25b90e3039a3ffc21131ce858dfa85a945922`. Its original three payload files,
UX-063 task section and row remain identical to independently reviewed
`62bbc12b1d28790104db703a26696c6fc6d0019e`; all intervening security, native and
dependency-coverage changes remain on the parent. The gate above is the earlier
preparation result, not a new run. Both reviews cleared that prepared diff;
current-tip reconciliation review and hosted CI remain pending.
