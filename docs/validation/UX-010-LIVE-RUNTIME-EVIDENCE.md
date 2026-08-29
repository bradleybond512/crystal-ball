<!-- markdownlint-disable MD013 -- exact URLs and runtime transcripts cannot wrap -->

# UX-010 Live and Runtime Evidence

Date: 2026-08-29

## Deterministic browser success path

The browser run used the repository-installed Playwright 1.59.1 runtime with
Chromium 147.0.7727.15, a fresh browser context, granted geolocation
permission, and the explicitly synthetic public test coordinate
`41.8781, -87.6298`. No additional real user location was requested or used.

The application ran from the normal Vite browser build. A Playwright route
adapter forwarded only the same-origin `/api/local-logistics` request to the
real local sidecar endpoint with a disposable test authorization token, then
fulfilled the browser request with the sidecar's status, headers, and body.
This adapter was necessary because the browser build normally expects its
deployment gateway at the same origin; it did not mock the handler or response.
The sidecar made its normal live provider requests. The exact adapter script
used for the run was `/tmp/ux010-browser-evidence.cjs`; it is deliberately not
a production or repository file.

Before the explicit click, the network capture contained zero
`/api/local-logistics` requests and the visible disclosure was:

```text
Use current location for this session

Crystal Ball requests one location fix only after you choose this action and keeps it only in this Lifelines panel for session-only use.

The fix is sent to the Crystal Ball Lifelines endpoint and the necessary Overpass, FEMA, Census, and ODIN paths. Crystal Ball does not persist it, but third-party provider access-log retention cannot be guaranteed. Your OS or browser may remember the permission grant.

Use current location
```

Exact captured success and teardown result:

```json
{
  "runtime": {
    "browser": "147.0.7727.15",
    "syntheticLocation": {
      "latitude": 41.8781,
      "longitude": -87.6298,
      "accuracyMeters": 0
    }
  },
  "preClick": {
    "requests": 0
  },
  "success": {
    "requestCount": 1,
    "requests": [
      {
        "method": "POST",
        "url": "http://127.0.0.1:4173/api/local-logistics",
        "body": {
          "schemaVersion": 1,
          "purpose": "session-lifelines",
          "latitude": 41.8781,
          "longitude": -87.6298,
          "radiusKm": 10,
          "categories": [
            "shelter",
            "hotel",
            "hospital",
            "pharmacy",
            "fuel",
            "water",
            "recovery"
          ],
          "limitPerCategory": 3
        },
        "requestHeaders": {
          "contentType": "application/json",
          "referer": null
        },
        "response": {
          "status": 200,
          "cacheControl": "private, no-store",
          "contentType": "application/json",
          "bodyKeys": [
            "schemaVersion",
            "query",
            "sites",
            "observations",
            "providers",
            "fetchedAt",
            "retrievedAt",
            "partial",
            "nodes",
            "areaConditions"
          ]
        }
      }
    ],
    "readyHeader": "ACCURACY 0 M • OBSERVED AUG 29, 5:20 PM • SESSION ONLY",
    "panelReachedReadyState": true,
    "panelTextContainsRawCoordinates": false
  },
  "teardown": {
    "clearDisclosureVisible": true,
    "reloadDisclosureVisible": true,
    "bodyContainsRawCoordinatesAfterClear": false,
    "storageContainsRawCoordinatesAfterClear": false,
    "consoleContainsRawCoordinates": false
  }
}
```

The request URL contains no coordinates, the request carried no referrer, the
real handler returned `200` with `cache-control: private, no-store`, and the
renderer reached its ready state. Clear returned to consent immediately. A
reload still showed consent rather than the prior session anchor, and the raw
synthetic coordinate appeared in neither post-clear DOM text, browser storage,
nor captured console messages.

## Live ORNL ODIN filter probe

No secret or credential is used by this public endpoint. The probe inspected
the response body rather than relying on HTTP status. It selected one valid
five-digit `communitydescriptor` from an unfiltered page, then passed the exact
production filter expression through `encodeURIComponent`.

Exact request/output transcript:

```json
{
  "probedAt": "2026-08-29T22:25:12.746Z",
  "unfiltered": {
    "url": "https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records?limit=100",
    "rowCount": 100,
    "totalCount": 299,
    "selectedFips": "47009"
  },
  "filtered": {
    "url": "https://openenergyhub.ornl.gov/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records?limit=100&where=communitydescriptor%3D%2247009%22",
    "rowCount": 1,
    "totalCount": 1,
    "allRowsMatch": true,
    "sample": {
      "communitydescriptor": "47009",
      "metersaffected": 24,
      "county": "Blount",
      "state": "Tennessee",
      "customersrestored": null,
      "name": "CITY OF ALCOA UTILITIES,577",
      "utility_id": "577"
    }
  }
}
```

The one returned row matched the selected FIPS and supplied every field read
by the adapter. The `customersrestored: null` sample also exercises the
adapter's existing optional-value normalization rather than assuming that all
documented numeric fields are populated.

## Packaged macOS run

The signed full macOS application was built and installed with
`node scripts/install-built-app.mjs --relaunch`. After explicit human approval,
Crystal Ball was quit and the bundle-wide permission reset
`/usr/bin/tccutil reset All com.bradleybond.crystalball` reported success.
Relaunch did not prompt or acquire location at startup. The explicit action
produced `ACCURACY 40 M`, a visible observation time, and `SESSION ONLY`.
Clear restored the saved Home anchor, and quit/relaunch did not restore the
current-location anchor. Filtered application and sidecar logs contained no
current-location coordinates or coordinate-bearing local-logistics entries.

This host still did not show a fresh Location prompt after the successful
bundle reset, so the evidence does not claim a newly reset Location permission
row. It does prove the product behavior observable on this host: no startup
acquisition, explicit-action acquisition, session-only ownership, clear, and
relaunch teardown.
