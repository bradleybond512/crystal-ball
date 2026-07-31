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
reviewer runs only after deterministic checks pass. Mechanical documentation
work uses one Luna edit call with a deterministic scope and a three-check
micro-gate; it does not spend tokens on planning or model review. Focused and
standard work uses Terra for planning, implementation, and review. Sol is
reserved for high-assurance planning/review and failed-repair diagnosis, while
high-assurance implementation defaults to Terra/high.

Important commands:

```bash
python3 -m tools.agentic_pipeline status <pipeline-id>
python3 -m tools.agentic_pipeline approve <pipeline-id> \
  --gate design --actor "<name>"
python3 -m tools.agentic_pipeline reconcile <pipeline-id> \
  --expected-head "$(git rev-parse HEAD)" --actor "<name>" --action retry
python3 -m tools.agentic_pipeline resume <pipeline-id>
python3 -m tools.agentic_pipeline summary <pipeline-id>
npm run agentic:pipeline:test
```

Starting the same normalized request on the same branch and commit returns the
existing pipeline. SQLite uses optimistic versions to reject concurrent
writers. A process interruption during a model invocation blocks resume rather
than repeating a possibly mutating call. After inspecting the preserved
worktree, an operator can use `reconcile --action retry` with the exact
inspected HEAD; the workflow exposes the same operation as an explicit
`reconcile_inflight` dispatch choice.

Idempotency keys include the request, target branch and commit, protected
control-plane commit, and policy version. A newer control plane creates a new
run instead of returning a permanently stale ledger.

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

Every pipeline has hard total-token, per-invocation weighted-token, and
invocation-count limits. Codex rollout-budget enforcement receives the smaller
of the remaining total budget and `--max-tokens-per-invocation`, so one call
cannot consume the entire pipeline allowance. Strict config parsing prevents
an unsupported budget setting from being ignored. A USD limit is also
supported, but it fails closed if the Codex event stream does not report cost;
do not set `--max-cost-usd` unless the active Codex provider reports cost.
Prompts are sent over stdin rather than command arguments. Persisted model and
validator output is bounded and redacts bearer credentials, credential-like
environment assignments, authenticated URLs, common token prefixes, and
private keys.

All structured output schemas cap string lengths and array sizes. This bounds
handoff context, prevents an agent from returning an unbounded finding list,
and keeps repair prompts focused.

## Command and secret boundary

Validators never use a shell string. Router commands are parsed into argument
arrays and checked against a fixed allowlist. Before execution, npm script
definitions and gate executables are compared with `HEAD`; modified validation
code fails closed instead of being executed.

Plan scopes must contain bounded file patterns; empty and catch-all scopes are
rejected. Sensitive approval gates are derived deterministically from planned
and actual paths rather than trusted from model output. Validator commands are
fingerprinted before and after execution, and any source mutation blocks the
pipeline instead of being passed to a repair agent.

Codex model subprocesses receive no inherited shell environment and no
workspace network access. Validator subprocesses receive a separately built
environment that removes credential-like variables and disables npm lifecycle
scripts. The GitHub workflow checks out its executable control plane from the
protected default branch and the change target into a separate worktree.
Build/validation runs with read-only repository permissions; a separate
approval-gated job receives write permission only for publishing.

In GitHub Actions, validators additionally run inside an immutable,
networkless Docker image with a read-only container filesystem, dropped
capabilities, no new privileges, and a separate process namespace. The image
is pulled and resolved to its local SHA-256 ID before model credentials are
exposed. Local macOS, Linux, and Windows runs retain credential-scrubbed
direct-process validation unless an immutable image ID is supplied through
`--validator-container-image`.

The workflow pins the validator image by registry digest, overlays `.git`
read-only, and verifies target/control provenance again before publishing.
The final push uses a baseline-bound lease, so concurrent branch movement
cannot be included in or overwritten by the reviewed result.

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

The external cross-agent marker is checked only by pull-request CI. Internal
`workflow_dispatch` validation records its own independent review in the
durable ledger and does not pretend that review satisfies the separate PR
cross-agent gate.

## Tuning without workflow drift

Tune the system through these checked-in control points:

- `.codex/model-policy.json`: agent model, reasoning effort, and repair limit
- `scripts/agent-router.mjs`: boundary-aware domain signals and targeted tests
- workflow inputs: total-token and invocation budgets
- `tools/agentic_pipeline/schemas/`: bounded handoff contracts
- `scripts/agentic-validate.sh`: the single broad completion gate

Run `npm run agentic:policy-check` and `npm run agentic:pipeline:test` after
every tuning change. Keep routing deterministic and run cheap targeted tests
before the broad gate; do not add model calls for work a script can decide.
Coupled multi-domain changes use one integration owner; additional builders
are deferred until a plan proves disjoint file ownership.

## Manual GitHub Actions operation

`.github/workflows/agentic-pipeline.yml` is `workflow_dispatch` only and must be
dispatched from the protected default branch. Configure the repository
`OPENAI_API_KEY` secret before use.

For a new run, provide a request and an existing `codex/*` branch. If a
high-assurance design gate pauses the run, download nothing manually: dispatch
the workflow again with the prior run ID and `design` approval. The pipeline ID
is recovered from the prior artifact.
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
