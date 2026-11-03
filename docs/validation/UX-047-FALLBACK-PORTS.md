# UX-047 desktop port collision repair

At implementation commit `2a255738ecc0fcd34635210314f808013de477d4`, national warnings loaded on the next permitted sidecar port when another process owned the usual port. The packaged desktop test acquired 600 warnings, expired one warning and recovered the same user state after relaunch on a different port.

The prior implementation at `8cdf86e12` published an OS-assigned port immediately after a collision. WebKit enforced the packaged policy against all four warning requests to port 53925. Native control and sidecar tests established that authentication and the provider worked on a listed port.

## Design and scope

The sidecar tries the configured port and up to ten consecutive ports, capped at 65535. Only an address-in-use error advances the search. An explicit port of zero requests OS allocation. Invalid port settings and non-collision errors retain their failure semantics. Successful bind still precedes atomic publication of the actual port.

The trusted main desktop HTML and native policies list ports 46123 through 46133 for connections and frames. Only the connection policy includes the two model ports. The tests inspect the production Vite transformations for the main page, auxiliary pages and web build. No persistence migration or dependency was required.

Bradley approved the fixed-range choice on October 1. The policy and bind loop overlap with draft #1769 and should be reconciled together when that branch is integrated. [Recorded design and exhaustion policy](https://github.com/bradleybond512/crystal-ball/blob/bc8d83adfc929975bfc29fd1768f876f07e29247/docs/plans/2026-10-01-r4-sec-008-csp-owned-domains.md)

## Native results

| Scenario | Observed result |
| --- | --- |
| Normal startup during collisions | Port 46123 was externally occupied. An owned listener held 46124. The packaged Node sidecar requested 46123, bound 46125 and atomically published 46125. The Tauri warning panel showed 600 and then 599 after expiry. Seed passed 17 checks. |
| Relaunch after another collision | The first sidecar and renderer exited. A test listener occupied their old sidecar port. The next packaged sidecar published 46126. A new Tauri process recovered the saved bytes, watermark, pin, acknowledgment and snooze during a simulated provider outage. Restart passed 17 checks. |
| All eleven ports occupied | The sidecar logged range exhaustion and published 58672 for native health access. The native HTTP status check returned 200. WebKit rejected the unlisted origin, and the warning panel reported unavailable without creating a watermark or a national all-clear. This expected degraded case passed 12 checks. |

All three port files had mode 0600. The QA Rust host checked the numerical contents against the owned fixture and used the reviewed port/token handlers. The ten test-owned incumbent sockets received zero connections and zero requests carrying authorization. The test observed allocation of the externally occupied canonical port without inspecting traffic on that listener. Both UUID-backed test profiles were deleted, and fixture credentials were removed. The [native receipt](UX-047-FALLBACK-NATIVE.json) includes source and binary hashes, native and HTML policy parity, per-phase assertions and cleanup.

The normal full product bundle was built in scratch space at the implementation commit. The repository packaging wrapper reused the previously verified bundled Node binary, and the bundle passed `codesign --verify --deep --strict`. The actual production desktop HTML and embedded native policy matched the diagnostic policies. The diagnostic Tauri entry replaces ordinary vault, updater and process bootstrap with private fixture state. It exercises actual WebKit, native IPC, shipping renderer modules, packaged Node/sidecar code and a synthetic provider. The test covers distinct processes and changing ports on restart. It does not establish hot rebinding safety for an already-running renderer or exercise installation. An initial test driver placed Node stdout outside its sandbox allowance and exited before testing. The driver logged inside the private fixture for the completed runs.

## Tests and review evidence

Test-first results were 11 pass / 2 fail for the native directives, 2 pass / 5 fail for listener selection, and 14 pass / 1 fail for the desktop HTML transform. The final focused suite added invalid-port and exhaustion checks. All 16 behavioral mutants produced assertion failures and restored the exact committed file hashes and clean Git status. [Mutation diffs, failing output, counts and checksums](UX-047-FALLBACK-MUTATIONS.json)

```sh
E2E_PORT=4198 VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:sidecar-fallback test:secret-boundary test:sec-hardening test:ux047 test:ux047-browser test:port-publication test:sidecar-supervisor test:domain-retirement"
```

The gate ran under Node 22.23.3 with a private Cargo target and canonical macOS temporary directory. It exited 0 with `Agentic validation gate passed.` It ran the production build, application/API typechecks, lint, lockfile, roadmap, docs and secret checks. The secret scan at this implementation checkpoint reported `Secret scan passed for 5761 file(s).`

| Check | Actual output |
| --- | --- |
| Port selection and CSP | `# pass 24` / `# fail 0` |
| Existing UX-047 and Chromium | `# pass 124` / `# fail 0`, `4 passed (21.5s)` |
| Secret boundary | Two groups with `# pass 21` and `# pass 15`, both `# fail 0` |
| Security hardening and supervisor | `# pass 74` and `# pass 12`, both `# fail 0` |
| Port publication | `# pass 2` / `# fail 0`. Inner stages passed 22 and 6 tests. |
| Domain retirement | `# pass 2` / `# fail 0`. Inner stages passed 139, 39, 3 and 248 tests. |
| Full sidecar precommit checks | `# tests 664`, `# pass 664`, `# fail 0` |

The sidecar reviewer independently exercised an owned-socket collision and found no blocking issue in binding or publication. The independent code and evidence reviewer concluded “No blocking findings” for implementation `2a255738ecc0fcd34635210314f808013de477d4` after auditing all 16 mutation proofs and the native receipts.

For a manual recheck, use a private desktop profile, let a separate test listener own the preferred port, start the packaged sidecar at its normal base, then compare the bound socket, private port file and trusted renderer target. Acquire warnings, preserve a user action, occupy the previous sidecar port and relaunch during a provider outage. For rollback, revert the bind-selection and both CSP changes together. Reverting the repair restores the original collision failure.

The implementation commit is `Keep the desktop sidecar reachable when its port is busy`. The draft PR describes how the app selects an available port within its desktop policy after a collision. Packaged native verification covered two different selected ports and the approved native-health-only behavior after range exhaustion.
