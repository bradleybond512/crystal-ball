# UX-059 — Evidence-based warning retention

Risk: High Assurance. Owner: Codex. Approved by Bradley on September 25, 2026 with the linked ACC-509 design. Depends on ACC-509 #1738; both drafts remain held until the combined candidate passes, then land ACC-509 first and rebase this change onto its exact main result.

## Goals and boundaries

Keep validated unexpired NWS Actual Alert/Update rows visible beyond 48 hours of onset. Qualifying GDACS row observations support a 48-hour retention window without claiming authoritative active state. Preserve event chronology, acknowledgement, pin, snooze, archive and the unchanged 500-row capacity comparator. Replay, outage, partial snapshots and omission never establish new observation or cancellation. LSR remains historical.

No endpoint repair, new providers, NWS web-envelope/scheduling change (UX-047), notification-policy changes, confidence tuning, native work or new storage migration. ACC-509 provides the v2 envelope and stable identity.

## Interfaces and failure behavior

Optional top-level retention evidence is either `nws-expiry` with observedAt, issuedAt and expiresAt, or `gdacs-observation` with observedAt. Validate source/kind agreement and representable timestamps; reject future observations. Missing/invalid metadata retains legacy source-age behavior. Never infer evidence from persisted raw payloads.

Normalizers accept explicit verified-response, replay or unknown context. Preserve original row-level retrieval time on memory/offline cache and storm-context fallback; never substitute outer cachedAt or current time. NWS already supplies retrievedAt. The verified GDACS loader stamps only getGDACSSuccessfulUpdate's underlying updatedAt on rows, keeping all four shared-cache consumers array-compatible. The GDACS parser must not accept provider-supplied retrievedAt.

One predicate governs prune, persistence and hydration: pinned, or existing source age within 48 hours, or valid unexpired NWS evidence, or qualifying GDACS observation within 48 hours. Expiry ends an exemption; it does not remove otherwise recent history. Merge evidence monotonically; older replay must not overwrite newer issuance/observation. Unknown unchanged replay preserves known evidence. Observation-only changes never create material revisions, evidence votes or repeat notifications.

## Ownership and verification

Provider specialist: GDACS row type, normalizers and specific data-loader provenance call sites plus behavioral tests. Store specialist: shared retention validator/merge/predicate and unified store integration plus tests. Parent: test routing, roadmap evidence and ACC-509 integration. Independent reviewer must not implement.

Test multi-day NWS, genuine GDACS updates, memory/offline replay, storm fallback, malformed/future evidence, delayed revisions, restart, legacy rows, expiry, capacity, failure and no notification/evidence inflation. Mutate freshness substitution, expiry predicate and hydration to prove tests fail. Run targeted suites, full typechecks, named agentic gate, bundle budget, independent and actual Claude review, required CI and pr-closeout.

## Live evidence and open limitation

Captured NWS active-alert response: HTTP 200 GeoJSON FeatureCollection, 230 rows, including sent/onset/expires/status/messageType fields. Current GDACS MAP URL returns HTTP 400 with body `{"message":"Eventtype is required."}`. This is real failure-path evidence, not a successful feed. Successful GDACS observation behavior remains fixture-validated until a separate bounded endpoint repair establishes live success. Do not claim GDACS is operational or mark that limitation resolved here.

## Rollback

Revert this isolated PR while retaining ACC-509 identity repair. Old code ignores optional retention metadata and returns to 48-hour source-age pruning. This can hide multi-day warnings again; no cancellation or deletion of provider records is implied. No installed-app changes are part of this task.
