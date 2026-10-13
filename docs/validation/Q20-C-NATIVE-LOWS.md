# Q20 PR C validation: native lows (R3-SEC-008, R4-LOW-007)

October 11 private integration: **compiled production and supplemental
filesystem tests, source gates, all eight mutation proofs and all 41 selected
scripts completed**. The final full gate and independent Sol medium review of
the exact final tip are **PENDING** after this documentation commit. Their
eventual results will be recorded in private frozen-tip evidence outside this
checkout; neither a pass nor private-ready status is asserted here. Publication
and the human dependency-change label remain held. No installed signature
checks, release builds, signing or operational smoke were run.

The historical Q20 plan `2026-10-04-q20-remaining-lows.md` was on #1779;
it is not imported into this bounded nine-file integration. Bradley approved
the native design on October 4, 2026. Decision B remains: Bradley checks the
app only after main-sync next installs it, as a later operational acceptance
step. It is not a premerge smoke requirement or permission to install here.
The original #1782 implementation was stacked on original #1776; this private
integration is based on the reviewed #1776 tip
`08d704b4e13cc91abc61ae6c74faf4997e3a8bfe` and canonical main base
`3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`.

## Intended integrated behavior

- **R3-SEC-008:** `com.apple.security.cs.allow-unsigned-executable-memory`
  is removed from `src-tauri/Entitlements.plist`. Only `allow-jit` and the
  location entitlement remain. The approved rationale is that the Rust host
  does not JIT, web content runs in WebContent, and bundled Node retains its
  own signature/entitlements. The original Q17/Q20 installed-signature and
  packaging observations are historical, unrerun claims; this private
  integration does not verify those operational properties.

  `desktop-package.mjs` changes explanatory comments only; current stable
  signing enforcement, verification and main-sync behavior are preserved.
- **R4-LOW-007:** new std-only module `src-tauri/src/log_rotation.rs`.
  - **`rotate_by_rename`** (the existing behaviour, now shared) for the
    desktop log.
  - **`rotate_by_copy_truncate`** for `local-api.log`, which the sidecar
    writes through an inherited append-mode descriptor. It copies the file
    to `.log.1` with mode 0600, then truncates the original in place, so
    the child's next write lands at offset 0.
  - A shared lock serialises rotations.
  - **`start_sidecar_log_rotator`** starts one background thread per app
    lifetime. It runs at the first sidecar spawn and is reused across
    supervisor restarts, checking every 60 s at the existing 5 MiB threshold
    with three numbered backups. The 5 MiB threshold is a periodic trigger,
    not a hard cap: the log can grow between checks or when rotation fails.
  - Rotation failures are best effort. Metadata, rename, copy, backup-mode,
    open or truncate failure does not stop the sidecar. Copy must succeed
    before the original can be opened/truncated; failed copy cannot truncate.
    A failed worker thread spawn emits its error and the OnceLock still
    initializes, so it does not retry in that app lifetime.
  - **Trade-off:** a line written between the copy and the truncate can be
    lost. Piping the child's output through Rust was rejected, because a
    stalled reader could block the sidecar on a full pipe.
- **R3 doc:** only the R3-SEC-008 row is updated to completed private validation,
  with final gate/review pending and publication held (🟡); other rows, including
  reviewed #1776, are retained.

**Smoke test for Bradley (decision B).** After main-sync next installs this
build, confirm:

- the map renders;
- System Diagnostic shows the local engine as running;
- an ML feature (for example a briefing summary) works.

If that later human check fails, restoring the single plist key is the
approved rollback response. No rollback or installation is performed here.

## Historical October 4 test claims (unrerun)

- **Rust:** the original report claimed 5 unit tests in `log_rotation.rs` passed as
  `cargo test --bin crystalball log_rotation` on the Mac, and standalone with
  `rustc --test`. They cover:
  - the child's descriptor keeps working after truncation;
  - backup shifting and dropping the oldest;
  - small files are left alone;
  - rename rotation;
  - the backup's 0600 mode.
- **Node:** `tests/native-lows.test.mjs`, 2 tests (the plist assertion and
  the rotator wiring). New script: `test:native-lows`.
- **Clippy:** the original report claimed no new warnings (one `useless_vec` in a test
  was fixed).

The original report claimed
`bash scripts/agentic-validate.sh --tests "test:native-lows test:node-pinning"`
on the Mac printed "Agentic validation gate passed." It covered lint:strict,
typecheck:all, secrets:scan, cross-agent:check, docs:check, roadmap:check,
the build, and both suites (all passing). `cargo test --bin crystalball
log_rotation` passed 5 of 5.

## Historical October 4 mutation claims (unrerun)

These exit codes/counts are historical report claims, not fresh integrated
proof. Exit 101 alone does not establish an assertion failure or numeric
pass/fail result. Fresh proofs must record those details and exact restoration.

| ID | Mutation | Historical suite | Historical reported result (unrerun) |
|---|---|---|---|
| C01 | log never truncated | Rust unit tests | red (test harness exit 101), restored `a1614fd3b4f3` |
| C02 | rename leaves the child writing to `.log.1` | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C03 | older backups overwritten | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C04 | rotates regardless of size | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C05 | backup not private | Rust unit tests | red (exit 101), restored `a1614fd3b4f3` |
| C06 | entitlement restored | native-lows | red (1 failing), restored `c502be838620` |
| C07 | rotator never started | native-lows | red (1 failing), restored `c84dfb5230b7` |
| C08 | rotation checked once a day | native-lows | red (1 failing), restored `c84dfb5230b7` |

## October 11 actual private integration evidence

The completed clean runs bind code tip
`1b42a25cfdea9d6eef6c7fd6293e14e6dddcfb20`, based on the independently reviewed
private #1776 tip `08d704b4e13cc91abc61ae6c74faf4997e3a8bfe`. Initial focused
compilation/source checks ran against the same integrated source before its
normal code commit. The parent #1776 passed its private Sol medium cycle 1
review with no blocking findings; that review is not a #1782 review.
Canonical main was refreshed at `3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`
before the first normal code commit. Its normal hooks completed with child
exit 0 in 24.459 seconds (`initial-normal-code-commit.json`). Original Claude
and completed parent checkouts were untouched.

Execution used owned fake HOME/data/tmp/frontend resources and offline local
Node/Cargo dependencies. Native filesystem fixtures use temporary files, not
production logs. Counts below are separate executions per suite or binary,
not a sum of distinct tests or behaviors.

### Actual source and compiled results

| Executed suite or binary | Actual pass / fail |
|---|---|
| `npm run test:native-lows`: entitlement and rotator source boundaries | 2 / 0 |
| Direct production `rustc --edition=2021 --test src-tauri/src/log_rotation.rs` | 5 / 0 |
| Integrated `cargo test --offline --locked --manifest-path src-tauri/Cargo.toml --bin crystalball log_rotation -- --nocapture --test-threads=1` | 5 / 0 (111 filtered out) |
| Supplemental std fixture: complete production source prefix plus two fake-file tests | 7 / 0 |
| Full `--bin crystalball` | 116 / 0 |
| Full `--test vault_coordinator_contract` | 45 / 0 |
| Full `--test watchdog_contract` | 9 / 0 |
| Full `--test imessage_contract` | 44 / 0 |
| Full `--test sidecar_supervisor_contract` | 24 / 0 |
| Full `--test current_location_contract` | 9 / 0 |
| Full `--test notify_policy_contract` | 7 / 0 |

The raw source footer is `# pass 2` / `# fail 0`. Direct production reports
`5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`; integrated rotation
reports `5 passed; 0 failed; 0 ignored; 0 measured; 111 filtered out`;
supplemental fixtures report `7 passed; 0 failed; 0 ignored; 0 measured; 0
filtered out`. The full native commands use `cargo test --offline --locked
--manifest-path src-tauri/Cargo.toml` with each target above. Their separate
commands/counts/raw-log hashes are in
`clean-full-native-fixtures-full-native-receipt.json`.

The direct production receipt confirms no supplemental code was appended.
The supplemental fixture compiles the entire production source as an exact
prefix, SHA-256
`04b4eb72376807cc72b29ad72337784dbf277461b23f90116a9dd0f29e07cb2c`,
and calls its actual public helpers from two appended tests. These supplement
the original five tests; they do not copy or replace the algorithm. Receipts
`corrected-direct-production-rotation-direct-production-receipt.json` and
`initial-supplemental-rotation-rotation-receipt.json` bind source, generated
source, commands, binary hashes, raw logs and results.

The first direct-production wrapper invocation used a relative workspace path and failed with ERR_MODULE_NOT_FOUND before rustc or tests ran. The corrected absolute path passed 5 / 0 without changing production, assertions or the runner.

The failed and corrected attempts remain in
`initial-direct-production-rotation.json` / `.log` and
`corrected-direct-production-rotation.json` / `.log`. The failed attempt has
no Rust/test-stage artifacts; both attempts retain exact source/index and the
same runner hash. It is not counted as a test result or discarded.

### Actual applied/red/restored mutation proofs

All eight mutations had a confirmed nonempty actual production-source diff,
an assertion failure, exact restoration of full source bytes/modes/raw index,
and a passing restored suite. There were 24 baseline/red/restored invocations:
five compiled fake-filesystem behavior proofs and three source-boundary proofs.
Each native invocation freshly compiled the actual production prefix before
running; compiler errors and stale binaries do not count as mutation kills.

The deterministic existing-test strengtheners assert backups 2 and 3 exist
before reading and set the original fake log to 0644 before asserting copied
backup mode 0600. Supplemental tests independently exercise the same properties.
C03 and C05 each produced two actual assertion failures, as shown below.
C02 changes copy to rename and creates the replacement current file so the
real old-descriptor assertion is reached: the retained append descriptor writes
to the moved backup instead of the new current log.

| ID | Actual mutation | Baseline pass / fail | Red pass / fail | Restored pass / fail |
|---|---|---|---|---|
| C01 | Copy succeeds but original is not truncated | 7 / 0 | 6 / 1 | 7 / 0 |
| C02 | Rename plus replacement retains the old backup descriptor | 7 / 0 | 6 / 1 | 7 / 0 |
| C03 | Backup shifting omitted | 7 / 0 | 5 / 2 | 7 / 0 |
| C04 | Copy/truncate size guard omitted | 7 / 0 | 6 / 1 | 7 / 0 |
| C05 | Copied backup chmod 0600 omitted; fake input explicitly 0644 | 7 / 0 | 5 / 2 | 7 / 0 |
| C06 | Unsigned-memory entitlement restored (source only) | 2 / 0 | 1 / 1 | 2 / 0 |
| C07 | Spawn-time rotator call omitted (source only) | 2 / 0 | 1 / 1 | 2 / 0 |
| C08 | Interval changed from 60 s to 86400 s (source only) | 2 / 0 | 1 / 1 | 2 / 0 |

C06–C08 establish only entitlement, startup-call and interval source boundaries.
They do not execute codesign/installation, a worker thread or timed operational
rotation. Compiled C01–C05 establish filesystem behavior using fake files,
not a live sidecar worker. Source/runtime proof types are kept distinct.

`mutation-manifest.json` retains each applied diff/source SHA, command, numeric
counts, failing assertion/raw log and restored checksum/index evidence.
Manifest SHA-256:
`035749a01c3c84263b21b0cbf761f3a376c41a723226d720ca7346b75e8d6dc1`.
`root-adopted-mutation-proof.json` records the completed proofs and rehashed
raw receipts/logs. Historical October 4 rows above are not reused for these
fresh results.

### Complete trusted selected-script execution

The unchanged trusted selector identified 17 cumulative changed paths across
private #1776 and #1782 and executed all 41 selected scripts successfully,
child exit 0 in 136.414 seconds at the same code tip. Full source/modes/raw
index were exact after the run. Raw log SHA-256:
`7909dec02e0a32bf8d9a33fdafb121da8e05fc975f10b12ea5c439633e571fee`.
`clean-trusted-targeted-list.json` and
`clean-trusted-targeted-execution.json` record the actual inventory and run.

`clean-targeted-script-footer-counts.json`, SHA-256
`4573f2d3f07a492107294d52c76d9ef3c570583ad830988e21a6b80530e959b5`,
retains 59 separate raw footer blocks across those 41 scripts. Blocks may be
nested and are not summed into a unique test total. For example,
`test:node-pinning` has separate 5 / 0 source and 5 / 0 renderer blocks,
`test:sidecar-routing` has 10 / 0 then 57 / 0, and `test:little-snitch` has
207 / 0 then 17 / 0. Reviewed parent Node pinning, generation publication,
secret revision floors and LaunchReconciliation remain preserved.

### Final gate/review and operational boundaries

The final unchanged full gate naming all 41 scripts and independent Sol medium
review of the exact final frozen tip are PENDING after this documentation
commit. Their eventual authoritative evidence will live privately outside this
checkout, avoiding a document that certifies its own later revision. This
refresh claims neither their pass nor #1782 private readiness. No dependency
label, verdict, publication, installation or human smoke action is performed.
Q20 decision B's map/local-engine/ML check remains a later human acceptance
step after main-sync next installs, not a premerge requirement.

The approved 5 MiB periodic trigger, copy/truncate diagnostic-line loss window,
best-effort rotation and no-retry thread-spawn failure behavior remain unchanged.
Actual installed signature, macOS/Windows release operation and live worker
behavior remain unverified by these fake/source fixtures.

## Follow-ups

- **R4 status table:** mark R4-LOW-007 when the handoff branch merges.
- **Possible further tightening:** `allow-jit` itself may be unnecessary for
  the Rust host. Removing it is a candidate once the smoke test confirms
  this change.
