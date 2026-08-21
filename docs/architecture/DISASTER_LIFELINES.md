# Disaster Lifelines

Disaster Lifelines upgrades the existing `local-logistics` feature without
changing its stored panel ID or route. It helps a saved-place user discover
nearby shelters, hotels, hospitals, pharmacies, fuel, and water, while keeping
operational claims separate from directory listings and county-level outage
context.

## Sources and truth boundaries

- OpenStreetMap via fixed, allowlisted Overpass hosts supplies facility identity,
  location, directory hours, and public contact metadata. It never proves that a
  facility is open, stocked, powered, or reachable after a disaster.
- FEMA OpenShelters supplies official open-shelter observations. Only public
  operational fields are retained; point-of-contact names and email addresses
  are not exposed.
- FEMA Disaster Recovery Centers are a separate `recovery` category. A recovery
  center is never relabeled as a shelter, hotel, or overnight accommodation.
- The Census coordinate geocoder resolves an exact county FIPS for US saved
  places. It receives coordinates, not the user's saved-place name.
- ORNL ODIN supplies county-level customer outage context. A missing county row
  is reported as unknown coverage, never as zero customers out or power on.

Hotel listings are discovery-only. The feature does not claim live room
availability, fuel inventory, road access, or facility-level electricity.

USGS readings are labeled as recent surface-water measurements, not tap-water
advisories. EPA SDWIS records are labeled as compliance history. Neither source
can make a live `safe`, boil-water, or do-not-use assertion, so potable status
remains unknown until a jurisdiction-specific advisory source is added.

## Contract

The `/api/local-logistics` schema-v2 response separates stable `ResourceSite`
records from expiring `ResourceObservation` records. Operational, inventory,
power, and access states are independent. Provider outcomes include accepted and
dropped row counts so partial or malformed feeds cannot silently appear healthy.

The `/api/grid-outages` schema-v1 response contains expiring county
`AreaCondition` inputs. Those inputs are displayed as context and cannot mutate a
facility observation.

Both routes validate and bound coordinates, categories, FIPS, and result limits.
Desktop requests remain behind the authenticated loopback sidecar, and upstream
destinations are fixed in code.

## Offline and storm behavior

Snapshots, offline readiness, and shadow change history are keyed by a query
fingerprint so results from one radius, coordinate, or category set cannot
satisfy another. Site identity can remain in Offline Lifelines, but expired
observations render as unknown. A bounded nearest-expiry timer re-renders the
active panel, clears the matching map overlay, and refreshes dependent county
context without waiting for another network event. The current readiness badge
covers the Lifelines snapshot only; it is created only after an exact cache
write is read back and revalidated. A quota failure, invalid artifact, or later
eviction demotes readiness instead of leaving a stale ready manifest. The badge
does not claim that map tiles, contacts, or routes are cached.
Startup prewarms at most three explicitly offline-pinned places. Storm-mode
decisions also prewarm the matched place and pinned places with a 15-minute
cooldown and a maximum concurrency of two; prewarming never blocks warning
delivery. The Storm Mode action opens the exact matched saved place only after a
user click.

## Map, routes, and changes

The panel can place a validated, bounded snapshot on both map engines. A saved-
place edit clears only the matching old place and query fingerprint so a late
response cannot relabel the new location. Popup contact, copy, and external-map
actions remain inert until the user clicks them.

Storm Mode carries an exact saved-place action fingerprint. Its Lifelines
button re-resolves and revalidates the place at click time, so an older warning
cannot navigate after that place is moved, renamed, or deleted.

Evacuation routes use a fixed-host OSRM graph endpoint and are validated again
at the event and map boundaries. The UI always says current road conditions are
unverified; a graph route is not a safe-route or reachability claim. A user can
request the graph route from the exact saved place to a listed resource; late
results are discarded after a place, fingerprint, or target change. Cached
routes are bounded and revalidated when loaded.

Verified evidence transitions are retained in a bounded, exact-fingerprint
shadow log. They appear as review-only context and never enter the notification
dispatcher or promote a saved place's threat severity.

Tactical Comms keeps current-device reachability separate from place-wide
conditions: `navigator.onLine` is described only as this browser's network-
interface report, never as cellular coverage. Exact-place ODIN data is shown as
county power context, including reported zero, while facility power and actual
communications availability remain unverified.

Grid Intelligence consumes only the Lifelines panel's accepted active-place
snapshot. Background prewarms cannot replace the selected county, and a saved-
place move or radius edit clears the prior outage context before an exact-cache
seed or new report is accepted. The former unsupported national PowerOutage.us
requests and implied state/national outage geometry are disabled; ODIN reports
without geometry are never drawn as a statewide or facility-level heatmap.
EIA demand and net-generation rows remain same-period descriptive observations.
Total net interchange is not ingested, so their difference never becomes a
supply-deficit, surplus, import, export, or alert claim.
Cloudflare BGP and EPA RadNet panels also distinguish reported empty results
from missing, malformed, or all-dropped evidence; only validated reported
coverage can emit a banner or radiation hotspot.

Shared renderer events are treated as input boundaries rather than trusted type
casts. Lifelines snapshots are deeply revalidated for bounds, provenance,
timestamps, query identity, and provider semantics before runtime derivation or
offline-manifest writes. Feed Health accepts only bounded provider telemetry and
one-to-one source identities; an aggregate success cannot paint several distinct
upstreams green.

## Operations

Treat any provider error, stale observation, expired observation, or absent ODIN
coverage as unknown. ODIN participation is not nationwide, and reported zero is
retained as known zero only for a covered, current county response. Cloudflare
BGP remains unknown when its API token is absent. Overpass has two fixed hosts
and may be unavailable during regional demand spikes. FEMA and OSM records are
spatially deduplicated, with the official FEMA observation taking precedence for
shelter operations while directory provenance remains visible.

Adjacent InfraRisk evidence follows the same rule. CISA KEV can report no recent
additions only after a bounded, canonical, nonempty full catalog validates.
RIPE routing evidence is labeled as AS3356 / Lumen only and is excluded from a
broad BGP composite; current-window ACLED remains unavailable. A hung refresh or
aged display state transitions to unknown rather than preserving an old score.

Focused verification is available through `npm run test:lifelines`,
`npm run test:lifelines-map`, and `npm run test:lifelines-grid`.
