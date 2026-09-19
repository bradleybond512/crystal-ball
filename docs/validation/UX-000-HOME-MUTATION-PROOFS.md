# UX-000 Home repair mutation evidence

Source commit: `8d4b350b8241e7301335ba74a96d197078b73053`.

Mutated file: `src/services/home-shell/deck-view.ts`.

SHA-256 before and after every mutation: `d2748eaab63d38abe37186d2d61319ea6a1170eab60480fd6de10945ab486b75`.

Every run began with empty `git status --short`; exact expected source text was asserted present once, a nonempty applied `git diff` was captured, and source bytes were restored in a finally block. Each restored checksum matched and each restored status was empty. Diff changes were inspected. Full diffs and actual test logs accompany this report.

## Commands and baseline

Focused baseline: **43 pass / 0 fail**.

```sh
node --import tsx --test src/services/home-shell/__tests__/deck-view.test.mts src/components/__tests__/home-shell-startup-readiness.test.mts
```

Alias component-only baseline: **1 pass / 0 fail**. This executes real Home mapping and DOM behavior, without the constant-map assertion.

```sh
node --import tsx --test --test-name-pattern 'Home renders fresh audited contributor evidence' src/components/__tests__/home-shell-startup-readiness.test.mts
```

## Mutation results

| Mutation | Pass | Fail |
| --- | ---: | ---: |
| first-render-gate | 39 | 4 |
| healthy-only-gate | 39 | 4 |
| fabricated-render-report | 39 | 4 |
| fabricated-render-copy | 41 | 2 |
| ignore-panel-error | 42 | 1 |
| ignore-panel-failing | 41 | 2 |
| ignore-panel-unsafe | 41 | 2 |
| ignore-panel-disabled | 42 | 1 |
| accept-empty-count | 41 | 2 |
| accept-infinite-count | 42 | 1 |
| ignore-source-status | 42 | 1 |
| ignore-source-error | 42 | 1 |
| accept-future-timestamp | 41 | 2 |
| accept-stale-timestamp | 41 | 2 |
| extend-contributor-deadline | 39 | 4 |
| restore-rss-alias | 0 | 1 |
| restore-weather-alias | 0 | 1 |
| legacy-no-contributors | 40 | 3 |

18 distinct mutations killed; zero survivors. Final restored focused suite after all18 mutations: **43 pass / 0 fail**, recorded in `final-restored-focused.log`.

## Applied diffs and actual assertion excerpts

### first-render-gate

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..4bcac881c 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -202,7 +202,7 @@ export function buildDeckCards(
       };
     }
     const contributors = inputs.contributors?.[panelId] ?? [];
-    if (contributors.length > 0) {
+    if (contributors.length > 0 && hasRenderReport) {
       return buildContributorDeckCard(panelId, title, narrative, contributors, now, startupStartedAt, hasRenderReport);
     }
     if (h?.lastRenderAt === undefined) {
```

Actual failing assertion(s):

```text
not ok 22 - Home renders fresh audited contributor evidence without mounting or rendering its hidden panel
  ---
  duration_ms: 6.412417
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:1:31929'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    false !== true
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:930:12)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 40 - fresh contributors establish useful data independently of absent or deferred panel rendering
  ---
  duration_ms: 3.037667
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7212'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'loading'
    - 'useful'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'useful'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:244:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.572708
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /latest update returned 0 items/. Input:
    
    'no recent panel render after 30s · open panel'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'no recent panel render after 30s · open panel'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:286:47)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 43 - unrendered pending contributor evidence retains the 30-second bound without claiming a render
  ---
  duration_ms: 0.177292
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:9756'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /checking data contributors/. Input:
    
    'waiting for first panel render · 29s of 30s'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'waiting for first panel render · 29s of 30s'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:300:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### healthy-only-gate

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..6fda4189c 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -202,7 +202,7 @@ export function buildDeckCards(
       };
     }
     const contributors = inputs.contributors?.[panelId] ?? [];
-    if (contributors.length > 0) {
+    if (contributors.length > 0 && h?.status === 'healthy') {
       return buildContributorDeckCard(panelId, title, narrative, contributors, now, startupStartedAt, hasRenderReport);
     }
     if (h?.lastRenderAt === undefined) {
```

Actual failing assertion(s):

```text
not ok 22 - Home renders fresh audited contributor evidence without mounting or rendering its hidden panel
  ---
  duration_ms: 8.012292
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:1:31929'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    false !== true
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:930:12)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 40 - fresh contributors establish useful data independently of absent or deferred panel rendering
  ---
  duration_ms: 2.871542
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7212'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'loading'
    - 'useful'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'useful'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:244:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.55075
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /latest update returned 0 items/. Input:
    
    'no recent panel render after 30s · open panel'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'no recent panel render after 30s · open panel'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:286:47)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 43 - unrendered pending contributor evidence retains the 30-second bound without claiming a render
  ---
  duration_ms: 0.183958
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:9756'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /checking data contributors/. Input:
    
    'waiting for first panel render · 29s of 30s'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'waiting for first panel render · 29s of 30s'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:300:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### fabricated-render-report

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..c088b66c2 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -185,7 +185,7 @@ export function buildDeckCards(
     const title = inputs.names[panelId]?.name ?? panelId;
     const narrative = inputs.narratives[panelId] ?? undefined;
     const h = healthById.get(panelId);
-    const hasRenderReport = h?.lastRenderAt !== undefined;
+    const hasRenderReport = true;
     if (h?.lastError || h?.status === 'failing' || h?.status === 'unsafe') {
       let detail = 'panel-reported error · open panel';
       if (h.lastError) detail = `panel-reported error · ${h.lastError}`;
```

Actual failing assertion(s):

```text
not ok 40 - fresh contributors establish useful data independently of absent or deferred panel rendering
  ---
  duration_ms: 2.929917
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7212'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:245:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 41 - hidden explicit panel errors and disabled panels dominate positive data evidence
  ---
  duration_ms: 0.588833
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7973'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:263:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.209417
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:283:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 43 - unrendered pending contributor evidence retains the 30-second bound without claiming a render
  ---
  duration_ms: 0.312625
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:9756'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:298:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### fabricated-render-copy

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..9d025566f 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -128,7 +128,7 @@ function buildContributorDeckCard(
   startupStartedAt: number,
   hasRenderReport: boolean,
 ): DeckCardView {
-  const renderPrefix = hasRenderReport ? 'panel rendered; ' : '';
+  const renderPrefix = 'panel rendered; ';
   const positive = contributors.find((source) => (
     isFreshContributor(source, now) && Number.isFinite(source.latestItemCount) && source.latestItemCount > 0
   ));
```

Actual failing assertion(s):

```text
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 4.570916
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    The input was expected to not match the regular expression /working now|panel rendered|all clear/. Input:
    
    'panel rendered; Market quotes latest update returned 0 items · open panel'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'panel rendered; Market quotes latest update returned 0 items · open panel'
  operator: 'doesNotMatch'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:284:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 43 - unrendered pending contributor evidence retains the 30-second bound without claiming a render
  ---
  duration_ms: 0.249792
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:9756'
  failureType: 'testCodeFailure'
  error: |-
    The input was expected to not match the regular expression /panel rendered/. Input:
    
    'panel rendered; checking data contributors · 29s of 30s'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'panel rendered; checking data contributors · 29s of 30s'
  operator: 'doesNotMatch'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:299:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-panel-error

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..07b5cab01 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -186,7 +186,7 @@ export function buildDeckCards(
     const narrative = inputs.narratives[panelId] ?? undefined;
     const h = healthById.get(panelId);
     const hasRenderReport = h?.lastRenderAt !== undefined;
-    if (h?.lastError || h?.status === 'failing' || h?.status === 'unsafe') {
+    if (h?.status === 'failing' || h?.status === 'unsafe') {
       let detail = 'panel-reported error · open panel';
       if (h.lastError) detail = `panel-reported error · ${h.lastError}`;
       else if (h.lastRenderAt !== undefined) detail = `panel-reported error · ${formatAge(now - h.lastRenderAt)} ago`;
```

Actual failing assertion(s):

```text
not ok 41 - hidden explicit panel errors and disabled panels dominate positive data evidence
  ---
  duration_ms: 2.530209
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7973'
  failureType: 'testCodeFailure'
  error: |-
    {"status":"unknown","lastError":"render failed while hidden"}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:262:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-panel-failing

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..99898e3f7 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -186,7 +186,7 @@ export function buildDeckCards(
     const narrative = inputs.narratives[panelId] ?? undefined;
     const h = healthById.get(panelId);
     const hasRenderReport = h?.lastRenderAt !== undefined;
-    if (h?.lastError || h?.status === 'failing' || h?.status === 'unsafe') {
+    if (h?.lastError || h?.status === 'unsafe') {
       let detail = 'panel-reported error · open panel';
       if (h.lastError) detail = `panel-reported error · ${h.lastError}`;
       else if (h.lastRenderAt !== undefined) detail = `panel-reported error · ${formatAge(now - h.lastRenderAt)} ago`;
```

Actual failing assertion(s):

```text
not ok 37 - failing status uses neutral panel-reported error copy
  ---
  duration_ms: 2.442833
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:6392'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'panel report failing · 32s ago'
    - 'panel-reported error · 32s ago'
            ^
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'panel-reported error · 32s ago'
  actual: 'panel report failing · 32s ago'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:212:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 41 - hidden explicit panel errors and disabled panels dominate positive data evidence
  ---
  duration_ms: 0.26275
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7973'
  failureType: 'testCodeFailure'
  error: |-
    {"status":"failing"}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:262:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-panel-unsafe

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..7292e6d4e 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -186,7 +186,7 @@ export function buildDeckCards(
     const narrative = inputs.narratives[panelId] ?? undefined;
     const h = healthById.get(panelId);
     const hasRenderReport = h?.lastRenderAt !== undefined;
-    if (h?.lastError || h?.status === 'failing' || h?.status === 'unsafe') {
+    if (h?.lastError || h?.status === 'failing') {
       let detail = 'panel-reported error · open panel';
       if (h.lastError) detail = `panel-reported error · ${h.lastError}`;
       else if (h.lastRenderAt !== undefined) detail = `panel-reported error · ${formatAge(now - h.lastRenderAt)} ago`;
```

Actual failing assertion(s):

```text
not ok 36 - unsafe status renders error tone
  ---
  duration_ms: 2.636125
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:6160'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'stale' !== 'error'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'error'
  actual: 'stale'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:202:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 41 - hidden explicit panel errors and disabled panels dominate positive data evidence
  ---
  duration_ms: 0.564708
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7973'
  failureType: 'testCodeFailure'
  error: |-
    {"status":"unsafe"}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:262:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-panel-disabled

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..b27a39860 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -195,7 +195,7 @@ export function buildDeckCards(
         hasRenderReport, canRetryAllData: false, statusLabel: detail, narrative,
       };
     }
-    if (h?.enabled === false) {
+    if (false) {
       return {
         panelId, title, tone: 'unknown' as const, readiness: 'attention' as const,
         hasRenderReport, canRetryAllData: false, statusLabel: 'panel disabled · open panel', narrative,
```

Actual failing assertion(s):

```text
not ok 41 - hidden explicit panel errors and disabled panels dominate positive data evidence
  ---
  duration_ms: 3.697833
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:7973'
  failureType: 'testCodeFailure'
  error: |-
    {"status":"unknown","enabled":false}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:262:14)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### accept-empty-count

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..61155ea43 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -130,7 +130,7 @@ function buildContributorDeckCard(
 ): DeckCardView {
   const renderPrefix = hasRenderReport ? 'panel rendered; ' : '';
   const positive = contributors.find((source) => (
-    isFreshContributor(source, now) && Number.isFinite(source.latestItemCount) && source.latestItemCount > 0
+    isFreshContributor(source, now) && Number.isFinite(source.latestItemCount) && source.latestItemCount >= 0
   ));
   if (positive) {
     const itemWord = positive.latestItemCount === 1 ? 'item' : 'items';
```

Actual failing assertion(s):

```text
not ok 33 - fresh zero-row contributor evidence is explicit and never treated as useful or all-clear
  ---
  duration_ms: 3.81675
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:4735'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:159:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.32175
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"latestItemCount":0}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### accept-infinite-count

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..ffc65c97a 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -130,7 +130,7 @@ function buildContributorDeckCard(
 ): DeckCardView {
   const renderPrefix = hasRenderReport ? 'panel rendered; ' : '';
   const positive = contributors.find((source) => (
-    isFreshContributor(source, now) && Number.isFinite(source.latestItemCount) && source.latestItemCount > 0
+    isFreshContributor(source, now) &&  source.latestItemCount > 0
   ));
   if (positive) {
     const itemWord = positive.latestItemCount === 1 ? 'item' : 'items';
```

Actual failing assertion(s):

```text
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 2.665125
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"latestItemCount":null}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-source-status

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..87307a436 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -114,7 +114,7 @@ export interface DeckCardInputs {
 }
 
 function isFreshContributor(source: ContributorEvidenceLike, now: number): boolean {
-  if (source.status !== 'fresh' || source.lastUpdateAt === null || source.lastError) return false;
+  if (source.lastUpdateAt === null || source.lastError) return false;
   const age = now - source.lastUpdateAt;
   return age >= 0 && age < READINESS_FRESH_UPDATE_MS;
 }
```

Actual failing assertion(s):

```text
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 2.347125
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"status":"stale"}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### ignore-source-error

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..95b8413ca 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -114,7 +114,7 @@ export interface DeckCardInputs {
 }
 
 function isFreshContributor(source: ContributorEvidenceLike, now: number): boolean {
-  if (source.status !== 'fresh' || source.lastUpdateAt === null || source.lastError) return false;
+  if (source.status !== 'fresh' || source.lastUpdateAt === null) return false;
   const age = now - source.lastUpdateAt;
   return age >= 0 && age < READINESS_FRESH_UPDATE_MS;
 }
```

Actual failing assertion(s):

```text
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 2.591791
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"lastError":"source failed"}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### accept-future-timestamp

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..d9429e1c5 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -116,7 +116,7 @@ export interface DeckCardInputs {
 function isFreshContributor(source: ContributorEvidenceLike, now: number): boolean {
   if (source.status !== 'fresh' || source.lastUpdateAt === null || source.lastError) return false;
   const age = now - source.lastUpdateAt;
-  return age >= 0 && age < READINESS_FRESH_UPDATE_MS;
+  return age < READINESS_FRESH_UPDATE_MS;
 }
 
 function buildContributorDeckCard(
```

Actual failing assertion(s):

```text
not ok 34 - a fresh label with a stale or future timestamp cannot claim contributor usefulness
  ---
  duration_ms: 2.745667
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:5186'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:175:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.601792
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"lastUpdateAt":1752000000001}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### accept-stale-timestamp

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..e0a2e4569 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -116,7 +116,7 @@ export interface DeckCardInputs {
 function isFreshContributor(source: ContributorEvidenceLike, now: number): boolean {
   if (source.status !== 'fresh' || source.lastUpdateAt === null || source.lastError) return false;
   const age = now - source.lastUpdateAt;
-  return age >= 0 && age < READINESS_FRESH_UPDATE_MS;
+  return age >= 0;
 }
 
 function buildContributorDeckCard(
```

Actual failing assertion(s):

```text
not ok 34 - a fresh label with a stale or future timestamp cannot claim contributor usefulness
  ---
  duration_ms: 2.397167
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:5186'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:175:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.315083
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"lastUpdateAt":1751999100000}
    + actual - expected
    
    + 'useful'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'useful'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### extend-contributor-deadline

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..d34ada84f 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -153,7 +153,7 @@ function buildContributorDeckCard(
     };
   }
   const startupAge = Math.max(0, now - startupStartedAt);
-  if (startupAge < DECK_STARTUP_BUDGET_MS) {
+  if (startupAge <= DECK_STARTUP_BUDGET_MS) {
     return {
       panelId, title, tone: 'unknown', readiness: 'loading',
       hasRenderReport, canRetryAllData: false,
```

Actual failing assertion(s):

```text
not ok 34 - a fresh label with a stale or future timestamp cannot claim contributor usefulness
  ---
  duration_ms: 2.243292
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:5186'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'loading'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:175:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 35 - a failed mapped contributor makes Retry all data plausible after the budget
  ---
  duration_ms: 0.218292
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:5699'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'loading'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:191:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 42 - unrendered contributor empty, stale, future and error evidence never reports useful data or a render
  ---
  duration_ms: 0.178709
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:8742'
  failureType: 'testCodeFailure'
  error: |-
    {"latestItemCount":-1}
    + actual - expected
    
    + 'loading'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:282:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 43 - unrendered pending contributor evidence retains the 30-second bound without claiming a render
  ---
  duration_ms: 0.17375
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:9756'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'loading'
    - 'attention'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'attention'
  actual: 'loading'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:297:12)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

### restore-rss-alias

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..6445e3df8 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -28,6 +28,7 @@ export const DECK_STARTUP_BUDGET_MS = 30_000;
 
 /** Explicit data contributors for default Deck cards; unmapped cards never infer usefulness. */
 export const DECK_CONTRIBUTOR_SOURCE_IDS: Readonly<Record<string, readonly string[]>> = {
+  'live-news': ['rss'],
   'air-quality': ['air-quality'],
   'cyber-threats': ['cyber_threats'],
   'space-weather': ['space-weather'],
```

Actual failing assertion(s):

```text
not ok 1 - Home renders fresh audited contributor evidence without mounting or rendering its hidden panel
  ---
  duration_ms: 108.240333
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:1:31929'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:935:14)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
```

### restore-weather-alias

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..d95826cb2 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -28,6 +28,7 @@ export const DECK_STARTUP_BUDGET_MS = 30_000;
 
 /** Explicit data contributors for default Deck cards; unmapped cards never infer usefulness. */
 export const DECK_CONTRIBUTOR_SOURCE_IDS: Readonly<Record<string, readonly string[]>> = {
+  'nws-alerts': ['weather'],
   'air-quality': ['air-quality'],
   'cyber-threats': ['cyber_threats'],
   'space-weather': ['space-weather'],
```

Actual failing assertion(s):

```text
not ok 1 - Home renders fresh audited contributor evidence without mounting or rendering its hidden panel
  ---
  duration_ms: 90.077167
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:1:31929'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    true !== false
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: false
  actual: true
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/components/__tests__/home-shell-startup-readiness.test.mts:935:14)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
```

### legacy-no-contributors

```diff
diff --git a/src/services/home-shell/deck-view.ts b/src/services/home-shell/deck-view.ts
index 391e38dc2..b75775c4d 100644
--- a/src/services/home-shell/deck-view.ts
+++ b/src/services/home-shell/deck-view.ts
@@ -202,7 +202,7 @@ export function buildDeckCards(
       };
     }
     const contributors = inputs.contributors?.[panelId] ?? [];
-    if (contributors.length > 0) {
+    if (contributors.length >= 0) {
       return buildContributorDeckCard(panelId, title, narrative, contributors, now, startupStartedAt, hasRenderReport);
     }
     if (h?.lastRenderAt === undefined) {
```

Actual failing assertion(s):

```text
not ok 30 - buildDeckCards marks a card useful only from fresh positive contributor evidence
  ---
  duration_ms: 2.832541
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:2371'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'checking data contributors · 0s of 30s'
    - 'waiting for first panel render · 0s of 30s'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'waiting for first panel render · 0s of 30s'
  actual: 'checking data contributors · 0s of 30s'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:105:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 31 - cold cards settle from bounded startup to an honest actionable no-report state
  ---
  duration_ms: 0.735333
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:3480'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /^waiting for first panel render · 29s of 30s$/. Input:
    
    'checking data contributors · 29s of 30s'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
  actual: 'checking data contributors · 29s of 30s'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:122:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
not ok 38 - stale statuses render as stale tone with age
  ---
  duration_ms: 0.4075
  type: 'test'
  location: '/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:1:6681'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    'unknown' !== 'stale'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'stale'
  actual: 'unknown'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux000-mutation-20260918/src/services/home-shell/__tests__/deck-view.test.mts:222:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.postRun (node:internal/test_runner/test:1173:19)
    Test.run (node:internal/test_runner/test:1101:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
```

## Browser baseline limitation

Unmutated final fixture failed at `open.focus()` / `toBeFocused()` line153 (received inactive): **0 pass / 1 fail**. Prior useful-card/data/no-render assertions passed. This is not mutation red, and no browser mutation evidence is claimed. Investigating owner notified; raw log and trace retained.
