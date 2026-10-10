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

Clean implementation freeze, mutation reconstruction, final gate and independent
reviews are pending. This section will receive actual outcomes before publication.

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
