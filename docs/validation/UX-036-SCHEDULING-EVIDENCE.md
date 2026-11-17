# UX-036 — scheduler and battery fixture evidence

Date: November 16, 2026. Draft #1912. Test/measurement implementation source:
`15cfdf31bbeb77c0e12d7d328a39352970f9da03`; final test-only strengthening:
`5a9bf5d2f2bb1304219cdfe0526f56b517401766`.

## Result and remaining acceptance

The approved first stage measures the real RefreshScheduler with deterministic
fixtures and tests real battery-event wiring against fake browser APIs. Production
scheduler, cadence, registrations, providers and notification behavior are
unchanged. No installed application, real battery/user data, native service or
network provider was accessed. No dependencies or lockfiles changed.

Full UX-036 stays IN PROGRESS: actual synchronized refresh cost, a justified
runtime staggering change, live power savings, browser/WebKit battery support
and packaged warning latency remain unverified. Merging, auto-merge, releases,
deployment and installation remain paused.

## Files and architecture

- `tests/helpers/refresh-scheduler-clock.mjs`: chronological virtual timers,
  deterministic randomness, bounded callback/trace budgets, 32 microtask
  checkpoints per timing boundary, real scheduler imports, synthetic loaders,
  fake battery events, full ambient descriptor restoration and trace summaries.
- `tests/refresh-scheduler-characterization.test.mts`: actual registrations,
  jitter/floor, completion-based rearming, conditions/in-flight guards, backoff,
  pending/running policy transitions, hidden pause, recovery priority/slots,
  successful-run freshness, destruction, measurement arithmetic/replay/CLI.
- `src/services/__tests__/adaptive-cadence.test.mts`: preserves the original five
  policy cases and adds actual initial battery sampling, charging transitions,
  unavailable API and rejected-promise cases with isolated global restoration.
- `scripts/measure-refresh-scheduling.mts`: bounded fixture-only JSON report with
  36 scenarios. `package.json` adds one test command; exact targeted-test mappings
  connect fixture/report and production scheduler/cadence paths to that command.

[Approved design](../plans/2026-11-16-ux036-scheduling-evidence-design.md).
The caller must set `ctx.isDestroyed` before teardown of active loaders; fixtures
model that existing caller lifecycle, rather than altering scheduler ownership.

## Executed validation

Node 22.23.1. Existing four-file baseline: `# pass 41` / `# fail 0`.
Complete repaired gate at `15cfdf31bb`:

```sh
bash scripts/agentic-validate.sh --tests "test:ux036 test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller"
```

Actual output excerpts, in command order:

```text
# pass 62
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
Tests run: test:ux036 test:agentic-pipeline test:sidecar-ci test:domain-retirement test:roadmap-controller
```

The two domain-retirement results are outer orchestration tests; raw child output
is preserved. All type checks, lockfile checks, strict lint, secret scanning,
agent configuration, documentation, roadmap and build exited 0. Build retained
existing import/chunk warnings and reported callback timings; no check was weakened.
Scoped ESLint exited 0 with zero errors, but the existing config ignores the new
measurement `.mts` script (one warning); no lint coverage is claimed for that
script. Its actual export, CLI output and invalid arguments are exercised.

An earlier parallel gate was deliberately interrupted at typecheck (exit 143)
to reduce machine contention. It is not counted as a passing gate; the complete
serial rerun above passed. Commit hooks also passed all type checks and scans.
The final test-only combined-failure strengthening also passed `test:ux036`
62/0 and all type checks in its commit hook. Initial new characterization was already green; the applied mutations below,
not a claimed first-red development order, establish detection.

`node scripts/targeted-tests.mjs --list --strict` exited 0: 50 scripts selected,
including `test:ux036`, with no unmapped source gap. Only the five named scripts
were run locally; broader hosted acceptance awaits separately approved code push.

## Reproducible synthetic measurements

Command, run independently twice with identical output:

```sh
node --import tsx scripts/measure-refresh-scheduling.mts
```

Seed 36, two-hour virtual horizon, 36 scenarios: equal and mixed intervals,
AC/battery/low-power/Ghost, immediate/2500-ms/unchanged/failing loaders,
lower/mid/upper jitter boundaries and hidden/resume. All 36 reports had
`pendingTimers: 0` and `active: 0` after cleanup. SHA-256 of both JSON outputs:

```text
457d9f82d2dea1519c56efb233dedb4ef6e30f7ec5a9c2f1d2a87326c2cc01b8
```

For twelve equal one-minute jobs with immediate successful loaders:

| Policy | Starts in two hours | Max starts/150 ms | Max starts/1000 ms |
| --- | ---: | ---: | ---: |
| AC | 1433 | 2 | 4 |
| Battery | 715 | 2 | 3 |
| Low power | 354 | 2 | 2 |
| Ghost | 283 | 2 | 2 |

Constant lower/mid/upper randomness each produced bursts of 12 in the same
one-millisecond window, versus 1 for the seeded AC trace. This characterizes
existing jitter; it is not a new performance improvement or a guaranteed cap.
The seeded slow-loader AC case reached modeled concurrency 5. The hidden/resume
case reached 6, while a separate steady-state test admits eight blocked loaders:
the six-slot bound governs recovery admission only, not all traffic.

Windows are half-open `[start, start + width)`. Every registered job is present,
including zero-start jobs. Maximum start gap is null below two observations.
Loader duration adds to start gaps; policy changes do not rewrite already armed
timers. Hidden callbacks pause even with always-on enabled. These are measured
fixture properties, not warning-detection, event-loop, CPU or energy guarantees.
The fake clock uses 32 microtask checkpoints and does not model browser throttling.

## Review repair and applied mutation proof

Independent Sol review at `89a14e4a74` found one P2 fixture bug: exhausting the
trace budget could make cancellation throw before globals were restored, and a
related path could strand an owned loader. No production module was affected.
Repair cycle 1 moved setup and teardown restoration into unconditional cleanup,
settles owned loaders, clears owned timers and retains/report original errors.
Normal residual-timer metrics are observed before forced cleanup, preserving
cancellation-failure detection.

Actual new regression output on old/fixed helper:

```text
# pass 0
# fail 3
# pass 3
# fail 0
```

A fourth canary verifies that a residual timer reports 1 before forced cleanup
clears it to 0. The original 31 controls were rerun on clean repaired source
`15cfdf31bb`: all caught, baseline/restored `26 pass / 0 fail`. Counts below are
pass/fail; every mutation has an inspected applied diff, actual failing assertions,
matching restored hashes and a clean scratch tree.

| Mutation | Mutated file | Before | Mutated |
| --- | --- | --- | --- |
| `jitter-removed` | refresh-scheduler.ts | 26/0 | 24/2 |
| `minimum-delay` | refresh-scheduler.ts | 26/0 | 25/1 |
| `hidden-multiplier` | refresh-scheduler.ts | 26/0 | 25/1 |
| `ghost-policy` | refresh-scheduler.ts | 26/0 | 25/1 |
| `context-policy` | refresh-scheduler.ts | 26/0 | 24/2 |
| `hidden-pause` | refresh-scheduler.ts | 26/0 | 24/2 |
| `condition-refusal` | refresh-scheduler.ts | 26/0 | 25/1 |
| `in-flight-refusal` | refresh-scheduler.ts | 26/0 | 25/1 |
| `completion-rearming` | refresh-scheduler.ts | 26/0 | 21/5 |
| `unchanged-backoff` | refresh-scheduler.ts | 26/0 | 25/1 |
| `failure-backoff` | refresh-scheduler.ts | 26/0 | 24/2 |
| `backoff-cap` | refresh-scheduler.ts | 26/0 | 25/1 |
| `successful-reset` | refresh-scheduler.ts | 26/0 | 25/1 |
| `in-flight-release` | refresh-scheduler.ts | 26/0 | 22/4 |
| `success-freshness` | refresh-scheduler.ts | 26/0 | 25/1 |
| `recovery-deduplication` | refresh-scheduler.ts | 26/0 | 25/1 |
| `recovery-stale-timer-cancel` | refresh-scheduler.ts | 26/0 | 24/2 |
| `recovery-priority` | refresh-scheduler.ts | 26/0 | 25/1 |
| `recovery-stagger` | refresh-scheduler.ts | 26/0 | 25/1 |
| `recovery-six-slots` | refresh-scheduler.ts | 26/0 | 25/1 |
| `recovery-base-freshness` | refresh-scheduler.ts | 26/0 | 24/2 |
| `destroy-cancels` | refresh-scheduler.ts | 26/0 | 22/4 |
| `destroy-blocks-rearming` | refresh-scheduler.ts | 26/0 | 23/3 |
| `battery-polarity` | adaptive-cadence.ts | 26/0 | 11/15 |
| `battery-initial-sample` | adaptive-cadence.ts | 26/0 | 25/1 |
| `battery-event-listener` | adaptive-cadence.ts | 26/0 | 24/2 |
| `stacked-battery` | adaptive-cadence.ts | 26/0 | 25/1 |
| `stacked-low-power` | adaptive-cadence.ts | 26/0 | 23/3 |
| `measurement-window-edge` | refresh-scheduler-clock.mjs | 26/0 | 25/1 |
| `measurement-unavailable-gap` | refresh-scheduler-clock.mjs | 26/0 | 25/1 |
| `measurement-gap-calculation` | refresh-scheduler-clock.mjs | 26/0 | 25/1 |

The initial cleanup campaign caught 6/7 controls. Its survivor replaced captured
`scheduler.destroy()` with a direct call: the fixture lacked a simultaneous active
loader and future scheduler timer. That survivor remains in
`repair1-mutations/cleanup/results.json`. Test-only commit `5a9bf5d2f2` adds that
combined failure; the final seven cleanup controls all fail as intended:

| Cleanup mutation (helper file) | Before | Mutated |
| --- | --- | --- |
| `dispose-restores-globals` | 4/0 | 1/3 |
| `dispose-clears-owned-timers` | 4/0 | 2/2 |
| `dispose-resolves-owned-loaders` | 4/0 | 3/1 |
| `dispose-reports-original-failure` | 4/0 | 2/2 |
| `setup-restores-earlier-globals` | 4/0 | 3/1 |
| `cleanup-counts-before-force-clear` | 4/0 | 3/1 |
| `destroy-failure-still-releases-loaders` | 4/0 | 3/1 |

All seven restored to `4 pass / 0 fail`, with clean scratch state. This gives
38 distinct detected final controls (31 at repaired source, seven at final
stronger tests); it is not a claim that every historical attempt was caught.
The original pre-review 31-control campaign and initial 6/7 cleanup run remain
preserved alongside the final proofs.

Representative actual red assertions:

```text
not ok 1 - normal disposal reports residual timers before forced cleanup
not ok 3 - trace exhaustion cannot strand a delayed loader during disposal
not ok 4 - failed partial fixture setup restores earlier global replacements
not ok 1 - normal disposal reports residual timers before forced cleanup
```

Before/restored SHA-256 for repaired/final proofs:

```text
refresh-scheduler.ts 9d88c369c4fc4657d308896d0d4119a8b5e7aa65ba43045dd97d96e9e4999dfe
adaptive-cadence.ts  1bbffe5096b70e2c2042ae5a02395003e157542cfcad15da63e02ddd4f235000
refresh-scheduler-clock.mjs 6e10b2289ede9e0d0e87613e1abf877d285a117bd6ef707ddc9fb3de5c4fcd96
```

Raw local task evidence under `next-nov16/ux036/`: `repaired-gate.log`,
`existing-baseline.log`, `synthetic-measurement.json`, independent original and
repaired measurement replays, `selected-suites.log`, `TEST-CLOSEOUT.md`,
`repair1/{first-red,green,all-green}.log`, `repair1-mutations/results.json`,
`repair1-mutations/{cleanup,final-cleanup}/results.json`, every named applied
`.diff`, red log and restored baseline. The earlier gate/interruption and review
findings remain preserved. No production mutant was applied to the candidate.

## Review, CI, manual verification and rollback

Final independent Sol/Sonnet reviews must examine the completed source and this
evidence before recording an exact-tip verdict and requesting publication.
Review conclusions are retained separately; no self-review approval is substituted.

Documentation claim `6d5c11b270` passed 13/14 workflows. Security Audit alone failed:
unchanged marketing-site dependencies reported `0 high, 1 critical`
(`react-server-dom-webpack`). Its separate repair remains in held draft #1904.
Receipts are `claim-ci.json` and `claim-audit.json`. Implementation hosted CI is
not claimed; no audit threshold, test or protection was weakened.

Manual fixture reproduction: run `npm run test:ux036`, then the measurement command
above and inspect zero-start jobs, unavailable gaps, half-open windows and cleanup.
No new app behavior exists to verify in this stage. Rollback removes only the
fixture, test/report entry point and mapping additions; restore the former five
cadence tests without removing their coverage. There is no data migration.

Proposed PR description: characterize existing scheduler and battery policy with
bounded deterministic fixtures, actual charging events and reproducible synthetic
reports. Preserve production timing and full UX-036 acceptance. Local tests, type
checks and full repaired gate pass; 38 final controls prove detection, with
the original cleanup survivor and repair disclosed. Wider hosted acceptance
and the separate marketing audit remain open; all merge/delivery holds remain.
