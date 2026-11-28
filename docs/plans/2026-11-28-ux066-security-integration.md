# UX-066 — safe first-merge integration

The November 28 user instruction to merge safe work and install the new Mac build
authorizes protected delivery of reviewed changes. Public release, deployment
and destructive cleanup remain held. Preserve #1920's branch and workflow.

The architect identified a dependency cycle: the reviewed marketing fix in #1904,
the approved cookie fix and URL 2.5.9 from #1920 must coexist before the first
audit-clean merge. Historical green checks and optional audit gates cannot
establish that today's combined build is safe. This continuation integrates those
existing fixes in the current UX-066 claim, not a new roadmap claim or library.

## Scope and provenance

The cookie-only phase at `fbe474ebb3789873dbec8b482ee7407e49b3b2de` is preserved,
including its detecting/restored audit proof. Extend the candidate only with:

- Exact `marketing-site/package.json` and `package-lock.json` from reviewed #1904
  at `8c0b6f9847bee31153e64b3d7e6d3533d444748d`: React, ReactDOM and RSC 19.2.9.
- Targeted Cargo resolution to URL 2.5.9, as in #1920 at
  `a4081788ca1832a9c6ea7bdc94fe516b28859bc5`; assess its required
  form_urlencoded 1.2.3 companion. Do not replay that PR's whole lock, rustix or
  root npm changes. Unexpected resolution drift requires reassessment.
- Evidence and tracker updates. Preserve the exact reviewed Zizmor pin and main's
  current SPC clock fix. No native application source, permission, migration,
  audit threshold, ignore list or release policy changes.

The security specialist owns dependency files and archive/integrity/script/license
assessment before isolated package execution. The test engineer owns isolated
candidate tests and proofs; parent owns integration evidence and delivery. No
concurrent edits during clean-tree mutations. This integration plan supersedes
the earlier cookie-only non-goals only for the explicitly listed dependency files.

## Acceptance

Require coherent marketing peers and actual Worker tests/build/lint/type checks;
exercise URL's changed nested-blob-origin behavior against baseline and candidate;
retain the cookie proof. Require six-lock npm audit and pinned Cargo audit to
report no blocking findings, plus sources/bans, selected tests, type checks, the
named full gate and fresh independent Sol/Sonnet reviews. No weakened checks.
`audit:locks` reads committed Git blobs, so qualify the committed combined tree.
Native no-run compilation must use an isolated source copy with required generated
assets supplied; never bypass the resource list or launch the application as a test.

The prior native compile stopped on a missing generated XMPP bundle; it was not a
successful compile. Generate required assets through the existing reviewed build
chain and retry only in the isolated copy. Tests may execute reviewed dependencies
and fixtures, not real user profiles or Keychain operations.

## Publication and protected merging

Preserve a recovery reference to #1902's observed old head, record the exact new
review verdict and publish to its existing branch using an explicit lease. Use an
independent clean clone with the matching branch name for `scripts/pr-closeout.sh`;
leave the old checked-out worktree untouched. Check current CI including both
audits, mark ready and let protected auto-merge land it. No REST/direct merge.
Apply required dependency labels only after their documented technical assessment;
preserve the seven-day age rule or its existing justified-review mechanism.

Reconcile subsequent safe PRs serially against new main, retaining delivered fixes
and refreshing affected tests/reviews. Do not bulk-merge overlapping, proposed or
unreviewed work. No mutation of #1920 is needed for this integration.

## Local build and rollback

Final installation requires exact-main normal checks and npm/cargo audits; current
main-sync's pinned list omits those audits. Build in a clean Crystal Ball checkout
with Node 22, stable identity required and app-only packaging. Verify identity,
signature and bundle hash before using that checkout's install-built-app helper
to relaunch the canonical Crystal Ball.app. Preserve dirty Developer checkouts;
the separate World Monitor installer targets another product. No public release
or deployment. Signing/CI/hash failures block installation without fallback.

Rollback to any vulnerable dependency must keep its failing audit and block
delivery. No storage migration occurs. Preserve evidence of remaining unsafe PRs;
authorization to merge when safe is not proof that every open PR is safe.
