# Privacy Fix Plan — 2026-06-12

Implementation plan for the 5 High findings in `docs/PRIVACY_AUDIT_2026-06-11.md`, plus
the highest-impact performance fixes from `docs/PERFORMANCE_AUDIT_2026-06-11.md` not
already landed by `claude/perf-quick-wins` (PR #1069, merged).

**Read this first — overlap with the in-flight security PR stack.** Several security PRs
already cover slices of these findings. Each Fix section below states exactly what is
already done and what is residual. Before starting any fix, run
`gh pr list --state all --limit 40` and re-verify the PR states listed here.

| PR | State (2026-06-12) | Overlaps |
|----|--------------------|----------|
| #1105 `claude/sec-https-urls` | OPEN | H1 transport (plain HTTP → HTTPS) |
| #1109 `claude/sec-ci-http-guardrail` | OPEN | H1 regression guard |
| #1113 + #1115 `claude/sec-llm-egress-disclosure` | MERGED | H5 renderer-side disclosure + local-only toggle |
| #1104 `claude/sec-db-log-chmod600` | OPEN | H4/H3 file permissions (events.db + heartbeat ONLY — not persistent-cache.json, not local-api.log) |
| #1069 `claude/perf-quick-wins` | MERGED | Perf quick wins 1–5 (see Performance section) |

General conventions for every fix:

- Branch from `origin/main` in a worktree: `git worktree add .worktrees/<name> -b <branch> origin/main`
- Sidecar tests: add `.test.mjs` under `src-tauri/sidecar/__tests__/`, runnable via `npm run test:sidecar` (plain `node --test`)
- Renderer service tests: `.test.mts` next to the module or in `src/services/__tests__/`, runnable via `tsx --test`
- `npm run typecheck:all` must stay at zero errors
- Push: `SKIP_STALE_CHECK=1 git push --force-with-lease origin <branch>`
- Every PR body needs a real cross-agent review marker: `Cross-agent review: Codex reviewed on <date>; outcome: <verdict>.`

---

## Fix 1 — Stop sending API keys over plain HTTP and in query strings (H1)

**Branch:** `claude/priv-https-verify`

**Already done elsewhere:** PR #1105 (OPEN) switches all sidecar plain-HTTP external URLs
to HTTPS, including the three key-verification probes. PR #1109 (OPEN) adds a CI guard
that blocks new `http://` external URLs in the sidecar. **Do not duplicate the
HTTP→HTTPS change.** If #1105 has merged by the time you start, rebase onto main and
verify the three lines below are HTTPS; if it's still open, base this branch on top of it
or wait for it.

**Residual problem:** even over HTTPS, the secrets ride in the **query string**:

- `src-tauri/sidecar/local-api-server.mjs:4335` — MediaStack verify: `access_key=<secret>` in query
- `src-tauri/sidecar/local-api-server.mjs:4466` — AviationStack verify: `access_key=<secret>` in query
- `src-tauri/sidecar/local-api-server.mjs:4541` — GeoNames verify: `username=<value>` in query

Query strings end up in: the sidecar's own verbose traffic log (see Fix 3), provider-side
access logs, and any intermediary that logs request lines. MediaStack, AviationStack, and
GeoNames genuinely do not support header auth on their free tiers — the key-in-query is a
provider API constraint, so the fix is **containment**, not relocation:

**Files to modify:**

1. `src-tauri/sidecar/local-api-server.mjs`
   - Locate the traffic-log entry construction (`entry.path = pathname + search` at
     ~:16014 and ~:16046, and the verbose console write at ~:1685 — exact lines after
     #1105 merges will shift; grep for `pathname + search`).
   - Confirm these verify routes are covered by the Fix 3 sanitizer (Fix 3 is the actual
     mechanism; this fix verifies coverage for the three probe paths specifically).
   - Add a `SENSITIVE_QUERY_PARAMS` set (`access_key`, `apikey`, `api_key`, `key`,
     `token`, `username`, `appid`, `client_secret`) used by the Fix 3 sanitizer, exported
     for tests.
2. Verification-response hygiene: the three probe handlers must never echo the upstream
   URL (which contains the key) in their JSON error responses. Audit each handler's catch
   block; replace any `String(error)` that can embed a URL with a static message like
   `'mediastack verification failed'` plus the upstream HTTP status code only.

**Test requirements:**

- `src-tauri/sidecar/__tests__/sensitive-query-redaction.test.mjs`:
  - sanitizer strips `access_key`, `username`, `token` values from a path string while
    preserving the route path and non-sensitive params
  - probe error responses for a mocked 401 upstream contain no `access_key=` substring
- Run: `npm run test:sidecar` green; `npm run secrets:scan` green.

**Risk assessment:** Low. Containment only — no provider request format changes, so
verification behavior is unchanged. Main risk is missing one of the log sinks; mitigated
by the Fix 3 shared sanitizer + unit test. Coordinate merge order with #1105 to avoid
conflicts in the same file (rebase whichever lands second).

---

## Fix 2 — Analytics consent gate + payload minimization (H2)

**Branch:** `claude/priv-posthog-optout`

**Already done elsewhere:** nothing. This finding is fully open.

**Problem recap:** `src/services/analytics.ts:32-46` treats absent consent as consent
(`setAnalyticsConsent()` exists but has **zero callers**); `trackEventBeforeUnload`
(:344-348) skips the ghost-mode check; the init `$pageview` (:286) and
`flushOfflineQueue` (:319-330) bypass ghost mode; Vercel Analytics `inject()` at
`src/main.ts:250` runs unconditionally; `wm_api_keys_configured` (:354-373) sends a
73-key boolean presence map plus the literal `OLLAMA_MODEL` value; super properties
(:252-274) are fingerprint-adjacent.

**Files to modify:**

1. `src/services/analytics.ts`
   - **Default-off until consent.** Change the consent getter (~:32-46) so that absent
     stored consent ⇒ analytics disabled. Single gate function
     `isAnalyticsAllowed(): boolean` = `consentGranted && !isGhostMode()`; every send
     path calls it: `capture()`, init `$pageview` (:286), `flushOfflineQueue` (:319-330),
     `trackEventBeforeUnload` (:344-348).
   - **`trackEventBeforeUnload`** additionally must early-return when
     `!isAnalyticsAllowed()` — it currently bypasses even the ghost check.
   - **`wm_api_keys_configured` (:354-373):** remove the per-key boolean map and the
     literal `OLLAMA_MODEL` value. Replace the payload with a single
     `configured_key_count: number`. Nothing else.
   - **Super properties (:252-274):** drop screen resolution / locale-adjacent fields if
     present; keep app version + platform (`darwin`/`web`) only.
   - **Offline queue:** when consent is absent or revoked, `flushOfflineQueue` must clear
     the queue without sending (revocation should not later replay buffered events).
2. `src/main.ts:250`
   - Wrap the Vercel `inject()` call: only run when `isAnalyticsAllowed()` returns true
     at boot. Import the gate from `analytics.ts`. (Vercel inject is web-only; the
     desktop build should never reach it — preserve any existing runtime guard.)
3. `src/components/UnifiedSettings.ts` (or wherever the Privacy/General settings tab
   renders — grep for `SETTINGS_CATEGORIES` usage)
   - Add an "Share anonymous usage analytics" toggle wired to `setAnalyticsConsent()`.
     Default unchecked. Toggling off calls PostHog `opt_out_capturing()` if the client is
     already initialized, and clears the offline queue.
4. Migration note: existing users have no stored consent key, so this flips analytics
   off for everyone until they opt in. That is the intended behavior per the audit
   ("consent-absent ⇒ on" is the finding). Do not add a grandfather path.

**Test requirements:**

- `src/services/__tests__/analytics-consent.test.mts`:
  - absent consent ⇒ `isAnalyticsAllowed()` false; granted ⇒ true; granted+ghost ⇒ false
  - `wm_api_keys_configured` payload shape: exactly `{ configured_key_count }`, no key
    names, no `OLLAMA_MODEL`
  - revoking consent clears the offline queue (mock localStorage/queue)
- Manual check in the PR description: with consent off, no `posthog.com` or
  `vercel-insights` requests appear in devtools network on web build.
- `npm run typecheck:all` zero errors.

**Risk assessment:** Medium. Analytics volume will drop to near zero until users opt in —
that is the point, but flag it in the PR body so it isn't mistaken for a regression.
PostHog client API (`opt_out_capturing`) must match the installed posthog-js version.
Ghost-mode interaction is already partially implemented; keep `analytics suppressed in
Ghost Mode` semantics intact (consent AND not-ghost, never OR).

---

## Fix 3 — Stop persisting query strings in the traffic log (H3)

**Branch:** `claude/priv-traffic-log-redaction`

**Already done elsewhere:** PR #1104 (OPEN) chmods `events.db` + heartbeat to 0600 but
its scope note explicitly excludes `local-api.log` / `sidecar.log` (created by the Rust
host). The content problem — query strings persisted — is fully open.

**Problem recap:** the verbose console write at `local-api-server.mjs:1685` and the
traffic-log entries (`entry.path = pathname + search` at :16014 and :16046) record full
query strings; verbose mode persists across restarts via `verbose-mode.json`
(:6519-6527). The Rust host pipes sidecar stdout to `local-api.log`
(`src-tauri/src/main.rs:2497-2498`), and `copy_diagnostics` (main.rs:2657-2686) exports
the last 200 lines to the clipboard. The only sanitized surface today is the
`/api/local-traffic-log` JSON route (:16022-16028).

**Files to modify:**

1. `src-tauri/sidecar/local-api-server.mjs`
   - Extract the existing sanitizer logic from :16022-16028 into a top-level function
     `sanitizePathForLog(pathname, search)` that:
     - drops values of params in `SENSITIVE_QUERY_PARAMS` (from Fix 1), replacing with
       `<redacted>`
     - for all *other* params, keeps the param **names** but drops values longer than 32
       chars (location coords, free-text queries) — i.e. default-deny on values, not just
       known-sensitive keys. Rationale: lat/lon and search terms are the privacy payload
       here, not only API keys.
   - Apply it at all three sinks: the console write (:1685), and both `entry.path`
     assignments (:16014, :16046). The `/api/local-traffic-log` route then serves
     already-sanitized entries and its inline sanitizer can be deleted.
   - Export `sanitizePathForLog` for tests.
2. `src-tauri/src/main.rs`
   - `local-api.log` creation (~:2497-2498): set file mode 0600 on creation
     (`OpenOptions` + `PermissionsExt::from_mode(0o600)` on unix). This is the log-file
     half that #1104 explicitly left out.
   - `copy_diagnostics` (:2657-2686): no change needed once the sidecar stops emitting
     query strings — but add a defensive line-level regex strip of
     `(access_key|api_key|apikey|token|key)=[^&\s]+` before clipboard export, since old
     log files written before this fix may still contain secrets.

**Test requirements:**

- `src-tauri/sidecar/__tests__/sanitize-path-for-log.test.mjs`:
  - `?access_key=SECRET` ⇒ `?access_key=<redacted>`
  - `?lat=41.61&lon=-86.72` ⇒ values ≤32 chars: decide and pin behavior — coords are
    short, so the default-deny length rule alone won't catch them. Add `lat`, `lon`,
    `latitude`, `longitude`, `q`, `query`, `address` to `SENSITIVE_QUERY_PARAMS`.
  - route path itself is always preserved (`/api/weather/alerts` stays intact)
- `npm run test:sidecar` green; `cargo build` (or `npm run desktop:build:full` if
  touching main.rs warrants it) compiles.

**Risk assessment:** Low-medium. Debugging ergonomics degrade slightly (param values
gone from verbose logs); acceptable — param *names* remain, which is enough to identify
the route variant. The main.rs change is small but touches the Rust host: it needs a
desktop build to verify, and the 0600 chmod must not break log rotation if any exists
(grep main.rs for rotation logic first). Merge-order conflict risk with #1104 is nil
(different lines/files) but rebase after it lands anyway.

---

## Fix 4 — persistent-cache.json: TTL, size cap, eviction, 0600 (H4)

**Branch:** `claude/priv-cache-hygiene`

**Already done elsewhere:** PR #1104 does **not** touch persistent-cache.json. Fully open.

**Problem recap:** `src-tauri/src/main.rs:162, 804-812, 838-860` — the persistent cache
is a plaintext JSON file, observed at 46 MB, written mode 0644, with per-entry caps only
(256 B key / 5 MB value), no TTL, no total-size cap, no eviction. It accumulates API
responses (which include location-derived data) indefinitely. Renderer side:
`src/services/proxy.ts:62-91`, `src/services/persistent-cache.ts:99-128`.

**Files to modify:**

1. `src-tauri/src/main.rs`
   - **Entry shape:** add `stored_at: u64` (epoch millis) to each cache entry on write
     (~:838-860). Entries without `stored_at` (pre-migration) are treated as expired on
     first load.
   - **TTL on read** (~:804-812): default TTL 7 days; expired entries return miss and are
     dropped on the next persist.
   - **Total-size cap with eviction:** 32 MB serialized. On save, if over cap, evict
     oldest-`stored_at`-first until under cap. (LRU would need read-tracking; oldest-write
     is sufficient and simpler — the cache is a freshness cache, not a hot-set cache.)
   - **File mode:** create/rewrite with 0o600 (`PermissionsExt::from_mode`), same pattern
     as #1104 / #1103.
   - **One-time shrink:** the migration (no `stored_at` ⇒ expired) automatically clears
     the existing 46 MB file on first run after update.
2. `src/services/persistent-cache.ts:99-128`
   - No protocol change required if TTL lives in Rust. Verify the TS side tolerates a
     miss for previously-hot keys (it already must, for first-run). If the TS layer has
     its own staleness logic, align its default to ≤ the Rust TTL so behavior is
     explainable.

**Test requirements:**

- Rust unit tests in `main.rs` (or a `cache.rs` module if you extract — extraction is
  optional, do not refactor beyond the fix):
  - entry older than TTL ⇒ read miss
  - entry without `stored_at` ⇒ read miss
  - over-cap save evicts oldest entries first and lands under cap
- Manual verification in PR body: after running the app, `ls -la` shows
  `persistent-cache.json` mode 0600 and a sane size.
- `npm run typecheck:all` + desktop build compile.

**Risk assessment:** Medium. The one-time cache flush causes a cold-start burst of API
re-fetches on first launch after update — every cached provider gets re-hit. Acceptable
once; note it in the PR body. Eviction logic must be deterministic and crash-safe (write
to temp file + rename, if not already the pattern — check existing save path at
:838-860). Do not change the IPC surface; renderer code keeps working unmodified.

---

## Fix 5 — Groq fallback: honest labeling, budget metering, sidecar-side gate (H5)

**Branch:** `claude/priv-groq-fallback-honesty`

**Already done elsewhere (substantial):** PRs #1113 + #1115 (MERGED) added the
cloud-egress disclosure modal, the `Local model only` toggle
(`src/services/ai-flow-settings.ts`: `isLocalModelOnly()` / `isLlmEgressDisclosed()`),
and gates in `llm-adapter.generateText()` + `claude-agent.runClaudeAgent()`. **Do not
rebuild any of that.**

**Residual problem:** the gates live in the renderer, but the silent Groq hop lives in
the **sidecar**: `/api/intel-generate` (`local-api-server.mjs:4843-4855`) tries Ollama →
LM Studio → Groq (`llama-3.1-8b-instant`). The renderer treats any `/api/intel-generate`
success as the *local* path, so:

1. `llm-adapter.ts` records `provider: 'local'` even when Groq (cloud) served the
   request — the user-facing provenance is wrong.
2. The 50/day cloud budget (`llm-budget.ts:183`, `reserveCloudCall()`) is bypassed for
   these calls entirely.
3. `isLocalModelOnly()` does not stop them, because the renderer believes the call is
   local. Prompts (≤8000 chars, embedding watchlist terms via
   `watchlist-hypothesis-bridge.ts:156` and persona context via
   `hypothesis-ensemble.ts:102-114`) reach Groq with the toggle ON.

Item 3 is the actual privacy hole; 1 and 2 are honesty/metering.

**Files to modify:**

1. `src-tauri/sidecar/local-api-server.mjs` (~:4843-4855)
   - Response must include which engine served it: add `provider: 'ollama' | 'lmstudio'
     | 'groq'` to the JSON response of `/api/intel-generate`.
   - Honor a request flag: when the POST body has `localOnly: true`, skip the Groq leg
     entirely and return `503 { error: 'no local model available', provider: 'none' }`
     after Ollama and LM Studio fail.
2. `src/services/llm-adapter.ts`
   - Pass `localOnly: isLocalModelOnly()` in the `/api/intel-generate` request body.
   - Read `provider` from the response. When it is `'groq'`:
     - record the result with `provider: 'groq'` (not `'local'`)
     - call `reserveCloudCall('groq-fallback')` *before* using the result; if the
       budget is exhausted, discard the result and fall through to the existing
       no-cloud-budget behavior. Reserve-on-detect (after the response reveals Groq
       served it) is the pragmatic v1 — the alternative, reserving before the request,
       would burn budget on calls that Ollama ends up serving. Note the small
       overshoot window (the prompt has already reached Groq by the time the reserve
       fails) in the PR body.
     - the egress-disclosure gate from #1113 must also apply: if
       `!isLlmEgressDisclosed()`, treat a `provider:'groq'` response as a failure and
       dispatch `cb:llm-egress-disclosure-needed`, same as the direct-cloud path.
3. `src/services/llm-budget.ts`
   - No structural change; verify `reserveCloudCall` accepts the new caller tag and that
     metrics/labels surface it (grep for existing tags).
4. **Webcam/FAA-cam disclosure (audit-related):** `/api/webcam/analyze` (:8539) and
   `/api/faa-cam-digest` (:8574) send imagery + camera locations to Anthropic with no UI
   disclosure. Minimal v1: route both behind the existing `isLlmEgressDisclosed()`
   acknowledgment — the renderer callers of these two routes must check the flag and
   show the existing disclosure event flow before first use. Find callers:
   `grep -rn "webcam/analyze\|faa-cam-digest" src/`. Do not build a new modal; reuse
   `cb:llm-egress-disclosure-needed`.

**Test requirements:**

- `src-tauri/sidecar/__tests__/intel-generate-local-only.test.mjs`:
  - with `localOnly: true` and no local engines reachable ⇒ 503, no outbound Groq fetch
    (mock fetch; assert no call to `api.groq.com`)
  - response always carries `provider`
- `src/services/__tests__/llm-adapter-groq-labeling.test.mts`:
  - mocked sidecar response `provider:'groq'` ⇒ result recorded as `groq`, budget
    reserve called once
  - budget exhausted ⇒ groq result discarded
  - `isLocalModelOnly()` true ⇒ request body contains `localOnly: true`
- `npm run test:sidecar` + `npm run typecheck:all` green.

**Risk assessment:** Medium. Behavior change: users with no local model and
local-model-only OFF now consume cloud budget for ensemble/skeptic calls — they may hit
the 50/day cap sooner. That is correct metering, but call it out in the PR body. The
sidecar response-shape addition is backward-compatible (new field). The disclosure gate
on webcam routes may surprise users who used them before; the one-time acknowledgment
makes this a single extra click.

---

## Performance Fixes Beyond Quick Wins

`claude/perf-quick-wins` (PR #1069, MERGED — verified against the actual diff) already
landed: event-store dedup IDs **and** the transactioned batch insert **and** the daily
prune timer; FRED 6 h caches (freight-stress + macro-stress); FIRMS 30 min cache; the
shared OpenSky `opensky:states:all` snapshot across all three call sites; EEWStatusBar
and CorrelationAlertBanner poller slowdowns. Do not redo any of those. The
highest-impact remaining items, in priority order:

### Perf 1 — Hot-route caches + generic in-flight dedupe in `getCached`/`setCached`

**Branch:** `claude/perf-hot-route-caches`
**Files:** `src-tauri/sidecar/local-api-server.mjs` — `/api/market-quotes` (~:9705),
`/api/weather/alerts` (~:8068), `getCached`/`setCached` (~:3833-3846); reference the
existing `_inflight` pattern in `cachedFetch` (~:322).
**Change:** add short-TTL caches (market-quotes 30 s, weather/alerts 60 s) to the two
hottest uncached routes, and add in-flight promise dedupe to the `getCached`/`setCached`
cache family so N concurrent panels asking for the same key produce one upstream fetch
(mirror the `_inflight` map that `cachedFetch` already has — the two cache systems are
separate; this closes the gap in the `_sidecarCache` one).
**Tests:** sidecar test asserting two concurrent requests to a mocked slow route produce
one upstream call; TTL expiry produces a second call.
**Risk:** Low. Pure additive caching; TTLs are well under data freshness needs.

### Perf 2 — poweroutage.us TTL 60 s → 5 min + InfraRiskMatrixPanel decoupling

**Branch:** `claude/perf-poweroutage-ttl`
**Files:** sidecar poweroutage route (grep `poweroutage`), `src/components/InfraRiskMatrixPanel.ts`.
**Change:** raise the poweroutage cache TTL to 5 min (the upstream updates ~10 min);
ensure InfraRiskMatrixPanel's own poll interval is ≥ the TTL so it isn't polling a
guaranteed-stale-miss cycle.
**Tests:** existing sidecar tests stay green; assert TTL constant via exported value or
route test.
**Risk:** Low. Outage counts 5 min stale is well within product tolerance.

### Perf 3 — `/gps/nmea`: execFileSync → async execFile (+ auth gate, privacy M7)

**Branch:** `claude/perf-gps-nmea-async`
**Files:** `src-tauri/sidecar/local-api-server.mjs` (~:15575-15605, execFileSync at ~:15588).
**Change:** replace the synchronous `execFileSync` (blocks the entire single-threaded
sidecar event loop up to 3 s per call) with promisified `execFile`. While in the
handler, also move the route behind the bearer-auth check — the audit's privacy finding
M7 flags it as pre-auth; this is a two-line ordering change in the dispatch path.
**Tests:** sidecar test that the route rejects without the bearer token; mocked execFile
resolves asynchronously.
**Risk:** Low-medium. The auth gate is a breaking change for any unauthenticated local
caller — grep the repo for `/gps/nmea` consumers first and update them to send the
token.

### Perf 4 — `dispose()` vs `destroy()` lifecycle bug across ~55 components

**Branch:** `claude/perf-dispose-destroy-audit`
**Files:** ~55 components implementing `dispose()` while the panel host calls
`destroy()` (audit example: `src/components/HybridWarfarePanel.ts:26-28`); panel
teardown in `src/app/panel-layout.ts`.
**Change:** pick ONE canonical teardown name (match what `Panel.ts` base class +
panel-layout actually invoke — verify before renaming), then rename the orphaned
`dispose()` implementations so their `clearInterval`/listener cleanup actually runs on
panel close. This is the root cause behind a chunk of the 375 raw `setInterval` leaks.
**Tests:** `npm run typecheck:all`; add one regression test asserting a representative
panel's interval is cleared after teardown if a harness exists (`grep -rn "destroy()"
src/components/__tests__/` first); otherwise manual verification steps in the PR body
(open/close panel, observe interval stops via console counter).
**Risk:** Medium. Wide mechanical change touching 55 files — keep it purely mechanical
(rename + wire-up, zero logic changes) so Codex review can verify by pattern. Land it as
its own PR with nothing else mixed in.

### Perf 5 — Coordinate NWS `alerts/active` pulls + add timeout to renderer-direct fetch

**Branch:** `claude/perf-nws-coordination`
**Files:** `src/services/weather.ts:41-53` (renderer-direct fetch, no timeout); the
sidecar NWS alert routes (grep `api.weather.gov/alerts`); audit notes 4 uncoordinated
pulls.
**Change:** route the renderer-direct call through the sidecar's cached route (or, if
the renderer must stay direct for web builds, add `AbortSignal.timeout(10_000)` and a
60 s memory cache); consolidate the sidecar pulls onto one cached fetch with a shared
TTL so the app issues at most one `alerts/active` request per minute instead of four
overlapping ones.
**Tests:** unit test for the renderer cache/timeout; sidecar tests stay green.
**Risk:** Low-medium. Weather alerts are safety-relevant — keep the TTL at 60 s, never
higher, and preserve the existing personal-storm-mode bridge behavior
(`bridgeWeatherAlertsToInsights` consumers in `src/app/data-loader.ts`).

---

## Suggested landing order

1. Fix 2 (analytics consent) — standalone, highest user-facing privacy value
2. Fix 3 (traffic-log redaction) — unlocks Fix 1's verification step
3. Fix 1 (probe containment) — after #1105 merges
4. Fix 5 (Groq honesty) — renderer + sidecar, builds on merged #1113/#1115
5. Fix 4 (cache hygiene) — Rust-side, needs a desktop build cycle
6. Perf 1 → Perf 5 in listed order; Perf 4 (mechanical sweep) whenever convenient as an
   isolated PR

Each fix is one PR, one branch, one Codex cross-agent review. None of them depend on
each other except where noted (Fix 1 ↔ Fix 3 share `SENSITIVE_QUERY_PARAMS`; if Fix 1
lands first, define the set there and Fix 3 imports it — or vice versa).
