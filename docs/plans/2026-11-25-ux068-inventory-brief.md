# UX-068 — current branch and worktree inventory

High Assurance bounded inventory stage approved November 26, 2026. The roadmap selects UX-068 [C] after
UX-016 and UX-037 were claimed in drafts #1922 and #1923. The documentation draft claim and bounded implementation are authorized;
cleanup and code publication remain separate.

Goal: inspect the existing cleanup workflow and design a current manifest of
merged, patch-equivalent and unique branch work, open-PR ownership, worktree
status and verified recovery evidence. Unknown ownership/recovery stays unknown;
never infer permission to delete from age, merged status or prunable metadata.

Acceptance for discovery: identify actual scripts, automation, data sources and
failure paths; propose a bounded safe inventory stage and distinguish it from
full UX-068 cleanup acceptance. Preserve unique work and every existing directory.

Read-only repository analyst traces existing workflow and Git inventory seams;
architect designs manifest fields, evidence, completeness, costs, tests and
approval boundaries. Parent writes the reviewable design. No implementation,
deletion, pruning, branch changes in other workspaces, stash operations, cleanup
workflow dispatch, app/profile access, merging, auto-merge, release, deployment
or installation. Leave separate dependency PR #1920 in its existing workflow.
