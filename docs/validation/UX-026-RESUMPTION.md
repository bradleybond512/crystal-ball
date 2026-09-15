# UX-026 resumption evidence

Status: fifth cached-context correction and dependency integration pass local
validation. Fresh Claude review and publication closeout remain open. No
publication or packaged acceptance claimed. The latest results are recorded in
the September 15 integration section below; earlier failures remain historical.

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

## Fourth-cycle review and gate result

Source `a3c3c3c0c611107bac0d2a601e2823cbfe2df2ce` passed the targeted
suites in the full gate:

```text
# pass 112
# fail 0
# pass 411
# fail 0
# pass 8
# fail 0
# pass 14816
# fail 0
Secret scan passed for 4752 file(s).
```

The gate exited 1 at the roadmap status check, before build:

```text
- UX-026 has unrecognized status IN PROGRESS — APPROVED FOURTH REPAIR CYCLE
```

The tracker now uses the supported `BLOCKED` status. This correction does not
turn the failed gate into a pass. Type checks, lint and document checks had
passed; a fresh final gate remains required.

Independent runtime review confirmed that the earlier digest-time and
NWS-camera-loss defects are addressed, but found a P2 regression: ordinary
GDACS cache hits discard known hazard context. Its actual reproduction was:

```text
Live result: 1 matched camera, label "GDACS FL — Nearby flood", score 50.
Immediate healthy cache hit, age 0 ms: 0 matched cameras, label null.
```

The view explicitly warns of incomplete evidence, so this is information loss,
not false reassurance. The proposed next repair retains cached GDACS matches
with explicit cached wording, excludes unavailable results, and preserves
existing scoring and provider contracts. Approval is pending before production
edits resume. Map dependency remediation proceeds independently.

Independent evidence audit verified 132 artifact hashes, 57 applied diffs and
logs, source checksums and a clean fourth proof worktree. The
[fourth proof report](UX-026-FOURTH-MUTATION-PROOFS.md) records 55 killed,
2 survived and 0 indeterminate mutations. Baseline and restored suites both
reported 119 pass / 0 fail. Focus entry, Tab trapping and focus restoration
now fail under mutation at 10/2, 10/2 and 11/1 respectively. The two surviving
scheduling guards remain explicitly unclaimed. For repository whitespace
compliance only whitespace-only lines are normalized; private raw logs retain
every byte. This evidence does not clear the GDACS blocker.

## Cached-context cycle approval

Bradley answered the pending cycle request with “Lets continue.” The
[approved bounded plan](../plans/2026-09-14-ux026-cached-gdacs-repair.md)
retains GDACS context with explicit cached labels. Earlier failed checks and
review findings remain historical evidence; new verification must establish
the correction. macOS 27 discovery is a parallel roadmap addition, not a
reason to weaken UX-026 or reopen UX-025's diagnostics.

## Fifth correction results

Source `f977aee1f289014746442d6cf4c7973014ad7747` retains cached GDACS
context and labels it explicitly. Independent source review found no blocking
findings and confirmed that the earlier expiry and partial-source fixes remain
intact. Scoring and NWS precedence are unchanged.

The full named-test gate exited 0 on macOS 27.0. Literal totals:

```text
# pass 115
# fail 0
# skipped 0
# pass 411
# fail 0
# skipped 0
# pass 8
# fail 0
# skipped 0
# pass 14816
# fail 0
# skipped 0
Secret scan passed for 4754 file(s).
✓ built in 15.39s
Agentic validation gate passed.
```

This is 15,350 passing tests. Type checks and lint passed inside the gate.
The logged config-load error belongs to the passing unknown-variant rejection
test; it is not a failed production build.

The [fifth literal proof report](UX-026-FIFTH-MUTATION-PROOFS.md) records
21/0 baseline/restored and three real assertion failures: retention18/3,
qualification19/2, NWS-label preservation20/1. The fourth cached-exclusion
proof is historical and superseded by the corrected requirement; it is not
current proof of desirable behavior. Source checksums restore exactly and
the isolated proof tree is clean. Whitespace-only lines are normalized in
this repository presentation; raw logs retain every byte.

Final opposite-agent review remains necessary. A separate real Claude review
attempt on the map prerequisite hit the session usage limit without a verdict.
No stale or self-review verdict was recorded for this correction. The map
prerequisite clears dependency advisories in its own candidate; UX-026 must
be integrated after that prerequisite and revalidated before publication.

Manual packaged checks still include time expiry while the digest stays open,
cache-hit camera visibility, keyboard traversal and source-failure recovery.
Rollback is a focused revert restoring the known cached-context information
loss; there is no data migration or installed-app change.

Draft PR update: retain cached GDACS hazard matches in camera rows and viewers
with explicit cached wording, while excluding unavailable evidence and
preserving NWS scoring. Attach actual service/cache regression tests, literal
mutation proofs, independent review and macOS 27 gate evidence. Keep #1704
open until dependency integration and fresh Claude review are complete.

## September 15 integration onto canonical main

Bradley authorized getting the completed task work to main. The separately
reviewed map dependency prerequisite merged first as canonical main
`7bbb43b35`. UX-026's pre-integration tip
`528a104f3cd0499be4bfbc0b4b1f69751e0e27bf` was preserved through the local
backup branch `codex/ux026-pre-main-integration-20260915`. The backup branch,
rather than an abbreviated historical reference, is the restoration source.

The ten UX-026 commits rebased without conflicts to
`97c021b51161f2a4274077d05dbb3435e963e739`. `git range-diff` reports `=` for
all ten commits. No UX-026 production or test behavior changed during this
integration. The merged map dependencies and `test:map-compatibility` script
remain intact alongside `test:ux026`; the lockfile exactly matches canonical
main with SHA-256
`2c6dac07eb70897461db5a9bac188f71512732dab4607aa449505fb44e07b69c`.

Commands used Node 22 through `/opt/homebrew/opt/node@22/bin`. `npm ci`
exited 0 and reported:

```text
added 949 packages, and audited 951 packages in 43s
found 0 vulnerabilities
```

The focused commands ran sequentially before the full gate:

```text
npm run test:ux026
# tests 115
# pass 115
# fail 0
npm run test:weather
# tests 411
# pass 411
# fail 0
```

The final integration gate command was:

```text
bash scripts/agentic-validate.sh --tests 'test:ux026 test:weather test:renderer'
```

It exited 0. Literal suite totals in command order:

```text
# tests 115
# pass 115
# fail 0
# skipped 0
# tests 411
# pass 411
# fail 0
# skipped 0
# tests 14816
# pass 14816
# fail 0
# skipped 0
Secret scan passed for 4761 file(s).
✓ built in 14.04s
Agentic validation gate passed.
Tests run: test:ux026 test:weather test:renderer
```

Lockfile validation, strict lint, all type checks, secret scanning, cross-agent
planning checks, documentation checks and roadmap checks passed inside that
gate. This is 15,342 passing tests in the named gate. Unlike the historical
15,350-test invocation above, this command does not name the separate
`test:storm-alert-source-revision` script. That script ran afterward and
exited 0:

```text
npm run test:storm-alert-source-revision
# tests 8
# pass 8
# fail 0
# skipped 0
```

Thus the same four named suites report 15,350 passes across the gate and the
separate storm-source run; the eight additional tests were not inside this
gate. The renderer's logged config-load failure is still the passing
unknown-variant rejection case, not a failed build.

`npm run bundle:check` exited 0 against the built integrated source:

```text
Bundle-size report (gzipped):
  chunks: 109
  total:  5.10 MB / 6.00 MB
    main-M74WyHcY.js  raw=1.55 MB  gzip=444.4 KB
✓ All bundle-size policies satisfied.
```

The main limit remains 460 KB. `npm audit --json` exited 0 and reported:

```json
{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
```

This fresh integrated audit clears the inherited dependency publication blocker
for this lockfile. The earlier nine-advisory result above remains historical
evidence; it was not accepted as risk or relabeled as a pass.

The existing literal mutation reports remain source-applicable: integration
did not change their production targets. Current SHA-256 values are:

| Target | SHA-256 |
| --- | --- |
| `src/services/digest-alert-projection.ts` | `b6a6c29dcacf289a539f7218bf7546346845b2fa6e43d5ec6ff4935082f6c0dd` |
| `src/components/DigestOverlay.ts` | `2aca00c7215e3dea86d9ae1b23f6734745bbd980d8d7e88a0c789ed848734b92` |
| `src/app/panel-layout.ts` | `9c89c3ece4056ce8d782ebcd8d844e3ba4fec4d6a496397b20112e389b1a8b79` |
| `src/components/FAAWeatherCamsPanel.ts` | `d7ac9d985c5ced22f32061b6e33016eb67323aee1f83bab0291847098a054f47` |
| `src/services/nws-alerts.ts` | `7fb96963d81390596eacf7dae6c0ec4ba74267aa55bdaae2d56ff0dc8455a994` |

No new mutation runs are claimed for the mechanical rebase. The two surviving
historical scheduling mutants remain unclaimed. The previously reported
independent source review applies to unchanged UX-026 behavior; fresh opposite
agent review against the final integrated tip remains required for publication.

Raw command logs, the fresh audit JSON, source hashes and the ten-commit
range-diff are retained under
`~/.crystalball-diagnostics/ux026-main-integration-20260915/`.

Packaged checks remain separate: hold the digest open across evidence expiry,
exercise keyboard trapping and focus restoration, check cached GDACS camera
visibility, and recover from one failed weather source. This integration ran
no packaged acceptance or installation. No data migration is involved. Before
publication, the backup branch preserves the prior candidate; after merge,
rollback should use a focused reviewed revert preserving the security dependency
prerequisite.

Proposed evidence commit: `Record alert validation on repaired map dependencies`.
Draft PR description: show deterministic location and saved-place impact in
digest stories, expire stale negative evidence while the dialog stays open,
and preserve qualified cached camera context under partial source failure.
Attach the integrated test, audit, bundle and mutation evidence above; keep
native acceptance claims separate from source review and CI.
