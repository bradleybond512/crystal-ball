# UX-066 — shared audit repair discovery

High Assurance continuation of existing UX-066 ownership in draft #1902.
November 28 approval covers the bounded cookie-only design, isolated testing and
local reconciliation. The later safe-merge/Mac-build instruction authorizes protected delivery after
validation; see the security-first integration plan for that continuation.
The complete roadmap snapshot has no eligible unclaimed task. Shared audit
failures still block reviewed drafts, so identify a bounded continuation of the
existing dependency-backlog task without duplicating other owners.

Observed on #1927 at d80f83699f: marketing react-server-dom-webpack critical;
Rust cookie RUSTSEC-2026-0594 and url RUSTSEC-2026-0592. Source main is
ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda. Verify dependency paths, patched-version
availability, compatibility and existing PR coverage before proposing changes.

Read-only PR inventory: #1901 proposes marketing RSC 19.3.1; #1892 updates Tauri;
PR #1893 updates clipboard; #1920's independent weekly batch includes url 2.5.9 and
retains its own workflow/auto-merge by explicit user exception. Do not change
those PRs, their labels or settings. #1902 owns the broader UX-066 checkpoint.

Acceptance: source-backed current findings and dependency paths; existing-fix
overlap; smallest repair/version choice supported by official advisories and
package metadata; bounded validation and rollback plan with unresolved gaps.
Do not substitute PR descriptions for current audit results.

No installs, dependency edits, lockfile regeneration, production changes, tool
downloads, application/profile access, publication, merging, auto-merge changes,
release, deployment, installation or cleanup during discovery. Fetching source
and public advisory/package metadata is permitted. All existing delivery holds
remain, including the disabled unsafe cleanup workflow. No security checks or
thresholds may be weakened. New dependency/security design requires approval.

Parent owns PR/current-advisory evidence; repository analyst owns read-only local
dependency paths and tests; architect designs only after those findings. Final
implementation and publication scope will be a concrete approval request.
