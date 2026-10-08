# R4-SEC-003 + R4-SEC-009 validation — main-sync pinned check gate

Validated September 30, 2026 on branch `claude/r4-sec-003-main-sync-gate`
(base `a255546ee`). Approved design and amendment:
[plan](../plans/2026-09-30-r4-sec-003-main-sync-gate.md).

## Behavior

- **Pinned minimum.** `PINNED_REQUIRED_CHECKS` is a frozen list of 13 checks:
  - the 7 that branch protection requires;
  - Semgrep, cargo-deny, sidecar-http-guardrail, ESLint, static-lint and
    smoke.

  main-sync requires **pinned ∪ remote** (`buildRequiredChecks`).
  - An empty or shrunken protection list no longer makes the gate pass
    vacuously.
  - When that happens, main-sync logs a warning and still enforces the full
    set.
  - `npm-audit` and `cargo-audit` are intentionally not pinned.
- **Pagination.** Check runs are read with
  `gh api --paginate …/check-runs?per_page=100 --jq '.check_runs[]'` and
  parsed as one JSON object per line (`parseCheckRunLines`).
- **The newest run decides.** Duplicate names (re-runs) are resolved by the
  completed time, then the start time, then the run id. This applies to
  commit check runs, commit statuses and the merged-PR status rollup.
- **The merged-PR fallback uses the same pinned set.**
- **static-lint runs on every PR.** The path filter was removed from
  `lint.yml`. A guard test keeps every pinned check tied to a workflow that
  runs on `pull_request` without `paths` or `paths-ignore`.
- **Testable seam.** `verifyRemoteChecks(options, sha, run = runCommand)` is
  exported and takes an injectable `gh` runner, the same pattern as
  `runVerificationAndBuild`. The tests use a fake and never call GitHub.

## Replay against real history (read-only)

The pinned set was evaluated against the status rollups of the last 30
merged PRs, newest run per name. 28 were green. The 2 misses were Dependabot
Cargo-only PRs where static-lint was missing (#1709, #1717). That led to the
approved amendment above. There were no non-success results.

## Actual validation

- `test:main-sync-gate` (new, 13 tests) and `main-sync-agent` (18) pass
  31/31 on Linux (Node 22).
- `lint-workflow` passes 3/3.
- On Bradley's Mac, `main-sync-agent` has the 2 pre-existing Node-26 failures
  that are already documented in the R4-SEC-002 validation. The new suite
  does not depend on the Node version.
- Targeted-test selection for this diff: `test:data`,
  `test:eslint-runner`, `test:main-sync-gate`.
- ESLint on the changed files and the agentic gate: see the PR description.

## Mutation proof

Each mutation was applied alone against `main-sync-check-gate`,
`main-sync-agent` and `lint-workflow` (baseline 34/0 before and after,
Linux). The table records the SHA-256 prefix of the file before mutating.
Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Required set drops the pinned union | `sync-main-to-mac.mjs` (`9a7b8a0f28fa`) | 30/4 | empty list, shrunken list, union, PR fallback |
| verifyRemoteChecks bypasses the pinned set | same | 31/3 | empty list, shrunken list, PR fallback |
| Check runs read without `--paginate` | same | 33/1 | pagination |
| Check runs read at the default page size | same | 33/1 | pagination |
| Oldest run wins | same | 31/3 | newest decides (runs, statuses, rollup), stale failure |
| First-listed run wins | same | 30/4 | newest decides, id tie-break, stale failure |
| Last-listed run wins | same | 31/3 | newest decides, id tie-break |
| Id tie-break inverted | same | 33/1 | id tie-break |
| In-progress start time ignored | same | 33/1 | newest decides |
| `npm-audit` pinned | same | 32/2 | approved set, workflow guard |
| `smoke` not pinned | same | 31/3 | approved set, union, workflow guard |
| Pinned list mutable | same | 33/1 | approved set (frozen) |
| Empty-protection warning removed | same | 33/1 | empty list |
| PR fallback judged on the remote list only | same | 33/1 | PR fallback |
| Blank NDJSON lines parsed | same | 31/3 | parser, empty list, PR fallback |
| static-lint path filter restored | `lint.yml` (`254a83bb0c6d`) | 33/1 | workflow guard |
| Semgrep job renamed | `sast.yml` (`0b8896dfb90e`) | 33/1 | workflow guard |
| cargo-deny workflow gains `paths-ignore` | `security-audit.yml` (`765d8e90bd38`) | 33/1 | workflow guard |

All 18 mutations went red, and every file was restored to its original hash.

## Consequence to know

Installs now wait for smoke, ESLint, Semgrep, cargo-deny,
sidecar-http-guardrail and static-lint as well as the protection checks. A
flaky failure blocks the install until it is re-run green; after the re-run,
the newest-run rule unblocks it without a new commit. This is fail-closed by
design.

## Rollback

Revert the commit. The gate then goes back to the protection list only,
without pagination or newest-run handling, and static-lint gets its path
filter back.

## October 8 Codex repair — preliminary code freeze

The original Sol review found that a completed success could outrank a newer
queued attempt whose start and completion clocks are absent. The integrated
pre-fix regression run produced `16 pass / 10 fail`. The repair compares
corresponding completion, start, and positive identity fields separately;
missing clocks are not silently older. Conflicting attempts whose latest state
cannot be established yield `unknown`, which blocks the gate. All contenders
are retained so response permutations cannot discard an unorderable pending
attempt. A determinate newer success still clears obsolete failures.

Integration starts from canonical main `b9122ab23e2658aa6628bae8702dde6b01a1ae61`
and only the original own commit `c7d25d0f0afb2c8eb993a2188ab7789604208ea3`.
Main's `npm ci --ignore-scripts` and install-script test selection are preserved.
The pinned set, pagination, merged-PR fallback flow, and actual installer path
are unchanged. Tests use injected GitHub fixtures; no real main-sync or install
operation was run.

Actual Node 22 results before this preliminary freeze:

- Main-sync gate, agent, and workflow fixtures: `48 pass / 0 fail`.
- Install-script fixtures: `56 pass / 0 fail`.
- Data fixtures: `1268 pass / 0 fail` before the last additional permutation test.
- ESLint-runner fixtures: `10 pass / 0 fail`.
- Changed-file ESLint and lockfile validation: exit `0`.
- Fresh `npm ci --ignore-scripts --no-audit --no-fund`: exit `0`, lockfile unchanged.

This local code commit establishes the clean starting point for fresh mutation
proofs. Mutation evidence and the final full gate will be recorded in the
following evidence update. Independent Sonnet medium review and publication
remain pending; no approval verdict has been recorded.
