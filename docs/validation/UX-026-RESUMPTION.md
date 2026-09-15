# UX-026 resumption evidence

Status: repair in progress; no publication or acceptance claimed.

## Scope and authorization

Bradley approved deferring UX-025 and making existing PR #1704 the next priority
on September 14, 2026. Recurring checks remain deleted at his request. He then
requested Claude's review and completion of the roadmap.

The original UX-026 task `01a05edc-f116-7290-898a-bfc7b5e5e2f0` records approval
of the high-assurance digest design with `do it`. After two automatic repair
cycles, its final response identified malformed responses becoming fresh empty
offline data, missing-onset rejection, and incomplete literal mutation evidence.
Bradley's subsequent `fix it` authorized a third repair cycle. That turn ended
at a usage limit during implementation. This work resumes that interrupted
cycle; it does not silently allocate another automatic cycle.

Discovery found committed source `9d028d0c7997d024abd526566937568da5983c08`
and six unfinished provider/lifecycle files. A repository analyst inventoried
them, and an architect confirmed the bounded completion scope: retain the
existing fetch/offline-cache architecture, reject malformed responses before
freshness writes, permit missing onset without claiming complete geography,
preserve ranking, and enforce existing work limits before traversal.

## Initial verification

Actual focused output on the inherited working tree:

```text
# tests 80
# pass 80
# fail 0
```

`npm run typecheck:all` exited 2:

```text
src/services/nws-alerts.ts(80,22): error TS2550: Property 'at' does not exist on type 'Position[]'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2022' or later.
src/services/nws-alerts.ts(133,68): error TS2322: Type 'boolean' is not assignable to type 'NWSAlert'.
```

The existing storm-adapter test also demonstrated an inherited regression:

```text
# tests 5
# pass 4
# fail 1
```

Its Polygon test expected `2026-06-14T10:00:00Z` and received `undefined`.
These are pre-repair results, not current acceptance evidence.

## Claude review retry

Claude CLI authenticated successfully and completed a read-only assessment.
It could not read the full diff outside the permitted directory, so its stated
nonblocking conclusion is incomplete and cannot be recorded as a publication
verdict. It inspected the core digest projection, prompt, overlay and wiring.
Full diff coverage and exact final source review remain required.

Missing-onset alerts intentionally remain `unknown` for digest impact; this is
the approved fail-closed behavior, not permission to substitute sent for area
completeness. Claude also identified a potential saved-place label leak in the
existing interactive-chat context. Track and assess that separately before
claiming application-wide privacy; this task only constrains the digest prompt.

## Live response evidence

On September 15 at 00:22 UTC (September 14 locally), the upstream request was:

`https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&urgency=Immediate,Expected&severity=Extreme,Severe,Moderate`

The body was a FeatureCollection with 150 rows. Among the first 100 rows, one
lacked onset. Geometry vertex counts per row ranged from 0 to 21, total 209.

An unauthenticated desktop request returned 401. A subsequent request through
the repository's existing authenticated sidecar client to `/api/nws-alerts`
returned the actual normalized array with 100 rows. One lacked onset; 74 had
null geometry. Per-row vertex counts ranged from 0 to 21, total 218. All status
values were Actual and message types were Alert or Update. The sequential live
responses are different snapshots, not an equivalence test.

Consumed normalized fields are id, event, headline, description, severity,
urgency, areaDesc, sent, onset, expires, status, messageType, centroid and geometry.
No token was included in retained output. These observed distributions describe
the sample; they do not establish maximum production geometry size or justify
loosening existing limits. The web route's envelope differs from this desktop
array; no web-route redesign is included in this repair.

## Remaining gates

Finish confirmed repairs and their red/green tests, retain literal clean-tree
mutation evidence, run relevant weather/storm/renderer suites and the agentic
gate, verify digest behavior manually where needed, then obtain independent and
complete exact-source Claude review. Update #1704's tracker and review evidence
before any publication. No installed app, profile, diagnostic allocation or
UX-025 acceptance state changes are part of this work.
