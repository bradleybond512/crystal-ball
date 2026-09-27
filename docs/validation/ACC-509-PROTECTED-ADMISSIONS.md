# ACC-509 protected-admission performance follow-up

PR #1743. Approved design: [protected admissions](../plans/2026-09-27-acc509-protected-admissions.md).
This follows the completed identity delivery in #1738. It preserves admission,
retention, user state, archives and warning consideration. No forecast accuracy
improvement, storage migration, native change or new dependency is claimed.

## Problem and repair

Required renderer CI failed the existing 5,000-alert budget twice at 570 ms and
565 ms against 500 ms. Once all 4,096 identities were protected, about 900
remaining admissions each scanned every resident despite having no possible
victim. The ledger now owns a synchronous protection scope with an exact resident
count and membership generation. Validation, expiry, duplicates, value preparation
and count/byte fit still precede the scan shortcut. External or nested membership
changes invalidate the count. Ordinary admissions still read current caller Sets.

Only alert-identity.ts and the existing unified-alerts.ts ingest loop changed in
production. Tests compare scoped results to ordinary admissions and check work
counts, fitting revisions, expiry, duplicate protection, scope lifetime and
whole/split batch parity. Novel warnings remain eligible at identity capacity.

## Executed verification

Node 22. Commands below completed with exit 0; excerpts are actual saved output.

`node --import tsx --test src/services/__tests__/alert-identity.test.mts src/services/__tests__/unified-alerts-identity.test.mts src/services/__tests__/unified-alerts-batching.test.mts`:

```text
# tests 58
# pass 58
# fail 0
```

`VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:acc509 test:ux059 test:alert-capacity test:warning-delivery"`:

```text
==> npm run test:acc509
# tests 118
# pass 118
# fail 0
==> npm run test:ux059
# tests 32
# pass 32
# fail 0
==> npm run test:alert-capacity
# tests 11
# pass 11
# fail 0
==> npm run test:warning-delivery
# tests 20
# pass 20
# fail 0
Agentic validation gate passed.
```

The same gate passed lockfile, lint, all-config types, secrets, cross-agent policy, documentation, roadmap and full build checks. `git diff --check` passed.

`npm run bundle:check`:

```text
    main-Bk9SIYdr.js  raw=1.57 MB  gzip=453.6 KB
✓ All bundle-size policies satisfied.
```

## Performance evidence

Five interleaved runs per version used the original unchanged batching fixture,
with an external timing print added after its existing inner timer. The same
500 ms assertion and all ten fixture tests passed on every run. Alternating
run order reduced warmup/order bias; these are local results, not CI evidence.

| Version | Ingest + flush samples (ms) | Median (ms) |
|---|---|---:|
| baseline | 193.143, 193.149, 205.619, 194.886, 193.343 | 193.343 |
| optimized | 86.345, 82.129, 77.354, 76.829, 76.930 | 77.354 |

The median decreased about 60%. The profiled optimized full batching fixture
recorded availableVictims self-time 10.376 ms and refreshProtection 1.542 ms;
the earlier baseline profile recorded victims self-time about 66.4 ms. Profiles
include other fixture operations and are diagnostic, not statistical benchmarks.
The deterministic ledger check observes one initial resident enumeration and no
further enumeration for 127 insertions, a revision and 300 protected overflows.
The store check permits only its final eight-entry persistence scan while all
100 source warnings remain eligible.

## Applied mutation proof

Initial test-first ledger run: `# pass 24`, `# fail 8`. Final clean-tree proofs:
15 applied production mutants, each with an actual failing assertion, restored
SHA-256 and clean Git status. Restored focused suite: `# pass 48`, `# fail 0`.
[Machine-readable proof with complete applied diffs and hashes](ACC-509-PROTECTED-ADMISSIONS-MUTATIONS.json).

| Mutation | Baseline pass/fail | Mutated pass/fail |
|---|---:|---:|
| repeated-victim-scans | 48/0 | 46/2 |
| premature-capacity | 48/0 | 32/16 |
| set-size-coverage | 48/0 | 46/2 |
| stale-generation | 48/0 | 47/1 |
| accepted-key-protection | 48/0 | 40/8 |
| duplicate-key-protection | 48/0 | 47/1 |
| caller-set-alias | 48/0 | 47/1 |
| scope-lifetime | 48/0 | 47/1 |
| scope-initial-expiry | 48/0 | 47/1 |
| remove-protection-delta | 48/0 | 47/1 |
| insert-protection-delta | 48/0 | 47/1 |
| fit-after-capacity | 48/0 | 34/14 |
| victim-order | 48/0 | 45/3 |
| capacity-warning-delivery | 48/0 | 44/4 |
| store-scoped-integration | 48/0 | 47/1 |

## Review, limits and rollback

Independent review of production commit `769762b5525edefc6ad406f439710ffe9578f634`
concluded zero blocking findings and audited every mutation proof and all eleven
new tests. Exact-final-tip Claude review and required GitHub CI remain pending.

`npm run test:renderer` exited 0:

```text
# tests 15098
# pass 15098
# fail 0
# cancelled 0
# skipped 0
```

Do not treat local timings as a
replacement for required CI. No packaged-app manual acceptance was performed;
this repair changes only ledger computation, with no UI or install change.

Manual acceptance after normal reviewed delivery: refresh a large alert batch,
then acknowledge/pin/snooze and replay an alert; retained state should persist
and novel warnings should remain eligible at capacity. Automated fixtures cover
these semantics but do not claim native notification delivery.

Rollback is an isolated reviewed revert of this optimization, restoring the
original correct but slower algorithm without data conversion. Preserve the
500 ms gate and report renewed timing failure rather than weakening it.
