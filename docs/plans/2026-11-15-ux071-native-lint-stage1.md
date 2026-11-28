# UX-071 — approved first native lint repair

Status: first bounded design and local implementation approved November 15.
Claim: existing [draft #1904](https://github.com/bradleybond512/crystal-ball/pull/1904).
Base: canonical main `92ff943df`; reviewed CI candidate `b27fe912e`.

## Objective and evidence

Repair the diagnosed equivalent-syntax and deprecated nonce API findings
without changing native policy, stored data or strict validation. Hosted run
43684688417 emitted 105 Linux Clippy diagnostics, including repeats; this
stage addresses the 15 mechanical/type-complexity findings and two deprecated
calls. Remaining platform/dead-code work requires a separate design.

This is high-assurance work because authenticated vault decryption is in
scope. Preserve AES-256-GCM, fresh random 12-byte nonces, the version-2
`{v,n,c}` envelope, ciphertext/tag bytes, key derivation and existing failure
returns. No dependency, lockfile, schema, IPC or permission changes.

## Bounded tasks and owners

1. Tauri/security specialist owns only `src-tauri/src/main.rs`,
   `src-tauri/src/imessage.rs`, `src-tauri/src/secret_sync.rs` and
   `src-tauri/tests/vault_coordinator_contract.rs`: diagnosed mechanical
   replacements, supported fixed-array nonce conversion, and four additional
   pure crypto tests. Retain existing tests and assertions.
2. Test engineer owns portable crypto boundaries, exact inventory additions
   and the necessary hosted mutation controls. Preserve the captured historical
   Linux lists; distinguish the four newly approved cases from captured output.
3. Parent owns registration, roadmap/evidence, validation, integration and
   publication. Independent Sol and actual Sonnet review the completed diff.

Native crypto tests cover malformed nonce lengths, altered nonce/tag and a
fixed existing-format ciphertext fixture. Use synthetic data only. Roundtrip
alone does not prove compatibility; malformed-length testing must independently
detect forbidden defaulting/padding even when authentication also rejects data.

## Hosted proof contract

Extend the existing mutation stage with exactly three required controls:
watchdog, nonce rejection and authentication rejection. Each binds a fixed
source, target and expected failure-name set. Record the inspected applied
diff, original/mutated/restored hashes, red counts and complete restored green
counts. The aggregate must reject missing, duplicate or incomplete controls.
Compilation failure, timeout, spawn/output failure and unexpected failed tests
are not a successful mutation proof. Restore and verify source even if the
red oracle throws.

Run each crypto mutation through the full platform-specific binary harness,
with no test filtering. Keep eight targets, strict Clippy, locked dependencies,
the 43-minute driver deadline and 45-minute platform jobs. No new schedule,
job or budget. Actual Rust execution remains disposable-hosted-only.

## Validation and limits

Locally run the portable driver/workflow/crypto boundary suites, safe iMessage
and secret-boundary scripts, relevant direct source-boundary tests, type checks,
secret scanning and the named full validation gate. Inspect wrappers first:
desktop updater and several native aliases invoke Rust and are not local
validation for this task. No local Cargo/rustc, app launch, real Keychain,
native permission request or installation.

Prove portable guards with applied mutations and restored checksums. Actual
crypto execution and red/green Rust proof remain pending until separately
approved publication and hosted execution. Keep all known Clippy failures
visible; no allowances, warning baselines, target removals or weakened checks.

Platform scoping, updater DTO boundaries and orphaned helpers remain outside
this approval. In particular, Linux deserialization of updater fields must not
be weakened merely because those fields are consumed only by macOS.

Rollback reverts the repair commits through review while retaining the strict
gate. No migration is needed. UX-071 remains open until both platforms pass
all native acceptance. Merging, auto-merge, releases, deployment and application
installation remain paused; code publication requires separate approval.
