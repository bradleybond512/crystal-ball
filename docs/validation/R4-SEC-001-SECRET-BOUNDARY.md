# R4-SEC-001 validation — sidecar-only secrets are write-only to webviews

Original September 30, 2026 report for `claude/r4-sec-001-secret-boundary`.
The September 30 raw mutation artifacts were not recovered during October 10
integration; historical claims below are not independently attested. Fresh
October 10 evidence is recorded separately after the clean implementation freeze.
It is stacked on PR #1759 (`claude/r4-bug-004-renderer`, `031d874f7`), which
is stacked on PR #1758. Approved design:
[plan](../plans/2026-09-30-r4-sec-001-secret-boundary.md).

## Behavior

- **Native (Rust, `main.rs`):**
  - `get_secret` is removed.
  - `get_secret_status` returns `{ key, present }` for every supported key
    and no values.
  - `get_renderer_config` returns values only for `RENDERER_READABLE_KEYS`:
    the 11 plaintext settings plus `CESIUM_ION_TOKEN`,
    `GOOGLE_MAPS_API_KEY`, `MAPBOX_API_KEY`, `MAPTILER_API_KEY`,
    `OWM_API_KEY` and `CRYSTALBALL_API_KEY`.
  - Both commands are trusted-window only.
  - `set_secret` / `delete_secret` push the change to the running sidecar
    **after** the vault write, through `confirmed_sidecar_target`: our child
    must be alive and its port confirmed.
  - **A deletion is sent as an unset.** Every Settings, boot, reload and
    recovery attempt reads the authoritative cache again, reserves a bounded
    monotonic revision while holding its mutex, and resolves a confirmed live
    target again. Cache failure is unavailable, distinct from a deleted key.
  - The native receiver compares decimal-string revisions after reading the
    request body, before one synchronous environment/hook/cache transaction.
    Stale and duplicate requests succeed without effects; native missing or
    malformed revisions fail closed. Non-native development keeps its contract.
  - Native launch copies the environment and reserves a revision floor under
    the same cache mutex. Normal and late confirmed publication reconcile only
    changed keys, including deletion, through the same sender. Other absent
    keys retain intentional inherited development/build fallbacks.
- **Renderer:**
  - `keychainService` has no value reader and no value cache.
  - `loadDesktopSecrets` holds presence for every key and values only for
    allowlisted keys. Any other value native might return is dropped.
  - A reload drops values another window deleted.
  - `setSecretValue` on desktop writes through native and **never fetches
    the sidecar**.
  - `getSecretState` / `isSecretSet` report presence without a value.
- **Settings UI:**
  - `KeyDashboard`, `SetupWizard` and analytics use presence only.
  - A saved secret's placeholder is `••••••`. It used to show the last 3
    characters.
  - **Test** on a saved key calls `verifyStoredSecretWithApi`. Sidecar-only
    keys are checked by the sidecar against its own `process.env` copy
    (`useStored: true`), so no value is sent. Readable keys (map keys, which
    the sidecar does not hold) verify the value this window already has.
- Web builds are unchanged: values live in the web vault there.

## Fresh October 10 validation

Tested implementation/source-test freeze: `d15434085923a2eccb91248e13946df3cc33a162`.
Integrated onto canonical main `87ec49e8d873863686ee274567305f69db0a65c0`.
Any subsequent validation-document commit retains every production and test byte;
the final review package includes the complete tracked checksum comparison.
The original Claude checkout was preserved. All credential values in tests are
synthetic; no real Keychain, native IPC, provider call, desktop installation or
signing/security-setting operation was performed.

| Command | Observed result |
|---|---|
| `npm run test:secret-boundary` | Node 21/0 + renderer 15/0 |
| `npm run test:sidecar-supervisor` | 7/0 |
| `npm run test:settings` | 19/0 |
| `npm run test:analytics-consent` | 14/0 |
| `npm run test:sidecar-routing` | 10/0 + 56/0 |
| `npm run test:sidecar` | 643/0 |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml` | 190/0 across six binaries |
| ESLint on all 17 changed JS/TS files, `--max-warnings=0` | Exit 0 |

The exact full gate command completed with exit 0:

```sh
bash scripts/agentic-validate.sh --tests 'test:secret-boundary test:sidecar-supervisor test:settings test:analytics-consent test:sidecar-routing test:sidecar'
```

The retained output ends with:

```text
Agentic validation gate passed.
Tests run: test:secret-boundary test:sidecar-supervisor test:settings test:analytics-consent test:sidecar-routing test:sidecar
```

The six native result lines are quoted from the retained log:

```text
test result: ok. 97 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.94s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.29s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

The successful run retains native dead-code/deprecation warnings, the docs
changelog advisory, Vite extensionless-import/chunk warnings and plugin timings.
A fake insecure `.env.local` fixture deliberately warns and refuses its input.
These outputs remain in the raw logs; no check was disabled. Resource inspection
confirms that all 26 direct relative sidecar-module imports have existing source
files and explicit resources. The sole Tauri configuration delta is the new
`sidecar/secret-sync.mjs` resource. Cargo manifests, both lockfiles, the native
publication controller and the Sol review-routing files match main exactly.
Web build output was produced; this is not an installed desktop smoke test.

### Fresh mutation reconstruction and concurrency proofs

The audited manifest contains **43 accepted proofs**: 32 behavior, 10 source and one combined source/behavior case.
All 22 historical equivalents were rerun; the 21 new cases cover current-value
retries, mutex-ordered revisions, revoked targets, receiver ordering, listener
floors, launch deletion/rotation, generation ownership and bounded revisions.
Each candidate was applied alone, with an actual diff and file hash, against
the clean freeze. Its baseline passed, its named intended assertions failed,
then all tracked checksums were restored and the same baseline passed.
Compilation failures, interruptions and diagnostic-parser rejections are retained
as rejected attempts and do not count as proof. The earlier 77e freeze runs are
separate evidence and do not count toward these 43 final-source cases.
Final combined source/renderer/receiver/supervisor and two Rust-filter baselines passed 56/0.
Each pure receiver mutation also restores its own 6/0 receiver baseline.

Source assertions prove production wiring, rather than exercising a real
`AppHandle`, native IPC or an owned sidecar process. R6 removes one main guard
while the live-port helper still fails closed; it does not prove actual acceptance
of an unconfirmed port. D1 deliberately renders a synthetic `xyz` suffix to
verify the mask-only UI oracle; it does not reconstruct an inaccessible old
secret reader. The original September 30 counts remain unattested.

| ID | Oracle | Mutant pass/fail | Frozen file hash | Applied diff hash | Observed failing test(s) |
|---|---|---|---|---|---|
| R1 | behavior | 18/1 | `58142177d3b2` | `dbff9c29f08f` | `secret_boundary_tests::status_reports_presence_for_every_key_and_never_a_value` |
| R2 | behavior | 18/1 | `58142177d3b2` | `325bf5c36283` | `secret_boundary_tests::renderer_config_returns_exactly_the_allowlist` |
| R3 | behavior | 18/1 | `58142177d3b2` | `348d405b14a3` | `secret_boundary_tests::renderer_config_returns_exactly_the_allowlist` |
| R4 | source | 13/2 | `58142177d3b2` | `fbcb647661dd` | `Settings writes reach the sidecar from native, after the vault write`<br>`deleting a desktop secret unsets it in the live sidecar environment (native push, R4-SEC-001)` |
| R5 | source | 14/1 | `58142177d3b2` | `b7a3e1fe2ab5` | `Settings writes reach the sidecar from native, after the vault write` |
| R6 | source | 14/1 | `58142177d3b2` | `65ee91caf582` | `Settings writes reach the sidecar from native, after the vault write` |
| R7 | source | 14/1 | `58142177d3b2` | `300debdb273f` | `both new commands are limited to trusted windows` |
| R8 | source | 14/1 | `58142177d3b2` | `198a471f388b` | `native and renderer agree on the readable allowlist` |
| T1 | behavior | 29/1 | `ca690ac4fdd8` | `b61ec61a1540` | `a non-allowlisted value from native is dropped, not held` |
| T2 | behavior | 29/1 | `ca690ac4fdd8` | `c5412ffa1552` | `saving a sidecar-only key keeps presence only and relays nothing` |
| T3 | behavior | 26/4 | `ca690ac4fdd8` | `44c6461f7ee0` | `boot holds presence for every key and values only for readable keys`<br>`a non-allowlisted value from native is dropped, not held`<br>`saving a sidecar-only key keeps presence only and relays nothing`<br>`Test on a saved sidecar-only key sends no value` |
| T4 | behavior | 29/1 | `ca690ac4fdd8` | `d5eddcd3ff59` | `saving a sidecar-only key keeps presence only and relays nothing` |
| T5 | behavior | 29/1 | `ca690ac4fdd8` | `2e147b57e23a` | `a reload after another window deletes a readable key forgets its value` |
| T6 | behavior | 28/2 | `ca690ac4fdd8` | `09c7307600d4` | `Test on a saved sidecar-only key sends no value`<br>`the sidecar can verify a saved key without being sent its value` |
| T7 | behavior | 29/1 | `ca690ac4fdd8` | `c965f6418efc` | `Test on a readable key uses the value this window holds; an unset key sends nothing` |
| T8 | source-and-behavior | 28/2 | `ca690ac4fdd8` | `8b6ee8d10d73` | `saving a sidecar-only key keeps presence only and relays nothing`<br>`Settings key validation only reaches a confirmed sidecar; key sync is native-only` |
| K1 | behavior | 29/1 | `ee087af2813e` | `6be48202abee` | `status() returns presence per key and never asks for a value` |
| K2 | behavior | 29/1 | `ee087af2813e` | `41ffd3e810fc` | `rendererConfig() keeps string values only` |
| D1 | behavior | 29/1 | `c4b745e6c55e` | `a581670f73c5` | `a saved secret shows a mask only; a plaintext setting shows its value` |
| D2 | behavior | 29/1 | `c4b745e6c55e` | `b02520a2764f` | `Test on a saved key verifies the stored copy; a typed value is sent as typed` |
| D3 | behavior | 29/1 | `c4b745e6c55e` | `e67bb125f361` | `Test on an unset key sends nothing` |
| S1 | source | 14/1 | `ac04c6a5ee15` | `6cf20663c207` | `the sidecar can verify a saved key without being sent its value` |
| N01 | behavior | 8/2 | `a623e90d1614` | `050a78e680fe` | `secret_sync::tests::retry_uses_current_delete_and_rotation`<br>`secret_sync::tests::settings_boot_reload_recovery_paused_senders_retry_current_delete_or_rotation` |
| N02 | behavior | 9/1 | `a623e90d1614` | `55669332cd11` | `secret_sync::tests::snapshot_and_launch_revision_order_follows_cache_ownership` |
| N03 | behavior | 2/4 | `cf31cefe6d8e` | `62c493b2ff17` | `old timed-out body released after a new unset cannot restore a credential`<br>`stale and duplicate revisions have zero effects; key ordering is independent`<br>`launch seed floor fences prelaunch bodies even for absent keys`<br>`late boot and reload bodies cannot replace newer Settings rotation` |
| N04 | behavior | 2/4 | `cf31cefe6d8e` | `442c89a40b5b` | `old timed-out body released after a new unset cannot restore a credential`<br>`stale and duplicate revisions have zero effects; key ordering is independent`<br>`launch seed floor fences prelaunch bodies even for absent keys`<br>`late boot and reload bodies cannot replace newer Settings rotation` |
| N05 | behavior | 9/1 | `a623e90d1614` | `0efbda773b78` | `secret_sync::tests::poisoned_cache_is_not_an_unset` |
| N06 | behavior | 8/2 | `a623e90d1614` | `0cd4c3f3199f` | `secret_sync::tests::revoked_target_stops_retry_without_default_fallback`<br>`secret_sync::tests::retry_budget_and_delay_are_bounded_and_cache_locks_are_released` |
| N07 | source | 19/2 | `58142177d3b2` | `d30009e55af8` | `Settings writes reach the sidecar from native, after the vault write`<br>`the renderer is only ever handed a confirmed port` |
| N08 | behavior | 4/2 | `cf31cefe6d8e` | `2c1186a3b6a5` | `launch seed floor fences prelaunch bodies even for absent keys`<br>`native missing, malformed, noncanonical and overflowing revisions have zero effects` |
| N09 | behavior | 8/2 | `a623e90d1614` | `cedbebbb070e` | `secret_sync::tests::launch_delta_includes_deletes_and_new_keys_without_inherited_absent_keys`<br>`secret_sync::tests::normal_and_late_publication_reconcile_launch_delete_once_for_owner` |
| N10 | source | 14/1 | `58142177d3b2` | `fa688b09da82` | `native launch fences all allowed keys and reconciles both confirmation paths through the real sender` |
| N11 | source | 14/1 | `58142177d3b2` | `8e4118c24302` | `native launch fences all allowed keys and reconciles both confirmation paths through the real sender` |
| N12 | behavior | 9/1 | `a623e90d1614` | `d2cfd5d7ee88` | `secret_sync::tests::normal_and_late_publication_reconcile_launch_delete_once_for_owner` |
| N13 | behavior | 9/1 | `a623e90d1614` | `f7602f7156bc` | `secret_sync::tests::normal_and_late_publication_reconcile_launch_delete_once_for_owner` |
| N14 | source | 14/1 | `ac04c6a5ee15` | `f0ca8f8e7520` | `revision receiver is bundled and wraps every existing credential and cache effect` |
| N15 | behavior | 5/1 | `cf31cefe6d8e` | `caed21951a29` | `web and development keep unrevisioned updates and existing value/unset semantics` |
| N16 | behavior | 4/2 | `cf31cefe6d8e` | `8677d3168a6d` | `stale and duplicate revisions have zero effects; key ordering is independent`<br>`launch seed floor fences prelaunch bodies even for absent keys` |
| N17 | behavior | 5/1 | `cf31cefe6d8e` | `366aa678f71d` | `native missing, malformed, noncanonical and overflowing revisions have zero effects` |
| N18 | behavior | 5/1 | `cf31cefe6d8e` | `ca28edf4ffbb` | `native missing, malformed, noncanonical and overflowing revisions have zero effects` |
| N19 | behavior | 5/1 | `cf31cefe6d8e` | `3d7b5a719978` | `native missing, malformed, noncanonical and overflowing revisions have zero effects` |
| N20 | behavior | 9/1 | `a623e90d1614` | `e9c8eec2f729` | `secret_sync::tests::native_clock_survives_listener_restarts_and_exhaustion_fails_closed` |
| N21 | behavior | 9/1 | `a623e90d1614` | `3f67d0cacfee` | `secret_sync::tests::snapshot_and_launch_revision_order_follows_cache_ownership` |

The local review evidence retains full hashes, applied diffs, actual red outputs,
baseline outputs, restoration records and commands. Audit anchors:

- Full gate log SHA-256: `9be9676a6c4a225d304ce25564feed250b512c36487674d78a83543c1dff9380`.
- Native full-suite log SHA-256: `c2abc6a467d528c6e50a8447f39658b3a20d9ccd7fd2095452d9c9361cfab5c6`.
- Audited 43-proof summary SHA-256: `1d34508d81f1dd985ee32b935e550c6b87e0008623bf557e861042f72f56df52`.
- Historical manifest SHA-256: `369d6b247bfb9ff6605f217c37fffb033178c9e5f05b4f9f1a21759c3291db29`.
- New manifest SHA-256: `f63de7d779cd25ac4be74ab5f7d3dd5313dd2332538a8e527c35d4ad165def1c`.

Independent cross-agent conclusions are recorded separately in the SHA-pinned
review verdict and PR evidence; the mutation table is execution evidence, not
a substitute for independent review.

## Residual risk (Bradley action)

- **The six readable keys are exposed by nature** (client-side request
  URLs). Restrict them provider-side:
  - Cesium ion: allowed URLs;
  - Google Maps: HTTP referrer or app restrictions, plus quota;
  - Mapbox: URL restrictions;
  - MapTiler: allowed origins;
  - OpenWeatherMap: usage cap.
- Routing `CRYSTALBALL_API_KEY` through the sidecar is a follow-up that
  pairs with Q11.

## Historical September 30 validation (raw artifacts not recovered)

All tests use fakes. No real Keychain; native IPC and the sidecar are faked.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:secret-boundary` (new: 3 node source/drift suites + 3 tsx behavior suites) | 12/12 + 11/11 |
| `cargo test` (`src-tauri`) | 87/87 unit (4 new) + 9 + 44 + 13 + 9 contract |
| `test:sidecar-supervisor` | 6/6 |
| `test:settings` | 19/19 |
| analytics-consent, unified-settings-keyboard, welcome-flow-sources, ucdp-runtime-boundary | 34/34 |
| api-key-catalog, phishstats-greynoise-wiring | 7/7 |

- `tsc --noEmit` is clean. ESLint is clean on every changed file.
- No new Rust warnings; the 8 `main.rs` warnings are pre-existing.
- Two existing source gates change on purpose, because the renderer push
  is gone:
  - `ucdp-local-boundary` "deleting a desktop secret…" now pins the native
    unset;
  - `sidecar-secret-routing-boundary` now asserts there is no renderer
    `local-env-update` call.
- `keychain.test.mts` was not wired to any script. It is rewritten for the
  new API and now runs under `test:secret-boundary`.

## Historical September 30 mutation claims (not independently attested)

Each mutation was applied alone. Rust behavior mutations ran
`cargo test secret_boundary_tests` plus the node gates. TS mutations ran the
node gates plus the tsx suites. The baseline was 32/0 before and after
(13 node + 15 tsx + 4 cargo). The table records the SHA-256 prefix of the
file before mutating. Every file was restored and its hash re-verified.

| # | Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|---|
| R1 | blank value reported present | `main.rs` (`cd4dd9129c30`) | 16/1 | secret_boundary_tests::status_reports_presence_for_every_key_and_never_a_value |
| R2 | renderer config returns every key | `main.rs` (`cd4dd9129c30`) | 16/1 | secret_boundary_tests::renderer_config_returns_exactly_the_allowlist |
| R3 | blank readable value returned | `main.rs` (`cd4dd9129c30`) | 16/1 | secret_boundary_tests::renderer_config_returns_exactly_the_allowlist |
| R4 | deleted key not pushed | `main.rs` (`cd4dd9129c30`) | 12/1 | Settings writes reach the sidecar from native, after the vault write |
| R5 | set_secret no longer pushes | `main.rs` (`cd4dd9129c30`) | 12/1 | Settings writes reach the sidecar from native, after the vault write |
| R6 | unconfirmed port accepted | `main.rs` (`cd4dd9129c30`) | 12/1 | Settings writes reach the sidecar from native, after the vault write |
| R7 | renderer config open to any window | `main.rs` (`cd4dd9129c30`) | 12/1 | both new commands are limited to trusted windows |
| R8 | native allowlist drifts | `main.rs` (`cd4dd9129c30`) | 12/1 | native and renderer agree on the readable allowlist |
| T1 | boot holds non-allowlisted values | `runtime-config.ts` (`ca690ac4fdd8`) | 27/1 | a non-allowlisted value from native is dropped, not held |
| T2 | save holds a sidecar-only value | `runtime-config.ts` (`ca690ac4fdd8`) | 27/1 | saving a sidecar-only key keeps presence only and relays nothing |
| T3 | presence ignored | `runtime-config.ts` (`ca690ac4fdd8`) | 24/4 | Test on a saved sidecar-only key sends no value; a non-allowlisted value from native is dropped, not held; boot holds presence for every key and values only for readable keys; saving a sidecar-only key keeps presence only and relays nothing |
| T4 | presence kept after delete | `runtime-config.ts` (`ca690ac4fdd8`) | 27/1 | saving a sidecar-only key keeps presence only and relays nothing |
| T5 | stale vault values kept on reload | `runtime-config.ts` (`ca690ac4fdd8`) | 27/1 | a reload after another window deletes a readable key forgets its value |
| T6 | stored test sends a value field | `runtime-config.ts` (`ca690ac4fdd8`) | 26/2 | the sidecar can verify a saved key without being sent its value; Test on a saved sidecar-only key sends no value |
| T7 | unset key reaches the sidecar | `runtime-config.ts` (`ca690ac4fdd8`) | 27/1 | Test on a readable key uses the value this window holds; an unset key sends nothing |
| T8 | renderer relays the value again | `runtime-config.ts` (`ca690ac4fdd8`) | 26/2 | Settings key validation only reaches a confirmed sidecar; key sync is native-only; saving a sidecar-only key keeps presence only and relays nothing |
| K1 | status keeps malformed rows | `keychain.ts` (`ee087af2813e`) | 27/1 | status() returns presence per key and never asks for a value |
| K2 | renderer config keeps non-strings | `keychain.ts` (`ee087af2813e`) | 27/1 | rendererConfig() keeps string values only |
| D1 | dashboard shows a secret suffix | `KeyDashboard.ts` (`c4b745e6c55e`) | 27/1 | a saved secret shows a mask only; a plaintext setting shows its value |
| D2 | saved-key Test sends nothing | `KeyDashboard.ts` (`c4b745e6c55e`) | 27/1 | Test on a saved key verifies the stored copy; a typed value is sent as typed |
| D3 | unset-key Test goes out | `KeyDashboard.ts` (`c4b745e6c55e`) | 27/1 | Test on an unset key sends nothing |
| S1 | sidecar ignores useStored | `local-api-server.mjs` (`7091a36bf31a`) | 12/1 | the sidecar can verify a saved key without being sent its value |

The original report claimed all 22 mutations went red on the first run and
every file was restored. The October 10 repair does not attest those historical
runs; its fresh equivalents retain actual applied diffs, outputs and hashes.

## Rollback

Revert the native sender/launch and sidecar receiver changes together; their
revision protocol is paired. No persisted vault migration is introduced.
Reverting the original write-only boundary also restores `get_secret`.
The original full-boundary rollback was: revert the commit. `get_secret` and the renderer value caches return, and
deletions again stay live in the sidecar until restart. The vault format is
unchanged.
