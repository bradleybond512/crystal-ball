# UX-046 alert capacity evidence

PR: #1734. Operator approval: September 22, 2026, after the concrete overflow
policy was presented. Implementation: `a1df052ffbd7057aef40f2f5c422c5bbca09e976`.
Base: `928696b02e3c80bd471318c2b90ae7a41ac117fd`.

## Behavior and scope

At the existing capacity enforcement points, keep at most 500 alerts. Evict
unpinned acknowledged alerts first, then unpinned unacknowledged alerts, then
pinned alerts regardless of acknowledgment. Within each group evict the oldest
source timestamp; equal timestamps retain stable Map insertion order, so the
earlier insertion is evicted first. Updating an existing ID preserves that
position and the user's acknowledgment/pin state. More than 500 pinned alerts
still require eviction of the oldest pinned entries.

Production changes are two comparator lines and their adjacent explanation in
`src/services/unified-alerts.ts`. The new public-store test suite is
`src/services/__tests__/unified-alerts-capacity.test.mts`, named by the
`test:alert-capacity` package script. No provider, inference, schema, archive,
notification, hydration, age-retention, or capacity-limit changes.

The tests run under Node 22 with in-memory localStorage and stubbed archive and
notification boundaries. They do not modify the installed profile or generate
real notifications. A fixed clock keeps fixtures within the existing age window.

## Executed checks

Commands use `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.

| Command | Actual output/result |
| --- | --- |
| `npm run test:alert-capacity` before the production edit | `# pass 5` / `# fail 6` |
| `npm run test:alert-capacity` after the edit | `# pass 11` / `# fail 0` |
| `npx tsx --test src/services/__tests__/unified-alerts-batching.test.mts` | `# pass 10` / `# fail 0` |
| `npm run test:warning-delivery` | `# pass 20` / `# fail 0` |
| `npm run typecheck:all` | `tsc --noEmit && tsc --noEmit -p tsconfig.api.json`, exit 0 |
| `npx eslint src/services/unified-alerts.ts src/services/__tests__/unified-alerts-capacity.test.mts` | No diagnostic output, exit 0 |
| `git diff --check` | No diagnostic output, exit 0 |
| `bash scripts/agentic-validate.sh --tests 'test:alert-capacity test:warning-delivery'` | `Agentic validation gate passed.` / `Tests run: test:alert-capacity test:warning-delivery`, exit 0 |

The gate ran the named tests, lockfile check, strict lint, both TypeScript
configurations, secret scan, cross-agent configuration check, documentation and
roadmap checks, and production build. Its cross-agent configuration check is not
a review verdict. Build output included ineffective dynamic-import and plugin
timing warnings; roadmap output retained overdue-review advisories. These were
not suppressed. CI remains the authority for its required matrix.

The original 502-alert regression retained all 500 acknowledged entries while
losing the pinned and unacknowledged entries. The repaired assertion retains the
pinned/unacknowledged IDs and removes the two oldest acknowledged IDs. Other
cases verify 501-item deferred enforcement, 1001-item immediate enforcement,
exact capacity, timestamp ordering in each group, all-pinned acknowledgment
independence, deterministic ties, same-ID update behavior, persistence/reload
identity/order/state, silent hydration, and archival of all incoming records even
when capacity removes one from the live store.

## Applied mutation proofs

The five comparator mutations started with an empty `git status --short` at the implementation
commit. An additional capacity-boundary mutation started clean at evidence tip
`b7b559ee6b6f6de14ff4afc892b200ffd3141836` in an isolated worktree. Each applied `git diff` was inspected before running
`npm run test:alert-capacity`. Only `src/services/unified-alerts.ts` was mutated.
Each mutation exited 1 with the following real test-runner counts:

| Mutation | Verified applied comparator change | Baseline → mutated counts | Failing behavior |
| --- | --- | --- | --- |
| pin | `a.pinned ? 1 : -1` → `a.pinned ? -1 : 1` | 11 pass / 0 fail → 8 pass / 3 fail | Mixed priorities, immediate enforcement, persisted retained IDs |
| ack | Unpinned acknowledgment return `-1 : 1` → `1 : -1` | 11 pass / 0 fail → 6 pass / 5 fail | Mixed priorities, deferred/immediate enforcement, persisted IDs, expected archived eviction |
| pinned-group | Remove `!a.pinned &&` from acknowledgment comparison | 11 pass / 0 fail → 10 pass / 1 fail | All-pinned oldest-by-source-time behavior regardless of acknowledgment |
| age | `a.timestamp - b.timestamp` → `b.timestamp - a.timestamp` | 11 pass / 0 fail → 3 pass / 8 fail | Oldest-first selection across all groups and retained IDs |
| ties | Append `|| -1` to timestamp comparison | 11 pass / 0 fail → 10 pass / 1 fail | Earlier equal-timestamp insertion is evicted after a same-ID update |
| boundary | `MAX_ALERTS = 500` → `MAX_ALERTS = 499` | 11 pass / 0 fail → 0 pass / 11 fail | Exact 500-entry input loses an entry; expected retained records differ |

Original and restored SHA-256 after every mutation:

```text
8a98c81a80f87aeda9975bb42dc92290b911b991e6905add725a23246ac9609c
```

Each restore returned to an empty `git status --short`. The final restored run
again reported `# pass 11` and `# fail 0` (exit 0). External evidence directory:
`/Users/bradleybond/.crystalball-diagnostics/ux046-20260922/`. It contains
`capacity-red.log`, `capacity-green.log`, `capacity-restored.log`,
`batching-green.log`, `warning-green.log`, `typecheck.log`, `eslint.log`,
`agentic-gate.log`, and `mutation-{pin,ack,pinned-group,age,ties}.{diff,log,json}`.
JSON records pin the tested commit, failure names, counts, checksums, and clean
restoration. `run-mutations.py` records the five comparator mutations and execution.
`mutation-boundary.diff`, `mutation-boundary.log` and
`mutation-boundary-restored.log` record the additional boundary proof: the
`exactly 500 fresh alerts survive capacity enforcement unchanged` assertion
failed with `Expected values to be strictly deep-equal`. Restoration matched
the same SHA-256 above, returned to clean status, and passed 11/0.

## Review, verification, and rollback limits

Independent review found zero blocking findings at `a6c41b60433687c30b50b77d40c3b52c1d1c151e`. Claude approved the same substantive change and subsequent main integration at `5ee3f0a550dc42f61e81ef11a49b11ff82c1698e`; actual conclusions are retained in the evidence directory. Further main integrations require a fresh pinned verdict before closeout. No native UI or installed-app test was performed. For a
manual check, use an isolated development profile: pin an alert, retain another
unacknowledged alert, populate fresh acknowledged alerts past capacity, then
confirm the first two survive a flush and reload. Do not use the normal profile
for destructive capacity fixtures.

The unchanged 48-hour source-age pruning remains UX-059. Ordinary ingestion can
exceed 500 until flush, and historical oversized hydration is outside this
change. The archive is still best effort, not guaranteed recovery. A reviewed
comparator revert rolls back this policy without migration; it cannot restore
alerts already evicted from memory/localStorage.
