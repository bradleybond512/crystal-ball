# RC-1 priority-aware task selection validation

RC-1 adds priority parsing and selection to the roadmap controller. Missing
`Priority:` means `C`; present values are trimmed and uppercased, and only
`S`, `A`, `B` and `C` are accepted. Invalid or explicitly empty values block
reconciliation. Selection keeps the existing eligibility filter, then orders
eligible tasks by tier, UX before ACC within a tier, and ascending task ID.
Advisory and watchdog output include the selected tier.

Only the controller, its tests, this evidence document and RC-1's queue
status/PR number are in scope. The two live boards, terminal-fact comparison,
workflows, dependencies, runtime, native code and release configuration retain
their existing content. Other RCs and the proposal's remaining decisions are
pending.

Validation on October 16, 2026 used Node v22.23.1. The implementation candidate
was `223aa6b09a08ad49f5da7cd20d2291fae3e6cec9`, based on main
`0672b39272eb93cfed81c47b0faeec901e3279e6`. Its source and test blobs are retained
unchanged by the queue/evidence bookkeeping commit.

- `npm run test:roadmap-controller`: **36 pass / 0 fail**, including nine new
  behavior tests. The baseline had **27 pass / 0 fail**. An independent local
  test agent reran the candidate suite with **36 pass / 0 fail**.
- `npm run roadmap:check`: exit 0 with no blocking errors. On the unchanged
  boards, UX-014 remains next, now with `[C]`. Counts and all 16 existing overdue
  advisories match the baseline; this PR does not perform RC-2 triage.
- `bash scripts/agentic-validate.sh --tests "test:roadmap-controller"`: exit 0,
  including the focused suite, lockfile integrity, strict structural lint,
  color baseline, both TypeScript configurations, secret scanning, cross-agent
  wiring, documentation freshness, roadmap validation and web build.
- The implementation commit passed ordinary local hooks: conflict scan,
  staged secret scan, both TypeScript configurations and ESLint. Existing
  build warnings did not fail validation; no gate or assertion was weakened.

Every mutation below started from a clean tree. The applied nonempty diff and
actual failing assertions were inspected. After each run, the original source
SHA-256 was restored and the tree was clean. Each row starts at **36 pass /
0 fail**; the full validation gate passed again after all mutations.

| Applied mutation | Observed pass | Observed fail |
| --- | ---: | ---: |
| Revert the whole feature | 28 | 8 |
| Default missing priority to B | 33 | 3 |
| Remove uppercase normalization | 35 | 1 |
| Treat blank priority as missing | 34 | 2 |
| Remove priority validation | 34 | 2 |
| Reverse priority tiers | 30 | 6 |
| Reverse UX/ACC preference | 30 | 6 |
| Reverse the final ID comparator | 35 | 1 |
| Remove advisory tier | 35 | 1 |
| Remove watchdog tier | 35 | 1 |
| Ignore all dependencies | 34 | 2 |
| Ignore open claims | 34 | 2 |

The final ID-comparator mutation fails the test that sends deliberately
unordered headings, tracker rows and mirrors through parsing and
reconciliation. It verifies the actual final tie-break, including after
earlier transformations have sorted by ID.

Restored controller SHA-256:
`ac07892e519e19a9a134f60a3a3f5c93fb31a1006705b839063d47b2b769f355`.
Test SHA-256:
`03e75bfa97bd25c26dbff3036fce2b96278850d22c2ef7aa037474c7351e64a8`.

The required final Sonnet medium review must cover the complete queue/evidence
head. Its actual conclusion and exact reviewed SHA belong in the subsequent
verdict-only commit and PR body. Local test and integration checks are not
independent review approval. No native acceptance testing is claimed for this
controller-only change.
