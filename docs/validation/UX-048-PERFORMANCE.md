# UX-048 delivery: alert burst performance repair

GDACS PR #1740 initially failed the existing 5,000-alert smoke budget twice, at 666 and 706 ms against an unchanged 500 ms limit. All other final checks passed. No third unchanged CI retry was attempted.

## Scope and authority

User authorization to fix delivery blockers covers this bounded correction following repository discovery and architect review. Identity, eviction, warning, retention and notification policy remain unchanged. This is a follow-up performance correction to ACC-509, not a new prediction algorithm.

`alert-identity.ts` collects eligible eviction candidates directly instead of spreading and filtering every stored entry. The exact protected/existing exclusions, receipt/key comparator, staged accounting and atomic failure remain. Overflow still scans the ledger; no unsafe protected-set-size shortcut is used.

`unified-alerts.ts` refreshes the ledger value only after duplicate admission. Accepted admissions already store that same complete state. Duplicate state refresh, warning eligibility, protection and persistence-before-dispatch remain.

Four new focused regressions cover accepted/revised and duplicate persisted state, multi-victim receipt/key ordering and atomic byte-capacity rejection. No schema, dependency, privilege, limit, CI concurrency or performance assertion changed.

## Validation

Initial test-first run: `# pass 12` / `# fail 1`, with `1 !== 0` for redundant accepted-admission updates. Repaired focused run: `# pass 37` / `# fail 0`.

`bash scripts/agentic-validate.sh --tests 'test:acc509 test:ux059 test:alert-capacity test:warning-delivery test:gdacs-map'` exited 0:

```text
# pass 107
# fail 0
# pass 32
# fail 0
# pass 11
# fail 0
# pass 20
# fail 0
# pass 41
# fail 0
Agentic validation gate passed.
```

Total 211 pass / 0 fail, including full type checks, strict lint, secret scan, documentation, roadmap and production build. `npm run test:renderer` exited 0 with the following actual output:

```text
# tests 15087
# pass 15087
# fail 0
# skipped 0
# duration_ms 53466.548875
```

The unchanged 5,000-alert case took 255.689917 ms in that full run. Bundle policies also passed. Independent review audited the four-file code/test diff, all six applied proofs and timing distribution with no blocking code findings. Fresh actual Claude review and required CI remain delivery gates.

## Measured performance

Five alternating runs per variant used Node 22 and the unchanged 5,000-alert test in one clean dedicated worktree, with no other task test commands running. The original code and allocation-only reversion were actually applied and diff-recorded; both production files restored byte-identically and the tree remained clean.

| Variant | Median test duration | Range |
| --- | ---: | ---: |
| Original implementation | 255.57 ms | 248.90–271.18 ms |
| Both repairs | 194.90 ms | 193.49–198.61 ms |
| Allocation cleanup reverted, accepted-update repair retained | 229.69 ms | 224.96–243.15 ms |

Median improvement was 23.7%. These local distributions do not guarantee hosted CI latency. The allocation-only change preserves functional semantics; it is supported by comparative timings, not falsely claimed as a functional mutation kill. CPU profiles and raw benchmark logs are retained locally.

## Applied mutation proof

[Six portable proof records](UX-048-PERFORMANCE-MUTATIONS.json) pin code/test candidate `0ed318506`, include actual applied diffs and assertions, and preserve original/restored SHA256 values. Cases: redundant accepted update, missing duplicate update, protected eviction, receipt ordering, key tie ordering and atomic rejection.

Each case: `1 pass / 0 fail` → `0 pass / 1 fail` → `1 pass / 0 fail`. Aggregate repeated executions: 6/0 → 0/6 → 6/0. All six were assertion-killed; all restored checksums matched and every worktree was clean.

## Delivery, limits and rollback

PR #1740 stays draft until fresh review and required CI pass. The former GDACS verdict predates these changes and cannot authorize the new tip. No native app installation or manual installed-app check was performed. Manually verify acknowledgment, pin and snooze across repeated alerts and restart after delivery. Rollback is a reviewed revert of performance commit `0ed318506`; persisted identity format remains compatible.

Raw evidence: `~/.crystalball-diagnostics/alert-performance-20260926/`.
