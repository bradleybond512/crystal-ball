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

## October 10 executed integration evidence

Fresh proof source: `6a1c0c0632127c4ee65d68669e9f636d52ad8df7`, tree `e87466335e93fbc43f35df4d2a2a5337aa220f65`,
on main `898d957a34fae8154556844d2b9e29b5b26e62dd` after #1774.
Only the original own 16-file Phase A delta was integrated additively, with the
confirmed required-signing sentinel fix. Current `SecretsCache` remains the
struct with `state`, `writer` and `revisions`. Original native changed lines
match the original own delta; current vault writer, transport ownership,
revisions/floors, tombstones, launch retry and renderer pending logic remain.
Current package scripts and targeted-test routes were preserved, including
native notification tests and the actual JS secret receiver regression.

The new successful-fake-signer regression ran before the guard and actually
reported `7 pass / 4 fail`; afterward it reported `11 pass / 0 fail`. It checks
flag/environment required mode independently and the hyphen identity both
without padding and with two spaces on each side,
with zero signing/verification callbacks and no stable-success log on rejection.
The separate clean frozen N01 removal proof is `11/0 → 7/4 → 11/0`.
Main-sync's separate guard rejects ad hoc output before hash/install; this
helper finding did not establish an actual unsafe installation.

Actual selected regression script results at this source (counts overlap):

| Script | Actual result |
|---|---|
| `test:signing-phase-a` | 22 pass / 0 fail, then 4 pass / 0 fail |
| `test:vault-writer` | 9 pass / 0 fail, then 4 pass / 0 fail |
| `test:native-responsiveness` | 15 pass / 0 fail |
| `test:secret-boundary` | 21 pass / 0 fail, then 15 pass / 0 fail |
| `test:sidecar-supervisor` | 9 pass / 0 fail |
| `test:sidecar-routing` | 10 pass / 0 fail, then 56 pass / 0 fail |
| `test:native-notify` | 5 pass / 0 fail, then 75 pass / 0 fail |
| `test:desktop-updater` | 13 pass / 0 fail, then 22 pass / 0 fail |
| `test:imessage` | 6 pass / 0 fail, then 108 pass / 0 fail |
| `test:imessage-native` | 1 pass / 0 fail |

Full offline native test harnesses reported `245 pass / 0 fail`: main units
107/0, watchdog 9/0, iMessage 44/0, sidecar supervisor 24/0, location 9/0,
vault coordinator 45/0 and notification policy 7/0. These ran on Darwin,
with pure/fake effects and temporary filesystem contracts; they do not attest
Linux, actual codesign, Keychain, native IPC, GUI startup or installation.
The new pure signing diagnostics filter separately ran 3/0. Nine changed JS/TS
files passed ESLint with `--max-warnings 0`; the `.mts` fixtures also passed
the full TypeScript checks. Existing native warnings were retained.

Fresh mutations reconstruct all 26 historical obligations and add N01:
27 actually applied variants, 27 accepted named assertion reds, 31 case
attempts including four rejected before-edit preparation/anchor attempts.
There are 17 behavior proofs and 10 source contracts. Source-only mutants
were never compiled or operationally invoked; no source check is represented
as native IPC, CLI signing/install, persistence or UI integration execution.
No applied survivor or compile/syntax failure was accepted. The four rejected
attempts (P05 no-match, D02 ambiguous anchor, V01 IPC baseline, R01 missing
ignored XMPP resource baseline) remain preserved separately.

| Proof | Oracle | Baseline → red → restored (pass/fail) |
|---|---|---|
| D01 | source contract | 6/0 → 5/1 → 6/0 |
| D02 | source contract | 6/0 → 5/1 → 6/0 |
| N01 | fake helper | 11/0 → 7/4 → 11/0 |
| P01 | fake helper | 11/0 → 10/1 → 11/0 |
| P02 | fake helper | 11/0 → 8/3 → 11/0 |
| P03 | fake helper | 11/0 → 10/1 → 11/0 |
| P04 | source contract | 11/0 → 10/1 → 11/0 |
| P05 | source contract | 11/0 → 10/1 → 11/0 |
| P06 | fake helper | 3/0 → 2/1 → 3/0 |
| P07 | source contract | 3/0 → 2/1 → 3/0 |
| P08 | fake helper | 3/0 → 2/1 → 3/0 |
| P09 | fake helper | 11/0 → 10/1 → 11/0 |
| P10 | fake helper | 11/0 → 9/2 → 11/0 |
| R01 | pure Rust | 3/0 → 2/1 → 3/0 |
| R02 | pure Rust | 3/0 → 2/1 → 3/0 |
| R03 | pure Rust | 3/0 → 2/1 → 3/0 |
| R04 | source contract | 6/0 → 5/1 → 6/0 |
| R05 | source contract | 6/0 → 5/1 → 6/0 |
| R06 | source contract | 6/0 → 5/1 → 6/0 |
| R07 | source contract | 6/0 → 5/1 → 6/0 |
| R08 | source contract | 6/0 → 5/1 → 6/0 |
| V01 | pure/injected TS | 4/0 → 3/1 → 4/0 |
| V02 | pure/injected TS | 4/0 → 3/1 → 4/0 |
| V03 | pure/injected TS | 4/0 → 3/1 → 4/0 |
| V04 | pure/injected TS | 4/0 → 3/1 → 4/0 |
| V05 | pure/injected TS | 4/0 → 3/1 → 4/0 |
| V06 | pure/injected TS | 4/0 → 3/1 → 4/0 |

Every accepted record includes the nonempty applied diff, before/mutant/
restored SHA-256, exact command, raw logs, failing names and full tracked
manifests. All 5,019 tracked file hashes were restored in the separate QA
clone. Independent root inspection checked 379 indexed artifact hashes,
81 unique baseline/red/restored logs and all 5,019 hashes in both clones.
Final restored QA ran phase A 22/0 then 4/0, pure Rust 3/0, preservation
source checks 27/0, pending/local-engine renderer checks 8/0 and
`typecheck:all` exit 0. All owned commands were waited/reaped; sandbox-blocked
global process inspection is not a claim that other Mac work stopped.

Private bundle: `approved-batch/pr1775/oct10-repair/mutation-evidence/`
`freeze-6a1c0c0632127c4ee65d68669e9f636d52ad8df7/`. Immutable SHA-256:

- `final-summary.json`: `ab2d00216d733fd6aef1793cbd3a2cbc5f1f88b898985b7d77ec97a7cdff8079`
- `artifact-index.json`: `390be7688c292e60b5201fd2bdb02d7dba856f499ecf657edfc812ddacde62b4`
- `final-handoff.json`: `73e321347e7f39693bc1ec975f51cb6b72e6ebfec52ca947cae7c6222e16d68f`

The final review freeze changes only this validation report and its security
tracker status relative to the proof. The completion record binds every other
tracked byte to the proof. Before publication that exact freeze must pass:

```bash
bash scripts/agentic-validate.sh --tests "test:signing-phase-a test:vault-writer test:native-responsiveness test:secret-boundary test:sidecar-supervisor test:sidecar-routing test:native-notify test:desktop-updater test:imessage test:imessage-native"
```

Its actual SHA-bound gate result, independent Sol medium conclusion,
authorized focused Sonnet medium output, verdict, exact-lease publication and
required CI are separate retained completion evidence. No gate, review or
delivery pass is inferred from the command above. Sonnet is capped at three
passes; no Opus. Launch configuration is not signed runtime model attestation.

The first local commit lacked clone hook configuration; it remains preserved.
After setting only this isolated clone's `core.hooksPath=.husky`, the code
freeze was repeated with actual staged secret scanning, lint/type checks and
lint-staged. The source tree was identical. No hook was bypassed and no global
default changed; the initial metadata assumption was corrected with raw logs.

Limits: the signing probe bounds caller wait, not OS child lifetime; fallback
metadata is best effort, not atomic audit accounting. No actual signing,
certificate expiry/private-key ACL, installed identity, Keychain, metadata
persistence adapter, main-sync, desktop build/install/release, tag/version or
vault retirement operation was performed. Manual certificate setup/checks
remain operational prerequisites when needed, without a new premerge gate.
Phase B and Bradley's backup/retirement approval remain separate.

Rollback only this own Phase A delta through the normal PR path, preserving
the #1774 base. A sentinel-only rollback would reopen required-helper success
for `-`, while the separate main-sync guard would still block its ad hoc app.
Counter metadata can remain harmlessly in place; no cleanup was performed.

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
  10-year validity, and lets `codesign` use it once. Certificate setup stays manual; no certificate or Keychain changes were
  performed in this batch.

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
