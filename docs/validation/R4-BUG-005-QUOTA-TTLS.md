# R4-BUG-005 step 1 validation — quota-safe refresh cadence

Validated September 29, 2026 on branch `claude/r4-bug-005-quota-ttls`
(base `a255546ee`). Queue item Q4 in
`docs/SECURITY_SCAN_ROUND_4_FOR_CODEX.md`. Classification: Standard (provider
work), with two decisions from Bradley in session:

- **Persist the quota-limited caches.** Approved ("Yes, persist them"). In-memory
  TTLs reset on every sidecar restart and app relaunch, so a weekly or 8-hour
  TTL alone would not protect the quota.
- **PurpleAir worldwide view: once a day.** Bradley's choice, over "saved
  places only".

## Behavior

| Provider | Free limit | Before | After | Worst case |
|---|---|---|---|---|
| GreyNoise Community | 50 lookups/week | 20 seed lookups every 15 min, in memory | Weekly, persisted. An all-failed refresh is **not** cached, backs off 1 h and keeps serving the last good list | 20/week (40%) |
| AbuseIPDB blacklist | 5/day | 30 min, in memory | 8 h, persisted | 3/day (60%) |
| NewsAPI | 100/day | 10 min, in memory | 20 min, persisted (one production query) | 72/day (72%) |
| OpenSky global states | 4,000 credits/day (4 per call) | 55 s | 120 s (all three shared call sites) | 2,880/day (72%) |
| PurpleAir | 1M points, one-time | 5 min, 8 fields, all ages | Box around a saved place: 60 min. Worldwide: 24 h. Both persisted. `location_type` field dropped (the query already filters outdoor). `max_age=3600` drops silent sensors. `confidence` kept, because the renderer gates on it | 24 box calls/day per place + 1 worldwide |

The persisted cache (`src-tauri/sidecar/quota-cache.mjs`):

- **File:** `quota-cache.json` in `LOCAL_API_DATA_DIR`, mode 0600, replaced
  atomically (temp file, fsync, rename).
- **Reads:** only regular files, never symlinks, at most 8 MB. A malformed
  file, a wrong version or a bad entry is ignored.
- **Clock safety:** an entry stamped in the future is dropped, so a clock
  change or a tampered file cannot pin a response.
- **Bounds:** at most 64 entries, oldest evicted. An oversized payload stays in
  memory only, and the previous good file is kept.
- **Only when configured:** the file is written only to an explicitly
  configured data dir. Dev runs and tests that fall back to the resource
  dir/cwd stay memory-only, so nothing is written into the repo. The app
  always sets `LOCAL_API_DATA_DIR`.
- **Bundle:** both new modules are in `tauri.conf.json` `bundle.resources`.
  `scripts/check-sidecar-bundle.mjs` passes (28 modules).

`src-tauri/sidecar/quota-policy.mjs` holds the TTLs and the documented
limits. `tests/quota-budgets.test.mjs` fails CI if any TTL would push worst-case
use above 80% of a limit.

Changed existing test: the `/api/airquality/purpleair` worldwide-snapshot
contract in `local-api-server.test.mjs` moved from a 5-minute to a 24-hour
TTL, per Bradley's decision. It now also asserts no hourly refetch and
`max_age=3600`, so the test is stricter, not weaker.

## Actual validation

- `npm run test:quota`: 16/16 pass. This covers cache units, mocked-HTTPS
  route behavior (a restart keeps the TTL; an all-failed GreyNoise refresh is
  not cached and backs off; PurpleAir fields/`max_age`/1 h reuse; no file
  without an explicit data dir), budgets and wiring gates. The bundle check
  is OK.
- `npm run test:sidecar`: 643/0.
- Agentic gate: see the PR description.

## Mutation proof

Each mutation was applied alone against `npm run test:quota` (baseline 16/0
before and after). The table records the SHA-256
prefix of the file before mutating. Every file was restored and its hash
re-verified, and no stray cache file was left.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Cache never persisted | `quota-cache.mjs` (`f09b2e727b4f`) | 12/4 | restart keeps TTL (route + unit), bounds, 0600 |
| Future-stamped entries trusted | `quota-cache.mjs` | 15/1 | future entries dropped |
| Symlinked/non-regular file followed | `quota-cache.mjs` | 15/1 | unsafe files ignored |
| Cache file world-readable (0644) | `quota-cache.mjs` | 14/2 | file is private |
| GreyNoise back to 15 min | `quota-policy.mjs` (`14b1e622519c`) | 15/1 | 80% budget |
| OpenSky back to 55 s | `quota-policy.mjs` | 15/1 | 80% budget |
| Empty GreyNoise refresh persisted | `local-api-server.mjs` (`a31e2690c423`) | 14/2 | route + gate |
| PurpleAir `confidence` dropped | `local-api-server.mjs` | 14/2 | route + gate |
| Persist into cwd/resource dir | `local-api-server.mjs` | 14/2 | memory-only without data dir + gate |
| AbuseIPDB back to the memory cache | `local-api-server.mjs` | 14/2 | restart route + gate |
| Module missing from the bundle | `tauri.conf.json` (`e0e2273441c6`) | 15/1 | bundle gate |

All 11 mutations went red, and every file was restored to its original hash.

## Not performed / follow-ups

- No live provider calls; upstream HTTPS was mocked.
- This is step 1 only. The Quota Governor (Q12) adds header-aware budgets,
  `stale_quota` serving and a diagnostics view.
- NewsData.io (limit unverified) is unchanged.
- The PurpleAir worldwide snapshot at 24 h still costs points daily. Bradley
  accepted this. Watch the balance in PurpleAir's console.

## Rollback

Revert the commit. `quota-cache.json` is inert without the code and can be
deleted.
