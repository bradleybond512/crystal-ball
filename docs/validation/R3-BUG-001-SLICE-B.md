# R3-BUG-001 slice B validation: one vault writer

Historical report from October 3, 2026 on branch `claude/r3-bug-001-slice-b`, stacked on
`claude/r4-sec-001-secret-boundary` (#1768, `fc3079382`). Approved design:
[plan](../plans/2026-10-03-q16-vault-writer-and-signing.md), Part 1. Bradley's
choices:

- A: Part 1 as designed.
- B: refuse saves until the real vault has been read this session.
- C: wait 15 s, then report "pending" and finish in the background.

The original report below is **UNATTESTED historical evidence**. Its counts,
mutation reds, checksum prefixes and gate claims were imported from the original
commit; the October 10 repair has no raw artifacts attesting those runs. They
are not current execution results. The fresh reconstruction below is separately
pinned to the repaired implementation and does not attest those historical runs.

## October 10 integration

The original own delta (`fc3079382..72899ad87`) is integrated on current main
`a88b3272b`, retaining its authenticated shadow reader, revisioned controller,
confirmed live targets and receiver floors. `VaultState.inner` is the only map.
Typed transport adapters reserve the current value/revision and launch map/floor
while owning that exact lock, and fail closed on poison or revision exhaustion.
The writer callbacks synchronously select keys for the current sender; no
historical value is carried through a retry.

An unverified-to-Vault Load computes sorted formerly-managed removals under
inner ownership, then refreshes the permitted shadow and pushes explicit current
`None` selections before the next writer job. This also applies to an empty
vault and never selects unrelated inherited fallbacks. Verified loads retain
their existing additive, touched-aware merge behavior.

Launch reconciliation admits generation/key selections to the existing FIFO
(capacity eight). Full retains the original launch snapshot and recomputes on
later confirmation or the existing 1.5-second owning monitor tick. Accepted
consumes once; stopped admission retains pending state and logs once. Each
launch transport attempt checks generation before and after live target lookup.
Normal mutation pushes remain unrestricted fresh-live sends. Admission retries
create no new worker, queue or network retry policy.

Fresh fake-only contract coverage uses the actual production state/adapters and
controller with a stateful revision-aware effects sink. It covers partial/empty
replacement, queue saturation, current-state retry, poison/exhaustion, map/floor
ownership, listener floor, admission retention/once-only confirmation, and queued
old-generation rejection. Source checks bind these helpers to native callbacks
and monitor wiring. Fresh results and their precise limits appear below; raw
run logs remain external under `approved-batch/pr1774`.

No real Keychain, vault, native IPC, provider, installed app, signing or release
operation was used for this integration. Native tests use fake stores and a
temporary frontend build fixture.

## Behavior

- **One vault writer** (`src-tauri/src/vault_coordinator.rs`, pure, with the
  store behind a trait). A single thread is the only code that:
  - changes the secrets cache;
  - writes the vault (Keychain) or the encrypted shadow copy;
  - pushes secrets to the sidecar (per key and in full);
  - runs the legacy migration's consolidated write and cleanup.

  Jobs run first in, first out. The cache lock is held only to copy, inspect
  or swap. It is never held across the Keychain, the disk or a sidecar push.
  So the Settings status reads, the sidecar push, `start_local_api` (the
  sidecar's environment) and supervisor restarts never wait on a Keychain
  prompt.
- **Bounded saves:**
  - `set_secret` and `delete_secret` wait at most 15 s for the boot load,
    then at most 15 s for the write.
  - A job not yet started when its caller gives up is cancelled with one
    compare-and-swap, and it **never runs later**. The caller hears "not
    saved, busy".
  - A started job keeps the writer until the Keychain answers, so no later
    write can overtake it. Its caller hears "pending".
  - At most 8 jobs wait in the queue; a full queue answers "busy" at once.
  - A panicking job fails only that save; the writer keeps serving.
- **Late outcome, pulled.** A new trusted-window command,
  `get_secret_write_state`, returns `{ revision, pending, source }`. It never
  carries a value.
  - After a failed or pending save, the renderer polls it every 2 s, for up
    to 3 minutes.
  - Once nothing is pending, it reloads secret status and signals the other
    windows.
  - The webviews still have no Tauri event permission.
- **Readiness is signalled.**
  - `Loading`, then `Ready` or `Failed`, held under a mutex with a condition
    variable. The predicate is checked under the lock, so no wakeup is
    missed.
  - A guard on the boot task marks the load `Failed` if the task dies before
    the writer applies its result.
  - The 50 ms sleep-poll (up to about 271 s) is gone. `secrets_ready` keeps
    its meaning.
- **Write gate (new finding fixed).**
  - Reads now tell `NoEntry` (absent) apart from any other error and from a
    timeout. Before, any read error, such as a denied prompt or a keychain
    locked at login, counted as "no keys". A first Settings save then wrote a
    vault holding only that key.
  - Saves are allowed only when the real vault was read this session, or the
    Keychain confirmed there is no vault yet.
  - On the shadow copy, after an error, with an unreadable vault, or after an
    incomplete legacy migration, a save is refused. The message points to
    "Reload keys from Keychain".
  - The automatic 120 s retry or a manual reload lifts the gate. The real
    vault then replaces the shadow-derived cache.
- **Ordered merges.**
  - A read records the write generation it started at. If a save committed
    since then, the read does not refresh the shadow file.
  - Merges never resurrect a key the user deleted, and never replace a held
    value.
  - A verified session ignores later shadow or failed reads.
  - Migration merges into the current cache, and cleans up the legacy entries
    only after its vault write succeeds.

### Changed on purpose

- **`delete_secret` and `set_secret`** no longer push to the sidecar
  themselves; the writer does, after the commit. Three source checks were
  updated to the new path:
  - `secret-boundary` (Settings writes reach the sidecar after the vault
    write);
  - `ucdp-local-boundary` (a deletion is pushed as an unset);
  - `native-responsiveness-boundary` (set and delete run `save_secret_change`
    inside the worker).
- **Reads now tell errors apart.**
  - A vault read error no longer starts the legacy migration scan. That scan
    is only for an absent vault.
  - An unreadable (corrupt) vault no longer falls through to migration. It
    logs an error and keeps saves gated, so the item is not overwritten.
- **Found while testing #1768.** `test:native-responsiveness` still looked
  for `get_secret`, which R4-SEC-001 removed, so it failed (1 of 13). Fixed
  on #1768 itself (`fc3079382`): the check now covers `get_secret_status` and
  `get_renderer_config`. Two mutations proved it: a lock taken before the
  worker, and a missing trusted-window check.

### Not changed

- The shadow vault is still written after every successful save and read, and
  still read on a Keychain timeout. Removing it is R3-SEC-003 phase B (Q16b).
- Keychain item names, migration policy, and the R4-SEC-001 secret boundary.
- Sidecar transport is bounded best effort. Launch/current deltas are queued
  after owning confirmation; exhausted HTTP delivery still requires a later
  push or restart. A resolved target can be revoked during an in-flight request.

## Fresh October 10 validation

First proof freeze: `fc5cba175523a4dd8e1fd5b2f5a5a8963ba02823`; tree
`ad9993efbb0261469b7d02719245ebfe7f87270a`. Its first review freeze
`abfddc34f9b99a0e26bded914fd08a4531986448` changed three documentation files
only, with all5007 other tracked files byte-bound to that first proof. The
results below retain that provenance. The later portability correction and
selected fresh QA are recorded separately below; they do not replay all76
variants or attest the historical October 3 runs.

The full fake native suite actually reported these seven result blocks:

```text
test result: ok. 104 passed; 0 failed;
test result: ok. 9 passed; 0 failed;
test result: ok. 44 passed; 0 failed;
test result: ok. 7 passed; 0 failed;
test result: ok. 24 passed; 0 failed;
test result: ok. 45 passed; 0 failed;
test result: ok. 9 passed; 0 failed;
```

That is 242 pass / 0 fail. Command: `cargo test --offline --manifest-path
src-tauri/Cargo.toml`, with a temporary frontend fixture supplied through
`TAURI_CONFIG`. Raw-log SHA-256:
`5b84e0f5db7a59e61e08b52aa361298fda59eeb73d2e7a43e23935a42db27256`.

Independent QA's final restored baselines were coordinator contract45/0,
source42/0, renderer4/0, unchanged actual JS receiver6/0, and semantic TypeScript
check exit0. These overlap with the full suite and wrappers; they are not one
unique aggregate count.

The actual five-script gate command was:

```bash
bash scripts/agentic-validate.sh --tests "test:vault-writer test:native-responsiveness test:secret-boundary test:sidecar-supervisor test:sidecar-routing"
```

Exit0. Its per-script Node results were 9/0 then4/0;15/0;21/0 then15/0;9/0;
10/0 then56/0. A native-wrapper pass counts as one Node test and does not replace
the underlying Rust result. Lockfile check, strict lint, full typecheck, secret
scan, cross-agent configuration, documentation check, roadmap check and build
also passed. The secret scan covered5010 files. Explicit ESLint with
`--max-warnings 0` passed on all nine changed JS/TS files; their bytes are
unchanged by later Rust-only test instrumentation. Gate raw-log SHA-256:
`3f6c6d4d05d37247bc4bb50042558b817b786b68b0cf20f4c9e5b62da2a22eac`.

Warnings remain in the raw logs: native binary11/test-build10 warnings include
deprecated crypto array construction and unused helpers, including newly unused
coordinator helpers. Roadmap overdue-task advisories, Vite API-extension warnings,
ineffective dynamic imports and chunk-size warnings remain. Documentation check
reported `Documentation appears fresh`. No check or assertion was weakened.

### Linux CI portability correction and selected supplemental QA

First publication `7e361ebb32b1a42272aa551bc6de55279a6a5c15` failed the Linux
targeted run `38069369843`: ten new cfg(test) comparisons had ambiguous
`.parse()` types (`E0283`, `u64: PartialOrd<u64>` and `PartialOrd<glib::types::ULong>`).
The failed raw-log SHA-256 is
`700e6cf15c03793cd79f45f326e06fbafda14b736090391311c878cb883bea99`.
This was a compiler failure, not an accepted mutation red or a waived CI gate.

Correction freeze `27686ed6a8ae3cec39d902d494abf46da4b7a000`, tree
`e7d198aeacbd939a7baed37ffefbf96947f0582c`, adds only ten explicit
`parse::<u64>()` annotations: coordinator lines669/752 and secret-sync
lines233/307/311/319/353/568/580/581. Independent line comparison confirms
production lines, assertion operators/values and test control flow unchanged.
The two Rust test source files are no longer byte-identical to fc5.

The full fake native command above was actually rerun on this correction freeze
and again reported the same seven blocks,242 pass / 0 fail; raw-log SHA-256
`b2abbcf962e472b02869161238e27e62b665056a7361f92e7e8de1b1c4a9d41d`.
Fresh QA baselines and final restored checks both passed: contract45/0,
source42/0, renderer4/0, actual JS receiver6/0 and TypeScript exit0.
All are Darwin results. Fresh Linux CI success must be confirmed before merge.

QA actually applied14 selected variants in14 attempts here:13 compiled,
positive numeric, intended named reds and the legitimate N24 effect survivor.
N01–N05/N22–N28/N24R are selected reruns; new P01 removes snapshot allocation
and fails an actual post-floor fake-sink effect oracle plus five typed/helper
numeric oracles under that one applied mutant. Helper Mutex fixtures execute
production clock/sender functions but do not independently establish typed
VaultState map ownership. N24R remains allocation-contract evidence; N28 is
genuinely older-floor fake effect evidence. No new IPC/monitor/native HTTP or
real Keychain proof is claimed.

Each variant has an applied diff, before/mutated/restored SHA-256, raw numeric
results and all5010 file hashes restored. The root independently checked all194
indexed artifacts, all5010 tracked hashes in both isolated clones,71 distinct
variant/final raw logs, and the ten annotation-only changes. The bundle has76
raw logs including its five initial baselines. No compiler error or timeout was
accepted as a red. QA returned ownership with a clean tree and no owned runner.

The original76-row ledger remains immutable evidence at fc5:76 variants,
80 attempts,75 accepted. Its original rejections and a18 N27 survivor remain.
Unreplayed C/S/T and other cases carry only by exact production equality and
unchanged assertion logic after explicit numeric typing. Fresh full green suites
are not replayed mutation evidence. The overlapping prior and fresh counts must
not be added as unique coverage. The later review freeze changes only these
three docs; its5007 other files are bound to correction freeze27686.

Supplemental summary SHA-256:
`f5fd2f25a41c505de1e4b6a692686a7bc6468812c3c3681bb03b3384fc29bdc0`;
manifest SHA-256:
`5e162476fa92c10313a6dc3e4f4852696601ffff5e9652a228a198903c1a4654`;
artifact-index SHA-256:
`637be3e6da91fae0f7f4458160af28d72e5d7b447b04883438c01bdd94c33ab5`.
Raw supplemental evidence is retained privately in
`approved-batch/pr1774/oct10-repair/mutation-evidence/freeze-27686ed6a8ae3cec39d902d494abf46da4b7a000`.
The previous five-script gate result above belongs to its first proof freeze;
the new final review receives a fresh gate result at its exact reviewed head.

| ID | Taxonomy / disposition | Actual baseline → red → restored pass/fail blocks | Named failing assertions | Applied diff hash | Restored file hash |
|---|---|---|---|---|---|
| N01 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `ef30095d7cb383f1c658f99c0b1e3002c4345722500fec55a126dcfeba4e7c7b` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N02 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `80b7affd35674abc8d31c0e3840c6c68ea01f1a9185e0f4c4b992a19d7c5b46e` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N03 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `a02fa14a892a2cc1ddffe1a4391ee0449ad9a5cabfb875f9be9992022ff38340` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N04 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests | `1280278e4ea822132e0405a74799c96603a59edf935f41cbcbe178e31c92781e` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N05 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0, 1/0 → 0/1, 0/1 → 1/0, 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests; secret_sync::tests::native_clock_survives_listener_restarts_and_exhaustion_fails_closed | `33432ddb6732da49df4f887aa5c1410fd56a04f0db968af0356b15aef3c45b42` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| N22 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0, 1/0 → 0/1, 0/1 → 1/0, 1/0 | vault_coordinator::transport_tests::actual_state_retry_resnapshots_delete_rotation_and_revoked_target; secret_sync::tests::retry_uses_current_delete_and_rotation | `93946bac73ec876504b9cea5db9a91680cb48ae88f6e7fcdbca7121995a72206` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| N23 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_retry_resnapshots_delete_rotation_and_revoked_target | `a50df382b6a625ed2afeb55ff89e9c84306c992029db98568bf5626d58a8bdae` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| N24 | EQUAL_PREVIOUS_FLOOR_EFFECT_EXPERIMENT / REJECT_SURVIVOR_OR_WRONG_ASSERTION | 1/0 → 1/0 → 1/0 | none (survived) | `33d17903c0b2d0fee63d63af0da9f3956c27127cc33e96f064917157bb59530e` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| N25 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests | `6ea9f8e5bb1e82ded21452f641dc030065d019d520e7d9f3e38562638a3da023` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N26 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `a2d09a3d1bae32e8e597be42a9a0ff67d856b7d3d7550163761094df7712888b` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N27 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_allocates_from_authoritative_map_not_detached_clone | `c3d0b64f58fdeac69138b4d8c96de8968c7d072442a06ec4e0253ad963cf6045` | `a9b37de3c5084557a9d80d3ea031ea2c28bd57da396f1d36dc361db648c4227a` |
| N28 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | actual_launch_floor_rejects_delayed_request_for_absent_native_key | `2b361b829a46cf56912585dac16ff629c8606163a3ed439ad34d8772483c43e2` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| N24R | ACTUAL_TYPED_FRESH_FLOOR_ALLOCATION_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0, 1/0 → 0/1, 0/1 → 1/0, 1/0 | vault_coordinator::transport_tests::actual_state_snapshot_and_launch_allocate_after_current_owner; secret_sync::tests::snapshot_and_launch_revision_order_follows_cache_ownership | `33d17903c0b2d0fee63d63af0da9f3956c27127cc33e96f064917157bb59530e` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |
| P01 | ACTUAL_TYPED_SNAPSHOT_ALLOCATION_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0, 1/0, 1/0, 1/0, 1/0, 1/0 → 0/1, 0/1, 0/1, 0/1, 0/1, 0/1 → 1/0, 1/0, 1/0, 1/0, 1/0, 1/0 | actual_launch_floor_rejects_delayed_request_for_absent_native_key; vault_coordinator::transport_tests::actual_state_snapshot_and_launch_allocate_after_current_owner; vault_coordinator::transport_tests::actual_state_retry_resnapshots_delete_rotation_and_revoked_target; secret_sync::tests::normal_and_late_publication_reconcile_launch_delete_once_for_owner; secret_sync::tests::retry_uses_current_delete_and_rotation; secret_sync::tests::snapshot_and_launch_revision_order_follows_cache_ownership | `4ace84bf119db048c70ff8645bc8ba17c12e46fe6f539b76924b4c35cfe081a2` | `f632a5354d734a26f0247178fc1d7f6b91abee195007673acb94ef9f94f68f6b` |

### First-freeze actual mutation evidence

QA executed 76 concrete variants in 80
attempts at the proof freeze. All40 historical equivalents were reconstructed
fresh; 35 new variants also produced accepted reds. Thus
75 variants are accepted. The N24 equal-previous-floor effect
experiment survived and is retained honestly: the receiver's <=floor rejection
already blocks that value. N24R separately proves the fresh-allocation contract;
N28 uses a genuinely older floor and measures fake-sink credential effects.

Every accepted row has a nonempty applied diff, actual positive numeric failure
count, intended named assertion, restored original SHA-256, restored green, and
all5010 tracked checksums restored. The independent artifact audit checked
290 actual log hashes and independently matched every
tracked file in the implementation clone. Final QA has returned a clean tree at
the exact proof SHA with no pending code change or owned runner.

Taxonomy is explicit: source-policy tests guard wiring text; callback-parameter,
prelookup, map-identity and revision-allocation contracts are narrower than
credential effects. Native behavior cases execute actual production modules
against a fake revision-aware sink. Actual JS receiver tests are separate.
Neither source checks nor compile checks execute native IPC, the owning monitor,
or a real native HTTP round trip.

The a18ec8a detached-map N27 experiment survived before the final proof freeze.
A per-clock cfg(test) observer then bound the map reference to the authoritative
map while its real mutex is owned. N27 now has a named failing assertion on this
freeze; the earlier survivor remains unaccepted. Production bodies are equal
after removing only the narrow test instrumentation. Rejected S01 TAP-parser,
T04 wrapped-Promise-parser, N06 noncompiling and N20 provisional wrong-oracle
attempts remain recorded separately from their accepted reruns.

The actual summary SHA-256 is `e07894b902695c98c2f58cf43ae56bf3fe55f4ca01310900262fa8605d726f23`. Raw logs, full applied
diffs, attempt records, obligation mapping and restoration manifests are retained
privately under `approved-batch/pr1774/oct10-repair/mutation-evidence/freeze-fc5cba175523a4dd8e1fd5b2f5a5a8963ba02823`.
They are not reconstructed historical artifacts. The table quotes selected
baseline/red/restored pass/fail counts and lists the real failing tests; all
hashes are SHA-256.

| ID | Taxonomy / disposition | Selected baseline → red → restored | Named failing assertions | Applied diff hash | Restored file hash |
|---|---|---|---|---|---|
| C01 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | saves_are_refused_until_the_vault_source_is_known_and_complete | `529d08c931b53853b39517f5787fe129f6b7220f5d51542e61c323d78eb869b6` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C02 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | saves_are_refused_until_the_vault_source_is_known_and_complete | `6492ff52e8aa333a167928f0d943f0aa9ac1573a3324a4a50750c99abd35396b` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C03 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_confirmed_absent_vault_allows_the_first_save | `6881a073a0df0c50472418d851ea984b0cbca504ce0140eeb91e0d8f75edf162` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C04 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_hung_write_never_blocks_readers_and_later_saves_fail_fast | `30c50876a8ad2bde8ce041c56b5a7bec4f9addb2783e91f7e16b3cff3c1b50ea` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C05 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_save_still_queued_when_its_caller_gives_up_never_runs | `85e53e10189f1a7e80f50a2c0af5ade6ab456913bfddbf598eaa334a449d484e` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C06 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_save_still_queued_when_its_caller_gives_up_never_runs | `3fec8157e52c17fc0e4077905b22b354cce3a307a55aa0ed90f4c3b8a4083c9f` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C07 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_started_save_reports_pending_then_commits_and_reports_its_late_success | `697748a67f50df15e6155ebdc6d8f1e9dd18c66e3943d3f4e70196e7f20d8640` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C08 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_started_save_reports_pending_then_commits_and_reports_its_late_success | `b1bd5297f69d72d70ccd35c397d14880689d746aea95693980cad1d2bbd45484` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C09 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_started_save_reports_pending_then_commits_and_reports_its_late_success | `efaf797753229e0a594c654b19cd63fa32366f4d76c5947a862360d2606449ff` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C10 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_merge_never_resurrects_a_deleted_key_or_overrides_a_set_one | `408edcfe7111a2e10e211be3f4e5646a996029ac03904a75ecf0fc97baf6348e` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C11 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_reload_into_a_verified_session_never_replaces_a_held_value | `b566007f7b9e5c5768fac7ff718a91e7c32c7fa568694b5bf14c033fbd5105ea` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C12 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_stale_read_does_not_refresh_the_shadow_copy | `a9cd3b2420cc22e273471e6734b2e7d3e80fd624e173117613c0823b37c1d88b` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C13 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | the_real_vault_replaces_a_shadow_cache_and_lifts_the_gate | `f616230c2c03e38106879c828096ea90dac92010c9bbf205a102545240815e3c` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C14 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_verified_session_ignores_a_later_shadow_or_failed_read | `820a4e107232738d1f21a218d2a0ce547217035a6375b17478fd6124e3ce49a3` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C15 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | migration_merges_into_the_cache_and_cleans_up_only_after_its_write | `82abea8d264d16d1d660f15f363c6be23ad87603df7fd7b0e0ceb1451ef8662e` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C16 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_failed_migration_write_keeps_saves_gated_and_cleans_up_nothing | `69dc34f5ff8e04a3d8a14d07da24bede2bbc71a567f789e5d0947b7f233d2c12` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C17 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_failed_migration_write_keeps_saves_gated_and_cleans_up_nothing | `4247949e13cf12c37ca3d8fff1f82c3bd08e1d62ffdb6b2035b92d4b4729a834` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C18 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | readiness_wakes_waiters_and_a_dropped_guard_fails_an_unfinished_load | `6993c2c39ef92c5b55c7e794ddd2b29d8361a352ee8019f7fb3165ba836b5689` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C19 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | readiness_wakes_waiters_and_a_dropped_guard_fails_an_unfinished_load | `b0244a33d7475f1c6ee940a7fb8e85a3879ed02dbdabf1b4aa59c9b5d3a20f05` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C20 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | readiness_wakes_waiters_and_a_dropped_guard_fails_an_unfinished_load | `285dffc726d4ce54bf334ce5fa7fd82aa547acdedee35c69b74f953f0451d2ed` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C21 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_hung_write_never_blocks_readers_and_later_saves_fail_fast | `efb961e5df1079ddc779b930ea37daf2c682886232e2c7a3db9fe446e3b11f11` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C22 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_panicking_store_call_fails_that_save_and_the_writer_keeps_serving | `a2cd58259576da5dab9fc2a9de86cc68459718a328ed0ea0ee1213f57ff2e39c` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C23 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | set_and_delete_keep_their_order_through_vault_shadow_and_sidecar | `9f55ab312cc5e216df190697a1093b1e619863c078c76ae554b1584827747764` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| C24 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | a_merge_never_resurrects_a_deleted_key_or_overrides_a_set_one | `eecd05a904cfcb13788b60445cc3e2e622c0396d0c90b51af61df48638af5825` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| S01 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 35/3 → 38/0 | set_secret validates its caller and keeps all blocking work inside an awaited worker<br>Settings writes reach the sidecar from native, after the vault write<br>saves wait on signalled readiness, then go through the writer with a bound | `10b6b999bf6a8a07439d3e6e5c73f74f9aacc32f80a4ff52d0108ffe0c4716d3` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S02 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | a read error never counts as an empty vault | `3fbae59772e4bd2de6322e65da5126a92273ea7cd4fcb9b7c1b8d2e87ac0e556` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S03 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | boot fails closed through a guard, and the retry stays vault-only | `e4453b36ce6d78ef4d23706939f4e48cc78bbeca55b4f95a984e4a2473a038a0` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S04 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | boot fails closed through a guard, and the retry stays vault-only | `a2b0620a1aa37c3f6ebc368bf421b51d560137abe66082adb9a1196269d7d13e` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S05 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | saves wait on signalled readiness, then go through the writer with a bound | `8435d0e2f4822531f6d3a174205ebbe19740e4ba9654bdc5ed8f9793d36f6eec` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S06 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 36/2 → 38/0 | get_secret_write_state validates its caller and keeps all blocking work inside an awaited worker<br>the write state command is trusted-window only and carries no value | `f5538f9e93d4f810d2e89cca3be89f75cc6b20385c8a1b1fe42034ceb3164cee` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S07 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | the write state command is trusted-window only and carries no value | `67580260f768075869d03749b05af1180841f6412f5bcf857b2345c5f41c8e64` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S08 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | webviews still have no Tauri event permission (the late outcome is pulled) | `ec837beb3b451c7b1400e0493c1d9d4a0422ee80f742d032dc88ac17d26d34ef` | `8b783df53a15dd72c9f04c25ab71a2dcb6916e119c0c8b9c120e7357ed5c1257` |
| S09 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | boot fails closed through a guard, and the retry stays vault-only | `4be2ada234699029e761daea3f72807c37f543275e1560989b1e488986678f22` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| S10 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | get_secret_status validates its caller and keeps all blocking work inside an awaited worker | `c6aa034c5ae67c8df31a31d3d874002662853a7da131c0b3e1d2413c8885c53e` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| T01 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 3/1 → 4/0 | a pending save is followed until it lands, then status reloads and other windows hear it | `7a684f086cd0ba3de028eff8a9ba7c2ae78fb3bdacdf2a621064b4b1d28db4d1` | `6e4ab717b23b5e724d2c01974b72cbdc52fe83a1bd8778d72af28ec282c645f0` |
| T02 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 2/2 → 4/0 | a pending save is followed until it lands, then status reloads and other windows hear it<br>the watch gives up at its deadline while a write stays pending | `238428424e9205d274f2ec2887611f019b823d47adec61c8dda38eea67ff2151` | `6e4ab717b23b5e724d2c01974b72cbdc52fe83a1bd8778d72af28ec282c645f0` |
| T03 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 3/1 → 4/0 | the watch gives up at its deadline while a write stays pending | `5cb75fbdd79780903aef04a6dbd4bdddbc88852a3e7eb1776f10595eb96f240c` | `6e4ab717b23b5e724d2c01974b72cbdc52fe83a1bd8778d72af28ec282c645f0` |
| T04 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 3/1 → 4/0 | one watch at a time, and it stops on a bad or missing write state | `d59a5ba48d4b67b0bb96c39751464e9f84b85d084aaf607484c13ba6e9271a90` | `6e4ab717b23b5e724d2c01974b72cbdc52fe83a1bd8778d72af28ec282c645f0` |
| T05 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 3/1 → 4/0 | a pending save is followed until it lands, then status reloads and other windows hear it | `161c74ac0bf7845c63dbf3dec9d0c17786b9a8372935cffd1aeefeb9074ffa3a` | `6e4ab717b23b5e724d2c01974b72cbdc52fe83a1bd8778d72af28ec282c645f0` |
| T06 | ACTUAL_RENDERER_SERVICE_BEHAVIOR_FAKE_BRIDGE / ACCEPT_BEHAVIOR_RED | 4/0 → 3/1 → 4/0 | one watch at a time, and it stops on a bad or missing write state | `24ba53fd0762e4c1b252f6dff08ce5879090b20c84c68af7cf447dc04effb23e` | `17b3510c1bb296b62fc21ae96c3b923ba44ddc9f0955487ab9cbe36950bb72fc` |
| N01 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `35b37488da407a6f75d323cdc181fe4bac12a07d80a2e7ab81d549fa6eba9578` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N02 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `ae32b55b6e9e5b6cd8df84c5dbf5cae22a9b4d542d6ffc40ed01b4f3d0a2ebd4` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N03 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `7d70ac43442dc653ae97ecbff242a300078a04cfcaff34811009423ad185ed87` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N04 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests | `b0cda3a82680c1c066beee8a8691190f6773712964cd20cc2e5ed325bf2db32b` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N05 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests | `d77ce281a51ee8a181c3c3dfd73480bed1e7a46458c2e08c4714fe7103feabdf` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N06 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | authoritative_partial_and_empty_load_remove_effective_credentials | `725f4c135635a630696a1e5f0db89bb4b4253a02e84299358c0c5e779d37999d` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N07 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | authoritative_partial_and_empty_load_remove_effective_credentials | `a30c930c9b4a0739020a6b3dd8f55a86c412cb9b4162c963c8b9d06ec2597e65` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N08 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | authoritative_partial_and_empty_load_remove_effective_credentials | `31e3a6761844c5966546e6b2789f5d19ac80c697bed5af2b72ba75a65cc87660` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N09 | CALLBACK_PARAMETER_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | empty_load_removals_survive_full_queue_and_finish_before_later_save | `c2ad8c0638983eda669c334e1e4751ab1c93035a88daea67da3d140ba83d18d5` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N10 | ACTUAL_CALLBACK_SELECTION_ORDER_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | authoritative_removal_callbacks_are_sorted | `ad447c08fe604657495f760ba2570fad99da0dc034c8cce62aac8f77c14a9665` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N11 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | launch_full_retains_and_recomputes_then_admits_once_on_later_tick | `b4bfad5957bcb8157cc5b259bd792b75542365f02378358923befa1130baa034` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N12 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | transactional_pending_keeps_owner_on_read_failure_stopped_and_foreign_confirmation | `7c24b808d33722d9954f445fc726f452856da4f3d1cadbc1b40b8dffd67b6175` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N13 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | transactional_pending_keeps_owner_on_read_failure_stopped_and_foreign_confirmation | `b340f08c24793c4d4edcf589f975614956eef9b1507bc3340914c7940d2b9f26` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N14 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | concurrent_normal_and_late_confirmation_admit_actual_state_delta_once | `0b24262e65e080f4646fd8df7a0c11b9bf8ad8e6d31f9eb0bb73311bf17fac02` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N15 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | queued_old_generation_cannot_clear_new_child_inherited_fallback | `75f09d459d850c17e3e7a4e6f95dc673a3bd5ffc3de83d19a6e7c8e2fd27fea1` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N16 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | generation_guard_detects_supersession_during_lookup_and_each_retry | `c505500d0fa160eee27f6cad560f3b9f5412f27276ec043b80592710602a4622` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N17 | ACTUAL_GENERATION_PRELOOKUP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | generation_guard_detects_supersession_during_lookup_and_each_retry | `9bc54f074a3f10698557d0def012470201bda054bd991e8ff755771c365f2078` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N18 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 36/2 → 38/0 | native launch fences all allowed keys and reconciles both confirmation paths through the real sender<br>launch selections enter the bounded writer and retry admission after every live monitor tick | `23b8a9ff003170571fc4125381894ca51f0bee15fc18168f3b0b09501e07a7eb` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| N19 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | launch selections enter the bounded writer and retry admission after every live monitor tick | `e2078d24229a1cc1e8d6dfa22fd805fa85049b161f2c40bf77a212d99e5836dc` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| N20 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 36/2 → 38/0 | Settings writes reach the sidecar from native, after the vault write<br>the renderer is only ever handed a confirmed port | `2b39394a614e1b2ba5cc6f62f4b5f806b97647f9370c9454402ab00e116c4d0e` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| N21 | SOURCE_POLICY / ACCEPT_SOURCE_POLICY_RED | 38/0 → 37/1 → 38/0 | launch selections enter the bounded writer and retry admission after every live monitor tick | `df538f75a30a57d00a79338956d00f386ee9268b87ea56213a8b66e078dfd8b5` | `e6fa83f9f4e8e82b5ed97d0ed576b1aa1fc94f7a128261e2aacef8df582004d2` |
| N22 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_retry_resnapshots_delete_rotation_and_revoked_target | `fed10f4dcf344fa00d5810dec57bbf42d79ca64e6061dc3acad14b6704e85f43` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N23 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_retry_resnapshots_delete_rotation_and_revoked_target | `81f5618db3475f28053b55649b8a8f8c410b4ceb1d7dfb4a7cfd3d87d8ef87c8` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N24 | EQUAL_PREVIOUS_FLOOR_EFFECT_EXPERIMENT / REJECT_SURVIVOR_EQUAL_PREVIOUS_FLOOR_EFFECT | 1/0 → 1/0 → 1/0 | none (survived) | `04364892393b91260db9bf135762b2faa3ae9d56f945b0ee337b12b7e0cb5b53` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N25 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_poison_and_exhaustion_issue_zero_transport_requests | `b906e69e4f75ab1a12d84718c5fab11be57ad204daf1980fe4d056080faa438f` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N26 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_reservation_occurs_inside_inner_for_snapshot_and_launch | `73329e7f34252b7c5a4bb9f21de5fa06573a4b7a4813311d8401ef01b0aea172` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N27 | ACTUAL_TYPED_OWNERSHIP_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_transport_allocates_from_authoritative_map_not_detached_clone | `80674ea78de1ae4998847fe13811d5370c4255ddbdc5e326329ff36e820abfca` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N28 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | actual_launch_floor_rejects_delayed_request_for_absent_native_key | `7092a77aadf537214c742582f6be2b00740d7aebc07f6830eb14234c7fe8eb34` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N29 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | transactional_pending_keeps_owner_on_read_failure_stopped_and_foreign_confirmation | `6cee079814885efa127f4b897fd695c0204ef11eda97fb4064a953bb6efac219` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N30 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | launch_full_retains_and_recomputes_then_admits_once_on_later_tick | `501631596c4d4ddf73a16636cc37d788eb8a11be99a45cdb2a08eb87614f9670` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N31 | ACTUAL_CALLBACK_SELECTION_ORDER_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | launch_key_selections_are_normalized_and_follow_the_inflight_write | `ff88fbc1d471679db47f6dcf470476356169c5f7d1fa7d0c59165af1985b7dfd` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N32 | ACTUAL_CALLBACK_SELECTION_ORDER_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | launch_key_selections_are_normalized_and_follow_the_inflight_write | `5ed4bcbe24b010f6256f13554edb1672ed33654be8175879ad0644b53425fa1b` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N33 | ACTUAL_NATIVE_MODULE_CONTROLLER_BEHAVIOR_WITH_FAKES / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | writer_thread_stops_when_all_coordinators_drop | `13f7fd62ea9c3a140c6e4305f63b49d0486d5b1c9b2b8939026e93e6da7caedc` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N34 | ACTUAL_GENERIC_SENDER_RETRY_BUDGET / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | secret_sync::tests::retry_budget_and_delay_are_bounded_and_cache_locks_are_released | `c4f103ffd42d247770514c884a38075affad9e783b1a7becba7331265f5491c4` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |
| N35 | ACTUAL_NATIVE_CONTROLLER_WITH_FAKE_REVISION_SINK_EFFECT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | authoritative_partial_and_empty_load_remove_effective_credentials | `27acfbcd960f44b637c83e01ce99246b30f99d817256604f2920b20c56a08c16` | `cb1d3bff3b964870757bce1f622070dfa271d65db041e26cbf1fdbbf0f4da363` |
| N24R | ACTUAL_TYPED_FRESH_FLOOR_ALLOCATION_CONTRACT / ACCEPT_BEHAVIOR_RED | 1/0 → 0/1 → 1/0 | vault_coordinator::transport_tests::actual_state_snapshot_and_launch_allocate_after_current_owner | `04364892393b91260db9bf135762b2faa3ae9d56f945b0ee337b12b7e0cb5b53` | `cf2a6b53745ef97d150c7139175a754fbc1a3614eb6871f9c7917a5de6cca380` |

### Limits and unchanged recovery policy

Absent is distinct from a parsed empty Vault. A manual reload classified
NoEntry/Absent can retain an unverified shadow/recovery map, mark the source
Absent, and permit the next save to restore those retained keys. Native and
sidecar remain consistent. Absent means consolidated storage absent, not cache
empty. Original1774 and prior additive behavior already preserved those values.
The approved plan does not settle whether deletion outside the app should
discard recovery values; this repair preserves existing behavior and records
that policy uncertainty. No backup deletion or shadow-vault retirement is done.

A caller can wait15 seconds for readiness, then independently15 seconds for a
mutation. This is not a measured15-second end-to-end limit. Physical Keychain
writes can remain hung on the sole writer; cached readers stay responsive and
queue admission is bounded to eight. Started writes finish in the background;
the renderer watches for up to three minutes. HTTP delivery remains bounded best
effort; exhaustion may need a later push/reload/restart. A target can be revoked
during an already-in-flight request.

No real Keychain, vault, native IPC, provider, signing, installed-app, desktop
release, tag/version or account/security operation was performed. Optional later
human UX/signing checks are not additional Part1 premerge requirements.
Independent review of the complete final diff is required before publication.

## Historical validation (UNATTESTED)

No test touches the Keychain, the security CLI, credentials, a real sidecar
or the installed app. The Rust contract tests drive the writer with a fake
store. The renderer tests use a fake Tauri bridge.

| Suite | Result (Bradley's Mac) |
|---|---|
| `cargo test`: `vault_coordinator_contract` (new) | 19/19 |
| `cargo test`: `main.rs` unit tests (2 new: read classification, vault JSON) | 89/89 |
| `cargo test`: the watchdog, iMessage, sidecar-supervisor and location contracts | 9/9, 44/44, 13/13, 9/9 |
| `test:vault-writer` (new): source checks plus the native wrapper, then the renderer pending test | 9/9, then 4/4 |
| `test:native-responsiveness` | 15/15 |
| `test:secret-boundary` | 13/13, then 15/15 |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate passed: `lint:strict`, `typecheck:all`, `secrets:scan`,
  `docs:check` and `npm run build`.
- The writer contract also ran 30 times in a row with no flaky failure.

## Historical mutation report (UNATTESTED)

Each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green. C mutations ran the Rust contract; S
mutations ran the `vault-writer-boundary`, `secret-boundary` and
`native-responsiveness-boundary` source checks; T mutations ran the renderer
test.

Four things changed during the runs:

- **First run.** A batch was cut off by a shell timeout while C06 was applied.
  The one mutated file was restored by hand and matched its recorded hash
  (`d4f6a9013e1c`) before anything else ran.
- **C04 and C06 deadlocked the whole suite.** Holding the lock across the
  write, and never cancelling a queued save, made the readers or the caller
  wait forever. Both tests now run the blocking call on a thread with a
  deadline, so each mutation fails one named test cleanly.
- **Tests strengthened.**
  - C21 (unbounded queue) survived, because the test filled the queue
    `QUEUE_CAPACITY` times. It now pins 8.
  - T01 (no watch after a failed save) survived, because the test started the
    watch itself. It now waits for the watch the save started.
- **Reruns.** C22's first mutant did not compile, so it was replaced with
  one that does. The gate messages were then reworded to name the real button
  ("Reload keys from Keychain"). Every C and S mutation was rerun against the
  final files and tests.

| # | Mutation | File (sha before) | Red result |
|---|---|---|---|
| C01 | shadow source not gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C02 | unavailable source not gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C03 | absent vault gated | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 3 failing |
| C04 | cache lock held across the Keychain write | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C05 | cancelled save still runs | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C06 | caller never cancels a queued save | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C07 | pending save not counted | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C08 | late outcome not reported | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 2 failing |
| C09 | late success reported as failure | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C10 | merge ignores user edits | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C11 | merge replaces held values | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C12 | stale read refreshes the shadow | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C13 | real vault merged into a shadow cache | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 13 failing |
| C14 | verified session accepts the shadow copy | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C15 | migration overwrites a newer save | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C16 | failed migration still cleans up | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C17 | failed migration allows saves | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C18 | readiness not signalled | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C19 | guard undoes a finished load | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C20 | wait ignores the predicate | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C21 | queue unbounded | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C22 | a panicking job kills the writer | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| C23 | sidecar push before the vault write | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 5 failing |
| C24 | commit does not mark the key touched | `vault_coordinator.rs` (`c6e9e545fd88`) | Rust contract: 1 failing |
| S01 | set_secret bypasses the writer | `main.rs` (`5db7efb2b61a`) | node source checks: 4 failing |
| S02 | read error counted as an empty vault | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S03 | boot load without the failure guard | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S04 | retry reaches the full load path | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S05 | save wait not 15 s | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S06 | write state open to any window | `main.rs` (`5db7efb2b61a`) | node source checks: 2 failing |
| S07 | write state carries a value | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S08 | webviews granted the event permission | `default.json` (`8b783df53a15`) | node source checks: 1 failing |
| S09 | writer start failure leaves the load waiting | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| S10 | readers lock outside the worker | `main.rs` (`5db7efb2b61a`) | node source checks: 1 failing |
| T01 | a failed save starts no watch | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T02 | status reloads before the write lands | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 2 failing |
| T03 | the watch has no deadline | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T04 | concurrent watches | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T05 | other windows are not told | `runtime-config.ts` (`6e4ab717b23b`) | renderer test: 1 failing |
| T06 | a malformed write state is trusted | `keychain.ts` (`17b3510c1bb2`) | renderer test: 1 failing |

The original report claimed all 40 mutations went red; this is not a fresh
October 10 attestation. Preserve the aborted, surviving and noncompiling
experiment dispositions above when reconstructing the proofs.

## Rollback

Revert the bounded integration diff while retaining current main's revisioned
sender and publication fixes. Saves would again hold the secrets lock across an
unbounded Keychain write, readiness would poll, and a save after a Keychain
read error or on a stale shadow copy could again erase keys. No stored data
changes format, so a revert needs no migration.
