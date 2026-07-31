# Crystal Ball Agentic Engineering

Crystal Ball uses Codex as a supervised engineering team rather than a single
unbounded coding agent. Repository instructions, specialist agents, a reusable
workflow Skill, executable checks, and GitHub CI work together.

## Start a task

Open the repository in Codex and prompt:

```text
Use $crystal-ball-feature-workflow.

<Describe the desired outcome, constraints, and acceptance criteria.>

Stop after a reviewed local change and draft PR description. Do not push or
merge without approval.
```

Codex should create a fresh `codex/*` branch from `macos/main`, classify the
work, run discovery and design, delegate bounded implementation, validate,
obtain an independent review, and prepare the completion report.

## Agent roster

- `repository_analyst`: read-only execution-path and repository discovery
- `architect`: read-only design and tradeoff analysis
- `provider_engineer`: ingestion, normalization, health, cache, and fusion edges
- `intelligence_engineer`: evidence, correlation, fusion, and analyst reasoning
- `prediction_engineer`: forecasts, calibration, scoring, replay, and promotion
- `tauri_security_engineer`: native, sidecar, IPC, filesystem, networking, and security
- `ui_map_engineer`: UI, state, globe/map, accessibility, and rendering performance
- `test_engineer`: behavior, regression, failure, integration, and abuse tests
- `independent_reviewer`: read-only final correctness and risk review

## Enforcement layers

1. `AGENTS.md` defines permanent repository policy.
2. `.codex/agents/*.toml` defines narrow specialists and permissions.
3. `.agents/skills/crystal-ball-feature-workflow/SKILL.md` defines sequencing and handoffs.
4. `scripts/agentic-validate.sh` supplies a repeatable local completion gate.
5. Existing GitHub required checks remain the final merge authority.

Instructions guide behavior; executable checks and branch protection enforce
reality. A task is not complete when validation could not run.

## Operating modes

### Fast

Inspect, implement, test, review the diff. Use only for trivial, isolated work.

### Standard

Intake, repository discovery, design, task plan, specialist implementation,
targeted tests, validation, independent review, repair, and draft PR.

### High Assurance

Adds threat/trust-boundary analysis, roadmap evidence where applicable, human
design approval before implementation, adversarial testing, full validation,
and explicit rollback. Prediction logic and privileged/native boundaries always
use this mode.

## Safety boundary

Agents may prepare branches, commits, and draft PR material. Push, merge,
auto-merge, release, install, deployment, secret changes, and destructive data
operations require explicit human approval.
