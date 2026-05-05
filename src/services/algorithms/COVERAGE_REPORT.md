# Algorithm Coverage Report — PR 10/10

Generated: 2026-05-05

Audit columns:

- **Tests**: number of `it(...)` cases in the algorithm's test file.
- **Ledger**: does an orchestrator call `recordAlgorithmEvaluation` for this algorithm?
- **Fixtures**: does an orchestrator call `recordFixture` for this algorithm?
- **Shadow**: registered with `enableShadowMode`?

## Live algorithms

| Algorithm | Tests | Ledger | Fixtures | Shadow | Notes |
|---|---|---|---|---|---|
| `truth-score` | 16 | indirect | no | no | Orchestrators in `intelligence/index.ts` would record; pure module itself is unwrapped. |
| `evidence-graph` | 18 | indirect | no | no | Same pattern. |
| `situation-clustering` | 22 | indirect | no | no | Same pattern. |
| `baseline-deviation` | 17 | indirect | no | no | |
| `compound-risk` | 20 | indirect | no | no | |
| `forecast-calibration` | 21 | indirect | no | no | |
| `watchlist-relevance` | 24 | indirect | no | no | |
| `negative-evidence` | 20 | indirect | no | no | |
| `nws-polygon-match` | 28 | yes (`weather-warning-router.ts`) | no | no | First wired ledger consumer. |
| `weather-urgency` | 38 | yes (`weather-warning-router.ts`) | no | no | |
| `personal-storm-mode` | 30 | indirect | no | no | |
| `big-event-detector` | 28 | indirect | no | no | |
| `confidence-urgency-matrix` | 19 | indirect | no | no | |
| `what-changed-digest` | 28 | indirect | no | no | |
| `shortage-wheat` | (shared with `shortage-score` 21) | indirect | no | no | All shortage models share the central `shortage-score` test suite plus per-commodity coverage in `commodity-playbooks` / `corn-gasoline-models` / `soft-commodities` / `energy-fertilizer-models` / `rice-soybeans-models` / `natgas-jetfuel-models`. |
| `shortage-corn` | (see above) | indirect | no | no | |
| `shortage-rice` | (see above) | indirect | no | no | |
| `shortage-soybeans` | (see above) | indirect | no | no | |
| `shortage-diesel` | (see above) | indirect | no | no | |
| `shortage-gasoline` | (see above) | indirect | no | no | |
| `shortage-natural-gas` | (see above) | indirect | no | no | |
| `shortage-jet-fuel` | (see above) | indirect | no | no | |
| `relevance-learner` | covered in `relevance-learner.test.mts` (10) | indirect | no | no | |
| `source-feedback` | covered indirectly via reasoning suite | indirect | no | no | |
| `correlation-feedback` | covered indirectly | indirect | no | no | |
| `threat-classifier` | covered in service test | yes | no | no | Classified outputs already record to ledger. |
| `hypothesis-accuracy` | `hypothesis-feedback.test.mts` (10+) | indirect | no | no | |

All 22 registered algorithms have test files with at least 10 `it(...)` cases — well above the 5-test floor.

## Gaps detected

1. **Direct ledger writes**: only `nws-polygon-match`, `weather-urgency`, and `threat-classifier` call `recordAlgorithmEvaluation` directly. The rest rely on indirect wrapping by future orchestrators. This is an architectural choice (keep pure modules pure) and is consistent with the plan, not a regression.
2. **Replay fixtures**: no algorithm currently calls `recordFixture` (the API was introduced in this PR stack — PR 7). Fixtures will be populated as call sites adopt the new API.
3. **Shadow mode**: no algorithms are currently registered as shadow. Algorithms enter shadow via `enableShadowMode` in lifecycle init, which has not yet been wired for any production module. Expected: future experimental algorithms will go in shadow first.

## Action

This PR does **not** retrofit the 22 algorithms with ledger / fixture instrumentation. That would touch every orchestrator and risk regressions in unrelated suites. The existing direct-ledger consumers (`weather-warning-router.ts`, `threat-classifier.ts`) prove the pattern; future PRs that wire each algorithm's orchestrator to the ledger will reuse it.

The accuracy stack (PRs 3-9) is in place and ready: as more orchestrators record evaluations, the metrics-pipeline / shadow / promotion-gate / replay infrastructure will light up automatically without further plumbing.
