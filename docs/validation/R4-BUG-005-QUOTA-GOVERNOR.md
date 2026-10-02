# R4-BUG-005 step 2 validation — Quota Governor

Validated October 2, 2026 on branch `claude/r4-bug-005-quota-governor`. It is
stacked on PR #1761 (step 1, `claude/r4-bug-005-quota-ttls`). Approved design:
[plan](../plans/2026-10-01-r4-bug-005-quota-governor.md). Bradley's choices:
PurpleAir is tracked as an estimate with no app cap; Anthropic is tracked
only, and the Console's monthly limit is the guard; background refreshes stop
at 80%.

## Behavior

- **Counted before sending.** `fetchWithTimeout` is the only path to the 13
  governed provider rules. It calls `admit()` before the socket opens. A
  denial throws `QuotaExhaustedError`, and nothing goes on the network. A
  static gate pins that no other code path reaches a governed host.
- **Rolling windows.** "Used in the last 24 h", not "today". Rules can have
  several windows; VirusTotal, for example, has 500/day **and** 4/min.
  OpenSky charges 1–4 credits by box area, per the OpenSky docs.
- **Background vs. interactive.**
  - Background refreshes stop at 80% of every limit.
  - Settings key tests (`/api/local-validate-secret`) and the manual
    VirusTotal and GreyNoise lookups run in an `AsyncLocalStorage`
    "interactive" scope. They are counted but never blocked.
- **Pacing:** at 80% of the background ceiling, a feed's TTL doubles.
- **Provider signals:**
  - A 429 or 402 starts a cooldown, as does `X-Rate-Limit-Remaining: 0` /
    `X-RateLimit-Remaining: 0`.
  - The cooldown length comes from `Retry-After` (seconds or date),
    `X-Rate-Limit-Retry-After-Seconds` or `X-RateLimit-Reset`, defaulting to
    1 h.
  - It is clamped between 1 minute and the rule's window.
  - A non-governed https host that sends 429 + `Retry-After` is left alone
    for at most an hour, for background calls only.
- **Out-of-quota feeds:**
  - Feeds covered: GreyNoise scanners, AbuseIPDB blacklist, NewsAPI,
    PurpleAir, and the OpenSky routes (one shared snapshot).
  - They serve the last good data with `X-Quota-State: stale_quota`.
  - With nothing saved, they return a 503
    `{ error: 'quota_exhausted', provider, retryAt }`.
  - Both feed-health surfaces record `quota_exhausted`, never a healthy vote.
  - GreyNoise:
    - It starts a weekly refresh only when all 20 lookups fit.
    - A 429 stops it after the first batch.
    - An all-failed refresh is now a 503 instead of `[]`.
- **Ledger:**
  - `quota-ledger.json` lives in `LOCAL_API_DATA_DIR`.
  - It is written 0600 with an atomic replace, coalesced to one write per
    second, and flushed on close and exit.
  - On load it reads only a regular file within a size cap, checks every
    field, and drops future buckets and unknown providers.
  - It holds rule ids, counts and times only.
  - Dev runs and tests stay memory-only.
- **Key rotation:** saving a new key clears that provider's cooldown and
  header state. Counts are kept.
- **API Budgets tab** in System Diagnostic (`/api/quota/status`, token-gated).
  - Per provider it shows a use meter against each limit, with the 80% marker.
  - The state can be OK, Paced, Background paused or Provider cooldown, with
    the time background calls resume.
  - It also shows the provider-reported remaining value, PurpleAir's
    estimate note, and Anthropic's token tally.
  - Throttled non-governed hosts are listed.
  - All sidecar strings are validated and escaped.

Found while wiring: the ADS-B fusion route also calls OpenSky (with a box),
outside step 1's TTL math. It is now governed with the box-area cost.

## Changes to step 1 tests (on purpose)

- `quota-routes`: the all-failed GreyNoise case uses a 500 and now expects a
  503 instead of `[]`. The 429 case is a new test that expects at most one
  batch.
- `quota-budgets`: the OpenSky TTL check now pins the shared snapshot helper
  and the governor's pacing, instead of three copies of the TTL.

## Actual validation

All tests use fakes: mocked HTTPS, an injected clock, temp ledgers. Nothing
leaves the machine and no Keychain is touched.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:quota` (16 governor unit, 9 route wiring, 5 gates, plus the step 1 suites and 6 tsx) | 47/47 node + 6/6 tsx |
| `test:sidecar` | 643/643 |
| `test:panels:smoke` harness | PASS (the one failing check lists 7 unrelated, unclassified sidecar routes such as `/api/webcams/tfl`; none is from this change) |

- `tsc --noEmit` and ESLint are clean on every changed file.
- The agentic gate (`test:quota test:sidecar`) passed, including `lint:strict`, `typecheck:all`, `secrets:scan`, `docs:check` and `npm run build`.

## Mutation proof

Each mutation was applied alone. The table records the SHA-256 prefix of the
file before mutating; every file was restored and its hash re-verified.
Baselines were green. G14 first survived: a negative count summed to zero in
the old test. The test now mixes a negative count with a valid one, and the
mutation is red.

| # | Mutation | File (sha before) | Red test file(s) |
|---|---|---|---|
| G01 | background may use 100% | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (5) |
| G02 | interactive held to budget and cooldown | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (2), quota-governor-routes (1) |
| G03 | interactive held to a host cooldown | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G04 | windows never roll | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (2) |
| G05 | only the first window counts | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G06 | small OpenSky box costs 4 | `quota-policy.mjs` (`c15c30ee782e`) | quota-governor (1) |
| G07 | no pacing | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1), quota-governor-routes (1) |
| G08 | Retry-After seconds ignored | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (3), quota-governor-routes (1) |
| G09 | cooldown not clamped to the window | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G10 | remaining 0 ignored | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G11 | key change keeps the cooldown | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1), quota-governor-routes (1) |
| G12 | generic cooldown uncapped | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G13 | PurpleAir estimate never settles | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G14 | malformed token counts accepted | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G15 | ledger world-readable | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G16 | tampered cooldown not clamped | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G17 | future buckets accepted | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G18 | symlinked ledger followed | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| G19 | every count written at once | `quota-governor.mjs` (`3cd0ad27bb6c`) | quota-governor (1) |
| W01 | denied call still sent | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (4), quota-governor-gates (1) |
| W02 | responses not observed | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (2), quota-governor-gates (1) |
| W03 | key test not interactive | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1), quota-governor-gates (1) |
| W04 | manual GreyNoise lookup not interactive | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1), quota-governor-gates (1) |
| W05 | key change not reported to the governor | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W06 | stale data not marked | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (2) |
| W07 | exhaustion reads as success | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (5), quota-routes (1) |
| W08 | no failure in /api/health | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W09 | no failure in /api/feeds/health | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W10 | GreyNoise refresh started without room | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W11 | OpenSky drops its stale snapshot | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W12 | OpenSky 429 not treated as quota | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W13 | NewsAPI 429 becomes an empty list | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W14 | AbuseIPDB not paced | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W15 | budgets route public | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W16 | ledger memory-only | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1), quota-governor-gates (1) |
| W17 | close does not flush | `local-api-server.mjs` (`a1a850bc11a5`) | quota-governor-routes (1) |
| W18 | governor left out of the bundle | `tauri.conf.json` (`b9b33e1dd69f`) | quota-governor-gates (1) |
| U01 | label not escaped | `system-diagnostic-budgets.ts` (`e6935f6cba62`) | quota-budgets (1) |
| U02 | host not escaped | `system-diagnostic-budgets.ts` (`e6935f6cba62`) | quota-budgets (1) |
| U03 | unknown state accepted | `quota-budgets.ts` (`a995dbfc03c0`) | quota-budgets (1) |
| U04 | no 80% marker | `system-diagnostic-budgets.ts` (`e6935f6cba62`) | quota-budgets (1) |
| U05 | cooldown not explained | `system-diagnostic-budgets.ts` (`e6935f6cba62`) | quota-budgets (1) |
| U06 | HTTP errors look like data | `quota-budgets.ts` (`a995dbfc03c0`) | quota-budgets (1) |

All 43 mutations went red, with no survivors.

## Not changed here

- Renderer-side traffic (Cesium ion, map tiles) never passes through the
  sidecar, so it is not counted. The tab says so.
- PurpleAir point costs are estimates. PurpleAir's developer portal has the
  real balance.
- NewsData.io's 200/day limit is unverified and marked as such.

## Rollback

Revert the commit. The step 1 TTLs and the persisted cache remain. Delete
`quota-ledger.json` from the app data folder if you want to clear the counts.
