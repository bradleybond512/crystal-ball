# UX-068 — bounded offline worktree and branch evidence

High Assurance design approved by Bradley on November 26, 2026, including the
documentation draft claim, local implementation and bounded read-only inventory.
See [brief](2026-11-25-ux068-inventory-brief.md). Full UX-068 cleanup acceptance
remains open: an inventory does not authorize deletion.

## Existing workflow and immediate hold

The existing `cleanup-stale-branches.yml` closes old PRs before checking open-PR
ownership, reads only the first page of branches/initial PRs, and discards the
`compareCommits` response before deletion. Scheduled runs receive no dry-run
input and therefore take the destructive path. Parent verified a successful
comparison with `status: behind`, `behind_by: 1`, `ahead_by: 0`; request success
does not establish that the compared branch is merged.

Bradley explicitly approved pausing this workflow on November 25. GitHub workflow
257667701 is verified `disabled_manually`; no active recent run was found.
No branch, PR or directory was deleted. This is an operational hold, not a code
repair. Keep it disabled through this task and rollback. Any report-only repair
belongs in the existing workflow under separate approval; do not add a second
remote cleanup mechanism. Separate dependency PR #1920 stays in its own workflow.

## Useful evidence without cleanup authority

Discovery observed 621 registered worktrees (7 locked, 191 prunable, 206 detached),
1,810 local branches and 747 cached tracking refs. These are metadata counts,
not verified directory counts or cleanup candidates. Five aliases share one
common repository; main was `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`.
Some remotes use partial clones, so ordinary Git reads can trigger lazy fetching.

Build one dependency-free Node collector, `scripts/worktree-inventory.mjs`, with
an importable API and stdout-only JSON CLI. It complements remote automation with
local evidence. No archive creation, status modification, stashes, pruning,
deletion, checkout, configuration changes, network, app/profile access or upload.
Never emit a `safeToDelete` field or equate age/ancestry with permission.

```text
node scripts/worktree-inventory.mjs --repo <explicit-path>
  --base-ref refs/remotes/<resolved-canonical-remote>/main
  [--status-worktree <registered-path>] [--patch-ref <full-ref>]
  [--pr-snapshot <explicit-file>] [--recovery-snapshot <explicit-file>]
```

Repeated repo arguments identify explicitly supplied aliases; deduplicate by
canonical common-directory identity. Status and patch options are repeatable.
The approved initial collection may select all registered worktrees/refs in
this repository, with bounded coverage and local output only. Scope selection
does not require repeated permission questions. Never discover arbitrary folders.

## Collection and manifest

Pin the explicit baseline and every compared tip to immutable OIDs. Enumerate
worktree registration and local/tracking refs using bounded, NUL-safe Git output.
Cache ancestry results for identical tips. Reread base/ref/registration metadata
at the end and record changed/unknown observations; do not claim an atomic snapshot.

Manifest version 1 records:

| Dimension | Evidence and interpretation |
| --- | --- |
| Envelope | Start/end times, requested scope, effective budgets, counters, dimension-specific completeness and structured errors |
| Repository | Common-directory identity, aliases, pinned base ref/OID, shallow/grafted/partial limitations, start/end fingerprints |
| Ref | Full name, captured OID, local or cached tracking kind; tracking evidence is not current remote confirmation |
| Ancestry | Equal, tip ancestor of base, base ancestor of tip, diverged or unknown; compared OIDs and reason |
| Worktree | Registered path, HEAD, branch/detached, locked/prunable flags; omit raw lock/prune reasons |
| Status | Timestamped aggregate staged/unstaged/conflicted/untracked counts, completeness, consistency and exclusions |
| Patch evidence | Exact tree equality, normalized per-commit matches, unmatched examined commits, omitted/unsupported evidence and reasons |
| Ownership/recovery | Supplied PR matching/provenance, owner activity unknown, supplied recovery verification record or unknown |

No file contents, patch text, commit subjects, PR bodies, remote URLs, credentials
or raw Git errors appear in output. Branch names and paths are private metadata;
JSON-escape them and retain raw manifests locally. Published evidence is aggregate.

## Read-only subprocess boundary

Use argument arrays, no shell, and an explicit command allowlist. Set
`GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0` and
`GIT_NO_REPLACE_OBJECTS=1`; disable maintenance, fsmonitor, transport, external
diff and text conversion. Remove inherited Git tracing and alternate repository
routing variables. Missing promisor objects produce unknown evidence, never a
fetch. Validate Git path/OID/ref inputs; do not interpolate executable options.

Status uses `git status --porcelain=v2 -z --untracked-files=all
--ignore-submodules=all` only for selected existing registered worktrees. Emit
counts rather than filenames; staged and unstaged counts may overlap. Ignored
files and submodule contents remain unassessed. Detect configured external
clean/process filters before status; skip with `external-filter-configured`
rather than execute filters or silently change their semantics. Check HEAD/index
identity before/after. Missing paths, incomplete enumeration, changes, limits
or errors cannot become a clean-status claim. A clean observation cannot prove
that no owner is working.

For selected patch refs, compare tree OIDs first. Equal trees mean identical
committed tip snapshots, independently of ancestry. Otherwise enumerate bounded
non-merge and merge commits on both sides of the pinned symmetric difference.
Generate non-merge patches with `--no-ext-diff --no-textconv --no-renames`, feed
bounded bytes directly to `git patch-id --stable`, and emit matching commit OIDs.
Never print or persist patches. Report merge, empty, binary/unsupported and
missing-object cases explicitly. Patch-ID matches are normalized per-commit
equivalence, not identical trees or proof an effect still exists in main.
Unmatched means `unmatched-in-examined-scope`, not unique work: squash/split
merges, conflict resolution and limited coverage defeat that inference.

## Supplied evidence and limits

Optional PR snapshot: strict version, repository identity, timestamp,
complete/truncated/pagination attestation, and records with PR number/state,
head repository/full ref/OID and base repository/ref. Structural validation is
offline; completeness remains supplier-declared. Match full repository/ref
identities, retain OID mismatch, and never conflate forks by short name. Missing,
invalid, incomplete, stale or mismatched evidence leaves coverage unknown. Even
a complete snapshot supports only “no matching open PR in this snapshot”.

Optional recovery metadata requires provenance, covered OIDs/files, verification
time and the actual independent-copy verification record. Label it supplied
evidence, not collector-verified recovery. A filename, checksum or another ref
in the same object store is insufficient. Committed and dirty/untracked work
need different coverage. No backup is created or declared recoverable here.

Initial engineering budgets, validated with fixtures rather than presented as
performance guarantees: metadata 30 seconds; status 60 seconds; patches 60
seconds; each subprocess at most five seconds and 16 MiB output; at most 10,000
refs, 2,000 worktree records and 256 unique-tip ancestry investigations. Patch
limits: 128 commits/ref, 512 total, 2 MiB/commit and 32 MiB aggregate patch bytes.
Use deterministic ordering, no automatic retries or cap increases. Report every
skipped ID and dimension. A large initial run may be partial; scoped reruns can
extend coverage. Exit 0 for completed requested collection, 2 for usable partial
evidence, 1 when no valid report can be produced. Unknown is never permission.

## Owners, tests and completion

| Owner | Files / responsibility | Dependency |
| --- | --- | --- |
| Security specialist | `scripts/worktree-inventory.mjs` | Approved design and draft claim; read-only command envelope |
| Test specialist | `tests/worktree-inventory.test.mjs`, generated temporary Git fixtures | Agreed collector/schema interfaces |
| Parent | Package test command, additive CI test mapping if needed, design/tracker/evidence | Actual validated results |
| Independent reviewers | Full completed diff and evidence | Tests, mutations and full gate |

Tests: alias deduplication; NUL/newline paths; detached/locked/prunable metadata;
pinned ancestry; PR pagination attestations/forks/OID drift; clean/dirty/conflicted
status counts with filenames absent; missing worktrees/submodules/filters;
HEAD/index drift; cherry-picks, squash/merge/empty/binary/equal-tree histories;
missing promisor objects with transport attempts trapped; time/output/record/
commit/byte caps; unchanged refs/index/registration; confidential output and
bounded recovery claims. External-filter fixtures must prove a sentinel was
never executed. Fixture repositories only before the approved local collection.

Mutation proofs must catch false containment, incomplete evidence treated as
complete, unmatched patches called unique, missing filter/transport guards,
ignored caps or ending fingerprints, and leaked filenames/patches. Record
applied diffs, actual red counts, restored checksums and clean status.

Planned checks: `npm run test:worktree-inventory`, `npm run typecheck:all`, and
`bash scripts/agentic-validate.sh --tests "test:worktree-inventory"`. Implementation, 77 tests, mutation evidence, reviews and the bounded local
collection are recorded in the [validation report](../validation/UX-068-WORKTREE-INVENTORY.md). Rollback removes collector/tests/wiring;
there is no migration. Workflow disablement survives rollback. Draft [#1924](https://github.com/bradleybond512/crystal-ball/pull/1924):
“UX-068: inventory branch evidence without cleanup authority”. Full UX-068 stays
open until ownership, recovery and separately approved cleanup are verified.
Merging, auto-merge, releases, deployment and installation remain paused.

Validated boundary clarification: failed patch reads retain reserved budget and
observed capture overshoot; one overflow stops later patch reads. Output caps are
requested subprocess capture limits, not exact OS-byte ceilings. Normalized patch
IDs reflect examined local diff settings and never establish semantic equivalence.
