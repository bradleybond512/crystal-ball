# R4-SEC-003 + R4-SEC-009: main-sync installs only when a pinned check set is green

Status: approved by Bradley on September 30, 2026 ("Approve as designed"). Branch `claude/r4-sec-003-main-sync-gate` from `a255546ee`.
Classification: High Assurance (install logic). Queue item Q7.

## Problem (verified at a255546ee)

In `scripts/sync-main-to-mac.mjs`, main-sync installs a `main` commit on
your Mac once "required checks" are green:

- **The gate can pass vacuously.** The required list comes only from the
  branch-protection API (`verifyRemoteChecks`, `:357-398`).
  `evaluateRequiredChecks` (`:290-310`) returns green for an **empty** list.
  If protection is ever edited, renamed or recreated, every commit installs
  with no checks at all.
- **Security checks never gate the install.** Semgrep, cargo-deny,
  sidecar-http-guardrail, ESLint, static-lint and smoke are not in branch
  protection (R4-SEC-009), so a commit that fails any of them still installs.
- **Check-runs are not paginated.** `commits/<sha>/check-runs` returns 30 per
  page, and this repo produces 25+ per commit. A required run on page 2
  reads as "missing".
- **The same check name can appear more than once** after a re-run.
  `collectCheckStates` / `collectStatusCheckRollupStates` keep whichever
  came **last in the response**, not the newest run. A flaky failure that
  was re-run green (for example #1762's smoke today) can still read as
  failed, and a newer failure can be masked by an older success.

## Design

1. **A pinned local minimum** (`PINNED_REQUIRED_CHECKS`):
   - the 7 branch-protection checks: `typecheck`, `secret-scan`,
     `actionlint`, `integrity-checks`, `release-doctor`,
     `cross-agent-review`, `targeted-tests`;
   - the R4-SEC-009 security set: `Semgrep static analysis`, `cargo-deny`,
     `sidecar-http-guardrail`, `ESLint`, `static-lint`, `smoke`.

   The gate requires **pinned ∪ remote**:
   - An empty or shrunken remote list can no longer weaken it, and it logs a
     warning when the remote list is empty or lacks pinned entries.
   - It deliberately does **not** refuse in that case. Refusing would stop
     every install until you update the GitHub settings you deferred, while
     the union already enforces the full set.
   - `npm-audit` and `cargo-audit` stay non-blocking: a new advisory
     unrelated to a commit must not freeze installs. They keep alerting on
     PRs.
2. **Pagination.** Check-runs are read with
   `gh api --paginate …/check-runs?per_page=100 --jq '.check_runs[]'`
   (one JSON object per line, across all pages). Statuses are read with
   `per_page=100`.
3. **The newest run wins** per name. The order is `completed_at` /
   `completedAt`, then `started_at` / `startedAt`, then id. This applies to
   commit check-runs, statuses and the merged-PR status rollup.
4. The existing flow is unchanged: the commit's own checks first, then the
   merged PR's rollup, which carries the PR-only workflows.

Consequence to know: installs now also wait for smoke, ESLint, Semgrep and so
on. A flaky smoke failure blocks the install until it is re-run green, which
is fail-closed. That is the same behavior as the current required checks.

## Amendment found during implementation (approved September 30, 2026)

Before shipping, the pinned set was replayed against the last 30 merged PRs.
28 would pass. The other 2 were Dependabot Cargo-only bumps (#1709, #1717)
where `static-lint` is **missing**: `lint.yml` had a `pull_request.paths`
filter, so it never ran on them. As designed, main-sync would refuse to
install after such a merge until the next PR landed.

Bradley chose "Run static-lint on every PR":

- The path filter is removed from `lint.yml` (median runtime about 35s). The
  gate stays exactly as designed. `lint:conflicts` now also covers
  `.rs`/`.mjs`-only PRs.
- A guard test fails if any pinned check's workflow is renamed away, stops
  running on `pull_request`, or gains `paths`/`paths-ignore`.

## Tests (fake-only; mutation proof per behavior)

- An empty remote list still requires the pinned set.
- A remote list missing a pinned check still requires it.
- A 2-page fixture finds a check that is only on page 2.
- Duplicate names: the newest wins in both directions (re-run green over an
  old failure, and a new failure over an old success), for check-runs and the
  rollup.
- `npm-audit` / `cargo-audit` are not pinned.
- A source gate confirms `--paginate` and `per_page=100`.
- Existing `main-sync-agent` tests are updated.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.
