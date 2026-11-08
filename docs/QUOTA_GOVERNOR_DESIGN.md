# Quota Governor: bounded reconstruction of #1770

## Contract

This implements the original step-two admission, observation, ledger and
Diagnostics design. `src-tauri/sidecar/quota-policy.mjs` is the authoritative
thirteen-rule table; `quota-governor-policy.test.mjs` checks its exact matchers,
values and costs. It preserves GreyNoise, both AbuseIPDB rules, OpenSky,
NewsAPI, PurpleAir, OpenWeatherMap, VirusTotal, GeoNames, NewsData, OpenRouter,
Groq and Anthropic. This is not a new provider-price or paid/free classification.
NewsData's limit remains marked unverified; PurpleAir costs are estimates.
Null limits mean no numeric app cap, not immunity to provider cooldowns.

Fresh cache hits precede admission. Background attempts are counted before
transport and pause at 80% of configured limits. At 80% of that ceiling (64%
of the total), applicable refresh TTLs double. Explicit interactive key tests
and lookups are counted but never blocked by the app; providers may reject
them. Existing provider headers/body signals determine bounded cooldowns.
No hard reserve, global spend ceiling or provider-success guarantee is made.
Credential-verification injection, coalescing and bounded transport remain.

GreyNoise checks the batch budget and each send, stopping after an active batch
reports quota failure rather than publishing a healthy partial. Three global
OpenSky consumers share a snapshot; the fourth bounded query remains separate.
Stale data retains observation/acquisition time. Validated fresh acquisition,
not HTTP 200 alone, clears both health failure surfaces. Cache hits, rejected
rows, stale projections and quota partials do not manufacture recovery.
Tracked NewsAPI keeps its acquisition/error/origin contract.

## Persistence and isolation

The explicit-data-directory ledger stores usage counts, not provider responses.
It uses bounded descriptor reads and handles partial writes best-effort. Invalid
or unsupported safe file reads are ignored; memory accounting still works.
Required no-follow/nonblocking flags must be nonzero. Official Windows runtime
flags can be zero: no Windows restart-persistence or native acceptance is
claimed, and no unsafe fallback is introduced. A successful write alone does
not prove that this instance loaded data from disk. Write failure does not
create a new request-blocking policy.

PurpleAir retains eight requested fields, no `max_age`, and five-minute
memory-only responses. Its same-scope stale fallback is also memory-only.
The original #1761 hourly/persisted PurpleAir proposal is not silently restored.
NewsData's existing ten-minute memory cache is unchanged. Renderer/map/cloud
traffic is outside this sidecar ledger's accounting scope.

## Local status and Diagnostics

`GET /api/quota/status` stays behind the existing token gate, local-only,
private/no-store, with detached non-secret metadata. Other methods fail; local
failure never triggers a cloud attempt. The renderer validates bounds, dates,
states, numeric/null fields and unique provider identities, failing closed on
malformed data rather than displaying fabricated healthy zero usage.

API Budgets is lazy-loaded only in the Diagnostics Detail view. Demand fetching
is throttled to 30 seconds, single-flight and bounded by a five-second timeout.
Leaving the tab/disclosure level or destroying the panel aborts ownership; late
results cannot replace another view. The existing deferred content-focus hook
restores a tab only if it owned focus when replacement actually occurs. Tabs
wrap at narrow widths. Untrusted labels are escaped. Budget-release/cooldown
snapshot times are advisory; a displayed OK is not a provider-health vote.
Web-only mode reports unavailable and does not request quota data remotely.

## Verification and remaining acceptance

Direct tests live in the four `quota-governor*.test.mjs` sidecar suites,
`tests/quota-governor-gates.test.mjs`, quota route/budget tests, tracked news
provenance and real-consumer fixtures, runtime fallback tests and
`src/services/diagnostics/__tests__/quota-budgets.test.mts`.
`e2e/quota-budgets.spec.ts` exercises the actual panel with synthetic transport:
loading/single-flight, focus, escaping, disclosure, narrow layout, accessibility,
late tab/destroy completion and web unavailability. It joins the existing
interaction CI command, whose finite inventory and actual command execution
are checked by `tests/e2e-ci-coverage.test.mjs`. No native invoke bridge, account,
provider or real user cache is used in these fixtures.

The prior provisional source passed its build/budget, three browser cases and
117 fresh clean-snapshot mutation proofs. That is historical qualification, not
a claim that the final promoted test/source has passed all gates. Final exact
source requires normal hooks, affected detecting proofs, browser interaction
acceptance, required aggregate/selector/build/budget/lint and independent review.
The original Round 4 24-hour/five-restart live soak has NOT been performed.
Mocked tests are not that soak, packaged/native proof, Windows restart proof or
evidence of universal 80% spend protection. Original #1770 completion remains
open until its outstanding acceptance is resolved without silently waiving it.
