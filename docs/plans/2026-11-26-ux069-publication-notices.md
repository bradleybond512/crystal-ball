# UX-069 — explicit publication notices and protected closeout

Approved High Assurance CI-policy design (November 27, 2026); documentation
draft publication and local implementation are authorized. See [brief](2026-11-26-ux069-auto-pr-brief.md). Discovery and architecture
were delegated read-only. No production workflow or repository setting changed.

## Evidence and decision

The existing `.github/workflows/auto-merge-agent-branches.yml` creates a missing
PR with `draft: false`, recommends enabling broader Actions permissions after a
broad 403 catch, and can arm auto-merge without protected `pr-closeout.sh` checks.
Its existing-PR path preserves the body. Source-only messaging fixes would leave
the ready/arming race intact.

Actual initial UX-068 publication run 45939457807, job 140310164279, emitted the
disabled-creation warning at `2026-11-27T04:21:32.7558745Z`, recommending the
"Allow GitHub Actions to create and approve pull requests" setting. The explicit
draft #1924 was created five seconds later. Existing-draft run 45941107703,
job 140315371300, instead reported that PR #1923 already existed and left its
body untouched. Receipts are retained privately under `next-nov26/ux069`.

Current main protection was read, not changed: strict status checks are
`typecheck`, `secret-scan`, `actionlint`, `integrity-checks`, `release-doctor`,
`cross-agent-review` and `targeted-tests`. Neither existing publication workflow
job is required. Dependabot branches are outside these triggers; #1920 remains
in its existing workflow.

Choose publication notices in the existing workflow, remove automatic creation
and auto-merge arming, retain existing prefix labels and sensitive-change
auto-merge disablement. This retains narrow existing writes; it is not a wholly
read-only workflow. No permission, secret, repository setting or dependency is
added or broadened. Manual draft publication and separately approved protected
closeout remain the creation/arming paths.

## Bounded execution

1. Keep the existing file and trigger scope; rename displayed workflow/job names
   to describe their actual notice/label/safety behavior.
2. Make one bounded open-PR lookup for the exact repository and pushed branch,
   targeting `main`, requesting at most two results. Reject malformed, mismatched
   or ambiguous results; never infer a unique match from a truncated response.
3. Existing draft or ready PR: report the observed PR, preserve its body and
   readiness, and keep current prefix-label behavior. Verify head SHA before
   claiming the PR contains this push; otherwise report mismatch explicitly.
4. No match: an informational notice says no matching PR was found at this check
   and directs explicit draft publication after approval. Never create a PR,
   change readiness, recommend enabling Actions settings or retry automatically.
5. Lookup failures fail with a sanitized status/category. Do not expose raw API
   errors or label every 403 as disabled creation. Label failures identify the
   failed labeling action rather than guessing that labels do not exist.
6. Remove `enablePullRequestAutoMerge` and credential-enablement advice. Retain
   sensitive-change detection and `disablePullRequestAutoMerge`; a failed
   disablement must never be reported as confirmed off. Do not add an automatic
   closeout replacement or weaken the existing approval-label policy.
7. Correct only the stale missing-PR hint in `scripts/pr-closeout.sh`. Preserve
   clean-tree, pushed-tip, verdict and main-target checks. Do not execute that
   script while the current holds apply.

Branch data stays in environment values/API arguments, never executable source.
No app, provider, prediction, storage, native or installed-profile behavior changes.

## Owners and dependencies

| Owner | Files / responsibility | Dependency |
| --- | --- | --- |
| Security specialist | Existing workflow and narrow closeout hint | Approved design and documentation draft claim |
| Test specialist | `tests/agent-merge-workflow.test.mjs`, affected dependency-gate assertions; existing YAML-execution pattern | Agreed workflow behavior; red fixtures before fixes |
| Parent | Design, tracker, validation evidence; additive mappings only if required | Actual checks/reviews |
| Independent reviewers | Full final diff and raw evidence | Validation and mutation proofs |

No new workflow, helper framework, public schema, dependency or broad permissions.
Preserve PR-number output for labeling where practical. No migration applies.

## Behavioral proof

Execute the actual YAML JavaScript with mocked GitHub/core APIs. Cover no PR,
existing draft/ready PR, wrong base/repository, ambiguous results, SHA mismatch,
lookup failures including unrelated 403s, labeling failures, hostile branch data
and sensitive-change disablement failures. Assert no creation, readiness update,
merge or auto-merge-enable calls in any publication path. Preserve Dependabot
trigger exclusion and required protection contexts.

Replace the obsolete assertion requiring automatic arming with stronger behavior
checks; retain the suite and dependency protection. Mutation proofs restore
creation/arming, widen lookup identity, swallow failures, remove sensitive
disablement or interpolate branch data into executable source. Record actual
baseline/red counts, applied diffs, restored checksums and clean status.

Run `npm run test:workflow-security`, relevant selected suites, YAML lint,
`npm run typecheck:all`, and
`bash scripts/agentic-validate.sh --tests "test:workflow-security"`.
These are planned commands, not results. No implementation tests are claimed yet.

## Acceptance, rollback and approval

After code-publication approval, observe an authorized draft push using the new
workflow: accurate notice, body/readiness preserved, auto-merge off, required
checks unchanged. Hosted evidence verifies notice behavior without merging,
releasing or installing anything. Full UX-069 acceptance stays open until then.

Rollback must retain the removal of automatic creation/arming. Restoring the
old race through a wholesale revert requires separate approval. Existing
protected closeout remains available only when explicitly authorized.

Approved November 27, 2026: this bounded design, documentation-only draft claim
and local implementation. Final code publication and the existing
`dependency-change-approved` label remain separate explicit decisions. Merging,
auto-merge, releases, deployment, installation and cleanup remain paused.
