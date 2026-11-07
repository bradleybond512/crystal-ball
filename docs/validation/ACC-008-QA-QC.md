# ACC-008 QA/QC evidence

Risk tier: High. Scope is offline read-only acquisition and aggregate scoring;
production inference, storage, models, delivery and permissions are unchanged.

## Checks passed

`npm run test:acc008`, final restored collector:

```text
# tests 25
# pass 25
# fail 0
```

`npm run typecheck:acc008`: exit 0. Normal implementation and repair commit
hooks ran `npm run typecheck:all` (application and API configurations): exit 0.
The script/test dedicated configuration is necessary because application
TypeScript excludes scripts and tests.

`npm run test:intelligence`:

```text
# tests 589
# pass 589
# fail 0
```

`npm run test:cognition`:

```text
# tests 654
# pass 654
# fail 0
```

Additive test-selection mapping regression suites:

- `npm run test:sidecar-ci`: `# tests 13`, `# pass 13`, `# fail 0`.
- `npm run test:domain-retirement`: `# tests 2`, `# pass 2`, `# fail 0`;
  this wrapper executes its four fixed inner groups.
- `TMPDIR=/private/var/folders/qt/hq7cydbd06d6g0yksx3mxm3c0000gn/T npm run test:agentic-pipeline`:
  `# tests 77`, `# pass 77`, `# fail 0`.

The first agentic-pipeline invocation returned `# pass 76`, `# fail 1` at
`tests/agentic-pipeline.test.mjs:394`: its temporary-path string comparison saw
macOS `/var` versus canonical `/private/var`. The unchanged failing test passed
alone with canonical TMPDIR (`# tests 1`, `# pass 1`, `# fail 0`), then the
unchanged full suite passed 77/0 under the same setting. No assertion or
validation threshold was changed.

The initial full gate invocation:

```bash
bash scripts/agentic-validate.sh --tests "test:acc008 typecheck:acc008 test:intelligence test:cognition"
```

returned exit 0 and:

```text
Agentic validation gate passed.
Tests run: test:acc008 typecheck:acc008 test:intelligence test:cognition
```

It ran named tests, lockfile checks, strict lint, both application/API typechecks,
secret scan, review advice, docs/roadmap checks and production build. Production
build output included `✓ built in 26.18s`. Existing import-resolution and dynamic
import warnings were not suppressed. The same full gate was rerun after both
pairing repairs and exited 0, including the final 25-case collector suite.
Its actual final output included:

```text
# tests 25
# pass 25
# fail 0
# tests 589
# pass 589
# fail 0
# tests 654
# pass 654
# fail 0
Secret scan passed for 5753 file(s).
✓ built in 11.41s
Agentic validation gate passed.
Tests run: test:acc008 typecheck:acc008 test:intelligence test:cognition
```

The roadmap controller with complete open/referenced PR metadata returned
`"blocking": []` and UX-047 as the next unclaimed Tier S task. The gate's local
tracker-only invocation names UX-033 because its existing claim is not in the
local TODO row; live claims #1839 and #1840 are preserved.

## Mutation evidence and review

[All 23 mutation proofs](ACC-008-MUTATION-PROOFS.md) include actual applied diffs,
red counts, failing assertions and restored SHA-256. Baseline 25/0 changed to
24/1 for 18 mutations and 23/2 for five mutations; final restoration is 25/0.
Mutation execution used synthetic databases only. Acquisition occurred after
source checksum and clean tree were reverified.

The independent Sol reviewer found two blocking pairing defects in the initial
implementation. Both were repaired in review cycle one: reject every duplicate
resolved identity and exclude comparisons at/after the earliest structured
outcome observation. The two regression tests first returned `# pass 23`,
`# fail 2`, then `# pass 25`, `# fail 0`. On immutable repaired commit
`590a9eeec5a1a599bcc00dff105575e8b9f628d0`, independent review concluded:

> No blocking findings in the completed local ACC-008 implementation and evidence.

The reviewer independently ran that committed collector/test content: `# tests
25`, `# pass 25`, `# fail 0`. Final independent evidence review confirmed all 23 assertion
excerpts, counter/denominator reconciliation, restored checksum and final gate
output, with no blocking findings. The required Sonnet cross-agent verdict is
a separate SHA-pinned review commit against the final documentation commit;
this report does not substitute for that verdict.

## Checks not run and residual limits

- Packaged application rebuild/install and UI browser tests: no runtime or UI
  change; installation and delivery are paused.
- Full repository test matrix: targeted collector, reused-helper and mapping
  suites were run; CI remains the full matrix authority.
- Script ESLint: existing ESLint file patterns omit `scripts/*.mts`; it reports
  that file ignored. Dedicated strict TypeScript checking covers the collector;
  validation configuration was not weakened to hide this limitation.
- Historical raw replay: no raw production export is retained, by design.
- Production database hash stability: the running application may write its own
  data; only synthetic fixtures have before/after hash invariance assertions.

The baseline receipt is a 500-record retained working set, with shared outcomes,
375 uncertain proxy labels and 274 late resolutions. All direct paired cohorts
fall below twenty. Champion/challenger decision state and installed evaluation
revision are unavailable; required historical cohort coverage, feature lineage
and training readiness are not established. ACC-703 proof eligibility is false.
These limitations do not authorize relaxed thresholds or model promotion.

## Manual verification and rollback

See the [production report](ACC-008-PRODUCTION-BASELINE.md) for the exact acquisition
command, UTC measurement, reconciliation and cohort tables. Baseline collection
exited 0; reconciliation printed `Aggregate reconciliation passed.` Rollback is
removing the new tooling and docs through review; no production data migration,
write or rollback occurs.

## Commit and draft PR description

Implementation commits: `88a32cb89` (read-only aggregate collection),
`590a9eeec` (ambiguous/post-outcome pair exclusion).
Proposed documentation commit: `Record measured baseline without claiming model readiness`.

Draft title: `ACC-008: measure the installed production baseline read-only`.

Draft body:

> Roadmap task: ACC-008. Adds a tested collector that reads four installed
> storage keys and emits only aggregate counts, cohort/version metadata and
> exact paired baseline metrics. The November 2 UTC receipt has 424 resolved
> records and 115 exact pairs; missing champion/evaluation evidence remains
> unavailable, and ACC-601–605 stay WAITING with measured review dates.
>
> Includes the exact acquisition command, 25 focused tests, 23 mutation proofs,
> dedicated typecheck and targeted helper/mapping validation. No runtime,
> production-storage, model, installation or delivery change is included.
>
> Keep this PR in review until evidence review, the genuine Sonnet verdict,
> required CI and the authorized closeout path are complete.

Release stance: not delivered. Local implementation/evidence only; the existing
draft claim remains open. No push of implementation, auto-merge, deployment,
release, installation or delivery resumption is authorized by this report.
