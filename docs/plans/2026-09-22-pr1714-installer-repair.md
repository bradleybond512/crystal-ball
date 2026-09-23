# PR1714 incomplete nested installation repair

Risk: high assurance, install behavior. User approved this bounded design on
2026-09-22 after the partial-install reproduction and design comparison.

## Goal and acceptance

A failed nested MCP installation must not make the next prepare call skip repair
merely because node_modules exists. Resolve the actual SDK server/mcp.js,
server/stdio.js and Zod entrypoints from the nested package without executing
dependency code. Skip only when each resolves inside its own node_modules tree;
missing entrypoints or hoisted root packages must select the existing installer.

Preserve disabled/no-package/no-npm paths, lockfile preference, nonfatal failure
reporting and invocation through the existing Node/npm executable with no shell.
Synthetic subprocess tests must cover failed-then-retried installation, complete
local installation, missing SDK/Zod entries, hoisted dependencies and suppression
paths. Each new behavior needs an applied mutation with a real assertion failure,
restored checksum and clean tree.

## Boundaries and limits

No dependency additions, install stamp, signing, secrets, deployed application,
source feed, or unrelated PR behavior changes. The resolver checks entrypoint
presence and locality; it does not prove all transitive files are intact or that
installed versions match a changed lockfile. Tests use temporary directories and
a fake npm child, never the user's real package installation or credentials.
Rollback restores the original installer decision logic through a reviewed PR.

## Bounded owners and validation

- Installer specialist: scripts/install-mcp-deps.mjs and
  tests/install-mcp-deps.test.mjs; update this brief with actual evidence.
- Parent: mechanical integration of the existing PR onto current main, aggregate
  validation and publication. Preserve all unrelated source and dirty worktrees.
- Independent reviewer: completed diff and failure-path/mutation evidence.

Run test:mcp-deps first, both TypeScript configurations, then the named agentic
gate. Parent also verifies the existing PR's affected sanitizer, layout and
bundle checks. Required GitHub checks and genuine cross-agent review govern merge.

## Repair evidence (2026-09-22)

Code commit: `632c2b602c4728849921441c43e3742d9a7be073`.
The installer now probes the three ESM exports in one Node subprocess anchored
at the nested package, without importing dependency code. The probe has a
2-second timeout, discards output, and requires real paths to regular files
inside the nested node_modules directory. Missing files, malformed metadata,
hoisted packages, and symlink escapes select the existing installer. The
present-package prepare path adds one short Node process; disabled and absent
package paths still return first. No dependency, signing, secret, permission,
installed application, or npm invocation changes were made.

Tests use temporary fake npm executables, including a shell-metacharacter path;
none of the controlled tests or mutations invoked a real dependency installer.
The inherited executable placeholder was changed to a temporary fake before
running the final mutation set, preventing recursive production invocation if a
skip-path assertion regresses.

Actual command evidence, saved under
`~/.crystalball-diagnostics/pr1714-installer-repair-20260922/`:

- Original `npm run test:mcp-deps`: `ℹ pass 8`, `ℹ fail 0`.
- New tests before the fix: `ℹ pass 10`, `ℹ fail 9`.
- Final restored `npm run test:mcp-deps`: `ℹ pass 19`, `ℹ fail 0`.
- `bash scripts/agentic-validate.sh --tests "test:mcp-deps"`, exit 0:
  `Agentic validation gate passed.` and `Tests run: test:mcp-deps`.
  This ran strict lint, `tsc --noEmit && tsc --noEmit -p tsconfig.api.json`,
  secret scanning, documentation/roadmap checks, and `tsc && vite build`.
  Secret scan output: `Secret scan passed for 4837 file(s).`
- The final test-only safety adjustment followed that gate. The focused suite
  and normal commit hooks ran again: both TypeScript configurations, staged
  secret scan (`Secret scan passed for 1 file(s).`), and staged ESLint passed.
- Fresh canonical main was `c41122898ad0dc2143943766304ac26599e4959b`;
  the pre-commit rebase reported the branch was up to date. No push occurred.

All final mutations changed only `scripts/install-mcp-deps.mjs`, started with an
empty `git status --short`, and had their applied `git diff` inspected before
running the test. Each exited 1 with real assertions, then restored the original
file and an empty status. Before/restored SHA-256 for every mutation:
`1f4558469d742e937d3147c2ed891500302247fd4b68eb53256f7c8156fbe84c`.
Diffs, assertion output, and clean-tree/hash records are in
`final-mutation-{directory,locality,cjs,execution}*` in the evidence directory.

| Mutation | Green counts | Red counts | Observed assertion |
| --- | --- | --- | --- |
| Restore directory-only skip | 19 pass / 0 fail | 10 pass / 9 fail | `skip:installed` instead of `ci`; retry skipped |
| Remove real-path locality guard | 19 pass / 0 fail | 17 pass / 2 fail | Hoisted and symlinked installs returned `skip:installed` |
| Resolve CommonJS exports | 19 pass / 0 fail | 15 pass / 4 fail | Missing ESM entries returned `skip:installed` |
| Execute imports before resolution | 1 pass / 0 fail | 0 pass / 1 fail | Throwing fixture returned `ci` instead of `skip:installed` |

The execution mutation used the bounded focused command
`node --test --test-name-pattern='^skips when all local dependency entrypoints resolve without executing them$' tests/install-mcp-deps.test.mjs`.
The restored focused test and full 19-test suite both passed afterward.

Independent review and aggregate PR acceptance remain parent-owned and pending
at this evidence checkpoint. This repair does not certify unrelated PR changes.
Manual verification can rerun `npm run test:mcp-deps` without networking or a
real install. Remaining limits: entrypoint presence is not full transitive
integrity or lockfile-version validation; an unavailable/timed-out probe selects
the existing nonfatal installation attempt. Rollback is a reviewed revert of
this installer/test commit, with the original incomplete-directory risk stated.

### Additional preserved-behavior mutation evidence

The review's evidence gap for the newly added no-lockfile and suppression tests
was closed without production or test changes at the same code commit. Pending
brief text was preserved externally and restored from HEAD before these checks;
it was reapplied only after all three mutations restored a clean tree.

Each focused command used `node --test --test-name-pattern='^<exact name>$'
 tests/install-mcp-deps.test.mjs`, with the option before the filename. Every run
recorded `ℹ pass 1` / `ℹ fail 0` before mutation, `ℹ pass 0` / `ℹ fail 1` with
exit 1 and a real assertion after mutation, then `ℹ pass 1` / `ℹ fail 0` after
restoration. Applied diffs were inspected before executing each red run.

| Mutation | Exact focused test name | Observed assertion |
| --- | --- | --- |
| Force `ci` without a lockfile | successful fake npm uses install without a lockfile and repaired dependencies skip | `Action: ci` did not match `/Action: install/` |
| Remove disabled early return | suppressed and absent package paths never execute npm | `Action: install` did not match `/Action: skip:disabled/` |
| Remove absent-package early return | suppressed and absent package paths never execute npm | `Action: install` did not match `/Action: skip:no-package/` |

All subprocess installer paths were temporary fake npm scripts. The source
SHA-256 before and after each mutation remained
`1f4558469d742e937d3147c2ed891500302247fd4b68eb53256f7c8156fbe84c`, with an empty
`git status --short` before each mutation and after each restoration. Exact
commands, green/red/restored output, inspected diffs, and hash/status evidence
are saved in `preserved-{no-lockfile,disabled,no-package}*` under the same local
evidence directory. The full gate was not repeated for these evidence-only
checks; the unchanged production source retains the earlier gate result.
