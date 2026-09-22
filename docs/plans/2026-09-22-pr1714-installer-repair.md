# PR1714 incomplete nested installation repair

Risk: high assurance, install behavior. User approved this bounded design on
2026-09-22 after the partial-install reproduction and design comparison.

## Goal and acceptance

A failed nested MCP installation must not make the next prepare call skip repair
merely because node_modules exists. Resolve the actual SDK server/mcp.js,
server/stdio.js and Zod entrypoints from the nested package without executing
dependency code. Skip only when each resolves inside its own node_modules tree;
missing entrypoints or hoisted root packages must select the existing installer.

Preserve disabled/no-package/no-npm paths, lockfile preference, nonfatal failure
reporting and invocation through the existing Node/npm executable with no shell.
Synthetic subprocess tests must cover failed-then-retried installation, complete
local installation, missing SDK/Zod entries, hoisted dependencies and suppression
paths. Each new behavior needs an applied mutation with a real assertion failure,
restored checksum and clean tree.

## Boundaries and limits

No dependency additions, install stamp, signing, secrets, deployed application,
source feed, or unrelated PR behavior changes. The resolver checks entrypoint
presence and locality; it does not prove all transitive files are intact or that
installed versions match a changed lockfile. Tests use temporary directories and
a fake npm child, never the user's real package installation or credentials.
Rollback restores the original installer decision logic through a reviewed PR.

## Bounded owners and validation

- Installer specialist: scripts/install-mcp-deps.mjs and
  tests/install-mcp-deps.test.mjs; update this brief with actual evidence.
- Parent: mechanical integration of the existing PR onto current main, aggregate
  validation and publication. Preserve all unrelated source and dirty worktrees.
- Independent reviewer: completed diff and failure-path/mutation evidence.

Run test:mcp-deps first, both TypeScript configurations, then the named agentic
gate. Parent also verifies the existing PR's affected sanitizer, layout and
bundle checks. Required GitHub checks and genuine cross-agent review govern merge.
