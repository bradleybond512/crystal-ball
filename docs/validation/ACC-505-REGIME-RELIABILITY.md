# ACC-505 — Regime-specific correlation reliability

Risk: high assurance. Roadmap task ACC-505, draft #1856. Product SHA `20e8b9ee26488d5f44b9f40a3f3f54c520f7e82b`. Implementation is local; installation, auto-merge and delivery remain paused. Production uplift is unproven.

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
