# Crystal Ball Agent Rules

## Active Roadmap

- Prediction, calibration, correlation, or self-tuning work must start with
  `docs/PREDICTION_ACCURACY_ROADMAP.md`.
- Claim one `ACC-NNN` task through a draft PR before implementation and update
  its status and evidence in the same PR that completes the work.
- `docs/PREDICTION_UPLIFT_PLAN.md` is a reference design, not the live tracker.

## Delivery Path

- `main` is the only merge target.
- Agent branches (`claude/*`, `codex/*`, `copilot/*`) must go through draft PRs and required checks. Merge and auto-merge require explicit human approval.
- Do not merge agent PRs directly with the REST merge endpoint or local `git merge` unless explicitly told.

## Branch Discipline (MANDATORY — start every session here)

**Never commit directly to local `main`.** Every session must start from a fresh branch:

```bash
git fetch macos
git checkout -b codex/your-feature-name macos/main  # use claude/* for Claude sessions
# ... do work, commit freely ...
git push macos codex/your-feature-name
# open a draft PR → wait for explicit merge approval
```

- Local `main` is read-only — only ever fast-forward it to `macos/main`
- Committing directly to local `main` causes divergence that is painful to reconcile across sessions
- If you find yourself on `main` with changes, move to a branch before pushing: `git checkout -b codex/rescue-YYYYMMDD`

## Release And Main Sync

- Official desktop releases are tag-driven.
- Continuous install to Bradley's Mac is handled locally by `npm run main-sync:setup`, which installs a macOS LaunchAgent that polls `macos/main`.
- The sync clone lives at `~/.crystalball-main-sync/repo`. Never develop there; it is disposable and owned by the sync agent.
- The local Mac sync path must:
  - run `npm run lockfile:check`
  - run `npm ci`
  - run `npm run typecheck:all`
  - run `npm run build`
  - run `npm run desktop:build:app:full`
  - install via `node scripts/install-built-app.mjs --relaunch`
  - refuse to install unless GitHub required checks for `main` are green

## Local Sync Agent

- Bootstrap or repair the sync agent with `npm run main-sync:setup`.
- Trigger a one-off sync manually with `npm run main-sync:run`.
- The agent state lives under `~/.crystalball-main-sync/`:
  - `repo/` clean clone
  - `state.json` last installed commit
  - `status.json` last sync result
  - `logs/` LaunchAgent stdout/stderr
- If `/scripts/sync-main-to-mac.mjs` or `/scripts/setup-main-sync-agent.mjs` changes, rerun `npm run main-sync:setup`.
- Do not add any `self-hosted` jobs to PR-triggered workflows in this public repo.

## Safety

- Prefer fail-closed behavior. If signing, verification, packaging, or install checks fail, stop the sync instead of falling back to a weaker path.
- Keep `~/Applications/Crystal Ball.app` as the canonical install target.
- This is a user-owned repo on GitHub, so non-provider patterns and validity checks are unavailable. The compensating control is mandatory repo secret scan coverage in local hooks and CI; keep `npm run secrets:scan:staged` and `npm run secrets:scan` enabled and passing.

## Agentic Engineering Workflow

Use `.agents/skills/crystal-ball-feature-workflow/SKILL.md` for every nontrivial feature, multi-file bug fix, provider integration, prediction-system change, Tauri/native change, or security-sensitive task.

### Work classification

- **Fast:** isolated documentation, copy, style, or obvious one-file fixes.
- **Standard:** normal features, multi-file fixes, provider work, UI behavior, performance work, and test additions.
- **High assurance:** prediction/calibration logic, security boundaries, secrets, Tauri IPC, filesystem or network permissions, migrations, destructive operations, release/install logic, and architecture changes.

High-assurance work must stop for human approval after discovery and design, before production implementation.

### Required sequence

For Standard and High Assurance work:

1. Create a structured feature brief with goals, acceptance criteria, constraints, non-goals, unknowns, and risk.
2. Delegate read-only repository exploration to `repository_analyst`.
3. Delegate design to `architect` before editing production code.
4. Decompose the approved design into bounded tasks with owners, dependencies, file scope, and validation commands.
5. Delegate implementation to the narrowest suitable specialist.
6. Require behavior-focused tests for every behavior change.
7. Run `bash scripts/agentic-validate.sh` plus the most relevant targeted test scripts.
8. Delegate the completed diff to `independent_reviewer`; the reviewer must not be the implementer.
9. Repair confirmed findings and rerun affected checks. Allow at most two automatic review/repair cycles.
10. Prepare a draft PR summary. Do not push, merge, publish, deploy, install, or alter production data without explicit approval.

### Crystal Ball architecture boundaries

- Preserve existing module and provider conventions before introducing new abstractions.
- Validate and normalize external data at provider boundaries.
- Use bounded timeouts, retries, caches, and rate-limit handling for network providers.
- Keep provider-specific schemas out of presentation components.
- Treat forecast, calibration, correlation, scoring, self-tuning, and promotion logic as high assurance.
- Prediction changes must include measurable evidence, benchmark or replay impact where applicable, and rollback behavior.
- Tauri commands and sidecar endpoints must validate input, constrain privileged access, avoid leaking secrets/internal errors, and fail closed.
- Avoid expensive work in render loops and repeated computation over large intelligence datasets.
- Never add dependencies without explaining necessity, maintenance, licensing, bundle/build impact, and security impact.

### Testing and validation

- Never delete tests merely because they fail.
- Never weaken assertions, linting, type checking, secret scanning, CSP checks, or security tests to obtain a pass.
- Prefer focused behavioral tests over broad snapshots.
- Run targeted tests first, then the repository agentic validation gate.
- If any command cannot run, state why; never claim it passed.

### Completion report

Every completed coding task must report:

- summary and user-visible behavior;
- files and architecture changed;
- validation commands and actual results;
- independent review outcome;
- unresolved risks;
- manual verification steps;
- rollback considerations;
- proposed commit and draft PR description.
