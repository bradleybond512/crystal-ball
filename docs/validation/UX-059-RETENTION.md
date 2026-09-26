# UX-059 warning-retention evidence

PR #1739 depends on ACC-509 #1738. High Assurance design approved September 25, 2026. Combined validation precedes either merge; land ACC-509 first, rebase this isolated retention change on its exact main result, then revalidate and review. Final opposite-agent verdict and required CI govern delivery.

## Behavior and architecture

Validated NWS Actual Alert/Update rows can remain visible beyond 48 hours of onset until expiry. GDACS rows may use their original successful observation time for a 48-hour retention window; this is not a claim of authoritative active state. Original event chronology, notification consideration, acknowledgement, pin, snooze, archive and the 500-record capacity policy remain intact.

The shared alert-retention helper validates evidence and supplies one rule for pruning, persistence and hydration. NWS/GDACS normalizers accept explicit observation provenance. The loader preserves row retrieval time across memory cache, offline cache and storm-context replay; outer cache time never creates freshness. All four GDACS array consumers retain their existing shape. NWS issuance and expiry are material identity fields; observation time is excluded. Known evidence survives unchanged unproven replay, while a changed report cannot borrow unsupported retention.

Older NWS issuance cannot downgrade the current row. For conflicting expiry at identical issuance, retain the previously accepted expiry; such replay cannot extend it. Newer issuance can shorten expiry. GDACS observation time is monotonic. Absence, partial results and failures never establish cancellation. LSR and other sources keep their existing source-age rules.

## Executed validation

Production candidate: `acd3bd5f9519ac612611eaf41d9e8c9a0b74f170`.

```text
Agentic validation gate passed.
Tests run: test:ux059 test:acc509 test:alert-capacity test:weather test:correlation
```

Actual counts respectively: `32 pass / 0 fail`, `103 pass / 0 fail`, `11 pass / 0 fail`, `411 pass / 0 fail`, `438 pass / 0 fail`. The gate also ran lockfile checks, structural lint, `typecheck:all`, secrets, cross-agent prerequisites, docs, roadmap and production build. Secret scan: `Secret scan passed for 4867 file(s).`

`npm run bundle:check`: main `442.4 KB`, eager `2.79 MB / 2.85 MB`, total `5.11 MB / 6.00 MB`; `All bundle-size policies satisfied.` Budgets were unchanged. Existing store compatibility suites passed `49 pass / 0 fail`, including the 5,000-alert case at 292.9 ms against 500 ms. Provider/date-hydration compatibility passed `36 pass / 0 fail`. Changed production files passed ESLint; normal commit hooks passed.

Initial behavior tests failed before implementation: store `6 pass / 8 fail`, provider `4 pass / 7 fail`, material lifecycle identity `2 pass / 1 fail`. [Applied mutation evidence](UX-059-MUTATIONS.json) records 30 assertion-killed mutations, exact commands, applied diffs, actual red counts, restored checksums and clean worktrees. No timeout, surviving mutant or compilation-only failure is counted as proof.

Final independent/opposite-agent review is required separately from these tests; this document is not a verdict. No installed-app or native manual verification was performed.

## Live response bodies and limitation

NWS request: `https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&urgency=Immediate,Expected&severity=Extreme,Severe,Moderate`. Captured HTTP 200 GeoJSON FeatureCollection: 230 rows, 122 Actual/Update and 108 Actual/Alert. Consumed sent, onset, expires, status and messageType; existing id, event, headline, severity, areaDesc and geometry behavior remains. Retrieval time is application-owned. All rows had valid issuance/expiry ordering, but none was an unexpired warning with onset older than 48 hours; multi-day retention is therefore fixture-proven, not claimed live coverage.

GDACS request: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP`. Actual HTTP 400 body: `{"message":"Eventtype is required."}`. Zero successful data rows and no features array. The real failure response was replayed through tracked fetch and correctly produced no successful observation; the same malformed body is rejected even if supplied with HTTP 200. Successful GDACS retention remains fixture-validated. Endpoint repair is an unresolved separate operational issue; this PR does not make the feed healthy.

## Manual verification and rollback

In a seeded test profile, retain a four-day-old NWS warning with future expiry through restart and cache replay; verify its original date, user state and no repeat interruption. At expiry, verify the exemption ends while recent historical or pinned records keep existing behavior. Repeated GDACS fixture observations may advance only the preserved successful retrieval timestamp; cached replay or outage must not extend it.

Rollback reverts this PR while retaining ACC-509 identity protection. Older code ignores optional metadata and returns to source-age pruning, which can hide multi-day warnings again. No provider records are cancelled or deleted. Retention does not bypass capacity, prove area-wide safety, guarantee exactly-once notifications or repair UX-047 scheduling/web-envelope behavior.
