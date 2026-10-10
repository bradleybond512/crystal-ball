# R4-SEC-001: Sidecar-only secrets become write-only to webviews

Status: approved by Bradley on September 30, 2026 ("Approve as designed"). Branch
`claude/r4-sec-001-secret-boundary`, stacked on
`claude/r4-bug-004-renderer` (#1759 → #1758) for its confirmed-port routing
and supervisor. Classification: **High Assurance** (secrets, IPC). Queue item
Q10. R4-SEC-006 already shipped in #1759.

## Problem (verified at 031d874f7)

- **Every value is copied into renderer memory.** At boot,
  `loadDesktopSecretsWhenReady` calls `get_secret` for every supported key
  (up to 77). It copies each value into `runtimeConfig.secrets` and into
  `keychainService`'s own cache. Both live for the whole session in the
  `main` window.
- **Native returns any key to any trusted window.** `get_secret`
  (`main.rs:1048`) returns plaintext for any supported key to `main`,
  `settings` and `live-channels`.
- **Only a few values are actually needed.** The renderer uses real values
  only for:
  - the 11 `PLAINTEXT_KEYS` (URLs, usernames, model name);
  - map and tile keys that go into client-side URLs anyway:
    `CESIUM_ION_TOKEN`, `GOOGLE_MAPS_API_KEY`, `MAPBOX_API_KEY`,
    `MAPTILER_API_KEY`, `OWM_API_KEY`;
  - `CRYSTALBALL_API_KEY` (`runtime.ts:501`).

  Everything else (LLM keys, Shodan, VirusTotal, HIBP, ACLED, Patreon,
  S2U, …) is consumed only by the sidecar, which already gets it from Rust.
- **Settings reads values only for presence or to re-send them.**
  - `KeyDashboard` and `SetupWizard` use `getValue(k)` as a presence check.
  - `analytics.ts` counts presence.
  - The only consumer of a *stored* value is "Test", which sends it back to
    the sidecar to verify.
  - `getSecretState` reads the value only to re-check its format.
- **One renderer read is the theft path.** A single script execution in
  `main` (≈271 `innerHTML` sinks, or a compromised dependency) can read every
  key from the heap with no IPC and no trace. `get_secret` is the only
  invoke site (`keychain.ts:67`), so this one choke point carries the fix.

## Design

1. **Native (Rust):**
   - `get_secret` is **removed** from the handler list.
   - **New `get_secret_status()`** returns `{ key, present }` for every
     supported key. It never returns a value.
   - **New `get_renderer_config()`** returns values only for
     `RENDERER_READABLE_KEYS`: the 11 plaintext keys plus the 6 keys above.
     Both commands keep `require_trusted_window`.
   - `set_secret` / `delete_secret` push the change to the running sidecar
     themselves, through the existing guarded injector (it refuses a dead
     child or an unconfirmed port). **A deletion is now pushed as an unset.**
     Today the injector skips deleted keys, so a deleted key stays live in
     the sidecar until restart.
2. **Renderer:**
   - `keychainService.get` and its value cache are removed. It gains
     `status()` and `rendererConfig()`.
   - `runtimeConfig.secrets` holds values **only** for readable keys. Every
     other key is tracked as presence only (`secretPresence`), so
     `getSecretState` reports `present` without a value.
   - Format is still checked when you type a value. A stored value is
     trusted to be well-formed because it was checked when you saved it.
   - On desktop the renderer no longer pushes values to the sidecar
     (`pushSecretToSidecar` is deleted there), because Rust does it. Web
     builds are unchanged.
   - `KeyDashboard`, `SetupWizard` and `analytics` use `isSecretSet(key)`
     instead of values.
3. **"Test" on a stored key** calls `verifyStoredSecretWithApi(key)`. The
   sidecar's `/api/local-validate-secret` accepts
   `{ key, useStored: true }` and validates its own `process.env[key]`,
   with paired credentials such as OpenSky taken from env too. A typed
   value is still sent as it is today.
4. **Drift tests:**
   - The Rust `RENDERER_READABLE_KEYS` must equal TS
     `PLAINTEXT_KEYS ∪ RENDERER_VALUE_KEYS`.
   - No `get_secret` invoke or handler may remain.
   - No renderer code may read `.value` of a key outside the allowlist.

## Accepted residual risk (for you to act on)

- **The six readable keys are exposed by nature.** They end up in
  client-side request URLs, so they stay readable. **Mitigation is
  provider-side**: in each provider console, restrict them by HTTP referrer
  or app bundle ID and set quota caps (Cesium, Google Maps, Mapbox,
  MapTiler, OpenWeatherMap).
- **`CRYSTALBALL_API_KEY`** stays readable for now. Routing it through the
  sidecar is an optional follow-up, and it pairs with Q11
  (R4-SEC-008: removing `crystalball.app`).

## Tests (fakes only — no real Keychain; mutation proof per behavior)

- **Rust unit tests:**
  - `get_secret_status` returns no values;
  - `get_renderer_config` returns exactly the allowlist intersected with
    what is present;
  - the deletion push sends an unset;
  - the handler list has no `get_secret`.
- **TS** (fake Tauri bridge):
  - after boot, `runtimeConfig` and `keychainService` hold **no** value for
    a sidecar-only key, while readable keys hold their values;
  - presence and feature availability are unchanged;
  - desktop `setSecretValue` never fetches the sidecar;
  - "Test" on a stored key sends no value.
- **Sidecar:** `useStored` validates from env; a missing key returns
  "Value is required".
- **Source and drift gates** as above.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.

## October 10 review repair

The original sender retried a copied value. An old set could resume after a
Settings deletion or rotation and overwrite the newer sidecar state. A timed-out
request body could also finish after a newer request, so sender-only serialization
was insufficient. The bounded repair retains persistence-before-sync and the
write-only renderer boundary.

- Reserve an app-lifetime u64 revision while holding the existing cache mutex
  and copying the current optional value. Each of the three bounded attempts
  repeats that snapshot and resolves the confirmed live sidecar target.
- Native requests send `{ key, value, revision }`, with a canonical decimal
  revision string and `null` for deletion. After body reading, the native
  receiver compares per-key highwater before one synchronous environment,
  credential-hook and cache-invalidation transaction. Stale/duplicate requests
  have zero effects; other keys remain independent.
- Sidecar launch reserves its floor while copying the environment under cache
  ownership. Both normal and late confirmed publication reconcile only keys
  changed since launch, including deletion. Other absent keys preserve inherited
  development/build fallbacks. A pre-launch request cannot bypass the new floor.
- Cache failure, revision exhaustion and revoked targets are unavailable, never
  interpreted as absence or a default port. No cache mutex spans HTTP or waits.

Tests exercise the production controller with fake cache/target/transport/delay
seams and the production receiver with a fake synchronous sink. Source gates
guard privileged call sites, both publication paths and bundled helper delivery.
Fresh mutation evidence must distinguish behavioral assertions from source-only
assertions. No real vault, Keychain, provider, native app IPC or desktop operation
is used for validation. No token lifecycle, dependency or persisted schema changes
are introduced; rollback the native/sidecar protocol pair together.
