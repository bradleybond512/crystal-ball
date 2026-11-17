# UX-043 — bounded correlation subscriber efficiency

November 17, 2026. Draft #1914. Implemented and validated source:
`7e34a6c4ee3e3cf59e0c5c8266b2c8f9708dd4d3`.

## Result and scope

The approved slice replaces repeated alert-store scans in the correlation-feedback
subscriber with one callback-local lookup. The original alert references, scan
order, acknowledgment-before-pin processing, equations, thresholds, persistence
format and delivery policy remain unchanged. Full UX-043 stays IN PROGRESS:
broader subscriber contracts and application-wide fan-out acceptance remain open.
No live application, user data, credentials or native execution was used.
Merging, auto-merge, releases, deployment and installation remain paused.

Only production file `src/services/correlation-feedback.ts` changes: one local
Map populated during the existing correlation-alert scan, then two ID lookups.
It is discarded after each callback; no shared snapshot or cross-delivery cache.
Fixtures in `tests/helpers/correlation-feedback-fixture.mts` use fresh worker
processes, real store/feedback modules and fake storage, clock, archive and
notification effects. Network fetch is forbidden. The focused test file is
`src/services/__tests__/correlation-feedback-subscriber.test.mts`; measurement
entry point is `scripts/measure-alert-feedback.mts`. Package and targeted mappings
wire this coverage into `test:ux043`. No dependency or lockfile changed.

## Measured baseline and candidate

Both use Node 22.23.1 / V8 12.4.254.21-node.56, macOS arm64, synthetic full store
of 500 alerts. Baseline source `02dbd2bcc6ca8b96cbe6f8c4cd3637e814dfb2f9`
retains the original production callback. The expanded fixture was replayed on
that source in a detached checkout. Callback-specific reads are counted separately
from two observer subscribers; setup reads are excluded from delivery counts.

| Simultaneous acknowledgment/pin transitions | Callback getAll calls, before → after | Array references, before → after | Fixture fan-out getAll calls, before → after |
| --- | --- | --- | --- |
| 0 | 1 → 1 | 500 → 500 | 3 → 3 |
| 1 | 3 → 1 | 1500 → 500 | 5 → 3 |
| 500 | 1001 → 1 | 500500 → 500 | 1003 → 3 |

The candidate still builds a bounded index; the table counts getAll arrays and
references, not all allocations or bytes. Statistics, multipliers and saves
match exactly: zero transitions gives no statistics/write and multiplier 1;
one gives ack/fastAck/pinned = 1/1/1, one write and multiplier 1; 500 gives
500/500/500, one write and multiplier 0.6. Broader replay has exact stable-field
parity across six scenarios and 27 steps, including serialized statistics,
storage, alert state/order, restart and observer behavior. Wall times are retained
as supplementary instrumented samples, not a statistical speed or energy claim.

## Actual validation

Initial detecting tests against the original code:

```text
# tests 3
# pass 1
# fail 2
```

The two failures were the one-scan assertions: actual 3 and 1001 versus expected 1.
After the production change the initial three passed. Expanded focused suite:
9 pass / 0 fail. Combined `npm run test:ux043`: actual `# pass 79`, `# fail 0`.

Executed full gate:

```sh
bash scripts/agentic-validate.sh --tests "test:ux043 test:acc505 test:correlation test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller"
```

Actual excerpts in script order:

```text
# pass 79
# fail 0
# pass 23
# fail 0
# pass 476
# fail 0
# pass 85
# fail 0
# pass 16
# fail 0
# pass 2
# fail 0
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:ux043 test:acc505 test:correlation test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller
```

The two domain-retirement tests are outer orchestration results; child output is
retained in the raw log. All type configurations, lockfile checks, strict lint,
secret scans, agent checks, documentation and build passed. Existing build timing,
chunk and dynamic-import warnings remain; no check was weakened. Scoped production
ESLint passed. The existing ESLint config ignores the measurement `.mts` script
(one warning); no lint coverage is claimed for it. The actual measurement CLI ran
on baseline and candidate. Final strict selection listed 52 suites including
UX-043, ACC-505 and correlation; the seven named suites were run locally, not all 52.

`npm run bench:correlation` ran before and after without reseeding or changing
benchmark data. Both actual outputs ended:

```text
PASS — within tolerance of committed baseline (src/services/correlation/__bench__/bench-correlation-baseline.json).
```

The frozen benchmark covers 11 streams / 504 observations: six planted couplings
and 22 emitted pairs, each with 100% precision/recall in this fixture. This is a
regression safeguard, not evidence of improved production accuracy.

## Applied mutation proofs

All proofs start from clean source `7e34a6c4ee` in a disposable checkout. The
candidate tree was never mutated. Each applied diff, red assertion/log, restored
checksum and clean status is preserved. Counts below are pass/fail.

| Mutation in correlation-feedback.ts | Before | Mutated |
| --- | --- | --- |
| restore-ack-full-scan | 9/0 | 2/7 |
| restore-pin-full-scan | 9/0 | 3/6 |
| ack-deduplication | 9/0 | 5/4 |
| pin-deduplication | 9/0 | 7/2 |
| lost-ack-transition | 9/0 | 1/8 |
| lost-pin-transition | 9/0 | 3/6 |
| fast-ack-strict-boundary | 9/0 | 8/1 |
| stale-cross-delivery-index | 9/0 | 7/2 |
| first-seen-removal-cleanup | 9/0 | 8/1 |
| pin-before-ack-order | 9/0 | 8/1 |
| pair-key-order | 9/0 | 1/8 |
| absent-pair-rejection | 9/0 | 7/2 |

All 12 controls were detected; zero survivors. Final restored output: 9 pass /
0 fail. Every restored source checksum matches the before checksum:

```text
040670ae9a7eb7eede6f4c3f6c1e1110bad64c29818f8fa8ccce9e56be16de45
```

Representative actual failing assertions:

```text
not ok 2 - full500 delivery with 1 ack/pin transitions uses one feedback scan
not ok 6 - fast acknowledgment is strictly before10000ms and multiplier bounds remain unchanged
not ok 7 - real retention removal and reintroduction reset the first-seen acknowledgment window
```

## Reviews, CI and remaining acceptance

Independent Sol and actual Sonnet must review the completed evidence before the
final exact-tip verdict and code-publication request. Conclusions are retained
separately to avoid changing the reviewed source after approval. The documentation
claim passed both reviews. Its first Sonnet run stalled loading a helper and was
terminated; the retry failed from context thrashing. A compact direct Sonnet
review succeeded; failures were not represented as approvals.

Published documentation claim `02dbd2bcc6` completed 13/14 workflows. Security
Audit alone failed on unchanged marketing `react-server-dom-webpack` (one critical;
other five npm projects have zero high/critical). The separate repair remains
outside this PR. Implementation CI awaits separately approved code publication.

Full subscriber optimization remains open. No application-wide CPU, energy,
warning latency, installed-app behavior or live prediction gain was established.

## Reproduce, rollback and proposed publication

Run `npm run test:ux043`, then `node --import tsx scripts/measure-alert-feedback.mts`.
Inspect per-callback counts, stable serialized behavior and fixture limitations.
Do not launch the installed app or touch live storage for this fixture check.
Rollback restores the original callback; no migration or data conversion exists.

Proposed commit purpose: keep feedback lookup work linear per delivery.
Proposed PR summary: preserve correlation-learning behavior while replacing
per-transition full-store scans with one local index; prove exact fixture parity
and measured read-count reduction, retaining full UX-043 and delivery holds.

Raw evidence is retained under local task artifacts `next-nov17/ux043/`:
`first-red.log`, baseline/candidate initial and expanded JSON, `behavior-parity.json`,
`focused-expanded.log`, `integrated-tests.log`, `final-gate.log`, both frozen benchmark
logs, `selected-suites.log`, `claim-ci.json`, and `mutations/results.json` with every
applied `.diff`, actual red log and restored-green log. No test outcome is inferred
from source inspection alone.
