<!-- markdownlint-disable MD013 -- exact commands, output, and hashes -->

# UX-026 Literal Mutation Evidence — 2026-09-14

Candidate: `b81d9dc28a6c8c211c0f03da39f31d92fd92d811`. Dedicated detached proof worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/ux026-resume-proofs-20260914`.

All 25 mutations produced behavioral failures: 24 assertion failures and one unexpected runtime rejection of valid optional-onset input. Each mutation started clean, had its actual nonempty Git diff captured, and was restored to the original SHA-256 with empty Git status. Hashes use Python hashlib.sha256 over file bytes. No source or tests were changed in the delivery worktree.

This is test-sensitivity evidence, **not merge approval**. The independent review still has the FAA partial-success and open-digest expiry blockers.

## Baseline and restored suites

All commands below ran with `/opt/homebrew/opt/node@22/bin` first on PATH. Baseline and restored totals: **100 pass / 0 fail / 0 skipped** (93 UX-026 plus 7 storm adapter).

| Suite | Baseline | Restored |
| --- | --- | --- |
| projection | 37 pass / 0 fail | 37 pass / 0 fail |
| nws | 31 pass / 0 fail | 31 pass / 0 fail |
| chat | 9 pass / 0 fail | 9 pass / 0 fail |
| overlay | 11 pass / 0 fail | 11 pass / 0 fail |
| lifecycle | 5 pass / 0 fail | 5 pass / 0 fail |
| storm | 7 pass / 0 fail | 7 pass / 0 fail |

`node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-projection.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-projection.log)

`node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-nws.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-nws.log)

`node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-chat.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-chat.log)

`node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-overlay.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-overlay.log)

`node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-lifecycle.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-lifecycle.log)

`node --import tsx --test --test-reporter=spec src/services/survival/__tests__/storm-posture-adapter.test.mts`

[Baseline log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/baseline-storm.log) · [Restored log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/restored-storm.log)

## Individual proofs

Excerpts below preserve nonblank lines verbatim; whitespace-only lines are omitted for Markdown checks. Full raw logs and diffs retain exact bytes, including all blank lines, stack traces and summaries.

### 01-location-row

File: `src/components/DigestOverlay.ts`.

Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 11 pass / 0 fail → mutation 9 pass / 2 fail; exit 1. Restored suite 11 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/DigestOverlay.ts b/src/components/DigestOverlay.ts
index fc153f07b..1a7338509 100644
--- a/src/components/DigestOverlay.ts
+++ b/src/components/DigestOverlay.ts
@@ -200,7 +200,7 @@ export class DigestOverlay {
       impact.dataset.digestImpact = '';
       impact.textContent = story.impactText;
-      article.append(heading, narrative, location, impact);
+      article.append(heading, narrative, impact);
       fragment.append(article);
     });
     this.bodyEl.replaceChildren(fragment);
```

Literal failing output:

```text
✖ every structured story is an article with mandatory local location and impact rows (4.7965ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^Location:/. Input:
  ''
```

Literal count output:

```text
ℹ tests 11
ℹ pass 9
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/01-location-row.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/01-location-row.diff)

### 02-local-label-leak

File: `src/services/crystal-ball-chat.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`.

Baseline 9 pass / 0 fail → mutation 6 pass / 3 fail; exit 1. Restored suite 9 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/crystal-ball-chat.ts b/src/services/crystal-ball-chat.ts
index 15eac065f..88552996b 100644
--- a/src/services/crystal-ball-chat.ts
+++ b/src/services/crystal-ball-chat.ts
@@ -535,6 +535,7 @@ export function buildDigestPrompt(alerts?: readonly UnifiedAlert[]): string {
       source: alert.source,
       title: digestFact(alert.title, 160),
       summary: digestFact(alert.body, 320),
+      region: alert.location?.label ? digestFact(alert.location.label, 120) : undefined,
     });
   }).join('\n');
   return [
```

Literal failing output:

```text
✖ digest prompt keeps alert locations local while retaining public facts and opaque tokens (2.506958ms)
  AssertionError [ERR_ASSERTION]: a breaking-news label derived from a saved-place name must stay local
```

Literal count output:

```text
ℹ tests 9
ℹ pass 6
ℹ fail 3
ℹ skipped 0
```

Original and restored SHA-256: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/02-local-label-leak.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/02-local-label-leak.diff)

### 03-model-narrative

File: `src/services/crystal-ball-chat.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-narrative-contract.test.mts`.

Baseline 9 pass / 0 fail → mutation 7 pass / 2 fail; exit 1. Restored suite 9 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/crystal-ball-chat.ts b/src/services/crystal-ball-chat.ts
index 15eac065f..bdfb3d3fa 100644
--- a/src/services/crystal-ball-chat.ts
+++ b/src/services/crystal-ball-chat.ts
@@ -551,6 +551,7 @@ export function buildDigestPrompt(alerts?: readonly UnifiedAlert[]): string {
 interface ModelDigestStory {
   alertTokens: string[];
+  why: string;
 }
 function parseModelDigestStories(response: string | null): ModelDigestStory[] {
@@ -563,13 +564,13 @@ function parseModelDigestStories(response: string | null): ModelDigestStory[] {
       if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
       const item = value as Record<string, unknown>;
       const keys = Object.keys(item).sort();
-      if (keys.length !== 1 || keys[0] !== 'alertTokens') continue;
+      if (keys.length !== 2 || keys[0] !== 'alertTokens' || keys[1] !== 'why') continue;
       if (!Array.isArray(item['alertTokens']) || item['alertTokens'].length === 0
         || item['alertTokens'].length > MAX_MODEL_TOKENS_PER_STORY
         || !item['alertTokens'].every((token) => typeof token === 'string')) continue;
       const tokens = item['alertTokens'] as string[];
       if (new Set(tokens).size !== tokens.length) continue;
-      stories.push({ alertTokens: tokens });
+      stories.push({ alertTokens: tokens, why: digestFact(item['why'], MAX_DIGEST_NARRATIVE_LENGTH) });
     }
     return stories;
   } catch {
@@ -602,7 +603,7 @@ export function buildDigestStorySeeds(
         id: digestStoryId(alertIds),
         alertIds,
         headline: digestFact(ranked[0]?.alert.title ?? '', 200),
-        narrative: digestFact(ranked[0]?.alert.body ?? '', MAX_DIGEST_NARRATIVE_LENGTH),
+        narrative: story.why,
       },
     });
   }
```

Literal failing output:

```text
✖ model narrative containing reserved canonical location or impact claims falls back deterministically (2.127167ms)
  AssertionError [ERR_ASSERTION]: reserved narrative must be rejected: Location: PRIVATE_SAVED_PLACE_LABEL_ba218. Conditions may worsen.
  + actual - expected
  + 'Location: PRIVATE_SAVED_PLACE_LABEL_ba218. Conditions may worsen.'
  - 'Deterministic public fallback.'
```

Literal count output:

```text
ℹ tests 9
ℹ pass 7
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `b43c52ad638872e6f3ff78786871ceb701ade928a4efdad752be1c3b1e8c5b2b`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/03-model-narrative.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/03-model-narrative.diff)

### 04-current-lifecycle

File: `src/services/digest-alert-projection.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutation 30 pass / 7 fail; exit 1. Restored suite 37 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/digest-alert-projection.ts b/src/services/digest-alert-projection.ts
index 77babaa99..ca4aa967c 100644
--- a/src/services/digest-alert-projection.ts
+++ b/src/services/digest-alert-projection.ts
@@ -282,15 +282,7 @@ function hasCurrentNwsLifecycle(raw: Record<string, unknown>, now: number): bool
   const onset = parseTimestamp(raw.onset);
   const expires = parseTimestamp(raw.expires);
   const retrievedAt = raw.retrievedAt;
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
 }
 function preflightPolygon(value: unknown, state: GeometryParseState): boolean {
```

Literal failing output:

```text
✖ Test status (2.377833ms)
  AssertionError [ERR_ASSERTION]: Test status cannot support a negative
  + actual - expected
  + 'no_reported_overlap'
  - 'unknown'
```

Literal count output:

```text
ℹ tests 37
ℹ pass 30
ℹ fail 7
ℹ skipped 0
```

Original and restored SHA-256: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/04-current-lifecycle.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/04-current-lifecycle.diff)

### 05-cache-restamp

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 30 pass / 1 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..b46e4842a 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -163,7 +163,7 @@ export function _resetNwsAlertsForTest(): void {
 }
 export async function fetchNWSAlerts(): Promise<NWSAlert[]> {
-  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
+  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data.map((alert) => ({ ...alert, retrievedAt: Date.now() }));
   if (inflight) return inflight;
   inflight = doFetchNWSAlerts().finally(() => { inflight = null; });
   return inflight;
```

Literal failing output:

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache (24.886083ms)
  AssertionError [ERR_ASSERTION]: cache reads must preserve the original retrieval evidence instead of making it look newer
  + actual - expected
  + 1788437660000
  - 1788437600000
            ^
```

Literal count output:

```text
ℹ tests 31
ℹ pass 30
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/05-cache-restamp.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/05-cache-restamp.diff)

### 06-row-validation

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 9 pass / 22 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..7900f3197 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -149,7 +149,7 @@ function normalizeNwsAlert(value: unknown, responseBudget: GeometryBudget): NWSA
     && MESSAGE_TYPES.has(alert.messageType as NWSAlert['messageType'])
     && isCentroid(alert.centroid)
     && isGeometry(alert.geometry, responseBudget);
-  if (!valid) return null;
+  if (!value || typeof value !== 'object') return null;
   const normalized = { ...(alert as unknown as NWSAlert) };
   if (onset.length > 0) normalized.onset = onset;
```

Literal failing output:

```text
✖ malformed HTTP-200 NWS rows are never cached as current evidence (2.175792ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection: malformed HTTP-200 data must reject so the offline-cache layer owns fallback
```

Literal count output:

```text
ℹ tests 31
ℹ pass 9
ℹ fail 22
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/06-row-validation.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/06-row-validation.diff)

### 07-retrieval-stamp

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..fa7d99289 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -189,7 +189,7 @@ async function doFetchNWSAlerts(): Promise<NWSAlert[]> {
       validated.push(alert);
     }
     const retrievedAt = Date.now();
-    const data = validated.map((item) => ({ ...item, retrievedAt }));
+    const data = validated.map((item) => ({ ...item }));
     cache = { data, ts: retrievedAt };
     dataFreshness.recordUpdate('nws-alerts', data.length);
     return data;
```

Literal failing output:

```text
✖ NWS retrieval evidence is stamped once and preserved by the client cache (27.503834ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + undefined
  - 1788437600000
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/07-retrieval-stamp.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/07-retrieval-stamp.diff)

### 08-aggregate-projection-budget

File: `src/services/digest-alert-projection.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutation 36 pass / 1 fail; exit 1. Restored suite 37 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/digest-alert-projection.ts b/src/services/digest-alert-projection.ts
index 77babaa99..3a0a90b20 100644
--- a/src/services/digest-alert-projection.ts
+++ b/src/services/digest-alert-projection.ts
@@ -356,7 +356,7 @@ function parseNwsGeometry(
   const cached = context.cache.get(geometry);
   const parseWork = cached ? 0 : preflight.vertices;
   const evaluationWork = preflight.vertices * placeCount * 4;
-  if (!consumeGeometryWork(context.work, parseWork + evaluationWork)) return null;
+  consumeGeometryWork(context.work, parseWork + evaluationWork);
   if (cached) return cached;
   const state: GeometryParseState = { vertices: 0, rings: 0, polygons: 0 };
   const polygons = parseGeometryValue(value, state);
```

Literal failing output:

```text
✖ at-cap geometry across fifty saved places exhausts global work as unknown deterministically (403.292042ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'no_reported_overlap'
  - 'unknown'
```

Literal count output:

```text
ℹ tests 37
ℹ pass 36
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/08-aggregate-projection-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/08-aggregate-projection-budget.diff)

### 09-unknown-evidence

File: `src/services/digest-alert-projection.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/digest-alert-projection.test.mts`.

Baseline 37 pass / 0 fail → mutation 15 pass / 22 fail; exit 1. Restored suite 37 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/digest-alert-projection.ts b/src/services/digest-alert-projection.ts
index 77babaa99..05a5711a2 100644
--- a/src/services/digest-alert-projection.ts
+++ b/src/services/digest-alert-projection.ts
@@ -571,8 +571,7 @@ function impactProjection(
   const likely = evidence.find((item) => item.status === 'likely');
   const possible = evidence.find((item) => item.status === 'possible');
   const positive = likely ?? possible;
-  const hasUnknown = incomplete || savedPlaces.length > MAX_SAVED_PLACES
-    || evidence.some((item) => item.status === 'unknown');
+  const hasUnknown = false;
   if (positive) {
     const suffix = hasUnknown ? ' Unknown — some related alert evidence could not be evaluated.' : '';
     return { impactStatus: positive.status, impactText: positiveImpactText(positive) + suffix };
```

Literal failing output:

```text
✖ malformed nested multipolygon data fails closed (2.311375ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'no_reported_overlap'
  - 'unknown'
```

Literal count output:

```text
ℹ tests 37
ℹ pass 15
ℹ fail 22
ℹ skipped 0
```

Original and restored SHA-256: `1c95e22fe60db0496e2641497adadb4e59ed9d4ac9d9b16bf0cb6750ab7a31a5`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/09-unknown-evidence.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/09-unknown-evidence.diff)

### 10-dismiss-cancellation

File: `src/app/panel-layout.ts`.

Command: `node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`.

Baseline 5 pass / 0 fail → mutation 4 pass / 1 fail; exit 1. Restored suite 5 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/app/panel-layout.ts b/src/app/panel-layout.ts
index 3111610da..d77e6b5b2 100644
--- a/src/app/panel-layout.ts
+++ b/src/app/panel-layout.ts
@@ -1466,8 +1466,6 @@ export class PanelLayoutManager implements AppModule {
  startBlackoutSignature();
  this.digestOverlay = new DigestOverlay({
  onDismiss: () => {
- this.digestGeneration += 1;
- this.digestAbortController?.abort();
  this.digestAbortController = null;
  },
  });
```

Literal failing output:

```text
✖ digest dismissal invalidates the generation and aborts its pending request (1.4005ms)
  AssertionError [ERR_ASSERTION]: dismissal must invalidate the captured generation
```

Literal count output:

```text
ℹ tests 5
ℹ pass 4
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/10-dismiss-cancellation.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/10-dismiss-cancellation.diff)

**Scope:** source-text wiring test only. This does not establish runtime cancellation, race handling, or partial-success behavior.

### 11-local-reprojection

File: `src/app/panel-layout.ts`.

Command: `node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`.

Baseline 5 pass / 0 fail → mutation 4 pass / 1 fail; exit 1. Restored suite 5 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/app/panel-layout.ts b/src/app/panel-layout.ts
index 3111610da..62a42d5ef 100644
--- a/src/app/panel-layout.ts
+++ b/src/app/panel-layout.ts
@@ -1474,7 +1474,7 @@ export class PanelLayoutManager implements AppModule {
  this.digestOverlay.mount(document.body);
  const reprojectDigest = (): void => {
  if (!this.digestOverlay?.isVisible() || this.digestSeeds.length === 0) return;
- const cards = projectDigestStories({
+ const cards = generateDigest({
  seeds: this.digestSeeds,
  alerts: unifiedAlertStore.getAll(),
  savedPlaces: getSavedPlaces(),
```

Literal failing output:

```text
✖ alert and saved-place subscriptions reproject locally without another model request (1.25175ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /projectDigestStories\(/. Input:
  'const reprojectDigest = (): void => {\n' +
    ' if (!this.digestOverlay?.isVisible() || this.digestSeeds.length === 0) return;\n' +
    ' const cards = generateDigest({\n' +
    ' seeds: this.digestSeeds,\n' +
    ' alerts: unifiedAlertStore.getAll(),\n' +
    ' savedPlaces: getSavedPlaces(),\n' +
    ' now: Date.now(),\n' +
    ' });\n' +
    ' if (cards.length > 0) this.digestOverlay.update(cards);\n' +
    " else this.digestOverlay.showStatus('No recent activity to summarize.', 'empty');\n" +
    ' };\n' +
    ' this.unsubDigestAlerts = unifiedAlertStore.subscribe(reprojectDigest);\n' +
    ' this.unsubDigestPlaces = subscribeSavedPlaces(reprojectDigest);\n' +
```

Literal count output:

```text
ℹ tests 5
ℹ pass 4
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `e8e7506906dba5fcdf93f8efa3e6677ab5b396b29bea27f0002a34760cd22b8f`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/11-local-reprojection.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/11-local-reprojection.diff)

**Scope:** source-text wiring test only. This does not establish runtime cancellation, race handling, or partial-success behavior.

### 12-dismiss-notification

File: `src/components/DigestOverlay.ts`.

Command: `node --import tsx --test --test-reporter=spec src/components/__tests__/digest-overlay.test.mts`.

Baseline 11 pass / 0 fail → mutation 10 pass / 1 fail; exit 1. Restored suite 11 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/DigestOverlay.ts b/src/components/DigestOverlay.ts
index fc153f07b..e9e074c56 100644
--- a/src/components/DigestOverlay.ts
+++ b/src/components/DigestOverlay.ts
@@ -161,7 +161,7 @@ export class DigestOverlay {
     const restoreTarget = this.previouslyFocused;
     this.previouslyFocused = null;
     if (restoreTarget?.isConnected) restoreTarget.focus();
-    if (notifyOwner) this.onDismiss?.();
+    if (notifyOwner) return;
   }
   private open(): void {
```

Literal failing output:

```text
✖ user dismissal notifies the owner after hiding the overlay (2.499875ms)
  AssertionError [ERR_ASSERTION]: one user dismissal must invalidate one pending request
  0 !== 1
```

Literal count output:

```text
ℹ tests 11
ℹ pass 10
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/12-dismiss-notification.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/12-dismiss-notification.diff)

### 13-error-propagation

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 6 pass / 25 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..2dc282ff7 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -195,7 +195,7 @@ async function doFetchNWSAlerts(): Promise<NWSAlert[]> {
     return data;
   } catch (error) {
     dataFreshness.recordError('nws-alerts', String(error));
-    throw error;
+    return [];
   }
 }
```

Literal failing output:

```text
✖ malformed HTTP-200 NWS rows are never cached as current evidence (1.985292ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection: malformed HTTP-200 data must reject so the offline-cache layer owns fallback
```

Literal count output:

```text
ℹ tests 31
ℹ pass 6
ℹ fail 25
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/13-error-propagation.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/13-error-propagation.diff)

### 14-optional-onset

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 28 pass / 3 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..1721bb79f 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -142,8 +142,7 @@ function normalizeNwsAlert(value: unknown, responseBudget: GeometryBudget): NWSA
     && URGENCIES.has(alert.urgency as NWSAlert['urgency'])
     && typeof alert.areaDesc === 'string'
     && isTimestamp(alert.sent)
-    && (alert.onset === undefined || alert.onset === null
-      || (typeof alert.onset === 'string' && (onset.length === 0 || isTimestamp(onset))))
+    && isTimestamp(alert.onset)
     && isTimestamp(alert.expires)
     && STATUSES.has(alert.status as NWSAlert['status'])
     && MESSAGE_TYPES.has(alert.messageType as NWSAlert['messageType'])
```

Literal failing output:

```text
✖ missing (0.412667ms)
  Error: NWS alerts response was malformed
```

Literal count output:

```text
ℹ tests 31
ℹ pass 28
ℹ fail 3
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/14-optional-onset.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/14-optional-onset.diff)

This mutation fails through an unexpected production rejection of otherwise-valid missing/blank onset. It is a runtime behavior failure, not a compiler or import error; the log does not contain an AssertionError.

### 15-missing-onset-certainty

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 28 pass / 3 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..506bab630 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -153,7 +153,7 @@ function normalizeNwsAlert(value: unknown, responseBudget: GeometryBudget): NWSA
   const normalized = { ...(alert as unknown as NWSAlert) };
   if (onset.length > 0) normalized.onset = onset;
-  else delete normalized.onset;
+  else normalized.onset = normalized.sent;
   return normalized;
 }
```

Literal failing output:

```text
✖ missing (4.17425ms)
  AssertionError [ERR_ASSERTION]: missing onset cannot prove complete-negative coverage
  + actual - expected
  + 'no_reported_overlap'
  - 'unknown'
```

Literal count output:

```text
ℹ tests 31
ℹ pass 28
ℹ fail 3
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/15-missing-onset-certainty.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/15-missing-onset-certainty.diff)

### 16-onset-ranking

File: `src/services/alert-normalizer.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 30 pass / 1 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/alert-normalizer.ts b/src/services/alert-normalizer.ts
index 41e8bb02c..5630dbe09 100644
--- a/src/services/alert-normalizer.ts
+++ b/src/services/alert-normalizer.ts
@@ -124,7 +124,7 @@ export function normalizeNWSAlert(alert: NWSAlert): UnifiedAlert {
  severity: NWS_SEVERITY_MAP[alert.severity] ?? 'info',
  title: alert.event,
  body: alert.headline,
- timestamp: new Date(alert.onset ?? alert.sent).getTime(),
+ timestamp: new Date(alert.sent).getTime(),
  location: alert.centroid
  ? { lat: alert.centroid[1], lon: alert.centroid[0], label: alert.areaDesc }
  : undefined,
```

Literal failing output:

```text
✖ NWS normalization preserves onset as the ranking timestamp when present (4.505458ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 1788436500000
  - 1788436740000
           ^
```

Literal count output:

```text
ℹ tests 31
ℹ pass 30
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `30c192bb15af2cacbf993eae10d750f659e29d297710c58851ace6e23d3b6bc1`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/16-onset-ranking.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/16-onset-ranking.diff)

### 17-malformed-onset

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 26 pass / 5 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..5a0937da4 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -142,8 +142,7 @@ function normalizeNwsAlert(value: unknown, responseBudget: GeometryBudget): NWSA
     && URGENCIES.has(alert.urgency as NWSAlert['urgency'])
     && typeof alert.areaDesc === 'string'
     && isTimestamp(alert.sent)
-    && (alert.onset === undefined || alert.onset === null
-      || (typeof alert.onset === 'string' && (onset.length === 0 || isTimestamp(onset))))
+    && (onset.length === 0 || isTimestamp(onset))
     && isTimestamp(alert.expires)
     && STATUSES.has(alert.status as NWSAlert['status'])
     && MESSAGE_TYPES.has(alert.messageType as NWSAlert['messageType'])
```

Literal failing output:

```text
✖ 123 (2.19825ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 26
ℹ fail 5
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/17-malformed-onset.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/17-malformed-onset.diff)

### 18-feature-vertices-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 27 pass / 4 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..adbe5966d 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -96,7 +96,7 @@ function isPolygonCoordinates(value: unknown, budget: GeometryBudget, responseBu
   for (const ring of value) {
     if (!Array.isArray(ring)) return false;
     budget.vertices += ring.length;
-    if (budget.vertices > MAX_FEATURE_VERTICES || responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES) return false;
+    if (responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES) return false;
     if (!isClosedNonzeroRing(ring)) return false;
   }
   return true;
```

Literal failing output:

```text
✖ over-budget Polygon (21.658583ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 27
ℹ fail 4
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/18-feature-vertices-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/18-feature-vertices-budget.diff)

### 19-feature-rings-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..623a7211e 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -92,7 +92,7 @@ function isClosedNonzeroRing(value: unknown): value is LinearRing {
 function isPolygonCoordinates(value: unknown, budget: GeometryBudget, responseBudget: GeometryBudget): value is PolygonCoordinates {
   if (!Array.isArray(value) || value.length === 0) return false;
   budget.rings += value.length;
-  if (budget.rings > MAX_FEATURE_RINGS || responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS) return false;
+  if (responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS) return false;
   for (const ring of value) {
     if (!Array.isArray(ring)) return false;
     budget.vertices += ring.length;
```

Literal failing output:

```text
✖ feature rings (3.565542ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/19-feature-rings-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/19-feature-rings-budget.diff)

### 20-feature-polygons-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..d917eef3e 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -118,8 +118,7 @@ function isGeometry(value: unknown, responseBudget: GeometryBudget): value is NW
     return false;
   }
   featureBudget.polygons = polygons.length;
-  if (featureBudget.polygons > MAX_FEATURE_POLYGONS
-    || responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS) return false;
+  if (responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS) return false;
   for (const polygon of polygons) {
     if (!isPolygonCoordinates(polygon, featureBudget, responseBudget)) return false;
   }
```

Literal failing output:

```text
✖ feature polygons (2.22125ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/20-feature-polygons-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/20-feature-polygons-budget.diff)

### 21-response-vertices-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..44d8b3408 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -96,7 +96,7 @@ function isPolygonCoordinates(value: unknown, budget: GeometryBudget, responseBu
   for (const ring of value) {
     if (!Array.isArray(ring)) return false;
     budget.vertices += ring.length;
-    if (budget.vertices > MAX_FEATURE_VERTICES || responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES) return false;
+    if (budget.vertices > MAX_FEATURE_VERTICES) return false;
     if (!isClosedNonzeroRing(ring)) return false;
   }
   return true;
```

Literal failing output:

```text
✖ response vertices (6.977583ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/21-response-vertices-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/21-response-vertices-budget.diff)

### 22-response-rings-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..84bbe9e28 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -92,7 +92,7 @@ function isClosedNonzeroRing(value: unknown): value is LinearRing {
 function isPolygonCoordinates(value: unknown, budget: GeometryBudget, responseBudget: GeometryBudget): value is PolygonCoordinates {
   if (!Array.isArray(value) || value.length === 0) return false;
   budget.rings += value.length;
-  if (budget.rings > MAX_FEATURE_RINGS || responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS) return false;
+  if (budget.rings > MAX_FEATURE_RINGS) return false;
   for (const ring of value) {
     if (!Array.isArray(ring)) return false;
     budget.vertices += ring.length;
```

Literal failing output:

```text
✖ response rings (2.615917ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/22-response-rings-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/22-response-rings-budget.diff)

### 23-response-polygons-budget

File: `src/services/nws-alerts.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/__tests__/nws-alert-retrieval-freshness.test.mts`.

Baseline 31 pass / 0 fail → mutation 29 pass / 2 fail; exit 1. Restored suite 31 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/nws-alerts.ts b/src/services/nws-alerts.ts
index 6503f2204..0420d4a55 100644
--- a/src/services/nws-alerts.ts
+++ b/src/services/nws-alerts.ts
@@ -118,8 +118,7 @@ function isGeometry(value: unknown, responseBudget: GeometryBudget): value is NW
     return false;
   }
   featureBudget.polygons = polygons.length;
-  if (featureBudget.polygons > MAX_FEATURE_POLYGONS
-    || responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS) return false;
+  if (featureBudget.polygons > MAX_FEATURE_POLYGONS) return false;
   for (const polygon of polygons) {
     if (!isPolygonCoordinates(polygon, featureBudget, responseBudget)) return false;
   }
```

Literal failing output:

```text
✖ response polygons (2.405541ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Literal count output:

```text
ℹ tests 31
ℹ pass 29
ℹ fail 2
ℹ skipped 0
```

Original and restored SHA-256: `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/23-response-polygons-budget.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/23-response-polygons-budget.diff)

### 24-storm-sent-fallback

File: `src/services/survival/storm-posture-adapter.ts`.

Command: `node --import tsx --test --test-reporter=spec src/services/survival/__tests__/storm-posture-adapter.test.mts`.

Baseline 7 pass / 0 fail → mutation 6 pass / 1 fail; exit 1. Restored suite 7 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/services/survival/storm-posture-adapter.ts b/src/services/survival/storm-posture-adapter.ts
index 6f4660aa8..8073352b4 100644
--- a/src/services/survival/storm-posture-adapter.ts
+++ b/src/services/survival/storm-posture-adapter.ts
@@ -103,7 +103,7 @@ export function adaptLiveAlert(raw: LiveAlertInput): NwsAlertMinimal {
     id: raw.id,
     event: raw.event,
     polygon,
-    sent: raw.onset ?? raw.sent!,
+    sent: raw.onset!,
     expires: raw.expires,
     severity: normalizeSeverity(raw.severity),
     headline: raw.headline,
```

Literal failing output:

```text
✖ adaptLiveAlert falls back to sent only when onset is absent (2.2945ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + undefined
  - '2026-06-14T09:55:00Z'
```

Literal count output:

```text
ℹ tests 7
ℹ pass 6
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `25d031a9863b5e0f4e539939d0fb70a25160d835baee029575cef7ef8dee8302`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/24-storm-sent-fallback.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/24-storm-sent-fallback.diff)

### 25-faa-rejection-boundary

File: `src/components/FAAWeatherCamsPanel.ts`.

Command: `node --import tsx --test --test-reporter=spec tests/ux026-digest-lifecycle.test.mjs`.

Baseline 5 pass / 0 fail → mutation 4 pass / 1 fail; exit 1. Restored suite 5 pass / 0 fail.

Confirmed applied diff:

```diff
diff --git a/src/components/FAAWeatherCamsPanel.ts b/src/components/FAAWeatherCamsPanel.ts
index e59e343a3..125708f9f 100644
--- a/src/components/FAAWeatherCamsPanel.ts
+++ b/src/components/FAAWeatherCamsPanel.ts
@@ -27,7 +27,6 @@ export class FAAWeatherCamsPanel extends Panel {
   }
   private async load(): Promise<void> {
- try {
  const [raw, nws, gdacs] = await Promise.all([
  fetchFAACameras(),
  fetchNWSAlerts(),
@@ -35,9 +34,6 @@ export class FAAWeatherCamsPanel extends Panel {
  ]);
  this.cameras = scoreCamerasAgainstAlerts(raw, nws, gdacs);
  this.render();
- } catch {
- return;
- }
   }
   public refresh(): void {
```

Literal failing output:

```text
✖ FAA weather-cam fire-and-forget loading handles rejection without clearing existing cameras (0.689375ms)
  AssertionError [ERR_ASSERTION]: the fire-and-forget load method must contain its own rejection boundary
```

Literal count output:

```text
ℹ tests 5
ℹ pass 4
ℹ fail 1
ℹ skipped 0
```

Original and restored SHA-256: `7b34a61c90859010e2817eba59cf34989cc4cb5fdc252132118e531756cb333e`. Restored `git status --short`: empty.

[Complete log](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/25-faa-rejection-boundary.log) · [Complete diff](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/25-faa-rejection-boundary.diff)

**Scope:** source-text wiring test only. This does not establish runtime cancellation, race handling, or partial-success behavior.

## Limits and disposition

- Source-text-only lifecycle mutations10,11,25 establish wiring, not runtime concurrency or rejection handling.
- FAA independent blocker remains: successful camera results discarded when NWS fails.
- Open digest expiry independent blocker remains: no timer invalidates stale negative.
- Storm proof24 covers onset-to-sent adapter fallback only; it does not establish data-loader storm-context preservation.

The initial proof harness stopped before mutation 11 because the proposed source match occurred twice. The tree stayed clean; the transformation was narrowed to the local reprojection block and execution resumed. Initial harness and revised harness are retained. No passing assertion was weakened and no production behavior was changed to obtain a pass.

The historical 63-test report is superseded for the proofs reproduced here. No old performance measurement was rerun or represented as current.

[Machine ledger](/Users/bradleybond/.crystalball-diagnostics/ux026-resume-20260914/proofs/ledger.json)
