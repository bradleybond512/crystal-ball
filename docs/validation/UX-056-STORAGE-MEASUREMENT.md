# UX-056 — fixture-only storage measurement contract

November 18, 2026. Draft #1916. Implementation candidate:
`b3848e9890c22129c007a6bf9a6f8537074a6b23`.

## Result and scope

An isolated measurement contract now classifies ten known storage scopes and
validates synthetic metadata into a versioned report. Counts, file-length bytes
and origin estimates stay separate. Missing measurements never become zero;
mixed and unresolved ownership remains protected. No runtime consumer, live
reader, cleanup, retention policy, migration or persisted report is introduced.
Full UX-056 remains IN PROGRESS until separately approved live measurement and
classification exist. This change does not demonstrate storage savings.

Only new production file `src/services/storage-measurement.ts` is added. It has
no runtime imports. `getStorageMeasurementPlan()` returns fresh catalog copies;
`buildStorageMeasurement(unknown)` validates at most 32 observations against fixed
scope IDs, status rules and permitted nonnegative safe-integer metrics. It rejects
duplicates, extra fields, accessors and invalid values using constant errors.
Own-data descriptors avoid getter evaluation; arbitrary Proxy traps can execute
caller code, but thrown diagnostics are sanitized. Outputs are fresh and do not
mutate input. Owned-cache classification is not authorization to delete anything.

`tests/storage-measurement.test.mts` uses fixtures and evaluates the actual
module with storage, network and filesystem operations trapped. `package.json`
adds `test:storage-measurement`; one exact override in
`scripts/targeted-tests-overrides.json` maps the new module to that suite. The
roadmap and design record the bounded scope and retain open live acceptance.
No dependency/lockfile, existing storage reader/writer, backup #1911 or quota
(#1761) behavior changed. All merge and delivery holds remain.

## Actual validation

The initial exported stub executed but failed the real catalog and missing-scope
report assertions:

```text
# pass 1
# fail 2
```

The final focused command `npm run test:storage-measurement` produced:

```text
# tests 15
# pass 15
# fail 0
# cancelled 0
```

Scoped ESLint, `npm run typecheck:all` and `git diff --check` exited zero. The
specialist independently ran the same 15/0 suite. The only focused-run warning
is Node's experimental TypeScript-stripping API used by the isolated fixture.

The strict selector successfully includes `test:storage-measurement`, selecting
50 scripts with no unmapped source paths. Selection does not claim execution of
those 50 scripts; hosted implementation execution awaits publication approval.

Full named gate executed:

```sh
bash scripts/agentic-validate.sh --tests "test:storage-measurement test:agentic-pipeline test:roadmap-controller"
```

Actual output excerpts in script order:

```text
# pass 15
# fail 0
# pass 85
# fail 0
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:storage-measurement test:agentic-pipeline test:roadmap-controller
```

Lockfile consistency, strict lint, both TypeScript configurations, secret scan,
cross-agent configuration, docs and roadmap checks, and web build exited zero.
Existing changelog advisory and build-chunk warnings remain visible in the raw
log. There was no native build or installation.

## Mutation evidence

All 17 controls produced assertion failures, with zero cancelled tests. Each
mutation started from clean committed `b3848e9890c22129c007a6bf9a6f8537074a6b23`,
changed only `src/services/storage-measurement.ts`, and saved an applied diff.

| Applied mutation | Baseline pass/fail → mutated pass/fail |
| --- | --- |
| `missing-metrics-invent-zero` | 15/0 → 13/2 |
| `partial-promoted-to-complete` | 15/0 → 14/1 |
| `mixed-reasoning-protection-removed` | 15/0 → 11/4 |
| `duplicate-rejection-removed` | 15/0 → 14/1 |
| `metric-scope-separation-removed` | 15/0 → 14/1 |
| `overlapping-total-added` | 15/0 → 13/2 |
| `error-sanitization-removed` | 15/0 → 14/1 |
| `integer-precision-guard-removed` | 15/0 → 14/1 |
| `negative-metric-guard-removed` | 15/0 → 14/1 |
| `field-getters-evaluated` | 15/0 → 14/1 |
| `caller-classification-accepted` | 15/0 → 14/1 |
| `direct-filesystem-access` | 1/0 → 0/1 |
| `nested-catalog-array-shared` | 15/0 → 14/1 |
| `observation-bound-relaxed` | 15/0 → 14/1 |
| `complete-metrics-requirement-removed` | 15/0 → 14/1 |
| `nonmeasurement-state-allows-metrics` | 15/0 → 14/1 |
| `input-metric-object-aliased` | 15/0 → 14/1 |

The filesystem control executes the independent I/O-trap test only, avoiding
derivative failures from a failed module import. That subset restores to 1/0;
the whole suite restores to 15/0. Every mutation restored the original checksum
and an empty scratch-tree status. Original/restored SHA-256:

```text
d76fd900aba02a3203091d37bdc1a1c772d66be38e614d8715ece7953ce93726
```

Raw `storage-mutations/results.json` links each applied diff, actual failing
assertion/log, mutated/restored hash and clean status. Representative failures:
invented zero metrics violate the exact missing report; mixed protection changes
fail independent catalog assertions; getter evaluation increments a forbidden
side-effect counter; error reflection exposes a fixture canary; direct filesystem
access triggers the explicit I/O assertion. No survivor is omitted.

## Independent review

Independent Sol (`gpt-6.1-sol`, medium) found zero blocking findings on
`b3848e9890c22129c007a6bf9a6f8537074a6b23`, independently ran 15/0 and audited
all 17 actual mutation diffs, red logs and restored hashes. Final documentation-tip
review and actual Sonnet review must clear before recording the SHA-pinned
verdict and requesting separate implementation publication approval. Final
review receipts and verdict are the publication evidence, not this report alone.

## Investigation history

Initial source validation caught unsupported `Object.hasOwn` for the repository's
TypeScript target and a validator complexity finding. The implementation now
uses the compatible own-property primitive and small validation helpers; strict
checks were preserved. An initial pipeline run was 84/1 because macOS temporary
directory aliases differed in its path assertion. Rerunning with physical
`TMPDIR` normalization produced 85/0 without test or production changes. Roadmap
tests passed 135/0. Raw failed attempts remain in task artifacts.

## Limits, manual verification and rollback

The catalog is source-backed configuration, not a measured profile. IndexedDB
record counts are not bytes. File lengths are not allocated disk space, and
origin estimates are not per-store usage. Reports deliberately provide no sum,
residual, reclaimable-byte or unique-logical-data estimate. Mirrored stores can
overlap. Unknown scopes are rejected; the known unresolved and mixed scopes
remain protected. `liveBaselineEstablished` is always false for this contract.

The shared reasoning store contains credentials; no value serialization or
storage constructor runs. EvidenceStore construction opens WAL/schema state, so
it is excluded. Future collectors require a separate approved read-only design,
privacy boundaries and consistency handling. No application, credentials or
installed profile was accessed, and no native build ran.

Manual fixture verification: run `npm run test:storage-measurement`; inspect a
missing-scope report and a partial origin estimate, confirming absent metrics
stay unknown and protected flags remain intact. Any live measurement is deferred
until separately authorized. Rollback removes the new isolated module, tests and
script/mapping; no migration or stored-state conversion exists.

Proposed implementation commit: `Keep storage evidence distinct from cleanup authority`.
Draft description: provide a tested metadata contract with explicit units,
ownership and coverage before collecting a live storage baseline; no cleanup or
live-baseline acceptance claimed.

Raw evidence is retained in the current Codex visualization task directory
`next-nov18/`, including the original failing tests and final validation receipts.
