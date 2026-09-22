# PR #1715: declaration-file CLI validation

## Scope and acceptance

The original six helper tests did not exercise `main()` reading
`scripts/targeted-tests-overrides.json`. The validation repair adds three
integration tests to `tests/agentic-pipeline.test.mjs`; production selector
behavior is unchanged.

Each test owns a temporary Git repository with a real `origin/main` package
snapshot and committed PR changes. The real CLI runs in a subprocess and reads
the declaration from disk. Test runners write marker files, so selection alone
cannot masquerade as execution. The fixture clears inherited `NODE_TEST_CONTEXT`
to permit nested Node test processes, removes GitHub base/summary variables, and
cleans its temporary repository afterward.

The tests demonstrate that a new declaration runs its suite, a nonexistent suite
leaves the changed source uncovered, and a PR cannot replace a main-owned command
by changing its package script or adding another declared mapping. No selector,
Git, npm, or child-process execution is mocked.

## Validation

Commands ran with `PATH=/opt/homebrew/opt/node@22/bin:$PATH` after a clean rebase
onto fetched canonical main. Test implementation commit:
`7f634681d35940fec29a4e9c9340d80daae5051a`.

`npm run test:agentic-pipeline`, including a rerun after restoration:

```text
# tests 57
# pass 57
# fail 0
# cancelled 0
```

`npm run typecheck:all` exited 0:

```text
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

`bash scripts/agentic-validate.sh --tests "test:agentic-pipeline"` exited 0,
including the targeted tests, lockfile check, strict lint, typechecks, secret
scan, cross-agent advice, documentation checks, roadmap checks, and production
build:

```text
Agentic validation gate passed.
Tests run: test:agentic-pipeline
```

The gate printed roadmap/changelog advisories and bundler dynamic-import/plugin
timing warnings. Its cross-agent advice is not a SHA-pinned review verdict;
independent review and verdict recording remain delivery requirements.

## Mutation proof

Every mutation began and ended with empty `git status --short`. Only
`scripts/targeted-tests.mjs` was mutated. The applied `git diff` was captured and
inspected before running `npm run test:agentic-pipeline`. Original bytes were
restored after each mutation and `shasum -a 256` matched before and after:

```text
3465ea39dfd5307743013b178ed015f8efdcc62e5960fa80d7526812489a03a1  scripts/targeted-tests.mjs
```

| Applied mutation | Baseline pass/fail | Mutated pass/fail | Observed failure |
| --- | --- | --- | --- |
| Replace `selectScripts(changed, prIndex, mergeOverrides(OVERRIDES, prDeclaredOverrides()))` with `selectScripts(changed, prIndex)` | 57/0 | 56/1 | New declaration CLI test: exit 1 instead of 0; `scripts/new-engine.mjs (NEW GAP)` |
| Set `mapped = true` before checking whether the declared script exists in the index | 57/0 | 55/2 | Helper and CLI nonexistent-suite tests fail; CLI exits 0 instead of 1 with `0 script(s) passed.` |
| Pass `prScripts[script]` instead of `mainScripts[script]` into the trusted command expansion | 57/0 | 55/2 | Existing trusted-main source guard fails; new CLI test cannot read `trusted-ran.txt` because the replacement command executed |

All mutations exited 1 with zero cancelled tests. Restored targeted tests returned
57 pass / 0 fail. The external evidence directory is
`~/.crystalball-diagnostics/pr1715-validation-20260922/`; it contains the applied
diffs, raw runner output, checksums, mutation records, and gate output.

## Review, limitations, and rollback

This report records implementation validation, not independent approval. The
parent delivery task owns the independent review and exact-tip cross-agent
verdict. No application profiles, live network endpoints, native installation,
or model inference were exercised; this change concerns a local CI selector.

To verify manually, run `npm run test:agentic-pipeline` and inspect the three
`PR overrides CLI` cases. Reverting this test-only repair removes its regression
coverage without changing application behavior. No data migration is involved.
