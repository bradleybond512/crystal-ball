# ACC-702 Mutation Proofs

Date: 2026-08-03

Baseline commits: `59a822eb96cb53cd9f0afe6a28bc6a139a8d9f4a`,
`b8ce8d05`, and `4676530f`.

Every proof started with an empty `git status --short`, recorded
`shasum -a 256`, applied the listed patch, confirmed a nonempty
`git diff -- <file>`, ran the exact command, restored the patch, and verified
the original checksum plus an empty status and diff. Mutations and restores
used `apply_patch` only.

## 1. Champion model allowlist

File: `src/services/cognition/champion-status-runtime.ts`

Baseline and restored SHA-256:
`7a170a7e6e3a6655644b38d9f63b064c90a90c76fda134e8af7288ff1e85ae9d`

```diff
 function knownModelOf(value: unknown): KnownModel {
-  return typeof value === 'string' && KNOWN_MODELS.has(value as KnownModel)
-    ? value as KnownModel
-    : 'unknown';
+  return typeof value === 'string' ? value as KnownModel : 'unknown';
 }
```

Command:

```bash
npx tsx --test src/services/cognition/__tests__/champion-status-runtime.test.mts
```

Raw summary: `ℹ pass 8`, `ℹ fail 1` (baseline: `9`, `0`).

Failure: `maps unknown models, nulls unsafe versions, and allowlists domains`
received active model `MODEL_SENTINEL` instead of `unknown`.

## 2. Sidecar challenger cap

File: `src-tauri/sidecar/local-api-server.mjs`

Baseline and restored SHA-256:
`4f824414233f699ed6501cb15eb687f02863410f8e0511c0160f791ab128ce03`

```diff
-  if (!Array.isArray(input.challengers) || input.challengers.length > 4
+  if (!Array.isArray(input.challengers)
       || !Array.isArray(input.promotions) || input.promotions.length > 6) return null;
```

Command:

```bash
node --test src-tauri/sidecar/__tests__/analyst-diagnostics-mirror.test.mjs
```

Raw summary: `ℹ pass 4`, `ℹ fail 1` (baseline: `5`, `0`).

Failure: `invalid evaluation-report updates preserve the last valid projection
atomically` received five challengers instead of retaining the previous valid
one-challenger projection.

## 3. Stale diagnostics detection

File: `tools/mcp-server/tools/monitor.mjs`

Baseline and restored SHA-256:
`ae347e2b5fe8cc046fb60e3e0ef229cb5a987e9b42a810f417b5207a09175816`

```diff
-    algorithmDiagnosticsStale: algorithmResult?.stale === true,
+    algorithmDiagnosticsStale: false,
```

Command:

```bash
node --test tools/mcp-server/__tests__/monitor-tools.test.mjs
```

Raw summary: `ℹ pass 21`, `ℹ fail 1` (baseline: `22`, `0`).

Failure: `monitor marks stale diagnostics red and hands fresh projections to
weekly evaluation` reported `false !== true`; the stale red finding vanished.

## 4. Committed-generation gate

File and checksum: same as proof 3.

```diff
-      const committed = committedGeneration(storage, generationId);
+      const committed = { state, events: eventState };
```

Command:

```bash
node --test tools/mcp-server/__tests__/monitor-tools.test.mjs
```

Raw summary: `ℹ pass 21`, `ℹ fail 1` (baseline: `22`, `0`).

Failure: `monitor refuses weekly recording when the committed history
generation mismatches` raised `Missing expected rejection` for
`/committed monitor generation/i`.

## 5. Monday UTC bucketing

File: `tools/mcp-server/weekly-evaluation-report.mjs`

Baseline and restored SHA-256:
`5525c86db5925476b6e751feae3461314e2903d850b505249692b8f8623d5607`

```diff
-  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
+  const daysSinceMonday = date.getUTCDay();
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ pass 10`, `ℹ fail 9` (baseline: `19`, `0`).

Failures shifted week starts by `86400000` ms and broke rollover, first-install,
manual generation, immutable filenames, catch-up, and recursive validation.

## 6. Shared report lock

File and checksum: same as proof 5.

```diff
-  const releaseLock = acquireLocalLock(storage.resolve(REPORT_LOCK_PATH), lockOptions);
+  const releaseLock = acquireLocalLock(storage.resolve('monitor/report-generate.lock'), lockOptions);
```

The changed occurrence was in `recordWeeklyEvaluation`.

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ pass 18`, `ℹ fail 1` (baseline: `19`, `0`).

Failure: `serializes concurrent writers and preserves the prior accumulator on
atomic failure` raised `Missing expected exception` for `/already running/i`.

## 7. Provider privacy allowlist

File and checksum: same as proof 5.

```diff
 const PROVIDER_ROUTES = Object.freeze({
@@
   'fear-greed': '/api/fear-greed',
+  'private-token-route': '/api/private-token-route',
 });
@@
-    && providers.rows.length <= 10
+    && providers.rows.length <= 11
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ pass 18`, `ℹ fail 1` (baseline: `19`, `0`).

Failure: `reports bookend prediction/model deltas and allowlisted provider
transitions` received 11 rows instead of 10, including the injected private
route. A preliminary spread mutation produced a confirmed diff but remained
`ℹ pass 19`, `ℹ fail 0`; it was restored and excluded because downstream
aggregation correctly discarded the field.

## 8. Catch-up cap

File and checksum: same as proof 5.

```diff
-  const selected = candidates.slice(0, MAX_CATCHUP_WEEKS);
+  const selected = candidates;
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ pass 18`, `ℹ fail 1` (baseline: `19`, `0`).

Failure: `continues oldest-first catch-up across invocations without skipping
unavailable gaps` generated 13 reports instead of the bounded 8.

## 9. MCP registry parity

File: `tools/mcp-server/tool-registry.mjs`

Baseline and restored SHA-256:
`60f3af9eea3a2e305d79f12d84fe425ab79091af0db2686c8c13be496fa07f3f`

```diff
-    get_weekly_evaluation_report: 'Read the latest or a selected completed weekly algorithm evaluation report.',
```

Command:

```bash
node --test tools/mcp-server/__tests__/tool-registry.test.mjs
```

Raw summary: `ℹ pass 2`, `ℹ fail 4` (baseline: `6`, `0`).

Failures covered server/catalog parity, the `61 tools across 9 categories`
summary, checked-in help-index parity, and package-description parity.

## 10. CLI command branch

File: `tools/mcp-server/cli.mjs`

Baseline and restored SHA-256:
`e60978603215dd8517a05cf86a1a031b854e3512a1ffa45b9c01f8db1af42ea6`

```diff
-  } else if (command === 'evaluation-report') {
+  } else if (false && command === 'evaluation-report') {
```

Command:

```bash
node --test tools/mcp-server/__tests__/cli.test.mjs
```

Raw summary: `ℹ pass 6`, `ℹ fail 2` (baseline: `8`, `0`).

Failures: both weekly CLI tests received `Unknown command: evaluation-report`;
the exit codes were `64` rather than the expected success and no-data codes.

## Restored validation

After the original ten proofs, all six file checksums matched their baselines,
`git status --short` and `git diff` produced no output, and the focused restored
matrix passed at 87 tests and 0 failures.

## 11. Complete-week internal cadence gap

Baseline commit: `b8ce8d05`.

File: `tools/mcp-server/weekly-evaluation-report.mjs`

Baseline and restored SHA-256:
`c3ed5b39dd07b782543d4170c12cdf884f3215ba44483300c68cfe4ce00ff6dc`

```diff
     && aggregate.firstObservedAt <= aggregate.weekStart + INSTALLED_CADENCE_MS
     && aggregate.lastObservedAt !== null
-    && aggregate.lastObservedAt >= aggregate.weekStart + WEEK_MS - INSTALLED_CADENCE_MS
-    && aggregate.maxObservationGapMs !== null
-    && aggregate.maxObservationGapMs <= MAX_COMPLETE_OBSERVATION_GAP_MS;
+    && aggregate.lastObservedAt >= aggregate.weekStart + WEEK_MS - INSTALLED_CADENCE_MS;
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ tests 24`, `ℹ pass 23`, `ℹ fail 1` (baseline: `24`,
`0`).

Failure: `rejects burst-filled cadence with a multi-day internal observation
gap` returned `complete` instead of `partial`.

## 12. Preserved projection age

File and checksum: same as proof 11.

```diff
-  if (
-    observation.diagnosticsStale
-    || observation.at - observation.projection.generatedAt > MAX_PROJECTION_AGE_MS
-  ) {
+  if (observation.diagnosticsStale) {
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ tests 24`, `ℹ pass 23`, `ℹ fail 1` (baseline: `24`,
`0`).

Failure: `treats preserved old projections as stale and future-invalid
projections as unavailable` changed coverage from `fresh: 0, stale: 1` to
`fresh: 1, stale: 0`, proving the old projection entered evidence.

## 13. Champion-derived promotion availability

File and checksum: same as proof 11.

```diff
-  const promotionCount = !championAvailable
+  const promotionCount = forecastAvailability === 'unavailable'
     ? null
     : boundedCount(aggregate.champion.promotions.length + aggregate.champion.promotionsOmitted);
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ tests 24`, `ℹ pass 23`, `ℹ fail 1` (baseline: `24`,
`0`).

Failure: `requires complete installed cadence and derives promotion evidence
from champion availability` returned promotion `count: 0` instead of `null`
when champion history was unavailable.

## 14. Promotion-kind filtering

Baseline commit: `4676530f`.

File: `tools/mcp-server/weekly-evaluation-report.mjs`

Baseline and restored SHA-256:
`cc87804efa1663c52bc32e3f40d21ca8c9d275624a9066440390db46de676d78`

```diff
 function addPromotions(target, promotions, weekStart) {
   const weekEnd = weekStart + WEEK_MS;
   for (const promotion of promotions) {
-    if (promotion.kind !== 'promotion') continue;
     if (promotion.at < weekStart || promotion.at >= weekEnd) continue;
@@
-    && value.promotions.every((promotion) => (
-      validPromotion(promotion) && promotion.kind === 'promotion'
-    ))
+    && value.promotions.every(validPromotion)
@@
-    && promoted.rows.every((promotion) => (
-      validPromotion(promotion) && promotion.kind === 'promotion'
-    ))
+    && promoted.rows.every(validPromotion)
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ tests 24`, `ℹ pass 23`, `ℹ fail 1` (baseline: `24`,
`0`).

Failure: `promoted changes exclude initial activation and rollback rows`
returned promotion count `3` instead of `1`.

## 15. Cadence-gap recommendation

File and checksum: same as proof 14.

```diff
 function recommendationCode({
@@
   cadenceComplete,
 }) {
-  if (!cadenceComplete) return 'restore_monitor';
   if (aggregate.observationCount === 0 || aggregate.unavailableCount > 0) return 'restore_monitor';
```

Command:

```bash
node --test tools/mcp-server/__tests__/weekly-evaluation-report.test.mjs
```

Raw summary: `ℹ tests 24`, `ℹ pass 23`, `ℹ fail 1` (baseline: `24`,
`0`).

Failure: `rejects burst-filled cadence with a multi-day internal observation
gap` recommended `resolve_overdue_predictions` instead of `restore_monitor`.

After the five repair proofs, each confirmed a nonempty production diff before
the red run. Every file checksum returned to its baseline, `git status --short`
was empty, and `git diff --exit-code` returned 0.
