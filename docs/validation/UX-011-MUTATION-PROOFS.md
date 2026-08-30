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

## Final-review evidence-only cycle

This human-approved evidence-only cycle started at exact tip
`609456f2c008bc9160f8b8a13b6f244543e0c221`. Initial
`git status --porcelain --untracked-files=no` produced no output; the sole
untracked path was the intentional `node_modules` symlink. The production
checksums before mutation were:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
57f5d3c0ac67a4a19bea404870f6323746ce29c6cd495fee6c6e345970e305bf  src/components/EvacuationPanel.ts
```

Baseline `npm run test:ux011` output:

```text
ℹ tests 58
ℹ pass 58
ℹ fail 0
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

For every production mutation below, `git diff -- <file>` produced the shown
diff before the focused command. After every proof, `apply_patch` restored the
production file, `shasum -a 256` reproduced the corresponding checksum above,
and `git diff --exit-code -- <file>` exited zero. Before the two explicitly
recorded test-fixture corrections, `git status --porcelain --untracked-files=no`
again produced no output after every restoration.

## 29. Provider rejects missing or unknown CAP status

Confirmed mutation:

```diff
-  if (!RECOGNIZED_CAP_STATUSES.has(status as string)) {
+  if (false && !RECOGNIZED_CAP_STATUSES.has(status as string)) {
```

Command:

```bash
npx tsx --test --test-name-pattern='missing or unrecognized CAP status' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ missing or unrecognized CAP status rejects the whole batch
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 30. Canonical fingerprint includes route geometry

The first confirmed geometry-only mutation exposed a test-fixture coupling:

```diff
-    route.geometry.coordinates,
+    [],
```

Command before test correction:

```bash
npx tsx --test --test-name-pattern='canonical fingerprints change' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Output before test correction:

```text
✔ canonical fingerprints change for same-ID geometry or endpoint-coordinate changes
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

The changed-geometry fixture also changed the route endpoint, so endpoint fields
kept the fingerprint unequal after geometry was removed. Production was restored
to checksum
`70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc`,
and `git status --porcelain --untracked-files=no` again produced no output.

The human-approved fixture-only correction kept both endpoints constant and
changed only an interior coordinate:

```diff
-  const original = route([[0, 0], [1, 1]]);
+  const original = route([[0, 0], [1, 1], [2, 2]]);
   assert.equal(canonicalEvacRouteFingerprint(original), canonicalEvacRouteFingerprint({ ...original }));
-  assert.notEqual(canonicalEvacRouteFingerprint(original), canonicalEvacRouteFingerprint(route([[0, 0], [2, 2]])));
+  assert.notEqual(canonicalEvacRouteFingerprint(original), canonicalEvacRouteFingerprint(route([[0, 0], [1, 2], [2, 2]])));
```

With restored production, the two corrected focused fixtures passed:

```text
✔ canonical fingerprints change for same-ID geometry or endpoint-coordinate changes
✔ destroy invalidates in-flight work and subscription ownership
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

The identical confirmed geometry-only production mutation was then repeated:

```diff
-    route.geometry.coordinates,
+    [],
```

Command:

```bash
npx tsx --test --test-name-pattern='canonical fingerprints change' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output after fixture correction:

```text
✖ canonical fingerprints change for same-ID geometry or endpoint-coordinate changes
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to:

'["route-1",[0,0,"A",null,null],[2,2,"B",null,null],10,12,"LineString",[],[],1788055080000]'
actual: '["route-1",[0,0,"A",null,null],[2,2,"B",null,null],10,12,"LineString",[],[],1788055080000]'
expected: '["route-1",[0,0,"A",null,null],[2,2,"B",null,null],10,12,"LineString",[],[],1788055080000]'
operator: 'notStrictEqual'
```

Restored checksum/status:

```text
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
 M src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

## 31. Store snapshots are deeply immutable

Confirmed mutation:

```diff
 function deepFreeze<T>(value: T): T {
-  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
-    Object.freeze(value);
-    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
-  }
   return value;
 }
```

The natural focused command printed the intended failed assertion, but the test
calls `store.destroy()` only after its immutability assertions. Once the
assertion failed, its transition timer remained live. The run was interrupted
after 56 seconds and reported:

```text
✖ store publishes immutable snapshots and maps explicit outside jurisdiction while throws stay unknown
ℹ tests 2
ℹ pass 0
ℹ fail 1
ℹ cancelled 1
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  assert.ok(Object.isFrozen(snapshot))

actual: false
expected: true
operator: '=='
```

Without changing the test or production mutation, the focused run was repeated
with forced test-process teardown solely to capture a complete red footer:

```bash
npx tsx --test --test-force-exit --test-name-pattern='store publishes immutable snapshots' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Complete mutated output:

```text
✖ store publishes immutable snapshots and maps explicit outside jurisdiction while throws stay unknown
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  assert.ok(Object.isFrozen(snapshot))

actual: false
expected: true
operator: '=='
```

The force-exit flag was not added to any repository script. Production was
restored to checksum
`70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc`;
`git diff --exit-code -- src/services/weather/evacuation-hazard-exposure.ts`
exited zero, and `git status --porcelain --untracked-files=no` produced no
output at that point in the cycle.

## 32. Destroy invalidates every in-flight endpoint completion

Before the test correction, the following confirmed mutation removed the
destroyed emission guard, stale-completion destroyed guard, generation
invalidations, listener clearing, and route/fingerprint invalidations:

```diff
@@ -887,7 +887,6 @@ export function createEvacuationHazardExposureStore(
   function emit(results: readonly EvacuationHazardExposure[]): void {
-    if (destroyed) return;
     snapshot = deepFreeze({ generation: snapshot.generation + 1, results: [...results] });
@@ -970,8 +969,7 @@ export function createEvacuationHazardExposureStore(
     })).then((endpointResolutions) => {
       if (
-        destroyed
-        || lifecycleGeneration !== capturedLifecycle
+        lifecycleGeneration !== capturedLifecycle
         || weatherGeneration !== capturedWeather
@@ -1061,16 +1059,10 @@ export function createEvacuationHazardExposureStore(
     destroy(): void {
       if (destroyed) return;
       destroyed = true;
-      lifecycleGeneration += 1;
-      weatherGeneration += 1;
-      routeGeneration += 1;
       clearTransitionTimer();
-      listeners.clear();
       zoneCache.clear();
       zonePending.clear();
       preparedWeatherCache = null;
-      routes = [];
-      fingerprints = [];
     },
```

Command before test correction:

```bash
npx tsx --test --test-name-pattern='destroy invalidates in-flight work' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Output before test correction:

```text
✔ destroy invalidates in-flight work and subscription ownership
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

The resolver fixture overwrote one `resolve` variable for two distinct endpoint
promises and resolved only the final promise. `Promise.all` therefore never
completed, so the stale-completion guard was not exercised. Production was
restored to checksum
`70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc`,
and `git status --porcelain --untracked-files=no` again produced no output.

The human-approved fixture-only correction retained and resolved every endpoint
resolver without changing the expectation:

```diff
@@ -463,9 +463,9 @@ test('store never caches failures and expires successful point-jurisdiction evid
-  let resolve!: (resolution: unknown) => void;
+  const resolvers: Array<(resolution: unknown) => void> = [];
   const store = createEvacuationHazardExposureStore({
-    resolveZones: () => new Promise((done) => { resolve = done; }),
+    resolveZones: () => new Promise((done) => { resolvers.push(done); }),
     now: () => NOW,
   });
@@ -475,7 +475,9 @@ test('destroy invalidates in-flight work and subscription ownership', async () =
   const beforeDestroy = notifications;
   store.destroy();
-  resolve({ status: 'outside-jurisdiction', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000 });
+  for (const resolve of resolvers) {
+    resolve({ status: 'outside-jurisdiction', zones: [], source: 'nws-points', retrievedAt: NOW, validUntil: NOW + 60_000 });
+  }
   await new Promise((done) => setImmediate(done));
```

With restored production, the corrected focused fixture passed as part of the
`2 pass / 0 fail` command quoted in proof 30. The identical broad production
mutation above was then repeated.

Command:

```bash
npx tsx --test --test-name-pattern='destroy invalidates in-flight work' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output after fixture correction:

```text
✖ destroy invalidates in-flight work and subscription ownership
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

4 !== 3
actual: 4
expected: 3
operator: 'strictEqual'
```

Restored checksum/status:

```text
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
 M src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

## 33. Destroy releases subscription ownership

Confirmed mutation notified every listener during destroy before clearing it:

```diff
       routeGeneration += 1;
       clearTransitionTimer();
+      for (const listener of listeners) listener(snapshot);
       listeners.clear();
```

Command:

```bash
npx tsx --test --test-name-pattern='destroy invalidates in-flight work' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ destroy invalidates in-flight work and subscription ownership
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

4 !== 3
actual: 4
expected: 3
operator: 'strictEqual'
```

Production was restored to checksum
`70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc`;
`git diff --exit-code -- src/services/weather/evacuation-hazard-exposure.ts`
exited zero, and `git status --porcelain --untracked-files=no` showed only the
approved evaluator test-fixture correction.

## 34. Provider requires bounded event text

Confirmed mutation:

```diff
-  requiredBoundedString(properties.event, 'event', MAX_NWS_EVENT_LENGTH);
+  if (properties.event !== undefined) requiredBoundedString(properties.event, 'event', MAX_NWS_EVENT_LENGTH);
```

Command:

```bash
npx tsx --test --test-name-pattern='missing, blank, or oversized identifiers and event text' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ missing, blank, or oversized identifiers and event text reject the batch
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 35. Provider preserves Polygon and MultiPolygon areas and holes

Confirmed mutation:

```diff
-        polygonAreas: polygonEvidence.areas,
+        polygonAreas: undefined,
```

Command:

```bash
npx tsx --test --test-name-pattern='Polygon holes are preserved|MultiPolygon areas and their holes are preserved' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ Polygon holes are preserved for evidence consumers while legacy coordinates retain the outer ring
✖ MultiPolygon areas and their holes are preserved while legacy polygonRings retain every outer
ℹ tests 2
ℹ pass 0
ℹ fail 2
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
actual: undefined
expected: [ { rings: [Array] } ]
operator: 'deepStrictEqual'
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
actual: undefined
expected: [ { rings: [Array] }, { rings: [Array] } ]
operator: 'deepStrictEqual'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 36. Provider accepts valid zero longitude and latitude

Confirmed mutation:

```diff
-      typeof lon !== 'number' || !Number.isFinite(lon) ||
-      typeof lat !== 'number' || !Number.isFinite(lat) ||
+      !lon || typeof lon !== 'number' || !Number.isFinite(lon) ||
+      !lat || typeof lat !== 'number' || !Number.isFinite(lat) ||
```

Command:

```bash
npx tsx --test --test-name-pattern='zero coordinates are valid' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ zero coordinates are valid and malformed geometry is explicitly incomplete
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'invalid'
- 'complete'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 37. Provider UGC allowlist rejects malformed codes

Confirmed mutation:

```diff
-    if (typeof code !== 'string' || !/^[A-Z]{2}[CZ]\d{3}$/.test(code)) {
+    if (typeof code !== 'string') {
```

Command:

```bash
npx tsx --test --test-name-pattern='UGC values are allowlist-filtered' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ UGC values are allowlist-filtered, deduplicated, and marked incomplete when any are rejected
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  [
    'INC091',
+   'bad',
+   '',
    'INZ103'
  ]
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 38. Provider enforces the UGC hard bound

Confirmed mutation:

```diff
-const MAX_NWS_UGC_CODES = 2048;
+const MAX_NWS_UGC_CODES = 2049;
```

Command:

```bash
npx tsx --test --test-name-pattern='provider geometry and UGC hard bounds' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ provider geometry and UGC hard bounds fail the whole response closed
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 39. Closure truth remains invariantly unknown

Confirmed mutation:

```diff
-    closure: { status: 'unknown', reason: 'no_closure_feed' } as const,
+    closure: { status: 'unknown', reason: 'route_coverage_unproven' } as const,
```

Command:

```bash
npx tsx --test --test-name-pattern='closure evidence is always unknown' src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Mutated output:

```text
✖ closure evidence is always unknown and carries no inferred road condition
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  {
+   reason: 'route_coverage_unproven',
-   reason: 'no_closure_feed',
    status: 'unknown'
  }
```

Restored checksum/status:

```text
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 40. Provider rejects missing or unknown CAP message type

Confirmed mutation:

```diff
-  if (!RECOGNIZED_MESSAGE_TYPES.has(messageType as string)) {
+  if (false && !RECOGNIZED_MESSAGE_TYPES.has(messageType as string)) {
```

Command:

```bash
npx tsx --test --test-name-pattern='missing or unrecognized message type' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ missing or unrecognized message type rejects the whole batch
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 41. Provider retains only Actual Alert/Update lifecycle products

Confirmed mutation:

```diff
-  if (status !== 'Actual' || !RETAINED_MESSAGE_TYPES.has(messageType as string)) return false;
+  if (false && (status !== 'Actual' || !RETAINED_MESSAGE_TYPES.has(messageType as string))) return false;
```

Command:

```bash
npx tsx --test --test-name-pattern='only Actual CAP status is retained|only Alert and Update message types are retained' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ only Actual CAP status is retained while recognized non-Actual statuses are dropped
✖ only Alert and Update message types are retained
ℹ tests 2
ℹ pass 0
ℹ fail 2
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
actual: [ { id: 'nws-x', event: 'Special Weather Statement', severity: 'Severe', headline: 'h', description: 'd', areaDesc: 'Somewhere, US', sent: 2026-07-27T11:55:00.000Z, effective: 2026-07-27T12:00:00.000Z, reportedOnset: 2026-07-27T12:00:00.000Z, onset: 2026-07-27T12:00:00.000Z, expires: 2026-07-27T13:00:00.000Z, status: undefined, messageType: 'Alert', coordinates: [], polygonRings: undefined, polygonAreas: undefined, geometryStatus: 'absent', centroid: undefined, ugcZones: [Array], ugcStatus: 'complete' } ]
expected: []
operator: 'deepStrictEqual'
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
actual: [ { id: 'nws-x', event: 'Special Weather Statement', severity: 'Severe', headline: 'h', description: 'd', areaDesc: 'Somewhere, US', sent: 2026-07-27T11:55:00.000Z, effective: 2026-07-27T12:00:00.000Z, reportedOnset: 2026-07-27T12:00:00.000Z, onset: 2026-07-27T12:00:00.000Z, expires: 2026-07-27T13:00:00.000Z, status: 'Actual', messageType: undefined, coordinates: [], polygonRings: undefined, polygonAreas: undefined, geometryStatus: 'absent', centroid: undefined, ugcZones: [Array], ugcStatus: 'complete' } ]
expected: []
operator: 'deepStrictEqual'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 42. Provider fails closed on malformed lifecycle dates

Confirmed mutation:

```diff
 function requiredDate(value: unknown, field: string): Date {
   const date = optionalDate(value);
-  if (!date) throw new Error(`NWS alert feature has invalid ${field}`);
+  if (!date) return new Date(0);
```

Command:

```bash
npx tsx --test --test-name-pattern='invalid required lifecycle fields|invalid optional onset' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ invalid required lifecycle fields reject the live response
✖ an invalid optional onset rejects the live response instead of using effective
ℹ tests 2
ℹ pass 0
ℹ fail 2
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 43. Provider requires a bounded alert identifier

Confirmed mutation:

```diff
-  requiredBoundedString(feature.id, 'identifier', MAX_NWS_IDENTIFIER_LENGTH);
+  if (feature.id !== undefined) requiredBoundedString(feature.id, 'identifier', MAX_NWS_IDENTIFIER_LENGTH);
```

Command:

```bash
npx tsx --test --test-name-pattern='missing, blank, or oversized identifiers and event text' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ missing, blank, or oversized identifiers and event text reject the batch
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output.

## 44. Final-review cycle restoration and validation

Final production checksums reproduced the initial values:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
70b1191153597004251152f50e555c4d54e4c9cd7575c0e810519fcff22dd7dc  src/services/weather/evacuation-hazard-exposure.ts
57f5d3c0ac67a4a19bea404870f6323746ce29c6cd495fee6c6e345970e305bf  src/components/EvacuationPanel.ts
```

`git diff --exit-code` over all three production files exited zero. The final
approved evaluator test-fixture checksum was:

```text
84c2178d7b42fd52a0395c100cbabe64a879f594ea008542b8e8e2da7c390832  src/services/weather/__tests__/evacuation-hazard-exposure.test.mts
```

Final targeted command:

```bash
npm run test:ux011
```

Final targeted output:

```text
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2511.752583
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 226.687792
```

Final verification commands:

```bash
npm run typecheck:all
npm run docs:check
git diff --check
```

Actual outcomes:

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json

> crystal-ball@2.25.147 docs:check
> node scripts/check-docs-freshness.mjs

[docs:check] Documentation appears fresh.
```

The combined command exited zero; `git diff --check` produced no output. No
final production behavior changed in this cycle. The only tracked changes are
this evidence document and the two approved evaluator test-fixture corrections;
the only untracked path remains the intentional `node_modules` symlink.

## Fresh-review provider-boundary evidence

This additional evidence cycle started at exact branch tip:

```text
42b73a57e731cacad4873f75f4ee223799502522
```

The initial production checksum was:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git status --porcelain --untracked-files=no` produced no output before the
first mutation. The untracked `node_modules` symlink was intentionally ignored.

## 45. Exact CAP field mapping retains `sent` independently of `effective`

Confirmed mutation:

```diff
-        sent: optionalDate(alert.properties.sent),
+      sent: optionalDate(alert.properties.effective),
```

Command:

```bash
npx tsx --test --test-name-pattern='live normalization retains exact CAP lifecycle' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ live normalization retains exact CAP lifecycle and evidence completeness (26.104875ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3781.377292
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ '2026-07-27T12:00:00.000Z'
- '2026-07-27T11:55:00.000Z'
actual: '2026-07-27T12:00:00.000Z'
expected: '2026-07-27T11:55:00.000Z'
operator: 'strictEqual'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 46. Missing CAP onset falls back to effective

Confirmed mutation:

```diff
-        onset: reportedOnset ?? effective ?? new Date(Number.NaN),
+        onset: reportedOnset ?? new Date(Number.NaN),
```

Command:

```bash
npx tsx --test --test-name-pattern='missing onset preserves null reported onset' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ missing onset preserves null reported onset and uses effective for legacy onset (2.547875ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 496.175333
RangeError: Invalid time value
    at Date.toISOString (<anonymous>)
    at TestContext.<anonymous> (/Users/bradleybond/Developer/crystalball/.worktrees/ux011-hazard-closure-exposure/src/services/weather/__tests__/weather-alerts-parse.test.mts:174:29)
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 47. Out-of-range geometry is invalidated instead of coerced onto Earth

Confirmed mutation:

```diff
-    const ring = toFiniteRing(rawRing as number[][]);
+    const ring = toFiniteRing((rawRing as number[][]).map(([lon, lat]) => [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))]));
```

Command:

```bash
npx tsx --test --test-name-pattern='zero coordinates are valid and malformed geometry is explicitly incomplete' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ zero coordinates are valid and malformed geometry is explicitly incomplete (9.671375ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 431.170333
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'complete'
- 'invalid'
actual: 'complete'
expected: 'invalid'
operator: 'strictEqual'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 48. A present non-array UGC field is invalid, not absent

Confirmed mutation:

```diff
-  if (!Array.isArray(value)) return { zones: [], status: 'invalid' };
+  if (!Array.isArray(value)) return { zones: [], status: 'absent' };
```

Command:

```bash
npx tsx --test --test-name-pattern='a genuinely absent UGC field is distinct from malformed UGC evidence' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ a genuinely absent UGC field is distinct from malformed UGC evidence (10.371458ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 435.389458
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'absent'
- 'invalid'
actual: 'absent'
expected: 'invalid'
operator: 'strictEqual'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 49. The polygon-area work cap is response-wide

Confirmed mutation:

```diff
-  responseBudget.areas += rawAreas.length;
+  responseBudget.areas = rawAreas.length;
```

Command:

```bash
npx tsx --test --test-name-pattern='response-wide polygon-area cap rejects aggregate work below every per-feature limit' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ response-wide polygon-area cap rejects aggregate work below every per-feature limit (5.2555ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 519.568417
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: /response exceeds polygon area limit/
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 50. The ring work cap is response-wide

Confirmed mutation:

```diff
-  responseBudget.rings += rawArea.length;
+  responseBudget.rings = rawArea.length;
```

Command:

```bash
npx tsx --test --test-name-pattern='response-wide ring cap rejects aggregate work below every per-feature limit' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ response-wide ring cap rejects aggregate work below every per-feature limit (7.462833ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 578.369791
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: /response exceeds geometry ring limit/
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 51. The per-feature polygon-area bound fails the response closed

Confirmed mutation:

```diff
-const MAX_NWS_POLYGON_AREAS = 128;
+const MAX_NWS_POLYGON_AREAS = 129;
```

Command:

```bash
npx tsx --test --test-name-pattern='provider geometry and UGC hard bounds fail the whole response closed' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Mutated output:

```text
✖ provider geometry and UGC hard bounds fail the whole response closed (5.2365ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 769.483042
AssertionError [ERR_ASSERTION]: Missing expected exception.
actual: undefined
expected: undefined
operator: 'throws'
```

Restored checksum/status:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero and
`git status --porcelain --untracked-files=no` produced no output.

## 52. Fresh-review evidence restoration and validation

The final production checksum reproduced the initial value:

```text
3d515d7048419e247ce76175e265397b980dbc2e21fede5ca3ab93f107e1a7bc  src/services/weather.ts
```

`git diff --exit-code -- src/services/weather.ts` exited zero.

Restored focused command:

```bash
npx tsx --test --test-name-pattern='live normalization retains exact CAP lifecycle|missing onset preserves null reported onset|zero coordinates are valid and malformed geometry is explicitly incomplete|a genuinely absent UGC field is distinct from malformed UGC evidence|response-wide polygon-area cap rejects aggregate work below every per-feature limit|response-wide ring cap rejects aggregate work below every per-feature limit|provider geometry and UGC hard bounds fail the whole response closed' src/services/weather/__tests__/weather-alerts-parse.test.mts
```

Restored focused output:

```text
✔ live normalization retains exact CAP lifecycle and evidence completeness (5.488042ms)
✔ missing onset preserves null reported onset and uses effective for legacy onset (0.240167ms)
✔ zero coordinates are valid and malformed geometry is explicitly incomplete (0.266084ms)
✔ a genuinely absent UGC field is distinct from malformed UGC evidence (0.10475ms)
✔ response-wide polygon-area cap rejects aggregate work below every per-feature limit (2.642292ms)
✔ response-wide ring cap rejects aggregate work below every per-feature limit (0.820958ms)
✔ provider geometry and UGC hard bounds fail the whole response closed (0.358583ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 536.2685
```

Final targeted command:

```bash
npm run test:ux011
```

Final targeted output:

```text
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1449.721667
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 131.710166
```

Final verification commands:

```bash
npm run typecheck:all
npm run docs:check
git diff --check
```

Actual outcomes:

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json

> crystal-ball@2.25.147 docs:check
> node scripts/check-docs-freshness.mjs

[docs:check] Documentation appears fresh.
```

The typecheck command exited zero. The documentation and diff checks exited
zero; `git diff --check` produced no output. No production or test file remains
modified by this cycle.
