<!-- markdownlint-disable MD013 -- exact commands, assertions, and diffs cannot wrap -->

# UX-024 Mutation and Validation Evidence

Date: 2026-08-30

The production baseline for the fresh audit was `53ee9b056027310907c303161457b03d69621668`. `git status --short` produced no output before the first mutation. Every mutation below was applied alone with `apply_patch`, confirmed by a nonempty `git diff -- <file>`, and exercised with the complete focused command:

```bash
npm run test:review-trail
```

After each red run, the production file was restored with `apply_patch`, its SHA-256 was reproduced, and `git status --short` again produced no output. The evidence-only commit that adds this document does not change any production or test file.

Production baseline and restored SHA-256 values:

```text
eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57  src/services/panel-attention.ts
5974f4c1d8d92efea67f778971ad06908e103306195a398ff5f18c14fffa5a63  src/components/AttentionNavigator.ts
5ab7a05d8e493e630849e81ea06a8ff65d107af531f54b2ba31d56588040de7f  src/app/panel-layout.ts
```

## Mutation 1: zero-score exclusion

Confirmed applied mutation:

```diff
-    if (!Number.isFinite(alertScore) || alertScore <= 0) continue;
+    if (!Number.isFinite(alertScore) || alertScore < 0) continue;
```

Mutated output:

```text
✖ projects every positive finite-scoring pane with consistent severity and evidence counts
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual: [ 'weather', 'cyber', 'quiet' ]
- expected: [ 'weather', 'cyber' ]

✖ acknowledged, snoozed, nonpositive, and nonfinite scores stay out of attention
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual: panes a and b each contained one zero-score unreviewed alert
- expected: []

ℹ tests 24
ℹ pass 22
ℹ fail 2
```

Restored checksum: `eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57`.

## Mutation 2: timestamp-only refresh becomes a new identity

Confirmed applied mutation:

```diff
 function identityKey(identity: EvidenceIdentity): string {
-  return JSON.stringify([identity.id, identity.revision]);
+  return JSON.stringify([identity.id, identity.observedAt, identity.revision]);
 }
```

Mutated output:

```text
✖ timestamp-only refreshes stay reviewed while meaningful changes reopen the same ID
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
1 !== 0
actual: 1
expected: 0

ℹ tests 24
ℹ pass 23
ℹ fail 1
```

Restored checksum: `eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57`.

## Mutation 3: persistence accepts 501 identities

Confirmed applied mutation:

```diff
-    if (blob.reviewed.length > MAX_REVIEW_IDENTITIES) return [];
+    if (blob.reviewed.length > MAX_REVIEW_IDENTITIES + 1) return [];
```

Mutated output:

```text
✖ strict persistence rejects corrupt, duplicate, and oversized ledgers
AssertionError [ERR_ASSERTION] at src/services/__tests__/panel-attention.test.mts:189:12
actual: the complete 501-entry validated array a0...a500
expected: []
operator: deepStrictEqual

ℹ tests 24
ℹ pass 23
ℹ fail 1
```

The runner printed all 501 deterministic identities; the assertion above records the exact boundary and source line without duplicating that 22,000-character array in this file. Restored checksum: `eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57`.

## Mutation 4: promotion cap increases from three to four

Confirmed applied mutation:

```diff
-const MAX_PROMOTED_PANELS = 3;
+const MAX_PROMOTED_PANELS = 4;
```

Mutated output:

```text
✖ promotion is capped at three and same-band challengers do not churn incumbents
AssertionError [ERR_ASSERTION]:
+ actual: [ 'a', 'b', 'c', 'd' ]
- expected: [ 'a', 'b', 'c' ]

✖ an urgent challenger preempts the weakest standard incumbent
AssertionError [ERR_ASSERTION]:
+ actual: [ 'a', 'b', 'c', 'urgent' ]
- expected: [ 'b', 'c', 'urgent' ]

ℹ tests 24
ℹ pass 22
ℹ fail 2
```

Restored checksum: `eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57`.

## Mutation 5: old history-first ledger compaction

Confirmed applied mutation:

```diff
 export function markPanelReviewed(
   reviewed: readonly EvidenceIdentity[],
   panel: Pick<PanelAttention, 'evidence'>,
   activeEvidence: readonly EvidenceIdentity[],
 ): EvidenceIdentity[] {
-  const candidates = uniqueValid([...reviewed, ...panel.evidence]);
-  const activeKeys = new Set(
-    uniqueValid(activeEvidence).map((identity) => identityKey(identity)),
-  );
-  const activeReviewed = candidates.filter((identity) => activeKeys.has(identityKey(identity)));
-  const retainedActive = activeReviewed.length <= MAX_REVIEW_IDENTITIES
-    ? activeReviewed
-    : activeReviewed.slice(activeReviewed.length - MAX_REVIEW_IDENTITIES);
-  const remainingCapacity = MAX_REVIEW_IDENTITIES - retainedActive.length;
-  const inactiveHistory = candidates.filter((identity) => !activeKeys.has(identityKey(identity)));
-  const retainedInactive = inactiveHistory.length <= remainingCapacity
-    ? inactiveHistory
-    : inactiveHistory.slice(inactiveHistory.length - remainingCapacity);
-  const retainedKeys = new Set(
-    [...retainedActive, ...retainedInactive].map((identity) => identityKey(identity)),
-  );
-  return candidates.filter((identity) => retainedKeys.has(identityKey(identity)));
+  void activeEvidence;
+  return uniqueBounded([...reviewed, ...panel.evidence]);
 }
```

Mutated output:

```text
✖ reviewing a second pane preserves all 500 active reviewed identities at the ledger cap
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual: [ [ 'a', 250 ], [ 'b', 0 ] ]
- expected: [ [ 'a', 0 ], [ 'b', 0 ] ]

ℹ tests 24
ℹ pass 23
ℹ fail 1
```

This is the exact regression found in review: reviewing pane B at capacity reopened all 250 active identities in pane A. Restored checksum: `eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57`.

## Mutation 6: force classic navigation inside Home Shell

Confirmed applied mutation:

```diff
   private navigate(panelId: string): void {
-    const eventName = document.body.classList.contains('home-shell-active')
-      ? 'cb:open-panel'
-      : 'cb:navigate-panel';
+    const eventName = 'cb:navigate-panel';
```

Mutated output:

```text
✖ Next and Open dispatch shell-aware navigation without marking reviewed
AssertionError [ERR_ASSERTION]:
+ actual Home Shell event: { type: 'cb:navigate-panel', panelKey: 'cyber' }
- expected Home Shell event: { type: 'cb:open-panel', panelKey: 'cyber' }

ℹ tests 24
ℹ pass 23
ℹ fail 1
```

Restored checksum: `5974f4c1d8d92efea67f778971ad06908e103306195a398ff5f18c14fffa5a63`.

## Mutation 7: remove review-trail focus handoff

Confirmed applied mutation:

```diff
       if (typeof nextPanelId === 'string' && nextPanelId.length > 0) {
         this.navigate(nextPanelId);
-        const nextReview = [...this.element.querySelectorAll<HTMLButtonElement>(
-          '[data-attention-action="review"]',
-        )].find((candidate) => candidate.dataset.panelId === nextPanelId);
-        (nextReview ?? this.nextButton).focus();
-      } else {
-        this.summaryElement.focus();
       }
```

Mutated output:

```text
✖ Mark reviewed advances to the next pane returned by the review transaction
AssertionError [ERR_ASSERTION]: 'weather' !== 'cyber'
actual focus panel: weather
expected focus panel: cyber

✖ Mark reviewed keeps focus in the trail when the queue becomes empty
AssertionError [ERR_ASSERTION]: false !== true
actual summary focus: false
expected summary focus: true

ℹ tests 24
ℹ pass 22
ℹ fail 2
```

Restored checksum: `5974f4c1d8d92efea67f778971ad06908e103306195a398ff5f18c14fffa5a63`.

## Mutation 8: remove destroy-before-dynamic-load guard

Confirmed applied mutation:

```diff
  void import('@/services/sidebar-heat')
  .then(({ startSidebarHeat }) => {
- if (this.destroyed) return;
  this.sidebarHeat = startSidebarHeat(notificationStack.element);
```

Mutated output:

```text
✖ panel layout owns review-trail startup, lazy refresh, and teardown
AssertionError [ERR_ASSERTION]: The input did not match the regular expression
/import\('@\/services\/sidebar-heat'\)[\s\S]*?if \(this\.destroyed\) return;[\s\S]*?this\.sidebarHeat = startSidebarHeat\(notificationStack\.element\);/

ℹ tests 24
ℹ pass 23
ℹ fail 1
```

Restored checksum: `5ab7a05d8e493e630849e81ea06a8ff65d107af531f54b2ba31d56588040de7f`.

## Restored green verification

```text
$ shasum -a 256 src/services/panel-attention.ts src/components/AttentionNavigator.ts src/app/panel-layout.ts
eb36aea268269b630cf8c41aff72abcbb481ad9e1446d4fb9e4b64d96da6fe57  src/services/panel-attention.ts
5974f4c1d8d92efea67f778971ad06908e103306195a398ff5f18c14fffa5a63  src/components/AttentionNavigator.ts
5ab7a05d8e493e630849e81ea06a8ff65d107af531f54b2ba31d56588040de7f  src/app/panel-layout.ts

$ git status --short

$ npm run test:review-trail
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## Exact validation output

Trusted changed-path selection after rebasing onto `5abedfbdb33d36b8a820dc18401aad6cd91378a9`:

```text
[targeted-tests] 12 changed file(s) → 34 test script(s)
[targeted-tests] 34 script(s) passed.
```

Full renderer suite on the same production tree:

```text
ℹ tests 14690
ℹ suites 1110
ℹ pass 14690
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70682.501333
```

Type checking:

```text
$ npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
exit 0
```

Bundle policy:

```text
$ npm run bundle:check
Bundle-size report (gzipped):
  chunks: 107
  total:  4.91 MB / 6.00 MB
  main-DOg_QGnU.js  raw=1.61 MB  gzip=457.6 KB
✓ All bundle-size policies satisfied.

$ node --test tests/bundle-size.test.mjs
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

The production build emitted `dist/assets/sidebar-heat-DeOn58Eo.js` at 11,004 raw bytes and 3,778 gzip bytes, SHA-256 `e2ac1b60ea8e945f82d28d880ed43098ee449ec51212ece15f219f5958280b89`.

The full and compact accessibility harnesses each reported:

```text
axe violations: 0
```

The repository agentic gate completed with:

```text
Agentic validation gate passed.
Tests run: test:review-trail
exit 0
```
