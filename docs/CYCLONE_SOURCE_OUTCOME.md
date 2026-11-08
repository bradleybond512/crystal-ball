# Cyclone source-outcome correction (A)

Standard provider/status repair; approved design: /tmp/cb-cyclone-status-architecture/DESIGN.md. Base 4432188fedbaba28938608cc07da6a25d11ca0c9. Sole writer: dependency queue.

Objective: never present transport/parser failure as current no-active-cyclones evidence. Preserve valid empty success, last-good failed-source observations, settled five-minute request cadence, in-flight coalescing and genuine aggregate freshness. Minimal panel copy must distinguish unavailable/degraded coverage.

Non-goals: coordinate/date/category/wind parsing, forecast/track/scoring, lightning, new dependencies, provider endpoints/permissions, live queries, native/release/install behavior. Existing parsing quirks remain explicitly deferred.

Tests first: synthetic transport with real freshness tracker, real bounded XML parser where relevant; no live fetch. Initial cold-dual-HTTP failure must record error with no successful timestamp; old implementation should fail that assertion. Full matrix follows approved design, including partial/warm/cache/boundary/recovery/concurrency and actual panel output. Existing test:providers imports the dedicated module explicitly, with additive source/test mapping and a detecting runner-removal proof. No test is qualified before actual intended RED and restored GREEN receipts.

Current stage: first RED preparation only. Production unchanged. Normal hooks, focused/alias execution, mutation proofs, selected-list/aggregate/build/bundle/lints and independent Sonnet review remain pending under separately admitted graphs.

## Current JTWC amendment

The approved JTWC-LIVE-CONTRACT-AMENDMENT supersedes healthy RSS/empty assumptions: regional/index or empty RSS is unavailable, never storm observations or authoritative absence. Current NHC uses different fields; legacy rows in A tests are expressly synthetic mapping-preservation cases, not upstream schema evidence. B owns current field mapping/unknown coordinate-time contract separately. No linked-bulletin parsing.

Expanded tests prepared: real full adapter module compiled in isolated VM with actual dataFreshness, existing happy-dom XML parser, synthetic transports and frozen clock. Actual panel subclass/update/render module is executed with a narrow fake base container; not full Panel/browser integration. This boundary avoids privileged/runtime bootstrap and is explicitly limited. Full matrix has not executed. The original qualified one-case RED remains historical source evidence.

## Implemented A simplification, pending GREEN

JTWC has no admitted success format, so no unused JTWC last-good state or artificial both-success branch is added. The endpoint is fetched with unchanged timeout/cadence and its body consumed, but always reports fixed unavailable coverage; invalid legacy observation parsing and its now-obsolete suppressions were removed. NHC's stored rows retain their original advisory Date objects; no unused succeededAt state is added because aggregate freshness never renews in A. Retry budget uses a separate settled-at record. Supported JTWC ingestion and healthy complete aggregate recovery require a future grounded implementation. Global tracker and forecast code unchanged.
