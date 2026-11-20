# UX-015 — UKPN reported incidents, separate from US county evidence

High Assurance design approved by Bradley on November 19, including the
documentation draft claim and local implementation. [Draft #1919](https://github.com/bradleybond512/crystal-ball/pull/1919)
was published before local implementation began. Keep
merging, auto-merge, releases, deployment and installation paused.

## User-visible outcome and truth boundary

Add a separate section to the existing Grid → Outages tab:
**UK Power Networks regional reports — not selected-place coverage**.
Show only reported unplanned incidents for the publisher's Eastern, London and
South Eastern networks. UKPN describes partial coverage, omitted small faults
and aggregated locations. Neither missing reports nor an empty list establishes
power availability, safe access, no outage, or nationwide coverage.

Keep ODIN's exact US saved-county section unchanged. UKPN remains independently
visible when US data is unavailable. No customer summation, maps, headline alert
counts, notifications, fusion votes or facility-power inference. Display bounded
incident IDs, optional operating zones and reported customer counts only. Zero
is an explicit reported count, not missing data or evidence of healthy power.
Omit provider prose, postcodes, coordinates and restoration estimates.

## Retained primary-source evidence

- [Dataset and API metadata](https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults):
  CC BY 4.0, UK Power Networks publisher, ADMS/PowerOn origin, continuous updates.
- [Publisher terms](https://ukpowernetworks.opendatasoft.com/terms/terms-and-conditions.pdf):
  attribute UK Power Networks / Live Faults, dataset link and publication date;
  link the licence, disclose filtering and do not use the logo.
- [Actual records request](https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/records?limit=100):
  November 19 local time (`2026-11-20T04:28:21Z`), HTTP 200, 162,716 bytes,
  `total_count: 100`, 100 returned; 22 Unplanned, 61 Restored, 17 Multiple.
  Metadata was 11,330 bytes; terms PDF 13,134 bytes. Raw bodies and SHA-256/HTTP
  receipts are retained in task artifacts `next-nov18b/ux015-discovery/`.
- `Multiple` is an aggregate container referencing child incidents; a sampled
  container had a sentinel year-0001 date and zero customers. Exclude it.
- The five incident date fields are offset-free text; metadata timezone is null.
  Do not parse or infer those dates. Use only explicit-offset dataset publication
  `metas.default.data_processed`, labelled as publication, not incident onset or
  recent operator confirmation. Metadata count is `metas.default.records_count`.
- Candidate field checks admit all 22 Unplanned rows (14 positive counts and
  eight zeros), exclude 78 by status, and find no invalid remaining IDs/counts
  or contradictory restoration timestamps. Missing coordinates are intentionally
  allowed because this list does not consume them. These checks are not a full
  live metadata/records coherence proof or a representative performance baseline.

## Acquisition, completeness and freshness policy

One fixed `/api/ukpn-outages` route, GET/OPTIONS only, no query parameters or
caller URL. Fixed HTTPS UKPN metadata/records endpoints; reject redirects.
Fetch metadata → `records?limit=100` → metadata under one eight-second deadline,
including response bodies. Cap each metadata body at 64 KiB and records at
512 KiB. Require valid JSON/envelopes, matching publication timestamp and count
on both metadata reads, and `total_count === results.length === records_count`
with a nonnegative integer count at most 100. Reject missing totals, duplicate
IDs, changing versions, malformed envelopes or oversized bodies. This checks
the fetched API dataset, not actual outage completeness.

No pagination in this stage. More than 100 records yields explicit unavailable
or incomplete status; never silently truncate a current list. One cache entry,
successful validated snapshots only, TTL 60 seconds. One shared in-flight
acquisition per fixed key: cancelled callers detach; only the last departing
caller cancels shared work. Clear pending state on completion/failure.

Publication age of 15 minutes or more, or a future publication time, is unusable
as current data.
Receipt, cache hits and shared reuse never renew publication age or expiry.
These limits are conservative product/resource policies, not a UKPN SLA or
tolerances inferred from one sample; unchanged datasets can become stale.
Poll every five minutes with separate expiry-at-boundary handling, request
cancellation, generation guards and complete teardown. Failures never renew
old records or present them as current.

## Normalized contract and replacement

Separate versioned UKPN envelope with fixed provider/regional scope, publication,
retrieval and expiry times; reported/empty/stale/unavailable state; API consistency
indicator; permanently partial real-world coverage; accepted, excluded and invalid
counts. Counters must reconcile to raw rows. Admit exact `Unplanned` only;
exclude Restored, Planned, Multiple and unknown types with explicit reasons.
Require a bounded nonempty incident ID (maximum 80 characters), optional escaped
zone (maximum 80), nonnegative safe-integer customer count, and no contradictory
restoration timestamp. Do not copy unconsumed external fields into the envelope.

A coherent accepted snapshot replaces the previous list atomically. Disappearance
means only absent from this accepted list, never restored. Empty accepted output:
**No usable unplanned incident reports; coverage remains partial.** Record feed
success only for fresh, nonempty adapter output, never from HTTP success or raw
row count. This stage contributes no fusion/corroboration votes.

## Files, owners and dependencies

1. Parent: publish the approved one-task documentation claim before implementation;
   own roadmap, evidence and exact test/inventory wiring.
2. Provider specialist: new dependency-free `src-tauri/sidecar/ukpn-live-faults.mjs`
   acquisition/normalization factory with injected transport/clock; new edge
   wrapper `api/ukpn-outages.js`, following the shared NWS provider convention.
3. Tauri specialist: authenticated fixed route in
   `src-tauri/sidecar/local-api-server.mjs`, quota-aware transport and accepted-output
   health; bundle the module in `src-tauri/tauri.conf.json`.
4. UI specialist, after normalized contract: new strict renderer validator
   `src/services/infrastructure/ukpn-outages.ts`; independent lifecycle in
   `grid-intelligence-loader.ts`; regional section in `GridIntelligencePanel.ts`.
5. Test engineer: focused provider/edge/sidecar, envelope and Grid lifecycle/UI
   fixtures. Keep existing ODIN tests intact; run them as regressions.

Use existing same-origin/local API boundaries. No direct renderer-to-UKPN fetch,
CSP expansion, dependency, credential, account, native capability or stored-data
migration. Avoid touching another draft's existing tests where new isolated
fixtures suffice. All specialists must preserve concurrent work.

## Validation and rollback

Prove coherent/changing snapshots, exact/over-limit/zero totals, partial responses,
status exclusions, zero/invalid counts, ignored coordinates, stale/future
publication, timeouts/body caps, redirects, caller cancellation and shared-work
cleanup. Prove expiry, teardown, superseded responses, empty replacement, regional
separation and edge/desktop parity. Apply inspected mutations to status filters,
version/count checks, expiry, accepted-output health and lifecycle/UI guards;
record red counts, restored hashes and clean scratch state.

Run focused suites and existing Grid/ODIN/security regressions, type checks,
secret scan, sidecar bundle checks and the named agentic validation gate. Probe
the completed adapter's consumed shape/output against live public bodies before
claiming contributions. Independent Sol and actual Sonnet reviews precede code
publication approval. Installed-app and sustained live-feed acceptance remain
open; no installation or app launch during this stage.

Rollback removes the isolated provider, route and UKPN section. It changes no
persisted schema and does not affect ODIN. Approval must explicitly cover the
100-record cap, conservative freshness policy and separate regional presentation.
