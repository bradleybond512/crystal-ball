# UX-063 — Retain the existing Sonnet review path

Status: Bradley approved this documentation-only design, draft claim and local completion work on 2026-11-08. Claim publication is authorized; later completion-commit publication requires separate approval. Merging, auto-merge, releases, deployment and installation remain paused.

## Brief and selection

Goal: decide whether optional CI Sonnet review adds enough demonstrated reliability to justify new execution, credential and spending boundaries. User value is a dependable review process with minimum unnecessary infrastructure.

At canonical main `3a9786c45daa9fcf643331ac004ae62e97793f7a`, `npm run roadmap:check` with a fresh complete GitHub snapshot selected UX-063 [S], with no blocking findings (82 referenced PRs, 9 open main-targeted PRs, 91 total snapshot entries). UX-062 remains claimed in draft #1886; its full baseline comparison work stays open.

Classification: High Assurance because the evaluated alternative touches review integrity and CI credentials. The recommended deliverable is documentation only.

## Recommended decision

Retain the working local Sonnet review and SHA-pinned verdict path. Complete UX-063 by recording the reviewed decision permitted by its existing acceptance criteria. Do not add an optional CI Sonnet runner now: the available evidence does not demonstrate an incremental reliability benefit sufficient to justify it.

Three actual local Sonnet 4.6 review results (ACC-510, UX-035, UX-062) report successful completion in approximately 3–5 minutes and were followed by successful hosted review gates. These are working examples, not a representative availability sample, success-rate estimate or service-level guarantee. Reported cost fields are estimates, not invoices or enforced spending caps.

Existing pipeline tests ran directly with Node 22 at the dated source:

```text
node --test tests/agentic-pipeline.test.mjs
# tests 85
# pass 85
# fail 0
```

They exercise source binding, stale-verdict rejection, reviewer/model policy, malformed verdicts, smuggled changes, missing tooling/credentials, install failures and fork/off-mode routing. Fixtures do not establish live Sonnet denial handling or CI service reliability. UX-062's two denied read-only Bash inspection calls are tool permission denials, not denied review transmissions.

## Boundaries and alternatives

The local verifier proves that the verdict pins the exact parent commit and becomes stale after source changes. It does not establish that the reviewer actually examined that source. Reviewer identity/model remain recorder attestations; medium effort is a required operating policy, not a verifier condition. Preserve these limits explicitly.

The existing optional CI Codex route is a reference, not an approved Sonnet implementation. It uses trusted-main tooling, locked dependencies, isolated installation, minimal repository permissions and same-repository routing. Its 20-minute job timeout is not a dollar/token/turn cap. Sanitizing the installation environment alone does not prove reviewer-process credential isolation.

A new CI option could reduce dependence on a local session, but its genuine execution, credential arrangement, cost bounds, fork exclusion and denial handling remain unverified. Adding it now would introduce unproven operational requirements. A later denied transmission must stop; changing the route to evade it is prohibited. Prior successful calls do not authorize future denied calls.

No changes to workflows, runner code, model policy, secrets, billing, dependencies, account settings, permissions, application behavior, storage or delivery. No new interface, schema, network integration or migration. No new paid review calls merely to populate the evaluation sample; normal required final review remains separate.

Reconsider only after a documented operational need and separately approved design establish explicit spending/turn/token and wall-clock bounds, trusted-base execution, credential isolation, fork exclusion, exact-source binding, cancellation and denied-transmission behavior. Require genuine positive execution and adversarial negative evidence before accepting a CI alternative.

## Bounded work and owners after approval

1. Root: publish one documentation-only UX-063 draft claim after fresh roadmap reconciliation and rebase. Preserve delivery holds.
2. Documentation specialist: write `docs/validation/UX-063-REVIEW-PATH-DECISION.md` with source anchors, compact evidence from the three actual results, current negative fixture results, limitations, retained-path decision and reconsideration conditions. Update only UX-063's status/evidence in `docs/USABILITY_UPLIFT_FOR_CODEX.md`. Mark DONE only once the approved decision is independently reviewed; this is not installation/release acceptance.
3. Root: validate documentation and existing controls using `test:agentic-pipeline`, `test:roadmap-controller`, `docs:check`, `typecheck:all`, secret scan and the required affected agentic gate. Existing checks are evidence; no new behavioral tests or mutation proofs are warranted because no behavior changes.
4. Independent reviewer and required Sonnet reviewer: inspect decision accuracy, actual evidence and complete diff. Record the final exact-source verdict; request separate approval before publishing completion commits.

Allowed files: this design, the decision report with a compact evidence artifact if needed, and UX-063's roadmap entries. No other tasks or executable files.

## Acceptance, risks and rollback

Accept when evidence supports the dated retained-path decision; limitations and future reconsideration criteria are explicit; the roadmap references that reviewed decision; and required checks/reviews pass. Do not claim a new CI system, enforced cost limit, cryptographic reviewer identity or denial-bypass protection beyond tested controls.

Residual risks are local-session availability, attested reviewer identity and policy-only effort selection. This decision does not resolve them through new code. No production state changes; rollback is reverting the decision/tracker documentation or superseding it with a later approved evaluation.

Approval requested: this docs-only design, documentation-only draft claim and local completion work. The required workflow says: “Stop for explicit human approval after design for High Assurance work.” Approval includes publishing the draft claim; publishing completion commits, merging, auto-merge, releases, deployment and installation remain separately held.
