# R3-SEC-002 iMessage authorization validation

Validated September 27, 2026. This report covers the bounded native iMessage authorization repair. Nine other Round 3 findings remain open after this repair. No installed application was changed and no real message was sent.

## User-visible behavior and architecture

Saving or enabling a recipient requires an explicit native confirmation showing the exact recipient and whether sending will be enabled. Editing a draft does not authorize delivery. Test uses only the confirmed saved recipient and stays unavailable while changes are unsaved. Turning the feature off immediately revokes current-process authority and invalidates pending confirmations. Existing sends that already started may finish.

Rust owns a strict, bounded, private `imessage.json` under its resolved application configuration directory. The renderer passes only a body to send. Native state, an authorization lock, a separate prompt lock, revisions and in-process generations constrain confirmation/save/send races across windows and app instances. Missing config is disabled; old local preferences can only propose a draft. A durable migration marker prevents repeated import after canceled consent. Corrupt or insecure storage never authorizes delivery. Failed writes do not authorize a new recipient. Failed disable persistence blocks the current process and warns that previous settings may return after restart.

The fixed native dialog and Messages adapters use bounded child waits on a blocking worker rather than the main thread. The existing body limit, sanitation and per-process 30-second send quota remain. Threshold, Ghost Mode and emergency Tier 5 routing policies remain; every caller now passes only the body, and emergency escalation also requires native enablement/readiness. There is no automatic retry after uncertain delivery.

Native files: `src-tauri/src/imessage.rs`, narrow wrappers/registration in `src-tauri/src/main.rs`, and `src-tauri/tests/imessage_contract.rs`. Renderer files: `imessage-bridge.ts`, `UnifiedSettings.ts`, `desktop-notifications.ts`, and the seismic/extended notification callers. Focused tests and additive test-selection mappings wire both source and executable native checks into CI. No dependency, permission or capability was added. Approved design: [native iMessage authorization](../plans/2026-09-27-native-imessage-authorization.md).

## Actual validation

Commands ran with Node 22 and a shared Cargo target. Cargo used a synthetic empty frontend directory and temporary test configuration; no real native dialog, Messages, Keychain, credentials or installed application was accessed. Excerpts below are actual command output.

`npm run test:imessage`

```text
# pass 6
# fail 0
# pass 63
# fail 0
```

`npm run test:imessage-native`

```text
# pass 1
# fail 0
```

`cargo test --manifest-path src-tauri/Cargo.toml`

```text
test result: ok. 83 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.96s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.28s
```

The full native run preceded the final test-only bounded-barrier/symlink-fixture refinements. The final 44-test contract was rerun through the native wrapper and gate after those refinements.

`npm run test:seismic`, then `npm run test:notifications`, then `npm run test:sidecar`

```text
# pass 378
# fail 0
# pass 227
# fail 0
# pass 643
# fail 0
```

`VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:imessage test:imessage-native test:seismic test:notifications"`

```text
Secret scan passed for 4908 file(s).
Agentic validation gate passed.
Tests run: test:imessage test:imessage-native test:seismic test:notifications
```

The gate ran both TypeScript configurations, lint, secret scanning, document checks and the full web build. Commit hooks also ran types, lint and staged secret scanning. Existing build warnings about mixed static/dynamic imports remain unsuppressed.

`npm run bundle:check`

```text
    main-BYs7_njS.js  raw=1.57 MB  gzip=455.0 KB
✓ All bundle-size policies satisfied.
```

`npm run test:renderer`

```text
# tests 15149
# suites 1110
# pass 15149
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Mutation proofs

[All 91 proofs](R3-SEC-002-IMESSAGE-MUTATIONS.json) retain the actual command, applied diff, failed assertions, pass/fail counts, original/restored SHA256 and clean-state checks. Source guards have 10 mutations (6 pass / 0 fail → 5 pass / 1 fail); renderer tests have 33 (63/0 → 60/3, 61/2 or 62/1); native has 47 exact-filtered mutations (1/0 → 0/1) covering all 44 new native test names. One additional mutation removes the native enabled guard through the Node wrapper (1/0 → 0/1), proving the required gate propagates a real Rust assertion failure. All restored suites passed. No mutation survived, timed out, or relied on a compile failure.

Native behavior was first observed red at 0 pass / 10 fail, then green at 10/0 before expansion. Initial renderer TDD was 34/10. An initial source-test attempt had a regular-expression SyntaxError and is explicitly excluded; the corrected source guard ran against the pristine base with 0/6 actual assertion failures, then 6/0 against the fix. Formal clean-tree mutation proofs supersede preliminary evidence.

| Mutation | File | Baseline pass/fail | Mutated pass/fail |
|---|---|---|---|
| send-has-no-destination | src-tauri/src/main.rs | 6/0 | 5/1 |
| configuration-has-no-approval-flag | src-tauri/src/main.rs | 6/0 | 5/1 |
| get_imessage_settings-trusted-window | src-tauri/src/main.rs | 6/0 | 5/1 |
| get_imessage_settings-off-thread | src-tauri/src/main.rs | 6/0 | 5/1 |
| configure_imessage-trusted-window | src-tauri/src/main.rs | 6/0 | 5/1 |
| configure_imessage-off-thread | src-tauri/src/main.rs | 6/0 | 5/1 |
| disable_imessage-trusted-window | src-tauri/src/main.rs | 6/0 | 5/1 |
| disable_imessage-off-thread | src-tauri/src/main.rs | 6/0 | 5/1 |
| send_imessage-trusted-window | src-tauri/src/main.rs | 6/0 | 5/1 |
| send_imessage-off-thread | src-tauri/src/main.rs | 6/0 | 5/1 |
| renderer-legacy-authority | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-body-only | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-hydration-fail-closed | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-state-schema | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-migration-gate | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-migration-cleanup | src/services/imessage-bridge.ts | 63/0 | 61/2 |
| renderer-generation | src/services/imessage-bridge.ts | 63/0 | 61/2 |
| renderer-immediate-disable | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-canceled-refresh | src/services/imessage-bridge.ts | 63/0 | 61/2 |
| renderer-safe-errors | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-revocation-cache | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-body-empty | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-exact-proposal | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| settings-loading-test | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-draft-input | src/components/UnifiedSettings.ts | 63/0 | 60/3 |
| settings-test-body | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-immediate-off | src/components/UnifiedSettings.ts | 63/0 | 61/2 |
| settings-late-result | src/components/UnifiedSettings.ts | 63/0 | 61/2 |
| settings-cancel-draft | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-failed-hydration | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-disabled-save | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-legacy-draft | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| settings-draft-test-guard | src/components/UnifiedSettings.ts | 63/0 | 62/1 |
| desktop-startup | src/app/desktop-notifications.ts | 63/0 | 61/2 |
| desktop-threshold | src/app/desktop-notifications.ts | 63/0 | 62/1 |
| desktop-hydration | src/app/desktop-notifications.ts | 63/0 | 62/1 |
| eew-native-enabled | src/services/seismic/eew-imessage.ts | 63/0 | 62/1 |
| eew-native-ready | src/services/seismic/eew-imessage.ts | 63/0 | 62/1 |
| eew-body-only | src/services/seismic/eew-imessage.ts | 63/0 | 62/1 |
| eew-revocation | src/services/seismic/eew-imessage.ts | 63/0 | 62/1 |
| extended-body-only | src/services/notifications/imessage-bridge-extended.ts | 63/0 | 62/1 |
| renderer-configure-persistence-copy | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| renderer-disable-persistence-copy | src/services/imessage-bridge.ts | 63/0 | 62/1 |
| recipient-nonzero | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| missing-migration | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| enabled-guard | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| native-destination | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| canceled-migration-marker | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| final-config-persistence | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| marker-write-error | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| disable-process-block | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| corrupt-confirmation | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| unchanged-config-no-prompt | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| proposal-validation | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| exact-disabled-proposal | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| final-config-write-error | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| dialog-error | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| canceled-corrupt-repair | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| body-size | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| body-empty | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| failure-send-quota | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| read-error-no-migration | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| marker-before-dialog | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| prompt-cooldown | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| disable-durable | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| revision-overflow | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| stale-consent | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| local-consent-generation | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| cross-instance-revision | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| prompt-singleflight | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| wait-lock-release | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| spawn-under-lock | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| private-mode | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| strict-schema | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| bounded-config | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| private-existing-mode | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| symlink-persistence | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| nonregular-config | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| hardlink-config | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| cross-process-lock | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| symlink-lock | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| exact-consent-result | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| process-deadline | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| process-poll-error | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| completed-process-result | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| partial-write-cleanup | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| rename-failure-cleanup | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| atomic-replacement | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| quota-after-success | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| terminate-on-timeout | src-tauri/src/imessage.rs | 1/0 | 0/1 |
| wrapper-propagates-native-enabled-refusal | src-tauri/src/imessage.rs | 1/0 | 0/1 |

## Reviews

Independent reviewer inspected immutable implementation `8b4a9520376e2f308f1ab1e42fd321737bec530f` and all 91 actual mutation proofs, with no blocking findings and no repair cycle. Its concluding output: “All new tests have demonstrated assertion failures; restored checksums match the immutable snapshot.” Real delivery/native interaction remains unverified. The subsequent exact-tip Claude conclusion must be recorded verbatim in the verdict-only commit; this report does not pre-claim that approval. Required CI must pass before auto-merge.

## Manual acceptance and limitations

Native adapters were compiled; filesystem tests used temporary synthetic files, and child/dialog tests used fakes. Actual macOS confirmation, TCC and Messages delivery remain unperformed manual acceptance. When Bradley chooses to verify on a test installation, check canceled and approved exact-recipient confirmation, disabling while confirmation is open, saved-versus-draft Test behavior, restart persistence, and a single explicitly intended message to a user-controlled recipient. Do not treat automated fixture results as actual delivery evidence.

A compromised renderer can still request messages to an already approved enabled destination subject to the native quota. Same-user arbitrary filesystem writers are outside the private-file protection boundary. The quota is per process. A failed disable write blocks this process but cannot promise persistence across restart or change another process's unchanged file; the UI reports that failure. An already-spawned send may finish after disable. No external provider was added or modified, so there is no live provider response claim.

Rollback should disable iMessage delivery or apply a reviewed forward repair. Do not reinstate recipient-bearing send IPC or renderer/localStorage authority. The config migration is opt-in, and no automatic legacy import is needed for rollback.
