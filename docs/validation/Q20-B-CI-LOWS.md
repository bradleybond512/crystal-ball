# Q20 workflow hardening: partial #1781 scope

This package separates workflow security improvements from #1781's unresolved
MCP artifact changes. Bradley authorized scoped repairs and protected publication
on October 13, 2026. The full #1781 scope remains open; a workflow-only delivery
does not count as an additional completed scope in the approved queue.

## Workflow changes

- Pass workflow values through environment variables and quoted arguments.
- Remove caches from desktop jobs that receive application or signing secrets.
- Set explicit read-only defaults while retaining required publisher grants.
- Disable checkout credential persistence. Auto-tag authenticates only its exact
  repository tag push through command-scoped Git configuration.
- Protect the extracted tag helper with Bradley's exact CODEOWNER and existing
  dependency approval-label rules.
- Keep pinned actionlint and version/hash-locked offline zizmor high auditing.
- Replace global/floating Codex installation with a dedicated exact-version,
  integrity-locked tool package, scripts disabled and trusted-main inputs only.
  Installer failures stop review; Sol medium and cross-agent routing are retained.
- Include the CI tool lock in existing dependency-age and install-script gates,
  ownership, test routing and Dependabot cooldowns. The new executable requires
  Bradley's install-script review; no label is supplied by this package.

## MCP deferral and unchanged baseline risk

`.github/mcp.json` remains byte-identical to the reviewed main baseline. GitHub
still uses the unversioned `ghcr.io/github/github-mcp-server` image, filesystem
uses unversioned `@modelcontextprotocol/server-filesystem`, and fetch uses
unversioned `mcp-server-fetch`. Token and workspace boundaries are unchanged.
Those floating/unqualified supply-chain risks remain; this package introduces
neither a replacement artifact nor a new MCP execution path.

The proposed MCP pins and their newly introduced pinning assertion remain
in #1781's held work. Existing tests and gates are retained. Generic MCP CODEOWNER
and sensitive-file protections can land independently of artifact adoption.
The October 13 upstream scan of the maintained GitHub MCP v2.0.2 candidate reports
two critical and twelve high findings; it is unapproved. Cryptographic provenance
and filesystem component licensing also require separate qualification.

## Validation and publication boundary

The earlier private hardening and its Sol medium review remain frozen unchanged.
One automatic approval-boundary repair cycle has been used; the repository limit
of two carries forward to this separated package.

Fresh normal validation passed under Node 22.23.1, including workflow-security
59/0, supply-chain 21/0, ESLint-runner 10/0, install-script 62/0 and agentic-pipeline
75/0. The full gate also passed lint, typechecks, secrets, documentation and the
frontend build. Nine new mutations produced genuine failures and were restored,
including immutable installation, fail-closed behavior, gate coverage, executable
presence and release argument quoting. An initial Markdown gate failure and a
transient tool-transport failure remain recorded; no checks were weakened.

Actual audits cover all 23 workflows, using previously hash-verified actionlint
1.7.8 and zizmor 1.30.1 with executable hashes rechecked:

| Audit | Exit | Findings |
| --- | --- | --- |
| actionlint, optional ShellCheck/Pyflakes excluded | 0 | none |
| offline zizmor high, existing ignore honored | 0 | none |
| offline zizmor all severities, existing ignore honored | 0 | none |
| offline zizmor with ignores disabled | 14 | one high trigger report |

The remaining trigger report is the existing dependency gate: trusted-base-only
checkout, read-only token and no PR-code execution. Its documented narrow ignore
is retained; this is not an ignore-free clean audit. The earlier 43 medium,
two low and eleven informational reports are eliminated in this workflow slice.

The real release-age check passed without labels. The real install-script check
returned 1 for the newly locked Codex command, and the sensitive-file policy
returned 1 without approval. Bradley must review and apply the existing
`install-scripts-reviewed` and `dependency-change-approved` labels himself.
Fresh Sol medium review will bind the exact code commit; its private report is
separate from the formal cross-agent verdict required for protected merge.

No MCP artifact execution or new Claude submission is part of this preparation.
Protected merge still requires the existing cross-agent verdict and
Bradley's human-only dependency and install-script approval labels.
