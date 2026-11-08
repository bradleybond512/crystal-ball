# R4-BUG-005 bounded quota-cache slice

## Current scope and approval

This isolation cycle starts from actual main
`f10948b40ebc5b518b8f365ce5e8aef7d4205893`. The previously reviewed source
`eb212837ee86e5d037b3740b5fbc2a4cebce0802` remains frozen with its true blocking
review evidence. That review found missing live PurpleAir response-shape proof,
not a generic cache correctness blocker. PurpleAir changes are now excluded,
not waived or represented as verified. The original #1761 remains open for the
PurpleAir and portable Windows persistence remainders.

Bradley approved retaining tracked-v1, validating saved NewsAPI data and reporting
actual disk versus memory origin while preserving existing TTLs and budgets.
The earlier original provider choices and historical validation remain in the
frozen source; this document describes only the currently isolated slice.

## Delivered behavior in this slice

| Provider | Storage | Cadence |
|---|---|---|
| GreyNoise Community | Best-effort persisted cache | Weekly 20-seed refresh; all-failed refresh is not persisted, backs off one hour and serves last good data |
| AbuseIPDB blacklist | Best-effort persisted cache | Eight hours |
| NewsAPI | Best-effort persisted tracked-v1 envelope | Twenty minutes; saved data validated; actual acquisition origin retained |
| OpenSky states | Existing in-memory cache, not persisted | 120 seconds at all three existing call sites |
| PurpleAir | Exactly main's existing in-memory cache | Five minutes, global and bbox; no new persistence or query changes |

NewsData.io remains unchanged. NewsAPI envelope validation preserves the existing
schema, metadata, clocks and delivery provenance. No new governor, header-aware
spending control, account cap, schema, permission or dependency is introduced.

The budget formula is a nominal regression guard for one cache miss per TTL,
one query/key and one process. It is not a runtime or global spending guarantee.
Concurrent misses, repeated failures, multiple query keys and restarts can exceed
that estimate. The existing 80% nominal threshold and provider limits are unchanged.

## PurpleAir isolation invariant

The entire PurpleAir route is byte-identical to actual main, as is the entire
existing `local-api-server.test.mjs` contract file. The only other server edit
relative to the previous candidate removes the now-unused max-age import.
All non-PurpleAir server bytes reconstruct exactly to that prior candidate.

The route retains eight requested fields, including `location_type` and
`confidence`; the existing `location_type=0` filter and bbox handling; no
`max_age`; five-minute `getCached`/`setCached` behavior; unchanged parsing, errors
and key handling. The proposed hourly/daily TTLs, fewer-field request and new
max-age parameter are absent. PurpleAir policy constants are removed.

New synthetic runtime tests verify exact query/field shape, cache hit before
five minutes, refetch after five minutes, no persisted PurpleAir entry, refetch
on restart, and ignoring pre-existing PurpleAir disk entries without purging
or rewriting user data. Main's original PurpleAir contract tests remain intact.
These are regression tests of unchanged behavior, not live upstream proof.

## Generic cache boundary and Windows limitation

The safe generic cache retains descriptor-bound no-follow/nonblocking regular
file reads, an 8 MiB cap plus one sentinel byte, guaranteed descriptor cleanup,
complete validated UTF-8 writes before fsync/rename, exclusive 0600 temporary
files, 64-entry cap, future-timestamp guards and explicit data-directory policy.
All I/O, schema, origin and recovery logic is unchanged from the reviewed source.

Official Node 22.23.3 defines no-follow and nonblocking open flags as zero on
Windows. Disk loads therefore fail closed there; in-memory behavior and
best-effort writes do not imply restart cache reuse. Four exact-source synthetic
missing/zero-flag tests remain. No native Windows/FIFO proof or universal restart
guarantee is claimed. Best-effort fsync is not a macOS full-durability guarantee.

## Current evidence and pending acceptance

Tests were changed first to assert the isolation requirement. Before production
restoration: 19 pass / 5 fail across 24 focused route/policy tests, detecting
field/query, cadence, persistence, legacy-disk reuse and policy scope. After
restoration: 24 pass / 0 fail. Exact route and whole existing contract-file
comparison to main passed. No real provider calls, user cache or credentials
were accessed; HTTPS and data directories are synthetic.

The prior 29 mutation receipts remain historical on their true source. The
PurpleAir `drop-confidence` feature proof belongs to the deferred field-change
work and is not reused to certify this slice. Every still-applicable cache,
NewsAPI, clock, I/O, platform, provider and inventory mutation must be refreshed
on a new clean committed snapshot, with new isolation-removal mutations.
Source/test blobs changed, so whole-file continuity is not used as a shortcut.

Normal hooks, current-main reconciliation after the independent action-pin PR,
fresh trusted selector/inventory, named aggregate, final HEAD-derived build,
bundle and stable full lint are recorded in the final qualification receipt.
No stage is claimed complete merely because it passed on the previous source.
Genuine exact-source review and fresh hosted gates remain required. Release,
tag, dispatch, deployment and installation holds remain. Rollback is reverting
this bounded slice; no migration, deletion or new cache-file format is involved.

## Final actual-main reconciliation

The final candidate integrates onto actual main
`7ddbee377fb52cd67089de85ddfe20add0ae889b` after the independent upload-action pin
merge. The exact 17-file own delta from clean isolation source
`be680ad75418acb44d24115eb57a0acb8614b5c9` was applied; all own blobs initially
matched, and only this qualification note differs afterward. Every executable,
configuration and test blob remains identical. The inherited main change is
only six workflow pins. PurpleAir's route and existing contract file still match
actual main exactly; none of its deferred optimization is reintroduced.

All 28 still-applicable prior mutations were freshly recreated on clean
`be680ad7`, plus six new isolation-removal mutations: fields, max-age, cadence,
persistence, disk reads and policy constants. Every one of the 34 baselines and
restorations passed 135/135; each nonempty actual mutation triggered an intended
failure. The old `drop-confidence` feature proof remains explicitly deferred.
These new proofs are bound by exact file/test hashes to this final integration,
not mislabeled as fresh runs on its documentation-only successor.

Normal hooks and final committed-source selector, inventory, named aggregate,
build/bundle and stable full lint are recorded in the final receipt. Earlier
qualification is preserved without substituting for required current commands.
The original PurpleAir and Windows remainders stay open; no live upstream,
portable restart guarantee, governor, deployment or installation is claimed.
