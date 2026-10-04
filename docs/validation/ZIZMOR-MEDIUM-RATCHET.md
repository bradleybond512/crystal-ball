# zizmor medium ratchet validation

Follow-up to Q20 PR B (PR #1781, `docs/validation/Q20-B-CI-LOWS.md`). That
PR added a zizmor job that failed only on high-severity findings. Bradley
chose the "zizmor medium ratchet" follow-up on October 4, 2026. This PR
clears the medium backlog and makes the job block on medium. Stacked on
PR #1781.

## What changed

- **`artipacked`: checkouts no longer keep the token.**
  - Every `actions/checkout` step sets `persist-credentials: false`. This
    PR adds it to 30 checkouts in 20 workflows; the other 2 already had it.
    Before, the `GITHUB_TOKEN` was written
    into `.git/config`, where any later step (or an uploaded artifact that
    includes the workspace) could read it.
  - **One exception: `auto-tag.yml`.** It pushes the release tag with
    `git push` later in the same job, so it keeps the token. It carries an
    inline `zizmor: ignore[artipacked]` with that reason.
- **`excessive-permissions`: least privilege by default.**
  - Seven workflows had no top-level `permissions:` block, so every job
    inherited the repository's default token scope: actionlint,
    build-desktop, eslint, lint, secret-scan, security-audit and typecheck.
  - Each now declares `permissions: contents: read`. Jobs that need more
    already declare it themselves.
  - `roadmap-controller.yml` and `test-linux-app.yml` have no top-level
    block, but every one of their jobs declares its own, which is
    equivalent.
- **The CI gate:** `actionlint.yml` now runs zizmor with
  `--min-severity medium`, so a new medium or high finding fails the build.

## Audit before and after

zizmor 1.30.1, `--offline`, run over `.github/workflows`.

| | Medium+ findings |
|---|---|
| Before (#1781 head, `2b8f0882f`) | 43 (30 `artipacked`, 13 `excessive-permissions`) |
| After | 0 |

The three inline ignores are the only medium-or-higher findings left
unreported. Each one was confirmed by stripping the annotations from a copy
of the workflows and re-running zizmor:

| Finding | Where | Why it stays |
|---|---|---|
| `artipacked` | `auto-tag.yml` checkout | pushes the release tag with the checkout token |
| `cache-poisoning` | `build-desktop.yml` Rust cache | the step is skipped when publishing (#1781) |
| `dangerous-triggers` | `dependency-change-gate.yml` | never checks out PR code; read-only token (#1772) |

actionlint (`-shellcheck=`) passes.

## Tests

`tests/workflow-injection.test.mjs` (9 tests, run by `test:workflow-security`):

- **The zizmor test** now pins `--min-severity medium`.
- **New: credentials.** Every checkout step in every workflow sets
  `persist-credentials: false`. An `artipacked` ignore with a reason is
  allowed only on an allowlisted file (`auto-tag.yml`). Adding one anywhere
  else fails the test, and so does removing the approved one.
- **New: permissions.** Every workflow has a top-level `permissions:` block
  or a job-level block on every job, and none uses `write-all`.

The full `test:workflow-security` suite passes: 7 files, 27 tests.

## Mutation proof

Each mutation was applied, its command run, the file restored, and the
SHA-256 verified. All 9 turned red, and every restore matched.

| ID | Mutation | Command | Result |
|---|---|---|---|
| Z01 | drop `persist-credentials` from the eslint checkout | test | red (1 fail) |
| Z02 | drop typecheck's top-level permissions | test | red (1 fail) |
| Z03 | CI gate back to `--min-severity high` | test | red (1 fail) |
| Z04 | unapproved `artipacked` ignore in lint.yml | test | red (1 fail) |
| Z05 | drop one roadmap-controller job's permissions | test | red (1 fail) |
| Z06 | top-level `permissions: write-all` | test | red (1 fail) |
| Z07 | remove auto-tag's approved annotation | test | red (1 fail) |
| Z08 | same as Z01 | zizmor medium | red (exit 13) |
| Z09 | same as Z02 | zizmor medium | red (exit 13) |

Z08 and Z09 show that the CI job itself, not only the unit test, blocks the
regressions this PR fixes.

## Risk and rollback

- **`persist-credentials: false`.** A job that runs `git push` or
  `git fetch` against a private remote with the checkout token would now
  fail.
  - Every workflow was checked. Only auto-tag pushes, and it is exempt.
  - Jobs that call the GitHub API use `github-token:` or `GH_TOKEN`
    explicitly, not the git credential.
  - Five workflows run `git fetch origin …` after checkout (seven calls):
    cross-agent-review, lint, release-integrity (2), roadmap-controller (2)
    and targeted-tests.
    These now fetch anonymously, which works because the repository is
    public. **If the repository is ever made private, these fetches will
    fail.** The fix then is to pass the token for just that fetch, not to
    persist it.
- **Top-level `contents: read`.** It only narrows jobs that declared
  nothing, and none of those seven workflows writes.
- **Rollback:** revert this PR. Or, to keep the fixes but stop blocking,
  set `--min-severity high` again.

## Approval

`.github/workflows/` is a sensitive path, so the dependency-change gate
needs Bradley's `dependency-change-approved` label. Agents never apply it.
