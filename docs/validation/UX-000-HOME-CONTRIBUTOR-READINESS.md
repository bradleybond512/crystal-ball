# UX-000 Home contributor readiness repair

Status: browser blocker resolved in the user-authorized cycle; final cross-agent
review and required PR checks remain before merge. Packaged acceptance stays open.

## Scope and outcome

PR #1726 continues the failed packaged test in issue #1725. Home intentionally
defers the Classic panel grid, but its Deck previously required panel rendering
before checking contributor data. The same fresh data therefore appeared useful
only when a panel became visible.

The repair evaluates attributable contributor evidence independently of visibility,
keeps render flags factual, and preserves explicit panel errors/disabled state.
Fresh positive data can be useful; empty, stale, future-dated, erroneous or
non-finite evidence cannot. Two incorrect mappings are removed: Live News/RSS
and NWS Alerts/separate weather feed. No fetch, credential, provider, CSS,
forecast, persistence or native code changes.

## Validation evidence

Commands use the supported Node 22 runtime. Raw logs are retained locally under
`~/.crystalball-diagnostics/ux000-followup-20260918/`.

Focused test-first baseline (deck and Home startup component tests):

```text
# pass 37
# fail 6
```

After repair and equivalent lint cleanup:

```text
# tests 43
# pass 43
# fail 0
```

`npm run test:homeshell`:

```text
# pass 140
# fail 0
# pass 2
# fail 0
```

`npm run typecheck:all`: exit 0. Direct ESLint on all four changed code/test files:
exit 0, no output. An initial nested-conditional lint finding was corrected
without suppressions or baseline changes.

`E2E_PORT=4198 npm run test:e2e:full -- e2e/home-shell-boot.spec.ts`:

```text
6 passed (2.2m)
```

The full run overlapped an equivalent error-label conditional refactor; focused
tests followed that refactor. The earlier successful browser run exercised contributor count,
actual hidden-grid CSS, absence of a render report, resized keyboard opening and
Escape return. A fixed three-earthquake response stabilizes the specific source
request; this is controlled browser evidence, not live provider or native proof.

The previously blocked pinned unmutated baseline at source commit
`8d4b350b8241e7301335ba74a96d197078b73053` failed:

```text
Expected: focused
Received: inactive
Timeout: 30000ms
1 failed
```

This is **0 pass / 1 fail**, before any browser mutation. Useful-card, exact-count
and no-render assertions passed, but Enter/open/Escape were not reached. The
previous six-test pass does not close this final failure. No browser mutation
proof is claimed. The failure capture contains an open Since you last looked
dialog; focus ownership needs investigation before attributing this to a Deck
render defect.

Two attempted interaction repairs did not establish reliability:

1. Focus before the explicit scroll action: scroll still reported a detached node.
2. Remove redundant explicit scrolling, retaining resize/focus/Enter/open/Escape
   assertions: a run passed, but the pinned baseline later failed the focus assertion.

Automatic repair stopped under the repository two-cycle limit. The user then
authorized a fresh bounded cycle on 2026-09-19; its results follow below. The
failed attempts remain recorded here rather than being counted as acceptance.

Initial browser attempts are retained and excluded from pass claims: an incorrect
visibility matcher for content-visibility, a live response replacing three fixture
items with fourteen, and a redundant scroll action that detached during a timed
refresh. Final fixture preserves exact-count, focus, resize, open and Escape
assertions; focusing already scrolls the control into view.

`bash scripts/agentic-validate.sh --tests "test:homeshell"` exited 0:

```text
Agentic validation gate passed.
Tests run: test:homeshell
```

The gate ran Home tests, strict lint, both typechecks, secret scans, documentation
checks, roadmap validation and the production build. Final `npm run bundle:check`
exited 0:

```text
  total:  5.11 MB / 6.00 MB
    main-BXtPC3mv.js  raw=1.55 MB  gzip=445.4 KB
✓ All bundle-size policies satisfied.
```

The main limit remains 460 KB. No baseline, security or bundle policy was changed.

## Authorized cycle and final browser evidence

Code and fixture commit: `35f0dc7bb2431b9807db2021103def0cd9e8c11b`.
Read-only diagnosis confirmed the asynchronous digest explicitly focuses its Close
button. The fixture now opens the existing on-demand digest and dismisses it via
that button. Opening cancels scheduled generation; dismissal invalidates pending
generation. All resize, focus, Enter, panel-opening and Escape assertions remain.
This establishes deterministic test setup, not a production modal-behavior repair.

Actual new results:

```text
Focused browser: 1 passed (27.1s)
Full browser file: 6 passed (2.3m)
Pinned baseline: 1 passed (45.3s)
Applied first-render-gate mutation: 1 failed
Restored browser: 1 passed (35.2s)
Agentic validation gate passed.
Tests run: test:homeshell
```

The fresh gate again reports Home tests 140 pass / 0 fail plus 2 pass / 0 fail;
types, lint, secret scans, documentation and build all passed. Bundle check:
`total: 5.11 MB / 6.00 MB`, main `gzip=445.4 KB`, and
`✓ All bundle-size policies satisfied.` Direct fixture ESLint exited 0.

[Browser mutation proof](UX-000-HOME-BROWSER-MUTATION.md) includes the applied
diff, actual useful-versus-loading failure, matching source/fixture checksums and
clean restored worktree: **1 pass / 0 fail → 0 pass / 1 fail → 1 pass / 0 fail**.
It closes the browser blocker above; native useful coverage remains unproven.

CI also exposed an issue reference in the roadmap's PR column: it fetched
`pulls/1725` and received 404. The evidence is now a descriptive issue link;
PR references retain 1660 and 1726. The unchanged roadmap controller excludes
1725, retains 1726, and reports no blocking findings locally.

## Remaining acceptance and rollback

The isolated native profile in #1725 is no longer pristine. Useful packaged
zero-key coverage, request failures, map-provider access and weather/unrest
classification are not resolved by this UI repair. UX-000 stays MONITOR and
UX-001 remains blocked. Normal-account app/local service and auto-sync were
restored after the account test; no test-profile data was deleted.

Manual acceptance: rerun the identified packaged scenarios after relevant
repairs, distinguishing native provider results from browser fixtures.
Rollback: reviewed revert of the bounded Deck derivation, with no storage
migration or credential changes.

## Mutation and independent review

[Unit/component mutation evidence](UX-000-HOME-MUTATION-PROOFS.md) records all
18 applied regressions, numerical red counts, assertions, restored checksums and
clean trees. All 18 were caught; restored focused suite: 43 pass / 0 fail.

Independent review audited all 18 unit/component proofs and the new fixture: no
new code blocker and no weakened assertions. Its earlier browser/reporting
blockers are retained above with their resolution evidence. Final evidence review
and Claude exact-tip review are required before recording a merge verdict.
