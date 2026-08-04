# ACC-502 Mutation Proofs

Date: 2026-08-04  
Reviewed implementation commit: `a552b321e432f9c077e10754b11e860597e7e0df`

The worktree started clean: `git status --short` produced no output. Each
mutation below was applied independently with `apply_patch`. Before the test,
`git diff -- <target>` was inspected and confirmed non-empty. After the red
run, the exact reverse patch was applied, the SHA-256 checksum matched the
recorded original, and `git status --short` again produced no output.

All TypeScript test commands set
`NODE_OPTIONS=--disable-warning=ExperimentalWarning` only to suppress Node's
unrelated experimental local-storage warning.

## 1. Multiple-testing family includes every window

- File: `src/services/correlation/lead-lag.ts`
- Original SHA-256:
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`
- Mutation: changed
  `eligibleOrderedPairs * windows.length` to `eligibleOrderedPairs` when
  calculating `pairWindowTests`.
- Confirmed diff: non-empty hunk at the `pairWindowTests` assignment.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='records the exact two-tailed multiple-testing family' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: deep equality expected `pairWindowTests: 8` and
  `criticalAbsZ: 3.396563261826216`; the mutation produced
  `pairWindowTests: 4` and `criticalAbsZ: 3.1859610214922047`.
- Restoration: SHA-256 returned to
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`.

## 2. Multiple-testing correction remains two-tailed

- File: `src/services/correlation/lead-lag.ts`
- Original SHA-256:
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`
- Mutation: changed the critical-value expression from
  `Math.log((2 * pairWindowTests) / alpha)` to
  `Math.log(pairWindowTests / alpha)`.
- Confirmed diff: non-empty hunk at `criticalAbsZ`.
- Command: the command from proof 1.
- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: deep equality expected
  `criticalAbsZ: 3.396563261826216`; the one-tailed mutation produced
  `3.1859610214922047`.
- Restoration: SHA-256 returned to
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`.

## 3. Zero-support trials remain eligible for inhibitory discovery

- File: `src/services/correlation/lead-lag.ts`
- Original SHA-256:
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`
- Mutation: required `best.inhibitory.support > 0` before retaining an
  otherwise significant inhibitory edge.
- Confirmed diff: non-empty hunk in `recordBestEdges`.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='retains zero-support trials' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: `assert.ok(inhibitory)` failed because the expected
  zero-support `a -> b` inhibitory edge became `undefined`.
- Restoration: SHA-256 returned to
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`.

## 4. Inhibitory evidence keeps its antecedent gate

- File: `src/services/correlation/lead-lag.ts`
- Original SHA-256:
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`
- Mutation: removed `edge.antecedents >= 5` from
  `isInhibitorySignificant` while leaving the base-rate and corrected-z gates
  intact.
- Confirmed diff: non-empty hunk in `isInhibitorySignificant`.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='rejects inhibitory claims with low n' \
    src/services/correlation/__tests__/lead-lag.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: the low-sample fixture incorrectly emitted `a -> b`, so
  `assert.ok(!lowN.inhibitory.some(...))` failed.
- Restoration: SHA-256 returned to
  `903b49eb9a47dc3d03db42dc3f65cd7029a6f8fc45e1894f55dbc44d405d0c8a`.

## 5. Inhibitory edges cannot become learned promoting rules

- Files and original SHA-256 values:
  - `src/services/correlation/learned-rules.ts`:
    `5f96ebbd460397ef75aef59ec50023d4b4e5d6a3420aed5975b6943a2bb38546`
  - `src/services/intelligence/cascade-registration.ts`:
    `8e79aa32f480a09a91612c1c26dc58145470da327de39bd2b5df21908d358171`
- Mutation: reverted all learned-rule builder signatures from
  `PromotingLeadLagEdge` to the promoting-or-inhibitory `LeadLagEdge` union and
  changed cascade registration to pass both `result.promoting` and
  `result.inhibitory` into learned-rule synthesis.
- Confirmed diff: non-empty hunks in both files.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='learned-rule synthesis|refresh routes only promoting' \
    src/services/correlation/__tests__/learned-rules-boundary.test.mts \
    src/services/intelligence/__tests__/cascade-registration.test.mts
  ```

- Result: `2 pass / 0 fail` -> `0 pass / 2 fail`.
- Failing assertions:
  - Static boundary: the source no longer matched the required
    `PromotingLeadLagEdge` import/signatures.
  - Runtime boundary: installed rule IDs became
    `['learned:weather->infra', 'learned:wildfire->infrastructure']` instead of
    only `['learned:weather->infra']`.
- Restoration: both files returned to their respective original checksums.

## 6. Dampening cannot exceed 15 percent

- File: `src/services/correlation/inhibition.ts`
- Original SHA-256:
  `306ad814cb6cbf01da6f3f551ec38a4e8bdc6725b1b1dce47328641d08462a06`
- Effective mutation: replaced
  `Math.max(FACTOR_FLOOR, 1 - MAX_DAMPENING * strongest.strength)` with
  `Math.max(0, 1 - strongest.strength)`, bypassing both the explicit 0.85 floor
  and the 15-percent cap.
- Confirmed diff: non-empty hunk at the applied inhibition factor.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='score dampening uses the strongest' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: expected score `68`; the unbounded mutation produced `0`.
- Restoration: SHA-256 returned to
  `306ad814cb6cbf01da6f3f551ec38a4e8bdc6725b1b1dce47328641d08462a06`.
- Rejected non-proof: changing only `FACTOR_FLOOR` from `0.85` to `0` stayed
  green at `1 pass / 0 fail`, because `MAX_DAMPENING = 0.15` independently
  preserved the same minimum. It was restored before the effective mutation
  above and is not counted as evidence.

## 7. Expired inhibitory snapshots are neutral

- File: `src/services/correlation/inhibition.ts`
- Original SHA-256:
  `306ad814cb6cbf01da6f3f551ec38a4e8bdc6725b1b1dce47328641d08462a06`
- Mutation: removed `now > activeSnapshot.expiresAt` from
  `getInhibitorySnapshot`.
- Confirmed diff: non-empty hunk in the snapshot validity condition.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='replace publishes an immutable' \
    src/services/correlation/__tests__/inhibition.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: the read one millisecond beyond `expiresAt` returned the
  stale snapshot instead of `null`.
- Restoration: SHA-256 returned to
  `306ad814cb6cbf01da6f3f551ec38a4e8bdc6725b1b1dce47328641d08462a06`.

## 8. Notification delivery is isolated from learned inhibition

- File: `src/services/insights/notification-ladder.ts`
- Original SHA-256:
  `7129502d4e0e708f7471def6acca68bbcd0390af5961da77747a3c0052a9b0ca`
- Mutation: imported `getInhibitorySnapshot` into the notification ladder and
  selected the `silent` rung whenever active inhibitory evidence existed,
  instead of calling the normal safety-aware `pickRung`.
- Confirmed diff: non-empty import and rung-selection hunks.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='production alert and notification|emergency and critical delivery rungs' \
    src/services/correlation/__tests__/inhibition-notification-boundary.test.mts \
    src/services/insights/__tests__/notification-ladder.test.mts
  ```

- Result: `2 pass / 0 fail` -> `0 pass / 2 fail`.
- Failing assertions:
  - Static boundary listed `insights/notification-ladder.ts` as an offender.
  - Safety integration expected `{ dispatched: true, rung: 'critical' }` for
    an emergency under maximal inhibition but received
    `{ dispatched: true, rung: 'silent' }`.
- Restoration: SHA-256 returned to
  `7129502d4e0e708f7471def6acca68bbcd0390af5961da77747a3c0052a9b0ca`.

## 9. The v11-to-v12 migration pins every non-S9 stream digest

- File: `src/services/correlation/bench-correlation-baseline.ts`
- Original SHA-256:
  `c2c9df0300fa94fdf1827cc6b4d25ee5a114814d288730ad26b36454b7240062`
- Mutation: disabled the per-stream equality branch by changing the condition
  to `false && report.streamDigests[id] !== digest`.
- Confirmed diff: non-empty hunk in `checkV11MigrationManifest`.
- Command:

  ```sh
  NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
    --test-name-pattern='fails closed on altered previous anchors' \
    src/services/correlation/__tests__/bench-correlation.test.mts
  ```

- Result: `1 pass / 0 fail` -> `0 pass / 1 fail`.
- Failing assertion: case `live unchanged stream drift` expected
  `verdict.ok === false`; with the digest check disabled it was `true`.
- Restoration: SHA-256 returned to
  `c2c9df0300fa94fdf1827cc6b4d25ee5a114814d288730ad26b36454b7240062`.

## Restored-state verification

The combined restored-state command selected the ten assertions exercised by
the nine proofs:

```sh
NODE_OPTIONS=--disable-warning=ExperimentalWarning npx tsx --test \
  --test-name-pattern='records the exact two-tailed|retains zero-support|rejects inhibitory claims with low n|learned-rule synthesis|refresh routes only promoting|score dampening uses the strongest|replace publishes an immutable|production alert and notification|emergency and critical delivery rungs|fails closed on altered previous anchors' \
  src/services/correlation/__tests__/lead-lag.test.mts \
  src/services/correlation/__tests__/learned-rules-boundary.test.mts \
  src/services/intelligence/__tests__/cascade-registration.test.mts \
  src/services/correlation/__tests__/inhibition.test.mts \
  src/services/correlation/__tests__/inhibition-notification-boundary.test.mts \
  src/services/insights/__tests__/notification-ladder.test.mts \
  src/services/correlation/__tests__/bench-correlation.test.mts
```

Actual restored result: `10 pass / 0 fail`.
