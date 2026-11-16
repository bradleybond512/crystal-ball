# UX-071 second bounded native cleanup

Source: `8459f329d538283e01f398d97f554f4aef67767f`; base `d759723d4`.
Approved November 15. Local candidate; actual stage2 native acceptance remains
pending separately approved publication. Existing draft: #1904.

## Scope and behavior

No intended user-visible behavior change. `main.rs` and `current_location.rs`
replace 36 direct manually NUL-terminated literals with static C-string literals
and explicit `u8` pointer casts. Two needless borrows, three rustdoc continuation
lines and one final match expression receive equivalent syntax changes.
`sidecar_supervisor_contract.rs` converts four false-equality assertions to
negated assertions without changing expressions or messages. One existing
updater test regex follows the equivalent borrow removal while retaining its
mandatory installed-app signature-verification assertion.

No FFI declaration, ABI, native policy, selector, permission, retained object,
error return, schema, dependency, lockfile or budget changes. Byte-slice helpers
and dynamic CString calls remain unchanged. Wider platform/dead-code, updater
DTO and persistent-lock semantics stay outside scope. No new mirror tests.

## Parity and mutation evidence

External verifier compared exact published base and committed source:

- 36/36 literal payloads, including exactly one terminal NUL, retain identical
  bytes and call order; 24 in main, 12 in current_location.
- Seven FFI declaration blocks, 17 concrete ABI signatures and 37 remaining
  byte literals are unchanged.
- Four assertion expressions/messages and all test names/counts are preserved.

Raw evidence: session `next-nov15/stage2/PARITY-REPORT.md`,
`before-inventory.json`, `after-parity.json`, `check-parity.py` and source copies.
These checks establish source equivalence, not native runtime acceptance.

The updated signature guard was proved at the exact committed source:

```sh
node --test tests/desktop-updater-signature.test.mjs
```

Actual output: `# pass 10` / `# fail 0` → `# pass 9` / `# fail 1` →
restored `# pass 10` / `# fail 0`. The inspected applied diff replaced only
`verify_app_bundle_signature(dest, "Installed app")` with `Ok(())`.
The failed assertion required verifying the installed bundle before relaunch.
Restored `main.rs` SHA-256:
`180cb100bc4cc36dd9d1e02ac8101d4dc31f6265b7c696ab75f781800a7cfd7a`.
Detached scratch began/ended clean. Evidence: `signature-mutation.json`,
`signature-guard.diff`, `signature-baseline.log`, `signature-guard-red.log`
and `signature-restored.log` in the same directory.

## Validation and disclosed failures

Node 22.23.1; no local Cargo/rustc, native service, app or Keychain execution.

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:native-crypto-boundary test:native-lows test:roadmap-controller"
```

Actual output, in order: `# pass 19`, `# pass 4`, `# pass 3`, `# pass 2`,
`# pass 135`, each with `# fail 0`; command exited 0 with
`Agentic validation gate passed.` Lint, all type checks, secret scanning,
documentation checks and build passed. Existing build warnings remain in
`next-nov15/stage2/full-gate.log`; they were not suppressed.

The focused source suites and native-driver portable suites passed together
at `# pass 58` / `# fail 0` with `node --test --test-concurrency=1`.
Raw output: `portable-tests-serial.log`. The initial unchanged signature regex
correctly failed 9/1 before its necessary update.

Not all attempts passed. The initial nine-file parallel run returned
`# pass 57` / `# fail 1`: the existing 400 ms child-timeout fixture started too
slowly to print its PID. Independent review also observed this in a serial
five-file run: `ℹ tests 36`, `ℹ pass 35`, `ℹ fail 1`, duration 13390.975833 ms.
At `tests/native-ci-driver.test.mjs:191`, the `/\d+/` assertion received `''`;
the test lasted 473.92525 ms. Successful 58/0 and gate results do not establish
fixture stability. No timing assertion or timeout was weakened. This remains
a nonblocking validation-repeatability risk reported by the independent reviewer.

## Hosted evidence, review and remaining acceptance

Published stage1 run 43781733830 passed all eight targets: Linux 260/0,
macOS 262/0. All three actual mutation controls caught the exact failures and
restored clean checksums. See [stage1 results](UX-071-NATIVE-LINT-STAGE1.md).
Strict Clippy still failed both platforms; marketing npm audit remains red.
Those results precede this stage2 source and cannot establish its acceptance.

Independent Sol found no stage2 source blocker, inspected byte/ABI parity,
signature mutation and full gate evidence, and disclosed the flaky fixture.
Final exact-tip Sol and actual Sonnet conclusions must precede publication;
the recorded verdict pins the reviewed source and documentation.

After approved publication, inspect both hosted receipts for all eight targets,
all three red/green mutation controls, restored source/lock hashes, strict
Clippy and bounded duration. Objective-C behavior and stage2 Rust compilation
remain unverified locally. Do not broaden cleanup automatically to silence
further findings. UX-071 remains open.

Rollback is a reviewed revert of these source/test changes; no data migration.
Proposed commit: preserve native interfaces while removing literal lint debt.
Proposed draft description: replace equivalent native string/borrow/assertion
syntax while retaining exact bytes, ABI, assertions and strict checks; retain
remaining native lint and audit blockers and all delivery holds.

Merging, auto-merge, releases, deployment and installation remain paused.

## Main reconciliation after approved publication

Approved tip `3c68c88d7` was pushed to draft #1904. Its dependency-policy check
passed, but the PR was conflicting and no native/test matrix started. Canonical
main advanced to `ffb3f3ccb4` with the alternate SPC test-clock fix and its review.

Rebased onto that main and dropped only the superseded one-file clock-shim
commit `6cffa282cb`; the SPC test now exactly matches main. The existing
READY/GO handshake, one-second work deadline, hostile payload and assertions
are unchanged. Removed the stale verdict-only tip for fresh exact-tip review.
All native Rust, driver, inventory, workflow and remaining test code is unchanged
from approved `3c68c88d7`; source parity and mutation hashes still match.

Reconciled source `5ee1e42c72b8c49edca68673ff695803cb136d9b` passed:

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:native-crypto-boundary test:native-lows test:roadmap-controller test:spc-angle"
```

Actual output, in order: `# pass 19`, `# pass 4`, `# pass 3`, `# pass 2`,
`# pass 135`, `# pass 5`, each with `# fail 0`; exit 0 and
`Agentic validation gate passed.` No test timing/assertion was weakened.
The previously disclosed intermittent 400 ms fixture issue remains open;
this successful run does not establish repeatability.

Evidence: session `next-nov15/stage2-reconcile/full-gate.log` and `parity.json`.
No new native execution is claimed. The reconciled tip requires fresh review
and publication approval before hosted acceptance can continue. All merge and
delivery holds remain.
