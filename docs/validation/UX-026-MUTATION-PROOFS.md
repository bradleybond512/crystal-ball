<!-- markdownlint-disable MD013 -- exact commands, assertions, and diffs cannot wrap -->

# UX-026 Mutation and Validation Evidence

Date: 2026-09-03

The production baseline for this audit was `f4ab53a702e969d22c08632cf5d8039a59432795`. `git status --short` produced no output before the first mutation. Every mutation below was applied alone with `apply_patch`, confirmed with a nonempty `git diff -- <file>`, and then restored with `apply_patch`. After each restore, the production SHA-256 was reproduced and `git status --short` again produced no output.

The restored focused baseline was:

```text
$ npm run test:ux026
ℹ tests 63
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Production baseline and restored SHA-256 values:

```text
2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92  src/components/DigestOverlay.ts
e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f  src/app/panel-layout.ts
b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b  src/services/crystal-ball-chat.ts
1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5  src/services/digest-alert-projection.ts
c656190779bc490081a1589f32476978bb09981099c772bf31a69957496be0c7  src/services/nws-alerts.ts
```

## Mutation 1: omit the required location row

Confirmed applied mutation:

```diff
-      article.append(heading, narrative, location, impact);
+      article.append(heading, narrative, impact);
```

Mutated output:

```text
✖ every structured story is an article with mandatory local location and impact rows
AssertionError: expected /^Location:/; actual ''

✖ provider and model HTML-like text stays inert
AssertionError: expected rendered inert location sentinel /<svg onload/; actual text omitted it

ℹ tests 11
ℹ pass 9
ℹ fail 2
```

Restored checksum: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`.

## Mutation 2: send alert location labels to the remote model

Confirmed applied mutation:

```diff
       summary: digestFact(alert.body, 320),
+      region: alert.location?.label ? digestFact(alert.location.label, 120) : undefined,
```

Mutated output:

```text
✖ digest prompt keeps alert locations local while retaining public facts and opaque tokens
AssertionError: PRIVATE_SAVED_PLACE_LABEL_ba218 was present

✖ saved-place enrichment stays local through breaking-alert normalization and prompt construction
AssertionError: PRIVATE_PLACE_NAME_7d912 was present in region "Near PRIVATE_PLACE_NAME_7d912"

✖ digest prompt keeps local-only alert candidates opaque and excludes their user-local facts
AssertionError: PUBLIC_ALERT_LOCATION_69c41 was present

ℹ tests 9
ℹ pass 6
ℹ fail 3
```

Restored checksum: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`.

## Mutation 3: accept and render model-authored narrative

Confirmed applied mutation:

```diff
 interface ModelDigestStory {
   alertTokens: string[];
+  why: string;
 }
-      if (keys.length !== 1 || keys[0] !== 'alertTokens') continue;
+      if (keys.length !== 2 || keys[0] !== 'alertTokens' || keys[1] !== 'why') continue;
-      stories.push({ alertTokens: tokens });
+      stories.push({ alertTokens: tokens, why: digestFact(item['why'], MAX_DIGEST_NARRATIVE_LENGTH) });
-        narrative: digestFact(ranked[0]?.alert.body ?? '', MAX_DIGEST_NARRATIVE_LENGTH),
+        narrative: story.why,
```

Mutated output:

```text
✖ model narrative containing reserved canonical location or impact claims falls back deterministically
AssertionError:
+ actual: Location: PRIVATE_SAVED_PLACE_LABEL_ba218. Conditions may worsen.
- expected: Deterministic public fallback.

ℹ tests 9
ℹ pass 8
ℹ fail 1
```

Restored checksum: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`.

## Mutation 4: treat any unexpired NWS geometry as current

Confirmed applied mutation:

```diff
-  return raw.status === 'Actual'
-    && (raw.messageType === 'Alert' || raw.messageType === 'Update')
-    && sent !== null && sent <= now
-    && onset !== null && onset <= now
-    && expires !== null && expires > now
-    && sent < expires && onset < expires
-    && typeof retrievedAt === 'number' && Number.isFinite(retrievedAt)
-    && retrievedAt >= sent && retrievedAt <= now
-    && now - retrievedAt <= NWS_RETRIEVAL_MAX_AGE_MS;
+  return expires !== null && expires > now;
```

Mutated output:

```text
✖ complete-negative NWS conclusions require a current live alert and fresh retrieval evidence
Six subtests failed: Test status, Cancel message, future sent time, future onset time, stale retrieval, and missing retrieval.
Each produced actual 'no_reported_overlap' instead of expected 'unknown'.

ℹ tests 37
ℹ pass 30
ℹ fail 7
```

Restored checksum: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`.

## Mutation 5: make cached NWS evidence look newly retrieved

Confirmed applied mutation:

```diff
-  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
+  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
+    return cache.data.map((alert) => ({ ...alert, retrievedAt: Date.now() }));
+  }
```

Mutated output:

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache
AssertionError: cache reads must preserve the original retrieval evidence instead of making it look newer
+ actual: 1788437660000
- expected: 1788437600000

ℹ tests 2
ℹ pass 1
ℹ fail 1
```

Restored checksum: `c656190779bc490081a1589f32476978bb09981099c772bf31a69957496be0c7`.

## Mutation 6: accept structurally incomplete HTTP-200 NWS rows

Confirmed applied mutation:

```diff
-    if (!Array.isArray(body) || !body.every((item) => isNwsAlert(item))) {
+    if (!Array.isArray(body) || body.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
```

Mutated output:

```text
✖ malformed HTTP-200 NWS rows are never cached as current evidence
AssertionError:
+ actual: [ { id: 'missing-required-fields', retrievedAt: 1788417386004 } ]
- expected: []

ℹ tests 2
ℹ pass 1
ℹ fail 1
```

Restored checksum: `c656190779bc490081a1589f32476978bb09981099c772bf31a69957496be0c7`.

## Mutation 7: omit the successful-fetch retrieval stamp

Confirmed applied mutation:

```diff
-    const data = body.map((item) => ({ ...(item as NWSAlert), retrievedAt }));
+    const data = body.map((item) => ({ ...(item as NWSAlert) }));
```

Mutated output:

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache
AssertionError: actual undefined; expected 1788437600000

✖ malformed HTTP-200 NWS rows are never cached as current evidence
AssertionError: actual 'undefined'; expected 'number'

ℹ tests 2
ℹ pass 0
ℹ fail 2
```

Restored checksum: `c656190779bc490081a1589f32476978bb09981099c772bf31a69957496be0c7`.

## Mutation 8: ignore the aggregate geometry-work budget

Confirmed applied mutation:

```diff
-  if (!consumeGeometryWork(context.work, parseWork + evaluationWork)) return null;
+  consumeGeometryWork(context.work, parseWork + evaluationWork);
```

Mutated output:

```text
✖ at-cap geometry across fifty saved places exhausts global work as unknown deterministically
AssertionError:
+ actual: no_reported_overlap
- expected: unknown
duration: 366.8325ms

ℹ tests 37
ℹ pass 36
ℹ fail 1
```

Restored checksum: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`.

## Mutation 9: discard unknown or incomplete evidence

Confirmed applied mutation:

```diff
-  const hasUnknown = incomplete || savedPlaces.length > MAX_SAVED_PLACES
-    || evidence.some((item) => item.status === 'unknown');
+  const hasUnknown = false;
```

Mutated output:

```text
Twenty-two tests failed. Malformed nested geometry; centroid-only, cold, expired, and malformed area evidence; Test/Cancel/future/stale/missing lifecycle evidence; incomplete correlation membership; and over-budget geometries all became false 'no_reported_overlap' conclusions. Positive partial evidence also lost its explicit Unknown suffix.

Representative assertion:
+ actual: no_reported_overlap
- expected: unknown

ℹ tests 37
ℹ pass 15
ℹ fail 22
```

Restored checksum: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`.

## Mutation 10: stop invalidating and aborting on dismissal

Confirmed applied mutation:

```diff
  onDismiss: () => {
- this.digestGeneration += 1;
- this.digestAbortController?.abort();
  this.digestAbortController = null;
```

Mutated output:

```text
✖ digest dismissal invalidates the generation and aborts its pending request
AssertionError: dismissal must invalidate the captured generation

ℹ tests 4
ℹ pass 3
ℹ fail 1
```

Restored checksum: `e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f`.

## Mutation 11: make subscriptions call the model instead of local projection

Confirmed applied mutation:

```diff
- const cards = projectDigestStories({
+ const cards = generateDigest({
```

Mutated output:

```text
✖ alert and saved-place subscriptions reproject locally without another model request
AssertionError: expected /projectDigestStories\(/; actual subscription block called generateDigest

ℹ tests 4
ℹ pass 3
ℹ fail 1
```

Restored checksum: `e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f`.

## Mutation 12: suppress the overlay's dismissal notification

Confirmed applied mutation:

```diff
-    if (notifyOwner) this.onDismiss?.();
+    if (notifyOwner) return;
```

Mutated output:

```text
✖ user dismissal notifies the owner after hiding the overlay
AssertionError: one user dismissal must invalidate one pending request
actual: 0
expected: 1

ℹ tests 11
ℹ pass 10
ℹ fail 1
```

Restored checksum: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`.

## Restored green verification

```text
$ git status --short

$ shasum -a 256 src/components/DigestOverlay.ts src/app/panel-layout.ts src/services/crystal-ball-chat.ts src/services/digest-alert-projection.ts src/services/nws-alerts.ts
2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92  src/components/DigestOverlay.ts
e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f  src/app/panel-layout.ts
b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b  src/services/crystal-ball-chat.ts
1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5  src/services/digest-alert-projection.ts
c656190779bc490081a1589f32476978bb09981099c772bf31a69957496be0c7  src/services/nws-alerts.ts

$ npm run test:ux026
ℹ tests 63
ℹ pass 63
ℹ fail 0
```

## Performance evidence

The allowed-boundary failure path was measured with 40 fresh inputs, each containing one 50,000-position NWS polygon and 50 saved places. Every run returned `unknown` before coordinate copying/evaluation:

```text
p50 0.068ms
p95 0.376ms
max 1.919ms
```

With mutation 8 applied, the focused test performed full evaluation, took 366.833ms, and produced the unsafe `no_reported_overlap` result recorded above.

## Validation status

Focused tests, full regression suites, type checking, build, the repository agentic gate, and independent review are recorded in the UX-026 roadmap entry once the final branch tip has completed those gates.
