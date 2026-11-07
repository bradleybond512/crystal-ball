# UX-058 — Deferred and updated warnings

When a distinct eligible warning arrives during its source’s two-minute cooldown, Alert Inbox retains its own row, explains why the system notification was held and counts it once for the session. A newer accepted severity increase updates the row without another interruption. The inbox keeps keyboard focus through debounced updates. Explicit in-app-only preferences block OS permission requests, including for critical warnings. Pending permission work rechecks ownership, preferences, activity and expiry before attempting delivery.

The change spans the unified alert store and its bounded session metadata, the standard dispatcher and domain preferences, the inbox and its render hook, and the national and site-weather ingestion paths. The NWS route and renderer share a row validator. Cache replay, permission recovery and reopening a workspace do not replay a warning backlog.

## Verification

On base `cd459dfec`, two high warnings produced one recording-transport call and two inbox rows without a cooldown explanation. The in-app-only setting still prompted for permission. Changing to Ghost Mode during a pending prompt still allowed a constructor call. Three isolated renderers reproduced these behaviors.

On implementation `5b5af7afe`, the [acceptance assertions and live provider shapes](UX058-ACCEPTANCE.json) record 33/33 checks each in Chromium web, desktop-mode Chromium and native WKWebView. On a disposable tree reconciled with drafts #1844, #1846, #1847 and #1848, all three passed 34/34, including cancellation of a pinned warning while permission was pending. Tests used simulated provider and OS transports. No installed profile or real notification recipient was used.

The two actual NWS URLs, fetched anonymously, returned GeoJSON FeatureCollections of 127 and 361 features. The repaired projection emitted 100 each within its existing desktop bound. All individual rows passed validation. The control records include field counts for CAP identifier, sent time, onset, expiry, message type, status, severity and urgency. A separate sample of 358 had 251 different sent and onset timestamps. A provider ID and a reporting timestamp have distinct meanings from a GeoJSON feature URL and event onset.

The repository gate ran on snapshot `2daa1f2c6`. Its production files match the implementation commit. A later sidecar-test-only change added a valid-to-malformed refresh assertion and moved a mock callback to satisfy lint. The commit hook reran sidecar tests and both TypeScript configurations on the published source.

| Command | Actual output |
| --- | --- |
| `npm run test:ux058` | `# pass 89`, `# fail 0` |
| `npm run test:warning-delivery` | `# pass 44`, `# fail 0` |
| `npm run test:quiet-hours` | `# pass 144`, `# fail 0` |
| `npm run test:alert-capacity` | `# pass 11`, `# fail 0` |
| `npm run test:ux059` | `# pass 32`, `# fail 0` |
| `npm run test:acc509` | `# pass 124`, `# fail 0` |
| `npm run test:sidecar` | `# pass 665`, `# fail 0` |
| `npm run sidecar:bundle-check` | `[check-sidecar-bundle] OK — all 29 statically-imported sidecar .mjs modules are present in bundle.resources.` |

`bash scripts/agentic-validate.sh --tests 'test:ux058 test:warning-delivery test:quiet-hours test:alert-capacity test:ux059 test:acc509'` concluded with `Agentic validation gate passed.` The [mutation certificate](UX058-MUTATIONS.json) contains the actual per-reversal diffs, assertions, red counts and restored source hashes for 95 code reversals yielding 98 named failures, plus an independently restored packaging reversal. Reintroducing a cache key alone still passed. Restoring the full stale replay path failed the refresh assertion, 1/0 → 0/1 → 1/0.

The independent sidecar reviewer reproduced a malformed event field receiving HTTP 200 despite being rejected by the renderer. The shared validator repaired that mismatch and the isolated HTTP regression passed. Independent Sol review reported zero remaining code blockers after checking the repair and bundle manifest. Sonnet’s separate conclusion is recorded in the SHA-pinned verdict commit.

## Integration and operator verification

The standalone national route retains its 100-row limit. Authoritative cancellation by removal is available on the reconciled branch with #1844. Do not infer cancellation from absence in a partial feed. Reconcile the four held drafts before delivery and rerun their respective regressions. The tested combined tree is `f0eb8a9a3c3a7927e87da3b5b5632b6a43705388`. It preserves #1844 complete snapshots, #1846 Ghost accounting, #1847 derived-alert policy and #1848 workspace teardown. The local replay packet reproduces the tree from the five input commits and canonical main using a separate Git index. No draft was merged.

For a manual check, use a disposable profile with the recording transport. Ingest two distinct severe warnings from one source and focus the second row’s pin button. Issue a newer critical revision of the second warning. Confirm one initial OS attempt, one cooldown hold, focus on the same control and zero replay. Repeat with in-app-only, and with a permission prompt pending when the warning expires or is acknowledged. Reverting the implementation restores prior notification routing and presentation. No persisted disposition or credential migration is needed.
