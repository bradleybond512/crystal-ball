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

## Independent-review repair cycle

The first independent-review repair cycle was verified at exact commit
`39f2fba83c90c5c2b35b533421b041e6d6c6c928`. Before the first mutation,
`git status --porcelain --untracked-files=no` produced no output. The sole
untracked path was the intentional `node_modules` symlink.

Baseline command:

```bash
npm run test:ux011
```

Baseline output:

```text
ℹ tests 58
ℹ pass 58
ℹ fail 0
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Repair-cycle production baseline and restored SHA-256 values:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
57f5d3c0ac67a4a19bea404870f6323746ce29c6cd495fee6c6e345970e305bf  src/components/EvacuationPanel.ts
```

Each mutation below was applied alone. `git diff -- <file>` confirmed the
mutation before its focused command ran. The production file was restored
afterward, its SHA-256 reproduced the value above, and
`git diff --exit-code -- <file>` exited zero.

## 15. Provider rejects zero-area rings

Confirmed mutation:

```diff
-    if (!isUsableMatchRing(ring)) return undefined;
+    if (ring.length < 3) return undefined;
```

Command:

```bash
npx tsx --test --test-name-pattern='zero-area outer and hole rings' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ zero-area outer and hole rings make polygon evidence invalid
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'complete'
- 'invalid'
```

## 16. Present malformed geocode is invalid, not absent

Confirmed mutation:

```diff
   if (value === null || typeof value !== 'object' || Array.isArray(value)) {
-    return { zones: [], status: 'invalid' };
+    return { zones: [], status: 'absent' };
   }
```

Command:

```bash
npx tsx --test --test-name-pattern='only a truly missing geocode container' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ only a truly missing geocode container is absent; present malformed containers are invalid
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'absent'
- 'invalid'
```

## 17. Response-wide vertex cap

Confirmed mutation reset the response budget for every feature:

```diff
-      const polygonEvidence = normalizePolygonEvidence(alert.geometry, responseGeometryBudget);
+      const polygonEvidence = normalizePolygonEvidence(alert.geometry, { areas: 0, rings: 0, vertices: 0 });
```

Command:

```bash
npx tsx --test --test-name-pattern='response-wide vertex cap' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ response-wide vertex cap rejects aggregate work below every per-feature limit
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
expected: /response exceeds geometry vertex limit/
operator: 'throws'
```

## 18. `/points` requires fire-weather jurisdiction evidence

Confirmed mutation reused the forecast zone instead of reading and validating
the required `fireWeatherZone` field:

```diff
-    fireWeatherZone: parseNwsZoneUrl(properties.fireWeatherZone, 'fire'),
+    fireWeatherZone: parseNwsZoneUrl(properties.forecastZone, 'forecast'),
```

Command:

```bash
npx tsx --test --test-name-pattern='malformed or incomplete 200 point body' src/services/weather/__tests__/weather-ugc-fetch.test.mts
```

Mutated output:

```text
✖ a malformed or incomplete 200 point body fails closed
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected rejection.
operator: 'rejects'
```

## 19. Evaluator independently rejects zero-area rings

Confirmed mutation:

```diff
   if (!consumePreparation(total, raw.length + 1)
     || counts.rings > MAX_RINGS
-    || counts.vertices > MAX_VERTICES
-    || !isUsableMatchRing(raw)) return null;
+    || counts.vertices > MAX_VERTICES) return null;
```

Command:

```bash
npx tsx --test --test-name-pattern='zero-area identical and collinear rings' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ zero-area identical and collinear rings are independently unevaluable in the evaluator
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   retrievedAt: 1788055170000,
+   status: 'no_reported_intersection'
-   reason: 'alert_unevaluable',
-   status: 'unknown'
  }
```

## 20. Preprocessing consumes the shared work budget

Confirmed mutation gave preprocessing a detached budget:

```diff
-  const prepared = prepareAlerts(input.weather.alerts, input.weather.feedState, now, totalBudget);
+  const prepared = prepareAlerts(input.weather.alerts, input.weather.feedState, now, { count: 0 });
```

Command:

```bash
npx tsx --test --test-name-pattern='alert preprocessing consumes the shared bounded work budget' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ alert preprocessing consumes the shared bounded work budget before any route scan
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   reason: 'route_coverage_unproven',
-   reason: 'evaluation_limit',
    status: 'unknown'
  }
```

## 21. One preparation per weather generation

Confirmed mutation re-prepared provider geometry inside the per-route map:

```diff
-        prepared,
+        prepareAlerts(weather.alerts, weather.feedState, evaluationNow, totalBudget),
```

Command:

```bash
npx tsx --test --test-name-pattern='store prepares one weather generation once' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ store prepares one weather generation once and reuses it across every route
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: weather geometry must be prepared once, not once per route
3 !== 1
```

## 22. Point-jurisdiction currency gate

The first confirmed mutation exposed a genuine fixture coupling and returned
`1 pass / 0 fail`: the stale covered fixture listed only `INC091`, while its
three declared fields also required `INZ103`. It was therefore rejected as
structurally incomplete before currency was evaluated. Production was restored.
The test fixture was hardened from:

```diff
-    zones: ['INC091'],
+    zones: ['INC091', 'INZ103'],
```

With production restored, the focused test passed:

```text
✔ stale point-jurisdiction evidence cannot authorize UGC matches or endpoint negatives
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

The identical production mutation was then repeated and confirmed:

```diff
 function validJurisdictionCurrency(retrievedAt: number, validUntil: number, now: number): boolean {
-  return Number.isFinite(retrievedAt)
-    && Number.isFinite(validUntil)
-    && retrievedAt <= now
-    && validUntil >= now
-    && validUntil >= retrievedAt
-    && validUntil - retrievedAt <= NWS_POINT_JURISDICTION_TTL_MS;
+  return Number.isFinite(retrievedAt) && Number.isFinite(validUntil) && Number.isFinite(now);
 }
```

Command:

```bash
npx tsx --test --test-name-pattern='stale point-jurisdiction evidence' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output after the test repair:

```text
✖ stale point-jurisdiction evidence cannot authorize UGC matches or endpoint negatives
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   evidence: {
+     alertId: 'alert-1',
+     basis: 'ugc',
+     effectiveAt: 1788054300000,
+     event: 'Tornado Warning',
+     expiresAt: 1788057000000,
+     onsetAt: 1788054600000,
+     retrievedAt: 1788055140000,
+     sentAt: 1788054000000,
+     severity: 'Extreme',
+     source: 'National Weather Service active alerts',
+     ugcZone: 'INC091'
+   },
+   status: 'reported_intersection'
-   reason: 'jurisdiction_unknown',
-   status: 'unknown'
  }
```

## 23. Endpoint-negative retrieval-time provenance after structured lookup

Confirmed mutation:

```diff
-  return { status: 'no_reported_intersection', retrievedAt: zones.retrievedAt };
+  return { status: 'no_reported_intersection', retrievedAt: 0 };
```

Command:

```bash
npx tsx --test --test-name-pattern='only a current feed plus covered point jurisdiction' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ only a current feed plus covered point jurisdiction and complete evidence proves an endpoint miss
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   retrievedAt: 0,
-   retrievedAt: 1788055170000,
    status: 'no_reported_intersection'
  }
```

## 24. Successful jurisdiction-cache expiry

Confirmed mutation returned cached jurisdiction evidence without validating its
currency or evicting it:

```diff
     const cached = zoneCache.get(key);
-    if (cached) {
-      const validated = validateZoneResolution(cached, now());
-      if (validated.status !== 'unknown') return Promise.resolve(validated);
-      zoneCache.delete(key);
-    }
+    if (cached) return Promise.resolve(cached);
```

Command:

```bash
npx tsx --test --test-name-pattern='store never caches failures and expires successful point-jurisdiction evidence' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ store never caches failures and expires successful point-jurisdiction evidence
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: expired jurisdiction evidence must be fetched again
2 !== 3
```

## 25. Transient resolver failures are neither fabricated nor cached

Confirmed mutation converted a rejection into cached outside-jurisdiction
evidence:

```diff
-      }, () => ({ status: 'unknown' }) as EndpointZoneResolution)
+      }, () => {
+        const currentTime = now();
+        const resolution: EndpointZoneResolution = {
+          status: 'outside_jurisdiction',
+          source: 'nws-points',
+          retrievedAt: currentTime,
+          validUntil: currentTime + NWS_POINT_JURISDICTION_TTL_MS,
+        };
+        zoneCache.set(key, resolution);
+        return resolution;
+      })
```

Command:

```bash
npx tsx --test --test-name-pattern='store never caches failures and expires successful point-jurisdiction evidence' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ store never caches failures and expires successful point-jurisdiction evidence
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   reason: 'outside_jurisdiction',
-   reason: 'jurisdiction_unknown',
    status: 'unknown'
  }
```

## 26. Conflicting duplicate IDs fail closed

Confirmed mutation treated every same-ID alert as identical:

```diff
-  const same = samePreparedAlert(previous, current, total);
+  const same = true;
```

Command:

```bash
npx tsx --test --test-name-pattern='conflicting duplicate alert IDs fail closed' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ conflicting duplicate alert IDs fail closed independent of feed order
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'reported_intersection'
- 'unknown'
```

## 27. Duplicate handling does not serialize full provider geometry

Confirmed mutation:

```diff
   for (const alert of relevant.alerts) {
+    JSON.stringify(alert.polygonAreas);
     const current = prepareCurrentAlert(alert, feedState, now, total);
```

Command:

```bash
npx tsx --test --test-name-pattern='exact duplicate alerts deduplicate without serializing full provider geometry' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ exact duplicate alerts deduplicate without serializing full provider geometry
ℹ tests 1
ℹ pass 0
ℹ fail 1
Error: full geometry serialization is forbidden
    at JSON.stringify (<anonymous>)
    at prepareAlerts (src/services/weather/evacuation-hazard-exposure.ts:451:10)
```

## 28. Custom From/To values survive asynchronous rerender

Confirmed mutation:

```diff
   this.content.innerHTML = parts.join('');
-  this.restoreCustomRouteSelections(customRouteSelections);
   this.restoreFocusedControl(focused);
```

Command:

```bash
npx tsx --test --test-name-pattern='preserves both custom route selections' src/components/__tests__/evacuation-hazard-exposure-panel.test.mts
```

Mutated output:

```text
✖ preserves both custom route selections and keyboard focus across asynchronous evidence updates
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: the From selection must survive an evidence refresh
+ actual - expected

+ ''
- '4e2996c1-0c0a-4e06-8ef5-dfef205a173e'
```

The expected value above is the UUID produced by the test's saved-place fixture
on that exact run.

## Repair-cycle restoration and validation

The three production files reproduced their pre-mutation SHA-256 values:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
57f5d3c0ac67a4a19bea404870f6323746ce29c6cd495fee6c6e345970e305bf  src/components/EvacuationPanel.ts
```

`git diff --exit-code` over those three production files exited zero. The
hardened evaluator test has SHA-256
`23a7481422be9bf9e1b670529c88cba960ec1cbf899b579468bee2e22b009c19`.
`git status --short` showed only this evidence document, that one test fixture
hardening edit, and the intentional untracked `node_modules` symlink.

Final command:

```bash
npm run test:ux011
```

Final output:

```text
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1294.367583
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 133.732917
```

`git diff --check` exited zero before that final test run. No production behavior
was changed during the repair-cycle adversarial verification.
