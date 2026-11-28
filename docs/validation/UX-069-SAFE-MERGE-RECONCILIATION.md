# UX-069 — publication notice reconciliation

November 28 preparation for [candidate #1925](https://github.com/bradleybond512/crystal-ball/pull/1925).
Protected merging of safe work and a new Mac installation are authorized;
public releases, deployment and destructive cleanup remain held. Historical
reports retain their dates, observations and then-current delivery holds.

## Source and bounded reconciliation

Reviewed source: `94724425a318cdbdd45fb608c3b93dd9487f11fa`. Actual main base:
`bda25b90e3039a3ffc21131ce858dfa85a945922`. The initial validation base was
`05231e11dd8a5f3417bf5d13b1e0fe677454424a`; the reconciliation preserves the
subsequently merged dependency-coverage checks. The clean original worktree was
reused on `codex/ux069-safe-merge-nov28`; its original branch ref remains intact.
Eight files match reviewed source byte-for-byte: the workflow, closeout hint,
three test files and three historical documents. The old UX-069 verdict was
excluded. Existing test scripts/mappings need no changes.

The remaining boundary test starts from current main. Its exact checkout
inventory changes from 39 to 38 because the notice job no longer checks out
source; all three dependency and both native workflow checkouts remain covered. It retains every current
credential/publisher guard and adds the reviewed no-notice-checkout and retained
sensitive-checkout assertions. No assertion is removed or relaxed. Native,
dependency, SPC and other workflow bytes remain unchanged. Only UX-069 tracker
metadata changes to MONITOR, with hosted acceptance open and November 29 review.

The approved workflow reports one bounded, identity-validated PR lookup without
creating a PR, changing readiness or enabling auto-merge. Prefix labels and
sensitive-change disablement remain active, including after labeling failure.
The closeout change is a missing-PR hint only; its guards and arming command
are preserved. No closeout execution, permission/settings change, dependency
installation, app/profile access, push, merge or installation occurred here.

## Current validation

Node 22.23.1 and canonical physical `TMPDIR`; existing direct main-sync
dependencies reused after root-lock identity verification.
`npm run test:workflow-security` exited 0:

```text
# tests 127
# pass 127
# fail 0
```

Scoped ESLint for the four changed tests and `bash -n scripts/pr-closeout.sh`
exited 0. The initial PATH lookup for actionlint failed (exit 127); the existing
reviewed actionlint 1.7.12 binary then validated the workflow with exit 0,
including after reconciliation onto current main. No tool was installed.

On the initial `05231e11dd` base, the named gate was:

```sh
bash scripts/agentic-validate.sh --tests "test:workflow-security test:supply-chain-gates test:roadmap-controller"
```

Its literal results were:

```text
# tests 127
# pass 127
# fail 0
# tests 27
# pass 27
# fail 0
# tests 135
# pass 135
# fail 0
Secret scan passed for 6159 file(s).
Agentic validation gate passed.
Tests run: test:workflow-security test:supply-chain-gates test:roadmap-controller
```

That gate also completed type checking, lint and web build. After the mechanical
reconciliation onto `bda25b90e3`, the affected workflow-security suite again
reported `# pass 127` / `# fail 0`, and roadmap tests reported `# pass 135` /
`# fail 0`. `npm run typecheck:all`, actionlint and
`npm run docs:check -- --changelog-advisory` each exited 0; documentation output:

```text
[docs:check] Documentation appears fresh.
```

These are local validation results, not hosted workflow observations. The full
gate is retained as evidence for its stated base; the post-reconciliation checks
cover the changed checkout inventory and current parent guards.

## Historical proofs and remaining acceptance

The [original mutation evidence](UX-069-PUBLICATION-NOTICES.md#mutation-evidence)
records 19 actual detecting controls, inspected applied diffs and restored clean
states. Creation/arming controls went 3/0 → 2/1; lookup identity went 11/0 →
2/9; secret-boundary and checkout-inventory controls each went 3/0 → 2/1.
The restored workflow SHA256 remains:

```text
adeffe3f2c485eadc2da6db271f66dc1aa8715e5469d9bb0d2debec4855f5a27
```

Those are historical proofs for the byte-identical workflow, not newly executed
mutations. The current inventory assertion separately covers the native and dependency jobs
added since that review. Fresh independent reviews, exact-tip verdict, hosted
CI, authorized publication observation and protected merge remain pending.
Do not treat mocked GitHub API behavior as live disablement acceptance.

After authorized publication, verify the exact PR head, accurate notice,
unchanged body/readiness, auto-merge off and unchanged required checks. Do not
arm auto-merge merely to test the workflow. Full UX-069 acceptance stays open
until those hosted observations exist. Separate protected closeout remains the
authorized merge path. Rollback must preserve removal of automatic creation
and arming; a wholesale revert restoring that race requires separate approval.

Raw logs and identity receipts are under `/tmp/ux069-safe-merge-nov28/`;
historical applied mutations remain under `next-nov26/ux069/mutations/`.
