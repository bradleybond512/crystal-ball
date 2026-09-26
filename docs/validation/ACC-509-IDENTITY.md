# ACC-509 identity and replay evidence

Implementation: PR #1738, replacing held PR #1732. High Assurance design approved September 25, 2026. The linked UX-059 PR #1739 remains a separate integration hold; do not claim H17 resolved by identity work alone. Final opposite-agent verdict and required CI govern merge.

## Behavior and architecture

Full namespaced report identities and bounded revision history survive live-store eviction and restart. Store, situation engine and compound episodes own independent registries, capped at seven days, 4,096 entries and 2 MiB of complete serialized identity metadata. Full canonical equality is retained; oversized inputs are rejected rather than truncated. Source warnings remain eligible during registry/storage failure; untracked derived amplification is suppressed and diagnostics expose degraded protection.

The unified store persists considered-notification state before dispatch, retaining acknowledgement, pin and snooze. Source chronology remains distinct from processing time. Correlation feedback is excluded at both ingestion paths. LSR alert IDs ignore array position while existing outcome IDs remain unchanged. Explicit geography preserves zero coordinates, rejects unsupported proximity, and recomputes current source geography after revisions. Display centroids may center the map but cannot create geographic risk circles.

Changed architecture: shared alert-identity helper; unified store v2 envelope; engine/correlator/feed and compound episode persistence; LSR adaptation; geographic guards in situation panel, forecast, synthesis, watchlist, personalization and escalation consumers. No new dependencies, installed-app changes, prediction coefficient changes or warning-retention exemption.

## Executed validation

At production commit `860174435596d3ea0db9b1181d8b5dcc101c5714`:

```text
Agentic validation gate passed.
Tests run: test:acc509 test:alert-capacity test:weather test:correlation
```

Actual suite counts were respectively `103 pass / 0 fail`, `11 pass / 0 fail`, `411 pass / 0 fail`, and `438 pass / 0 fail`. The gate also ran lockfile checks, structural lint, `typecheck:all`, secret scanning, cross-agent prerequisites, docs, roadmap and production build. Secret scan output: `Secret scan passed for 4862 file(s).`

`npm run bundle:check`: main `442.1 KB`, eager `2.79 MB / 2.85 MB`, total `5.11 MB / 6.00 MB`; `All bundle-size policies satisfied.` No budget changed. `npm run bench:correlation`: `PASS — within tolerance of committed baseline (src/services/correlation/__bench__/bench-correlation-baseline.json).`

The unchanged isolated 5,000-alert test passed in 298.9 ms against 500 ms; its 10-test batching suite passed. Concurrent heavy suites initially caused two timing failures, retained in the local logs; isolated execution passed without relaxing assertions. The existing warning-delivery regression passed. Final panel assertion formatting at `de951b56cec0eeed78b7198bba8f7c75436d3c42` passed all six panel tests and normal typecheck hooks.

Frozen replay input SHA256: `50b94d107808f08b6d045e75993e6c496e03d3e951f2a075896e0311c07bd4ea`. Original main `a51aeda92` had `0 pass / 8 fail`; candidate replay had `18 pass / 0 fail`. Duplicate situations changed 3 to 0, false merges 2 to 0, repeated notification considerations 1 to 0, with no confidence/source-vote inflation in the fixture. These results apply within admitted retention bounds.

## Mutation and review evidence

[Machine-readable mutation evidence](ACC-509-MUTATIONS.json) records all 70 visibly applied mutations, real assertion failures, commands, before/after counts, original/restored checksums and clean-tree verification. All 70 logical mutations were detected. Most cases were `1 pass / 0 fail` to `0 pass / 1 fail` and back. The original DOM failure-formatting timeout is explicitly superseded by equivalent exact-null boolean assertions; both panel mutations were rerun on the final test revision. All remaining source/test paths are byte-identical across proof revisions.

Independent review found malformed input/hydration, stale revised geography, missing LSR provenance and centroid risk extent. Each received focused regressions and repairs. A surviving malformed timestamp conversion was repaired in the second cycle: `14 pass / 1 fail` to `15 pass / 0 fail`; its guard also has applied mutation proof. Final actual Claude review is required before closeout; this evidence document is not a review verdict.

## Live source body

Request: `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=24`. Captured GeoJSON FeatureCollection: 327 rows. Consumed Point coordinates and properties type, valid, magnitude, city, county, state, remark. Actual parser/adapter produced 33 eligible reports and 33 unique identities; reversing rows preserved them. Maximum resulting ID was 334 bytes. Positional feature IDs and bulletin-level product IDs were not mistaken for event identity.

## Residual risks, manual verification and rollback

Exactly-once delivery is not claimed: a crash after consideration persistence and before dispatch may omit an interruption. Bounds or storage failure reduce replay protection and may permit repeat consideration after eviction/restart. Source warning eligibility remains unchanged. Legacy v1 is retained; legacy unsupported derived situations remain quarantined. Rollback is a PR revert, but post-migration user changes require reconciliation and replay guarantees return to the previous behavior.

Installed-app/manual verification was not performed. In a seeded test profile, replay a warning across restart and 500-row churn, confirm user state and a single consideration, revise its location, then verify unknown location offers no map action. Review failed-storage diagnostics without changing real credentials or profiles. Native/macOS adoption and GDACS endpoint repair remain separate tasks.
