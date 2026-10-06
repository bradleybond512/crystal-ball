# R4-SEC-002 steps 3–5 validation — cooldown, signatures, human gate

Validated October 2, 2026 on branch `claude/r4-sec-002-supply-chain-gates`.
On October 5 it was rebased onto `main` at `d7e116a`, where #1764 (steps 1–2)
is now merged, and re-validated (see "Rebase and repair"). Approved design:
[plan](../plans/2026-10-02-r4-sec-002-supply-chain-gates.md). Bradley's
choices: 7 days, 14 for major versions; npm and Cargo; the sandboxed build
(step 6) is deferred.

## Behavior

- **Dependabot cooldown:**
  - `default-days: 7` on npm, cargo and GitHub Actions.
  - `semver-major-days: 14` on npm and cargo. It is left off GitHub Actions,
    because the docs do not confirm that ecosystem supports semver-specific
    days.
  - Security updates are not delayed.
- **Release-age gate** (`scripts/check-dependency-age.mjs`, in the required
  `integrity-checks` job):
  - It compares `package-lock.json`, `tools/mcp-server/package-lock.json` and
    `src-tauri/Cargo.lock` with the base branch's copies (`git show`).
  - Every registry version that is new in the PR is looked up:
    - npm: `time[version]`;
    - crates.io: `created_at`, with a User-Agent.
  - Lookups run 6 at a time, with a 10-second timeout.
  - A version under 7 days old, or one whose publish time cannot be read,
    fails the job, unless the PR carries `dependency-age-reviewed`.
  - Git and path sources are listed and reviewed as code.
  - Unchanged lockfiles cause no network calls.
- **Registry signatures:** `npm audit signatures` runs after `npm ci` in
  `npm-audit`.
  - On October 2, against that day's lockfile, a local run reported 946
    packages with verified signatures and 127 with verified attestations.
  - It was not re-run after the rebase. The local `node_modules` predates
    `main`'s dependency fix, so only CI's fresh `npm ci` followed by
    `npm audit signatures` validates the current lockfiles.
- **`dependency-change-gate`** (`pull_request_target`, read-only, never checks
  out PR code):
  - It lists the PR's files through the API. Renames count both names, and a
    PR too large to list counts as sensitive.
  - It fails if any of these is touched without `dependency-change-approved`:
    - lockfiles or `.npmrc`;
    - Cargo manifests;
    - CI workflows, Dependabot policy or CODEOWNERS;
    - the gate scripts.
- **Auto-merge** skips sensitive PRs and makes a best-effort attempt to turn
  auto-merge off.
- **CODEOWNERS** covers the same files.
- **CLAUDE.md** documents the labels and that agents never apply them.

## Changes to the approved design

- `package.json` is not on the sensitive list. Lockfiles decide what is
  installed; most PRs edit `package.json` only for test scripts.
- The gate check stays read-only and does not turn auto-merge off itself.

## Bradley's settings (part of the deferred GitHub settings work)

1. Make `dependency-change-gate` (and `integrity-checks`, if it is not
   already) **required** status checks on `main`. Until then they are
   visible but advisory, and the auto-merge skip is the only stop.
2. Do not turn on "Require review from Code Owners" for these paths. Agent
   PRs are authored by your account, and GitHub does not allow approving your
   own PR, so it would block them. The label gate is the workable
   equivalent.

## Rebase and repair (October 5)

- **Rebase range:** only this PR's commit was replayed:
  `git -c rerere.enabled=false rebase --onto d7e116a 60dceaff`, where
  `60dceaff` was the old #1764 tip.
  - Two conflicts, both resolved without dropping anything:
    - `package.json`: `main`'s `test:install-scripts` (which now includes the
      `desktop:build:full` tests) plus this PR's `test:supply-chain-gates`.
    - `scripts/targeted-tests-overrides.json`: the union of `main`'s
      mappings and this PR's two `test:supply-chain-gates` mappings.
  - The lockfiles, `.npmrc` files, the desktop build orchestrator and the
    reviewer-policy files are identical to `main`.
- **Repair found by validation:** zizmor reported a new template-injection
  finding in this PR's "Turn auto-merge off for a sensitive PR" step, which
  pasted `${{ github.ref_name }}` into script code.
  - The branch now reaches the script through `env` (`BRANCH`), the same
    fix #1781 applies to the rest of that workflow.
  - A gate test asserts that no expression appears inside that script
    (mutation N23).

## Actual validation

All suites ran on Bradley's Mac with Node 22.23.1 against the existing
`node_modules`. That copy predates `main`'s dependency fix and was not
reinstalled, so a fresh locked install is left to CI.

| Suite | Result |
|---|---|
| `test:supply-chain-gates` | 16/16 |
| `test:install-scripts` | 56/56 |
| `test:agentic-pipeline` | 65/65 |

- The agentic gate passed with all three suites.
- The secret scan passed on the changed files.
- actionlint is clean.
- zizmor, compared with `main`:
  - The only new finding is the intended `dangerous-triggers` on
    `dependency-change-gate.yml`. That workflow is the read-only
    `pull_request_target` gate; its read-only, no-PR-checkout design is
    pinned by mutations M16 and M17, and #1781 adds the reasoned inline
    ignore.
  - The template-injection count in the auto-merge workflow is back to
    `main`'s.
- **Live registry shape**, checked October 5 without credentials. The run
  made three requests, all returning HTTP 200, with
  `User-Agent: crystal-ball-ci (...)` and no `Authorization` header:

  | Request | Field read | Result |
  |---|---|---|
  | `https://registry.npmjs.org/dompurify` | `time["3.4.16"]` | 12.3 days old (`time` object, 157 entries) |
  | `https://registry.npmjs.org/esbuild` | `time["0.28.1"]` | 116 days old (484 entries) |
  | `https://crates.io/api/v1/crates/serde/1.0.229` | `version.created_at` | `2026-07-18T23:05:13Z`, 79 days old |
  | `esbuild@999.0.0` (unpublished) | — | `no publish time`, which blocks |

  The unpublished `esbuild` lookup reused the cached document instead of
  fetching it again.

## Mutation proof

**Original evidence:** the October 2 run kept only one summary line per
mutation, with no applied diffs, raw output or post-restore hashes. That
log and its runner are preserved under `original-q14-evidence/` but are not
audit-grade.

**Regenerated proof:**

- **Where it ran:** an isolated QA worktree (`.worktrees/claude-pr1772-qa`)
  detached at `f8108eb`, the rebased commit plus the env repair. It used
  the original 22 edits plus N23.
- **Each mutation:**
  1. Checks that `git status` is clean.
  2. Applies one edit and records a non-empty `git diff`.
  3. Runs `node --test --test-reporter=tap` on both suite files and keeps
     the raw output.
  4. Restores the file, then checks its SHA-256 and that `git status` is
     clean again.
- **Baseline:** 16/16 before and after.
- **Evidence location:** `~/Documents/Codex/2026-10-04/task/pr1772/mutation-evidence/`:
  - `<id>.diff`;
  - `<id>.test.log`;
  - `<id>.restore.log`;
  - `manifest.json`.
- **Superseded run:** a first run at `48fe89c`, before the repair, also
  went red on all 22 and is kept in `mutation-evidence-superseded-48fe89c/`.
  It is superseded because the auto-merge workflow changed afterwards.

**Result: all 23 turned red.**

| # | Mutation | File (sha before) | Pass/fail |
|---|---|---|---|
| M01 | threshold off by a day | `check-dependency-age.mjs` (`7d530fb5aaf5`) | 15/1 |
| M02 | unknown publish time passes | same | 14/2 |
| M03 | override always on | same | 15/1 |
| M04 | Cargo.lock not checked | same | 15/1 |
| M05 | MCP lockfile not checked | same | 15/1 |
| M06 | git sources treated as registry | same | 15/1 |
| M07 | base lockfile ignored | same | 15/1 |
| M08 | npm document refetched per version | same | 15/1 |
| M09 | bad base ref not fatal | same | 15/1 |
| M10 | lockfiles not sensitive | `dependency-change-policy.mjs` (`060f80fd5fe8`) | 13/3 |
| M11 | workflows not sensitive | same | 14/2 |
| M12 | rename source ignored | same | 15/1 |
| M13 | only the first page read | same | 14/2 |
| M14 | oversized PR not sensitive | same | 15/1 |
| M15 | any label approves | same | 15/1 |
| M16 | gate checks out PR head | `dependency-change-gate.yml` (`55ce597a5e0a`) | 15/1 |
| M17 | gate token can write | same | 15/1 |
| M18 | auto-merge not skipped | `auto-merge-agent-branches.yml` (`f5fce97e1603`) | 15/1 |
| M19 | no signature check | `security-audit.yml` (`3ece0b530b43`) | 15/1 |
| M20 | no age check in CI | `release-integrity.yml` (`b305a61b17e6`) | 15/1 |
| M21 | Cargo cooldown 3 days | `dependabot.yml` (`aeb4fdabff9f`) | 15/1 |
| M22 | policy script not code-owned | `CODEOWNERS` (`5b2aa056f273`) | 15/1 |
| N23 | branch pasted into the skip script | `auto-merge-agent-branches.yml` (`f5fce97e1603`) | 15/1 |

## Rollback

Revert the commit. Dependabot returns to its 3-day default, and the age gate,
the signature check and the dependency-change gate stop running.
