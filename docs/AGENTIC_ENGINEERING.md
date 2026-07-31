# Crystal Ball Agentic Engineering

Crystal Ball uses one supervised engineering control plane across Codex and
Claude Code rather than separate assistant-specific workflows. Repository
instructions, specialist agents, reusable workflow Skills, executable checks,
Claude project hooks, and GitHub CI work together.

## Executable runtime

The repository includes a standard-library-only Python orchestration package at
`tools/agentic_pipeline/`. It executes the workflow rather than relying on a
model to remember the sequence.

Start a local pipeline:

```bash
python3 -m tools.agentic_pipeline start \
  --request "Add a bounded provider integration" \
  --branch "codex/provider-integration"
```

The command creates `.agentic-run/state.sqlite` with mode `0600`, routes through
`scripts/agent-router.mjs`, selects models from `.codex/model-policy.json`,
invokes Codex with JSON schemas, runs the smallest targeted checks first, then
runs `scripts/agentic-validate.sh` once as the broad gate. An independent
reviewer runs only after deterministic checks pass.

Important commands:

```bash
python3 -m tools.agentic_pipeline status <pipeline-id>
python3 -m tools.agentic_pipeline approve <pipeline-id> \
  --gate design --actor "<name>"
python3 -m tools.agentic_pipeline resume <pipeline-id>
python3 -m tools.agentic_pipeline summary <pipeline-id>
npm run agentic:pipeline:test
```

Starting the same normalized request on the same branch returns the existing
pipeline. SQLite uses optimistic versions to reject concurrent writers. A
process interruption during a model invocation blocks resume rather than
repeating a possibly mutating call.

## Failure and repair contract

Validation stops at the first failure. The runtime creates a redacted packet
containing the owning builder, command, exit code, bounded output, changed
files, and attempt number. The packet returns to the original builder. The
failed command runs first after repair, followed by the complete gate.

Two automatic builder repairs are permitted. The second repair raises reasoning
effort by one level. A third failure triggers read-only GPT-5.6 Sol diagnosis
and blocks further mutation.

Blocking independent-review findings use the same ownership rule: the original
builder repairs them, deterministic validation reruns, and a fresh independent
review decides readiness.

## Budgets and logs

Every pipeline has hard token and invocation limits. A USD limit is also
supported, but it fails closed if the Codex event stream does not report cost;
do not set `--max-cost-usd` unless the active Codex provider reports cost.
Prompts are sent over stdin rather than command arguments. Persisted model and
validator output is bounded and redacts bearer credentials, credential-like
environment assignments, authenticated URLs, common token prefixes, and
private keys.

## Command and secret boundary

Validators never use a shell string. Router commands are parsed into argument
arrays and checked against a fixed allowlist. Before execution, npm script
definitions and gate executables are compared with `HEAD`; modified validation
code fails closed instead of being executed.

Codex model subprocesses receive no inherited shell environment and no
workspace network access. Validator subprocesses receive a separately built
environment that removes credential-like variables and disables npm lifecycle
scripts. The GitHub workflow checks out its executable control plane from the
protected default branch and the change target into a separate worktree.
Build/validation runs with read-only repository permissions; a separate
approval-gated job receives write permission only for publishing.

Each ledger binds the target and control-plane commit IDs. Resume fails closed
when either checkout changes, and draft PR updates verify that the PR head is
the pipeline branch.

## Cross-platform Claude enforcement

`CLAUDE.md` imports `AGENTS.md`, so Claude Code consumes the same canonical
repository rules. `.claude/settings.json` installs Node-based `SessionStart`
and `PreToolUse` hooks, which work on macOS, Linux, and Windows without relying
on a shell script. The hooks inject the shared workflow contract and deny
unapproved push, merge, release, deployment, keychain, and destructive
commands.

`node scripts/agent-policy-check.mjs` and the Python regression suite verify
that Claude's import, hooks, and protected-action rules remain present. Local
hooks can be disabled by a machine owner, so CI and branch protection remain
the non-bypassable repository boundary.

## Tuning without workflow drift

Tune the system through these checked-in control points:

- `.codex/model-policy.json`: agent model, reasoning effort, and repair limit
- `scripts/agent-router.mjs`: domain signals and targeted deterministic tests
- workflow inputs: total-token and invocation budgets
- `tools/agentic_pipeline/schemas/`: bounded handoff contracts
- `scripts/agentic-validate.sh`: the single broad completion gate

Run `npm run agentic:policy-check` and `npm run agentic:pipeline:test` after
every tuning change. Keep routing deterministic and run cheap targeted tests
before the broad gate; do not add model calls for work a script can decide.

## Manual GitHub Actions operation

`.github/workflows/agentic-pipeline.yml` is `workflow_dispatch` only and must be
dispatched from the protected default branch. Configure the repository
`OPENAI_API_KEY` secret before use.

For a new run, provide a request and an existing `codex/*` branch. If a
high-assurance design gate pauses the run, download nothing manually: dispatch
the workflow again with the prior run ID, pipeline ID, and `design` approval.
The workflow restores the SQLite ledger and binary worktree patch from the
prior artifact.

Publishing defaults off. When `publish_changes` is explicitly enabled after
all gates pass, the workflow records a durable publish approval, stages only
the exact changed paths, commits with the required co-author trailer, pushes
the specified `codex/*` branch, and optionally updates an existing draft PR.
It refuses non-draft PR body updates.

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
3. `CLAUDE.md` imports the same policy; `.claude/` adds cross-platform hooks.
4. `.agents/skills/crystal-ball-feature-workflow/SKILL.md` defines sequencing and handoffs.
5. `scripts/agentic-validate.sh` supplies a repeatable local completion gate.
6. `tools/agentic_pipeline/` executes routing, state, repair, and review.
7. Existing GitHub required checks remain the final merge authority.

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

Agents may prepare local changes and draft PR material. A manual workflow
dispatch may explicitly authorize pushing a completed `codex/*` branch and
updating an existing draft PR. Merge, auto-merge, release, install, deployment,
secret changes, and destructive data operations remain outside the runtime and
require separate explicit human approval.
