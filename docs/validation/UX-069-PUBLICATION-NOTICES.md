# UX-069 — explicit publication notices

## Scope and behavior

[Draft #1925](https://github.com/bradleybond512/crystal-ball/pull/1925)
claims the approved November 27 bounded design. The existing agent workflow now
reports explicit publication, preserves PR body/readiness, and retains prefix
labels. It does not create PRs or enable auto-merge. Sensitive-file protection
still disables auto-merge, including when labeling fails after a valid lookup.

One REST lookup requests at most two open PRs for the exact repository, branch
and main base. Ambiguous, truncated or malformed responses fail. A different
head SHA is reported explicitly. API errors expose only the action and validated
HTTP status. Sensitive protection reads the exact node, validates identity and
observes an explicit off state or confirms the disable mutation response.
There are no automatic retries, new dependencies, permission grants or settings.

Production files: `.github/workflows/auto-merge-agent-branches.yml` and the
missing-PR hint in `scripts/pr-closeout.sh`. The latter's executable guards and
arming command are unchanged and were not executed. Four existing test files
exercise the actual YAML JavaScript and retained security boundaries. The notice
job no longer needs checkout; the sensitive-file job retains credential-free
checkout. Trigger scope excludes Dependabot, preserving #1920's separate workflow.

## Validation at source commit 08d68b723d

Commands executed using Node 22 and existing dependencies; no installation:

```text
npm run test:workflow-security
# tests 127
# pass 127
# fail 0

npm run lint:yaml
[lint:yaml] Parsed 23 tracked YAML file(s).

npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
(exit 0)

actionlint .github/workflows/auto-merge-agent-branches.yml
(exit 0; installed local actionlint 1.7.12)

bash -n scripts/pr-closeout.sh
(exit 0; syntax check only)
```

Initial actual-YAML regression run: 49 tests, 19 pass / 30 fail. The first
broader workflow suite then reported 124 pass / 1 fail because the unchanged
checkout inventory expected 34 instead of the actual 33. The inventory was
corrected and strengthened with explicit notice-no-checkout and retained
sensitive-checkout assertions; credential and publisher checks remain intact.
Four changed test files passed ESLint. Final full gate and selected-suite output:

```text
bash scripts/agentic-validate.sh --tests "test:workflow-security"
Agentic validation gate passed.
Tests run: test:workflow-security

node scripts/targeted-tests.mjs
[targeted-tests] 3 script(s) passed.
```

The gate ran lint, all type checks, secret scanning, documentation checks and
production build. Existing Vite extension/chunk-timing warnings remain warnings;
no assertion, lint or security gate was weakened.

The existing targeted selector identifies three suites: roadmap-controller,
supply-chain-gates and workflow-security. Its existing baseline does not map
`pr-closeout.sh`; this change alters only the user-facing hint. No behavioral
coverage is claimed from that baseline exemption.

## Mutation evidence

All 19 mutations began from clean committed source
`08d68b723dcd7067b41d7ed89b4a2d2a0db85879`. Every applied diff was inspected;
each selected suite turned red; restoration matched the checksum and clean
Git status. Mutated file: `.github/workflows/auto-merge-agent-branches.yml`.
SHA-256 before and after every proof:
`adeffe3f2c485eadc2da6db271f66dc1aa8715e5469d9bb0d2debec4855f5a27`.
Counts below are actual Node output, including two unmatched test modules that
Node counts as passing. Failures are behavioral assertions, not import failures.
The branch-injection proof actually set the sandbox injection marker to true.

| Removed or reintroduced behavior | Baseline pass / fail | Mutation pass / fail |
| --- | --- | --- |
| creation | 3 / 0 | 2 / 1 |
| arming | 3 / 0 | 2 / 1 |
| lookup-bound | 3 / 0 | 2 / 1 |
| lookup-identity | 11 / 0 | 2 / 9 |
| ambiguous | 3 / 0 | 2 / 1 |
| truncated | 3 / 0 | 2 / 1 |
| sha-honesty | 3 / 0 | 2 / 1 |
| lookup-failure | 5 / 0 | 2 / 3 |
| error-redaction | 5 / 0 | 2 / 3 |
| label-failure | 3 / 0 | 2 / 1 |
| node-identity | 4 / 0 | 2 / 2 |
| sensitive-disable | 3 / 0 | 2 / 1 |
| disable-confirmation | 4 / 0 | 2 / 2 |
| disable-failure | 3 / 0 | 2 / 1 |
| query-failure | 3 / 0 | 2 / 1 |
| failed-label-safety | 3 / 0 | 2 / 1 |
| branch-injection | 3 / 0 | 2 / 1 |
| secret-boundary | 3 / 0 | 2 / 1 |
| checkout-inventory | 3 / 0 | 2 / 1 |

Raw applied diffs, baseline/red logs, restored hashes and clean-status receipts
are retained in the local evidence directory under `next-nov26/ux069/mutations`.

## Review and remaining acceptance

Independent Sol (`gpt-6.1-sol`, medium) and actual Sonnet
(`claude-sonnet-5-5`, medium) reviews found zero blocking findings at source
commit `08d68b723d`. Sol independently reran all 127 workflow tests and audited
all 19 applied mutation diffs, raw red counts and restored checksum. Sonnet
reviewed the immutable full-source packet without tools and did not execute tests.
Final evidence-tip review and recorded verdict remain required before publication.

Material limits retained from review: a first push before manual PR creation
cannot protect a PR that does not yet exist; current required protection contexts
do not include the separate dependency-change gate, and this task changes no
protection setting. Existing sensitive-job prefix omissions remain unchanged.
The closeout hint does not add a draft-state guard. Live disable-mutation behavior
is not exercised while auto-merge remains held; a mocked response is not live
acceptance. No extra permissions, readiness or merge changes are used to test it.
Hosted execution of the new workflow requires separate code-publication approval
and the existing CI-policy approval label. After approval: verify exact PR head,
draft state/body preservation, accurate notice, auto-merge off and unchanged
required checks. Do not create a ready PR or arm auto-merge for verification.

Full UX-069 acceptance remains open until hosted publication behavior is observed.
Existing marketing and Rust dependency audits also remain open; their lockfiles
are unchanged. No app/native/profile behavior changed or was verified. Merging,
auto-merge, releases, deployment, installation and cleanup remain paused.

Rollback must preserve removal of automatic creation and merge enabling. A
wholesale revert restoring that race needs separate approval. Protected closeout
remains available only when separately authorized; it was never run here.

Proposed implementation commit: `Keep agent publication and merge authority explicit`.
Draft PR summary: agent pushes report the matching PR without changing readiness;
explicit publication and protected closeout retain creation/arming authority,
while sensitive-change disablement remains active.
