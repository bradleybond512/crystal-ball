# UX-049 verification

## Scope and rollback

The Threat Dashboard starts with eleven unknown domains. Sources supply their last observation, acquisition or position-report receipt time. The dashboard accounts for partial coverage separately from its existing severity thresholds. Its 30-second repaint can expire a signal without refreshing its timestamp. Full reassurance requires complete, current evidence for all eleven domains and uses the oldest required evidence. The four integrated sources cannot produce a live system-wide all-clear.

The in-memory state belongs to this session. Rolling back the implementation restores the previous panel and removes the receipt handoffs. No data migration is required. The design and claim were published in draft PR #1845. The approved implementation runs locally pending review.

## Live acquisition evidence

The observation window was November 3 UTC (November 2 local). The data below establishes the production wire shapes. Browser and native positive/negative scenarios use controlled fixtures.

| Source | Request, count and consumed fields |
| --- | --- |
| USGS | The desktop all_hour feed returned 7 features, the all_day fallback returned 269, and the web M2.5+ daily feed returned 45. All had GeoJSON feature ID, magnitude, event time, place and coordinates, plus metadata.generated. The dashboard uses the existing route generation, source, HTTP Date and Age to admit receipts. [Desktop](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson), [fallback](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson), [web](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson). |
| Kp | NOAA returned 57 rows with time_tag and Kp. GFZ returned 15 samples with datetime and Kp. At 03:26 UTC both newest bins were 00:00 UTC, beyond the existing three-hour limit. The dedicated Kp acquisition endpoints are implemented by the desktop sidecar on this base. Web deployments without those routes expose the gap. [NOAA](https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json), [GFZ query](https://kp.gfz.de/app/json/?start=2026-11-01T03%3A26%3A44Z&end=2026-11-03T03%3A26%3A44Z&index=Kp). |
| Aviation weather | The two configured upstream URLs returned HTTP 404 JSON error bodies, zero advisories. Positive SIGMET behavior was exercised with fixtures. [SIGMET endpoint](https://aviationweather.gov/cgi-bin/json/SigmetJSON.php), [AIRMET endpoint](https://aviationweather.gov/cgi-bin/json/AirmetJSON.php). |
| FAA | Airport conditions returned HTML 404. Airport events returned 7 airport rows. At 03:29:58 UTC, one FLL stop was active until 03:30 UTC. The previous parser accepted zero of the seven. The new parser consumes airportId and the nested groundStop airportId, startTime, endTime, programExpirationTime and impactingCondition. [Conditions](https://nasstatus.faa.gov/api/airport-conditions), [events](https://nasstatus.faa.gov/api/airport-events). |
| Maritime | An isolated desktop sidecar’s GET /api/maritime/vessels returned vessels, summary, sanctionedCount, asOf and sampleSize with zero vessels and sample size zero. It produced no receipt. Positive checks use fixture MMSI, latitude/longitude, zoneId and position-message receipt time. Positive AIS traffic was not observed live. The Maritime Intel panel loads on demand, so fresh AIS evidence depends on that panel running. |

## Manual verification

Open the Threat Dashboard before a source has reported. All eleven rows should be accessible and its reporting count should be zero. Compare Kp observation age with a USGS fetch age. Interrupt one acquisition and confirm the failed source label and the surviving positive. Let its source validity expire without network and check that the current signal count drops. Restart the panel and confirm only one repaint loop remains.

## Implementation and scope of verification

The synthesis evidence store associates each source with its own scope, clock and validity. The data loader passes USGS acquisitions and Kp votes from the existing readers. Aviation Intel and Maritime Intel pass the results of their existing refreshes. ThreatDashboard owns a single presentation timer, releases it on teardown and distinguishes current signals from last-known hazards. Unconnected, stale and failed sources stay visible. The existing thresholds still determine severity.

The FAA handler now recognizes nested airport ground stops and validates their timing. An invalid primary response falls through to the next existing endpoint. Valid signals in a damaged response can be displayed with reduced coverage, and failures do not enter the FAA success cache. The SWPC sidecar freezes the Kp subfeed acquisition time across cache hits. The store uses that time, the GFZ fetch time and the AIS snapshot time only to order real content revisions. Observation and position-report age remain anchored to the bin or position receipt. An unchanged replay cannot clear an outage or extend expiry.

The first independent review reproduced a Kp 0-to-7 correction disappearing within the same bin and an AIS decrease from six vessels to five disappearing when the newest remaining position retained its timestamp. The repaired store accepts ordered changes, preserves observation ages and rejects conflicting changes without an ordering clock. When the newest vessel leaves, the dashboard can correctly show five vessels with an older last position report. Independent re-review found both defects resolved.

Before the repair, four of the correction checks failed in Chromium. After repair, the same checks passed in Chromium and macOS Tauri/WebKit. [Renderer checks and hashes](UX-049-RENDERERS.json). The native test used a diagnostic Tauri host with the app CSP and an incognito WebKit data store. It exercised the real dashboard, scoped USGS/Kp loader, FAA/SIGMET and maritime panel refreshes. Full installed-app startup and live AIS-positive service were outside that run. A CSP message for the test receipt channel used Tauri’s native postMessage fallback. The fixture made zero external provider requests. An additional Chromium run through the real Kp data loader covered nine stages, including 0→7→0 within one bin, unordered conflict, outage and recovery. Each stage made one request for each of the two Kp sources.

## Reproduction and local checks

The original panel displayed “All sensors quiet · checked just now” at startup, at the second tick and after eleven explicit adapter failures. In Chromium and Tauri, the baseline renderer each failed four of five targeted startup and empty-tick checks. On the repaired renderer both browsers passed all 42 checks. The extended correction suite returned 38 pass / 4 fail on the pre-review build in both renderers, then 42 pass / 0 fail in each on `c935054d3`.

The targeted command was `npm run test:ux049`. Its two runner summaries on the repaired code were:

```text
# pass 138
# fail 0
# pass 23
# fail 0
```

`npm run test:providers` printed `# pass 159` and `# fail 0`. `npm run test:sidecar` printed `# pass 665` and `# fail 0`. The existing maritime suite returned 131/0 and 29/0, and the aviation normalization suite returned 20/0. The scoped sidecar review saw 12/0 for space-weather HTTP behavior. The subsequent integrated gate included the sidecar and the renderer repair.

The integrated command was `bash scripts/agentic-validate.sh --tests 'test:ux049 test:providers test:sidecar'`. It ran both TypeScript configs, lint, the lockfile check, secret scanning, docs checks and the production build. Its final output included

```text
Agentic validation gate passed.
Tests run: test:ux049 test:providers test:sidecar
```

Vite emitted dynamic-import chunking advisories. Rollback of local code commit `c935054d3` removes the behavior change as one unit. The dashboard would again conflate missing data with quiet observations, as reproduced above.

## Mutation testing

All 84 behavior-changing mutations produced the expected failures. The 27 source and test file hashes matched reachable implementation and fixture commit `3c68b4fa9`. The mutation runner reverted individual guards, verified the applied diffs and expected assertion failures, then restored the original file and checked its SHA-256 and clean Git status. The portable record includes the original/repaired suite counts, mutated paths, applied changes, failed assertions and restored checksums. [Mutation record](UX-049-MUTATIONS.json).

Two initial reversals needed investigation. Removing an early stale aviation-envelope check left a later per-row expiry guard enforcing the same limit. Extending the actual five-minute horizon to ten minutes turned that suite from 8 pass / 0 fail to 6 pass / 2 fail. The first zero-size AIS sample test also had an invalid snapshot timestamp, which masked removal of its sample-size guard. With a valid timestamp and one otherwise valid vessel, removing the guard turned 8 pass / 0 fail into 7 pass / 1 fail. The final fixture suite passed after restoration.
