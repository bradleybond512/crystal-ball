# ACC-501 mutation proofs

Date: 2026-08-04

Reviewed implementation commit: `c5e63061`

The focused suite was green before mutation at `182 pass / 0 fail`.
All mutations below began from an empty `git status --short`. Each edit was
confirmed with `git diff` before the targeted test ran, then reverted with
`apply_patch`.

## Previous-baseline quality pin

- File: `src/services/correlation/bench-correlation-baseline.ts`
- Before checksum: `09dc7554529763a1cbe911b98aff597fc3d394d47ae5d9ea6ce6d83b792fd38e`
- Mutation: replaced the private previous-baseline comparison view with a
  freshly seeded baseline built entirely from the live report. This recreates
  the original compare-the-candidate-to-itself laundering path.
- Confirmed diff: `comparisonBaseline` changed from `{ ...previous, ...anchors }`
  to `seedCorrelationBenchBaseline(report, ...)`.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: `true !== false` in “refuses a candidate that regresses
  beyond the previous one-sided tolerance”.
- Restored checksum: `09dc7554529763a1cbe911b98aff597fc3d394d47ae5d9ea6ce6d83b792fd38e`.

## CLI refusal guard

- File: `scripts/correlation-benchmark.mts`
- Before checksum: `30f83fd2642cb48f1a02da85647dd1b0d741ea20b42a69db518f707a4c53c3a9`
- Mutation: changed `if (!comparison.ok)` to
  `if (false && !comparison.ok)`, bypassing the transition verdict.
- Confirmed diff: the CLI refusal branch was disabled while the comparator call
  remained present.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: the child process exited `0` instead of `1` and emitted a
  seeded candidate for a known regression.
- Restored checksum: `30f83fd2642cb48f1a02da85647dd1b0d741ea20b42a69db518f707a4c53c3a9`.

## Base-branch CI comparison

- File: `.github/workflows/smoke.yml`
- Before checksum: `e9f7ce86e207bc58c1bb83bddb0f1fbf53b36da123e7750e65d2cd6b2173aedc`
- Mutation: removed `--previous-baseline "$PREVIOUS_BASELINE"` from the PR and
  merge-queue guard, causing the command to compare against the candidate
  branch's tracked baseline instead of the base commit.
- Confirmed diff: the extracted base baseline remained unused by the command.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: the workflow no longer matched the required
  `--seed --previous-baseline "$PREVIOUS_BASELINE"` invocation.
- Restored checksum: `e9f7ce86e207bc58c1bb83bddb0f1fbf53b36da123e7750e65d2cd6b2173aedc`.

## Safe candidate destination

- File: `scripts/correlation-benchmark.mts`
- Before checksum: `30f83fd2642cb48f1a02da85647dd1b0d741ea20b42a69db518f707a4c53c3a9`
- Mutation: restored the unsafe instruction
  `npm run bench:correlation -- --seed > ${rel}`, which lets shell redirection
  truncate the tracked baseline before the process reads it.
- Confirmed diff: the failure guidance changed from `CANDIDATE_PATH` back to
  the tracked relative baseline path.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: “operator guidance must never redirect stdout onto the
  tracked baseline before validation”.
- Restored checksum: `30f83fd2642cb48f1a02da85647dd1b0d741ea20b42a69db518f707a4c53c3a9`.

## Restoration

Final checksums matched all pre-mutation values and final
`git status --short` was empty before this evidence file was added.
