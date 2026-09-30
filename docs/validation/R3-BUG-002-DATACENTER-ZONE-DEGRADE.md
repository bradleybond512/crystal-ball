# R3-BUG-002 validation — datacenter posture degrades instead of freezing

Validated September 29, 2026 on branch `claude/r3-bug-002-datacenter-posture`
(base `a255546ee`). Approved design:
[plan](../plans/2026-09-29-r3-bug-002-datacenter-zone-degrade.md).

## Behavior

- **Zone lookup:** `resolveSiteZonesBestEffort` (`src/services/datacenter/site-zones.ts`)
  resolves the site's UGC zones.
  - A failed NWS `/points` lookup (5xx, 429, timeout, malformed) returns
    `{ zones: [], degraded: true }` and is never cached, so the next tick
    retries.
  - A 404 outside-jurisdiction `[]` is a real answer and is cached.
- **Posture:** a degraded lookup no longer skips the tick. The posture
  computes with polygon-only matching, and `'weather zones'` joins
  `staleInputs`.
  - The pinned strip shows "⚠ weather zones stale" with its degraded style.
    The readiness panel footer and the Home contextual deck also show it.
  - Polygon warnings still set the level.
- **Skipped recompute:** any other failure of the posture block calls
  `markDatacenterPostureStale('posture recompute failed')`, so the previous
  posture (possibly "All clear") is visibly stale. The next successful
  recompute clears the label.

## Actual validation

`bash scripts/agentic-validate.sh --tests "test:datacenter"`:

```text
test:datacenter  ℹ pass 44 / ℹ fail 0 (tsx) ; ℹ pass 2 / ℹ fail 0 (wiring gate)
lockfile:check, lint:strict, typecheck:all, cross-agent:check, roadmap:check, build — passed
Secret scan passed for 4923 file(s).
[docs:check] Documentation appears fresh.
Agentic validation gate passed.
```

## Mutation proof

Each mutation was applied alone against `npm run test:datacenter` (baseline
46/0 before and after). The table records the SHA-256 prefix of the file
before mutating. Every file was restored and its hash re-verified.

| Mutation | File (sha before) | Pass/fail | Red test(s) |
|---|---|---|---|
| Lookup failure throws (no `catch`) | `site-zones.ts` (`df967f18585d`) | 42/2 | degrade + not cached; next success cached |
| Failure cached | `site-zones.ts` | 42/2 | same two |
| No `'weather zones'` stale label | `datacenter-posture.ts` (`ef8bc5372adc`) | 43/1 | unverified zones reported stale |
| Mark-stale is a no-op | `datacenter-state.ts` (`9f46bdc36699`) | 43/1 | skipped recompute marks stale |
| Wiring drops the degraded flag | `data-loader.ts` (`a85f5c374c3d`) | 45/1 | flag reaches posture |
| Wiring skips mark-stale | `data-loader.ts` | 44/2 | wiring gates |
| Wiring uses the throwing lookup | `data-loader.ts` | 45/1 | best-effort helper only |

All 7 mutations went red, and every file was restored to its original hash.

## Not performed

- There was no live NWS outage. Failure modes are injected into the helper,
  and the data-loader wiring is proven by a source gate.
- Follow-up, not in this change: an age-based staleness badge when the whole
  weather tick never runs. The strip re-renders only on emit.

## Rollback

There are no persisted-data changes. Reverting restores the tick-skip
behavior.
