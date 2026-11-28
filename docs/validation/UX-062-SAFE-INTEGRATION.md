# UX-062 — Protected integration preparation

November 28, 2026. Bradley authorized safe protected merges and a new Mac build.
This worktree prepares the already approved bounded UI slice from PR #1886 for
serial integration. It does not complete full UX-062 baseline comparison work.

## Provenance and unchanged behavior

Base: `f8fc6cac84fe087a562139d86d59f2f7aaec7c5a`, the combined security candidate.
Reviewed source: `31979f2a157dc58c84746bacd0c0e35ebea2d654`, immediately before
PR #1886 verdict `cba94b041e559351823864d2080d4f91240c6392`.
Original feature base: `4432188fedbaba28938608cc07da6a25d11ca0c9`.
No historical verdict was replayed or treated as approval of this integration.

The [SHA-256 provenance certificate](UX062-SAFE-PROVENANCE.json) records the
initial replay checkpoint: all five production files match the original feature base byte for byte before replay;
the candidate production files and focused test match the reviewed source byte
for byte afterward. No source conflicts or design changes were necessary for that replay. The later
keyboard repair below is explicitly separate from this preserved-byte checkpoint.
Package scripts and test mappings are additive; unrelated tracker rows, dependency
locks, security repairs and delivery workflows remain unchanged.

The original approved design, QA and four JSON evidence certificates are retained
as historical evidence. Their test, browser and mutation results are not relabeled
as new runs. Fresh integration results will be recorded below after execution.

## Current validation

Node 22; dependencies symlinked to the existing validated UX074 dependency tree
after exact root lockfile equality. No package installation or lockfile change.
The original focused suite was replayed first against the unchanged integration
base: `# pass 3` / `# fail 8`. The byte-identical reviewed implementation then
produced `# pass 11` / `# fail 0`.

Fresh commands and actual output:

```text
npm run test:ux062
# pass 11
# fail 0
npm run test:intelligence
# pass 597
# fail 0
npm run test:insights
# pass 133
# fail 0
npm run typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
(exit 0)
bash scripts/agentic-validate.sh --tests 'test:ux062 test:intelligence test:insights'
Agentic validation gate passed.
Tests run: test:ux062 test:intelligence test:insights
```

Direct ESLint on all three changed components and the focused test exited 0.
The full gate ran lockfile validation, strict lint, all type checks, secret scan,
cross-agent configuration checks, docs/roadmap checks and the production build.
The build retains existing extensionless-import and bundler timing warnings;
none was suppressed. These results are fresh on the replayed source and current
security dependencies, not the original historical branch.

The unchanged canonical-main selector selects 59 scripts for the changed paths.
Its exported selection/runner functions are used with the current uncommitted
path inventory so the preparation cannot hide new files behind the old HEAD.
Main-selected scripts retain canonical-main command text; candidate additions are
additive. The first complete selected run reported:

```text
[integration-selected] 58 passed / 1 failed
[ 'test:mcp-untrusted' ]
```

The sole failure was missing local nested MCP dependencies, specifically
`ERR_MODULE_NOT_FOUND` for `@modelcontextprotocol/sdk` in the isolated stdio tests.
Its inner stages reported 24 pass / 0 fail and 18 pass / 2 fail. After verifying
exact `tools/mcp-server/package-lock.json` equality with the original
`roadmap-next-nov7` worktree, its existing nested dependency tree was symlinked
into this worktree. No code, test, lockfile or gate change was made.
`npm run test:mcp-untrusted` then exited 0 with actual inner summaries:

```text
untrusted stage 1: tests=24 pass=24 fail=0 status=0
untrusted stage 2: tests=23 pass=23 fail=0 status=0
# pass 1
# fail 0
```

The final two lines are outer orchestration counts, not additional behavior
coverage. All 59 selected scripts therefore have successful initial-replay-source
executions across the initial run and this isolated environment-repair rerun;
the initial failed run remains recorded. [Validation manifest](UX062-SAFE-VALIDATION.json)
retains all script results, commands, paths and log hashes.

After adding the evidence files, `npm run docs:check -- --changelog-advisory`
reported `[docs:check] Documentation appears fresh.` and `npm run secrets:scan`
reported `Secret scan passed for 6140 file(s).`, both exit 0. Fresh independent
review is pending. This local preparation is not a merge or install result.

Before the local preparation commit, `git fetch macos main` resolved canonical
main to `ffb3f3ccb4542de61d11ac0d5b7c452d82c20dda`, an ancestor of the requested
integration base. There was no rebase conflict or baseline substitution.

## Review repair cycle 1 — Non-element keyboard targets

Sonnet's nonblocking keyboard finding was confirmed against the real HUD handler:
its document keydown listener can receive a synthetic Document target, while a
Window-targeted event also reaches the callable handler. The new `closest()` call
threw for these targets where the previous tag-name checks did not. The only
production repair changes the target assertion/null check into an `Element`
guard; existing navigation, null-target handling, disclosure activation and
Escape/Tab behavior remain. No markup, label, scoring or provider code changed.

Three additional behavior fixtures exercise Document, Window and undispatched
keyboard events through the real navigation handler. Test-first execution was
`12 pass / 2 fail` with `target.closest is not a function`; repaired execution was
`14 pass / 0 fail`. Intelligence remained `597 pass / 0 fail`, insights
`133 pass / 0 fail`, and MCP untrusted inner stages passed `24/0` and `23/0`
(outer orchestration `1/0`). Typecheck and owned-file ESLint exited 0.

The fresh named gate exited 0:

```text
bash scripts/agentic-validate.sh --tests 'test:ux062 test:intelligence test:insights test:mcp-untrusted'
Agentic validation gate passed.
Tests run: test:ux062 test:intelligence test:insights test:mcp-untrusted
```

[Repair and mutation evidence](UX062-KEYBOARD-REPAIR.json) pins the clean source
commit and applied diff. Removing only the new Element guard changed
`14 pass / 0 fail` to `12 pass / 2 fail`, reproducing both target failures.
Restoring the guard returned `14 pass / 0 fail`, an empty `git status --short`,
and the original `shasum -a 256 src/components/AnalystHUD.ts` value:
`3146461b808c7ff21965e53dca0c25a558f1f59734562040e941ba75694217c3`.

The repeated “Unverified” disclosure names remain a nonblocking contextual
usability concern: their adjacent estimates and scoped native explanations
support the approved interaction, but an isolated controls list may omit that
context. Native spoken-output acceptance remains open in the MONITOR exit
condition. This repair does not claim the naming concern is disproven or fixed,
and does not expand the approved design. Fresh post-repair independent review
remains pending; this is the first repair cycle.

## Limits and rollback

The labels communicate absent matching baseline evidence without changing
probabilities, warnings, actions or empty states. Native disclosures retain
keyboard activation and focus handling. Existing explanations and wrapping remain
identical to the reviewed implementation; no ingestion, scoring, persistence,
network or provider behavior changes.

Full matched-cohort beats/trails, current comparator and freshness acceptance
remain OPEN. The roadmap uses MONITOR with Candidate #1886 evidence and
a November 29 review date. Its exit condition explicitly retains the full
baseline-comparison work and installed macOS keyboard/focus, explanation and
probability/warning/action preservation acceptance. MONITOR is not a claim that
the candidate has merged or that these remaining checks passed. Historical
isolated Chromium evidence is retained; fresh native and full-app acceptance
are separate. The known 375-pixel action-row clipping remains
as documented in the original paired baseline evidence.

Rollback reverts this UI/test slice only. No forecast data, models, storage or
security-baseline changes require rollback. Required exact-tip review, protected
CI and parent-controlled delivery remain prerequisites to integration.
