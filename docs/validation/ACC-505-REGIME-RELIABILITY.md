# ACC-505 — Regime-specific correlation reliability

Risk: high assurance. Roadmap task ACC-505, draft #1856. Product SHA `20e8b9ee26488d5f44b9f40a3f3f54c520f7e82b`. Reviewed product code and the shared metadata repair were published. Bradley subsequently authorized reconciliation, publication and merging. Installation, release and deployment remain paused. Production uplift is unproven.

## Behavior and architecture

Rules use the current calm or shifted cohort after five outcomes in that cohort. Sparse or unknown evidence keeps the existing pooled multiplier, neutral below five outcomes overall. The existing scorer, rounding and 0.5–1.5 bounds remain intact.

Six production files changed: `pressure-history.ts` witnesses actual finite pressure/timestamps before existing display fallbacks; cognition `regime-scan.ts` and `regime-monitor.ts` qualify and cache regime evidence; correlation `correlation-calibration.ts` tags resolutions and selects bounded cohort scores; intelligence `forecast-calibration.ts` allowlists tags and tracks store revisions; correlation `island-calibration.ts` uses the same evidence time for feedback eligibility and scoring. No new dependency, provider, notification policy or runtime delivery channel was added. Three focused test files, package registration and additive test mappings cover the behavior.

Calm requires ten chronological valid samples per monitored domain and complete observation/scan freshness within four minutes. A validated positive shift qualifies despite another domain lacking coverage; its age must not exceed six hours. Disabled, missing, failed, stale or future evidence is unknown. New unscanned input clears classification until a successful scan. Older pressure history without an observation witness cannot establish calm.

Outcome tags are written once at successful pending-to-resolved transitions through pair and island paths. Legacy or malformed tags remain pooled; no historical backfill occurs. The dedicated ledger retains its 400-record cap. Current regime is checked at each lookup. Aggregate caches track store revisions, sixty-second expiry, future outcome eligibility and clock reversal. Diagnostics are defensive aggregate copies.

## Commands and actual results

Node 22 was selected with `/opt/homebrew/opt/node@22/bin`; TMPDIR was resolved to its physical path for test fixtures.

```text
npm run test:acc505
# pass 21
# fail 0

bash scripts/agentic-validate.sh --tests 'test:acc505 test:correlation'
# pass 453
# fail 0
Agentic validation gate passed.
Tests run: test:acc505 test:correlation

npm run bench:correlation
PASS — within tolerance of committed baseline (src/services/correlation/__bench__/bench-correlation-baseline.json).
```

The gate also executed the correlation suite, both TypeScript configurations, lockfile, strict lint, secret scan, documentation checks and build. Changed-source ESLint passed separately and through the commit hook. The trusted selector from canonical main ran on a clean detached checkout of the exact product SHA and returned:

```text
node <trusted-main-targeted-tests.mjs> --ci
[targeted-tests] 51 script(s) passed.
```

The evidence-only report commit does not change the validated source or tests.

The compatibility rehearsal combined UX-018 `3e0196629` with this product in an isolated temporary tree. Only additive package/script-map conflicts required reconciliation; there was no runtime source conflict. `test:acc505` returned `# pass 21` / `# fail 0`; `test:ux018` returned `# pass 113` / `# fail 0`; `typecheck:all` exited 0. No PR was merged or installed.

## Replay and mutation proof

[Replay results](ACC505-REPLAY.json) record two chronological synthetic arms, each with 12 earlier seed outcomes and 24 evaluated outcomes: 12 calm and 12 shifted. They drive real pressure ingress, the default detector, confidence kernel and ledger writers. Each arm learns only from earlier settled forecasts. Conditional Brier was 0.07301626 versus pooled 0.26701050. This deliberately constructed fixture demonstrates behavior, not a production uplift estimate.

[Mutation certificate](ACC505-MUTATIONS.json) pins the product SHA and all six production checksums. Every mutation started clean, confirmed the applied diff, recorded named failing assertions and numeric counts, restored its original checksum, and ended clean. The certificate embeds every applied diff and restored SHA256. All 33 mutations were caught, with 59 failing subtests and zero unresolved proofs. The restored combined suite returned 21 pass / 0 fail. Counts below are pass/fail.

| Mutation | File mutated | Baseline → red |
|---|---|---|
| raw-values | src/services/pressure-history.ts | 6/0 → 5/1 |
| raw-timestamp | src/services/pressure-history.ts | 6/0 → 5/1 |
| witness-required | src/services/cognition/regime-scan.ts | 6/0 → 2/4 |
| warm-threshold | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| chronology | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| pressure-bounds | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| scan-freshness | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| future-scan | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| observation-freshness | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| kill-read | src/services/cognition/regime-monitor.ts | 6/0 → 5/1 |
| shift-field-validation | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| shift-horizon | src/services/cognition/regime-scan.ts | 6/0 → 5/1 |
| positive-shift-incomplete | src/services/cognition/regime-scan.ts | 6/0 → 4/2 |
| unscanned-ingress | src/services/cognition/regime-monitor.ts | 6/0 → 5/1 |
| outcome-tag-island | src/services/correlation/correlation-calibration.ts | 14/0 → 10/4 |
| outcome-tag-pair | src/services/correlation/correlation-calibration.ts | 14/0 → 13/1 |
| cohort-threshold | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| conditional-selection | src/services/correlation/correlation-calibration.ts | 14/0 → 11/3 |
| sparse-fallback | src/services/correlation/correlation-calibration.ts | 14/0 → 8/6 |
| cache-revision | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| cache-time-reversal | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| cache-forward-boundary | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| future-outcome-exclusion | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| future-tag-exclusion | src/services/correlation/correlation-calibration.ts | 14/0 → 13/1 |
| loaded-tag-allowlist | src/services/intelligence/forecast-calibration.ts | 14/0 → 13/1 |
| resolved-tag-retention | src/services/intelligence/forecast-calibration.ts | 14/0 → 9/5 |
| outcome-immutability | src/services/intelligence/forecast-calibration.ts | 14/0 → 12/2 |
| cache-ttl | src/services/correlation/correlation-calibration.ts | 14/0 → 13/1 |
| diagnostic-isolation | src/services/correlation/correlation-calibration.ts | 14/0 → 13/1 |
| replay-conditional-selection | src/services/correlation/correlation-calibration.ts | 1/0 → 0/1 |
| directional-key-identity | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| crossfade-count-eligibility | src/services/correlation/correlation-calibration.ts | 14/0 → 12/2 |
| crossfade-decision-time | src/services/correlation/island-calibration.ts | 14/0 → 13/1 |

## Review, limitations and rollback

Independent Sol review found a P2 in the first product: island crossfade counted future labels that scoring excluded. The regression reproduced both an incorrect non-null multiplier and revival of a dismissed quake-to-tsunami rule (`19 pass / 2 fail`). The repair shares eligible counts and decision time; the suite became `21 pass / 0 fail`. Re-review and exact-source proof audit found zero remaining blockers. This consumed one repair cycle. The required opposite-agent conclusion is recorded separately in the branch's SHA-pinned review verdict before code publication.

No installed-app or production-data verification was performed. Existing records lack reliable historical regime tags, so prospective labeled holdout evidence is required before claiming production uplift. The classifier describes observed pressure telemetry, not safety or complete upstream sensor coverage. No external source changed, so a live-provider probe is not applicable.

Manual verification before any future approved delivery: run `test:acc505` and inspect its chronological replay diagnostic; verify the fourth outcome keeps pooled scoring and the fifth eligible same-regime outcome switches selection; disable the detector or supply incomplete input and confirm unknown-regime fallback. After an approved production trial, review aggregate cohort counts and matched holdout metrics without exporting raw records. Production observation remains pending while installation is paused.

Rollback the selection/tagging and shared-count changes together. Older readers ignore optional regime tags and use pooled outcomes; no stored-history rewrite is needed. Revert optional pressure witnesses and revision plumbing with their callers. Keep notification/delivery settings unchanged.

## Commit and draft PR description

Implemented commits: `Keep correlation reliability specific to qualified regimes`; `Use settled evidence consistently before replacing island feedback`.

Proposed PR description: Correlation rules use qualified calm/shifted outcomes when at least five same-regime resolutions exist, retaining pooled fallback otherwise. Outcome-time tags prevent later shifts from rewriting history, and island feedback eligibility uses the same settled evidence as scoring. Focused tests, chronological synthetic replay, mutation proofs and independent reviews cover the change. Production uplift remains unproven; installation, auto-merge and delivery are paused.

## CI repair follow-up

The original push completed 14 successful workflows and one Roadmap controller failure caused by GitHub REST metadata lookup for historical PR #1533. The approved local repair, validation and remaining hosted check are documented in [Roadmap metadata CI repair](ROADMAP-METADATA-CI-REPAIR.md). Original inference source and product evidence above remain unchanged.

## November 7 main reconciliation

Integrated merged main `4cc92fa7731b1416b7ee3d032081ae1c22b9eac9` in
`363d4762b37231b0a558a621c209037e26e4c9f1`. The only content conflict was
additive test mappings; every main mapping and ACC-505 mapping is retained.
The six ACC-505 production files are byte-identical to the prior reviewed
`a50f953f996073a638db9b297fe61877085dedaf` head. The shared roadmap CI repair
is already on main and is no longer a workflow change in this PR.

Fresh supported Node 22.23.1 validation, with its sibling npm and canonical
macOS TMPDIR, passed:

- `npm run test:acc505`: 21 pass / 0 fail.
- `npm run bench:correlation`: PASS against the unchanged schema-13 baseline.
- `bash scripts/agentic-validate.sh --tests 'test:acc505 test:correlation test:intelligence test:roadmap-controller test:workflow-security'`:
  respective suites 21, 453, 589, 126 and 61 pass, all zero failures;
  lockfile, strict lint, type checks, secrets, cross-agent configuration,
  docs, roadmap and build stages passed.
- Main-owned targeted selector: all 53 selected suites passed, including
  ACC-509/510 interaction coverage. Earlier Node 26 execution failed four
  infrastructure suites because of runtime/TAP/npm fixture assumptions;
  that failed run remains separate evidence, not a claimed pass. No assertion
  or validation rule was changed to obtain the supported-runtime pass.
- Complete live GitHub snapshot: 38 open main PRs plus 65 referenced records,
  103 total; candidate #1856 has `blocking: []` against the merged-main
  roadmap baselines. Both ACC-505 status mirrors now record DONE for scoped
  code/replay acceptance, with this candidate as evidence.
- Main-relative `git diff --check` passed. A merge-parent whitespace check
  reports inherited UX-035 assertion transcripts already on main; those
  evidence bytes were preserved unchanged.

The original 33 mutation proofs remain historical evidence and were not
re-executed during mechanical integration. Logs are local under
`/tmp/acc505-reconciliation/` (`gate-node22.log`, `selected-node22.log`,
`benchmark-node22.log`, `live-roadmap.json`, and `toolchain.txt`). No package,
registry version, workflow, install script or permissions change remains in
this PR's main-relative dependency scope; no dependency-age exception applies.
Final exact-head Sonnet review and hosted CI must pass before closeout.
Prospective production uplift remains unproven. No production data, install,
release, deployment or notification settings were changed.

## Chronological persisted-data repair (2026-11-07)

A bounded regression on the unmerged ACC-505 source found that a missing or
malformed `predictedAt` made `Math.max` return `NaN`, masking a valid future
`resolvedAt`. Five JSON-roundtripped future false outcomes incorrectly yielded
five eligible outcomes and a 0.5 multiplier. The repair normalizes only non-finite
issue timestamps to zero, consistent with the existing resolution-time handling.
Every valid future timestamp still gates availability independently; unknown
legacy timestamps/tags retain pooled fallback. No thresholds or regime policy
changed.

Behavior-first targeted result: 15 passed / 1 failed before the repair. Repaired
ACC-505 suite: 23 passed / 0 failed. Removing issue-time normalization makes the
new persisted-data regression fail; removing the outcome-boundary cache guard
also fails chronology coverage. Restored code passes all 23 ACC-505 cases.
Coverage includes JSON-persisted missing/malformed/null issue times, future
resolution, exact cache boundary, clock rollback, independent future issue times,
and unchanged valid/legacy outcomes. Runs use the canonical Node22 wrapper and
user TMPDIR. Private execution/mutation logs are in
`/tmp/accuracy-chronology-repair/`.

These focused runs do not replace aggregate/build and explicit `lint:ci`
qualification of the repaired composite, which remain pending at this checkpoint.
No prospective production uplift or final review is claimed.

### Repaired-composite qualification completed

Fresh execution at `6263c387954531a46f6e3ebe0544060b122774a7` in
`/tmp/acc505-chronology-repair` passed explicit `lint:ci` (1006 existing findings,
no increases; 13 changed files), correlation benchmark, and unchanged agentic
aggregate/build. Actual tests: ACC-505 23, correlation 455, intelligence 597,
UX-049 145 plus 23, roadmap 126, workflow security 61; zero failures. Node
22.23.1/npm 10.9.8 ran through the canonical wrapper with user TMPDIR. This
completion receipt supersedes the earlier pending checkpoint, not its history.

Selector planning against actual main `4edcc70c` selected 86 suites; that full
selector was **not** executed. Fresh execution was the prescribed scoped gate.
The new calibration/test hashes have new normalization/cache mutation evidence;
prior mutation receipts remain historical, not whole-file proofs for this repair.
All 674 built artifacts are hashed in the private execution receipt. Remaining
upstream #1840 dependency/review/hosted gates still apply. This final amendment
is documentation only; the execution SHA above remains the tested source.

### Actual-main transition after #1840 merged

Reconciled directly onto actual main
`1bf063349fd826072eff51ab5daf8797735c5176`, preserving upstream verdict/evidence.
Every non-evidence blob/mode matches repaired execution `6263c387` exactly,
including normalization, tests, tooling, package/locks and build configuration.
The 674 artifacts in that execution root were rehashed successfully; the original
PR worktree's older generated output is historical and is not relabeled as a
fresh build. Qualified Node22/npm/canonical TMPDIR and installed dependency roots
are retained. Prior new-guard mutation proofs match the unchanged repaired bytes.

The effective actual-main selector now plans 60 suites with no changed/newly
trusted commands or unmapped paths. `test:live-news-links` is no longer selected
because its relevant changed inputs are now main. This is a plan audit, not a
60-suite execution. No fresh full aggregate/lint/build is claimed for identical
inputs. The complete candidate-1856 live snapshot has no blocking dependencies.
Private current-main receipts: `/tmp/accuracy-main1bf-prep/`. Final exact-source
Sonnet review and hosted required checks remain pending; no readiness claimed.
