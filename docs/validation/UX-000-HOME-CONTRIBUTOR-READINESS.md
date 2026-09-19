# UX-000 Home contributor readiness repair

Status: BLOCKED — final pinned browser baseline failed; PR #1726 stays draft.

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

The later pinned unmutated baseline at source commit
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

Automatic repair stopped under the repository two-cycle limit. A fresh cycle
requires user authorization; it must establish modal focus ownership and retain
all acceptance assertions, then capture green, applied-mutation red and restored
green against the final fixture. No production focus repair is proposed without
that diagnosis.

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

Independent review found no additional contributor-derivation defect, audited
all 18 proofs, and blocked completion on the final browser baseline and its
previously omitted failure disclosure. This report now retains that failure.
No clean cross-agent approval or merge verdict is claimed.
