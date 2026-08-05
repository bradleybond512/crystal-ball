# ACC-501 mutation proofs

Date: 2026-08-04

Reviewed implementation commit: `870b08f6` (round 14) plus the round-15 working
tree on `claude/acc-501-round-14` — round 15 addressed a Codex REQUEST_CHANGES
review of PR #1625.

The focused suite was green before mutation at `182 pass / 0 fail` for the
round-14 mutations below, and grew to `216 pass / 0 fail` (full
`bench-correlation.test.mts`) plus `409 pass / 0 fail` (`npm run
test:correlation`) by round 15. All mutations began from a `git status
--short` containing only this session's legitimate round-15 diff (no
unrelated changes); each file's SHA-256 was recorded before and after every
mutation to confirm exact restoration, and each edit was confirmed with `git
diff`/`git status --short` before its targeted command ran.

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

## Covered-rule liveness floor

- File: `src/services/correlation/bench-correlation-baseline.ts`
- Before checksum: `cb714f0f7b91f706b378221a02c486410c054b4c94fc2c16b3ba0d20ba2b4ffe`
- Mutation: removed `checkReseedRuleCoverage(previous, report)` from reseed
  preflight, recreating the path where a previously firing built-in rule could
  disappear while aggregate metrics stayed healthy.
- Confirmed diff: the preflight array no longer invoked the coverage subset
  check.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: `true !== false` in “refuses to reseed when a previously
  covered built-in rule goes dark”.
- Restored checksum: `cb714f0f7b91f706b378221a02c486410c054b4c94fc2c16b3ba0d20ba2b4ffe`.

## Initial baseline CI path

- File: `.github/workflows/smoke.yml`
- Before checksum: `a2f7d64dbbe6cdca5608fdbac4f23bb94c70f17c3a3989d7cdf4432b62f98efc`
- Mutation: removed the missing-base `git cat-file` guard, recreating the path
  where the first baseline addition attempts to extract a file that does not
  exist on the base branch.
- Confirmed diff: the workflow proceeded directly from `BASELINE_PATH` to the
  baseline-change check without testing whether the base object exists.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: “the first baseline addition has no base-branch baseline
  to compare against”.
- Restored checksum: `a2f7d64dbbe6cdca5608fdbac4f23bb94c70f17c3a3989d7cdf4432b62f98efc`.

## Unavailable base commit fails closed

- File: `.github/workflows/smoke.yml`
- Before checksum: `852aa154f9cd1eb8027abdc2d70f0ce4b9af0cef95bbf21fa209145e138353c5`
- Mutation: removed the independent `git cat-file` validation for the base
  commit, recreating the path where an invalid or unavailable SHA is mistaken
  for a legitimate initial baseline.
- Confirmed diff: the workflow again proceeded directly to the path lookup,
  whose failure exits successfully.
- Targeted result: `0 pass / 1 fail`.
- Failing assertion: “an unavailable base commit must fail closed before
  checking for an initial baseline”.
- Restored checksum: `852aa154f9cd1eb8027abdc2d70f0ce4b9af0cef95bbf21fa209145e138353c5`.

## Round 15 — learned-rule resync self-attestation

Codex's review of PR #1625 found `checkLearnedRuleResync` validated only the
report's own internal consistency, never re-deriving `afterRetirement`
against a live engine — so a producer that started computing it
arithmetically (`installed.filter(id => id !== retiredId)`) instead of
calling `engine.getRules()` would satisfy every check while the underlying
removal path went unmeasured. The fix added `verifyResyncProbe()`
(`__bench__/rule-probe-verify.ts`), which constructs its own fresh
`CorrelateEngine`, runs the same install→retire→resync sequence independently
of the producer, and the gate now demands the two agree.

- Files: `src/services/correlation/bench-correlation.ts` (before
  `62b008e868e5e7e0e73ee59b645670828149181727f510a1881e217c8a03020f`),
  `src/services/correlation/learned-rules.ts` (before
  `5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546`).
- Mutation 1 alone: changed `probeLearnedRuleResync`'s `afterRetirement` from
  `learnedIdsOf()` (a live `engine.getRules()` query) to
  `installed.filter((id) => id !== retiredId)` (self-attested arithmetic).
  Result: `npm run bench:correlation` still **PASSED** — the arithmetic
  answer happens to equal the true engine state when the underlying removal
  actually works, so this alone doesn't prove the removal path is exercised.
  This matches the framing of the defect precisely: self-attestation isn't
  wrong on the happy path, only silent on the path where the system it claims
  to have queried actually breaks.
- Mutation 2 (combined with mutation 1, recreating the historical bug the
  file's own doc comment describes — "Deleting `engine.unregisterRule` from
  `syncLearnedRules()` left a retired coupling permanently installed... while
  the function REPORTED it removed"): removed the
  `engine.unregisterRule(existing.id)` call from `syncLearnedRules` in
  `learned-rules.ts`, so retirement stops actually removing the rule from the
  engine while `removed += 1` still increments.
- Targeted result: `npm run bench:correlation` → **FAIL**.
- Failing assertion: `the learned-rule resync probe does not reproduce: the
  report says {..."afterRetirement":["learned:cyber->finance", ...4 ids]...}
  and re-running the retirement against a live engine gives
  {..."afterRetirement":[...5 ids, including the one reported retired]...}` —
  `verifyResyncProbe()`'s independently-constructed engine still has the rule
  installed; the producer's self-attested field claims it is gone.
- Restored checksums: both files matched their pre-mutation SHA-256 exactly;
  `git status --short` returned only the pre-existing round-15 diff.

## Round 15 — v12→v13 migration self-consistent forgery

Codex also found `validateCorrelationBenchV12ToV13Migration` reconstructed
its own "previous v12 baseline" comparison object from data available at
validation time, with nothing pinning that reconstruction to the actual
reviewed v12 payload — a forged previous baseline that moved a value in
lockstep on both sides of the comparison would pass. The fix added
`previousPayloadDigest`, computed once from the real `origin/main` v12
baseline and pinned in `CORRELATION_BENCH_V12_TO_V13_MIGRATION`, checked via
`benchBaselinePayloadDigest()` against whatever baseline is actually being
migrated from.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Before checksum:
  `dd078f9e8d6044b3eb1d7e454f8867a37032d6f27397d52b026d96a1675b7d6c`.
- Mutation: short-circuited the payload-digest check with `if (false && ...)`,
  disabling it while leaving `previousPayloadDigest` itself and every other
  check in place.
- Confirmed diff: the digest comparison branch became dead code.
- Targeted result: `node --import tsx --test
  src/services/correlation/__tests__/bench-correlation.test.mts` →
  `214 pass / 1 fail`.
- Failing assertion: exactly `refuses a previous baseline whose payload is
  not the reviewed one` failed; no other test in the 215-test file was
  affected, confirming the disabled check — not some other path — was what
  that test exercises.
- Restored checksum:
  `dd078f9e8d6044b3eb1d7e454f8867a37032d6f27397d52b026d96a1675b7d6c`.

## Round 15 — the "broken tolerance" re-seed test was not constructed

Codex's third finding was a P2 on
`refuses to re-seed over a broken tolerance without --force`: it ran
`--seed` against the committed baseline (which passes today) and accepted
either `Seeded from the current run` or `REFUSED` as a pass — a CLI that
always printed one of those two strings regardless of what the comparator
did would satisfy the assertion. It never constructed a baseline the live
run actually violates, so it proved the CLI can print those words, not that
`--seed` compares anything.

The fix replaces it with two tests built on the CLI's own
`--previous-baseline <path>` override:

- **Refusal case**: writes a temp copy of the committed baseline with
  `couplingPrecision: 1.5` (unreachable — precision is a fraction) and
  `tolerances.couplingPrecisionDrop: 0`, runs `--seed --previous-baseline
  <temp>`, and asserts exit code `1`, `REFUSED` plus the specific `miner
  coupling precision` reason on stderr, and that stdout carries no seeded
  JSON (`"schemaVersion"` absent).
- **Positive control**: writes an unmodified, internally consistent copy of
  the committed baseline as `--previous-baseline` and asserts exit code `0`,
  `Seeded from the current run` on stderr, no `REFUSED`, and a parseable
  seeded object on stdout — proving the comparator ran and passed on its own
  merits rather than the refusal path being unreachable.

Two earlier attempts at the positive control failed for reasons worth
recording: raising `couplingPrecision` alone past its drop tolerance without
loosening the tolerance tripped the refusal (expected); loosening the
tolerance to `1` tripped a *different* guard — `bench-correlation-baseline.ts`
refuses any tolerance width above a `0.1` ceiling ("a tolerance wide enough
to absorb the whole measurement disarms its gate while still looking
armed"); and setting `couplingPrecision: 0` with a `0.05` tolerance tripped a
third guard against non-positive baseline metrics ("a non-positive baseline
permanently disarms the gate it feeds"). All three are the gate's own
defenses working correctly, not obstacles to route around — the final
version validates against an object with no manufactured internal
inconsistency at all.

- File: `src/services/correlation/__tests__/bench-correlation.test.mts`.
- No source mutation was needed here — the previous test was a coverage gap
  in the *test*, not a defect in `bench-correlation.ts` or
  `bench-correlation-baseline.ts`, so this section documents construction and
  verification, not a mutation/restore round-trip. Verified by running both
  new tests: refusal case exits `1` with the expected reason text; positive
  control exits `0` with a parseable candidate. Full suite: `216 pass / 0
  fail`.

## Round 16 — Codex REQUEST_CHANGES on round 15 (four findings)

Round 15 was sent for cross-agent review and came back `Verdict:
REQUEST_CHANGES` with one P1 and three P2 findings. All four are fixed here.

### P1 — migration source remained forgeable via unpinned tolerances

`V13_MAY_MOVE` excludes `tolerances` from `benchBaselinePayloadDigest` so an
ordinary (non-migration) reseed can edit tolerances freely — but
`validateCorrelationBenchV12ToV13Migration` carried the caller-supplied
`previousV12.tolerances` straight into the seeded candidate and, via
`checkMigrationSharedGates`, into grading, with nothing authenticating it.
Codex's repro: widening `couplingPrecisionDrop` from `0.02` to `0.1` in the
supplied previous baseline still returned `{ok:true,reasons:[]}`.

Fix: added `previousTolerancesDigest` to `CorrelationBenchMigrationV12ToV13`,
pinned once via a new `benchTolerancesDigest()` helper computed over the real
reviewed v12 `tolerances` block, and validated inside
`validateCorrelationBenchV12ToV13Migration` independently of the
`V13_MAY_MOVE` exemption — so tolerances remain editable at ordinary reseed
time but a migration can't be graded against unreviewed tolerances.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Before checksum: `dd078f9e8d6044b3eb1d7e454f8867a37032d6f27397d52b026d96a1675b7d6c`
  (same file identity as the round-15 entry above, prior to this round's edits).
- Verified via `refuses a previous baseline whose tolerances are not the
  reviewed ones — the shared-gate forgery Codex found` in
  `bench-correlation.test.mts`: reproduces Codex's exact repro
  (`couplingPrecisionDrop: 0.02 → 0.1`) against the fixed code and confirms
  `ok:false` with the new `does not carry the reviewed v12 tolerances`
  reason. No source mutation/restore round-trip needed for this one — it's a
  new check with no prior code path to mutate; the negative test above
  demonstrates it fires, and `accepts the real additive transition with its
  real, unforged tolerances` demonstrates the pinned digest matches the real
  reviewed value so genuine migrations still pass.

### P2 — refusal test never reached `checkDrop`

The round-15 refusal test used `couplingPrecision: 1.5`, which trips an
earlier baseline range-validity guard (`[0,1]`) before ever reaching the
tolerance-comparison logic (`checkDrop`) the test claimed to exercise — so it
proved the CLI refuses invalid input, not that the tolerance gate works.

Fix: rewrote the test to use `meanTruePairConfidence: 1` (valid — sits at the
metric's own ceiling) with `meanTruePairConfidenceDrop: 0`, forcing
`checkDrop`'s own `baseline - live > tolerance` branch to fire for real
(`report.meanTruePairConfidence` is provably below `1`). Asserts the actual
`checkDrop` diagnostic format (`/exceeds .* tolerance/`), not just `REFUSED`.

- File: `src/services/correlation/__tests__/bench-correlation.test.mts`.
- No source mutation needed — this was a test-construction defect, the same
  category as the original round-15 finding it's fixing. Verified by running
  the corrected test: exits `1`, stderr matches `mean true-pair confidence`
  and `exceeds .* tolerance`, stdout carries no seeded JSON.

### P2 — positive control too permissive

The round-15 positive-control test only checked `typeof seeded.schemaVersion
=== 'number'`, which would pass even if the CLI dropped or corrupted every
other field.

Fix: the positive control now compares the seeded output against the
committed baseline field-by-field (union of both objects' keys, so a dropped
field is caught too), excluding only the bookkeeping fields an ordinary
reseed is allowed to touch (`schemaVersion`, `seededAt`, `note`,
`reportDigest`, `witnessed`) — reachable because the corpus is frozen and the
benchmark is deterministic, so a fresh seed against an unmodified previous
baseline reproduces every graded field exactly.

- File: `src/services/correlation/__tests__/bench-correlation.test.mts`.
- Verified: the strengthened assertion passes against the real CLI output
  (`refuses to re-seed against a --previous-baseline whose tolerance the live
  run actually violates` / `seeds cleanly against a --previous-baseline the
  live run genuinely satisfies` both still pass; the latter now exercises the
  field-by-field comparison, not just a `typeof` check).

### P2 — one-hop migration not enforced at runtime

`manifest.toSchemaVersion === CORRELATION_BENCH_SCHEMA_VERSION` was only
asserted by a unit test (`pins the migration to exactly one hop`), not by the
validator function itself — a future schema bump that forgot to retire or rev
this migration would pass every check in
`validateCorrelationBenchV12ToV13Migration` and silently become a two-hop
migration wearing a one-hop label.

Fix: added a runtime check inside `validateCorrelationBenchV12ToV13Migration`
comparing `manifest.toSchemaVersion` against the live
`CORRELATION_BENCH_SCHEMA_VERSION` constant, pushing a refusal reason if they
diverge.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Note on testability: the function's manifest-identity guard
  (`JSON.stringify(manifest) !== JSON.stringify(CORRELATION_BENCH_V12_TO_V13_MIGRATION)`)
  refuses any manifest that isn't byte-identical to the pinned module
  constant, which means this new check's only reachable failure mode in
  production is the pinned constant itself drifting from
  `CORRELATION_BENCH_SCHEMA_VERSION` — not independently mutable via a test
  argument without also tripping the identity guard first (both reasons
  would fire together; the identity guard firing is not a bypass, it's proof
  the two constants can't drift independently). Verified via `the runtime
  one-hop check is real code, not just a test-level assertion` — confirms
  the real manifest and the real schema-version constant agree, and that
  `validateCorrelationBenchV12ToV13Migration` returns `ok:true` under that
  agreement, so the added check does not falsely refuse the real migration.

### P2 — union-of-keys drop detection was untested (mutation proof)

The migration validator iterates the union of `candidate` and `before` keys
specifically so a field present in the reviewed baseline but no longer
produced by the live seed function is visible (`before`-only keys) — not just
fields the candidate happens to still carry. No existing test forced that
distinction: the existing "sees a forbidden field that was DROPPED" test
deletes a field from `before`, but `candidate` still carries that same key
(sourced live from `report`), so candidate-only iteration would already catch
it — that test doesn't actually prove the union is load-bearing.

Added a complementary test — `sees a field the reviewed baseline HAD that the
live candidate no longer produces at all` — using a `before` with an extra
field (`legacyRetiredField: 42`) that the candidate-producing path never
emits, so only union iteration visits it.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Before checksum: `04696770b63a5ba784692bb0ddbac66743f26b862d9ac9926177191974b3dbe6`.
- Mutation: `const keys = [...new Set([...Object.keys(candidate),
  ...Object.keys(before)])]` → `const keys = [...new
  Set([...Object.keys(candidate)])]` (dropped the `before` half of the union).
- Confirmed diff: `git diff` showed exactly the one-line key-union narrowing.
- Targeted result: `node --import tsx --test
  src/services/correlation/__tests__/bench-correlation.test.mts` →
  `219 pass / 1 fail`.
- Failing assertion: exactly `sees a field the reviewed baseline HAD that the
  live candidate no longer produces at all` failed — actual reason was
  `does not carry the reviewed v12 payload` (from the earlier payload-digest
  guard, which also fires for this fixture) instead of the expected
  `legacyRetiredField moved from 42 to undefined` (which only the
  union-iterating field loop produces) — confirming the union half of the key
  set is what makes that specific reason reachable. No other test in the
  220-test file was affected.
- Restored checksum: `04696770b63a5ba784692bb0ddbac66743f26b862d9ac9926177191974b3dbe6`
  (matches before checksum exactly).

Full suite after all four round-16 fixes: `220 pass / 0 fail`
(`bench-correlation.test.mts`), `413 pass / 0 fail` (`npm run
test:correlation`), `npm run bench:correlation` → PASS, `npx tsc --noEmit`
(both tsconfig.json and tsconfig.api.json) → 0 errors.

## Round 17 — Codex REQUEST_CHANGES on round 16 (three findings)

Round 16 was sent for a second cross-agent review and came back a second
genuine `Verdict: REQUEST_CHANGES` with three P2 findings, all fixed here.

### P2 — positive control still permitted corrupted seed output

Codex re-ran the positive-control test (`seeds cleanly against a
--previous-baseline the live run genuinely satisfies`) and found the round-16
`mayDiffer` exclusion set (`schemaVersion`, `seededAt`, `note`,
`reportDigest`, `witnessed`) was wider than necessary — a fresh, unmodified
reseed only ever legitimately changes `seededAt` (a wall-clock timestamp);
`schemaVersion`, `note`, `reportDigest`, and `witnessed` are all reproduced
exactly. With the wider set, the test would still pass against a CLI that
emitted a forged `schemaVersion`, a stale `reportDigest`, or a missing
`witnessed` block.

Fix: narrowed `mayDiffer` to `{'seededAt'}` only.

- File: `src/services/correlation/__tests__/bench-correlation.test.mts`.
- No source mutation needed — this was a test-construction defect (the
  exclusion set was over-broad), the same category as the round-15/16
  findings it's fixing. Verified by re-running the narrowed test against the
  real CLI: still passes, confirming `schemaVersion`, `note`, `reportDigest`,
  and `witnessed` are in fact reproduced exactly on a genuine reseed, and
  that the test would now fail if any of them weren't.

### P2 — runtime one-hop guard had no load-bearing mutation proof

The round-16 test for the `toSchemaVersion` runtime check asserted only that
the module constant and the live schema version agree — its comment claimed
"if the runtime check in the source were deleted, this still passes,"
treating the check as untestable given the earlier manifest-identity guard.
Codex asked for an actual mutation, not that assumption.

Performing the mutation disproved the comment's own claim: mutating the
*value* of `CORRELATION_BENCH_V12_TO_V13_MIGRATION.toSchemaVersion` (not
deleting the runtime check) leaves the manifest self-identical (it's compared
against itself via the same imported constant), so the identity guard still
passes — and the runtime check then correctly refuses, proving it IS
reachable through the real validator, just not via a caller-supplied
mismatched manifest object.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Before checksum: `081b535902de7c75eeb090b8c18083af17ccbdf32af6d227202cc1a50577a511`.
- Mutation: `toSchemaVersion: 13,` → `toSchemaVersion: 99 as unknown as 13,`
  on `CORRELATION_BENCH_V12_TO_V13_MIGRATION` (bypasses the TS literal type
  since `tsx` transpiles without type-checking; the mismatch is real at
  runtime).
- Confirmed diff: `git diff` showed exactly the one-line value change.
- Targeted result: `bench-correlation.test.mts` → `217 pass / 3 fail`.
- Failing tests: `accepts the real additive transition` — failed with reason
  `v12→v13 migration manifest targets schemaVersion 99, but the compiled gate
  is schemaVersion 13 — this migration is no longer the one-hop path to the
  live schema` (the real validator's refusal, proving the check fires
  through the public function); `pins the migration to exactly one hop` and
  `the runtime one-hop check is real code, not just a test-level assertion`
  — both failed on `99 !== 13`, as expected for assertions against the
  mutated constant. No other test in the 220-test file was affected.
- Restored checksum: `081b535902de7c75eeb090b8c18083af17ccbdf32af6d227202cc1a50577a511`
  (matches before checksum exactly).
- The test's comment was corrected to remove the disproven "if deleted, this
  still passes" claim and point to this proof instead of asserting an
  untested assumption.

### P2 — tolerances-authentication check (P1 fix) lacked mutation proof

Round 16's write-up said the new `previousTolerancesDigest` check had "no
prior code path to mutate" since it was newly added. Codex correctly pointed
out this reasoning doesn't hold — a newly added check still has code that can
be short-circuited to prove the corresponding test depends on it, same as
any other check in this function.

- File: `src/services/correlation/bench-correlation-baseline.ts`.
- Before checksum: `081b535902de7c75eeb090b8c18083af17ccbdf32af6d227202cc1a50577a511`
  (same file identity as the toSchemaVersion proof above, run as a separate
  mutation after restoring that one).
- Mutation: `if (benchTolerancesDigest(previousV12.tolerances) !==
  manifest.previousTolerancesDigest)` → `if (false &&
  benchTolerancesDigest(...) !== manifest.previousTolerancesDigest)`
  (short-circuits the check to never fire).
- Confirmed diff: `git diff` showed exactly the one-line `false &&` insertion.
- Targeted result: `bench-correlation.test.mts` → `219 pass / 1 fail`.
- Failing test: exactly `refuses a previous baseline whose tolerances are not
  the reviewed ones — the shared-gate forgery Codex found` failed on
  `true !== false` (the test's `assert.equal(ok, false)` — with the check
  short-circuited, the forged-tolerance fixture is accepted as `ok:true`). No
  other test in the 220-test file was affected, confirming this is the sole
  test depending on the check.
- Restored checksum: `081b535902de7c75eeb090b8c18083af17ccbdf32af6d227202cc1a50577a511`
  (matches before checksum exactly).

Full suite after all three round-17 fixes: `220 pass / 0 fail`
(`bench-correlation.test.mts`), `npx tsc --noEmit` (both tsconfig.json and
tsconfig.api.json) → 0 errors.

## Restoration

Final checksums matched all pre-mutation values for every mutated file across
round 14, round 15, round 16, and round 17, and `git status --short` after
each restoration showed only the legitimate source diff for that round — no
residual mutation.
