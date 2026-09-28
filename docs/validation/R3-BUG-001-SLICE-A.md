# R3-BUG-001 slice A validation

Validated September 27, 2026. This is the approved responsiveness slice only. R3-BUG-001 remains in progress: writer coordination, signaled readiness, bounded completion and late-write convergence belong to separately approved slice B. Nine Round 3 findings remain open or in progress.

## Behavior and architecture

Seven native commands now dispatch blocking work away from the desktop event thread: get_secret, set_secret, delete_secret, read_cache_entry, write_cache_entry, delete_cache_entry and save_brief. This includes lock acquisition, cache JSON parsing and brief filesystem operations. Managed state is resolved inside the worker using an owned application handle. Callers await the existing result; join failures become safe errors, never success. Validation, persistence order, touched-key tracking, size limits, cache scheduling and existing error policies remain.

The watchdog reads native event-owned main-window focus instead of synchronously querying the window from its background thread. A single atomic snapshot contains both focus and transition generation, preserving loss/regain between checks. Setup seeds focus after actual main-window creation. Main focus gain/loss is tracked across platforms; macOS auxiliary-window raising remains. Pure policy retains the 60-second startup grace, 12-second focus grace, heartbeat age strictly greater than 60 seconds, and 120-second reload cooldown.

Files: narrow wrappers/setup/event wiring in `src-tauri/src/main.rs`; new pure `watchdog.rs` and `watchdog_contract.rs`; source/wrapper gate tests; additive npm/test-selector entries; approved plan and evidence. No renderer, dependency, capability, vault policy, iMessage, updater or installation change. [Approved design](../plans/2026-09-27-native-responsiveness-slice-a.md).

## Actual validation

Native commands used a shared Cargo target and synthetic frontend directory. Tests exercised pure policy/atomics or existing isolated native contracts. No real Keychain, Entry call, security CLI, credentials, certificates, native dialog, installed app, installation, backup or restore was performed.

`cargo test --manifest-path src-tauri/Cargo.toml`

```text
test result: ok. 83 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.08s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.27s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`npm run test:native-responsiveness` (12 source checks plus one executable native wrapper)

```text
# pass 13
# fail 0
```

`npm run test:desktop-updater`

```text
# pass 13
# fail 0
# pass 22
# fail 0
```

`npm run test:imessage`, then `npm run test:imessage-native`

```text
# pass 6
# fail 0
# pass 63
# fail 0
# pass 1
# fail 0
```

`npx tsx --test src/services/__tests__/keychain.test.mts`, then `node --test tests/persistent-cache-write-path.test.mjs`

```text
# pass 9
# fail 0
# pass 1
# fail 0
```

`VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:native-responsiveness test:desktop-updater test:imessage test:imessage-native"`

```text
Secret scan passed for 4916 file(s).
Agentic validation gate passed.
Tests run: test:native-responsiveness test:desktop-updater test:imessage test:imessage-native
```

The gate ran all named tests, lint, both TypeScript configurations, secret/document checks and the full web build. Commit hooks also passed typecheck:all, staged secrets and lint. Existing build warnings remain unsuppressed.

`npm run bundle:check`

```text
    main-CgtScAnh.js  raw=1.57 MB  gzip=455.0 KB
✓ All bundle-size policies satisfied.
```

`node scripts/targeted-tests.mjs --list` after the implementation commit

```text
[targeted-tests] 8 changed file(s) → 4 test script(s): test:desktop-updater, test:imessage, test:imessage-native, test:native-responsiveness
```

## Mutation proof

[All 36 proofs](R3-BUG-001-SLICE-A-MUTATIONS.json) retain commands, actual failing assertions, applied diffs, baseline/red counts, original/restored SHA256 and clean-state checks. All source checks and all nine new native tests demonstrated assertion failures. Source tests inspect call-site wiring; their mutants are not claimed as compiled runtime behavior. The native wrapper additionally propagated a real watchdog contract failure. Restored source12/0, each native exact-filtered case1/0, and wrapper1/0 all passed.

The first seven source guards ran0/7 and the expanded initial nine ran0/9 before production changes. Native stubs ran0/9 then9/0. One preliminary source regex mistakenly crossed an earlier macOS CloseRequested match arm; its scope was corrected. The formal focus-cross-platform mutation then proved that adding macOS-only gating to the actual focus arm fails12/0→11/1. No failed parser/compile attempt counts as mutation evidence.

| Mutation | File | Baseline pass/fail | Mutated pass/fail |
|---|---|---|---|
| get_secret-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| get_secret-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| set_secret-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| set_secret-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| delete_secret-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| delete_secret-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| read_cache_entry-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| read_cache_entry-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| write_cache_entry-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| write_cache_entry-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| delete_cache_entry-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| delete_cache_entry-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| save_brief-async | src-tauri/src/main.rs | 12/0 | 11/1 |
| save_brief-blocking-worker | src-tauri/src/main.rs | 12/0 | 11/1 |
| watchdog-no-background-focus | src-tauri/src/main.rs | 12/0 | 11/1 |
| focus-both-states | src-tauri/src/main.rs | 12/0 | 11/1 |
| focus-cross-platform | src-tauri/src/main.rs | 12/0 | 11/1 |
| focus-event-wiring | src-tauri/src/main.rs | 12/0 | 11/1 |
| watchdog-snapshot | src-tauri/src/main.rs | 12/0 | 11/1 |
| watchdog-policy-tick | src-tauri/src/main.rs | 12/0 | 11/1 |
| watchdog-reload-record | src-tauri/src/main.rs | 12/0 | 11/1 |
| focus-initial-seed | src-tauri/src/main.rs | 12/0 | 11/1 |
| focus-gain-loss | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| main-window-authority | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| duplicate-events | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| boot-grace | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| focus-grace | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| heartbeat-threshold | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| unfocused-exemption | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| rapid-transition-generation | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| reload-cooldown | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| cooldown-survives-focus-change | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| rapid-transition-policy | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| record-reload-time | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| boot-grace-removal | src-tauri/src/watchdog.rs | 1/0 | 0/1 |
| wrapper-propagates-focus-regression | src-tauri/src/watchdog.rs | 1/0 | 0/1 |

## Reviews

Independent reviewer concluded: “No blocking findings for approved Slice A” at `457198c597d7480ac6133d8a5765fc93a1497776`, after auditing the complete production diff and all 36 applied mutation proofs. No repair cycle was required. Its evidence limit is explicit: “Source guards establish wrapper placement, not measured Keychain responsiveness.” The exact-tip Claude conclusion must be recorded verbatim in the verdict-only commit before closeout.

## Evidence boundaries and remaining work

Source guards prove thin-wrapper and focus call-site wiring; native compilation checks lifetimes and awaited result types. Pure watchdog tests execute real policy using synthetic times/atomics. These are not a measurement of real Keychain latency, native event delivery, packaged-app responsiveness or a simulated real secret-write transaction. A fake test of the unchanged Tauri executor alone would pass even if a production wrapper regressed, so it was not presented as regression evidence.

Secret operations may still wait indefinitely on workers and retain the existing secrets mutex. Safe writer serialization, migration/recovery coordination, readiness signaling, pending outcomes and renderer/sidecar late completion remain slice B. No detached write timeout was added: that could allow an old physical write to overwrite a newer one. Sidecar injection may still block an async worker. Startup/shutdown disk work, existing brief permission-error suppression and shadow-vault policy are unchanged.

The watchdog no longer blocks on a focus query, but window reload cannot guarantee recovery of a genuinely wedged native event thread. Real application/manual acceptance remains unperformed. No provider change or live response claim applies.

## Manual acceptance and rollback

In a separately chosen user test session, check settings reads/writes, brief export, focus loss/regain and settings-window behavior. Verify ordinary work remains responsive during a deliberately slow operation using a test adapter; real credential actions remain user-owned. Do not inject real secrets or use a production vault to simulate failure.

No data migration is introduced. A revert restores former blocking risk; prefer a reviewed forward fix. Do not add a naive detached write timeout as a rollback workaround.
