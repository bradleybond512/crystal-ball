# UX-050 local dependency integration

On 2026-11-07, the eight commits from draft #1846 were replayed cleanly onto
`56ccd569362361d92be0877980262f56aeae36da`, an explicitly local, pending #1844
warning-lifecycle dependency. This is not a canonical-main or merged checkpoint.
The original draft worktree and remote head were preserved.

The Ghost Mode shared state, unknown-preference fail-closed hold, bounded local
suppression counts and asynchronous generation check are unchanged. Vite's
startup chunk separation coexists with #1844's exact desktop fallback-port CSP.
No production repair or new design was needed during this rebase.

The full gate ran under Node 22.23.1 with the canonical user temporary directory:

```sh
VITE_VARIANT=full bash scripts/agentic-validate.sh --tests "test:ux050 test:ux047 test:sidecar-fallback test:quiet-hours test:analytics-consent test:home-reassurance test:roadmap-controller"
```

Actual output included:

```text
Agentic validation gate passed.
Tests run: test:ux050 test:ux047 test:sidecar-fallback test:quiet-hours test:analytics-consent test:home-reassurance test:roadmap-controller
[pwa:budget] 468 entries, 21.93 MiB
```

UX-050 reported `# pass 65`, the clipboard group `# pass 4`, and the compiled
bundle group `# pass 2`, all with `# fail 0`. Additional groups reported:
UX-047 124/0, fallback/CSP 24/0, quiet-hours 120/0, analytics consent 40/0,
Home reassurance 27/0 and roadmap controller 126/0. The gate also passed
lockfile, lint, application/API types, secrets, cross-agent configuration,
documentation, roadmap checks and production build.

The original feature mutation receipts remain historical evidence for unchanged
logic. The tracker now honestly retains MONITOR with review after 2026-11-14.
Final canonical-main reconciliation, the broad changed-path selection, fresh
Sonnet exact-head review, verdict and hosted checks are still required. Existing
isolated Chromium/WKWebView receipts do not establish final integrated installed
app acceptance. No new native execution or physical OS notification delivery was
performed for this local dependency checkpoint.

Installation, release, tags, build dispatch and deployment remain paused. For
rollback, remove the notice, counters and shared-mode wiring together without
migrating or deleting the existing stored preference.

## Refreshed pending dependency

The local branch was replayed cleanly onto published but still pending #1844
`c2718140c75ae041c487db236258029de65d5c0e`, which contains verified main
`45a4afad384a623e6a80b6100e8f7b2ffd8fc9ff`. This is not evidence that #1844 has
merged. The original local checkpoint remains on `codex/ux050-preserved-local-base-nov7`.
[Continuity hashes](UX-050-DEPENDENCY-CONTINUITY.json) show all 25 changed feature
source/test files and the complete `src` tree are identical to the previous
checkpoint. The seven-suite gate above was actually rerun and passed on this
refreshed dependency. Final actual-main ancestry, live candidate roadmap snapshot,
exact-head Sonnet review and hosted checks remain required before publication.

## Actual-main publication candidate

After #1844 merged, this branch was replayed onto verified main
`4b047a1288291fd4f030985b26878c28b28b38d5`. The complete Git tree before the
following evidence-only update is identical to prepared checkpoint
`142069b7046b435b7dbc8b9e01245b50f28f5aca`: tree
`27e0208a169063fa1c5457a00cae5ad90636e332`.
[Actual-main continuity](UX-050-MAIN-CONTINUITY.json) records both tree hashes
and the retained seven-suite gate log hash. The actual gate execution head was
`0a7bb6c6036d45cc51152e2cd766b9494a825ec8`, before the evidence-only commit
`142069b7046b435b7dbc8b9e01245b50f28f5aca`. Earlier wording incorrectly called
the latter the execution head. The corrected receipt lists every changed path
and identical non-evidence root objects across both checkpoints, the actual-main
rebase and the reviewed source. Whole-tree identity does not extend across those
evidence-only changes. The gate was not rerun for this history-only transition;
its actual passed result applies to unchanged source/test/build bytes. No fresh
gate or mutation run is claimed.

The selector copied from this exact main was independently rerun and all 72
selected scripts passed. A fresh live GitHub snapshot explicitly naming candidate
PR #1846 returned zero roadmap blockers. Current source remains MONITOR with
integrated packaged acceptance open and the existing installation/release holds.

The owner roadmap chat was idle before the original clean worktree at
`8cb24ef20b1a72564e582b9f6627d86f26e7a9eb` was reversibly renamed to
`codex/ux050-preserved-nov7-before-main`; files and tip were preserved. The
reconciled worktree now owns the original PR branch name. Independent exact-head
Sonnet review and hosted checks remain required; this document does not claim
that they already passed.
