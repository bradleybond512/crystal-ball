# UX-047 integration checkpoint

On 2026-11-07, PR #1844 was rebased onto main
`4cc92fa7731b1416b7ee3d032081ae1c22b9eac9`, after UX-035 and ACC-510.
The package-script and targeted-test mapping conflicts retained both features'
entries. The ACC-510 news provenance changes and UX-047 warning lifecycle coexist
in the data loader. No production behavior was redesigned during reconciliation.

UX-047 remains MONITOR, with PR #1844 as candidate evidence and review after
2026-11-14. Final integrated packaged startup, offline expiry and restart acceptance
remain open. Historical native receipts in the linked feature validation describe
isolated feature-head tests, not installation acceptance of this integrated tree.
Installation, release, tags, build dispatch and deployment remain paused.

## Executed validation

On the integrated source, using Node 22.23.1, the repository gate ran:

```sh
E2E_PORT=4297 VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux047 test:ux047-browser test:acc510 test:sidecar-fallback test:panel-presentation test:roadmap-controller"
```

Actual concluding output:

```text
Agentic validation gate passed.
Tests run: test:ux047 test:ux047-browser test:acc510 test:sidecar-fallback test:panel-presentation test:roadmap-controller
```

Focused output: UX-047 `# pass 124` / `# fail 0`; Chromium
`4 passed (12.6s)`; ACC-510 `# pass 85` / `# fail 0`; fallback/CSP
`# pass 24` / `# fail 0`; presentation `# pass 41` / `# fail 0`;
roadmap controller `# pass 126` / `# fail 0`. The gate also ran lockfile,
lint, application/API typechecks, secret scanning, cross-agent configuration,
documentation, roadmap validation and the production web build.

The broad changed-path runner executed 102 selected scripts, a superset including
the recently merged ACC-510 changes because its initial base-ref snapshot preceded
the local tracking-ref refresh. Its final output was:

```text
[targeted-tests] FAILED: test:little-snitch (exit 1)
```

That sole failure came from using `/private/tmp`, whose inherited group is root,
for fixtures that deliberately verify the current user's group. Repeating the
unchanged suite with the real canonical user temporary directory reported:

```text
# pass 209
# fail 0
# pass 17
# fail 0
```

No assertions or validation rules were weakened. Current-main selection contains
92 scripts, all included in that completed sweep. Existing MCP dependencies were
linked into this isolated worktree for the tests, without changing dependency
manifests. Earlier gate attempts caught missing/invalid MONITOR review metadata;
these were corrected before the successful gate and 126/0 controller result.

## Review, mutation evidence and rollback

The original feature's 57 warning-lifecycle and 16 port-repair mutation receipts
remain historical evidence for unchanged feature logic. The reconciliation adds
no new production behavior requiring a new mutation proof. Independent Sonnet
review and an exact-parent verdict are still required before publication; this
checkpoint does not substitute for that review or claim it has already happened.

Rollback must revert the warning snapshot/lifecycle and its consumers together;
revert the sidecar bind selection and matching CSP policies together. Preserve
historical user state. Do not interpret older builds as providing the new warning
anti-resurrection guarantees.

## Final current-main refresh

The final publication candidate was rebased conflict-free onto verified main
`45a4afad384a623e6a80b6100e8f7b2ffd8fc9ff` after PRs #1843 and #1849.
The six-suite gate above was rerun successfully against this base, including
Chromium and the full lint/type/secret/documentation/build gate. A fresh live
GitHub snapshot declared candidate PR #1844 explicitly and returned zero blocking
roadmap findings. Other unmerged task claims remain advisory, not false DONE claims.

The exact latest-main selector selected and passed 92 scripts with Node 22 and
the canonical user temporary directory. Its script was read from verified main,
not the feature branch. The temporary MCP dependency link was removed afterward.

[Mutation continuity hashes](UX-047-MUTATION-CONTINUITY.json) record 32 source/test
rows, all unchanged from frozen `56ccd569362361d92be0877980262f56aeae36da`.
The only whole-file differences from the original warning mutation checkpoint are
ACC-510's two news-provenance lines in the data loader and the subsequent port
fallback implementation. The warning loader logic and tests are unchanged; the
fallback source and tests match their own later mutation checkpoint exactly.
Thus no historical test run is represented as a new mutation run. Current-base
checks above were actually rerun; final integrated native acceptance stays open.

The original clean local worktree tip
`2416345f69c0f42eedc78d309744666a331a9ccf` remains preserved on
`codex/ux047-preserved-nov7-before-main`. The reconciled worktree now owns the
original PR branch name; neither original files nor its tip were overwritten.
