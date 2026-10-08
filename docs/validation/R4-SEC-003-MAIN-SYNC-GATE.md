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

## September 30 validation (original source)

- `test:main-sync-gate` (new, 13 tests) and `main-sync-agent` (18) pass
  31/31 on Linux (Node 22).
- `lint-workflow` passes 3/3.
- On Bradley's Mac, `main-sync-agent` has the 2 pre-existing Node-26 failures
  that are already documented in the R4-SEC-002 validation. The new suite
  does not depend on the Node version.
- Targeted-test selection for this diff: `test:data`,
  `test:eslint-runner`, `test:main-sync-gate`.
- ESLint on the changed files and the agentic gate: see the PR description.

## September 30 mutation history (original source)

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

## October 8 Codex repair — fresh local evidence

The existing Sol P1 finding was reproduced before the repair with the integrated
new regression suite: `16 pass / 10 fail`. An older completed success incorrectly
hid a newer queued attempt with missing start/completion clocks, including both
response orders and injected commit/merged-PR verification paths.

The repair compares corresponding valid completion clocks, then start clocks,
then positive identities. A missing clock is not silently older. Check-run
identity is compared within its own entry kind. An incomplete run starting
strictly after another run completed is demonstrably newer; overlapping clocks
without enough identity remain ambiguous. Conflicting contenders without a
provably newest state yield `unknown`, which blocks the gate. Keeping all
contenders prevents a pairwise response-order fold from dropping an unorderable
pending attempt. Determinate later successes still clear obsolete failures.

Integration uses canonical main `b9122ab23e2658aa6628bae8702dde6b01a1ae61` and the
original own PR commit `c7d25d0f0afb2c8eb993a2188ab7789604208ea3`. Main's
`npm ci --ignore-scripts` and existing install-script test selection are preserved.
Pinned checks, pagination, merged-PR fallback flow, and actual installer path
remain as designed. Fixtures simulate GitHub responses. No real main-sync,
install, launch-agent setup, release, or version change was performed.

Actual Node 22 commands and results:

| Command | Actual result |
|---|---|
| `node --test tests/main-sync-check-gate.test.mjs tests/main-sync-agent.test.mjs tests/lint-workflow.test.mjs` | `48 pass / 0 fail` before and after all mutations |
| `npm run test:install-scripts` | `56 pass / 0 fail` |
| `npm run test:data` (initial selected run, before last permutation fixture) | `1268 pass / 0 fail` |
| `npm run test:eslint-runner` | `10 pass / 0 fail` |
| Changed-file ESLint and `npm run lockfile:check` | Both exit `0` |
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit `0`, lockfile unchanged |

The final frozen review payload includes the exact-head repository gate's
actual log and result. Independent Sonnet medium review and publication remain
pending; no approval verdict has been recorded.

### Fresh mutation proof

All 23 mutations were applied separately from clean implementation commit
`34830ae9992ff9f4b60add90fe1d5b9192c644fb`. Each actual Git diff was checked,
48-test fixtures went red with named assertion failures, the exact source bytes
were restored, and Git status returned clean. The restored suite was
`48 pass / 0 fail`. [Proof manifest](R4-SEC-003-QUEUED-ATTEMPTS-MUTATIONS.json)
records commands, full before/mutated/restored checksums, actual counts and failing
tests, and raw log/diff digests. Raw logs/diffs are retained privately for review.
All 23 saved patches were applied to scratch copies of the frozen source and
matched the executed mutant checksums. Two saved patches lost a final blank
context line during serialization; the manifest records the correction and
original digest. Their actual mutation runs and logs were unchanged.
The original 18 behaviors and the new missing-clock/ambiguity behaviors are
covered by these fresh proofs; shared mutation targets are executed once.

| Mutation | Actual pass/fail | Restored file checksum prefix |
|---|---|---|
| restore-coalesced-ordering | 37/11 | 7b558ce71a9edaf1 |
| missing-completion-ranked-oldest | 39/9 | 7b558ce71a9edaf1 |
| ignore-start-comparison | 45/3 | 7b558ce71a9edaf1 |
| streaming-fold-discards-contenders | 45/3 | 7b558ce71a9edaf1 |
| ambiguity-accepted-as-success | 41/7 | 7b558ce71a9edaf1 |
| remove-nonoverlap-proof | 47/1 | 7b558ce71a9edaf1 |
| required-union-removed | 44/4 | 7b558ce71a9edaf1 |
| verification-bypasses-pinned-set | 45/3 | 7b558ce71a9edaf1 |
| pagination-removed | 47/1 | 7b558ce71a9edaf1 |
| default-check-page-size | 47/1 | 7b558ce71a9edaf1 |
| oldest-dominant-run | 36/12 | 7b558ce71a9edaf1 |
| first-response-entry-wins | 30/18 | 7b558ce71a9edaf1 |
| last-response-entry-wins | 32/16 | 7b558ce71a9edaf1 |
| identity-order-inverted | 43/5 | 7b558ce71a9edaf1 |
| advisory-audit-pinned | 46/2 | 7b558ce71a9edaf1 |
| smoke-unpinned | 43/5 | 7b558ce71a9edaf1 |
| pinned-set-mutable | 47/1 | 7b558ce71a9edaf1 |
| empty-protection-warning-removed | 47/1 | 7b558ce71a9edaf1 |
| pr-fallback-bypasses-pinned-set | 47/1 | 7b558ce71a9edaf1 |
| blank-ndjson-parsed | 44/4 | 7b558ce71a9edaf1 |
| static-lint-path-filter-restored | 47/1 | 254a83bb0c6d5bbf |
| semgrep-context-renamed | 47/1 | 0b8896dfb90e7ac6 |
| cargo-deny-path-ignore-added | 47/1 | 3ece0b530b43f36a |

Rollback: revert the bounded repair to the original PR ordering behavior, which
restores the reproduced P1. A full PR revert also removes the pinned-check and
pagination protections documented in the original September 30 section.
