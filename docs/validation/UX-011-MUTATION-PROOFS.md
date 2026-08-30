<!-- markdownlint-disable MD013 -- exact commands, assertions, and diffs cannot wrap -->

# UX-011 Mutation Proofs

Date: 2026-08-30

The tracked tree started clean at `1d3a95a42ede6d8eccf2c3c310c6ff5cf96c9404` (`git status --porcelain --untracked-files=no` produced no output); the sole untracked path was the intentional `node_modules` symlink. Each production mutation below was applied alone and confirmed with `git diff -- <file>`. After every proof the production file was restored byte-for-byte, its SHA-256 matched the baseline, and `git diff --exit-code -- <file>` exited zero.

Baseline command:

```bash
npm run test:ux011
```

Baseline output:

```text
ℹ tests 46
ℹ pass 46
ℹ fail 0
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Production baseline and restored SHA-256 values:

```text
bfe4de17686fd7872a2901f951c1777e2ff11392d14bd2592192536ddff10e7d  src/services/weather/evacuation-hazard-exposure.ts
d8c4c47ec0991d884b530e0c92bd3a5e03058c15dfc92a2751505adfa18476a4  src/components/EvacuationPanel.ts
b365bdb445b5f15ce565d97c47d0c336fb7f51d2ff66527adcbe5e7f3161c132  src/app/data-loader.ts
6f7cc7fd061e9321bf087cae521af5714a51a7af556a49bed4387aac59de4dc4  package.json
```

## 1. Actual-status allowlist

Confirmed mutation:

```diff
-  const invalidLifecycle = alert.status !== 'Actual'
-    || (alert.messageType !== 'Alert' && alert.messageType !== 'Update')
+  const invalidLifecycle = (alert.messageType !== 'Alert' && alert.messageType !== 'Update')
```

Command:

```bash
npx tsx --test --test-name-pattern='moderate, minor, non-Actual' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ moderate, minor, non-Actual, and non-Alert/Update products cannot become exposure evidence
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'reported_intersection'
- 'unknown'
```

## 2. Feed freshness gate

Confirmed mutation:

```diff
-  const feedFresh = isWeatherFeedFresh(input.weather.feedState, now, WEATHER_FEED_TTL_MS);
+  const feedFresh = true;
```

Command:

```bash
npx tsx --test --test-name-pattern='only a current feed' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ only a current feed plus covered point jurisdiction and complete evidence proves an endpoint miss
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ { status: 'no_reported_intersection', retrievedAt: 1788053340000 }
- { status: 'unknown', reason: 'feed_not_current' }
```

## 3. Segment-edge intersection

Confirmed mutation:

```diff
   const vertexResult = routeVerticesIntersectAreas(coordinates, areas, budget);
   if (vertexResult !== 'miss') return vertexResult;
-  return routeSegmentsIntersectAreas(coordinates, areas, budget);
+  return vertexResult;
```

Command:

```bash
npx tsx --test --test-name-pattern='route segment crosses' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ reports polygon exposure when a route segment crosses an alert without a vertex inside
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'unknown'
- 'reported_intersection'
```

## 4. Polygon-hole subtraction

Confirmed mutation:

```diff
-    if (withinHole === 'inside') return 'miss';
+    if (withinHole === 'inside') return 'hit';
```

Command:

```bash
npx tsx --test --test-name-pattern='subtracts holes' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ subtracts holes while reporting a segment that crosses from a hole into the alert area
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'reported_intersection'
- 'unknown'
```

## 5. Antimeridian unwrap

Confirmed mutation:

```diff
-  const rawDelta = to[0] - from[0];
-  const delta = ((rawDelta + 540) % 360) - 180;
-  if (Math.abs(delta) === 180) return null;
-  return [from, [from[0] + delta, to[1]]];
+  return [from, to];
```

Command:

```bash
npx tsx --test --test-name-pattern='antimeridian' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ matches polygons across the antimeridian without treating the long way around as inside
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'unknown'
- 'reported_intersection'
```

## 6. UGC endpoint match

Confirmed mutation:

```diff
-    if (match) {
+    if (match && false) {
```

Command:

```bash
npx tsx --test --test-name-pattern='matching UGC zone' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ a current matching UGC zone reports endpoint exposure but never route exposure
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'no_reported_intersection'
- 'reported_intersection'
```

## 7. Route misses remain unknown

Confirmed mutation:

```diff
-  let routeTruth: HazardExposureTruth = { status: 'unknown', reason: 'route_coverage_unproven' };
+  let routeTruth: HazardExposureTruth = { status: 'no_reported_intersection', retrievedAt: input.weather.feedState.timestamp ?? now };
```

Command:

```bash
npx tsx --test --test-name-pattern='matching UGC zone' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ a current matching UGC zone reports endpoint exposure but never route exposure
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'no_reported_intersection'
- 'unknown'
```

## 8. Endpoint coverage and completeness gate

Confirmed mutation removed all three negative-claim blockers:

```diff
-  if (unevaluable) return { status: 'unknown', reason: 'alert_unevaluable' };
-  if (zones.status === 'unknown') return { status: 'unknown', reason: 'jurisdiction_unknown' };
-  if (zones.status === 'outside_jurisdiction') return { status: 'unknown', reason: 'outside_jurisdiction' };
```

Command:

```bash
npx tsx --test --test-name-pattern='only a current feed|future, expired' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ only a current feed plus covered point jurisdiction and complete evidence proves an endpoint miss
✖ future, expired, malformed, or incomplete evidence fails endpoint misses closed
ℹ tests 2
ℹ pass 0
ℹ fail 2
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ { status: 'no_reported_intersection', retrievedAt: 1788055140000 }
- { status: 'unknown', reason: 'outside_jurisdiction' }
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ { status: 'no_reported_intersection', retrievedAt: 1788055140000 }
- { status: 'unknown', reason: 'alert_unevaluable' }
```

## 9. Operation budget fails closed

Confirmed mutation:

```diff
-  return budget[scope] <= scopeLimit && budget.total.count <= MAX_REFRESH_GEOMETRY_OPERATIONS;
+  return true;
```

Command:

```bash
npx tsx --test --test-name-pattern='exact-operation budget' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ the exact-operation budget returns unknown rather than completing an over-budget miss
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ { status: 'unknown', reason: 'route_coverage_unproven' }
- { status: 'unknown', reason: 'evaluation_limit' }
```

## 10. Route, weather, fingerprint, and coordinate stale-completion guard

The first confirmed removal of the entire guard produced `1 pass / 0 fail`. This was a genuine test gap: the test asserted before the resolver microtask had registered its endpoint promises, then asserted only that no positive was visible. The focused test was repaired to wait for registration, resolve the old route's endpoints, assert that no old result is published, and register `store.destroy()` as unconditional test cleanup. With production restored it passed `1 pass / 0 fail`. The exact same confirmed production mutation was then repeated:

```diff
-      if (
-        destroyed
-        || lifecycleGeneration !== capturedLifecycle
-        || weatherGeneration !== capturedWeather
-        || routeGeneration !== capturedRoutes
-        || fingerprints.length !== capturedFingerprints.length
-      ) return;
-      for (const [index, fingerprint] of fingerprints.entries()) {
-        const route = routes[index]!;
-        if (
-          fingerprint !== capturedFingerprints[index]
-          || canonicalEvacRouteFingerprint(route) !== capturedFingerprints[index]
-          || coordinateKey(route.from.lat, route.from.lon) !== capturedCoordinateKeys[index]![0]
-          || coordinateKey(route.to.lat, route.to.lon) !== capturedCoordinateKeys[index]![1]
-        ) return;
-      }
```

Command:

```bash
npx tsx --test --test-name-pattern='rejects stale zone completions' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output after the test repair:

```text
✖ store rejects stale zone completions after route, weather, fingerprint, or coordinate changes
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: an older route evaluation must not publish after either input changes
+ [
+   {
+     routeFingerprint: '["route-1",[0,0,"A",null,null],[1,1,"B",null,null],10,12,"LineString",[[0,0],[1,1]],[],1788055080000]',
+     routeId: 'route-1'
+   }
+ ]
- []
```

The actual failure also printed the complete stale exposure object; the excerpt retains its identifying fingerprint and the expected empty publication.

## 11. UI event escaping

Confirmed mutation:

```diff
- <div>NWS reports ${escapeHtml(truth.evidence.event)} intersecting this graph route.</div>
+ <div>NWS reports ${truth.evidence.event} intersecting this graph route.</div>
```

The first run observed the intended failed assertion but did not print the Node summary because the failed assertion preceded `panel.destroy()`. The test was repaired to register unconditional cleanup, passed restored at `1 pass / 0 fail`, and the same confirmed mutation was repeated.

Command:

```bash
npx tsx --test --test-name-pattern='escaped reported evidence' src/components/__tests__/evacuation-hazard-exposure-panel.test.mts
```

Mutated output after the cleanup repair:

```text
✖ renders loading then escaped reported evidence with exact source, times, coverage, and disclosure
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /NWS reports Tornado <img src=x onerror=alert\(1\)> intersecting this graph route\./.
Input: 'NWS reports Tornado  intersecting this graph route.'
```

## 12. Loader failure publishes unavailable

Confirmed mutation:

```diff
- evacuationHazardExposureStore.publishWeatherSnapshot({
- alerts: [],
- feedState: { mode: 'unavailable', timestamp: null },
- });
```

Command:

```bash
node --test --test-name-pattern='outer failure revokes' tests/evacuation-hazard-exposure-wiring.test.mjs
```

Mutated output:

```text
✖ the atomic weather pair is published immediately and outer failure revokes it
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /catch \(error\) \{\s*evacuationHazardExposureStore\.publishWeatherSnapshot/
```

## 13. Covered-negative retrieval time provenance

Confirmed mutation:

```diff
-  return { status: 'no_reported_intersection', retrievedAt };
+  return { status: 'no_reported_intersection', retrievedAt: 0 };
```

Command:

```bash
npx tsx --test --test-name-pattern='only a current feed' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ only a current feed plus covered point jurisdiction and complete evidence proves an endpoint miss
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ retrievedAt: 0
- retrievedAt: 1788055140000
```

## 14. Natural targeted-test shutdown

Confirmed mutation:

```diff
-    "test:ux011": "tsx --test src/services/weather/__tests__/weather-alerts-parse.test.mts ...",
+    "test:ux011": "tsx --test --test-force-exit src/services/weather/__tests__/weather-alerts-parse.test.mts ...",
```

Command:

```bash
node --test --test-name-pattern='UX-011 script' tests/evacuation-hazard-exposure-wiring.test.mjs
```

Mutated output:

```text
✖ the UX-011 script selects provider, evaluator, panel, and wiring contracts
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: targeted tests must prove clean natural shutdown
actual: 'tsx --test --test-force-exit ...'
expected: /--test-force-exit/
operator: 'doesNotMatch'
```

## Final restoration and validation

After all 14 proofs, the four mutated production/configuration files reproduced the baseline checksums above. `git diff --exit-code` over those files exited zero. `git status --porcelain --untracked-files=no` showed only the two intentional tracked test hardening edits. `git status --short` additionally showed this new evidence file and the pre-existing untracked `node_modules` symlink.

Final command:

```bash
npm run test:ux011
```

Final output:

```text
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2805.846209
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 197.898209
```

`git diff --check` also exited zero. No production behavior was changed during this adversarial verification.
