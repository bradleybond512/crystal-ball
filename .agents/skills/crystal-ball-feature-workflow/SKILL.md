---
name: crystal-ball-feature-workflow
description: Use for every substantial Crystal Ball feature, multi-file bug fix, provider integration, prediction/calibration/correlation change, Tauri or sidecar change, security-sensitive task, performance project, or architecture change. Do not use for trivial copy, formatting, or isolated documentation edits.
---

# Crystal Ball Agentic Feature Workflow

Follow these phases in order. AGENTS.md remains authoritative.

## 1. Branch and classify

Confirm work is on a fresh `codex/*` branch based on `macos/main`, never local
`main`. Classify the task as Fast, Standard, or High Assurance.

Prediction, calibration, correlation, scoring, self-tuning, promotion, Tauri
IPC, permissions, secrets, networking boundaries, migrations, destructive
operations, release/install behavior, and architecture changes are High
Assurance.

## 2. Intake

Create a concise feature brief containing objective, user/analyst value,
acceptance criteria, constraints, non-goals, unknowns, risk level, affected
variants, and expected evidence.

For prediction-adjacent work, read `docs/PREDICTION_ACCURACY_ROADMAP.md`, identify
one applicable `ACC-NNN` task, and follow its claim/evidence rules.

## 3. Discovery

For Standard and High Assurance tasks, delegate read-only exploration to
`repository_analyst`. Ask it to trace the actual execution path, tests,
boundaries, and relevant validation commands. Do not edit production files.

For security-sensitive work, explicitly map trust boundaries, privileged
operations, attacker-controlled inputs, secrets, and fail-closed behavior.

## 4. Design

Delegate design to `architect`. Require goals/non-goals, architecture, data and
control flow, schemas/interfaces, errors and degraded modes, security,
performance, tests, migration, rollback, and alternatives.

Stop for explicit human approval after design for High Assurance work.

## 5. Task plan

Create atomic tasks. Each task must define objective, agent owner, dependencies,
allowed modules/files, acceptance criteria, validation command, non-goals, and
expected evidence. Parallelize only cleanly separable work.

Route implementation to the narrowest agent:

- external sources and ingestion: `provider_engineer`
- fusion, correlation, evidence, analyst reasoning: `intelligence_engineer`
- forecasting, calibration, scoring, replay, promotion: `prediction_engineer`
- Tauri, sidecar, filesystem, networking, security: `tauri_security_engineer`
- UI, state, globe/map, accessibility: `ui_map_engineer`
- tests and abuse/failure coverage: `test_engineer`

Use isolated Git worktrees when parallel streams might collide.

## 6. Implement

Require agents to inspect before editing, stay within scope, preserve existing
patterns, avoid unrelated refactors, add behavior tests, report design
deviations, and run targeted checks. Dependencies require explicit approval and
an explanation of necessity, maintenance, license, build/bundle, and security
impact.

## 7. Integrate and validate

Resolve mechanical integration issues without changing the approved design.
Architectural deviations return to the design phase.

Run targeted domain tests, then:

```bash
bash scripts/agentic-validate.sh
```

Do not edit validation rules during a feature unless that is explicitly within
approved scope. Record exact commands, exit results, failures, and warnings.

Prediction changes must also produce the roadmap-required replay, calibration,
benchmark, or shadow evidence. Security-sensitive changes must run relevant
adversarial tests and `npm run secrets:scan`.

## 8. Independent review

Delegate the complete diff to `independent_reviewer`, never the implementer.
Triage findings as confirmed blocking, confirmed nonblocking, unconfirmed, or
false positive.

Repair confirmed findings with the relevant specialist, rerun affected checks,
and obtain fresh independent review. Allow at most two automatic repair cycles.
Stop if a blocker remains, tests must be weakened, architecture changes, or
scope materially expands.

## 9. Completion and publication boundary

Report summary, user-visible behavior, architecture and files changed,
validation commands and actual results, review outcome, evidence, unresolved
risks, manual verification, rollback, proposed commit, and draft PR text.

Do not push, merge, enable auto-merge, release, install, deploy, change secrets,
or alter production data without explicit human approval.
