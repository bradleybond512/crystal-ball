# ACC-502 Mutation Proofs

Date: 2026-08-04  
Reviewed implementation commit: `aadd71a284b3dec2027363ba3b079ed2b37c1888`

This audit replaces the earlier ACC-502 evidence in full. The obsolete score
dampening proof is intentionally absent because inhibitory evidence is now
shadow-only and cannot modify operational scores.

The worktree began at the reviewed commit with `git status --short` returning
the empty string. Every mutation below was applied independently with
`apply_patch`, its actual `git diff` hunk was captured before execution, and the
mutation was reversed with `apply_patch`. Each restoration recorded the exact
SHA-256 and `git status --short` again returned the empty string. Test commands
use the canonical checkout's absolute `tsx` binary so the worktree never gains
a `node_modules` symlink.

## 1. The hypothesis family includes every configured window

- File: `src/services/correlation/lead-lag.ts`
- Original SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`
- Mutation: removed the `windows.length` multiplier from `pairWindowTests`.
- Applied diff:

  ```diff
  @@ -108,7 +108,7 @@ export function mineLeadLag(
       0,
     );
  -  const pairWindowTests = eligibleOrderedPairs * windows.length;
  +  const pairWindowTests = eligibleOrderedPairs;
     if (pairWindowTests === 0) return emptyMiningResult();
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='records the exact two-tailed multiple-testing family' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: deep equality expected `pairWindowTests: 8` and
  `criticalAbsZ: 3.396563261826216`; actual values were `4` and
  `3.1859610214922047`.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 2. The correction remains two-tailed

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation: removed the two-tail factor from the critical-value expression.
- Applied diff:

  ```diff
  @@ -116,7 +116,7 @@ export function mineLeadLag(
       pairWindowTests,
       tails: 2,
  -    criticalAbsZ: Math.sqrt(2 * Math.log((2 * pairWindowTests) / alpha)),
  +    criticalAbsZ: Math.sqrt(2 * Math.log(pairWindowTests / alpha)),
       method: 'gaussian-union-bound',
  ```

- Command: proof 1's command.
- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: deep equality expected
  `criticalAbsZ: 3.396563261826216`; actual was `3.1859610214922047`.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 3. Zero-support trials remain eligible for inhibitory discovery

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation: required positive support before retaining an inhibitory edge.
- Applied diff:

  ```diff
  @@ -171,7 +171,9 @@ function recordBestEdges(
       if (isPromotingSignificant(best.promoting, family, minZ)) promoting.push(best.promoting);
     }
  -  if (isInhibitorySignificant(best.inhibitory, family)) inhibitory.push(best.inhibitory);
  +  if (best.inhibitory.support > 0 && isInhibitorySignificant(best.inhibitory, family)) {
  +    inhibitory.push(best.inhibitory);
  +  }
   }
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='retains zero-support trials' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: `assert.ok(inhibitory)` received `undefined`.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 4. Inhibitory admission retains antecedent and base-rate gates

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Command for both independent sub-mutations:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='rejects inhibitory claims with low n' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

### 4a. Antecedent gate

- Mutation and applied diff:

  ```diff
  @@ -188,8 +188,7 @@ function isInhibitorySignificant(
     edge: InhibitoryLeadLagEdge,
     family: MultipleTestingFamily,
   ): boolean {
  -  return edge.antecedents >= 5
  -    && edge.expectedRate >= 0.2
  +  return edge.expectedRate >= 0.2
       && edge.lift <= 0.5
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion:
  `assert.ok(!lowN.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'))`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

### 4b. Base-rate gate

- Mutation and applied diff:

  ```diff
  @@ -189,7 +189,6 @@ function isInhibitorySignificant(
     family: MultipleTestingFamily,
   ): boolean {
     return edge.antecedents >= 5
  -    && edge.expectedRate >= 0.2
       && edge.lift <= 0.5
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion:
  `assert.ok(!lowBase.inhibitory.some((edge) => edge.from === 'a' && edge.to === 'b'))`.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 5. Inhibitory edges cannot become learned promoting rules

- Files and original SHA-256 values:
  - `src/services/correlation/learned-rules.ts`:
    `5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546`
  - `src/services/intelligence/cascade-registration.ts`:
    `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`
- Mutation: widened the learned-rule API to the promoting/inhibitory union and
  routed both result sets into synthesis.
- Applied diff:

  ```diff
  @@ -11,7 +11,7 @@
  -import type { PromotingLeadLagEdge } from './lead-lag';
  +import type { LeadLagEdge } from './lead-lag';
  @@ -21,19 +21,19 @@
  -export function learnedRuleId(edge: Pick<PromotingLeadLagEdge, 'from' | 'to'>): string {
  +export function learnedRuleId(edge: Pick<LeadLagEdge, 'from' | 'to'>): string {
  @@
  -export function learnedRulesFromEdges(edges: readonly PromotingLeadLagEdge[]): CorrelationRule[] {
  +export function learnedRulesFromEdges(edges: readonly LeadLagEdge[]): CorrelationRule[] {
  @@
  -function toRule(edge: PromotingLeadLagEdge): CorrelationRule {
  +function toRule(edge: LeadLagEdge): CorrelationRule {
  @@ -64,7 +64,7 @@ export function refreshLearnedCascades(
  -    const promoting = result.promoting;
  +    const promoting = [...result.promoting, ...result.inhibitory];
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='learned-rule synthesis|refresh routes only promoting' \
    src/services/correlation/__tests__/learned-rules-boundary.test.mts \
    src/services/intelligence/__tests__/cascade-registration.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Static boundary expected the `PromotingLeadLagEdge` import and signatures.
  - Runtime boundary expected `['learned:weather->infra']`; actual rules also
    contained `'learned:wildfire->infrastructure'`.
- Both restored SHA-256 values matched their originals.
- Restored `git status --short` raw output: `""`.

## 6. Expired snapshots are neutral

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation and applied diff:

  ```diff
  @@ -76,7 +76,7 @@ export function getInhibitorySnapshot(
       clearInhibitorySnapshot();
       return null;
     }
  -  if (!activeSnapshot || !Number.isFinite(now) || now > activeSnapshot.expiresAt) return null;
  +  if (!activeSnapshot || !Number.isFinite(now)) return null;
     return activeSnapshot;
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='replace publishes an immutable' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: strict equality expected `null` one millisecond after
  `expiresAt`; actual was the stale snapshot object.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 7. Notification imports and safety rungs stay isolated

- File and original SHA-256: `src/services/insights/notification-ladder.ts`,
  `7129502d4e0e708f7471def6acca68bbcd0390af5961da77747a3c0052a9b0ca`.
- Mutation and applied diff:

  ```diff
  @@ -27,6 +27,7 @@
   import type { AlertExplanation } from '@/services/intelligence/explainer';
   import { attentionWeight, nextActiveHour } from '@/services/cognition/operator-model';
  +import { getInhibitorySnapshot } from '@/services/correlation/inhibition';
  @@ -196,7 +197,9 @@ export function routeBigEventToLadder(
  -  const rung = pickRung(result.deliveryPriority, safetyCritical);
  +  const rung = getInhibitorySnapshot(at)?.evidence.length
  +    ? 'silent'
  +    : pickRung(result.deliveryPriority, safetyCritical);
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='production alert and notification|emergency and critical delivery rungs' \
    src/services/correlation/__tests__/inhibition-notification-boundary.test.mts \
    src/services/insights/__tests__/notification-ladder.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Static boundary expected no offenders; actual was
    `['insights/notification-ladder.ts']`.
  - Emergency rung expected `{ dispatched: true, rung: 'critical' }`; actual
    was `{ dispatched: true, rung: 'silent' }`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 8. The migration pins every non-S9 stream digest

- File and original SHA-256:
  `src/services/correlation/bench-correlation-baseline.ts`,
  `b04d5cd12aadc9ac53b3f3008fca007b4a1e007773ecec10a2745f20a9a336bb`.
- Mutation and applied diff:

  ```diff
  @@ -387,7 +387,7 @@ function checkV11MigrationManifest(
     }
     for (const [id, digest] of Object.entries(manifest.unchangedStreamDigests)) {
  -    if (report.streamDigests[id] !== digest) {
  +    if (false && report.streamDigests[id] !== digest) {
         reasons.push(`v12 changed non-S9 stream ${id}; migration permits only inhibitory-pair`);
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='fails closed on altered previous anchors' \
    src/services/correlation/__tests__/bench-correlation.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: case `live unchanged stream drift` expected `false`; actual
  migration verdict was `true`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 9. Invalid rows cannot alter the observation span

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation and applied diff:

  ```diff
  @@ -100,7 +100,7 @@ export function mineLeadLag(
     const validEvents = events.filter((event) => isValidDomainEvent(event));
     const byDomain = groupTimesByDomain(validEvents);
  -  const span = observedSpanMs(validEvents);
  +  const span = observedSpanMs(events);
     if (span <= 0) return emptyMiningResult();
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='invalid events cannot alter' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: deep equality changed the valid edge's expected rate from
  `0.06920214070383657` to `0.00003599935200782056`, lift from
  `14.450420027896044` to `27778.277780743338`, and z-score from
  `8.983458140792791` to `408.24461623450713`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 10. Snapshot publication enforces statistical admission

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation and applied diff:

  ```diff
  @@ -162,7 +162,6 @@ function validEvidence(
     for (const edge of edges) {
       if (!validEdge(edge)) continue;
       const item = { ...edge, criticalAbsZ };
  -    if (!validPublishedEvidence(item)) continue;
       const key = `${edge.from}\u0000${edge.to}`;
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='publication rejects evidence' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: the first four-antecedent candidate expected `[]`; actual
  evidence contained that statistically inadmissible candidate.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 11. Shadow evaluation preserves direction and window semantics

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation and applied diff:

  ```diff
  @@ -254,7 +254,7 @@ function hasFollowingWithin(
       if (consequents[mid]! <= antecedentAt) low = mid + 1;
       else high = mid;
     }
  -  return low < consequents.length && consequents[low]! <= windowEnd;
  +  return consequents.length > 0;
   }
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='shadow evaluator classifies only B-after-A' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: expected `{ confirmed: 1, refuted: 1, pending: 1 }`; actual
  was `{ confirmed: 0, refuted: 3, pending: 0 }`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 12. Shadow evidence cannot alter compound risk or posture

- File and original SHA-256:
  `src/services/correlation/compound-risk-cadence.ts`,
  `a29ee6c4dfe548441a1ffa399d53fbc3ca8412a4016b7c825d2c5ee8cb099412`.
- Mutation and applied diff:

  ```diff
  @@ -8,6 +8,7 @@
   import type { CompoundRiskInput, CompoundRiskResult } from '../intelligence/compound-risk';
   import { trackedComputeCompoundRisk } from '../algorithms/tracked-algorithms';
   import { factDomainFor } from './correlation-outcomes';
  +import { getInhibitorySnapshot } from './inhibition';
  @@ -79,6 +80,9 @@ export function recomputeCompoundRisk(
   ): CompoundRiskSnapshot {
     const results = trackedComputeCompoundRisk(situationsToCompoundInputs(situations));
  +  if (getInhibitorySnapshot(now)?.evidence.length && results[0]) {
  +    results[0] = { ...results[0], score: 0 };
  +  }
     latest = { results, computedAt: now };
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='active learned inhibition cannot change compound results' \
    src/services/correlation/__tests__/compound-risk-cadence-inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: compound result deep equality expected score `100`; actual
  score was `0`, which also feeds downstream posture.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 13. Liveness uses the last three consecutive eligible batches

- File and original SHA-256:
  `src/services/correlation/correlation-liveness.ts`,
  `b7c55037a07a9fa32f30001066ef9d7669ed3a2716d726f3ff2bff0c7b62793d`.
- Mutation and applied diff:

  ```diff
  @@ -245,10 +245,8 @@ function assessLive(
   if (
  -    eligibleTail.length === CORRELATION_LIVENESS_MIN_BATCHES
  -    && eligibleTail.every((batch) => (
  -      batch.observationCount === 1 && batch.learnedPairsEmitted === 0
  -    ))
  +    live.batchSizeDistribution.singleton === live.batchCount
  +    && live.learnedPairsEmitted === 0
   ) {
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='last three eligible singleton batches' \
    src/services/correlation/__tests__/correlation-liveness.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: retained eligible history `[2,1,1,1]` expected
  `'degraded'`; aggregate-history mutation returned `'healthy'`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 14. V11-to-v12 migration preserves learned execution liveness

- File and original SHA-256:
  `src/services/correlation/bench-correlation-baseline.ts`,
  `b04d5cd12aadc9ac53b3f3008fca007b4a1e007773ecec10a2745f20a9a336bb`.
- Mutation: disabled aggregate learned-pair volume, per-rule minimum volume,
  and learned-pair ledger coherence together.
- Applied diff:

  ```diff
  @@ -433,7 +433,7 @@ function checkV12MigrationEvidence(
  -  checkReportConsistency(reasons, report);
  +  if (false) checkReportConsistency(reasons, report);
  @@ -479,7 +479,7 @@ function checkMigrationSharedGates(
  -  if (report.causalLearnedRulePairCount < causalFloor) {
  +  if (false && report.causalLearnedRulePairCount < causalFloor) {
  @@ -490,7 +490,7 @@ function checkMigrationSharedGates(
  -  if (report.minCausalLearnedRulePairCount < perRuleFloor) {
  +  if (false && report.minCausalLearnedRulePairCount < perRuleFloor) {
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='learned execution path collapses|one dark causal learned rule' \
    src/services/correlation/__tests__/bench-correlation.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Collapsed aggregate/per-rule/ledger report expected `verdict.ok === false`;
    actual was `true`.
  - One dark causal rule behind healthy aggregate volume also expected `false`;
    actual was `true`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 15. Kill switch and errors clear state and publish diagnostics

- File and original SHA-256:
  `src/services/intelligence/cascade-registration.ts`,
  `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`.
- Command for both independent sub-mutations:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='disabled, empty, and mining-error' \
    src/services/intelligence/__tests__/cascade-registration.test.mts
  ```

### 15a. Kill-switch clearing happens before mining

- Applied diff:

  ```diff
  @@ -62,7 +62,6 @@ export function refreshLearnedCascades(
     const enabled = (options.inhibitionEnabled ?? readInhibitionEnabled)();
     evaluateActiveInhibitionShadow(history, now, enabled);
  -  if (!enabled) clearInhibitorySnapshot();
     const result = (options.mine ?? mineLeadLag)(history);
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: `kill switch clears before mining starts`; actual `false`,
  expected `true`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

### 15b. Error diagnostics are explicit

- Applied diff:

  ```diff
  @@ -81,7 +81,6 @@ export function refreshLearnedCascades(
     }
   } catch {
  -  recordInhibitionShadowError(now);
     clearInhibitorySnapshot();
   }
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: expected diagnostic status `'error'`; actual retained
  status was `'fresh'`.
- Restored SHA-256:
  `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`.
- Restored `git status --short` raw output: `""`.

## 16. The 1,000-event bound keeps the newest valid events

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation and applied diff:

  ```diff
  @@ -231,8 +231,8 @@ function boundedEventsByDomain(
       && event.at >= publishedAt
       && event.at <= now)
  -  .sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain))
  -  .slice(-MAX_INHIBITION_SHADOW_EVENTS);
  +  .slice(-MAX_INHIBITION_SHADOW_EVENTS)
  +  .sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain));
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='keeps the newest valid events' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: expected anonymous summary `confirmed: 1`; input-order
  truncation returned `confirmed: 0`.
- Restored SHA-256 matched the original; restored status raw output: `""`.

## 17. Cadence evaluation and anonymous diagnostics remain wired

- Files and original SHA-256 values:
  - `src/services/intelligence/cascade-registration.ts`:
    `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`
  - `src/services/algorithms/algorithm-diagnostics.ts`:
    `4edb481454b74a54995d932f6b121a4d7bca3e2c12c88681abb146d1cbfaaf1d`
- Mutation: removed shadow evaluation from the learned-cascade refresh path and
  removed the anonymous shadow summary from algorithm diagnostics.
- Applied diff:

  ```diff
  @@ -316,7 +316,6 @@ export function buildAlgorithmDiagnosticsSnapshot(
     ),
     correlationLiveness: getCorrelationLivenessDiagnostics(generatedAt),
  -  inhibitionShadow: getInhibitionShadowDiagnostics(),
     runtime: buildRuntimeRows(input.definitions, records),
  @@ -61,7 +61,6 @@ export function refreshLearnedCascades(
     }
     const enabled = (options.inhibitionEnabled ?? readInhibitionEnabled)();
  -  evaluateActiveInhibitionShadow(history, now, enabled);
     if (!enabled) clearInhibitorySnapshot();
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='refresh evaluates the previous snapshot|algorithm diagnostics expose only bounded anonymous' \
    src/services/intelligence/__tests__/cascade-registration.test.mts \
    src/services/algorithms/__tests__/algorithm-diagnostics.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Diagnostics exposure expected the bounded anonymous object; actual was
    `undefined`.
  - Refresh evaluation expected status `'fresh'` with counts `1/1/1`; actual
    remained `'unavailable'` with zero counts.
- Both restored SHA-256 values matched their originals.
- Restored `git status --short` raw output: `""`.

## 18. Relevant-domain allocation prevents global and cross-domain starvation

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation: replaced the fair relevant-domain allocator with the prior global
  valid-event sort and newest-1,000 slice.
- Applied diff:

  ```diff
  @@ -228,42 +228,23 @@ function boundedEventsByDomain(
     events: readonly InhibitionShadowEvent[],
  -  evidence: readonly Readonly<InhibitoryEvidence>[],
  +  _evidence: readonly Readonly<InhibitoryEvidence>[],
     publishedAt: number,
     now: number,
   ): Map<string, number[]> {
  -  const domains = [...new Set(evidence.flatMap((item) => [item.from, item.to]))]
  -    .sort((a, b) => a.localeCompare(b));
  -  const baseBudget = Math.floor(MAX_INHIBITION_SHADOW_EVENTS / domains.length);
  -  const remainder = MAX_INHIBITION_SHADOW_EVENTS % domains.length;
  -  const budgets = new Map(domains.map((domain, index) => [
  -    domain,
  -    baseBudget + (index < remainder ? 1 : 0),
  -  ]));
  -  const byDomain = new Map(domains.map((domain) => [domain, [] as number[]]));
  -  let retained = 0;
  -  for (const event of events) {
  -    const budget = budgets.get(event.domain);
  -    if (!budget
  -      || !Number.isFinite(event.at)
  -      || event.at < publishedAt
  -      || event.at > now) continue;
  -    const times = byDomain.get(event.domain)!;
  -    if (retained < MAX_INHIBITION_SHADOW_EVENTS) {
  -      pushTime(times, event.at);
  -      retained += 1;
  -      continue;
  -    }
  -    const underBudget = times.length < budget;
  -    const evictionDomain = oldestEvictableDomain(domains, byDomain, budgets, event.domain, underBudget);
  -    if (!evictionDomain) continue;
  -    const evictionTimes = byDomain.get(evictionDomain)!;
  -    const oldest = evictionTimes[0]!;
  -    if (!underBudget && compareShadowEvent(event.domain, event.at, evictionDomain, oldest) <= 0) continue;
  -    popOldestTime(evictionTimes);
  -    pushTime(times, event.at);
  +  const bounded = events
  +    .filter((event) => validDomain(event.domain)
  +      && Number.isFinite(event.at)
  +      && event.at >= publishedAt
  +      && event.at <= now)
  +    .sort((a, b) => a.at - b.at || a.domain.localeCompare(b.domain))
  +    .slice(-MAX_INHIBITION_SHADOW_EVENTS);
  +  const byDomain = new Map<string, number[]>();
  +  for (const event of bounded) {
  +    const times = byDomain.get(event.domain) ?? [];
  +    times.push(event.at);
  +    byDomain.set(event.domain, times);
     }
  -  for (const times of byDomain.values()) times.sort((a, b) => a - b);
     return byDomain;
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='retains relevant trials|gives each referenced domain' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - The oldest relevant-domain trial expected `confirmed: 1`; actual was `0`.
  - The cross-relevant-domain fairness case also expected `confirmed: 1`;
    actual was `0` after the newer domain consumed the global bound.
- Restored SHA-256:
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Restored `git status --short` raw output: `""`.

## 19. Empty statistical admission clears active and fresh state

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation: removed the `evidence.length === 0` fail-closed branch.
- Applied diff:

  ```diff
  @@ -55,11 +55,6 @@ export function replaceInhibitorySnapshot(
       .sort(compareEvidence)
       .slice(0, MAX_INHIBITORY_EVIDENCE)
       .map((item) => Object.freeze(item));
  -  if (evidence.length === 0) {
  -    activeSnapshot = null;
  -    shadowDiagnostics = emptyShadowDiagnostics();
  -    return NEUTRAL_SNAPSHOT;
  -  }
     const snapshot = Object.freeze({
  ```

- Shipped-test command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='replacement with no admitted evidence' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: expected `getInhibitorySnapshot(T0 + 1) === null`; actual
  was an active snapshot with `evidence: []`, `publishedAt: T0 + 1`, and a
  finite future `expiresAt`.
- Independent diagnostic probe: an isolated `/tmp` `node:test` asserted
  `evaluateActiveInhibitionShadow([], T0 + 1, true).status === 'unavailable'`
  immediately after the same empty admission.
- Probe raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Probe failing assertion: expected `'unavailable'`; actual was `'fresh'`.
  The temporary probe was removed before restoration verification.
- Restored SHA-256:
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Restored `git status --short` raw output: `""`.

## 20. Finite zero-admission cadence invalidates prior diagnostics

- File and original SHA-256:
  `src/services/intelligence/cascade-registration.ts`,
  `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`.
- Mutation: used `clearInhibitorySnapshot()` instead of
  `invalidateInhibitorySnapshot()` after a finite refresh admitted no
  inhibitory evidence.
- Applied diff:

  ```diff
  @@ -79,7 +79,7 @@ export function refreshLearnedCascades(
         return;
       }
       if (!result.family || result.inhibitory.length === 0) {
  -      if (Number.isFinite(now)) invalidateInhibitorySnapshot();
  +      if (Number.isFinite(now)) clearInhibitorySnapshot();
         else clearInhibitorySnapshot();
         return;
       }
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='zero-admission refresh clears the active snapshot' \
    src/services/intelligence/__tests__/cascade-registration.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: diagnostics expected status `'unavailable'`, null
  timestamps, and zero counts; actual status remained `'fresh'` for snapshot
  `100`, evaluated at `120`, with `evidenceEvaluated: 1` and `confirmed: 1`.
- Restored SHA-256:
  `7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae`.
- Restored `git status --short` raw output: `""`.

## 21. Non-finite replacement invalidates prior diagnostics

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Mutation: used `clearInhibitorySnapshot()` instead of
  `invalidateInhibitorySnapshot()` when `publishedAt` was non-finite.
- Applied diff:

  ```diff
  @@ -48,7 +48,7 @@ export function replaceInhibitorySnapshot(
     publishedAt: number = Date.now(),
   ): InhibitorySnapshot {
     if (!Number.isFinite(publishedAt)) {
  -    invalidateInhibitorySnapshot();
  +    clearInhibitorySnapshot();
       return NEUTRAL_SNAPSHOT;
     }
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='non-finite publication time invalidates' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: diagnostics expected status `'unavailable'`, null
  timestamps, and zero evidence; actual status remained `'fresh'`, evaluated
  at snapshot publication time `1785844800000`, with `evidenceEvaluated: 1`.
- Restored SHA-256:
  `841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211`.
- Restored `git status --short` raw output: `""`.

## 22. Inhibition uses only antecedents with complete follow windows

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation: replaced the explicit-coverage maturity guard with all
  antecedents, including pending trials and histories with no coverage end.
- Applied diff:

  ```diff
  @@ -271,9 +271,7 @@ function bestEdgesAcrossWindows(
         const edge = promotingEdge(promotingTrial);
         if (!bestPromoting || comparePromoting(edge, bestPromoting) < 0) bestPromoting = edge;
       }
  -    const matureAntecedents = observationEndMs === undefined
  -      ? []
  -      : antecedents.filter((at) => at <= observationEndMs - windowMs);
  +    const matureAntecedents = antecedents;
       if (matureAntecedents.length === 0) continue;
       const inhibitoryTrial = minePair(
         from,
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='right-censors antecedents|omitted observation coverage fails closed' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Right-censoring expected `antecedents: 20`; the mutation counted the three
    pending boundary trials and returned `23`.
  - Omitted observation coverage expected no `a→b` inhibitory edge; the
    mutation emitted one.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 23. Events after the observation boundary cannot enter mining

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation: removed the `event.at <= observationEndMs` boundary filter.
- Applied diff:

  ```diff
  @@ -104,9 +104,7 @@ export function mineLeadLag(
       return emptyMiningResult();
     }

  -  const validEvents = events.filter((event) =>
  -    isValidDomainEvent(event)
  -      && (observationEndMs === undefined || event.at <= observationEndMs));
  +  const validEvents = events.filter((event) => isValidDomainEvent(event));
     const byDomain = groupTimesByDomain(validEvents);
     const promotingSpanMs = observedSpanMs(validEvents, undefined);
     const inhibitorySpanMs = observedSpanMs(validEvents, observationEndMs);
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='explicit observation coverage excludes later events' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1
  ```

- Failing assertion: contaminated mining no longer deep-equaled the covered
  baseline. It gained an `a→b` promoting candidate with `support: 1` and
  changed both inhibitory edges' expected rates and z-scores.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## 24. Explicit inhibition coverage cannot distort promoting statistics

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Mutation: used the silent coverage-through-end span for promoting trials as
  well as inhibitory trials.
- Applied diff:

  ```diff
  @@ -108,7 +108,7 @@ export function mineLeadLag(
       isValidDomainEvent(event)
         && (observationEndMs === undefined || event.at <= observationEndMs));
     const byDomain = groupTimesByDomain(validEvents);
  -  const promotingSpanMs = observedSpanMs(validEvents, undefined);
  +  const promotingSpanMs = observedSpanMs(validEvents, observationEndMs);
     const inhibitorySpanMs = observedSpanMs(validEvents, observationEndMs);
     if (promotingSpanMs <= 0) return emptyMiningResult();
  ```

- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
    --test-name-pattern='silent explicit coverage does not change promoting statistics|pins the live run, and re-pins it identically' \
    src/services/correlation/__tests__/lead-lag.test.mts \
    src/services/correlation/__tests__/bench-correlation.test.mts
  ```

- Raw result lines:

  ```text
  ℹ tests 2
  ℹ pass 0
  ℹ fail 2
  ```

- Failing assertions:
  - Positive statistics expected `expectedRate: 0.06920214070383657`,
    `lift: 14.450420027896044`, and `zScore: 8.983458140792791`; the silent
    coverage mutation returned `0.03535970651687692`,
    `28.280777712979816`, and `12.793930837622925`.
  - The benchmark expected committed report digest
    `354a7790613214a893698b1882eda0ae`; actual mutated digest was
    `6d5cae0c4b784d99757745bfbfb28a5b`.
- Restored SHA-256:
  `25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c`.
- Restored `git status --short` raw output: `""`.

## Restored-state verification

The final combined command selects every assertion exercised above from the
fully restored implementation:

```sh
NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
  --test-name-pattern='records the exact two-tailed|retains zero-support|rejects inhibitory claims with low n|invalid events cannot alter|learned-rule synthesis|refresh routes only promoting|replace publishes an immutable|publication rejects evidence|replacement with no admitted evidence|non-finite publication time invalidates|shadow evaluator classifies only B-after-A|keeps the newest valid events|retains relevant trials|gives each referenced domain|production alert and notification|emergency and critical delivery rungs|fails closed on altered previous anchors|learned execution path collapses|one dark causal learned rule|active learned inhibition cannot change compound results|last three eligible singleton batches|disabled, empty, and mining-error|refresh evaluates the previous snapshot|zero-admission refresh clears the active snapshot|algorithm diagnostics expose only bounded anonymous|right-censors antecedents|omitted observation coverage fails closed|explicit observation coverage excludes later events|inhibitory base rate includes silent coverage|silent explicit coverage does not change promoting statistics|pins the live run, and re-pins it identically' \
  src/services/correlation/__tests__/lead-lag.test.mts \
  src/services/correlation/__tests__/learned-rules-boundary.test.mts \
  src/services/intelligence/__tests__/cascade-registration.test.mts \
  src/services/correlation/__tests__/inhibition.test.mts \
  src/services/correlation/__tests__/inhibition-notification-boundary.test.mts \
  src/services/insights/__tests__/notification-ladder.test.mts \
  src/services/correlation/__tests__/bench-correlation.test.mts \
  src/services/correlation/__tests__/compound-risk-cadence-inhibition.test.mts \
  src/services/correlation/__tests__/correlation-liveness.test.mts \
  src/services/algorithms/__tests__/algorithm-diagnostics.test.mts
```

Final raw result lines:

```text
ℹ tests 30
ℹ suites 2
ℹ pass 30
ℹ fail 0
```

Final restored implementation checksums:

```text
25e99757346be463929543298da6e2f4e1260bb46a3475420d0bb555aa35895c  src/services/correlation/lead-lag.ts
5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546  src/services/correlation/learned-rules.ts
7af786737e468334f70bdb791b15485006e3d6319423a4e3e3eb7e73242466ae  src/services/intelligence/cascade-registration.ts
841a14329e0989a30501998909f817591cbfea0b2ed9b9edfd9aa7da64fc9211  src/services/correlation/inhibition.ts
7129502d4e0e708f7471def6acca68bbcd0390af5961da77747a3c0052a9b0ca  src/services/insights/notification-ladder.ts
b04d5cd12aadc9ac53b3f3008fca007b4a1e007773ecec10a2745f20a9a336bb  src/services/correlation/bench-correlation-baseline.ts
a29ee6c4dfe548441a1ffa399d53fbc3ca8412a4016b7c825d2c5ee8cb099412  src/services/correlation/compound-risk-cadence.ts
b7c55037a07a9fa32f30001066ef9d7669ed3a2716d726f3ff2bff0c7b62793d  src/services/correlation/correlation-liveness.ts
4edb481454b74a54995d932f6b121a4d7bca3e2c12c88681abb146d1cbfaaf1d  src/services/algorithms/algorithm-diagnostics.ts
```

Final document and tree checks:

- `node scripts/lint-markdown.mjs docs/validation/ACC-502-MUTATION-PROOFS.md`
  returned `[lint:md] Checked 1 Markdown file(s).`
- `git diff --check` returned the empty string.
- `git status --short` returned only:

  ```text
   M docs/validation/ACC-502-MUTATION-PROOFS.md
  ```
