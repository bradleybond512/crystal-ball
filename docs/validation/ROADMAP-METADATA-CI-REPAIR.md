# Roadmap metadata CI repair — ACC-505 / ACC-508

Risk tier: Medium; standard CI correctness repair. Local scope authorized on 2026-11-06. Installation, auto-merge and delivery remain paused. Code publication and hosted Actions-token verification remain pending.

## Scope and behavior

The roadmap snapshot previously called REST single-PR metadata endpoints, which fail on historical PR #1533 with HTTP 422, “too many files changed.” Both inline snapshot builders now request only eight metadata fields through GraphQL, so the historical diff need not be processed. The validate job refreshes the event PR and historical references; the watchdog refreshes historical references.

Changed files: `.github/workflows/roadmap-controller.yml`, `tests/roadmap-controller.test.mjs`, and an additive entry in `scripts/targeted-tests-overrides.json`. The existing workflow-security mapping is retained. There are no dependencies or application changes. Roadmap policy, permissions, token handling, trusted-main reconciliation, schedules, issue publication, open pagination, merge-group comparison, candidacy and bounds remain unchanged.

Both identical readers validate the requested identity, state allowlist, field types/limits, exact UTC dates and merge-state consistency. Transport failures, partial errors, absent nodes and malformed metadata abort before snapshot writing. Query variables carry repository context and validated PR numbers; PR text remains data. Request count remains bounded; existing ten-minute workflow timeout remains. No fallback drops required evidence.

## Checks passed

Actual commands and results:

```text
npm run test:roadmap-controller
# pass 126
# fail 0

npm run test:workflow-security
# pass 61
# fail 0

npm run typecheck:all
(exit 0; no diagnostics)

bash scripts/agentic-validate.sh --tests 'test:roadmap-controller test:workflow-security'
Agentic validation gate passed.
Tests run: test:roadmap-controller test:workflow-security

/Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/acc508/ci-repair/tools/actionlint .github/workflows/roadmap-controller.yml
(exit 0; no diagnostics)
```

The repository gate passed on repair `e4be64f313c4046a40b9c0d52aa79f3b8d0762e2` with 122 roadmap tests and 61 workflow-security tests, including both TypeScript configurations, strict lint, secrets, lockfile, documentation and build checks. The final test-only supplement `7ca71372185a8accb3de093a50093f5b576d402b` adds four direct malformed-event-number tests; its commit hook reran type checks and changed-file ESLint. Final focused runs passed 126/0 on both integrated branches. Workflow bytes did not change after the gate.

The trusted canonical-main selector ran on clean integrated product trees before the four-test supplement:

```text
node /Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/acc508/ci-repair/trusted-ci.mjs --ci
ACC-505 ed945ac82: [targeted-tests] 51 script(s) passed.
ACC-508 024618f3f: [targeted-tests] 38 script(s) passed.
```

The subsequent supplement changes only the test harness and direct invalid-number assertions; affected roadmap tests were rerun on each final product. Original ACC-505/508 inference and benchmark source bytes are unchanged by this repair.

## Live response evidence

The exact query extracted from the implemented workflow was sent to `https://api.github.com/graphql` using variables owner `bradleybond512`, repository `crystal-ball`, number `1533`. It returned one PR row. Consumed fields: `number`, `state`, `baseRefName`, `isDraft`, `title`, `body`, `updatedAt`, `mergedAt`.

Observed shape: number 1533; state MERGED; base main; isDraft false; title length 43; body length 1700; updatedAt `2026-07-28T04:05:20Z`; mergedAt `2026-07-28T04:05:19Z`. [Probe evidence](ROADMAP-CI-LIVE-PROBE.json) excludes raw PR body and credentials. This verifies the live body and query shape, not the hosted GITHUB_TOKEN path.

## Mutation proof

[Proof certificate](ROADMAP-CI-MUTATIONS.json) pins repair `7ca71372185a8accb3de093a50093f5b576d402b`, three file hashes, confirmed-applied diffs, raw failing assertions, numeric output, and restored checksums. All mutations touched only `.github/workflows/roadmap-controller.yml` in a clean detached checkout. Eleven reversals were caught, producing 242 failing subtests. Baseline and final restoration were 126 pass / 0 fail, with an empty git status.

| Mutation | Baseline → red (pass/fail) |
|---|---|
| event-rest | 126/0 → 116/10 |
| validate-reference-rest | 126/0 → 84/42 |
| validate-reference-omission | 126/0 → 84/42 |
| watchdog-reference-rest | 126/0 → 86/40 |
| watchdog-reference-omission | 126/0 → 86/40 |
| field-validation | 126/0 → 70/56 |
| partial-errors | 126/0 → 124/2 |
| calendar-integrity | 126/0 → 124/2 |
| merged-state | 126/0 → 125/1 |
| merged-timestamp | 126/0 → 123/3 |
| requested-number | 126/0 → 122/4 |

The initial requested-number reversal survived before the four direct tests existed; that gap is retained in the certificate and resolved by the final 122/4 result, not counted as a successful proof before repair. Integrated workflow and test bytes equal the pinned repair. Their mapping files additionally retain each feature's previously reviewed suite mappings.

## Review and remaining checks

Independent Sol review found zero blocking findings, independently ran 126 roadmap and 61 security tests, and verified the 11 mutation diffs/hashes and clean restoration. Final integrated-head reviews and the required Sonnet conclusions are recorded separately as SHA-pinned verdicts before publication.

Checks not run: hosted CI on repaired tips, including the Actions-token GraphQL call and scheduled watchdog invocation. They require approved publication. Local VM tests execute both actual inline scripts; no scheduled issue was published. No installed-app verification is needed for this workflow-only change, and installation remains paused. No risk was waived. Release stance: locally validated; hosted verification pending.

## Manual verification and rollback

After approved publication, inspect Roadmap controller's snapshot step and reconciliation result on both drafts. Confirm PR #1533 remains in the complete snapshot and the PR event uses current metadata. Scheduled watchdog execution must retain its existing main/schedule restriction and issue permission.

Revert workflow, tests and additive mapping together to restore the old transport; historical oversized PRs will again block the roadmap check. No stored data or application rollback is required. Do not bypass completeness or hardcode PR metadata.

## Commit and draft PR amendment

Commits: `Keep roadmap checks independent of historical diff size`; `Prove malformed event numbers stop before metadata access`.

Draft PR amendment: Repair the roadmap CI metadata lookup that failed on a large historical PR. Use validated metadata-only GraphQL reads in both snapshot jobs, retaining roadmap policy, permissions and all evidence. Add behavioral failure-path coverage and an additive test mapping; local targeted suites, repository gate, live query and mutation evidence pass. Hosted CI remains pending. Installation, auto-merge and delivery stay paused.
