# Zizmor medium severity CI ratchet

This is the bounded CI-only remainder of #1785, based on accepted `main`
`777c4d52a6ffa84637adddeb9fd4af0175026e8b` after the human-approved protected
merge of #1795. The actual zizmor CI command now uses `--min-severity medium`,
so medium and higher findings fail the audit with the existing ignore policy.
The existing regression guard requires that exact threshold and retains its
version, hash, offline execution and workflow-directory checks.

## Scope and delivered foundation

The source change is limited to:

- `.github/workflows/actionlint.yml`: raise the enforced threshold from high to
  medium and update the explanatory comment.
- `tests/workflow-injection.test.mjs`: require medium in the existing severity
  guard and update its test name.
- This validation note: record the bounded scope and actual evidence.

PR #1795 already delivered the workflow hardening described in
[Q20 workflow hardening](Q20-B-CI-LOWS.md), including the removal of the earlier
43 medium, two low and eleven informational findings. That delivered work gets
the credit for the backlog fixes. This follow-up adds threshold enforcement on
that accepted foundation.

Every checkout still disables credential persistence, workflow defaults retain
least permissions, and secret-bearing desktop jobs restore no npm or Rust
caches. Auto-tag retains its command-scoped, repository-specific tag push
authentication helper and existing ownership and approval controls. Tool pins,
existing suppressions, credentials, protections, approval labels, provider
configuration and MCP artifacts are unchanged.

The existing `dangerous-triggers` suppression for the dependency policy remains
narrow: trusted-base-only execution, a read-only token and no PR-code execution.
The audit is therefore not an ignore-free clean claim.

## Recorded baseline audits

The October 13 evidence for the delivered workflow separation covers all 23
hash-bound workflows with actionlint 1.7.8 and zizmor 1.30.1:

| Recorded baseline audit | Exit | Findings |
| --- | --- | --- |
| actionlint, optional ShellCheck and Pyflakes excluded | 0 | none |
| offline zizmor high, existing ignore honored | 0 | none |
| offline zizmor all severities, existing ignore honored | 0 | none |
| offline zizmor with ignores disabled | 14 | one inherited high trigger report |

The private receipt is
`approved-batch/pr1781/oct13-authorized-workflow-separation/final-auditor-results.json`.
These are inherited baseline results, not fresh audits of this candidate.

## Tests first and targeted validation

Before changing the workflow, the existing guard was updated to require medium.
The workflow still used high when this command ran:

```sh
/opt/homebrew/opt/node@22/bin/node --test tests/workflow-injection.test.mjs
```

Actual output, exit 1:

```text
not ok 4 - zizmor runs in CI, pinned by version and hash, failing on medium and higher findings
# tests 6
# pass 5
# fail 1
```

Only that named severity guard failed, because the CI command did not match
`--min-severity medium`. The receipt confirms the workflow hash was unchanged
during the tests-first run.

After changing the actual CI flag, `npm run test:workflow-security` ran with
Node 22.23.1 from `/opt/homebrew/opt/node@22/bin` on `PATH` and the task-specific
canonical `TMPDIR` `/private/tmp/cb-pr1785-ci-ratchet-tests-rfgrw0ce`. It reused
the existing dependencies. Actual output, exit 0:

```text
ok 53 - zizmor runs in CI, pinned by version and hash, failing on medium and higher findings
# tests 59
# pass 59
# fail 0
# skipped 0
```

Raw output and hash-bound receipts are retained privately in
`approved-batch/pr1785/oct14-ci-only-ratchet/` as `tests-first.log`,
`tests-first.json`, `workflow-security.log` and `workflow-security.json`.

## Fresh candidate audits and mutations

The installed actionlint 1.7.8 and zizmor 1.30.1 tools were reused without an
install, and their executable hashes were verified. Actual actionlint over all
23 workflows exited 0 with no findings; optional ShellCheck and Pyflakes were
excluded. The actual CI command was parsed from the workflow and executed with
the verified zizmor binary:

```sh
zizmor --offline --min-severity medium --format github .github/workflows
```

It exited 0 with no findings under the existing ignore policy.

Two mutations were applied to the actual candidate workflow, executed and
restored:

| Mutation | Actual result |
| --- | --- |
| Change the CI flag from medium back to high | Existing guard exits 1: five pass, one named severity failure |
| Remove the workflow-level `contents: read` permissions block | Actual medium CI audit exits 13 with `excessive-permissions`; the same mutated workflow audited at high exits 0 |

The second mutation demonstrates the threshold's effect in the real audit,
beyond matching a string in the regression guard. After restoration, all 23
workflow hashes and the raw Git index matched their originals. The six-test
workflow-injection suite and the medium audit both exited 0 again.

Actual commands, applied mutation diffs, file hashes and raw output are retained
in the private `audit-and-mutation-results.json` receipt and its referenced logs
under `approved-batch/pr1785/oct14-ci-only-ratchet/`. Exploratory mutations that
did not distinguish the thresholds are retained separately and are not counted
as successful proofs.

## Normal completion and review

The normal local completion command for this three-file candidate is:

```sh
bash scripts/agentic-validate.sh --tests "test:workflow-security"
```

Its actual output and exit code are retained privately in `agentic-validation.log`
and `agentic-validation.json`. This runs the affected tests, lockfile check,
strict lint, all TypeScript configurations, secrets scan, local cross-agent
check, documentation and roadmap checks, and frontend build. Local cross-agent
checking does not perform an independent model review.

The normal repository pre-commit hook is required for the local commit; its
output is retained in `normal-commit.log`. Independent Sol review and the
required cross-agent review remain pending. This note does not claim public CI,
review approval, publication or delivery of the candidate.

Rollback is limited to this CI threshold, its regression guard and this note.
The delivered #1795 security controls remain the accepted foundation.
