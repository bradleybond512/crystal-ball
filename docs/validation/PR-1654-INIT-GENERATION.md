# PR #1654 initialization ownership repair evidence

This is repair cycle two. Implementation commit:
`8cea721cd4ff590f5a89c389a10b1bc82c49f508`. Discovery used the PR's remote tip
`60d0a5740`; the isolated repair branch was rebased onto freshly fetched main
`844541dd93121f5ee13d09af75be77a8223ccdbe` before committing. The parent will
cherry-pick only the repair commits, preserving the PR author's history and dirty
checkout. No push, self-review verdict, installation, or profile changes occurred.

## Corrected behavior and boundaries

Termination while capability detection awaits a browser GPU probe can no longer
let the obsolete initialization create a worker, publish manager capabilities, or
revive availability. A new explicit initialization can start while the old probe
remains unresolved. Old completions, ready deadlines, and worker callbacks do not
own the new attempt.

`src/services/ml-worker.ts` captures generation before capability detection,
validates the local result before publication, passes ownership into worker
creation, releases the shared promise slot during cleanup, and checks generation
in the ready-timeout callback. The existing identity-checked promise cleanup,
late-factory protection, and worker-identity checks remain intact.

`src/services/__tests__/ml-worker-manager.test.mts` adds ten lifecycle cases using
the real manager and detector, deferred `navigator.gpu.requestAdapter`, an injected
fake worker, and controlled timers. Tests restore the GPU property descriptor and
capability cache in `finally`. Bounded assertions precede readiness awaits. No real
model download or browser worker is created.

This repair does not abort the browser GPU probe or add a probe deadline. The
obsolete init promise returns false only after its probe settles. It changes no
model budgets, inference output, forecast behavior, settings, provider boundary,
worker message schema, or persisted data.

## Executed validation

Commands used `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.

| Command/run | Literal result |
| --- | --- |
| `npm run test:ml-budget`, original suite | `# pass 21` / `# fail 0` |
| Same command, new tests before production correction | `# pass 27` / `# fail 4` / `# cancelled 0` |
| Same command, corrected source | `# pass 31` / `# fail 0` |
| Same command, after rebase and after restoring all mutations | `# pass 31` / `# fail 0` / `# cancelled 0` |
| `npm run typecheck:all` | `tsc --noEmit && tsc --noEmit -p tsconfig.api.json`, exit 0 |
| `npx eslint src/services/ml-worker.ts src/services/__tests__/ml-worker-manager.test.mts` | No diagnostic output, exit 0 |
| `git diff --check` | No diagnostic output, exit 0 |
| `bash scripts/agentic-validate.sh --tests 'test:ml-budget'` | `Agentic validation gate passed.` / `Tests run: test:ml-budget`, exit 0 |

The gate executed tests, lockfile verification, strict lint, both type-checking
configurations, secret scan, cross-agent configuration, docs/roadmap checks, and
production build. Expected injected worker failures log errors during tests.
Existing build dynamic-import/plugin warnings and roadmap advisories remain in
the full log; none were hidden or weakened. The source and test SHA-256 values
were unchanged across rebase. Commit hooks reran type checks afterward.

The four original failures were: terminated detection invokes the factory;
fresh initialization cannot start while the obsolete detector remains pending
(tested with both completion orders); and an already queued obsolete ready-timeout
callback terminates the replacement worker. Additional cases preserve concurrent
caller coalescing, late-factory resolution/rejection, stale worker messages/errors,
unsupported-device behavior, creation failure/retry, and request-budget/eviction
and pending-request settlement regressions.

## Clean-tree mutations

Each run started with empty `git status --short` at the implementation commit.
Only `src/services/ml-worker.ts` changed. Each actual applied diff was inspected
before running `npm run test:ml-budget`; every mutation exited 1:

| Mutation and confirmed diff | Baseline → red counts | Failure observed |
| --- | --- | --- |
| Delete the generation check immediately after capability detection | 31 pass / 0 fail → 28 pass / 3 fail | Terminated detector and both old/new completion orders |
| Replace identity-checked `finally` cleanup with unconditional `this.initPromise = null` | 31 pass / 0 fail → 30 pass / 1 fail | Old detector completion clears the newer pending slot |
| Delete `this.initPromise = null` from `cleanup()` | 31 pass / 0 fail → 29 pass / 2 fail | Replacement initialization blocked in both completion orders |
| Delete generation check from ready-timeout callback | 31 pass / 0 fail → 30 pass / 1 fail | Obsolete callback terminates current worker |
| Delete post-factory generation check and late-worker termination | 31 pass / 0 fail → 29 pass / 2 fail | Factory completion after termination/timeout attaches obsolete worker |

Every restore verified this same SHA-256 and empty working-tree status:

```text
e04a4f11f551fcce5044f797efb2041be5caf26fa457d75188a181bd97aa6a42
```

The test file SHA-256 is:

```text
f303bfa9a00d5a6a7f35e1368f5ff1fde53e14e939d65b5ab4a224f055f0c2ec
```

External evidence:
`/Users/bradleybond/.crystalball-diagnostics/pr1654-repair2-20260922/` contains
`baseline.log`, `race-red.log`, `race-green.log`, `rebased-green.log`,
`restored-green.log`, `typecheck.log`, `eslint.log`, `agentic-gate.log`, and
`mutation-*.{diff,log,json}`. JSON records include commit, actual failing test
names, counts, original/restored hashes, and clean restoration. The external
mutation runner initially compared a multiline replacement directly against a
prefixed Git diff; that verification assertion failed after applying the slot
mutation. The actual diff was inspected and saved before testing, then the runner
was corrected to check individual lines. No failed application or green run was
counted as mutation evidence.

## Review and remaining verification

Fresh independent review and the final cross-agent verdict are pending. Because
this is the second repair cycle, any remaining confirmed blocking finding must
be escalated. This report is not merge approval or a native-app acceptance claim.

For manual verification, use a development harness with a deferred GPU probe:
start ML initialization, terminate it, start another attempt, then release the
probes in both orders and verify only the current worker becomes available.
A reviewed source revert rolls back this change without migration; it also
reopens the lifecycle races. No installed app was modified.
