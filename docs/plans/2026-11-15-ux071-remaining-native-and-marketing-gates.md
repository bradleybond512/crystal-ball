# UX-071 — remaining native lint and marketing audit repair

Status: approved November 15 for local implementation and isolated dependency
testing. Continue existing
draft #1904 from published `4f3e4731e`; local branch
`codex/ux071-final-gates-nov15`. Code publication remains separately gated.

## Objective and baseline

Make the existing strict Linux/macOS native checks and six-lock security audit
pass without weakening validation. Hosted run 43806526270 passed all eight
native targets (260 Linux / 262 macOS) and all three mutation controls, but
Clippy reported 89 Linux and 11 macOS diagnostic instances. The current
six-lock audit reproduced one critical marketing finding; every other lock
has zero high/critical findings. Moderate findings remain outside this repair.

## Native changes

1. `src-tauri/src/main.rs`: scope platform-specific imports, notification/voice
   state, iMessage singleton and asset client to their actual consumers. Keep
   common command authorization and unsupported-platform responses. Remove the
   three uncalled username helpers and uncalled live-channels opener. Preserve
   the navigation predicate as test support and retain its five security tests.
   Make the persistent updater lock's existing non-truncation policy explicit
   with `.truncate(false)`.
2. `current_location.rs` and new `current_location_native.rs`: separate pure
   controller/DTO logic from the Tauri entrypoints and Objective-C adapter.
   Register the same commands through the adapter; integration tests include
   the pure module. Preserve the nine existing contract cases, main-window
   authorization, click-initiated acquisition, deadlines and cleanup. Preserve
   extern/callback and concrete Objective-C signatures, selector/ivar/type-
   encoding bytes, pointer ownership and main-thread dispatch exactly; no FFI
   redesign.
3. `imessage.rs`: scope native process imports/structs/launch adapters to macOS;
   retain pure timeout/consent logic for macOS and tests. Preserve unavailable
   responses elsewhere. Scope notification-policy inclusion at its real use
   sites; do not remove its contract tests.
4. `updater_policy.rs`: separate platform-specific staging, signing and download
   policy from common release parsing/version/body-limit/channel checks. Scope
   output-only variants by actual production use, with real serialization tests.
5. `vault_coordinator.rs`: make integration-only accessors test support. If
   binary test compilation retains them, add genuine authoritative-state/Arc
   identity contract assertions, not dummy reads. In the vault contract test,
   replace `filter(...).next_back()` with equivalent `rfind(...)`.

### Required updater wire-format invariant

Linux must still reject malformed release assets before browser fallback.
Use explicitly named validation-only private fields on non-macOS: `_assets`,
`_name`, `_size`, `_browser_download_url`, each with an explicit Serde rename
to the existing wire name and unchanged required `Vec`, `String`, or `u64` type.
Choose fields by target OS only, never by `cfg(test)`, so Linux tests exercise
the production Linux parser. Narrow real accessors may support shared policy
tests. Preserve missing, wrong-type, duplicate, null, numeric-range and unknown-
field behavior. No defaults, skips, `IgnoredAny`, dummy reads or relaxed parser.

### Native limits

Preserve command names, serialized values, error strings, permissions, signing,
vault state, retain/release and timeout behavior. Lock reopening must preserve
contents, inode and mutual exclusion; no truncation, deletion or `create_new`.
Do not activate the unused privileged window. No blanket public modules,
warning allowances/expectations, smaller test selection or removed assertions.
Further diagnostics must be inspected; this design does not authorize a new
runtime feature, changed updater acceptance, new Cargo target or budget increase.

## Marketing security patch

Change only `marketing-site/package.json` and its matching lockfile: exact
React, React DOM and `react-server-dom-webpack` pins **19.2.8 → 19.2.9**.
The [confirmed advisory](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3)
lists 19.2.9 as patched. Registry metadata confirms the coordinated peer
requirements; existing Vinext/plugin ranges permit the patch. These existing
packages remain MIT-licensed with unchanged RSC dependency names. No new
package family, Next upgrade, plugin update or override removal is proposed.

The server package participates in the built Worker despite its dev-dependency
classification. Preserve dev/optional/peer audit coverage, severity threshold
and signature checks. Do not treat a version assertion as exploit regression
proof. Existing Worker tests validate actual built output; use an authoritative
upstream security regression fixture only if suitable and independently tested.

## Owners and validation

- Tauri/security specialist owns the native files above; test engineer owns
  necessary portable boundaries, native regression cases, exact inventory and
  hosted proof wiring. Parent integrates registration, evidence and review.
- A separate worker owns the two marketing manifest/lock files. Use isolated
  dependency installation with scripts disabled, followed by explicit approved
  lint/typecheck/build/test commands in an isolated environment without user
  credentials. This is dependency testing, not application installation.
- Keep all eight native targets and the three existing mutation controls.
  Add explicit reviewed controls where new DTO, lock, serialization or accessor
  regression tests need proof. Each control binds a fixed source, target and
  expected failure set; complete red/green execution, inspected applied diff,
  restored checksum and clean state are required. Compile errors/timeouts are
  not mutation success. No optional proof or relaxed aggregate validation.
  Before production implementation, fix the control IDs and exact platform
  failure sets: DTO required-field proof on both platforms, lock-truncation
  proof on macOS only. Aggregate validation must require those explicit sets,
  without inventing Linux lock evidence. Serialization/accessor assertions
  need detecting mutations too; one control may cover multiple named failures,
  with independent restoration between controls.
- Preserve existing test names where practical; review every moved/added name
  and update exact inventories honestly. The 260/262 baseline is not a ceiling
  or permission to remove cases. Keep the 43-minute driver deadline, 45-minute
  jobs and existing overall budget; if proof cannot fit, return for a decision.
- Run affected portable tests, all type checks, secret scanning and named
  agentic validation. Each new behavioral regression requires an observed red
  mutation and restored green. Existing parity proofs apply only to unchanged
  invariants, not the new module boundaries.
- Run actual Rust tests, new native mutation proofs and strict Clippy only on
  approved disposable hosted runners after separate publication approval.
- Marketing: clean dependency install, peer resolution, lint, typecheck, build
  and built-Worker/dependency tests; `test:ux054`, `test:supply-chain-gates`, then
  six-lock audit on the committed candidate (the audit reads Git HEAD).
- Independent Sol and actual Sonnet review the final source/evidence; do not
  publish unreviewed fixes. Completion requires hosted native acceptance and
  zero high/critical findings across all six locks.

No local Rust execution, app launch, real Keychain/native permission access or
user-data changes. The separately documented 400 ms portable fixture flakiness
remains visible; this design does not authorize weakening its timeout assertion.

## Rollback and approval

No data migration. Roll back reviewed source/package commits with a matching
lockfile; reverting the marketing security patch restores a known advisory and
is not an acceptable release candidate. Approval covers the native module split,
validation-only DTO representation, verified orphan removal, lock clarification,
coordinated package patch and necessary bounded validation described above.

Merging, auto-merge, releases, deployment and application installation remain
paused. Publishing the resulting reviewed code requires separate approval.

Architect review: approval-ready with no architectural blocker; the FFI and
platform-specific proof clarifications above are required during decomposition.
