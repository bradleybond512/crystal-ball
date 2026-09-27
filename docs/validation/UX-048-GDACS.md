# UX-048 — GDACS restoration evidence

## Behavior and scope

PR #1740 restores validated observations from EQ, FL, TC, WF and DR homepage MAP feeds. Stable IDs, event chronology, Orange/Red selection, the 100-event cap, cache provenance and warning retention are preserved. Volcano MAP is unavailable; diagnostics report degraded coverage explicitly. This does not restore volcano ingestion, recurring warning scheduling or the independent RSS path.

Production changes are confined to `gdacs.ts`, `gdacs-coverage.ts` and `api-diagnostic.ts`. A strict MAP projection validates source/type/class/geometry and canonical centroids before the existing event parser. A provider-local shared operation limits concurrent consumers to five upstream requests; failures abort and drain sibling work before releasing a retry. Results clone mutable event data and provenance for each caller. No dependencies or privileges changed.

## Actual validation

`bash scripts/agentic-validate.sh --tests 'test:gdacs-map test:adapter-provenance test:ux059 test:ux026'` exited 0 after the concurrency repair. Actual suite output:

```text
# pass 41
# fail 0
# pass 13
# fail 0
# pass 32
# fail 0
# pass 115
# fail 0
Agentic validation gate passed.
```

Total: 201 pass / 0 fail. Gate included lockfile, strict lint, all TypeScript configurations, secret scan, documentation, roadmap and production build. `node scripts/check-bundle-size.mjs` exited 0:

```text
main-CPGLLJzb.js  raw=1.52 MB  gzip=442.4 KB
✓ All bundle-size policies satisfied.
```

Initial diagnostic regressions: 1 pass / 3 fail → 4 pass / 0 fail. Initial provider tests: 1 pass / 13 fail → 14 pass / 0 fail; initial missing APIs are not counted as mutation proofs. Independent review reproduced two simultaneous cold calls launching ten requests. Added concurrency regressions: 19 pass / 3 fail → 22 pass / 0 fail. The final focused suite includes 41 tests across provider, diagnostics, freshness and hydration.

One intermediate compatibility run had 114 pass / 1 fail: its fixed eight-microtask wait ended before cancellation/finally completed. Replacing that wait with an event-loop turn preserved every assertion; the suite then passed 115 / 0. Initial ES2020 `Object.hasOwn` and complexity lint errors were corrected without changing compiler settings or suppressing rules.

## Applied mutation proof

[Portable proof records](UX-048-MUTATIONS.json) contain all 38 applied diffs, actual assertion excerpts, baseline/red/restored counts, original/restored SHA256 values and clean status. Proof candidate: `cddb5e7ab0c5ea33dea2f640f2e9a3555b3b88bf`.

```text
38 applied mutations killed; all restored trees clean
```

Across repeated focused executions: 49 pass / 0 fail → 0 pass / 49 fail → 49 pass / 0 fail. Each case independently began clean and restored identical source checksums. Changed behavior covers the hazard list/query/deadline, envelope/type/class/geometry, missing/conflicting centroids, chronology, atomic failure, shared operation/cancellation/draining, independent caller objects and diagnostic coverage. The first run counted only 29/31: two parser exceptions lacked explicit assertion classification. The fixture validity assertion was clarified, then all 31 reran successfully on the final proof candidate. No production change was needed for that clarification. Independent review requested proofs for six additional regression tests. Five supplemental mutants were killed; one enum mutation was masked by duplicate-conflict rejection and is explicitly excluded. Separate coordinate-range and distinct-event enum mutations were then killed, producing 38 valid proofs total. No assertions or production guards were weakened.

## Live body evidence

Official contract: [GDACS Swagger](https://www.gdacs.org/gdacsapi/swagger/index.html). Request for each row below: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TYPE`.

| TYPE | Raw features | Valid centroids | Qualifying warnings, final live fetch |
| --- | ---: | ---: | ---: |
| EQ | 8 | 4 | 0 |
| FL | 21 | 7 | 0 |
| TC | 374 | 7 | 2 |
| WF | 36 | 18 | 0 |
| DR | 26 | 13 | 5 |

Consumed fields: FeatureCollection/features, feature type, geometry type/coordinates, properties Class/eventtype/eventid/name/country/fromdate/alertlevel, optional description, severitydata.severitytext and url.report. The initial saved capture had one qualifying cyclone (six warnings total); the later real tracked fetch had two (seven total). Both passed the actual adapter. Five response bodies total about 4.99 MB uncompressed. The final tracked fetch completed in 5811 ms; its second call returned cached seven events with the same timestamp and no successful-update evidence. These observations describe captured samples, not guaranteed future latency or event counts.

MAP without eventtype returns 400; ALL returns 400; VO returns 404. `events4app` omitted qualifying droughts behind 100 Green entries, while SEARCH included historical events. Neither was used. Current MAP droughts with old dates and `iscurrent:false` remain eligible; no undocumented chronology exclusion was introduced.

## Review and delivery

First independent review found cold concurrency, missing UX-048 tracking and unfinished proof evidence. Concurrency was repaired; UX-048 is now linked, with the late claim documented honestly; proof is complete. Final independent review of code/test tip `cddb5e7ab` concluded with no blocking findings after auditing all 38 valid proofs. The actual opposite-agent SHA-pinned review and required GitHub CI remain delivery gates. The draft stays held until they pass.

## Limits, manual verification and rollback

Accepted limits: five-feed aggregate availability, about 5 MB per refresh, unavailable volcano coverage, and existing startup/manual warning-ingestion cadence. Native installed-app acceptance was not run. Manually verify the diagnostic coverage warning and cached/live qualification after restart/network interruption. Rollback through a reviewed PR; retain alert history and caches. No schema migration, app installation or destructive recovery action was performed.

Full raw logs and response bodies are retained locally in `~/.crystalball-diagnostics/gdacs-repair-20260926/`.
