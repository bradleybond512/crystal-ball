# R3-SEC-003 phase A validation: fail-closed signing and vault diagnostics

Historical report from October 3, 2026 on branch `claude/r3-sec-003-phase-a`, stacked on
`claude/r3-bug-001-slice-b` (#1774). Approved design:
[plan](../plans/2026-10-03-q16-vault-writer-and-signing.md), Part 2 (decision
D: as designed). Phase B, retiring the shadow vault, stays a separate,
high-assurance step (Q16b). It needs Bradley's go-ahead and his own
`npm run backup-keys`.

The October 3 test counts, hashes and mutation results below are historical
and **UNATTESTED for the October 10 integration**. Fresh checks and mutation
proof must be recorded against the integrated source; this report does not
establish current installed-app identity, certificate validity or permissions.

## Behavior

- **Fail closed** (`scripts/desktop-signing.mjs`, used by
  `desktop-package.mjs`):
  - `--require-stable-identity`, or `CRYSTALBALL_REQUIRE_STABLE_IDENTITY=1`,
    makes a failed "Crystal Ball Dev" signature, or a failed verification of
    it, exit non-zero. It never falls back to ad hoc. Required mode also
    rejects the explicit ad-hoc identity `-` (including whitespace trimmed by
    the identity resolver) before signing, verification or a stable-signing log.
  - Interactive builds without the flag behave as before: an ad-hoc fallback
    with a loud warning that now points to the guide.
- **Main-sync:**
  - Every build command runs with `CRYSTALBALL_REQUIRE_STABLE_IDENTITY=1`.
  - Before hashing and installing, it checks the built app with
    `codesign -dv`. An ad-hoc or unknown signature is a *blocked* run with a
    clear message, not a crash, and nothing is installed.
- **Diagnostics** (native `get_vault_diagnostics`, trusted windows only, no
  secret values):
  - how the running app is signed (`stable` with its authority, `adhoc`, or
    `unknown`), from a read-only `codesign -dv` of its own bundle with a 5 s
    caller wait bound, read once per launch. The worker may outlive that
    wait; the cached result prevents repeated probes;
  - this session's vault source;
  - whether saves are paused;
  - a persisted counter of shadow-vault fallbacks
    (`vault-shadow-fallbacks.json` in app data).

  Every fallback is now a WARN log line with its count. Boot logs the
  signing (WARN when it is not stable).
- **System Diagnostic ▸ Self-Test** shows a "Keys & signing" row under the
  local engine status, refreshed every 5 s and escaped. For example: "Keys &
  signing: signed as Crystal Ball Dev · keys from the Keychain". An ad-hoc
  build, the backup copy, or an unreadable Keychain is shown as critical.
- **Manual** (`docs/guides/crystal-ball-dev-signing-identity.md`): how
  Bradley checks for or creates the identity in Keychain Access, with a
  10-year validity, and lets `codesign` use it once. No script or agent
  touches the Keychain.

### Historical installed-app observation (unattested)

The October 3 report stated that a read-only check of the installed app showed
`Authority=Crystal Ball Dev`. That observation has not been repeated or
attested in this integration. It establishes no present certificate expiry,
private-key permission or main-sync installation result. The guide leaves
manual certificate checks and setup to Bradley; none was performed here.

### Changed on purpose

- `tests/desktop-package-signing.test.mjs` now reads the signing code from
  `scripts/desktop-signing.mjs`, where it moved. The assertions are the same.
- `SystemDiagnosticPanel.ts` lost one unused `eslint-disable` directive. CI
  lints every touched file with no warnings allowed.

## Historical validation (unattested)

All tests use fakes: a fake `codesign` runner, a fake invoke, and no
Keychain, certificate or installed-app access.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:signing-phase-a` (new): signing helper, packaging and main-sync checks, diagnostics source checks, then the renderer view | 18/18, then 4/4 |
| `cargo test`: `main.rs` unit tests (3 new: codesign parsing, bundle path, fallback counter) | 92/92 |
| `cargo test`: the vault writer, watchdog, iMessage, sidecar-supervisor and location contracts | 19/19, 9/9, 44/44, 13/13, 9/9 |
| `local-engine-status` (existing renderer suite) | 4/4 |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate passed: `lint:strict`, `typecheck:all`, `secrets:scan`,
  `docs:check` and `npm run build`.

## Historical mutation table (unattested)

Each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green: node checks 18/18, the Rust unit tests 3/3
(`signing_diagnostics_tests`), and the renderer test 4/4.

| # | Mutation | File (sha before) | Red result |
|---|---|---|---|
| P01 | required build still falls back | `desktop-signing.mjs` (`2c31f846a362`) | node checks: 1 failing |
| P02 | main-sync environment variable ignored | `desktop-signing.mjs` (`2c31f846a362`) | node checks: 1 failing |
| P03 | no identity allowed when required | `desktop-signing.mjs` (`2c31f846a362`) | node checks: 1 failing |
| P04 | packaging never requires the identity | `desktop-package.mjs` (`68538da3bc37`) | node checks: 1 failing |
| P05 | packaging continues after a signing stop | `desktop-package.mjs` (`68538da3bc37`) | node checks: 1 failing |
| P06 | main-sync build does not require the identity | `sync-main-to-mac.mjs` (`b74e201ba3ea`) | node checks: 1 failing |
| P07 | install skips the signature check | `sync-main-to-mac.mjs` (`b74e201ba3ea`) | node checks: 1 failing |
| P08 | install accepts an ad hoc app | `sync-main-to-mac.mjs` (`b74e201ba3ea`) | node checks: 1 failing |
| P09 | ad hoc output not recognized | `desktop-signing.mjs` (`2c31f846a362`) | node checks: 2 failing |
| P10 | stable signature not verified | `desktop-signing.mjs` (`2c31f846a362`) | node checks: 2 failing |
| R01 | ad hoc signature not detected | `main.rs` (`60b1ca538bd6`) | Rust unit tests: 1 failing |
| R02 | any path counts as an app bundle | `main.rs` (`60b1ca538bd6`) | Rust unit tests: 1 failing |
| R03 | fallback counter does not count | `main.rs` (`60b1ca538bd6`) | Rust unit tests: 1 failing |
| R04 | shadow fallback not counted | `main.rs` (`60b1ca538bd6`) | node checks: 1 failing |
| R05 | diagnostics open to any window | `main.rs` (`60b1ca538bd6`) | node checks: 1 failing |
| R06 | diagnostics carry a value | `main.rs` (`60b1ca538bd6`) | node checks: 1 failing |
| R07 | codesign check without a timeout | `main.rs` (`60b1ca538bd6`) | node checks: 1 failing |
| R08 | boot does not log the signing | `main.rs` (`60b1ca538bd6`) | node checks: 1 failing |
| D01 | diagnostics row not shown | `SystemDiagnosticPanel.ts` (`4fcd5975daf7`) | node checks: 1 failing |
| D02 | diagnostics row not escaped | `SystemDiagnosticPanel.ts` (`4fcd5975daf7`) | node checks: 1 failing |
| V01 | unknown signing kind accepted | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |
| V02 | ad hoc build not flagged | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |
| V03 | backup copy not flagged | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |
| V04 | a single fallback hidden | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |
| V05 | worst tone ignored | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |
| V06 | native answer not validated | `vault-diagnostics.ts` (`df6123685f41`) | renderer test: 1 failing |

The historical report claimed all 26 mutations went red; that claim is not
fresh execution evidence for this integration.

## Rollback

Revert only the integrated phase-A delta through the normal PR path, preserving
current vault-writer and transport fixes. This removes the extra signing policy,
diagnostics row and fallback counter. The counter file
(`vault-shadow-fallbacks.json`) is harmless if left behind. Reverting only the
sentinel guard reopens the required-build defect, while main-sync's separate
signature check still blocks ad-hoc output before hashing or installation.
