# Trusted Ghost test-chain compatibility

## Scope and cause

This is an obvious one-command compatibility repair with regression tests, not a
new security or product design. Main `ef4e1f8fe475405fec712aabfb4d05c4cdc967b3`
selects `test:ux050` as a main-owned suite. Its command includes
`npm run pwa:budget`, which the trusted stage translator correctly refuses.
That prevents downstream PR validation before any Ghost stages can execute.

Only that occurrence changes to the identical direct command:
`node scripts/check-precache-budget.mjs`. The standalone `pwa:budget` command,
budget checker, numerical budget, build stages, tests, trusted translator and
fail-closed npm/shell policy are unchanged. No release/install work is included.

## Executed evidence

The new exact real-command expansion assertion failed before the package change:
focused tests reported 1 passed, 1 failed, with the observed untrusted npm runner.
Afterward the complete agentic suite reported 84 passed, 0 failed. Early unscoped
runs also exposed a temporary-path spelling mismatch in an existing fixture;
using the canonical user temporary directory fixed that unchanged fixture.

Execution source commit: `fa3d00c6c45f9d3aaed73bef3778904ca94be322`.
On that committed source, four clean mutations were applied and restored with
matching hashes. Baseline was 3/0. Restoring the unsupported alias gave 2/1;
omitting the budget gave 2/1; admitting npm gave 1/2; admitting a shell gave 2/1.
The latter controls temporarily mutate the unchanged translator to demonstrate
that the refusal assertions remain load-bearing, not to expand its policy.
[Actual diffs, assertions and hashes](TRUSTED-GHOST-BUDGET-MUTATIONS.json).

On the same execution source under Node 22 and the canonical user temporary
directory, the complete gate passed:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:agentic-pipeline test:ux050"
```

Actual conclusion: `Agentic validation gate passed.` This includes the complete
Ghost suite, production web build and PWA budget plus lint, types, secrets,
lockfile, documentation and roadmap checks. The unchanged selector copied from
actual main passed all five selected scripts: agentic-pipeline, desktop-identity,
domain-retirement, install-scripts and workflow-security.

Logs remain in `/tmp/trusted-pwa-alias/`. Later evidence/review commits are not
claimed as new test execution heads. No product behavior or packaged acceptance
claim changes. After this repair lands, downstream branches must reconcile the
actual main command and execute the complete trusted Ghost path before closeout.
