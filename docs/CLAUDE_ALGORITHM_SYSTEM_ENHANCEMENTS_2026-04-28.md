# Claude Algorithm System Enhancements - 2026-04-28

## Goal

Crystal Ball already has many strong data feeds and several well-tested pure algorithm modules. The next meaningful enhancement is not another panel or another feed. The next enhancement is to close the loop:

```text
decision -> explanation -> user/real-world outcome -> evaluation -> replay fixture -> safer tuning
```

The system should be able to answer:

- Which algorithms are helping?
- Which are noisy, stale, late, or under-confirmed?
- Did Crystal Ball warn early enough?
- Why did a score change?
- What evidence is missing?
- Did an algorithm improvement actually improve outcomes?

## Current Architecture Observations

Useful pieces already exist:

- `src/services/intelligence/truth-score.ts`
- `src/services/intelligence/evidence-graph.ts`
- `src/services/intelligence/confidence-explanation.ts`
- `src/services/intelligence/negative-evidence.ts`
- `src/services/intelligence/compound-risk.ts`
- `src/services/intelligence/forecast-calibration.ts`
- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/services/ops/mission-ledger.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/near-miss.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`

Main gap:

The repo has good pure algorithm engines, diagnostics, and replay primitives, but many are not yet wired into live production decisions. The result is that the app has advanced intelligence parts but cannot yet consistently prove which decisions were right, late, noisy, or worth replaying.

## Recommended Build Theme

Build a **Closed-Loop Algorithm Wiring PR**.

Scope:

- Unify algorithm identity and metadata.
- Record live algorithm decisions into the evaluation ledger.
- Persist and surface real algorithm health.
- Convert important alerts/situations into mission records.
- Generate replay fixtures from misses and near-misses.
- Show user-facing confidence explanations wherever major scores appear.

## Enhancement 1 - Wire Live Algorithms Into The Evaluation Ledger

### Why

`algorithm-evaluation-ledger.ts` exists, but live algorithms mostly do not record their real decisions. The Algorithm Diagnostic Panel therefore risks staying in `unknown` mode even though the app is doing real work.

### Files

- `src/services/algorithms/algorithm-evaluation-ledger.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/services/intelligence/truth-score.ts`
- `src/services/intelligence/compound-risk.ts`
- `src/services/intelligence/negative-evidence.ts`
- `src/services/weather/weather-urgency.ts`
- `src/services/threat-classifier.ts`
- Any call sites that produce major scores or notification decisions.

### Tasks

1. Add a small wrapper/helper for recording algorithm evaluations.
2. Record evaluations for at least these first targets:
   - `truth-score`
   - `compound-risk`
   - `negative-evidence`
   - `weather-urgency`
   - `threat-classifier`
3. Include:
   - algorithm id
   - version
   - domain
   - duration
   - score or label
   - input hash, not raw payload
   - compact detail fields useful for replay/debugging
4. Keep the pure algorithm modules pure. Prefer recording at call sites or thin orchestrator wrappers, not inside pure scorers unless the module already owns side effects.

### Validation

```bash
npm run typecheck:all
npm run test:api
npm run test:sidecar
npm run lint:strict
```

Add focused tests proving the helper records deterministic entries and does not store raw large inputs.

## Enhancement 2 - Unify The Two Algorithm Registries

### Why

There are two sources of algorithm identity:

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithms-state.ts`

This will drift. IDs, versions, domains, and criticality must be one source of truth.

### Files

- `src/services/algorithms/algorithm-registry.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/services/algorithms/algorithm-health.ts`
- `src/services/algorithms/algorithm-health-types.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/services/algorithms/__tests__/algorithm-registry.test.mts`
- `src/services/algorithms/__tests__/algorithm-health.test.mts`

### Tasks

1. Make `algorithms-state.ts` derive its diagnostic definitions from `algorithm-registry.ts`.
2. Preserve fields needed by `algorithm-health.ts`.
3. Ensure ids and versions are stable and consistent:
   - registry id: `truth-score`
   - version: `1.0.0`
   - evaluation id/version should join cleanly, not invent unrelated `truth-score-v1` names unless intentionally normalized.
4. Add tests that every registered algorithm can be converted into a health definition.
5. Add tests that no duplicate ids exist.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/algorithm-registry.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

Use the repo's actual test runner command if `vitest` is wrapped by `package.json`.

## Enhancement 3 - Convert Major Alerts Into Mission Ledger Records

### Why

The closed-loop ops layer is strong, but it needs real mission records. The app should record whether it detected, watched, notified, confirmed, and resolved important events.

### Files

- `src/services/ops/mission-ledger.ts`
- `src/services/ops/time-to-warn.ts`
- `src/services/ops/effectiveness.ts`
- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/services/situation-engine.ts`
- `src/services/unified-alerts.ts`
- `src/services/weather/weather-warning-router.ts`
- `src/services/diagnostics/export-bundle.ts`

### Tasks

1. Add a mission-state singleton or persistence adapter similar to algorithm state.
2. Open missions for major safety or intelligence events:
   - severe weather affecting saved places
   - local infrastructure critical alerts
   - cyber exposure affecting user/watchlist assets
   - compound risk scores above severe threshold
3. Record mission events:
   - `weak_signal`
   - `app_watch`
   - `user_notified`
   - `official_confirmed`
   - `estimated_impact`
   - `actual_impact`
   - `user_acknowledged`
   - `user_action_taken`
   - `forecast_resolved`
   - `near_miss`
4. Include algorithm id on missions when a score or notification decision opened the mission.
5. Add mission data to diagnostics export.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/ops/__tests__/mission-ledger.test.mts src/services/ops/__tests__/time-to-warn.test.mts src/services/ops/__tests__/closed-loop-batch.test.mts
```

Add at least one integration-style test showing a warning decision opens a mission and records `user_notified`.

## Enhancement 4 - Make Confidence Explanations Ubiquitous

### Why

`confidence-explanation.ts` can explain a truth score as components and missing confirmation. That should become the standard explanation surface anywhere Crystal Ball shows important confidence/risk.

### Files

- `src/services/intelligence/confidence-explanation.ts`
- `src/services/intelligence/truth-score.ts`
- `src/services/situation-engine.ts`
- `src/services/threat-synthesis.ts`
- `src/services/insights/big-event-detector.ts`
- `src/services/insights/confidence-urgency-matrix.ts`
- Relevant panels that render confidence/risk labels.

### Tasks

1. Define a common score explanation shape for UI consumers.
2. Attach explanation output to:
   - truth-scored facts
   - situation confidence
   - compound risk results
   - cyber/threat classifier results
   - severe weather/personal storm mode decisions
3. Show:
   - top positive drivers
   - top negative drivers
   - missing confirmation
   - contradiction indicators
4. Avoid dumping raw internals into the UI. Keep it short and actionable.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/intelligence/__tests__/truth-score.test.mts src/services/intelligence/__tests__/evidence-graph.test.mts
```

Add snapshot-like deterministic tests for explanation output on single-source, corroborated, stale, and disputed facts.

## Enhancement 5 - Consolidate Negative Evidence

### Why

There is older negative-evidence behavior inside `alert-correlator.ts`, while a cleaner reusable engine exists in `src/services/intelligence/negative-evidence.ts`. Consolidating this reduces duplicated confidence logic and makes missing follow-on signals explainable.

### Files

- `src/services/alert-correlator.ts`
- `src/services/intelligence/negative-evidence.ts`
- `src/services/intelligence/__tests__/negative-evidence.test.mts`
- `src/services/correlation-feedback.ts`
- `src/services/correlation.ts`

### Tasks

1. Keep the domain-specific causal rules where they belong, but evaluate missing expected effects through the shared negative-evidence engine.
2. Emit negative-evidence details into evaluation records.
3. Add missing confirmation text to alert/situation explanations.
4. Ensure missing data reduces confidence instead of silently disappearing.
5. Preserve existing behavior with focused regression tests.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/intelligence/__tests__/negative-evidence.test.mts
```

Add a correlator regression test for a cause whose expected effect never appears.

## Enhancement 6 - Turn Misses And Near-Misses Into Replay Tests

### Why

The repo already has a replay harness. The meaningful upgrade is to feed it from real near-misses and run generated fixtures so late/noisy/missed warnings become permanent regression pressure.

### Files

- `src/services/ops/near-miss.ts`
- `src/services/ops/replay-fixtures.ts`
- `src/services/ops/replay-harness.ts`
- `src/services/ops/replay-fixtures-catalog.ts`
- `src/services/ops/__tests__/replay-harness.test.mts`
- `src/services/ops/__tests__/replay-fixtures-catalog.test.mts`
- CI/test scripts if a new replay check is added.

### Tasks

1. Build a batch function:
   - read mission records
   - detect near-misses
   - generate replay fixtures
   - run replay
   - return a report
2. Add export support for generated fixtures.
3. Add a stable fixture catalog for known historical scenarios.
4. Add CI coverage for the fixture catalog.
5. Keep generated local fixtures out of git unless intentionally promoted.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/ops/__tests__/closed-loop-batch.test.mts src/services/ops/__tests__/replay-harness.test.mts src/services/ops/__tests__/replay-fixtures-catalog.test.mts
```

## Enhancement 7 - Add Real Tunables For Safe Adjustment

### Why

`safe-adjustment.ts` exists, but `AlgorithmDiagnosticPanel` currently calls `proposeAdjustments` with an empty tunings list. That means the panel can say an algorithm is degraded but cannot propose meaningful bounded changes.

### Files

- `src/services/algorithms/safe-adjustment.ts`
- `src/services/algorithms/algorithms-state.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- Algorithm modules with real thresholds:
  - weather urgency thresholds
  - correlation windows/radii
  - relevance thresholds
  - confidence penalties
  - notification thresholds

### Tasks

1. Add a tunable registry with safe bounds and current values.
2. Start with low-risk tunables:
   - relevance threshold
   - stale-data confidence penalty
   - digest ranking weight
3. Add safety-critical tunables only after ledger samples exist:
   - weather urgency threshold
   - polygon buffer
   - critical notification bypass threshold
4. Keep proposals human-approved. Do not auto-apply.
5. Show rollback values in the diagnostic panel.

### Validation

```bash
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/safe-adjustment.test.mts
```

Add tests proving safety-critical tunables use conservative half-steps and never exceed declared bounds.

## Suggested PR Sequence

### PR 1 - Registry And Ledger Wiring

Purpose:

- unify algorithm registry
- add evaluation recording helper
- record a small number of live algorithm decisions

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/algorithm-registry.test.mts src/services/algorithms/__tests__/algorithm-evaluation-ledger.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

### PR 2 - Mission Ledger Live Wiring

Purpose:

- open mission records from real notifications/situations
- record time-to-warn events
- export mission diagnostics

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/mission-ledger.test.mts src/services/ops/__tests__/time-to-warn.test.mts src/services/ops/__tests__/closed-loop-batch.test.mts
```

### PR 3 - Explanation Everywhere

Purpose:

- standardize confidence explanations
- attach missing confirmation and contradiction details to major scores

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/intelligence/__tests__/truth-score.test.mts src/services/intelligence/__tests__/evidence-graph.test.mts
```

### PR 4 - Replay From Near-Misses

Purpose:

- turn missions and near-misses into replay fixtures
- run replay checks in tests

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/ops/__tests__/closed-loop-batch.test.mts src/services/ops/__tests__/replay-harness.test.mts src/services/ops/__tests__/replay-fixtures-catalog.test.mts
```

### PR 5 - Safe Tunable Proposals

Purpose:

- add a tunable registry
- make Algorithm Diagnostic Panel show actionable proposals

Validation:

```bash
npm run lint:strict
npm run typecheck:all
npx vitest run src/services/algorithms/__tests__/safe-adjustment.test.mts src/services/algorithms/__tests__/algorithm-health.test.mts
```

## Full Verification Before Claiming Done

Run:

```bash
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build
```

Also run targeted tests for any touched services.

Avoid relying on broad `npm run lint` until its current repo/worktree scope issue is fixed, because it can report unrelated existing issues from extra worktree paths.

## Open Risks And Guardrails

- Do not make safety-critical algorithms self-adjust automatically.
- Do not store raw large inputs or sensitive provider payloads in ledgers.
- Do not create duplicate algorithm ids between registry, ledger, and health reports.
- Do not let stale or missing data silently vanish; it must lower confidence or appear as missing confirmation.
- Do not make explanations verbose. The UI should show the top few reasons and the next best confirmation source.
- Do not generate git-tracked replay fixtures from private/local user data unless intentionally sanitized.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Goal: implement the closed-loop algorithm enhancement plan in docs/CLAUDE_ALGORITHM_SYSTEM_ENHANCEMENTS_2026-04-28.md.

Start by reading:
- AGENTS.md
- docs/CLAUDE_ALGORITHM_SYSTEM_ENHANCEMENTS_2026-04-28.md
- docs/ALGORITHM_INTELLIGENCE_ENHANCEMENT_PLAN.md
- docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md
- docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md

Do not commit to main. Do not push to upstream/origin. Stage specific files by name only.

Recommended first PR:
1. Unify algorithm registry and algorithms-state so there is one source of truth for ids, versions, domains, and criticality.
2. Add an evaluation-recording helper that live call sites can use without making pure algorithm modules impure.
3. Wire evaluations for truth-score, compound-risk, negative-evidence, weather-urgency, and threat-classifier or the closest live call sites.
4. Add tests proving records are deterministic, compact, and join correctly to algorithm health.
5. Run lint:strict, typecheck:all, and targeted tests before claiming done.

After PR 1, continue with:
- mission ledger live wiring
- confidence explanations across major scores
- negative-evidence consolidation
- replay fixture generation from near-misses
- safe tunable proposal registry

Report exact files changed, tests run, remaining risks, and which PR stage you completed.
```
