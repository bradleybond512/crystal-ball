# ACC-508 — Near-threshold coupling recall gate

Risk: high-assurance prediction validation. Roadmap task ACC-508, draft #1857. Product SHA `14da6a1e97ab75634920a8ff66e56ebe1d93e701`. Locally implemented and validated; publication and hosted verification remain pending. Installation, auto-merge and delivery are paused. This is synthetic benchmark coverage, not demonstrated production accuracy uplift.

## Behavior and architecture

The frozen benchmark now contains S11, an explicitly planted causal relationship near the actual promotion boundary. All ten original streams and all five old learned rules' 32 emitted pairs remain intact. S11 adds 35 observations, one causal relationship and four learned pairs. Family size rises from 272 to 342; production miner thresholds and existing tolerance values are unchanged.

`__bench__/golden-streams.ts` defines the fixture and truth. `bench-correlation.ts` reports actual candidate evidence, including rejection. `bench-correlation-baseline.ts` requires recovery, authentic finite evidence and realized adjusted-p/alpha utilization within 0.85–0.99. It adds a strictly pinned schema 13→14 transition; the baseline JSON records the reviewed result. `scripts/correlation-benchmark.mts` routes the old schema through that transition before printing a seed. Tests and additive suite registration cover the new behavior. No application polling, UI, provider, permissions or dependency changes were made.

The transition pins the prior full measurement payload, report and tolerances; all old stream digests; exact new corpus/report/candidate measurements; and old learned-rule evidence. The archived v13 fixture is byte-identical to the canonical main `c5f24fbda` baseline. Ordinary reseeding cannot approve a changed prior baseline or an unreviewed fixture. Historical migration tests retain their tamper assertions and now refuse obsolete paths under schema 14; the old v12-related test reconstruction is explicitly drawn from the archived v13 fixture, rather than represented as an authentic v12 file. Legacy production pins were not changed.

## Measured boundary evidence

[Calibration evidence](ACC508-CALIBRATION.json) comes from real miner/engine runs. The relevant gate is Holm-adjusted p under measured background-count/family-size perturbations; posterior and utility remain separately visible. Do not substitute the inhibition threshold or z-score ratio for promotion margin.

| Case | Eligible pairs | Adjusted p / alpha | Actual admission | Expected boundary result |
|---|---:|---:|---|---|
| Approved S11 | 342 | 0.902809673 | Yes | Pass |
| Remove one fixed background event | 342 | 0.788496452 | Yes | Reject: too far inside |
| Add one background event | 342 | 1.028789283 | No | Reject: lost relationship |
| Add independent domain | 380 | 1.008368958 | No | Reject: family drift |

The final easier case removes the last background event from the fixed stream. The design's earlier approximately 0.790922 result used regenerated neighboring spacing; both measurements are below the approved 0.85 limit. The approved primary fixture and policy are unchanged. The candidate's posterior is 0.816020289 against floor 0.8, and expected utility is 0.080101443 against zero. This is an engineering coverage band, not a statistical confidence interval.

[Performance evidence](ACC508-PERFORMANCE.json) records 20 paired, alternating-order warm runs on the exact product: median 51.87 ms for the old corpus and 62.45 ms for the new corpus, about 10.57 ms additional offline benchmark work. This is a single-machine measurement, not a latency SLA.

## Commands and actual results

Node 22 was selected with `/opt/homebrew/opt/node@22/bin`; TMPDIR was resolved to its physical path.

```text
npm run test:acc508
# pass 21
# fail 0

npm run test:correlation
# pass 459
# fail 0

bash scripts/agentic-validate.sh --tests 'test:acc508 test:correlation'
Agentic validation gate passed.
Tests run: test:acc508 test:correlation

npm run bench:correlation
PASS — within tolerance of committed baseline (src/services/correlation/__bench__/bench-correlation-baseline.json).

node /Users/bradleybond/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/acc508/trusted-ci.mjs --ci
[targeted-tests] 38 script(s) passed.
```

The gate also ran both TypeScript configurations, lockfile checks, strict lint, secret scanning, docs checks and build. Changed-source ESLint passed explicitly and in the commit hook. The selected run used a clean detached checkout of the product SHA and the selector from canonical main.

Both `node_modules/.bin/tsx scripts/correlation-benchmark.mts --seed` and `node_modules/.bin/tsx scripts/correlation-benchmark.mts --seed --previous-baseline src/services/correlation/__tests__/fixtures/bench-correlation-v13.json` exited 0. Parsing their output and comparing with the tracked baseline found only `seededAt` for ordinary reseeding, and `seededAt` plus the intentionally appended audit `note` for migration. Numeric measurements, identities and tolerances match. Tampered previous evidence is separately tested to return nonzero and print no candidate JSON.

## Mutation proof

[Self-contained proof certificate](ACC508-MUTATIONS.json) pins the exact product and changed-file hashes. It embeds applied diffs, commands, raw failing assertions, numeric red counts, original/restored checksums and clean-state checks. All 21 new tests appear in an actual red run. There were 33 killed behavior reversals producing 45 failing subtests; no unresolved behavior gaps remained. Restored focused verification returned 21 pass / 0 fail.

One exploratory single-guard removal stayed green (1 pass / 0 fail) because another candidate-payload check still rejected the inherited-tolerance attack. It is retained in the certificate and excluded from the killed count. A different input independently proves the source guard, and a combined removal proves the overlapping tolerance protection. No survivor was silently claimed as a successful proof.

Counts below are pass/fail.

| Mutation | File mutated | Baseline → red |
|---|---|---|
| fixture-presence | src/services/correlation/__bench__/golden-streams.ts | 3/0 → 0/3 |
| fixture-causes | src/services/correlation/__bench__/golden-streams.ts | 3/0 → 1/2 |
| fixture-effects | src/services/correlation/__bench__/golden-streams.ts | 3/0 → 1/2 |
| planted-truth | src/services/correlation/__bench__/golden-streams.ts | 3/0 → 1/2 |
| rejected-candidate | src/services/correlation/bench-correlation.ts | 4/0 → 2/2 |
| realized-p | src/services/correlation/bench-correlation.ts | 4/0 → 3/1 |
| realized-margin | src/services/correlation/bench-correlation.ts | 4/0 → 1/3 |
| admitted-state | src/services/correlation/bench-correlation.ts | 4/0 → 2/2 |
| learned-state | src/services/correlation/bench-correlation.ts | 4/0 → 2/2 |
| finite-evidence | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| candidate-identity | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 2/2 |
| promotion-floors | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| family-agreement | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| lower-margin | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| upper-margin | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| ratio-integrity | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| slack-integrity | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| actual-recovery | src/services/correlation/bench-correlation-baseline.ts | 4/0 → 3/1 |
| candidate-authenticity | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| public-boundary-gate | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| baseline-witness | src/services/correlation/bench-correlation-baseline.ts | 2/0 → 1/1 |
| defensive-witness | src/services/correlation/bench-correlation-baseline.ts | 2/0 → 1/1 |
| migration-manifest | src/services/correlation/bench-correlation-baseline.ts | 2/0 → 1/1 |
| migration-source | src/services/correlation/bench-correlation-baseline.ts | 2/0 → 1/1 |
| migration-target-pins | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| schema-bump | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| cli-migration-route | scripts/correlation-benchmark.mts | 1/0 → 0/1 |
| committed-schema | src/services/correlation/__bench__/bench-correlation-baseline.json | 1/0 → 0/1 |
| retired-migration | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| implementer-fixture | src/services/correlation/__bench__/golden-streams.ts | 2/0 → 0/2 |
| implementer-migration | src/services/correlation/bench-correlation-baseline.ts | 1/0 → 0/1 |
| fabricated-absent-witness | src/services/correlation/bench-correlation.ts | 1/0 → 0/1 |
| preserved-old-emissions | src/services/correlation/bench-correlation.ts | 1/0 → 0/1 |

## Review, pending checks and rollback

Independent Sol review found no product blocker and confirmed the archived baseline identity, actual candidate path, unchanged old evidence, historical test meaning, local gate outputs and mutation evidence. The required opposite-agent conclusion is recorded separately in the branch's SHA-pinned verdict before publication. No provider integration changed, so live-provider probing is not applicable to ACC-508.

Hosted CI on the implemented ACC-508 code has not run because it has not been pushed. Separately, pushed ACC-505 #1856 completed 14 successful workflows and one failed Roadmap controller workflow: GitHub REST metadata lookup for historical PR #1533 returned HTTP 422, “too many files changed,” before reconciliation. A metadata-only GraphQL probe succeeds. That validation-workflow repair is outside this approved feature scope and is awaiting explicit approval; it is not hidden, bypassed, or included in this product. Both drafts remain held for hosted verification and publication approval.

Manual verification: run the benchmark and inspect the `boundary-a → boundary-b` row; run `test:acc508` to see easier/harder/family-growth rejection and actual CLI migration tests. Inspect the baseline diff's audit note and confirm unchanged tolerance values and original stream/rule evidence. No installed-app check or production data access was performed; no production recall uplift is claimed.

Rollback must revert fixture, report, comparator/schema, CLI routing and baseline together. A baseline-only rollback intentionally fails schema/identity validation. No data migration, notification change or production action is required.

## Commit and draft PR description

Implemented commit: `Catch lost causal relationships near the admission boundary`.

Proposed PR description: Add an explicitly planted causal coupling near the real promotion boundary, and fail the benchmark if it disappears or drifts too far inside the boundary. Record actual candidate evidence and use a pinned schema 13→14 baseline migration, preserving old streams, learned evidence and thresholds. Focused tests, 38 selected suites, guarded seed paths and mutation evidence validate the change. Production accuracy uplift remains unproven; installation, auto-merge and delivery are paused.
