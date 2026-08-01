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

Codex should create a fresh `codex/*` branch from the canonical `main` (the
remote for `bradleybond512/crystal-ball` is named `macos` on Bradley's Mac and
`origin` in most other clones — resolve it, do not assume it), classify the work,
run discovery and design, delegate bounded implementation, validate, obtain an
independent review, and prepare the completion report.

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
4. `scripts/agentic-validate.sh` supplies a repeatable local completion gate. It
   runs lint, typecheck, secrets, docs, and build — no tests of its own — so it
   refuses to run until you name the targeted test scripts via `--tests`, or state
   why none apply via `--no-tests "<reason>"`. `docs:check` stays blocking for
   README count drift and `docs/API_KEYS.md` coverage — no CI workflow runs it, so
   this gate is their only enforcement. Its "PR #N not in CHANGELOG" backlog is
   demoted to advisory: nothing writes those entries automatically, so it stood 10
   deep on a pristine `main` and failed every branch for work the branch did not do.
   A gate that fails before you touch anything teaches agents to ignore it.
5. GitHub required checks are the final merge authority — and they now measure
   the workflow's own definition of done. `cross-agent-review` verifies a
   SHA-pinned verdict commit (see "Review Verdict Protocol" in `AGENTS.md`),
   so an approval dies the moment new code is pushed; with the
   `CI_CODEX_REVIEW` variable on and an `OPENAI_API_KEY` secret, Codex reviews
   the diff inside CI and self-attestation becomes structurally impossible.
   `targeted-tests` runs the `test:*` suites whose files or covered source
   directories intersect the PR diff (`scripts/targeted-tests.mjs` — mapping
   derived from `package.json`, never hand-maintained). Close every agent PR
   with `bash scripts/pr-closeout.sh`, which verifies pushed-tip parity and
   the verdict before arming auto-merge.

Instructions guide behavior; executable checks and branch protection enforce
reality. A task is not complete when validation could not run.

The gate cannot prove a new test would fail without its fix, and it cannot reach
the network to prove a provider filter matches live data. Those two gaps are
closed by evidence the agent must attach — the mutation proof and the live
response shape, both defined in `AGENTS.md` — and audited by `independent_reviewer`.

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
