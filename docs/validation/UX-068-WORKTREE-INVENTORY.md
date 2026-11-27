# UX-068 — bounded worktree inventory validation

Draft [#1924](https://github.com/bradleybond512/crystal-ball/pull/1924).
Prepared November 25; bounded design and local collection approved November 26,
2026. Validated code `7e8461622fe3fc11dd450b03ca0645a3383df584`, base
`ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`. The bounded implementation and local
collection are verified; full UX-068 cleanup acceptance remains open.

## Behavior and architecture

The dependency-free `scripts/worktree-inventory.mjs` collects offline Git evidence
with explicit repository and optional status/patch scope. It emits JSON only.
Aggregate status, pinned ancestry, exact tree equality, normalized patch matches,
supplied PR provenance and supplied recovery evidence remain separate. Unknown
and partial results are explicit; no deletion recommendation or backup is created.

Files: collector, `tests/worktree-inventory.test.mjs`, package test command,
additive targeted-test mapping, approved design/brief, tracker and this report.
No app runtime, dependencies, storage, installed profile or CI workflow changed.
The already-approved operational disablement of workflow 257667701 remains;
its faulty deletion source is not repaired by this stage. Separate #1920 is untouched.

Git runs through a closed argument allowlist, fixed executable, sanitized environment,
no transport/lazy fetch, optional locks, fsmonitor, hooks, maintenance, external diff
or textconv. Configured filters prevent status collection. Files are read through
bounded regular-file handles. All Git output must decode losslessly. Explicit
patch options disable signature tooling, notes, color, nested submodule display
and configured path/gitlink exclusions. Patches remain in memory only.

Budgets are invocation-wide. A patch attempt reserves its output allowance before
execution; complete successful reads refund unused reservation, failures retain
it, and observed stdout/stderr overshoot is counted. First output overflow stops
all later patch reads. `patchBytes` is charged budget, including failed reservations,
not exclusively successfully parsed bytes. `spawnSync.maxBuffer` is a requested
capture limit: a final captured chunk can exceed it. No exact OS byte ceiling is
claimed. That overshoot is visible and cannot authorize repeated oversized reads.

Patch matches are normalized per-commit IDs under the examined local diff settings,
not semantic equivalence, ancestry, exact resulting trees or proof an effect remains
in main. Context/algorithm settings can affect IDs. Unmatched never means unique;
squash/split/merge effects and capped scope stay unresolved.

## Executed validation

Node 22 with existing dependencies; actual command output:

```text
node --test tests/worktree-inventory.test.mjs
# tests 77
# pass 77
# fail 0

npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json

bash scripts/agentic-validate.sh --tests test:worktree-inventory
Agentic validation gate passed.
Tests run: test:worktree-inventory

node scripts/targeted-tests.mjs
[targeted-tests] 9 script(s) passed.
```

Collector/test ESLint passed without suppressions. Full gate includes lockfile,
strict lint, types, secrets, cross-agent configuration, documentation, roadmap
and build. Build timing/bundle notices were advisory. Fixture tests cover real
Git histories, configured helper sentinels, filters, transport, malformed output,
privacy, snapshots, missing objects, concurrency, caps, FIFOs and symlinks.

## Mutation proofs and repair history

45 unique guard proofs, 58 successful executions across 33 initial, 20 first-repair
(including 13 replays), and five final-repair proofs. Twenty unaffected earlier
proofs retain their original source/test commit provenance; they are not presented
as reruns on the final tip. Each proof began clean, saved its applied diff and
actual baseline/red output, restored its checksum and confirmed clean status.
Final source SHA-256:
`3a2c0046b94e79a5ff818f1ffcfdf4fb62bf50822c066c41e1909bffc167f180`.

The original phase-budget mutation survived because a real 1 ms process timeout
masked the missing phase guard. The fixture was strengthened to separate those
mechanisms, and the actual repaired proof is retained alongside the survivor.
No syntax/import failure is counted as behavioral proof. Initial absent-module
runs are not claimed as behavioral reds.

| Guard | Subset baseline pass / fail | Mutated pass / fail | Proof commit |
| --- | --- | --- | --- |
| containment | 1 / 0 | 0 / 1 | `f5b288f959` |
| transport | 1 / 0 | 0 / 1 | `ad28f85c48` |
| lazy-fetch | 1 / 0 | 0 / 1 | `ad28f85c48` |
| filter-guard | 2 / 0 | 0 / 2 | `f5b288f959` |
| global-ref-cap | 1 / 0 | 0 / 1 | `f5b288f959` |
| global-worktree-cap | 1 / 0 | 0 / 1 | `f5b288f959` |
| global-ancestry-cap | 1 / 0 | 0 / 1 | `f5b288f959` |
| ending-consistency | 1 / 0 | 0 / 1 | `f5b288f959` |
| status-consistency | 1 / 0 | 0 / 1 | `f5b288f959` |
| porcelain-shape | 3 / 0 | 2 / 1 | `ad28f85c48` |
| empty-untracked | 3 / 0 | 2 / 1 | `ad28f85c48` |
| filename-privacy | 1 / 0 | 0 / 1 | `f5b288f959` |
| pr-completeness | 2 / 0 | 1 / 1 | `f5b288f959` |
| pr-pagination | 1 / 0 | 0 / 1 | `f5b288f959` |
| pr-fork-identity | 1 / 0 | 0 / 1 | `f5b288f959` |
| pr-oid-drift | 1 / 0 | 0 / 1 | `f5b288f959` |
| recovery-independent | 1 / 0 | 0 / 1 | `f5b288f959` |
| recovery-provenance | 1 / 0 | 0 / 1 | `f5b288f959` |
| patch-matches | 1 / 0 | 0 / 1 | `ad28f85c48` |
| unmatched-not-unique | 1 / 0 | 0 / 1 | `ad28f85c48` |
| merge-omission | 1 / 0 | 0 / 1 | `ad28f85c48` |
| binary-omission | 1 / 0 | 0 / 1 | `ad28f85c48` |
| empty-omission | 1 / 0 | 0 / 1 | `ad28f85c48` |
| total-commit-cap | 1 / 0 | 0 / 1 | `ad28f85c48` |
| patch-byte-cap | 2 / 0 | 0 / 2 | `ad28f85c48` |
| per-ref-commit-cap | 1 / 0 | 0 / 1 | `ad28f85c48` |
| phase-budget | 3 / 0 | 0 / 3 | `ad28f85c48` |
| snapshot-no-follow | 1 / 0 | 0 / 1 | `1972ca029a` |
| nonblocking-file-open | 2 / 0 | 0 / 2 | `1972ca029a` |
| submodule-boundary | 1 / 0 | 0 / 1 | `1972ca029a` |
| falsey-pr-evidence | 1 / 0 | 0 / 1 | `1972ca029a` |
| falsey-recovery-evidence | 1 / 0 | 0 / 1 | `1972ca029a` |
| limits-ceiling | 1 / 0 | 0 / 1 | `1972ca029a` |
| raw-capture | 1 / 0 | 0 / 1 | `ad28f85c48` |
| patch-lossless | 1 / 0 | 0 / 1 | `ad28f85c48` |
| metadata-lossless | 1 / 0 | 0 / 1 | `ad28f85c48` |
| failed-reservation | 1 / 0 | 0 / 1 | `ad28f85c48` |
| successful-refund | 1 / 0 | 0 / 1 | `ad28f85c48` |
| observed-overshoot | 2 / 0 | 0 / 2 | `ad28f85c48` |
| overflow-stop | 1 / 0 | 0 / 1 | `ad28f85c48` |
| signature-suppression | 1 / 0 | 0 / 1 | `7e8461622f` |
| color-suppression | 1 / 0 | 0 / 1 | `7e8461622f` |
| full-path-scope | 1 / 0 | 0 / 1 | `7e8461622f` |
| gitlink-inclusion | 1 / 0 | 0 / 1 | `7e8461622f` |
| short-submodule-format | 1 / 0 | 0 / 1 | `7e8461622f` |

Initial independent Sol review found lossy patch decoding and uncharged failed
reads. Real fixtures showed distinct invalid bytes matching and oversized reads
escaping aggregate accounting (`0 pass / 2 fail` before repair). Parent extended
the same decoder finding to packed-ref names (`0 pass / 1 fail`). Repair round 1
fixed the shared decoder and accounting; 73 tests and 20 affected/new proofs passed.

Sonnet raised signature-tool execution as an unconfirmed nonblocking concern.
Parent reproduced the configured helper executing and promoted it to a blocker.
Final repair round 2 explicitly fixed Git patch options. Signature, presentation,
relative-path and gitlink fixtures were `0 pass / 4 fail` before repair, then
`4 pass / 0 fail`; five effective guard mutations each changed `1 / 0` to `0 / 1`.
Notes are tested with real configuration; no separate necessity proof is invented
for the redundant notes flag. No third automatic repair was attempted.

Fresh Sol and actual Sonnet reviews of `7e8461622f` found no remaining blockers.
Sol independently reran the four latest cases and audited the five new mutations;
earlier it reran all 73 tests and audited the 20 repair proofs. Sonnet reviewed
immutable diff/source, did not run tests or independently verify Git SHA, and
identified residual diff-setting sensitivity documented above. Final documentation
and collection-evidence audits follow this evidence checkpoint; the recorded
verdict must pin the eventual final documentation tip.

## Approved local collection — aggregate evidence only

Executed after the final code reviews and gates. Raw manifests and supplied PR
metadata remain private local files (0600 in a 0700 artifact directory); no raw
paths, branch lists, patches, contents or error strings are published here.

One low-ancestry enumeration pass selected registered paths. One collection pass
used the approved default budgets: all 621 captured worktree registrations and
the two active draft branches #1923/#1924 for patch comparison. No automatic retry
or cap increase. The supplied GitHub snapshot contained 40 open PRs from one
complete page; recovery evidence was not supplied.

Actual collector aggregate output (UTC, November 26 local time):

```text
startedAt: 2026-11-27T05:08:00.441Z
finishedAt: 2026-11-27T05:08:38.779Z
exitCode: 2
complete: false
repositories: 1
refs: 2558
worktrees: 621
locked: 7
prunable: 191
detached: 206
gitCommands: 1552
examinedPatchCommits: 14
patchBytes: 443631
```

- Ancestry: 28 ref rows tip-ancestor, 375 diverged, 2,155 unknown after the
  256-unique-tip investigation cap. Aliases can share OIDs; counts are ref rows.
- Status: 426 skipped for configured external filters; 156 registered paths could
  not be confirmed against the expected repository; 39 otherwise unavailable.
  No status was reported clean. Ignored files, submodules and owner activity remain
  unassessed; these are not 621 verified directories or inactive owners.
- Ownership: 85 ref rows matched the supplied snapshot, nine had head-OID drift,
  2,464 had no matching open PR in that snapshot. These are not counts of distinct
  PRs or owner attestations. Cached tracking refs are not current remote confirmation.
- Recovery: unknown for every one of the 2,558 ref rows; no copy was created or tested.
- Each selected branch had a different tree, seven unmatched examined commits,
  zero normalized matches and zero omitted commits within its selected patch scope.
  Uniqueness remains unresolved. Other branches were not selected for patch checks.
- Start/end repository fingerprints matched. This is a non-atomic observation,
  not proof no owner was active. Structured errors were empty; explicit skipped
  dimensions made the usable report partial (exit 2), not success or permission.

Full raw validation/patch-mutation evidence and private inventory artifacts are
retained under `next-nov26/ux068`. No branch, worktree, PR, stored profile or
production data was deleted or altered by collection. GitHub snapshot retrieval
was separate from the offline collector. No app was launched or installed.

## Remaining acceptance, rollback and proposed PR

Full UX-068 remains open: ownership/activity, filter-aware status coverage,
verified independent recovery, broader patch coverage and separately approved
cleanup are unresolved. Prunable metadata and matching patches never authorize
removal. The unsafe weekly cleanup stays disabled through rollback. Its eventual
repair/reactivation requires separate scope and approval.

Manual follow-up: inspect the private manifest, supply independently verified
recovery/ownership evidence, and choose further bounded scopes. Any live filter
execution or destructive cleanup needs a separately approved design. Rollback
removes collector/tests/wiring; no migration or production rollback is needed.

Proposed draft description: add a bounded offline branch/worktree evidence collector
that preserves unknowns and grants no cleanup authority. Validation: 77 tests,
45 unique guard proofs with explicit provenance, nine selected suites, full gate,
two repaired review rounds and a partial local inventory. Code publication and
hosted acceptance remain pending. Merging, auto-merge, releases, deployment and
installation remain paused.
