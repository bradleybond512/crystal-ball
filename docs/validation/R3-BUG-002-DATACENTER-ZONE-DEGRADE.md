# R3-BUG-002 validation — datacenter posture degrades instead of freezing

Original author report dated September 29, 2026 on branch `claude/r3-bug-002-datacenter-posture`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-29-r3-bug-002-datacenter-zone-degrade.md).

## October 10 final private repair validation

The September author report below is preserved as an author claim. Its original
raw execution/mutation artifacts were unavailable; its historical counts are
**not independently attested**. Current private proofs below are separate from
that report. Original Claude source:
`68aa43653be241ca0252f218d18dfda9dd338209`; integrated main:
`cc353c94de7a181a46366fdd6d33a1dc12d27cc8`; final repaired code freeze:
`d6613b1010119ef43f326cbfa63507cc10e471d9`.

### Two bounded repairs and retained review history

The first repair binds every provider stage, its own zone enrichment and catch
to the captured site object. Tests execute the actual production async function,
awaited invocation and next weather-trace statement, using finite providers and
real datacenter state/helper/posture/matcher functions. Replaced-site work cannot
apply its inputs or stale-mark a newer site's posture. Same-ID edits and different
IDs at identical coordinates invalidate work too.

The first complete independent Sol review at
`3c616e4897b088924e18d8ee73c252a0a5d478ea` found one blocking P2: a subscriber
can throw after real posture publication and again during the catch's stale
emission, escaping the local function and suppressing current weather processing.
The outer clear-revocation backstop mitigates persistent confirmed-clear; the
confirmed impact is missed current threat/insights/notification/chip processing.
That conclusion and all 143 first-cycle QA artifacts remain unchanged.

The second and final automatic repair contains only the stale-mark notification
exception inside the owned catch. The real state function already stores the
stale label before notifying; the local catch preserves that state and lets the
weather continuation run. It adds no global subscriber policy, provider request,
cache policy or persisted schema. Two new scenarios use real subscriptions with
non-null posture: repeated publication/stale throws, and an infrastructure failure
with a prior posture plus a throwing stale subscriber. They assert local resolution,
actual trace continuation, retained payloads/label and repeated-failure deduplication.
Before production editing, the old loader reported:

```text
# pass 33
# fail 2
```

Both failures were named `doesNotReject` assertions through the real stale emit.
Every prior runtime-test byte was retained. The earlier full gate and fifteen
mutation proofs remain pinned to their earlier code freeze, not presented as
current-code proof. A blocker surviving this final repair requires human decision;
no third automatic production repair is authorized.

### Current clean-baseline commands and raw output

Each command used fake HOME, an explicit environment, offline npm, finite
fixtures and a test-owned network guard. All source bytes/modes/links, HEAD,
index and status stayed unchanged and children were reaped. Actual separate
output blocks are quoted below; overlapping suites are not aggregated.

`npm run test:datacenter`:

```text
# pass 44
# fail 0
# pass 2
# fail 0
```

`npm run test:datacenter-ownership`:

```text
# pass 35
# fail 0
# pass 2
# fail 0
```

`npm run test:weather`:

```text
# pass 411
# fail 0
```

`npm run test:quiet-hours`:

```text
# pass 120
# fail 0
```

`npm run test:ux059`:

```text
# pass 32
# fail 0
```

`npm run test:agentic-pipeline`:

```text
# pass 65
# fail 0
```

`npm run test:install-scripts`:

```text
# pass 56
# fail 0
```

The actual strict selector exited 0: 14 changed files select all 35 CI suites.
The verbatim trusted-main eight-file datacenter stage was executed separately:
`# pass 40` / `# fail 0`. The distinct ownership script retains the new runtime
coverage when CI uses main's existing datacenter command. Five selected suites
and two supplementary shared-behavior suites ran locally; the remaining 30
broadly inferred suites await full CI. No all-35 local pass or CI success is
claimed. Main routing entries, selector implementation and validation rules
remain intact. Current runs were serial with no startup collision. The first
cycle's no-test snapshot-lock attempts remain qualified environmental failures.

### Sixteen current applied mutation proofs

Each mutant began at the clean repaired code freeze, changed one unique
inspected context and produced the actual counts below. Every full 5,026-file
manifest, mode/link, HEAD, index and clean status was restored before the next
mutant. All 16 faults failed named behavior assertions across 17 commands.
The original seven degradation behaviors are current private equivalents, not
retroactive attestation of September's campaign.

| Mutation | File | Script | Baseline → mutant pass/fail |
|---|---|---|---|
| g1 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 26/9 |
| g2 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 34/1 |
| g3 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 34/1 |
| g4 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 31/4 |
| g5 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 33/2 |
| g6 | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 34/1 |
| own-enrichment | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 19/16 |
| local-continuation | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 4/31 |
| o1-rethrow | `site-zones.ts` | `test:datacenter` | 44/0 → 42/2 |
| o1-rethrow | `site-zones.ts` | `test:datacenter-ownership` | 35/0 → 31/4 |
| o2-failure-cache | `site-zones.ts` | `test:datacenter` | 44/0 → 42/2 |
| o3-zone-stale | `datacenter-posture.ts` | `test:datacenter` | 44/0 → 43/1 |
| o4-stale-noop | `datacenter-state.ts` | `test:datacenter` | 44/0 → 43/1 |
| o5-degraded-flag | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 33/2 |
| o6-catch-call | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 31/4 |
| o7-bypass-helper | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 16/19 |
| c2-stale-emission-containment | `data-loader.ts` | `test:datacenter-ownership` | 35/0 → 33/2 |

The new containment unwrap failed exactly S1 and S2 at named `doesNotReject`
assertions. LOCAL-CONTINUATION failed at actual `traceCalls: 0` versus `1`,
without an extraction error. O1 ran both scripts; its ownership result includes
`failed zone lookup still publishes the polygon warning posture`. Baseline
source checks passed separately. Mutant chained source checks were skipped
after runtime failure through `&&`; no mutant source counts are invented.

Restored source SHA-256 values:

- `src/app/data-loader.ts`: `d6db2736bf8321c4c1e3cafbf44a9ebe281c57940e0fe8e350dd690ed94ad0b3`
- `src/services/datacenter/site-zones.ts`: `df967f18585d2299422073bccb76ea0b6038f6052cc7864699b126521737b15d`
- `src/services/datacenter/datacenter-posture.ts`: `ef8bc5372adcef4b00799db4b94055f4d74f4c6443719dcd434d44e6a7558b4c`
- `src/services/datacenter/datacenter-state.ts`: `9f46bdc3669906cbaa5c608b047ef03830205e746fd231d026c8a0321b263c4f`

The current private mutation ledger, `cycle-two/mutations/c2-ledger.json`, has
SHA-256 `44bee963a315b383de73055fdba44c61575fc2500616d61fb630e5c0efbce197`.
The full restored manifest has SHA-256
`f95c73c6be5592320102b9d55e75d47f174356787f79a835e28189908e6f5a08`.
All exact patches, command/log hashes and named assertions are preserved outside
the checkout, with 190 current indexed QA artifacts. Root independently audited
all 17 mutant commands, every full restoration and both the 190 current and
143 preserved earlier artifact hashes.

### Saved live response shape

The existing credential-free public fixture bodies, retrieved October 6 at
05:43 UTC, were independently checked for hashes, bytes, shape and row count.
They qualify historical request/schema evidence; they are not a current health
probe, outage reproduction, adapter replay or user-location threat assessment.
No new provider request was made.

- `https://api.weather.gov/points/41.6,-86.7`: one GeoJSON `Feature`, 3,905 bytes;
  `properties.forecastZone`, `county` and `fireWeatherZone` contain the exact HTTPS
  zone URLs normalized to `INZ103`, `INC091` and `INZ103`. Body SHA-256:
  `9a481b377bc0ebc1addf1db58e41c4c763bffb931366e08f856e5d4fd5342da6`.
- `https://api.weather.gov/alerts/active`: GeoJSON `FeatureCollection`, 324 rows,
  1,441,186 bytes; all 324 have array-valued `properties.geocode.UGC`; 18 Polygon
  and 306 null geometries, no MultiPolygon. The alert adapter carries normalized
  UGC zones and polygon rings into the existing matcher. Body SHA-256:
  `e8c63a0db7c43f19b854460dc1044dc42669720487a7fac27fa7c9335ba09734`.

### Final committed gate and review

After this evidence-only document freeze, the private completion gate runs:

```bash
bash scripts/agentic-validate.sh --tests "test:datacenter test:datacenter-ownership test:weather test:quiet-hours test:ux059 test:agentic-pipeline test:install-scripts"
```

Its raw log and the fresh independent Sol conclusion are saved separately
against the exact final committed tip. Behavioral tests alone establish neither
a publication verdict nor full CI success. All commits use normal hooks, staged
secret scanning and type checking. The initially proposed label failed normal
Sonar lint; its awaited local-arrow revision preserves the existing lint rules.

A throwing subscriber can still stop later datacenter subscribers for that
emission; stored staleness and weather continuation are preserved. Manual app
verification was not performed. Optional development verification with injected
failures: inspect polygon warnings and weather uncertainty; replace the site
during each deferred stage; trigger both throwing-subscriber scenarios and
confirm weather processing continues. No persisted migration exists. Reverting
the full patch restores the prior tick-skip and ownership faults; reverting only
the second containment restores the independently confirmed subscriber blocker.
Whole-tick age badges and same-site out-of-order refreshes remain outside scope.

## Behavior

- **Zone lookup:** `resolveSiteZonesBestEffort` (`src/services/datacenter/site-zones.ts`)
  resolves the site's UGC zones.
  - A failed NWS `/points` lookup (5xx, 429, timeout, malformed) returns
    `{ zones: [], degraded: true }` and is never cached, so the next tick
    retries.
  - A 404 outside-jurisdiction `[]` is a real answer and is cached.
- **Posture:** a degraded lookup no longer skips the tick. The posture
  computes with polygon-only matching, and `'weather zones'` joins
  `staleInputs`.
  - The pinned strip shows "⚠ weather zones stale" with its degraded style.
    The readiness panel footer and the Home contextual deck also show it.
  - Polygon warnings still set the level.
- **Skipped recompute:** any other failure of the posture block calls
  `markDatacenterPostureStale('posture recompute failed')`, so the previous
  posture (possibly "All clear") is visibly stale. The next successful
  recompute clears the label.

## Original author-reported validation (not independently attested)

`bash scripts/agentic-validate.sh --tests "test:datacenter"`:

```text
test:datacenter  ℹ pass 44 / ℹ fail 0 (tsx) ; ℹ pass 2 / ℹ fail 0 (wiring gate)
lockfile:check, lint:strict, typecheck:all, cross-agent:check, roadmap:check, build — passed
Secret scan passed for 4923 file(s).
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
```

## Original author-reported mutation proof (not independently attested)

Each mutation was applied alone against `npm run test:datacenter` (baseline
46/0 before and after). The table records the SHA-256 prefix of the file
before mutating. Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Lookup failure throws (no `catch`) | `site-zones.ts` (`df967f18585d`) | 42/2 | degrade + not cached; next success cached |
| Failure cached | `site-zones.ts` | 42/2 | same two |
| No `'weather zones'` stale label | `datacenter-posture.ts` (`ef8bc5372adc`) | 43/1 | unverified zones reported stale |
| Mark-stale is a no-op | `datacenter-state.ts` (`9f46bdc36699`) | 43/1 | skipped recompute marks stale |
| Wiring drops the degraded flag | `data-loader.ts` (`a85f5c374c3d`) | 45/1 | flag reaches posture |
| Wiring skips mark-stale | `data-loader.ts` | 44/2 | wiring gates |
| Wiring uses the throwing lookup | `data-loader.ts` | 45/1 | best-effort helper only |

All 7 mutations went red, and every file was restored to its original hash.

## Not performed

- There was no live NWS outage. Failure modes are injected into the helper,
  and the data-loader wiring is proven by a source gate.
- Follow-up, not in this change: an age-based staleness badge when the whole
  weather tick never runs. The strip re-renders only on emit.

## Rollback

There are no persisted-data changes. Reverting restores the tick-skip
behavior.
