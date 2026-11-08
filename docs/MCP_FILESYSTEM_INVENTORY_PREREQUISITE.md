# Filesystem MCP inventory prerequisite

## Brief and scope

The approved isolated-filesystem design needs a separately locked tool project without changing the application's Node 22 runtime. The current PR-base auditor rejects every unknown manifest/lock, including a newly introduced tool pair. This prerequisite reserves only `.github/tools/filesystem-mcp/package.json` and its `package-lock.json`; it does not add either file, launch a server, or establish an actual MCP client integration.

## Contract

- The existing six projects remain mandatory.
- Both reserved files may be absent in this prerequisite. If either is tracked, both must be regular Git blobs and the seventh project receives the same manifest, graph, direct advisory and npm-report validation as existing projects.
- Unknown siblings, casing, nested paths, alternate lock formats and symlink blobs remain rejected.
- Reads use committed blobs, not mutable worktree files.
- Install-surface and release-age inventories include the exact future lock. A new bin still requires the human-only `install-scripts-reviewed` label; age and dependency approvals cannot substitute for it.
- The adoption change must promote this exact project to mandatory. No general optional-project mechanism or fallback is introduced.
- Workflow base selection and its immutable historical bootstrap digest remain unchanged. The regression now hashes the original historical fixture rather than incorrectly requiring today's evolving checker to retain that digest.

## Validation status

A qualified tests-first run on unchanged production produced five intended failures and three passing negative/history guards. The original outer-monitor race is separately retained as unqualified; its corrected bounded rerun passed supervision and source-pin checks. Focused green passed 8/8 and the full related suite passed 44/44, with no failures, skips, cancellations or todos; both completed under qualified supervision with unchanged input pins and empty owned process groups. Clean detecting mutations, successful normal hooks, final repository checks and independent review remain pending. The first normal hook attempt stopped on this brief’s Markdown spacing before typecheck, staged lint or signing; no commit was created. No live-runtime integration is claimed.

The full related suite includes synthetic shell/base-selection tests, not actual registry or npm verification. Review actual applied mutation patches and failed assertions, including later report/age/label cases, before accepting coverage. A passing test alone is not detecting-mutation evidence.
