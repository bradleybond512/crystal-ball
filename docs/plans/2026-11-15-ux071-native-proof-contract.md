# UX-071 remaining native gates — fixed proof contract

Status: exact contract accepted by the Tauri specialist and architect; no
architectural blockers. Implemented under the approved encompassing design;
actual native proof execution awaits hosted CI. Base
`4f3e4731e2822cfccc5aa417fe8a8e4405a4ae38`.

## Owners and limits

The Tauri specialist owns production Rust and embedded Rust tests. The test
engineer owns the fixed driver controls, exact inventory and portable evidence.
Parent owns package/override wiring, docs, commits and publication coordination.
No local Cargo, rustc, native executable, service call, app launch or Keychain
access. No new target/job; preserve all eight targets, 43-minute shared driver
deadline, 45-minute jobs and existing aggregate budget. If additional proof
cannot fit, fail and return for a decision; no skipped controls or wider timeout.

## Exact new Rust tests

All names below are fixed before production implementation. Existing names
remain; module splitting must not silently remove or rename old test cases.

| Fully qualified name | Harness/platform |
| --- | --- |
| `updater_policy::tests::release_asset_wire_shape_is_required_on_every_platform` | binary, Linux/macOS |
| `updater_policy::tests::outcome_and_reason_serialization_preserves_wire_values` | binary, Linux/macOS |
| `native_outcome_tests::native_outcome_serialization_preserves_wire_values` | binary, Linux/macOS |
| `current_location::tests::native_error_serialization_preserves_wire_values` | binary and current_location_contract, Linux/macOS |
| `vault_coordinator::transport_tests::test_accessor_reads_authoritative_state` | binary and vault_coordinator_contract, Linux/macOS |
| `vault_coordinator::transport_tests::coordinator_accessor_preserves_state_identity` | binary and vault_coordinator_contract, Linux/macOS |
| `updater_gate_tests::lock_reopen_preserves_bytes_inode_and_exclusion` | binary, macOS only |

The DTO case must exercise actual production target-OS fields: Linux underscore
fields with Serde renames; macOS normal fields. `cfg(test)` must not switch this
representation. Test missing assets/name/size/download URL, wrong types, null,
duplicate fields, negative/fractional/overflow size, accepted unknown fields,
and an explicit size zero accepted by Deserialize. Missing size must fail at
Deserialize, independently of any later zero-size asset-policy rejection.
Use raw JSON for duplicate keys and numeric overflow.

Serialization cases compare actual `serde_json::to_value` results against
literal expected values, including every preserved variant. `RateLimited`
must be available under `cfg(test)` on both platforms and asserted as
`rate_limited`; testing only Unsupported/Delivered would miss the proposed
rename mutation. Existing updater serialization and location envelope tests
remain unchanged.

Accessor cases operate on real owned state: read missing/current/rotated/deleted
values from the authoritative map; independently use `Arc::ptr_eq` against the
original Arc returned by the coordinator accessor. No dummy reads. Fake store
and owned channels only. The lock test uses a unique owned temporary path,
prewrites bytes, reopens it, verifies unchanged bytes and inode, proves another
nonblocking open cannot acquire while held, then proves acquisition after drop.
No real app/install path or verifier is involved.

Expected inventory additions (not executed results): binary 119→125 Linux,
121→128 macOS; current_location_contract 9→10; vault_coordinator_contract
45→47. Other targets unchanged. Total expected cases 260→269 Linux and
262→272 macOS. These totals must be reconciled against actual hosted `--list`;
never rewrite expectations merely to accept fewer cases.

## Fixed controls and exact expected red sets

Each control alters one fixed source file, compiles the existing selected test
harness, and runs its entire platform-specific inventory without a name filter.
Every case not explicitly listed below must pass. Restore independently between
controls. Expected failures are requirements to be verified by hosted evidence,
not claims of execution.

Existing controls remain unchanged on both platforms:

| ID | Source / harness | Exact expected failing tests |
| --- | --- | --- |
| `watchdog` | tests/watchdog_contract.rs / watchdog_contract | `main_focus_tracks_gain_and_loss` |
| `crypto-nonce-rejection` | src/main.rs / crystalball | `vault_shadow_crypto_tests::malformed_nonce_lengths_are_rejected` |
| `crypto-auth-rejection` | src/main.rs / crystalball | `vault_shadow_crypto_tests::modified_nonce_is_rejected`; `vault_shadow_crypto_tests::modified_tag_is_rejected`; `vault_shadow_crypto_tests::tampered_ciphertext_is_rejected`; `vault_shadow_crypto_tests::wrong_key_fails_authentication` |

New source paths below are relative to `src-tauri/`:

| ID / platforms | Source / harness | Compile-valid mutation | Exact expected failing tests |
| --- | --- | --- | --- |
| `updater-dto-required-fields` / both | src/updater_policy.rs / crystalball | Within ReleaseAsset only, add `#[serde(default)]` to both target-OS `size: u64` and `_size: u64` declarations. Preserve renames and every other field. Active parser now accepts missing size as zero. | `updater_policy::tests::release_asset_wire_shape_is_required_on_every_platform` |
| `updater-serialization` / both | src/updater_policy.rs / crystalball | Change only UpdateOutcome and BrowserReason `rename_all = "snake_case"` to `"camelCase"`; retain camelCase field renaming. | `updater_policy::tests::result_contract_uses_native_versions_and_camel_case_fields`; `updater_policy::tests::outcome_and_reason_serialization_preserves_wire_values` |
| `native-outcome-serialization` / both | src/main.rs / crystalball | Change only NativeOutcome's serde rename_all snake_case→camelCase. | `native_outcome_tests::native_outcome_serialization_preserves_wire_values` |
| `location-error-serialization` / both | src/current_location.rs / current_location_contract | Change only NativeLocationErrorCode's rename_all lowercase→UPPERCASE. | `current_location::tests::native_envelopes_are_exact_and_camel_case`; `current_location::tests::native_error_serialization_preserves_wire_values` |
| `vault-accessor-authority` / both | src/vault_coordinator.rs / crystalball | Within get, change `.get(key).cloned()` to `.get(key).filter(\|_\| false).cloned()`; within state, replace `&self.state` with memory-safe `Box::leak(Box::new(Arc::new(VaultState::new())))`. | `vault_coordinator::transport_tests::test_accessor_reads_authoritative_state`; `vault_coordinator::transport_tests::coordinator_accessor_preserves_state_identity` |
| `updater-lock-nontruncation` / macOS only | src/main.rs / crystalball | Within CrossProcessSwapLock::open_lockfile only, `.truncate(false)`→`.truncate(true)`. | `updater_gate_tests::lock_reopen_preserves_bytes_inode_and_exclusion` |

Thus Linux requires exactly **8 controls** and macOS exactly **9 controls**.
Linux must not contain invented lock-control evidence. The separate serializer
controls keep each mutation/restoration bound to a single source file.

## Driver/aggregate acceptance

- Use fixed platform lists in code, never expected sets supplied by receipts.
- Require green original harness plus complete reviewed list before mutation.
- Match each source marker uniquely inside the named declaration/function;
  record changed-byte hash and applied diff before compiling. No test mutation
  or replacement of the production target with a fixture.
- Keep existing compile cap (5 minutes), full test cap (120 seconds), shared
  deadline and owned per-control temporary directory. No filtered/ignored tests.
- Compile errors, timeouts, spawn/output failures or unexpected failing names
  are failures, not successful mutation proof.
- Restore original bytes in finally, verify matching hash and clean worktree,
  and run a complete restored green harness. Failed restoration stops the loop.
- Aggregate requires exact unique per-platform IDs, source/target, applied diff,
  detected failure, restored state, valid original/mutated/restored hashes,
  original==restored and mutated!=original, exact fixed failing names and full
  red/green counts derived from reviewed inventory. Preserve current receipt
  safeguards; unknown/missing/duplicate or wrong-platform evidence fails.
- Portable tests must prove Linux rejects extra lock evidence and macOS rejects
  missing lock evidence, alongside source/target/hash/count/failure-name guards.
- No broad timing-fixture repair: the known 400 ms child-start flakiness remains
  recorded. Scope any necessary source guards to changed module registration
  and retain their original behavior assertions.

## Completion boundary

Portable tests and applied mutations prove driver/source boundaries only.
Actual Rust cases, all required red/restored-green controls and strict Clippy
must execute on approved disposable hosted runners after separate publication
approval. Record actual names/counts/costs. Do not claim native acceptance from
this contract, source enumeration, Node fixtures or compile success alone.
