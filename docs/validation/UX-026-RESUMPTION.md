# UX-026 resumption evidence

Status: third-cycle candidate blocked in review; fourth cycle subsequently
approved and in progress. No publication or acceptance claimed.

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

The bounded provider repair was saved as `b81d9dc28a6c8c211c0f03da39f31d92fd92d811`
after rebasing onto canonical main `54a9b920094e562ec4ee159130a5d733503925f8`.
Both UX-026's claim and completed UX-027 were preserved in roadmap conflicts.
The original branch and named pre-rebase stash remain available.

Behavioral provider/storm tests moved from these actual counts:

```text
# tests 38
# pass 25
# fail 13
```

to:

```text
# tests 38
# pass 38
# fail 0
```

The actual provider accepted the retained desktop response through substituted
fetch, without changing the live app:

```json
{"inputRows":100,"acceptedRows":100,"missingOnset":1,"nullGeometry":74,"allRetrievedAt":true}
```

The full command was:

```text
bash scripts/agentic-validate.sh --tests 'test:ux026 test:weather test:storm-alert-source-revision test:renderer'
```

It exited 0. Literal test totals, in that order:

```text
# tests 93
# pass 93
# fail 0
# skipped 0
# tests 411
# pass 411
# fail 0
# skipped 0
# tests 8
# pass 8
# fail 0
# skipped 0
# tests 14815
# pass 14815
# fail 0
# skipped 0
Secret scan passed for 4750 file(s).
```

Type checks and build passed in the gate, whose final output included:

```text
✓ built in 14.32s
Agentic validation gate passed.
```

This is 15,327 passing tests, not proof of the two missing behaviors discovered
by independent review. Review executed actual method/setup bodies with controlled
dependencies and found:

```text
{"phase":"shown","display":"no_reported_overlap","timerCount":0}
{"phase":"after-expiry-no-alert-or-place-event","display":"no_reported_overlap","currentProjection":"unknown","timerCount":0}
{"revision":"main","weatherFailure":"HTTP 503","cameras":1,"renders":1}
{"revision":"candidate","weatherFailure":"HTTP 503","cameras":0,"renders":0}
```

The first is a P1 stale-reassurance blocker; the second is a P2 camera-availability
regression. Production edits stopped at the third-cycle boundary. The concrete
[next repair proposal](../plans/2026-09-14-ux026-fourth-cycle-proposal.md) requires
approval. Existing source-text lifecycle tests prove wiring, not these runtime
behaviors. Literal mutation evidence is being rebuilt on an isolated clean copy.

Separately, `npm audit --json` exited 1 and reported 9 advisories: 6 moderate,
2 high and 1 critical. The critical report concerns MapLibre sanitization; high
reports concern sharp and its transformers dependency chain. This is a separate
publication blocker on the inherited dependency tree. No dependency change or
risk acceptance occurred. Preserve the audit JSON instead of running a broad
automatic upgrade. Existing dependency PRs require their own checks; their mere
existence does not establish remediation.

Private raw logs, upstream summary, desktop response, initial incomplete Claude
review and audit JSON are retained under
`~/.crystalball-diagnostics/ux026-resume-20260914/`.
No installed app, profile, diagnostic allocation or UX-025 acceptance state
changed. No push, merge or publication verdict was performed.

## Subsequent review and approval

Claude completed the corrected full-diff review, reporting all 19 changed files
readable. Its nonblocking code-only conclusion is retained in
`complete-review.txt`. It did not reproduce the actual stale-dialog or FAA
partial-success failures, so its conclusion does not supersede the independent
runtime reproductions. No publication verdict was recorded.

The independent evidence audit verified 66 artifact hashes, 25 applied diffs,
25 literal failure excerpts, 12 baseline/restored logs and restored source
checksums. This resolves the earlier paraphrased-evidence defect. Additional
accessibility/geometry proof checks are bounded to the isolated historical
candidate and cannot repair production behavior.

Bradley then approved the concrete fourth-cycle scope with “fix whatever you
need. Lets get it done.” Runtime repairs resume under that design, and the
dependency findings are being assessed separately for a targeted remediation.
No earlier failed result becomes a pass through this approval.

## Fourth-cycle implementation checkpoint

The digest now carries internal evidence recheck times and owns one timeout
while visible. It reprojects locally on expiry/freshness boundaries and document
resume; new generation, dismissal and teardown cancel owned work. No new model
or network requests are used for this reevaluation.

FAA loading settles sources independently. It uses existing tracked GDACS
provenance and snapshots FAA health primitives immediately on fulfillment;
promise success alone never earns a live badge. Cached/unavailable sources are
qualified, failed empty fallback preserves existing rows, and malformed-camera
scoring remains contained. Provider functions and polling are unchanged.

The new actual-runtime tests first failed at 0 pass / 9 fail. A later real FAA
service/scorer malformed-row case failed at 17 pass / 1 fail before its repair.
Final specialist outputs were:

```text
Runtime: # pass 18 / # fail 0
UX026:   # pass 112 / # fail 0
typecheck:all: exit 0
Scoped ESLint: exit 0
git diff --check: exit 0
```

The earlier isolated Tab mutation survived, revealing a weakness in HappyDOM's
keyboard-default simulation. The overlay tests now simulate native default
traversal, assert cancellation and cover both wrapping directions; strict focus
identity failures use concise boolean diagnostics. The overlay suite reports
12 pass / 0 fail. Historical indeterminate focus proofs remain retained; they
are not relabeled as kills. Clean fourth-candidate mutation proofs, broad gate
and independent review still follow this checkpoint.
