# PR #1730 browser validation

Original production validation head: `8afa30f88` in isolated detached worktree `merge-review-1730-20260922`. Regression artifacts were committed at `b01de4f4b` and integrated at `c3e0858a6`; final review is pinned by the separate verdict commit. The production source hashes below are unchanged.
The existing presentation changes are unchanged. The regression harness is now checked in at `e2e/summary-strip-layout.mjs` and runs as `npm run test:summary-strip-layout`. The existing Accessibility workflow runs it after installing Chromium. It is deliberately outside the unit-test selector, whose contract excludes browser runners. No gate or assertion was weakened.

## Commands and actual output

From the PR worktree:

```sh
npm run test:summary-strip-layout
```

The original external harness and the checked-in harness both returned the following output (exit 0):

```text
GEOMETRY {"summary":{"top":68,"bottom":98,"height":30,"left":0,"right":1000},"stack":{"top":32,"bottom":68,"height":36,"left":0,"right":1000}}
PASS summary remains adjacent to stack at deep scroll
PASS posture occupies first measured row and removal reclaims space
PASS breaking alert sits immediately below posture and remaining stack
PASS posture dismissal frees stack height
PASS data center is compact, truncates long text and opens
PASS data center normal, warning, degraded and reduced-motion transitions
PASS posture text wrapping keeps following breaking alert attached
PASS mobile posture transition removes existing banner without leaving reserved height
RESULT 8 pass / 0 fail
```

```sh
npm run typecheck:all
```

Exit 0, actual output:

```text
> crystal-ball@2.25.147 typecheck:all
> tsc --noEmit && tsc --noEmit -p tsconfig.api.json
```

## Mutation evidence

Command:

```sh
python3 /Users/bradleybond/.crystalball-diagnostics/pr1730-merge-20260922/run-mutations.py
```

Each mutation started with empty `git status --short`. Script asserted replacement changed bytes, saved and printed the actual `git diff`, ran the browser tests, restored every production file in `finally`, and verified identical SHA256 hashes and empty status.

| Mutation | Baseline | Mutated | Actual failing assertion |
| --- | --- | --- | --- |
| summary sticky offset reverted | 8 pass / 0 fail | 7 pass / 1 fail | `summary top 104 != stack bottom 68` |
| posture mount and fixed-position CSS reverted | 8 pass / 0 fail | 7 pass / 1 fail | First stack child was not `critical-posture-banner severity-critical` |
| breaking banner double count restored | 8 pass / 0 fail | 6 pass / 2 fail | `breaking top 172 != stack bottom 120`; wrapped `1078 != 573` |
| data center styles removed | 8 pass / 0 fail | 6 pass / 2 fail | display `block` vs `flex`; animation `none` vs `dc-strip-pulse` |

Applied diffs: `mutation-summary-offset.diff`, `mutation-posture-stack.diff`, `mutation-breaking-double-count.diff`, `mutation-datacenter-styles.diff`. Complete raw results are adjacent `.log` files and `mutations.log`.

Restored SHA256:

```text
c2fbf637e3e77e600082459af502422fc35fccd6d97de86ee1f160ca575051ab  src/styles/main.css
b8bd62784e6eda6ff7490cbc6c26bf36d63c33c2d678c53c2b9c243323de44c5  src/app/panel-layout.ts
9d470efa172615be307849ac11f9c74d204dcfb70f89382b42acbd08d522168e  src/components/BreakingNewsBanner.ts
```

## Scope and limitations

This is component-level Chromium browser evidence, not an installed macOS/WebKit or full application run. The harness bundles real NotificationStack, BreakingNewsBanner, DataCenterPinnedStrip, datacenter-view, DOM helpers, and full main.css. TypeScript AST extracts and executes the unchanged real `PanelLayoutManager.renderCriticalBanner` method in a minimal class, avoiding unrelated panel/provider bootstrapping. This validates the actual changed method body, but not its production call order or full class initialization. SummaryStrip markup is a fixture using its production class; only its CSS changed, apart from a comment. The fixture provides a controlled scroll shell, 36 px preexisting stack row, map spacer, and panel spacer. No styles are substituted for the affected production selectors.

Store input delivery, translation strings, disabled sound settings, and analytics are boundary stubs. Layout, ResizeObserver, MutationObserver, DOM events, click handlers, content rendering, CSS media queries, and scrolling are real browser behavior. No new dependencies are required. The checked-in harness accepts a repository path argument or the current working directory and resolves dependencies from that repo. It uses the real shared HTML-escaping helper, fails on uncaught browser errors, closes resources in `finally`, and waits for animation frames instead of fixed sleeps.

The checked-in browser tests assert that no page errors occurred; no full-app startup, native chrome, WebKit, live data, or visual golden suite was run in this delegated task. Those remain parent/release responsibilities. Parent independent review decides overall PR readiness. Native manual smoke should exercise banners appearing/removing above a scrolled panels grid and reduced-motion warning strip. Rollback of these presentation changes is a code revert; no data migration exists.

## Delivery validation

The regression harness was formatted with existing Prettier and checked with `node scripts/run-eslint.mjs e2e/summary-strip-layout.mjs` (exit 0). The final targeted run and type checks are recorded above. Chromium must be installed first on a fresh machine: `npx playwright install chromium`. No new dependency was added.

The full gate was also executed:

```sh
bash scripts/agentic-validate.sh --tests test:summary-strip-layout
```

Exit 0; concluding output:

```text
Agentic validation gate passed.
Tests run: test:summary-strip-layout
This gate does NOT prove a new test fails without its fix — attach a mutation proof (AGENTS.md).
```

This ran the eight browser cases, lockfile check, strict lint, typecheck:all,
secret scan, cross-agent configuration check, docs/roadmap checks, and build.
The cross-agent configuration check is not the final independent PR review.
Existing docs/roadmap overdue-review advisories and the build's plugin timing
warning remained nonblocking. Full raw local output is saved in
`~/.crystalball-diagnostics/pr1730-merge-20260922/agentic-gate.log`.
