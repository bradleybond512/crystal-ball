# ACC-008 mutation proofs

Checkpoint: `590a9eeec5a1a599bcc00dff105575e8b9f628d0`.

Mutated file: `scripts/acc008-production-baseline.mts`.

Before and after every mutation, SHA-256: `2bccf2283821c13ffaf4eafb0b89c226cf2793b8e7d1500b1a79017c7ebbf35e`.

Every mutation began with `git status --short` empty. Each patch was applied,
its nonempty `git diff` inspected, and the focused suite run. Exact source
bytes and clean status were verified after each restore. No live acquisition
ran while the collector was mutated. Baseline and restored output:

```text
# tests 25
# pass 25
# fail 0
```

Command: `npm run test:acc008` (Node 22). The final restored dedicated
`npm run typecheck:acc008` also exited 0. All 23 mutations were killed.

## bound

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: oversized retained stores are unavailable instead of silently truncated.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..a194cd2fa 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -88,7 +88,7 @@ function parseStore(value: string | null | undefined, array: boolean, limit: num
   if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) return { status: 'malformed', value: null };
   try {
     const parsed: unknown = JSON.parse(value);
-    const valid = array ? Array.isArray(parsed) && parsed.length <= limit : object(parsed) !== null;
+    const valid = array ? Array.isArray(parsed) : object(parsed) !== null;
     return valid ? { status: 'available', value: parsed } : { status: 'malformed', value: null };
   } catch { return { status: 'malformed', value: null }; }
 }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'available'
    - 'malformed'
  expected: 'malformed'
  actual: 'available'
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## champion

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: does not present an older champion when the latest persisted entry is malformed.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..c2e20b569 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -270,7 +270,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
 function championState(store: ParsedStore, raw: string | null | undefined, now: number) {
   if (store.status !== 'available') return { availability: 'unavailable', reason: `registry_${store.status}` };
   const entries = object(store.value)?.['forecast-primary'];
-  if (!Array.isArray(entries) || entries.length > 20 || entries.some((value) => {
+  if (!Array.isArray(entries) || entries.length > 20 || false && entries.some((value) => {
     const entry = object(value);
     return !entry || entry.slot !== 'forecast-primary' || typeof entry.modelId !== 'string'
       || !SOURCES.has(entry.modelId) || typeof entry.version !== 'string' || !VERSIONS.has(entry.version)
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'available'
    - 'unavailable'
  expected: 'unavailable'
  actual: 'available'
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## duplicate

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: excludes duplicate comparison identities instead of inflating pair counts.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..b200e2d11 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -213,7 +213,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
   for (const c of candidates) multiplicities.set(c.key, (multiplicities.get(c.key) ?? 0) + 1);
   const groups = new Map<string, PairGroup>();
   for (const { cmp, key } of candidates) {
-    if (multiplicities.get(key)! > 1) { exclude('duplicate_identity'); continue; }
+    if (false) { exclude('duplicate_identity'); continue; }
     const jk = cmp.joinKey!;
     const matches = resolvedIndex.get(JSON.stringify([jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId, jk.liveModelVersion]));
     if (!matches?.length) { exclude('unmatched_identity'); continue; }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    21 !== 19
  expected: 19
  actual: 21
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## floor

`25 pass / 0 fail` → `23 pass / 2 fail`.

Failing tests: retains the twenty-sample floor instead of presenting small cohorts as scored; does not pool undersampled source, version, domain or horizon partitions.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..b60e8db92 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -255,8 +255,8 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
       });
     } finally { resetShadowRolloutForTests(); }
     if (pairs.length !== group.comparisons.length) throw new Error('exact_join_reconciliation_failed');
-    const productionBrier = meanBrierScore(pairs.map((p) => ({ probability: p.liveP, outcome: p.outcome ? 1 : 0 })));
-    const baselineBrier = meanBrierScore(pairs.map((p) => ({ probability: p.shadowP, outcome: p.outcome ? 1 : 0 })));
+    const productionBrier = meanBrierScore(pairs.map((p) => ({ probability: p.liveP, outcome: p.outcome ? 1 : 0 })), 1);
+    const baselineBrier = meanBrierScore(pairs.map((p) => ({ probability: p.shadowP, outcome: p.outcome ? 1 : 0 })), 1);
     return {
       forecaster: group.forecaster, modelVersion: group.modelVersion, baselineModel: group.baselineModel,
       baselineVersion: group.baselineVersion, domain: group.domain, horizon: group.horizon,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'ok'
    - 'insufficient_evidence'
  expected: 'insufficient_evidence'
  actual: 'ok'
  operator: 'strictEqual'

  error: |-
    Expected values to be strictly equal:
    + actual - expected
    + 'ok'
    - 'insufficient_evidence'
  expected: 'insufficient_evidence'
  actual: 'ok'
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 23
# fail 2
```

## four_keys

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: reads only four UTF-16 SQLite values without modifying the source database.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..37d1b4f4d 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -68,7 +68,7 @@ finally:

 export function readInstalledStorage(databasePath: string): StorageSnapshot {
   try {
-    const output = execFileSync('python3', ['-c', SQLITE_READ, resolve(databasePath), JSON.stringify(Object.values(STORAGE_KEYS))], {
+    const output = execFileSync('python3', ['-c', SQLITE_READ, resolve(databasePath), JSON.stringify([...Object.values(STORAGE_KEYS), "secret-token"])], {
       encoding: 'utf8', timeout: 10_000, maxBuffer: 40 * 1024 * 1024,
       stdio: ['ignore', 'pipe', 'pipe'],
     });
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
      {
        'crystalball-champion-registry-v1': null,
    +   'secret-token': 'DO NOT READ',
        'wm-shadow-mode-runs': '[]'
      }
  expected:
  actual:
  operator: 'deepStrictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## origin

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: preserves direct, proxy and manual cohorts separately.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..c081252ab 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -123,7 +123,7 @@ function resolved(r: PredictionRecord): boolean {

 function origin(r: PredictionRecord, now: number): Origin {
   const counts = auditResolutionQuality([r], now).summary.origins;
-  return counts.direct ? 'direct' : counts.proxy ? 'proxy' : 'manual';
+  return 'direct';
 }

 function source(value: string): string | null { return SOURCES.has(value) ? value : null; }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
      [
        'direct',
    -   'manual',
    -   'proxy'
      ]
  expected:
  actual:
  operator: 'deepStrictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## partition_domain

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: does not pool undersampled source, version, domain or horizon partitions.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..dd2dd120c 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -231,7 +231,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
     const labelOrigin = origin(first, now);
     const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
-      jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
+      jk.shadowModelId, jk.shadowModelVersion, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
     const group = groups.get(groupKey) ?? {
       forecaster: jk.liveModelId!, modelVersion: jk.liveModelVersion!, baselineModel: jk.shadowModelId!,
       baselineVersion: jk.shadowModelVersion!, domain: first.domain,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## partition_horizon

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: does not pool undersampled source, version, domain or horizon partitions.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..2f16f307a 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -231,7 +231,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
     const labelOrigin = origin(first, now);
     const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
-      jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
+      jk.shadowModelId, jk.shadowModelVersion, first.domain, labelOrigin]);
     const group = groups.get(groupKey) ?? {
       forecaster: jk.liveModelId!, modelVersion: jk.liveModelVersion!, baselineModel: jk.shadowModelId!,
       baselineVersion: jk.shadowModelVersion!, domain: first.domain,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## partition_source

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: does not pool undersampled source, version, domain or horizon partitions.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..5f018c6c3 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -230,7 +230,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     }
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
     const labelOrigin = origin(first, now);
-    const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
+    const groupKey = JSON.stringify([cmp.runId, jk.liveModelVersion,
       jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
     const group = groups.get(groupKey) ?? {
       forecaster: jk.liveModelId!, modelVersion: jk.liveModelVersion!, baselineModel: jk.shadowModelId!,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## partition_version

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: does not pool undersampled source, version, domain or horizon partitions.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..b764688bd 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -230,7 +230,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     }
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
     const labelOrigin = origin(first, now);
-    const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
+    const groupKey = JSON.stringify([cmp.runId, jk.liveModelId,
       jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
     const group = groups.get(groupKey) ?? {
       forecaster: jk.liveModelId!, modelVersion: jk.liveModelVersion!, baselineModel: jk.shadowModelId!,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## privacy_source

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: projects only approved aggregate strings and never leaks raw records or unknown model names.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..a1666f13e 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -126,7 +126,7 @@ function origin(r: PredictionRecord, now: number): Origin {
   return counts.direct ? 'direct' : counts.proxy ? 'proxy' : 'manual';
 }

-function source(value: string): string | null { return SOURCES.has(value) ? value : null; }
+function source(value: string): string | null { return value; }
 function version(value: string | undefined): string | null { return value && VERSIONS.has(value) ? value : null; }
 function identity(r: PredictionRecord): string {
   return JSON.stringify([r.targetKey, r.predictedAt, r.resolveBy, r.sourceId, r.algorithmVersion]);
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    PRIVATE
    true !== false
  expected: false
  actual: true
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## privacy_version

`25 pass / 0 fail` → `23 pass / 2 fail`.

Failing tests: missing and unknown versions stay unavailable and cannot qualify a proof window; projects only approved aggregate strings and never leaks raw records or unknown model names.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..59b47ca2e 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -127,7 +127,7 @@ function origin(r: PredictionRecord, now: number): Origin {
 }

 function source(value: string): string | null { return SOURCES.has(value) ? value : null; }
-function version(value: string | undefined): string | null { return value && VERSIONS.has(value) ? value : null; }
+function version(value: string | undefined): string | null { return value ?? null; }
 function identity(r: PredictionRecord): string {
   return JSON.stringify([r.targetKey, r.predictedAt, r.resolveBy, r.sourceId, r.algorithmVersion]);
 }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'

  error: |-
    PRIVATE
    true !== false
  expected: false
  actual: true
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 23
# fail 2
```

## probability_bounds

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: rejects malformed probabilities and timestamps before pure scorers can clamp them.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..5b3e9471b 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -98,7 +98,7 @@ function time(value: unknown): value is number {
 }

 function probability(value: unknown): value is number {
-  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
+  return typeof value === 'number' && Number.isFinite(value) && true;
 }

 function text(value: unknown): value is string {
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    1 !== 2
  expected: 2
  actual: 1
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## probability_match

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: rejects a comparison whose live probability differs from the forecast being graded.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..97bd35f52 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -228,7 +228,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     if (cmp.timestamp < first.predictedAt || cmp.timestamp >= outcomeObservedAt || cmp.timestamp > now) {
       exclude('temporal_integrity'); continue;
     }
-    if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
+    if (false) { exclude('forecast_probability_mismatch'); continue; }
     const labelOrigin = origin(first, now);
     const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
       jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## proof_window

`25 pass / 0 fail` → `23 pass / 2 fail`.

Failing tests: missing and unknown versions stay unavailable and cannot qualify a proof window; oversized retained stores are unavailable instead of silently truncated.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..9f8d93647 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -328,7 +328,7 @@ export function buildBaselineReport(snapshot: StorageSnapshot, metadata: Baselin
     },
     champion: championState(stores.champion, snapshot.values[STORAGE_KEYS.champion], now),
     manifest: {
-      proofWindowEligible: false,
+      proofWindowEligible: true,
       reasons: ['retained_working_set_only', 'installed_evaluation_revision_unavailable', 'production_window_not_assessed'],
       missingModelVersionCount: records.filter((r) => !version(r.algorithmVersion)).length,
       unknownForecasterCount: records.filter((r) => !source(r.sourceId)).length,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    true !== false
  expected: false
  actual: true
  operator: 'strictEqual'

  error: |-
    Expected values to be strictly equal:
    true !== false
  expected: false
  actual: true
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 23
# fail 2
```

## quality

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: exposes outcome-quality defects and excludes contradictory pairs.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..b93042b0e 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -220,7 +220,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     if (matches.length > 1) { exclude('duplicate_outcome_identity'); continue; }
     const first = matches[0]!;
     const quality = auditResolutionQuality([first], now).summary;
-    if (quality.malformed || quality.labelLeakage || quality.contradictoryEvidence) {
+    if (false) {
       exclude('invalid_outcome_quality'); continue;
     }
     const outcomeObservedAt = Math.min(first.resolvedAt!,
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## readonly

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: unavailable databases are not created and errors omit private paths.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..cc0b0827f 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -49,7 +49,7 @@ export interface BaselineMetadata {

 const SQLITE_READ = `import datetime,json,pathlib,sqlite3,sys
 keys=json.loads(sys.argv[2])
-c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True,timeout=3)
+c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=rwc',uri=True,timeout=3)
 c.execute('PRAGMA query_only=ON')
 c.execute('BEGIN')
 values={}
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    true !== false
  expected: false
  actual: true
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## review_duplicate

`25 pass / 0 fail` → `23 pass / 2 fail`.

Failing tests: excludes conflicting outcomes or domains for the same resolved identity; excludes duplicate outcome identities regardless of provenance order.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..ad4af33ca 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -217,7 +217,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     const jk = cmp.joinKey!;
     const matches = resolvedIndex.get(JSON.stringify([jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId, jk.liveModelVersion]));
     if (!matches?.length) { exclude('unmatched_identity'); continue; }
-    if (matches.length > 1) { exclude('duplicate_outcome_identity'); continue; }
+    if (false) { exclude('duplicate_outcome_identity'); continue; }
     const first = matches[0]!;
     const quality = auditResolutionQuality([first], now).summary;
     if (quality.malformed || quality.labelLeakage || quality.contradictoryEvidence) {
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'

  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 23
# fail 2
```

## review_observed_at

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: requires comparisons to precede the earliest structured outcome observation.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..1b68a7716 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -225,7 +225,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     }
     const outcomeObservedAt = Math.min(first.resolvedAt!,
       ...(first.resolutionProvenance?.evidence?.map((item) => item.observedAt) ?? []));
-    if (cmp.timestamp < first.predictedAt || cmp.timestamp >= outcomeObservedAt || cmp.timestamp > now) {
+    if (cmp.timestamp < first.predictedAt || cmp.timestamp >= first.resolvedAt! || cmp.timestamp > now) {
       exclude('temporal_integrity'); continue;
     }
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## skill

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: scores the same exact paired cohort and reconciles label origins.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..36e84b916 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -174,7 +174,7 @@ function pairedSkill(production: EvidenceMetric, baseline: EvidenceMetric): Skil
   if (production.status !== 'ok') return production;
   if (baseline.status !== 'ok') return baseline;
   if (baseline.value <= Number.EPSILON) return { status: 'unavailable', reason: 'zero_baseline_error', sampleSize: production.sampleSize };
-  return { status: 'ok', sampleSize: production.sampleSize, value: 1 - production.value / baseline.value };
+  return { status: 'ok', sampleSize: production.sampleSize, value: 1 - baseline.value / production.value };
 }

 interface PairGroup {
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    The expression evaluated to a falsy value:
      assert.ok(Math.abs(pair.skill.value - 0.75) < 1e-12)
  expected: true
  actual: false
  operator: '=='
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## temporal

`25 pass / 0 fail` → `23 pass / 2 fail`.

Failing tests: requires comparisons to precede the earliest structured outcome observation; excludes pairs observed at or after resolution and before forecast emission.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..d7fd22bf7 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -225,7 +225,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
     }
     const outcomeObservedAt = Math.min(first.resolvedAt!,
       ...(first.resolutionProvenance?.evidence?.map((item) => item.observedAt) ?? []));
-    if (cmp.timestamp < first.predictedAt || cmp.timestamp >= outcomeObservedAt || cmp.timestamp > now) {
+    if (false) {
       exclude('temporal_integrity'); continue;
     }
     if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 19
  expected: 19
  actual: 20
  operator: 'strictEqual'

  error: 'exact_join_reconciliation_failed'
```

Actual output:

```text
# tests 25
# pass 23
# fail 2
```

## version_join

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: never joins a comparison to a different model version.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..6ab73aba4 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -129,7 +129,7 @@ function origin(r: PredictionRecord, now: number): Origin {
 function source(value: string): string | null { return SOURCES.has(value) ? value : null; }
 function version(value: string | undefined): string | null { return value && VERSIONS.has(value) ? value : null; }
 function identity(r: PredictionRecord): string {
-  return JSON.stringify([r.targetKey, r.predictedAt, r.resolveBy, r.sourceId, r.algorithmVersion]);
+  return JSON.stringify([r.targetKey, r.predictedAt, r.resolveBy, r.sourceId]);
 }

 function metrics(records: PredictionRecord[], now: number, knownVersion: boolean) {
@@ -215,7 +215,7 @@ function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
   for (const { cmp, key } of candidates) {
     if (multiplicities.get(key)! > 1) { exclude('duplicate_identity'); continue; }
     const jk = cmp.joinKey!;
-    const matches = resolvedIndex.get(JSON.stringify([jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId, jk.liveModelVersion]));
+    const matches = resolvedIndex.get(JSON.stringify([jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId]));
     if (!matches?.length) { exclude('unmatched_identity'); continue; }
     if (matches.length > 1) { exclude('duplicate_outcome_identity'); continue; }
     const first = matches[0]!;
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly equal:
    20 !== 0
  expected: 0
  actual: 20
  operator: 'strictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

## zero_baseline

`25 pass / 0 fail` → `24 pass / 1 fail`.

Failing tests: treats zero baseline error as unavailable skill.

Confirmed-applied diff:

```diff
diff --git a/scripts/acc008-production-baseline.mts b/scripts/acc008-production-baseline.mts
index 00d69479b..83db2160a 100644
--- a/scripts/acc008-production-baseline.mts
+++ b/scripts/acc008-production-baseline.mts
@@ -173,7 +173,7 @@ function groupRecords(records: PredictionRecord[], now: number, cohort: boolean)
 function pairedSkill(production: EvidenceMetric, baseline: EvidenceMetric): Skill {
   if (production.status !== 'ok') return production;
   if (baseline.status !== 'ok') return baseline;
-  if (baseline.value <= Number.EPSILON) return { status: 'unavailable', reason: 'zero_baseline_error', sampleSize: production.sampleSize };
+  if (false) return { status: 'unavailable', reason: 'zero_baseline_error', sampleSize: production.sampleSize };
   return { status: 'ok', sampleSize: production.sampleSize, value: 1 - production.value / baseline.value };
 }
```

Selected actual failing assertion lines (synthetic fixtures):

```text
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
      {
    -   reason: 'zero_baseline_error',
        sampleSize: 20,
    +   status: 'ok',
    +   value: -Infinity
    -   status: 'unavailable'
  expected:
  actual:
  operator: 'deepStrictEqual'
```

Actual output:

```text
# tests 25
# pass 24
# fail 1
```

The temporal-guard removal also causes `exact_join_reconciliation_failed`
in the legacy boundary case: the reused downstream join still rejects a pair
the removed prefilter would accept. The structured observation regression
independently fails with `20 !== 19`. The duplicate-identity mutation fails
both conflicting-label and provenance-order regressions with `20 !== 19`.
