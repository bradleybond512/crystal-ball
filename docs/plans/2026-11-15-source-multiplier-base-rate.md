# Source reliability multipliers reward base rates, not skill

> Status: PROPOSED. Awaiting Bradley's decision. No code changes in this PR.
> Author: Claude (independent audit of `main` at `92ff943df`, November 15, 2026)
> Proposed roadmap task: a new `ACC-5xx` entry in
> `docs/PREDICTION_ACCURACY_ROADMAP.md` (not claimed here; the board is unchanged).

## Why this needs a decision

`perSourceMultipliers` in `src/services/intelligence/forecast-calibration.ts`
feeds the live correlation path: `correlation/correlation-calibration.ts` calls
it per rule and per regime, and the result scales rule confidence. Changing it
changes what the app alerts on and moves the ACC-501 frozen benchmark, so it is
High Assurance and needs approval before implementation.

## Evidence

All numbers below come from running the current code on `main`.

| Source | Behaviour | Resolved | Brier | Multiplier |
| --- | --- | --- | --- | --- |
| `rare-no-skill` | 5% base rate, always predicts 5% | 100 | 0.048 | 1.404 |
| `rare-always-zero` | 5% base rate, always predicts 0%, misses every event | 100 | 0.050 | 1.400 |
| `even-skilled` | 50% base rate, 80/20 forecasts, calibrated | 100 | 0.160 | 1.180 |
| `n5-lucky` | five 90% forecasts, all true | 5 | 0.010 | 1.480 |
| `n5-one-miss` | five 90% forecasts, four true | 5 | 0.170 | 1.160 |
| `n5-two-miss` | five 90% forecasts, three true | 5 | 0.330 | 0.840 |

Four defects follow.

1. **Base rate is ignored.** The multiplier is `clamp(0.5, 1.5, 1.5 - 2 * brier)`,
   anchored on a Brier of 0.25 as "fair coin". That anchor is only correct when
   events occur half the time. A source that never predicts a rare event, and
   misses every one, earns 1.40x. A skilled source on balanced events earns
   1.18x.
2. **Five outcomes move the weight across most of its range.** With
   `MIN_REGIME_RESOLVED = 5`, one resolution moves the multiplier from 1.48 to
   1.16, and a second to 0.84.
3. **Per-domain `calibrationError` measures bias only.** It is
   `|mean(probability) - hitRate|`. A domain that says 90% half the time and
   10% the other half, with a 50% hit rate either way, reports an error of 0
   with a Brier of 0.41.
4. **No data reads as a perfect score.** `brierScore([])` returns `score: 0`,
   which is the best possible value, so unresolved sources and domains sort and
   display as flawless.

## Proposal

### 1. Skill-based multiplier

Score each source against a climatological reference built from the pooled
base rate of the records passed in (all rules, or all rules in a regime):

- `baseRate` = fraction of resolved records that resolved true, over the pool.
- `brierRef` = mean of `(baseRate - outcome)^2` over the **source's** outcomes.
- `skill` = `1 - brier / brierRef`, clipped to `[-1, 1]`. When `brierRef` is 0
  the skill is undefined and the multiplier stays 1.0.

### 2. Shrinkage in place of a hard threshold

- `shrunk` = `skill * n / (n + k)` with `k = 10`.
- `multiplier` = `clamp(0.5, 1.5, 1 + 0.5 * shrunk)`.

The multiplier then moves gradually from 1.0 as outcomes accumulate.
`minResolvedForMultiplier` is kept as a floor so existing callers are
unaffected below it.

Expected results on the table above: both rare-event sources fall to about 1.0
or below, `even-skilled` stays above 1.0, and the three five-outcome sources sit
within roughly 0.1 of 1.0.

### 3. Binned calibration error per domain

Replace the bias measure with `calibrationErrorFromRecords(...).ece` from
`proper-scoring.ts`, and keep the old value under a new `bias` field so nothing
that displays it loses information.

### 4. `null` for no data

`brierScore` returns `score: null` when nothing is resolved. Callers that sort
or render it handle `null` explicitly. This is the widest change (type-level)
and can ship as its own PR.

### 5. One scoring module

`forecast-calibration.ts` and `proper-scoring.ts` both define `brierScore`.
Keep the `proper-scoring.ts` implementation and re-export it.

## Decisions for Bradley

1. Approve the skill-based multiplier (sections 1 and 2), or keep the current
   formula.
2. Reference base rate: pooled across the records passed in (proposed), or the
   hierarchical base-rate model from ACC-301.
3. Shrinkage constant `k`: 10 (proposed).
4. Whether section 4 ships with this work or separately.

## Verification plan

- Unit tests for every row of the evidence table, before and after.
- `npm run bench:correlation` before and after; any precision or recall change
  recorded in the PR, with the ACC-501 baseline regenerated only if approved.
- `npm run test:intelligence` and `npm run typecheck:all`.
- Rollback: the change is confined to one pure function; revert the PR.
