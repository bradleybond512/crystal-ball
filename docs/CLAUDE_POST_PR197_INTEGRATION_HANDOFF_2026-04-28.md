# Claude Handoff: Post-PR197 Integration Pass

Date: 2026-04-28

## Goal

Confirm that the self-learning, self-correcting, and diagnostics roadmap work has made it to `main`, then execute the next integration pass so these foundations become visible, diagnosable, and operational in the app.

## Current State

The roadmap work has landed on `origin/main`.

Merged PR sequence:

- `#183`: Weather mission bridge fixes
- `#184`: FAA weather cams
- `#185`: Failure Prediction
- `#186`: Policy Engine
- `#187`: Experiment Manager
- `#188`: Causal Attribution Engine
- `#189`: Trust Budget
- `#190`: Scenario Library
- `#191`: Model Governance Layer
- `#192`: Personal Resilience Model
- `#193`: Operational Playbook Engine
- `#194`: Quality Debt Tracker
- `#195`: Self-Improvement Scheduler
- `#196`: Panel smoke harness
- `#197`: Harden 4 panels against empty/degraded sidecar responses

After fetching, `origin/main` points at:

```text
82126db Harden 4 panels against empty / degraded sidecar responses
8a49e7a panel-smoke harness: extend eslint config + drop dead disable directive
3638b5f Panel smoke harness: boot every panel, classify rendered/degraded/silent/errored
9ce099b Layer 10: Self-Improvement Scheduler
67a314c Layer 9: Quality Debt Tracker
```

The old `claude/*` branches for these PRs were deleted remotely, which matches normal merged-PR cleanup.

## Verification Already Run

These checks passed locally:

```bash
npx markdownlint-cli2 \
  docs/CLAUDE_SYSTEM_DIAGNOSTICS_SELF_LEARNING_GAP_SCAN_2026-04-28.md \
  docs/CLAUDE_NEXT_LEVEL_SELF_LEARNING_ROADMAP_2026-04-28.md \
  docs/CLAUDE_STRATEGIC_SELF_IMPROVEMENT_ROADMAP_2026-04-28.md
```

```bash
npx tsx --test \
  src/services/diagnostics/__tests__/failure-prediction.test.mts \
  src/services/governance/__tests__/policy-engine.test.mts \
  src/services/experiments/__tests__/experiment-manager.test.mts \
  src/services/ops/__tests__/causal-attribution.test.mts \
  src/services/ops/__tests__/trust-budget.test.mts \
  src/services/scenarios/__tests__/scenario-library.test.mts \
  src/services/governance/__tests__/model-governance.test.mts \
  src/services/personal/__tests__/resilience-model.test.mts \
  src/services/ops/__tests__/playbook-engine.test.mts \
  src/services/quality/__tests__/quality-debt.test.mts \
  src/services/quality/__tests__/self-improvement-scheduler.test.mts
```

Result: `130/130` tests passed.

```bash
npm run typecheck:all
```

Result: passed.

GitHub checks on PR `#197` were green, including actionlint, bundle-size, cross-agent review, ESLint, integrity checks, secret scan, typecheck, auto-merge, and release-doctor.

## Local Verification Caveat

This command failed locally:

```bash
npm run test:panels:smoke
```

Failure:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'happy-dom' imported from tests/panels/setup-dom.mts
```

Local environment detail:

```text
Node.js v25.8.2
```

The repo declares an engine range of `>=22.0.0 <23.0.0`, and local `node_modules` did not contain `happy-dom`. Treat this as a local dependency/runtime mismatch until reproduced under Node 22 with a clean install.

Recommended verification before touching panel smoke logic:

```bash
nvm use 22
npm ci
npm run test:panels:smoke
```

## Does The System Make Sense?

Yes. The current architecture is coherent.

The new roadmap layers are mostly pure, deterministic services with direct tests. That is the right shape for a system that needs to self-diagnose and eventually self-improve without creating uncontrolled side effects.

The current stack is best understood as the foundation layer:

- Failure prediction can classify capability risk.
- Policy engine can decide whether actions should be allowed, reviewed, approved, or denied.
- Experiment manager can structure controlled local comparisons.
- Causal attribution can explain likely causes of changes.
- Trust budget can track confidence and reliability.
- Scenario library can define regression and resilience checks.
- Model governance can gate model/provider choices.
- Personal resilience can adjust behavior around user context.
- Operational playbooks can define response procedures.
- Quality debt can track unresolved system issues.
- Self-improvement scheduler can rank what should be fixed next.

The remaining weakness is not conceptual. The weakness is integration depth.

## What Is Still Missing

### 1. Aggregate Strategic Test Script

There is no convenient package script for the new strategic/self-improvement suite.

Attempted command:

```bash
npm run test:strategic-self-improvement -- --runInBand
```

Result: missing script.

Add a package script that runs the 11 strategic service test files together. This gives agents and CI a stable command for this whole subsystem.

Likely file:

- `package.json`

Expected command shape:

```bash
npm run test:strategic-self-improvement
```

### 2. Diagnostics Export Integration

The new services should be visible in the diagnostic surface, not only testable in isolation.

Wire the following outputs into diagnostics/export/system-health style flows where appropriate:

- Failure predictions
- Active quality debt
- Trust budget state
- Self-improvement scheduler rankings
- Policy decisions for proposed automated actions
- Scenario-library pass/fail summaries

Likely areas to inspect:

- `src/services/diagnostics/`
- `src/services/quality/`
- `src/services/ops/`
- app/system health export paths
- release doctor or diagnostics report generation scripts

### 3. Real Quality Debt Inputs

The quality debt tracker is useful only if real diagnostics populate it.

Add adapters that turn concrete evidence into debt items:

- failing smoke panels
- stale provider data
- high-risk failure predictions
- repeated degraded sidecar responses
- model governance blocks
- failed scenario-library checks
- unresolved release-doctor findings

The tracker should not become a manual-only registry.

### 4. Policy Engine As A Gate

The policy engine should gate automated improvement behavior.

Use it before any future process:

- promotes tuned settings
- changes model/provider routing
- changes notification behavior
- alters safety-critical logic
- converts a self-improvement recommendation into an automated action

Expected behavior:

- Low-risk cache/UI tuning may be allowed automatically.
- Notification, private data, provider config, algorithm promotion, and safety-sensitive changes require approval, PR review, or denial according to the existing policy rules.

### 5. Scenario Library In CI Or Release Doctor

The scenario library should become a regression gate.

Start small:

- Add a focused scenario check command.
- Run it in release doctor or CI.
- Report scenario pass/fail counts in diagnostics.

Do not make every scenario blocking immediately. Begin with high-signal checks that protect core behavior.

### 6. Panel Smoke Reproducibility

Panel smoke is valuable, but local execution currently depends on the correct runtime and dependency install.

Claude should verify under Node 22:

```bash
nvm use 22
npm ci
npm run test:panels:smoke
```

If it still fails, fix the harness or dependency declarations. If it passes, document the Node 22 requirement in the relevant test docs or package script notes.

## Suggested Implementation Order

1. Add `npm run test:strategic-self-improvement`.
2. Verify clean install and smoke tests under Node 22.
3. Add diagnostics aggregation for failure prediction, quality debt, trust budget, and scheduler output.
4. Feed real system evidence into quality debt.
5. Add policy-engine gating around any automated tuning/self-improvement action path.
6. Add scenario-library checks to release doctor or CI.
7. Update docs with the new commands and the expected operational loop.

## Required Verification

Run these before opening the PR:

```bash
npm run test:strategic-self-improvement
npm run test:panels:smoke
npm run typecheck:all
npm run lint
npm run release:doctor
```

If `npm run lint` or `npm run release:doctor` is not available or fails for unrelated existing reasons, document the exact command output and cause in the PR.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball.

Start from a fresh branch off macos/main or origin/main, following AGENTS.md branch discipline. Do not commit directly to main.

We just landed PRs #185-#197. The self-learning/self-correcting roadmap services are on main, and the foundation makes sense, but the next gap is integration depth.

Your task is the post-PR197 integration pass:

1. Add a package script named test:strategic-self-improvement that runs the strategic/self-improvement service tests together:
   - src/services/diagnostics/__tests__/failure-prediction.test.mts
   - src/services/governance/__tests__/policy-engine.test.mts
   - src/services/experiments/__tests__/experiment-manager.test.mts
   - src/services/ops/__tests__/causal-attribution.test.mts
   - src/services/ops/__tests__/trust-budget.test.mts
   - src/services/scenarios/__tests__/scenario-library.test.mts
   - src/services/governance/__tests__/model-governance.test.mts
   - src/services/personal/__tests__/resilience-model.test.mts
   - src/services/ops/__tests__/playbook-engine.test.mts
   - src/services/quality/__tests__/quality-debt.test.mts
   - src/services/quality/__tests__/self-improvement-scheduler.test.mts

2. Verify panel smoke locally under the supported Node runtime. The previous local attempt failed because the machine was using Node v25.8.2 while the repo expects >=22 <23, and happy-dom was missing from node_modules. Use Node 22 and npm ci before deciding whether the harness itself is broken.

3. Wire the new pure services into a real diagnostics/export/system-health surface:
   - failure prediction summaries
   - active quality debt
   - trust budget state
   - self-improvement scheduler rankings
   - policy decisions for proposed automated actions
   - scenario-library pass/fail summaries

4. Make quality debt receive real evidence from diagnostics or verification outputs, not only manual entries.

5. Use the policy engine as a gate before any automated setting upgrade, provider/model routing change, notification behavior change, or safety-sensitive self-improvement action.

6. Add a small scenario-library check to release doctor or CI if the existing architecture supports it cleanly.

Keep the implementation minimal and aligned with current patterns. Do not add broad abstractions unless the repo already has a matching pattern.

Before opening the PR, run:
   npm run test:strategic-self-improvement
   npm run test:panels:smoke
   npm run typecheck:all
   npm run lint
   npm run release:doctor

If a command is missing or fails for unrelated existing reasons, document the exact output and explain it in the PR.
```
