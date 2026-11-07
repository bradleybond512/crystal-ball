# UX-035 — Two profiled presentation timers

Local implementation is validated at `c2d55f49a084cce9dca2af6155fcc07d034bf820`. Draft [#1859](https://github.com/bradleybond512/crystal-ball/pull/1859) still contains only the approved design claim until a separately approved code push. Installation, releases, merging, auto-merge and delivery remain paused. Broader UX-035 application acceptance remains open.

## Behavior and scope

Alert Fatigue and Correlation Map now defer periodic display computation while offscreen, document-hidden or disabled. Repeated requests coalesce into one callback that reads current stores when eligible again. Constructors, 30-second cadence, data acquisition, scoring, safety monitoring and notification dispatch are unchanged.

`Panel.ts` adds an instance opt-in using the existing callback slot, observer and visibility hooks. Eligibility checks current document visibility, explicit hiding, first observation/intersection and destruction. Resume drains once on eligible IO, foreground or show; late destroyed callbacks cannot execute. Without IntersectionObserver, foreground/non-hidden refreshes remain enabled. The two subclasses opt in and wrap their existing timer callbacks. Existing helper behavior for all other panels remains unchanged, including diagnostic acquisition callers. No dependency, persisted-schema, native-permission or CI-workflow change was made.

The complete connected roadmap snapshot contained 63 references and 102 PRs, no blockers, and selected UX-035 [B] after accounting for higher-priority claims. The validation gate's unconnected local roadmap output does not establish ownership; the connected snapshot and explicit approved design do. This PR claims only UX-035.

## Measured presentation work

Three matched baseline and three final Node 22 profiles used actual whole classes and cached store/view helpers: 1,000 alert records, 1,000 observations, 100 chains and 500 pairs, with 30 displayed. Each stage manually invoked 200 actual timer callbacks with identical fixed fixtures. Constructor and resume work were counted separately.

| Per panel, each run | Baseline builds | Final builds |
|---|---:|---:|
| Constructor | 1 | 1 |
| 200 visible callbacks | 200 | 200 |
| 200 offscreen callbacks | 200 | 0 |
| 200 hidden-document callbacks | 200 | 0 |
| 200 disabled callbacks | 200 | 0 |
| Eligible queued recovery | — | 1 |
| 200 resumed callbacks | 200 | 200 |

See `UX035-PROFILE.json` for all six raw runs, timings, source hashes, workload and separate transition counts. The disabled-stage setup includes a foreground drain before hide; that one transition build is separate from zero disabled timer builds. Counts establish avoided computation, not an app-wide CPU or battery improvement. These are small bounded display costs at a 30-second cadence. Happy DOM/VM, instrumentation, fixed fixtures, no layout/paint and no OS throttling limit timing inference.

## Actual validation

Initial test-first run: `node --test --test-reporter=spec tests/panel-presentation.test.mjs`:

```text
ℹ pass 3
ℹ fail 15
```

After implementation and three additional error-isolation tests, the same direct suite:

```text
ℹ pass 21
ℹ fail 0
```

`bash scripts/agentic-validate.sh --tests 'test:panel-presentation test:alert-fatigue-dashboard test:emergency-readiness'` included type checks, lint, secret scans, docs and build. The named presentation script includes the new lifecycle suite and existing visibility/correlation fixtures. Actual respective test summaries:

```text
# pass 41
# fail 0
# pass 45
# fail 0
# pass 36
# fail 0
Agentic validation gate passed.
```

Direct three-file ESLint and `npm run typecheck:all` exited 0. Canonical-main's trusted selector (`node <evidence-directory>/trusted-ci.mjs --ci`) ran on the clean implementation commit:

```text
[targeted-tests] 45 script(s) passed.
```

The gate and selected-suite results apply to the frozen production/tests commit above. Later evidence-only documentation is not relabeled as a new execution. Raw commands/logs remain in `~/.codex/visualizations/2026/11/01/01a198d2-bc4c-72e3-b3e6-09b3625b5098/ux035/`, including `tests-red.log`, `tests-green.log`, `gate.log` and `selected-ci.log`.

## Mutation proof

`UX035-MUTATIONS.json` includes all 21 applied diffs, their hashes, per-file before/restored checksums and actual counts. `UX035-MUTATION-ASSERTIONS.txt` contains the failing assertions. Every run began and ended clean in a detached proof tree; final restored run was `21 pass / 0 fail`.

Nineteen behavior mutations were killed, producing 73 failed subtests. Four failures were deliberately throwing callbacks executed by incorrectly removed eligibility guards; all 19 mutants also had assertion failures. No syntax or setup failures are credited. Examples (`pass/fail`): each timer bypass `21/0 → 17/4`; document guard `21/0 → 11/10`; first-observation guard `21/0 → 20/1`; foreground drain `21/0 → 12/9`; latest-wins `21/0 → 19/2`; error isolation `21/0 → 18/3`.

Two isolated redundant destruction guards survived (`21/0`): the eligibility alive check and IO early return. Surrounding direct request guards and cleared pending work still prevent execution. These are disclosed equivalents, not credited kills or independent proof of those lines. No production changes were made to manufacture a failure.

## Browser evidence and review

`UX035-BROWSER.json` records Chromium 147.0.7727.15 against isolated bundled actual modules. Real DOM/IntersectionObserver scrolling suppresses offscreen builds and drains once on return. Hide/show, delegated correlation expansion and keyboard Tab to existing header controls remain functional. A narrow fixture viewport has no horizontal overflow. Browser errors and external network attempts were empty; no full application or native runtime was launched.

Actual tab switching in this environment did not change document visibility. Hidden/foreground evidence therefore uses explicitly controlled visibility-event replay in the real browser. Timer invocation is manual. This is not installed WKWebView, real OS background acceptance or full-app styling verification; those limits remain open.

Independent GPT-6.1 Sol review found no source or evidence blocker, independently ran `41 pass / 0 fail`, inspected connected cached-reader paths and legacy behavior, and verified all mutation/profile/browser records against source hashes. The required final Sonnet review and SHA-pinned verdict remain the publication gate; the verdict commit records that exact reviewed parent. No repair cycle was needed for production behavior.

## Remaining acceptance and rollback

After separately authorized delivery, manually verify actual macOS background/foreground, scrolling and settings disable/re-enable in the installed app, including current data and warning-monitoring continuity. Do not perform installation or production-data operations while paused. Additional panels require their own profiling and dependency audit; this two-panel slice does not complete application-wide UX-035.

Rollback reverts the option and two timer wrappers, restoring previous presentation cadence. Revert the full slice to remove the unused option/tests. No data migration or forecast/store rollback is required.

Proposed commit: `Avoid rebuilding hidden views without pausing intelligence`.

Draft PR description: Two profiled panels rebuilt views on every timer tick even while invisible. Add an isolated opt-in to defer their presentation work and refresh current state once on return, preserving constructors and all acquisition/safety dependencies. Three matched profiles reduce invisible builds from 200 to zero; 45 selected suites, the validation gate, 19 killed behavior mutants and isolated Chromium checks passed. Native background and broader application acceptance remain open. Installation, auto-merge and delivery stay paused.
