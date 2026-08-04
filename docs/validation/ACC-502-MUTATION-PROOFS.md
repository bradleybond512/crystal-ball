# ACC-502 Mutation Proofs

Date: 2026-08-04  
Reviewed implementation commit: `839b8417cecd83fa44ff483f65af431854a42fd8`

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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`
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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
- Restored `git status --short` raw output: `""`.

## 2. The correction remains two-tailed

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
- Restored `git status --short` raw output: `""`.

## 3. Zero-support trials remain eligible for inhibitory discovery

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
- Restored `git status --short` raw output: `""`.

## 4. Inhibitory admission retains antecedent and base-rate gates

- File and original SHA-256: `src/services/correlation/lead-lag.ts`,
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
- Restored `git status --short` raw output: `""`.

## 5. Inhibitory edges cannot become learned promoting rules

- Files and original SHA-256 values:
  - `src/services/correlation/learned-rules.ts`:
    `5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546`
  - `src/services/intelligence/cascade-registration.ts`:
    `d256c15f12f33568ba4dcdae1aa63ae15de78c0f0dcee7d8ea50eb9adc6d390b`
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
  `4f6fead129be69192266edca451e930fe9f294b37ca6167923a4872810e525ee`.
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
  `243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7`.
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
  `4f6fead129be69192266edca451e930fe9f294b37ca6167923a4872810e525ee`.
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
  `4f6fead129be69192266edca451e930fe9f294b37ca6167923a4872810e525ee`.
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
  `d256c15f12f33568ba4dcdae1aa63ae15de78c0f0dcee7d8ea50eb9adc6d390b`.
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
  `d256c15f12f33568ba4dcdae1aa63ae15de78c0f0dcee7d8ea50eb9adc6d390b`.
- Restored `git status --short` raw output: `""`.

## 16. The 1,000-event bound keeps the newest valid events

- File and original SHA-256: `src/services/correlation/inhibition.ts`,
  `4f6fead129be69192266edca451e930fe9f294b37ca6167923a4872810e525ee`.
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
    `d256c15f12f33568ba4dcdae1aa63ae15de78c0f0dcee7d8ea50eb9adc6d390b`
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

## Restored-state verification

The final combined command selects every assertion exercised above from the
fully restored implementation:

```sh
NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  /Users/bradleybond/Developer/crystalball/node_modules/.bin/tsx --test \
  --test-name-pattern='records the exact two-tailed|retains zero-support|rejects inhibitory claims with low n|invalid events cannot alter|learned-rule synthesis|refresh routes only promoting|replace publishes an immutable|publication rejects evidence|shadow evaluator classifies only B-after-A|keeps the newest valid events|production alert and notification|emergency and critical delivery rungs|fails closed on altered previous anchors|learned execution path collapses|one dark causal learned rule|active learned inhibition cannot change compound results|last three eligible singleton batches|disabled, empty, and mining-error|refresh evaluates the previous snapshot|algorithm diagnostics expose only bounded anonymous' \
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
ℹ tests 20
ℹ suites 1
ℹ pass 20
ℹ fail 0
```

Final restored implementation checksums:

```text
243fee97e6aef99c50e6a0152c176e7384ad8fe8f08c6c84120d7d40d0b030a7  src/services/correlation/lead-lag.ts
5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546  src/services/correlation/learned-rules.ts
d256c15f12f33568ba4dcdae1aa63ae15de78c0f0dcee7d8ea50eb9adc6d390b  src/services/intelligence/cascade-registration.ts
4f6fead129be69192266edca451e930fe9f294b37ca6167923a4872810e525ee  src/services/correlation/inhibition.ts
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
