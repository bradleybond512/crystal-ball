# UX-051 — total RSS request budget

## Decision and approval boundary

High Assurance: request cancellation and network security boundaries. Propose one
fixed **8,000 ms** sidecar RSS deadline, starting before initial DNS validation
and continuing through redirects and the complete response body. This replaces
the current RSS-only 12-second / Google News 20-second per-hop budgets, leaving
2,000 ms nominal headroom below the renderer's existing 10,000 ms signal.
The budget is an explicit policy choice, not a measured provider latency threshold.

Bradley approved this bounded design, documentation-only draft claim and local
implementation on November 17. Publish the reviewed claim before production edits. Implementation
publication requires separate reviewed-tip approval. Merging, auto-merge, releases,
deployment and installation remain paused.

## Existing path and defect

Renderer RSS (`src/services/rss.ts`) passes its ten-second signal through proxy
and runtime handling. The authenticated sidecar RSS route validates a URL, follows
up to three redirects and buffers the final body. Current DNS work has no total
deadline; hop timeouts restart; HTTPS inactivity timeouts permit trickling bodies;
HTTP overwrites the caller signal and clears its timer before body completion.
The route's timeout substring check also misses `Request timed out`.

## Bounded implementation

Production scope: `src-tauri/sidecar/local-api-server.mjs` only. Keep an internal
RSS operation helper with narrow clock/resolver/transport dependencies for
isolated tests; no external request parameter or environment switch may disable
security or enlarge this budget.

- Create one monotonic deadline and AbortController per RSS operation. Check
  cancellation and remaining time before and after each awaited stage. Redirects
  must never reset the deadline.
- Use a resolver owned by this RSS operation. Add optional resolver/signal inputs
  to `isSafeUrl`; existing callers retain their defaults. On abort, cancel only
  this resolver's outstanding queries. Guard DNS catch paths, subsequent AAAA
  lookup, cache publication and outbound requests against late continuation.
- Pass the same signal through the existing quota wrapper and HTTPS transport;
  retain explicit request destruction on abort. No global timeout-default changes.
- Compose the HTTP helper's caller signal with its existing timeout signal.
  Preserve caller cancellation through `response.text()` after headers arrive.
  Callers without a signal retain current behavior and defaults.
- While RSS work is active, cancel on request abort or underlying socket close.
  Do not treat normal `IncomingMessage.close` as a disconnect. Remove listeners,
  clear timers and release per-operation resources in `finally`.
- Identify deadline expiration with an explicit reason and return the existing
  sanitized HTTP 504 `{error:"Feed timeout"}`. Do not attempt a response to a
  disconnected client. Preserve validation 403, redirect-limit 502 and generic
  502 error privacy; do not expose internal network errors.

Preserve authorization/CORS/Host ordering, URL credentials/protocol rejection,
all-address private/reserved-IP checks, per-hop validation, validated IPv4 pinning,
original TLS hostname and HTTP Host behavior, maximum three redirects, quota
admission/observation, headers, content type and upstream status handling.
`fetchPinnedFollowingRedirects` is not a drop-in replacement because its redirect
limit behavior differs. No renderer, provider parsing, schema, body-size policy,
cache policy, IPv6 behavior or dependency changes are included.

The resolver cancellation and transport cancellation primitives are documented in
[Node DNS](https://nodejs.org/api/dns.html) and
[Node HTTP](https://nodejs.org/api/http.html). No shared resolver is cancelled.

## Acceptance, tests and mutation proofs

Test engineer owns `src-tauri/sidecar/__tests__/rss-request-budget.test.mjs` and
narrow actual-route wiring regressions. Use the existing isolated temporary-HOME,
fixture-token and loopback-only wrapper. Tauri/security specialist owns the single
production file. Parent owns named test commands, exact test-selection mappings
and roadmap/evidence documents. Sidecar specialist and independent Sol/Sonnet
reviewers examine the completed diff before publication.

Required evidence:

- One shared deadline across initial DNS, redirect DNS, all four permitted
  requests, stalled headers and trickling bodies.
- Actual HTTPS request destruction and HTTP body cancellation, not only injected
  promises. Cancelled work must not launch another lookup/request or publish a
  late DNS result. Concurrent operations must not cancel each other.
- Client disconnect, normal completed GET handling, timer/listener cleanup,
  successful completion just before expiry and a single terminal error response.
- Retained auth, private-IP/all-address validation, pinning, redirect limit,
  quota and error-privacy checks.
- Renderer regression showing a timely local 504 retains current fallback and
  outcome classification. Existing HTTP 504 classification stays `unavailable`;
  this proposal does not change it to `timeout`.

First capture a failing baseline for the new deadline behavior. Mutation proofs
must separately expose deadline removal/reset, missing DNS cancellation or late
continuation guards, dropped HTTP caller signal, missing body cancellation,
incorrect timeout classification and disconnect miswiring. Record actual applied
diffs, red counts/assertions, restored checksums and clean-tree checks.

Run new isolated tests, existing RSS route and redirect/security/transport
regressions, existing renderer RSS/fallback suites, all type checks, secret
scanning, sidecar bundle validation and the named agentic gate. Register exact
paths in targeted-test mappings. Do not weaken checks or run Cargo/native builds,
launch the installed app, access credentials or write production data.

## Tradeoffs, limits and rollback

Feeds completing after eight seconds but within the former per-hop budget will
fail earlier. Existing cloud fallback can still follow a local 504; the contract
concerns local RSS work, not final UI completion. Port discovery, authentication,
cache lookup and other renderer work can consume the nominal headroom before
the route starts. Timers are cooperative: event-loop stalls and response
serialization/compression prevent a hard real-time delivery guarantee.

Fixture correctness can be accepted here. Live-network latency, installed runtime
behavior and broader provider acceptance remain unverified; no provider schema or
endpoint changes are proposed. If implementation needs such changes, stop for
scope review and gather live body-shape evidence first. Rollback reverts this
focused change, restoring the known longer-timeout behavior; no migration exists.

## Discovery and baseline

Fresh main `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`; complete live selection
chooses UX-051 [B], with blocking[] after the previously verified UX-076 metadata
correction. Open PR overlaps #1761 (sidecar quota) and #1769 (sidecar/runtime
security) require preserving their boundaries; no direct UX-051 claim was found.

Executed existing baselines:

```sh
node tests/helpers/run-isolated-mcp.mjs --test --test-name-pattern='rss-proxy' src-tauri/sidecar/local-api-server.test.mjs
node --import tsx --test src/services/__tests__/runtime-fetch-fallback.test.mts src/services/__tests__/rss-adapters-tracked.test.mts
npm run typecheck:all
```

Actual counts: sidecar `# pass 18` / `# fail 0`; renderer `# pass 46` / `# fail 0`.
Both TypeScript configurations exited zero. These are existing behavior baselines,
not validation of the proposed deadline. Raw receipts are retained in task
artifacts `next-nov17b/`. No production changes or provider probes have run.
