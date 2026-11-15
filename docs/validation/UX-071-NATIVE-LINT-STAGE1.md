# UX-071 first bounded native cleanup

Status: local candidate; hosted acceptance remains open. User approved this
bounded scope November 15. Source commit: `2dfb8f4f86ca99ff0012da64cc591b297ce1947a`.

## Behavior, architecture and scope

The four-file Rust cleanup replaces diagnosed equivalent syntax and deprecated
nonce conversion without changing the version-2 encrypted vault format,
key derivation, nonce randomness or failure returns. `main.rs` retains strict
12-byte nonce validation and uses a fallible fixed-array conversion. Four
synthetic crypto cases cover fixed existing-format ciphertext, malformed nonce
lengths, changed nonce and changed authentication tag. `imessage.rs` changes
non-macOS tail expressions; `secret_sync.rs` names a test-only callback type;
`vault_coordinator_contract.rs` uses reverse iteration with unchanged assertions.

The existing native driver requires watchdog, nonce-rejection and
authentication-rejection mutation controls. Each records a nonempty applied
diff, original/mutated/restored hashes, exact red failures and full restored
green counts. Crypto controls run the full binary harness. Compilation errors,
timeouts and unexpected failures cannot count as proof. Restoration executes
in `finally`; exact target inventories, strict Clippy and existing time budgets
remain intact. Registration and portable fixtures guard these contracts.

No dependency, lockfile, permissions, IPC, migration or delivery changes.
Existing data remains readable by the same authenticated format. Broader
platform/dead-code/DTO cleanup is outside this approval.

## Local validation

Node 22.23.1; native execution was not run locally. The named gate command was:

```sh
bash scripts/agentic-validate.sh --tests "test:native-ci-driver test:native-ci-workflow test:native-crypto-boundary test:imessage test:secret-boundary test:workflow-security test:agentic-pipeline test:roadmap-controller"
```

Actual TAP outputs, in command order:

| Script | Actual output |
| --- | --- |
| native-ci-driver | `# pass 19` / `# fail 0` |
| native-ci-workflow | `# pass 4` / `# fail 0` |
| native-crypto-boundary | `# pass 3` / `# fail 0` |
| imessage | `# pass 6` / `# fail 0`; `# pass 137` / `# fail 0` |
| secret-boundary | `# pass 21` / `# fail 0`; `# pass 36` / `# fail 0` |
| workflow-security | `# pass 96` / `# fail 0` |
| agentic-pipeline | `# pass 85` / `# fail 0` |
| roadmap-controller | `# pass 135` / `# fail 0` |

The command exited 0 with `Agentic validation gate passed.` Lint, type checks,
secret scan, documentation checks and build passed. Build emitted existing
module-resolution/dynamic-import/chunk-size warnings; raw output is retained.

Additional source-boundary command:

```sh
node --test tests/imessage-native-boundary.test.mjs tests/native-notify-boundary.test.mjs tests/vault-writer-boundary.test.mjs tests/secret-boundary.test.mjs tests/sidecar-secret-routing-boundary.test.mjs tests/native-responsiveness-boundary.test.mjs tests/sidecar-supervisor-boundary.test.mjs tests/native-lows.test.mjs
```

Actual output: `# tests 57`, `# pass 57`, `# fail 0`; exit 0.
Raw evidence: session directory `next-nov15/stage1/full-gate.log` and
`source-boundaries.log`.

## Mutation and review evidence

At the exact source above, all 68 portable controls were caught. Actual baseline
and restored output: `# pass 26` / `# fail 0`. Sixty mutations returned 25/1,
seven returned 24/2 and one returned 23/3. Every mutation began clean, recorded
an inspected applied diff and actual failing assertions, then restored matching
SHA-256 and empty status. No survivors. Evidence and individual failing
assertions: `next-nov15/stage1/portable-mutations/REPORT.md`, `results.json`
and adjacent 68 diff/log pairs.

Restored SHA-256 values:

| Mutated file | SHA-256 |
| --- | --- |
| scripts/native-test-driver.mjs | `355c5a6555df74692b40ef6b0cc39a8fffd670ff545093c4f19e4beeaedee87e` |
| .github/workflows/native-tests.yml | `465d54f2633eda851986d0ee16abe64932fdef0c10172825e0080ef01010795a` |
| scripts/native-test-inventory.json | `2ffb980d5d2e6169cf1c2021db53ddc4d6307eec6e4bc1d63060d5d7fa4c7be0` |
| src-tauri/src/main.rs | `60372d0e77a4767395dfecaf48512c65cad150f532e04b904b9d3d96a404b78a` |

The four crypto source mutations and hosted orchestration checks are explicitly
source-scoped proof. Node also authenticated the independent ciphertext fixture.
These results do not establish Rust compilation, actual Rust crypto behavior or
hosted red/green mutation results; those remain publication-dependent acceptance.

Independent Sol code review found no concrete blocker and independently ran
26/0 portable tests. Final evidence review and actual Sonnet review are required
before publication; their SHA-pinned conclusion belongs in the verdict commit.

## Remaining acceptance and manual verification

The published baseline's hosted run `43743059321` passed all eight targets:
Linux 256/0, macOS 258/0; watchdog mutation 8/1 restored to 9/0 on both.
Strict Clippy remained red on both, and marketing npm audit remained red.
Those are baseline results, not results for this cleanup.

After separate publication approval, inspect both platform receipts for the
four new binary cases (expected totals 260/262), all three actual Rust mutation
controls, restored source/lock hashes, exact failure names and bounded runtime.
Keep strict Clippy failures visible for the next approved cleanup stage.
No local app, Keychain, native permission, real messaging or user data was used.

Rollback reverts these repair commits through review; no data migration or
format rollback is required. Proposed commit: preserve vault compatibility
while removing diagnosed native lint debt. Proposed draft PR description:
retain the strict native gate, repair the approved mechanical/nonce findings,
and add fixed-format crypto cases with hosted red/green evidence requirements;
leave wider lint cleanup and actual hosted acceptance open.

Merging, auto-merge, releases, deployment and installation remain paused.
